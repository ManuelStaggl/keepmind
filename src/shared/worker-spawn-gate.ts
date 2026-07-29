import { join } from 'path';
import { resolveDataDir } from './paths.js';
import { acquireFileLock, releaseFileLock } from './file-lock.js';

/**
 * Cross-launcher spawn lockfile (Phase 4 of
 * plans/2026-06-10-worker-restart-single-source-of-truth.md).
 *
 * Three independent launchers can try to start the worker at the same time —
 * hooks (src/shared/worker-utils.ts), the MCP server
 * (src/services/worker-spawner.ts), and the CLI restart fallback
 * (src/services/worker-service.ts). This gate gives
 * them mutual exclusion over the SPAWN only: whoever creates
 * `<DATA_DIR>/spawn.lock` with the `wx` flag (O_CREAT|O_EXCL — the create IS
 * the atomicity, no rename or lock library needed) is the one launcher allowed
 * to spawn; everyone else skips their spawn and waits for the winner's worker
 * to come up.
 *
 * The mechanics live in file-lock.ts, which this module and the dependency
 * install gate share. What stays here is the policy: which file, which
 * staleness window, and the rules below.
 *
 * Hard rules:
 * - The lock gates SPAWNING only — never health/readiness checks. A held lock
 *   must never make a hook FAIL, only wait for the holder's worker.
 * - Staleness is judged by the lock file's mtime (statSync().mtimeMs), never
 *   by clock values stored in the file content.
 * - The dying worker's restart handoff (src/services/worker-shutdown.ts) is
 *   deliberately NOT gated: it is the PRIMARY spawner on restart, and hooks
 *   wait for its successor instead of competing with it.
 */

/**
 * A holder that hasn't finished spawning within this window is presumed dead
 * (crashed mid-spawn); its lock may be broken. The longest in-lock wait any
 * holder performs is the ~15s post-spawn port/health wait, which
 * getPlatformTimeout scales 2.0x on Windows to ~30s — so the staleness window
 * must clear 30s, not 15s. 60s keeps a 2x margin over that worst case.
 */
const SPAWN_LOCK_STALE_MS = 60_000;

/**
 * Resolved at call time (resolveDataDir consults KEEPMIND_DATA_DIR / the
 * settings file on each call) rather than binding paths.ts's import-time
 * DATA_DIR const, so every launcher — and the test suite, which points
 * KEEPMIND_DATA_DIR at a temp dir — agrees on the same lock path.
 */
function getSpawnLockPath(): string {
  return join(resolveDataDir(), 'spawn.lock');
}

/**
 * Try to become the one launcher allowed to spawn the worker.
 *
 * Returns true when this process now holds the lock (caller MUST
 * releaseSpawnLock() in a finally). Returns false when another launcher holds
 * a fresh lock — the caller must SKIP its spawn and wait for the holder's
 * worker instead.
 *
 * A lock whose mtime is older than SPAWN_LOCK_STALE_MS is broken (unlinked)
 * and acquisition is retried exactly once.
 */
export function acquireSpawnLock(): boolean {
  return acquireFileLock(getSpawnLockPath(), SPAWN_LOCK_STALE_MS);
}

/**
 * Release the spawn lock IF this process owns it. Owner-checked, so a launcher
 * can never delete a competitor's live lock (e.g. after its own stale lock was
 * broken and re-acquired by someone else). All errors are swallowed — release
 * is best-effort; an orphaned lock self-heals via the staleness breaker in
 * acquireSpawnLock.
 */
export function releaseSpawnLock(): void {
  releaseFileLock(getSpawnLockPath());
}
