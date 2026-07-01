import { join, dirname, basename, sep } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { SettingsDefaultsManager } from './SettingsDefaultsManager.js';
import { logger } from '../utils/logger.js';

function getDirname(): string {
  if (typeof __dirname !== 'undefined') {
    return __dirname;
  }
  return dirname(fileURLToPath(import.meta.url));
}

const _dirname = getDirname();

export function resolveDataDir(): string {
  // Canonical KEEPMIND_DATA_DIR, with CLAUDE_MEM_DATA_DIR honored as fallback.
  const envDataDir = process.env.KEEPMIND_DATA_DIR ?? process.env.CLAUDE_MEM_DATA_DIR;
  if (envDataDir) {
    return envDataDir;
  }

  const defaultDataDir = join(homedir(), '.keepmind');
  const settingsPath = join(defaultDataDir, 'settings.json');
  try {
    if (existsSync(settingsPath)) {
      const raw = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const settings = raw.env ?? raw;
      const settingsDataDir = settings.KEEPMIND_DATA_DIR ?? settings.CLAUDE_MEM_DATA_DIR;
      if (settingsDataDir) {
        return settingsDataDir;
      }
    }
  } catch {
    // settings file missing or corrupt — fall through to default
  }

  return defaultDataDir;
}

export const DATA_DIR = resolveDataDir();
export const CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

export const MARKETPLACE_ROOT = join(CLAUDE_CONFIG_DIR, 'plugins', 'marketplaces', 'keepmind');

export const ARCHIVES_DIR = join(DATA_DIR, 'archives');
export const LOGS_DIR = join(DATA_DIR, 'logs');
export const TRASH_DIR = join(DATA_DIR, 'trash');
export const BACKUPS_DIR = join(DATA_DIR, 'backups');
export const MODES_DIR = join(DATA_DIR, 'modes');
export const USER_SETTINGS_PATH = join(DATA_DIR, 'settings.json');
export const DB_PATH = join(DATA_DIR, 'keepmind.db');
// Historical DB filename, kept for the one-time startup rename below.
export const LEGACY_DB_PATH = join(DATA_DIR, 'claude-mem.db');
export const VECTOR_DB_DIR = join(DATA_DIR, 'vector-db');

export const OBSERVER_SESSIONS_DIR = join(DATA_DIR, 'observer-sessions');

export const OBSERVER_SESSIONS_PROJECT = basename(OBSERVER_SESSIONS_DIR);

export const CLAUDE_SETTINGS_PATH = join(CLAUDE_CONFIG_DIR, 'settings.json');
export const CLAUDE_COMMANDS_DIR = join(CLAUDE_CONFIG_DIR, 'commands');
export const CLAUDE_MD_PATH = join(CLAUDE_CONFIG_DIR, 'CLAUDE.md');

export function getProjectArchiveDir(projectName: string): string {
  return join(ARCHIVES_DIR, projectName);
}

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

/**
 * One-time, non-destructive migration of the legacy `claude-mem.db` (plus its
 * `-wal`/`-shm` siblings) to the canonical `keepmind.db`. Idempotent: only acts
 * when the new file is absent AND the legacy file present, so it is safe to call
 * on every startup. Must run BEFORE the DB is opened (a fresh open of the new
 * path would otherwise create an empty DB and orphan the legacy data).
 *
 * On Windows the rename fails with EBUSY/EPERM if another process holds the DB
 * open — callers must invoke this from a fresh process before opening, never
 * while a worker owns the file. On failure we leave the legacy file in place and
 * let the caller open it via LEGACY_DB_PATH fallback rather than lose data.
 */
export function ensureDbFilename(): boolean {
  try {
    if (existsSync(DB_PATH) || !existsSync(LEGACY_DB_PATH)) return existsSync(DB_PATH);
    for (const suffix of ['', '-wal', '-shm']) {
      const from = LEGACY_DB_PATH + suffix;
      const to = DB_PATH + suffix;
      if (existsSync(from) && !existsSync(to)) renameSync(from, to);
    }
    logger.info('DB', 'Migrated legacy claude-mem.db to keepmind.db', { from: LEGACY_DB_PATH, to: DB_PATH });
    return true;
  } catch (err) {
    logger.warn(
      'DB',
      'Could not rename legacy claude-mem.db to keepmind.db (file may be locked) — falling back to legacy path',
      {},
      err instanceof Error ? err : new Error(String(err)),
    );
    return false;
  }
}

