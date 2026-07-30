// SPDX-License-Identifier: Apache-2.0
//
// The tree-sitter CLI executable, acquired on demand.
//
// keepmind folds files by shelling out to `tree-sitter query`, so this binary is
// not optional and its absence is not partial: without it EVERY language yields
// zero symbols, not just the ones whose grammar is missing. That is what made
// the 3.2.0 regression read as "unsupported language" on .cs, .ps1 AND .js alike
// — javascript's grammar was present the whole time.
//
// The binary does not arrive with the package. `tree-sitter-cli` ships JS only
// and downloads its Rust executable from a GitHub release in its `install`
// script. Every keepmind install path passes --ignore-scripts, deliberately: a
// nested tree-sitter-cli postinstall once hung `npx keepmind install`. The
// manifest's `trustedDependencies` cannot override an explicit CLI flag, so the
// shipped dependency tree contains cli.js and no executable.
//
// Hence the download happens here instead — deliberately, once, and off the
// parse path. It invokes the vendored install.js rather than reimplementing the
// platform matrix and release URLs, so proxy handling and asset naming stay
// upstream's problem. install.js writes the executable into its CWD (not its
// __dirname), which is why cwd is pinned to the package directory. That package
// lives in the plugin DATA directory, which survives the host restoring the
// plugin root from git.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { DATA_DIR } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import { pluginResolve } from '../../shared/plugin-node-modules.js';

const IS_WINDOWS = process.platform === 'win32';
const STATE_PATH = join(DATA_DIR, '.treesitter-cli-state.json');
const INSTALL_TIMEOUT_MS = 3 * 60 * 1000;

// Retry a failed download occasionally — the usual cause is transient (offline,
// proxy, rate limit) — but not on every parse, which would spawn a process per
// file.
const FAILURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** The platform's executable name. Windows needs the .exe suffix; omitting it
 *  meant the existsSync probe missed a binary that was actually there. */
export function treeSitterExecutableName(): string {
  return IS_WINDOWS ? 'tree-sitter.exe' : 'tree-sitter';
}

export type TreeSitterBin =
  /** An executable we can run. */
  | { status: 'ok'; path: string }
  /** tree-sitter-cli is installed but its executable was never downloaded. */
  | { status: 'no-executable'; packageDir: string }
  /** The package itself is absent — the dependency tree is broken or unbuilt. */
  | { status: 'no-package' };

function readLastFailure(): number | null {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as { lastFailure?: unknown };
    return typeof raw?.lastFailure === 'number' ? raw.lastFailure : null;
  } catch {
    return null;
  }
}

function recordFailure(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify({ lastFailure: Date.now() }));
  } catch {
    // The cooldown is an optimisation; losing it costs a retry, not correctness.
  }
}

function clearFailure(): void {
  try {
    if (existsSync(STATE_PATH)) writeFileSync(STATE_PATH, JSON.stringify({}));
  } catch {
    // Same.
  }
}

function inCooldown(now: number = Date.now()): boolean {
  const last = readLastFailure();
  return last !== null && now - last < FAILURE_COOLDOWN_MS;
}

/** Locate the tree-sitter-cli package directory, or null when it is absent. */
function findPackageDir(): string | null {
  try {
    return dirname(pluginResolve('tree-sitter-cli/package.json'));
  } catch {
    return null;
  }
}

// A PATH lookup costs a process spawn, and PATH does not change under us — so it
// is probed at most once per process. The package-directory probe is two
// existsSync calls and stays uncached, so an install that finishes mid-process
// is picked up by the next parse instead of being masked until restart.
let pathProbe: string | null | undefined;

