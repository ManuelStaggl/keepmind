import { logger } from '../../utils/logger.js';

/**
 * Activity-based idle lifecycle for the single shared worker.
 *
 * The worker shuts itself down after `idleMs` with NO meaningful HTTP activity
 * (any request except /api/health calls `recordActivity()`), once it has served
 * at least one real request. Target: "0 workers when nothing is happening,
 * exactly 1 when work is flowing" — and the worker lazy-respawns on the next
 * hook, so an aggressive idle shutdown is safe.
 *
 * Why activity-based instead of a SessionStart/SessionEnd refcount: the SessionEnd
 * hook was removed because Claude Code SIGTERMs (cancels) its own SessionEnd
 * hooks during exit teardown, which surfaced a scary "SessionEnd hook … Hook
 * cancelled" message to every user on exit even though the release always
 * completed. Driving shutdown off real worker activity removes the need for that
 * hook entirely while keeping prompt idle shutdown — a session that goes quiet
 * for `idleMs` lets the worker exit; the next tool use respawns it transparently.
 *
 * `acquire`/`release`/`acquiredCount` are kept as a thin back-compat surface
 * (SessionStart still POSTs /api/session/acquire, and old installs may still
 * POST release); both simply count as activity. They no longer drive shutdown.
 */
export interface SessionRefCounterOptions {
  /** Shut down after this much inactivity, once the worker has served ≥1 request. <=0 disables auto-shutdown. */
  idleMs: number;
  /** How often the idle check runs. */
  checkIntervalMs: number;
  /** Invoked once when the worker has been idle for `idleMs`. */
  onIdleShutdown: () => void;
  /** Injectable clock (tests). */
  now?: () => number;
}

export class SessionRefCounter {
  private readonly now: () => number;
  private lastActivityAt: number;
  private everActive = false;
  private stopped = false;
  private shutdownFired = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /**
   * S8 — when this worker became able to serve requests. Null until then.
   * The never-used shutdown is measured from HERE and not from process start,
   * so a slow cold boot (embedder load, 320-520 MB, regularly past 20s on
   * Windows) is never mistaken for an idle worker.
   */
  private readyAt: number | null = null;
  /**
   * S11 — sessions that have ASKED for this worker since it started. It only
   * ever counts up: `release()` is never called in practice, because the
   * SessionEnd hook it depended on was removed (Claude Code SIGTERMs its own
   * SessionEnd hooks during teardown, see the class comment). Measured
   * 29.08.2026: 'Session acquired worker' 133 times in the logs, 'Session
   * released worker' zero times, ever.
   *
   * So it is named for what it counts. It was called `approxActive` and
   * reported as `activeSessions`, which promised "currently active" and
   * delivered "assigned since start" — a diagnostic that reads as reassuring
   * while being wrong. As a COUNT it stays useful in exactly one way, and that
   * is why it is kept: 0 reliably means "this worker never had a session",
   * which is the orphan test.
   */
  private acquiredSessions = 0;

  constructor(private readonly opts: SessionRefCounterOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.lastActivityAt = this.now();
  }

  /** Begin the periodic idle check. A worker that never serves a request stays up. */
  start(): void {
    if (this.opts.idleMs > 0 && this.opts.checkIntervalMs > 0) {
      this.timer = setInterval(() => this.maybeShutdown(), this.opts.checkIntervalMs);
      // Never keep the process alive — the idle check itself owns shutdown.
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  /**
   * Record meaningful worker activity: resets the idle clock and marks the worker
   * as having served work (so it becomes eligible for idle shutdown). Called from
   * an HTTP middleware for every non-health request.
   */
  recordActivity(): void {
    this.everActive = true;
    this.lastActivityAt = this.now();
  }

  acquire(sessionId: string): number {
    if (sessionId) this.acquiredSessions += 1;
    this.recordActivity();
    logger.info('SYSTEM', 'Session acquired worker', { sessionId, acquiredSessions: this.acquiredSessions });
    return this.acquiredSessions;
  }

  release(sessionId: string): number {
    if (sessionId && this.acquiredSessions > 0) this.acquiredSessions -= 1;
    logger.info('SYSTEM', 'Session released worker', { sessionId, acquiredSessions: this.acquiredSessions });
    return this.acquiredSessions;
  }

  /** S11: named for what it counts — sessions acquired, not sessions active. */
  acquiredCount(): number {
    return this.acquiredSessions;
  }

  /** Milliseconds since the last meaningful activity. */
  msSinceActivity(): number {
    return this.now() - this.lastActivityAt;
  }

  /**
   * S8 — mark the worker as able to serve requests. Starts the clock for the
   * never-used case; a second call is ignored so a re-initialisation cannot
   * reset it.
   */
  markReady(): void {
    if (this.readyAt === null) this.readyAt = this.now();
  }

  /** Milliseconds since this worker became ready, or null if it never did. */
  msSinceReady(): number | null {
    return this.readyAt === null ? null : this.now() - this.readyAt;
  }

  /**
   * True when this worker should shut itself down.
   *
   * Two ways in, and the second one is S8:
   *
   *  - it served work and has since gone quiet for `idleMs` (unchanged), or
   *  - it became ready and NEVER served anything for `idleMs`.
   *
   * The second case is the orphan. `everActive` is set only in
   * `recordActivity()`, i.e. the first request the worker is given — and an
   * orphan is orphaned BEFORE that ever happens, because the launcher decided
   * it was too slow and moved on. So `everActive` stayed false forever,
   * `isIdle()` returned false forever, and the process ran until the machine
   * was rebooted: measured 29.08.2026, one such worker alive 4h14m at 860s CPU,
   * two of them holding ~660 MB and, critically, keepmind.db open — which is
   * the `database is locked` that wedged the worker for 28 hours on 27.08.
   *
   * The condition that excluded the case is the one that needed it most.
   */
  isIdle(): boolean {
    if (this.opts.idleMs <= 0) return false;
    if (this.everActive) return this.msSinceActivity() >= this.opts.idleMs;
    const sinceReady = this.msSinceReady();
    return sinceReady !== null && sinceReady >= this.opts.idleMs;
  }

  /** Public for tests + the interval: shut down once (idempotent) if idle. */
  maybeShutdown(): void {
    if (this.stopped || this.shutdownFired) return;
    if (this.isIdle()) {
      this.shutdownFired = true;
      logger.info(
        'SYSTEM',
        this.everActive
          ? 'Idle shutdown window elapsed — shutting down worker'
          : 'Ready but never used for the whole idle window — shutting down worker (S8: orphan reaping)',
        {
          idleMs: this.opts.idleMs,
          msSinceActivity: this.msSinceActivity(),
          msSinceReady: this.msSinceReady(),
          acquiredSessions: this.acquiredSessions,
        },
      );
      this.opts.onIdleShutdown();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
