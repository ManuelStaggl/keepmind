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
 * `acquire`/`release`/`size` are kept as a thin back-compat surface (SessionStart
 * still POSTs /api/session/acquire, and old installs may still POST release);
 * both simply count as activity. They no longer drive shutdown.
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
  /** Best-effort acquire/release balance — telemetry/logging only, not load-bearing. */
  private approxActive = 0;

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
    if (sessionId) this.approxActive += 1;
    this.recordActivity();
    logger.info('SYSTEM', 'Session acquired worker', { sessionId, approxActive: this.approxActive });
    return this.approxActive;
  }

  release(sessionId: string): number {
    if (sessionId && this.approxActive > 0) this.approxActive -= 1;
    logger.info('SYSTEM', 'Session released worker', { sessionId, approxActive: this.approxActive });
    return this.approxActive;
  }

  size(): number {
    return this.approxActive;
  }

  /** Milliseconds since the last meaningful activity. */
  msSinceActivity(): number {
    return this.now() - this.lastActivityAt;
  }

  /** True once the worker has served ≥1 request and has since been idle for `idleMs`. */
  isIdle(): boolean {
    return this.everActive && this.opts.idleMs > 0 && this.msSinceActivity() >= this.opts.idleMs;
  }

  /** Public for tests + the interval: shut down once (idempotent) if idle. */
  maybeShutdown(): void {
    if (this.stopped || this.shutdownFired) return;
    if (this.isIdle()) {
      this.shutdownFired = true;
      logger.info('SYSTEM', 'Idle shutdown window elapsed — shutting down worker', {
        idleMs: this.opts.idleMs,
        msSinceActivity: this.msSinceActivity(),
      });
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
