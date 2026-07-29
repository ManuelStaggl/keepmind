// Cross-process mutual exclusion via an exclusively-created lockfile.
//
// Extracted from worker-spawn-gate.ts, which had the only implementation, so a
// second caller (the dependency install, see plugin-deps-lock.ts) does not have
// to duplicate ~80 lines of carefully-reasoned staleness and TOCTOU handling.
// The semantics below are that module's, unchanged.
//
// Hard rules, unchanged from the spawn gate:
// - Creating the file with `wx` (O_CREAT|O_EXCL) IS the atomicity. No rename,
//   no lock library.
// - Staleness is judged by the file's mtime, never by clock values stored in
//   its content — a machine whose clock jumped must still be able to recover.
// - Acquisition fails OPEN when the filesystem refuses the lock outright
//   (EACCES, EROFS). A lock is a collision guard, not a correctness gate: a
//   broken lock mechanism must degrade to the unlocked behaviour, never
//   suppress the guarded operation forever.
// - Release is owner-checked and best-effort.

import { dirname } from 'path';
import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';

/**
 * Try to take `lockPath`.
 *
 * Returns true when this process now holds it (caller MUST releaseFileLock() in
 * a finally) — including the fail-open case, where no file was written and
 * release is a no-op. Returns false when another process holds a fresh lock.
 *
 * A lock whose mtime is older than `staleMs` is presumed abandoned, broken, and
 * acquisition retried exactly once.
 */
export function acquireFileLock(lockPath: string, staleMs: number): boolean {
  const payload = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(dirname(lockPath), { recursive: true });
      writeFileSync(lockPath, payload, { flag: 'wx' });
      return true;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') {
        // Not contention — the filesystem refused the lock outright. Fail open.
        return true;
      }
      if (attempt > 0) {
        // We already broke one stale lock and someone re-acquired before us —
        // treat them as the live holder; never break twice.
        return false;
      }

      let mtimeMs: number;
      try {
        mtimeMs = statSync(lockPath).mtimeMs;
      } catch {
        // Lock vanished between the failed write and the stat — the holder just
        // released. Retry once via the loop.
        continue;
      }

      if (Date.now() - mtimeMs <= staleMs) {
        // Fresh lock: another process is mid-operation.
        return false;
      }

      // Stale lock: the holder died. Re-stat immediately before breaking it —
      // if the mtime changed since we judged it stale, another process already
      // broke it and re-took the lock; unlinking now would delete THEIR fresh
      // lock and mint two winners. The re-stat narrows that TOCTOU window from
      // the whole staleness evaluation to a few microseconds.
      let recheckedMtimeMs: number;
      try {
        recheckedMtimeMs = statSync(lockPath).mtimeMs;
      } catch {
        continue;
      }
      if (recheckedMtimeMs !== mtimeMs) {
        // Re-taken (or refreshed) since we judged it stale — yield to its owner.
        return false;
      }

      try {
        unlinkSync(lockPath);
      } catch {
        // The file vanished between the re-stat and the unlink (a competing
        // breaker won), or the filesystem refused the delete. Either way we
        // cannot claim the break — yield.
        return false;
      }
    }
  }
  return false;
}

/**
 * Release `lockPath` IF this process owns it. Owner-checked: the file is read
 * back and only deleted when its pid matches, so a process can never delete a
 * competitor's live lock (e.g. after its own stale lock was broken and
 * re-acquired). All errors are swallowed — an orphaned lock self-heals via the
 * staleness breaker in acquireFileLock.
 */
export function releaseFileLock(lockPath: string): void {
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as { pid?: unknown };
    if (lock.pid !== process.pid) return;
    unlinkSync(lockPath);
  } catch {
    // Missing, unreadable, or corrupt lock file — leave it alone.
  }
}
