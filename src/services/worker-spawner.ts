
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import { HOOK_TIMEOUTS } from '../shared/hook-constants.js';
import {
  cleanStalePidFile,
  getBootWindowMs,
  getPlatformTimeout,
  spawnDaemon,
  touchPidFile,
  readPidFile,
  removePidFile,
  isProcessAlive,
} from './infrastructure/ProcessManager.js';
import {
  isPortInUse,
  waitForHealth,
  waitForReadiness,
  waitForPortFree,
  httpShutdown,
} from './infrastructure/HealthMonitor.js';
import { acquireSpawnLock, releaseSpawnLock } from '../shared/worker-spawn-gate.js';
import { isProvenWorkerProcess } from '../supervisor/process-registry.js';
import { ensurePluginDependencies } from './plugin-deps-repair.js';

export type WorkerStartResult = 'ready' | 'warming' | 'dead';

/** How long a replaced worker gets to exit on SIGTERM before it is killed. */
const REPLACED_WORKER_GRACE_MS = 5_000;

/**
 * Resolve the live worker's ACTUAL bound port from the PID file (which the
 * daemon rewrites with its real port after an ephemeral-port fallback), falling
 * back to the configured port. Lets the post-spawn health wait discover a
 * worker that routed around a squatted configured port.
 */
function resolveLiveWorkerPort(configuredPort: number): number {
  const info = readPidFile();
  if (info && typeof info.port === 'number' && isProcessAlive(info.pid)) {
    return info.port;
  }
  return configuredPort;
}

/**
 * Wait for a just-spawned worker to answer /api/health, re-resolving its port
 * each iteration so an ephemeral-fallback worker (bound to a free port because
 * the configured one was squatted) is still discovered. Returns the port the
 * worker actually answered on, or null if none did within the budget.
 */
async function waitForSpawnedWorker(configuredPort: number, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probePort = resolveLiveWorkerPort(configuredPort);
    if (await waitForHealth(probePort, 800)) {
      return probePort;
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return null;
}

/**
 * Tear down a wedged worker (answers the port but never reaches readiness) so a
 * healthy one can replace it. Ask it to STOP — not restart: a restart would
 * have it spawn its OWN successor, racing the respawn the caller is about to do
 * under the spawn lock. If the graceful stop does not free the port, kill the
 * recorded PID directly as a backstop; if that still fails, the caller's spawn
 * path routes around the squatted port with an ephemeral fallback. The PID file
 * is cleared either way so the stale-PID branch does not re-adopt the corpse.
 */
async function replaceWedgedWorker(port: number): Promise<void> {
  const info = readPidFile();
  try {
    await httpShutdown(port, 'stop');
  } catch (error) {
    logger.debug('SYSTEM', 'Shutdown request to wedged worker failed', {},
      error instanceof Error ? error : new Error(String(error)));
  }
  let freed = await waitForPortFree(port, getBootWindowMs());
  if (!freed && info && isProcessAlive(info.pid)) {
    logger.warn('SYSTEM', 'Wedged worker did not exit on request — killing it directly', { pid: info.pid });
    try {
      process.kill(info.pid, 'SIGKILL');
    } catch {
      // Already gone, or not ours to kill — the spawn path's ephemeral-port
      // fallback is the final safety net.
    }
    freed = await waitForPortFree(port, getPlatformTimeout(HOOK_TIMEOUTS.PORT_IN_USE_WAIT));
  }
  if (!freed) {
    logger.warn('SYSTEM', 'Wedged worker port still not free — the spawn will fall back to an ephemeral port');
  }
  removePidFile();
}

/**
 * S7 — end a worker the launcher has decided to replace.
 *
 * Only a PROVEN worker is killed (`isProvenWorkerProcess`, which fails safe to
 * FALSE): on Windows the recorded PID may have been recycled by an unrelated
 * program, and that possibility is exactly why the stale-PID branch exists.
 * When the proof is missing the process is left alone and merely forgotten, as
 * before — S8's idle shutdown then reaps it.
 *
 * Asked to stop first, killed second. A graceful stop lets it close the SQLite
 * handle rather than leaving a WAL for the successor to recover.
 */
function terminateReplacedWorker(info: ReturnType<typeof readPidFile>): void {
  if (!info) return;
  const pid = info.pid;
  if (!isProvenWorkerProcess(info)) {
    logger.info('SYSTEM', 'Replaced worker left running — its identity could not be proven, so it is not ours to kill', { pid });
    return;
  }

  logger.warn('SYSTEM', 'Ending the worker being replaced so it cannot become an orphan', { pid });
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone between the proof and the signal — nothing to do.
    return;
  }
  // A short grace period, then insist. Deliberately not awaited: this runs on
  // the hook's critical path, and an orphan that dies half a second later is
  // still not an orphan.
  setTimeout(() => {
    try {
      if (isProcessAlive(pid)) {
        logger.warn('SYSTEM', 'Replaced worker ignored SIGTERM — killing it', { pid });
        process.kill(pid, 'SIGKILL');
      }
    } catch {
      // Gone in the meantime.
    }
  }, REPLACED_WORKER_GRACE_MS).unref?.();
}

