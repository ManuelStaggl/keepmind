
import path from 'path';
import { homedir } from 'os';
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, rmSync, statSync, utimesSync } from 'fs';
import { execSync } from 'child_process';
import { spawnHidden } from '../../shared/spawn.js';
import { logger } from '../../utils/logger.js';
import { toError } from '../../utils/to-error.js';
import { sanitizeEnv } from '../../supervisor/env-sanitizer.js';
import { getSupervisor, validateWorkerPidFile, type ValidateWorkerPidStatus } from '../../supervisor/index.js';
import { paths } from '../../shared/paths.js';

const DATA_DIR = paths.dataDir();
const PID_FILE = paths.workerPid();
const PORT_FILE = paths.workerPort();

/**
 * Publish the worker's ACTUAL bound port (ephemeral-fallback aware) as a plain
 * mirror file. The PID file is the authoritative client source (it carries the
 * pid for a liveness check); this mirror exists for simple/external readers.
 */
export function writeWorkerPortFile(port: number): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(PORT_FILE, String(port));
  } catch (error: unknown) {
    logger.debug('SYSTEM', 'Failed to write worker port file', { path: PORT_FILE }, toError(error));
  }
}

export function removeWorkerPortFile(): void {
  try {
    if (existsSync(PORT_FILE)) unlinkSync(PORT_FILE);
  } catch (error: unknown) {
    logger.debug('SYSTEM', 'Failed to remove worker port file', { path: PORT_FILE }, toError(error));
  }
}

interface RuntimeResolverOptions {
  platform?: NodeJS.Platform;
  execPath?: string;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  pathExists?: (candidatePath: string) => boolean;
  lookupInPath?: (binaryName: string, platform: NodeJS.Platform) => string | null;
}

function isNodeExecutablePath(executablePath: string | undefined | null): boolean {
  if (!executablePath) return false;

  return /(^|[\\/])node(\.exe)?$/i.test(executablePath.trim());
}

function lookupBinaryInPath(binaryName: string, platform: NodeJS.Platform): string | null {
  const command = platform === 'win32' ? `where ${binaryName}` : `which ${binaryName}`;

  let output: string;
  try {
    output = execSync(command, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf-8',
      windowsHide: true
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.debug('SYSTEM', `Binary lookup failed for ${binaryName}`, { command }, error);
    } else {
      logger.debug('SYSTEM', `Binary lookup failed for ${binaryName}`, { command }, new Error(String(error)));
    }
    return null;
  }

  const firstMatch = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0);

  return firstMatch || null;
}

let cachedWorkerRuntimePath: string | undefined = undefined;

export function resolveWorkerRuntimePath(options: RuntimeResolverOptions = {}): string | null {
  const isMemoizable = Object.keys(options).length === 0;
  if (isMemoizable && cachedWorkerRuntimePath !== undefined) {
    return cachedWorkerRuntimePath;
  }

  const result = resolveWorkerRuntimePathUncached(options);

  if (isMemoizable && result !== null) {
    cachedWorkerRuntimePath = result;
  }
  return result;
}

function resolveWorkerRuntimePathUncached(options: RuntimeResolverOptions): string | null {
  const platform = options.platform ?? process.platform;
  const execPath = options.execPath ?? process.execPath;

  // The daemon runs the worker bundle (worker-service.cjs) under Node. When this
  // resolver runs, the current process is itself Node, so process.execPath is the
  // exact Node binary we want to re-launch the worker with.
  if (isNodeExecutablePath(execPath)) {
    return execPath;
  }

  const env = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? homedir();
  const pathExists = options.pathExists ?? existsSync;
  const lookupInPath = options.lookupInPath ?? lookupBinaryInPath;

  const candidatePaths: (string | undefined)[] = platform === 'win32'
    ? [
        env.NODE,
        path.join(homeDirectory, '.nvm', 'current', 'bin', 'node.exe'),
        'node',
      ]
    : [
        env.NODE,
        '/usr/local/bin/node',
        '/opt/homebrew/bin/node',
        '/usr/bin/node',
        'node',
      ];

  for (const candidate of candidatePaths) {
    const normalized = candidate?.trim();
    if (!normalized) continue;

    if (isNodeExecutablePath(normalized) && pathExists(normalized)) {
      return normalized;
    }

    if (normalized.toLowerCase() === 'node') {
      return normalized;
    }
  }

  return lookupInPath('node', platform);
}