/**
 * The DB path to actually open: `keepmind.db` after a successful (or prior)
 * rename, otherwise the still-present legacy `claude-mem.db`. Callers that open
 * the default DB should use this instead of DB_PATH directly.
 */
export function resolveOpenDbPath(): string {
  ensureDbFilename();
  if (!existsSync(DB_PATH) && existsSync(LEGACY_DB_PATH)) return LEGACY_DB_PATH;
  return DB_PATH;
}

/**
 * DB file path for an arbitrary data directory (not the process default):
 * `keepmind.db` when present, otherwise the legacy `claude-mem.db`. Used by
 * infrastructure helpers that operate on a caller-supplied data dir.
 */
export function dbFileForDataDir(dataDir: string): string {
  const primary = join(dataDir, 'keepmind.db');
  const legacy = join(dataDir, 'claude-mem.db');
  if (!existsSync(primary) && existsSync(legacy)) return legacy;
  return primary;
}

export function ensureAllDataDirs(): void {
  ensureDir(DATA_DIR);
  ensureDir(ARCHIVES_DIR);
  ensureDir(LOGS_DIR);
  ensureDir(TRASH_DIR);
  ensureDir(BACKUPS_DIR);
  ensureDir(MODES_DIR);
}

export function ensureModesDir(): void {
  ensureDir(MODES_DIR);
}

export function ensureAllClaudeDirs(): void {
  ensureDir(CLAUDE_CONFIG_DIR);
  ensureDir(CLAUDE_COMMANDS_DIR);
}

export function getCurrentProjectName(): string {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true
    }).trim();
    return basename(dirname(gitRoot)) + '/' + basename(gitRoot);
  } catch (error: unknown) {
    logger.debug('SYSTEM', 'Git root detection failed, using cwd basename', {
      cwd: process.cwd()
    }, error instanceof Error ? error : new Error(String(error)));
    const cwd = process.cwd();
    return basename(dirname(cwd)) + '/' + basename(cwd);
  }
}

export function getPackageRoot(): string {
  return join(_dirname, '..');
}

export function getPackageCommandsDir(): string {
  const packageRoot = getPackageRoot();
  return join(packageRoot, 'commands');
}

export const paths = {
  dataDir: () => DATA_DIR,
  workerPid: () => join(DATA_DIR, 'worker.pid'),
  // Ephemeral-port publication: the running worker writes its ACTUAL bound
  // port here after listen() so clients route to it even when the configured
  // port was taken and the worker fell back to an OS-assigned free port. This
  // eliminates the fixed-port orphaned-socket deadlock class.
  workerPort: () => join(DATA_DIR, 'worker.port'),
  // Phase 1b: identifier renamed to `server*`; the on-disk file basenames
  // remain `.server-beta.*` so existing installations keep finding their
  // pid/port/runtime state. Plan §1d will migrate the basenames.
  serverPid: () => join(DATA_DIR, '.server-beta.pid'),
  serverPort: () => join(DATA_DIR, '.server-beta.port'),
  serverRuntime: () => join(DATA_DIR, '.server-beta.runtime.json'),
  settings: () => join(DATA_DIR, 'settings.json'),
  database: () => resolveOpenDbPath(),
  chroma: () => join(DATA_DIR, 'chroma'),
  combinedCerts: () => join(DATA_DIR, 'combined_certs.pem'),
  transcriptsConfig: () => join(DATA_DIR, 'transcript-watch.json'),
  transcriptsState: () => join(DATA_DIR, 'transcript-watch-state.json'),
  corpora: () => join(DATA_DIR, 'corpora'),
  supervisorRegistry: () => join(DATA_DIR, 'supervisor.json'),
  envFile: () => join(DATA_DIR, '.env'),
  logsDir: () => LOGS_DIR,
  archives: () => ARCHIVES_DIR,
  trash: () => TRASH_DIR,
  backups: () => BACKUPS_DIR,
  modes: () => MODES_DIR,
  vectorDb: () => VECTOR_DB_DIR,
  observerSessions: () => OBSERVER_SESSIONS_DIR,
} as const;