export async function ensureWorkerStarted(
  port: number,
  workerScriptPath: string
): Promise<WorkerStartResult> {
  if (!workerScriptPath) {
    logger.error('SYSTEM', 'ensureWorkerStarted called with empty workerScriptPath — caller bug');
    return 'dead';
  }
  if (!existsSync(workerScriptPath)) {
    logger.error(
      'SYSTEM',
      'ensureWorkerStarted: worker script not found at expected path — likely a partial install or build artifact missing',
      { workerScriptPath }
    );
    return 'dead';
  }

  // Fast path (perf plan P3): if a worker already answers on the port, it is
  // alive and serving — return immediately and SKIP the PID-file ownership check
  // below. On Windows that check shells out to PowerShell CIM (~250ms) to detect
  // PID reuse, and it runs on EVERY hook (each hook is a fresh process, so the
  // per-pid CIM cache never helps). A healthy port makes it entirely redundant.
  // Only when the port is silent do we fall through to the (rarer, already-slow)
  // stale-PID / respawn path, where the ownership check is worth its cost.
  if (await waitForHealth(port, 1000)) {
    const ready = await waitForReadiness(port, getPlatformTimeout(HOOK_TIMEOUTS.READINESS_WAIT));
    if (ready) {
      // DEBUG: the healthy fast path is the normal case and ran ~4k times/day.
      logger.debug('SYSTEM', 'Worker already running and healthy (fast path)');
      return 'ready';
    }
    // S1: a process answers the port but never reached readiness within the
    // full cold-boot budget. That is a WEDGED worker — e.g. background DB init
    // failed (or hung) and was never retried — and it is self-perpetuating: a
    // healthy worker can never take the port while the wedged one holds it, so
    // every hook returned 'warming' and "proceeded anyway" indefinitely (28h in
    // the field). Tear it down and fall through to (re)spawn a healthy one.
    logger.warn('SYSTEM', 'Worker answers the port but never became ready within the boot budget — treating it as wedged and replacing it');
    await replaceWedgedWorker(port);
    // fall through to the spawn path below.
  }

  const pidFileStatus = cleanStalePidFile();
  // Read BEFORE the branch below removes the file — S7 needs the pid and the
  // start token to prove the process is ours before ending it.
  const pidInfoBeforeRespawn = pidFileStatus === 'alive' ? readPidFile() : null;
  if (pidFileStatus === 'alive') {
    // A live PID means one of two things: (a) our worker is still cold-booting
    // (embedder + DB init, ~6-8s), or (b) the recorded PID was REUSED by an
    // unrelated process after our worker died — common on Windows, where PID
    // reuse combined with the fail-safe-to-"alive" ownership check
    // (process-registry.ts verifyPidFileOwnership returns true when no start
    // token is stored or the CIM lookup fails) makes a dead worker look alive.
    // In case (b) the port will NEVER come up. The old code waited only 3s and
    // then returned 'warming' WITHOUT ever re-spawning, so startup deadlocked
    // permanently — the reported "PID file live, no response on port, `start`
    // doesn't help" symptom. Wait the full cold-boot budget; if the port still
    // isn't healthy, treat the PID as stale/reused, clear it, and fall through
    // to (re)spawn below. A genuinely slow booter is protected by the daemon's
    // own health-probe duplicate guard, which makes the loser exit 0.
    logger.info('SYSTEM', 'Worker PID file points to a live process, waiting for it to become healthy');
    const healthy = await waitForHealth(port, getBootWindowMs());
    if (healthy) {
      const ready = await waitForReadiness(port, getPlatformTimeout(HOOK_TIMEOUTS.READINESS_WAIT));
      logger.info('SYSTEM', 'Worker became healthy while waiting on live PID');
      return ready ? 'ready' : 'warming';
    }
    logger.warn('SYSTEM', 'PID file marked live but worker never became healthy within the cold-boot window — treating it as a stale/reused PID and re-spawning');
    // S7: a replaced worker is ENDED, not merely forgotten. `removePidFile()`
    // alone is how an orphan is made: the process finishes its cold boot
    // moments later, finds the configured port taken by its replacement, falls
    // back to an ephemeral port, and then runs until the machine reboots
    // because nothing references it any more. Measured 29.08.2026 — three
    // worker-service processes, two of them unreferenced, one alive for 4h14m
    // at 860s CPU, ~660 MB between them, and every one of them holding
    // keepmind.db open. That contention is the `database is locked` that
    // wedged the worker for 28 hours on 27.08.
    terminateReplacedWorker(pidInfoBeforeRespawn);
    removePidFile();
    // fall through to the spawn path below
  }

  // NOTE: the healthy-worker fast path is handled at the top of this function
  // (before cleanStalePidFile) so the common case skips the Windows CIM lookup.
  // By here the port is known-silent, so we go straight to the spawn path.

  const portInUse = await isPortInUse(port);
  if (portInUse) {
    logger.info('SYSTEM', 'Port in use, waiting for worker to become healthy');
    const healthy = await waitForHealth(port, getPlatformTimeout(HOOK_TIMEOUTS.PORT_IN_USE_WAIT));
    if (healthy) {
      const ready = await waitForReadiness(port, getPlatformTimeout(HOOK_TIMEOUTS.READINESS_WAIT));
      logger.info('SYSTEM', 'Worker is now healthy');
      return ready ? 'ready' : 'warming';
    }
    logger.warn('SYSTEM', 'Configured port in use but no healthy worker — spawning anyway (worker will pick a free ephemeral port)');
    // Fall through to spawn: with ephemeral-port fallback the daemon routes
    // around whatever holds the configured port instead of deadlocking on it.
  }

  // Spawn gate (src/shared/worker-spawn-gate.ts): only ONE gated launcher —
  // hook, MCP server, or the CLI restart fallback — may spawn at a time. (The
  // dying worker's restart handoff in worker-shutdown.ts is deliberately NOT
  // gated: it is the primary spawner on restart, and hooks wait for its
  // successor.) Losing the lock never fails this path; the loser skips its
  // spawn and falls through to the SAME wait-for-health/readiness logic
  // (someone else is spawning — wait for their worker). The winner holds the
  // lock through the post-spawn health wait (the spawn isn't "done" until the
  // worker owns the port) and releases in finally on every exit path.
  const spawnLockHeld = acquireSpawnLock();
  let resolvedPort = port;
  try {
    if (spawnLockHeld) {
      // Under the lock so only one repair runs at a time. A worker spawned
      // without node_modules dies on its first require; repairing here turns a
      // silent permanent outage into a one-off delay.
      if (!ensurePluginDependencies(workerScriptPath)) {
        return 'dead';
      }
      logger.info('SYSTEM', 'Starting worker daemon', { workerScriptPath });
      const pid = spawnDaemon(workerScriptPath, port);
      if (pid === undefined) {
        logger.error('SYSTEM', 'Failed to spawn worker daemon');
        return 'dead';
      }
    } else {
      logger.info('SYSTEM', 'Another launcher holds the spawn lock — skipping duplicate spawn and waiting for its worker');
    }

    // Re-resolve the worker's actual port each poll: an ephemeral-fallback
    // worker (configured port squatted) answers on a different port than the
    // one we asked it to try.
    const livePort = await waitForSpawnedWorker(port, getBootWindowMs());
    if (livePort === null) {
      logger.warn('SYSTEM', spawnLockHeld
        ? 'Worker spawned but health endpoint not responding within window — likely still starting in background'
        : 'Spawn-lock holder\'s worker not healthy within window — likely still starting in background');
      return 'warming';
    }
    resolvedPort = livePort;
  } finally {
    if (spawnLockHeld) releaseSpawnLock();
  }

  const ready = await waitForReadiness(resolvedPort, getPlatformTimeout(HOOK_TIMEOUTS.READINESS_WAIT));
  if (!ready) {
    logger.warn('SYSTEM', 'Worker is alive but readiness timed out — proceeding anyway');
  }

  // touchPidFile is existsSync-guarded and merely refreshes the live worker's
  // pid-file mtime — correct for lock losers too, since the worker IS up.
  touchPidFile();
  logger.info('SYSTEM', spawnLockHeld
    ? 'Worker started successfully'
    : 'Worker is up (started by another launcher)');
  return ready ? 'ready' : 'warming';
}