import {
  captureProcessStartToken,
  verifyPidFileOwnership,
  type PidInfo
} from '../../supervisor/process-registry.js';
export { captureProcessStartToken, verifyPidFileOwnership, type PidInfo };

export function writePidFile(info: PidInfo): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const resolvedToken = info.startToken ?? captureProcessStartToken(info.pid);
  const payload: PidInfo = resolvedToken ? { ...info, startToken: resolvedToken } : info;
  writeFileSync(PID_FILE, JSON.stringify(payload, null, 2));
}

export function readPidFile(): PidInfo | null {
  if (!existsSync(PID_FILE)) return null;

  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf-8'));
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.warn('SYSTEM', 'Failed to parse PID file', { path: PID_FILE }, error);
    } else {
      logger.warn('SYSTEM', 'Failed to parse PID file', { path: PID_FILE }, new Error(String(error)));
    }
    return null;
  }
}

export function removePidFile(): void {
  if (!existsSync(PID_FILE)) return;

  try {
    unlinkSync(PID_FILE);
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.warn('SYSTEM', 'Failed to remove PID file', { path: PID_FILE }, error);
    } else {
      logger.warn('SYSTEM', 'Failed to remove PID file', { path: PID_FILE }, new Error(String(error)));
    }
  }
}

/**
 * Owner-or-dead guarded PID-file removal (Phase 5, worker-restart plan).
 *
 * Deletes the PID file only when the recorded pid is `expectedOwnerPid` (the
 * worker the caller just shut down, or the caller itself) OR is no longer
 * alive. A live, different pid means a restart successor has already written
 * its own file — blind deletion here is exactly the clobber that made
 * `status` report a healthy worker as not running.
 *
 * Malformed files split two ways. Unparseable JSON cannot prove ownership and
 * is left in place (the safe default): readPidFile() parses it to null so it
 * never gates a start, and the next worker boot overwrites or cleans it
 * (validateWorkerPidFile). Parseable JSON with a missing/invalid `pid` field
 * (e.g. `{"port":37777}`) is treated as a DEAD owner and deleted:
 * recorded.pid is undefined, so isProcessAlive() returns false and the
 * owner-or-dead guard falls through to removal. (The supervisor-side
 * removeOwnedPidFile spares pid-less files instead — that divergence is
 * intentional: this helper may delete dead leftovers, the shutdown cascade
 * only ever deletes its own file.)
 */
export function removePidFileIfOwner(expectedOwnerPid: number | null): void {
  if (!existsSync(PID_FILE)) return;

  const recorded = readPidFile();
  if (recorded === null) {
    logger.debug('SYSTEM', 'PID file unreadable — leaving it (cannot prove ownership)', {
      path: PID_FILE,
      expectedOwnerPid
    });
    return;
  }

  const ownedByStoppedWorker = expectedOwnerPid !== null && recorded.pid === expectedOwnerPid;
  if (!ownedByStoppedWorker && isProcessAlive(recorded.pid)) {
    logger.debug('SYSTEM', 'PID file belongs to a live, different worker (restart successor?) — leaving it', {
      path: PID_FILE,
      recordedPid: recorded.pid,
      expectedOwnerPid
    });
    return;
  }

  removePidFile();
}

export function getPlatformTimeout(baseMs: number): number {
  const WINDOWS_MULTIPLIER = 2.0;
  return process.platform === 'win32' ? Math.round(baseMs * WINDOWS_MULTIPLIER) : baseMs;
}

const CHROMA_MIGRATION_MARKER_FILENAME = '.chroma-cleaned-v10.3';

export function runOneTimeChromaMigration(dataDirectory?: string): void {
  const effectiveDataDir = dataDirectory ?? DATA_DIR;
  const markerPath = path.join(effectiveDataDir, CHROMA_MIGRATION_MARKER_FILENAME);
  const chromaDir = path.join(effectiveDataDir, 'chroma');

  if (existsSync(markerPath)) {
    logger.debug('SYSTEM', 'Chroma migration marker exists, skipping wipe');
    return;
  }

  logger.warn('SYSTEM', 'Running one-time chroma data wipe (upgrade from pre-v10.3)', { chromaDir });

  if (existsSync(chromaDir)) {
    rmSync(chromaDir, { recursive: true, force: true });
    logger.info('SYSTEM', 'Chroma data directory removed', { chromaDir });
  }

  mkdirSync(effectiveDataDir, { recursive: true });
  writeFileSync(markerPath, new Date().toISOString());
  logger.info('SYSTEM', 'Chroma migration marker written', { markerPath });
}