function findOnPath(): string | null {
  if (pathProbe !== undefined) return pathProbe;
  try {
    const probe = IS_WINDOWS
      ? spawnSync('tree-sitter --version', { shell: true, stdio: 'ignore', timeout: 3000, windowsHide: true })
      : spawnSync('tree-sitter', ['--version'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
    pathProbe = probe.status === 0 ? 'tree-sitter' : null;
  } catch {
    pathProbe = null;
  }
  return pathProbe;
}

/**
 * Resolve a runnable tree-sitter executable.
 *
 * Unlike the previous getTreeSitterBin(), this never falls back to the bare
 * string "tree-sitter" when nothing is installed. That fallback is precisely
 * what turned a missing binary into an ENOENT swallowed at debug level, and
 * from there into "unsupported language" for every file in the repo.
 */
export function resolveTreeSitterBin(): TreeSitterBin {
  const packageDir = findPackageDir();
  if (packageDir) {
    const candidate = join(packageDir, treeSitterExecutableName());
    if (existsSync(candidate)) return { status: 'ok', path: candidate };
  }

  const onPath = findOnPath();
  if (onPath) return { status: 'ok', path: onPath };

  return packageDir ? { status: 'no-executable', packageDir } : { status: 'no-package' };
}

export interface TreeSitterCliInstallDeps {
  /** Run the downloader. Injectable so tests never touch the network. */
  runInstall?: (packageDir: string, done: (error: Error | null) => void) => void;
}

// One attempt per process: a burst of 2000 files must trigger one download, not
// 2000.
let attemptedThisProcess = false;

/**
 * Download the executable in the background, at most once per process and not
 * while a recent failure is still in cooldown. Returns true when a download was
 * actually started — the binary is NOT available when this returns.
 *
 * Fire-and-forget by design: a parse never waits on a network fetch. The
 * triggering file folds without symbols and the next one has a parser.
 */
export function requestTreeSitterCliInstall(deps: TreeSitterCliInstallDeps = {}): boolean {
  // Opt-out for air-gapped machines and CI, mirroring the grammar installer's
  // flag. Checked before the once-per-process guard so lifting it mid-process
  // still works — an opted-out call must not consume the single attempt.
  if (process.env.KEEPMIND_PARSER_AUTOINSTALL === '0') return false;

  if (attemptedThisProcess) return false;
  attemptedThisProcess = true;

  if (inCooldown()) {
    logger.debug('PARSER', 'tree-sitter CLI download skipped (recent failure still in cooldown)');
    return false;
  }

  const packageDir = findPackageDir();
  if (!packageDir) {
    logger.warn('PARSER', 'Cannot fetch the tree-sitter CLI: the tree-sitter-cli package is not installed. Run `npx keepmind install` to repair the dependency tree.');
    recordFailure();
    return false;
  }

  const installScript = join(packageDir, 'install.js');
  if (!existsSync(installScript)) {
    logger.warn('PARSER', 'Cannot fetch the tree-sitter CLI: its downloader is missing', { installScript });
    recordFailure();
    return false;
  }

  logger.info('PARSER', 'Downloading the tree-sitter CLI executable (one time; structural search is inert until it lands)', { packageDir });

  // install.js writes the executable relative to CWD, so cwd MUST be the
  // package directory — running it from anywhere else drops the binary where
  // resolveTreeSitterBin will never look.
  const runInstall = deps.runInstall ?? ((cwd, done) => {
    execFile(
      process.execPath,
      [installScript],
      { cwd, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error) => done(error),
    );
  });

  runInstall(packageDir, (error) => {
    if (error) {
      logger.warn('PARSER', 'tree-sitter CLI download failed; structural search stays unavailable', {
        error: error.message,
      }, error);
      recordFailure();
      return;
    }
    // install.js exits 0 on some failure paths after writing a truncated file,
    // so trust the probe rather than the exit code.
    const resolved = resolveTreeSitterBin();
    if (resolved.status !== 'ok') {
      logger.warn('PARSER', 'tree-sitter CLI downloader reported success but no executable is present', {
        expected: join(packageDir, treeSitterExecutableName()),
      });
      recordFailure();
      return;
    }
    clearFailure();
    logger.info('PARSER', 'tree-sitter CLI ready; structural search is available', { path: resolved.path });
  });

  return true;
}

/** Test hook: forget this process's attempt and cached probes. */
export function resetTreeSitterCliForTesting(): void {
  attemptedThisProcess = false;
  pathProbe = undefined;
}
