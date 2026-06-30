
import { existsSync } from 'fs';
import { logger } from '../utils/logger.js';
import { HOOK_TIMEOUTS } from '../shared/hook-constants.js';
import {
  cleanStalePidFile,
  getPlatformTimeout,
  spawnDaemon,
  touchPidFile,
  readPidFile,
  isProcessAlive,
} from './infrastructure/ProcessManager.js';
import {
  isPortInUse,
  waitForHealth,
  waitForReadiness,
} from './infrastructure/HealthMonitor.js';
import { acquireSpawnLock, releaseSpawnLock } from '../shared/worker-spawn-gate.js';

export type WorkerStartResult = 'ready' | 'warming' | 'dead';

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

  const pidFileStatus = cleanStalePidFile();
  if (pidFileStatus === 'alive') {
    logger.info('SYSTEM', 'Worker PID file points to a live process, skipping duplicate spawn');
    const healthy = await waitForHealth(port, getPlatformTimeout(HOOK_TIMEOUTS.PORT_IN_USE_WAIT));
    if (healthy) {
      const ready = await waitForReadiness(port, getPlatformTimeout(HOOK_TIMEOUTS.READINESS_WAIT));
      logger.info('SYSTEM', 'Worker became healthy while waiting on live PID');
      return ready ? 'ready' : 'warming';
    }
    logger.warn('SYSTEM', 'Live PID detected but worker did not become healthy before timeout — likely still starting');
    return 'warming';
  }

  if (await waitForHealth(port, 1000)) {
    const ready = await waitForReadiness(port, getPlatformTimeout(HOOK_TIMEOUTS.READINESS_WAIT));
    if (!ready) {
      logger.warn('SYSTEM', 'Worker is alive but readiness timed out — proceeding anyway');
    }
    logger.info('SYSTEM', 'Worker already running and healthy');
    return ready ? 'ready' : 'warming';
  }

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
    const livePort = await waitForSpawnedWorker(port, getPlatformTimeout(HOOK_TIMEOUTS.POST_SPAWN_WAIT));
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