// The one-time cwd-remap migration moved to ./cwd-remap.ts so its daemon-only
// `Database` (node:sqlite) import stays off ProcessManager's graph — ProcessManager
// is on the slim hook-client's import path (perf plan P1). worker-service.ts now
// imports runOneTimeCwdRemap directly from ./cwd-remap.js.

export function spawnDaemon(
  scriptPath: string,
  port: number,
  extraEnv: Record<string, string> = {}
): number | undefined {
  getSupervisor().assertCanSpawn('worker daemon');

  const env = sanitizeEnv({
    ...process.env,
    CLAUDE_MEM_WORKER_PORT: String(port),
    ...extraEnv
  });

  const runtimePath = resolveWorkerRuntimePath();
  if (!runtimePath) {
    logger.error(
      'SYSTEM',
      'Node runtime not found — ensure node is on PATH or set the NODE env var. The worker daemon runs under Node (node:sqlite).'
    );
    return undefined;
  }

  if (process.platform === 'win32') {
    // Spawn the worker directly under Node, detached + hidden, so we get the
    // REAL child PID back (the old PowerShell Start-Process path returned a
    // hardcoded 0, leaving the process untrackable/unreapable). windowsHide
    // keeps the daemon from flashing a console window.
    try {
      const child = spawnHidden(runtimePath, [scriptPath, '--daemon'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env
      });
      if (child.pid === undefined) {
        logger.error('SYSTEM', 'Worker daemon spawn produced no PID on Windows', { runtimePath });
        return undefined;
      }
      child.unref();
      return child.pid;
    } catch (error: unknown) {
      logger.error(
        'SYSTEM',
        'Failed to spawn worker daemon on Windows',
        { runtimePath },
        toError(error)
      );
      return undefined;
    }
  }

  const setsidPath = '/usr/bin/setsid';
  const useSetsid = existsSync(setsidPath);

  const execPath = useSetsid ? setsidPath : runtimePath;
  const args = useSetsid
    ? [runtimePath, scriptPath, '--daemon']
    : [scriptPath, '--daemon'];

  const child = spawnHidden(execPath, args, {
    detached: true,
    stdio: 'ignore',
    env
  });

  if (child.pid === undefined) {
    return undefined;
  }

  child.unref();
  return child.pid;
}

export function isProcessAlive(pid: number): boolean {
  if (pid === 0) return true;

  if (!Number.isInteger(pid) || pid < 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM') return true;
      logger.debug('SYSTEM', 'Process not alive', { pid, code });
    } else {
      logger.debug('SYSTEM', 'Process not alive (non-Error thrown)', { pid }, new Error(String(error)));
    }
    return false;
  }
}

export function isPidFileRecent(thresholdMs: number = 15000): boolean {
  try {
    const stats = statSync(PID_FILE);
    // Clamp the age to ≥ 0: on Windows a freshly written file's mtime can round
    // slightly ahead of Date.now(), yielding a negative age. Left unclamped, a
    // negative age spuriously satisfies very short/negative thresholds (age < -1
    // becoming true) — a just-written or future-dated file is recent, never stale.
    const ageMs = Math.max(0, Date.now() - stats.mtimeMs);
    return ageMs < thresholdMs;
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.debug('SYSTEM', 'PID file not accessible for recency check', { path: PID_FILE }, error);
    } else {
      logger.debug('SYSTEM', 'PID file not accessible for recency check', { path: PID_FILE }, new Error(String(error)));
    }
    return false;
  }
}

export function touchPidFile(): void {
  try {
    if (!existsSync(PID_FILE)) return;
    const now = new Date();
    utimesSync(PID_FILE, now, now);
  } catch {
    // Best-effort — failure to touch doesn't affect correctness
  }
}

export function cleanStalePidFile(): ValidateWorkerPidStatus {
  return validateWorkerPidFile({ logAlive: false });
}
