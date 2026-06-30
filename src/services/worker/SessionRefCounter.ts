import { logger } from '../../utils/logger.js';

/**
 * Single shared, session-bound, reference-counted worker lifecycle.
 *
 * One worker serves ALL Claude Code sessions/projects. SessionStart hooks
 * `acquire(sessionId)` and SessionEnd hooks `release(sessionId)`. When the
 * active-session count reaches 0 the worker arms a short grace timer (so a
 * quickly-following new session reuses the same worker) and, if still idle when
 * it elapses, shuts itself down — giving the target of "0 workers when no
 * session is open, exactly 1 when >=1 are open".
 *
 * Crash-safe: the counter lives in-process keyed by session id. A missed
 * SessionEnd cannot pin the worker forever — a periodic sweep evicts session
 * ids whose last `acquire` is older than `staleMs`, after which the idle grace
 * timer arms normally. Set `graceMs <= 0` to disable auto-shutdown entirely
 * (always-on worker).
 */
export interface SessionRefCounterOptions {
  /** Idle grace before self-shutdown once the count hits 0. <=0 disables auto-shutdown. */
  graceMs: number;
  /** A session id whose last acquire is older than this is swept (missed SessionEnd guard). */
  staleMs: number;
  /** How often the stale-id sweep runs. */
  sweepIntervalMs: number;
  /** Invoked once when the grace timer elapses with 0 active sessions. */
  onIdleShutdown: () => void;
}

export class SessionRefCounter {
  private readonly sessions = new Map<string, number>();
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly opts: SessionRefCounterOptions) {}

  /** Begin the stale-id sweep and arm the idle grace timer if we boot idle. */
  start(): void {
    if (this.opts.sweepIntervalMs > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), this.opts.sweepIntervalMs);
      this.sweepTimer.unref?.();
    }
    // A worker nobody ever acquires (e.g. an orphan started outside a session)
    // still shuts itself down after the grace period.
    this.armGraceIfIdle();
  }

  acquire(sessionId: string): number {
    if (sessionId) {
      this.sessions.set(sessionId, Date.now());
      this.cancelGrace();
    }
    logger.info('SYSTEM', 'Session acquired worker', { sessionId, activeSessions: this.sessions.size });
    return this.sessions.size;
  }

  release(sessionId: string): number {
    if (sessionId) this.sessions.delete(sessionId);
    logger.info('SYSTEM', 'Session released worker', { sessionId, activeSessions: this.sessions.size });
    this.armGraceIfIdle();
    return this.sessions.size;
  }

  size(): number {
    return this.sessions.size;
  }

  stop(): void {
    this.stopped = true;
    this.cancelGrace();
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweep(): void {
    const cutoff = Date.now() - this.opts.staleMs;
    let removed = 0;
    for (const [id, lastSeen] of this.sessions) {
      if (lastSeen < cutoff) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) {
      logger.warn('SYSTEM', 'Swept stale session refs (missed SessionEnd?)', {
        removed,
        activeSessions: this.sessions.size,
      });
    }
    this.armGraceIfIdle();
  }

  private armGraceIfIdle(): void {
    if (this.stopped) return;
    if (this.sessions.size > 0) {
      this.cancelGrace();
      return;
    }
    if (this.opts.graceMs <= 0) return; // auto-shutdown disabled
    if (this.graceTimer) return;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (this.sessions.size === 0 && !this.stopped) {
        logger.info('SYSTEM', 'No active sessions after grace period — shutting down idle worker', {
          graceMs: this.opts.graceMs,
        });
        this.opts.onIdleShutdown();
      }
    }, this.opts.graceMs);
    this.graceTimer.unref?.();
  }

  private cancelGrace(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }
}
