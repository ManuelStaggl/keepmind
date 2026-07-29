// SPDX-License-Identifier: Apache-2.0
//
// On-demand tree-sitter grammars.
//
// Shipping every supported grammar up front cost ~380 MB of node_modules that a
// given machine almost never uses: one measured install carried swift (73 MB),
// scala (52), cpp (49), haskell (46), ruby (30), php (29) and a dozen more
// against a repo with zero files in any of them — while the three languages that
// repo was actually written in were absent entirely.
//
// So the plugin ships a small core (see CORE_LANGUAGES in parser.ts) and
// everything else is fetched the first time a file of that language is seen.
//
// Grammars land in ~/.keepmind/grammars, NOT in the plugin directory. The plugin
// is installed with `bun install --frozen-lockfile` for a deterministic
// dependency closure; adding packages there at runtime would invalidate that
// lockfile and make the next install fail. A separate directory keeps the two
// concerns from colliding.
//
// The install is fire-and-forget. A parse never waits on a network fetch — the
// triggering file is folded without symbols (exactly as an unsupported language
// is today) and the grammar is there for the next one. Being slightly late is
// acceptable; blocking a hook for a `bun add` is not.

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { exec, spawnSync } from 'node:child_process';
import { DATA_DIR } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';

const IS_WINDOWS = process.platform === 'win32';
const GRAMMARS_DIR = join(DATA_DIR, 'grammars');
const STATE_PATH = join(GRAMMARS_DIR, '.install-state.json');
const INSTALL_TIMEOUT_MS = 3 * 60 * 1000;

// Retry a failed fetch occasionally — the usual cause is transient (offline,
// proxy) — but not on every parse, which would spawn a process per file.
const FAILURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;

interface InstallState {
  /** language → epoch ms of the last failed attempt. */
  failures: Record<string, number>;
}

// Per-process guard: one attempt per language per worker lifetime, so a burst of
// 2000 files in the same language triggers one install, not 2000.
const attemptedThisProcess = new Set<string>();

function readState(): InstallState {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as Partial<InstallState>;
    return { failures: raw?.failures && typeof raw.failures === 'object' ? raw.failures : {} };
  } catch {
    return { failures: {} };
  }
}

function recordFailure(language: string): void {
  try {
    mkdirSync(GRAMMARS_DIR, { recursive: true });
    const state = readState();
    state.failures[language] = Date.now();
    writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {
    // The cooldown is an optimisation; losing it costs a retry, not correctness.
  }
}

function clearFailure(language: string): void {
  try {
    const state = readState();
    if (state.failures[language] === undefined) return;
    delete state.failures[language];
    writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {
    // Same.
  }
}

function inCooldown(language: string, now: number = Date.now()): boolean {
  const last = readState().failures[language];
  return typeof last === 'number' && now - last < FAILURE_COOLDOWN_MS;
}

/** Locate a usable Bun, or null when none is installed. */
function findBun(): string | null {
  const candidates = IS_WINDOWS
    ? [join(homedir(), '.bun', 'bin', 'bun.exe')]
    : [join(homedir(), '.bun', 'bin', 'bun'), '/usr/local/bin/bun', '/opt/homebrew/bin/bun'];
  const onDisk = candidates.find(existsSync);
  if (onDisk) return onDisk;
  try {
    const probe = IS_WINDOWS
      ? spawnSync('bun --version', { shell: true, stdio: 'ignore', timeout: 3000, windowsHide: true })
      : spawnSync('bun', ['--version'], { stdio: 'ignore', timeout: 3000, windowsHide: true });
    if (probe.status === 0) return 'bun';
  } catch {
    // fall through
  }
  return null;
}

let grammarRequire: NodeJS.Require | null = null;

function getGrammarRequire(): NodeJS.Require {
  // createRequire needs a file path inside the directory whose node_modules we
  // want to resolve against; the file itself need not exist.
  return (grammarRequire ??= createRequire(join(GRAMMARS_DIR, 'noop.js')));
}

/**
 * Resolve a package from the on-demand grammar directory, or null when it has
 * not been fetched (yet).
 */
export function resolveOnDemandGrammar(pkg: string, subdir?: string): string | null {
  try {
    const packageJsonPath = getGrammarRequire().resolve(pkg + '/package.json');
    const root = dirname(packageJsonPath);
    const dir = subdir ? join(root, subdir) : root;
    return existsSync(join(dir, 'src')) ? dir : null;
  } catch {
    return null;
  }
}

function ensureGrammarWorkspace(): void {
  mkdirSync(GRAMMARS_DIR, { recursive: true });
  const pkgPath = join(GRAMMARS_DIR, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify({
      name: 'keepmind-grammars',
      private: true,
      description: 'Tree-sitter grammars keepmind fetched on demand. Safe to delete; it will refetch.',
      version: '0.0.0',
    }, null, 2));
  }
}

/**
 * Fetch `pkg` for `language` in the background, at most once per process and
 * not while a recent failure is still in cooldown. Returns true when an install
 * was actually started — the grammar is NOT available when this returns.
 */
export function requestGrammarInstall(language: string, pkg: string, version?: string): boolean {
  // Opt-out for air-gapped machines and CI, where spawning a package install
  // from a parse is unwanted regardless of how cheap it is.
  if (process.env.KEEPMIND_GRAMMAR_AUTOINSTALL === '0') return false;

  if (attemptedThisProcess.has(language)) return false;
  attemptedThisProcess.add(language);

  if (inCooldown(language)) {
    logger.debug('PARSER', 'Grammar install skipped (recent failure still in cooldown)', { language });
    return false;
  }

  const bun = findBun();
  if (!bun) {
    logger.warn('PARSER', 'Cannot fetch grammar on demand: Bun is not installed', { language, package: pkg });
    recordFailure(language);
    return false;
  }

  try {
    ensureGrammarWorkspace();
  } catch (error) {
    logger.warn('PARSER', 'Could not prepare the on-demand grammar directory', {
      language,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  const bunCmd = IS_WINDOWS && bun.includes(' ') ? `"${bun}"` : bun;
  const spec = version ? `${pkg}@${version}` : pkg;
  logger.info('PARSER', 'Fetching tree-sitter grammar on demand', { language, package: spec });

  // --ignore-scripts: grammars ship prebuilt binaries, and running untrusted
  // postinstalls to parse a source file would be a poor trade.
  exec(
    `${bunCmd} add ${spec} --ignore-scripts`,
    {
      cwd: GRAMMARS_DIR,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      ...(IS_WINDOWS ? { shell: process.env.ComSpec ?? 'cmd.exe' } : {}),
    },
    (error) => {
      if (error) {
        logger.warn('PARSER', 'On-demand grammar install failed; that language stays unfolded', {
          language,
          package: spec,
          error: error.message,
        });
        recordFailure(language);
        return;
      }
      clearFailure(language);
      logger.info('PARSER', 'Grammar installed', { language, package: spec });
    },
  );
  return true;
}

/** Test hook: forget which languages were attempted in this process. */
export function resetGrammarInstallerForTesting(): void {
  attemptedThisProcess.clear();
  grammarRequire = null;
}

export const GRAMMARS_DIR_FOR_TESTING = GRAMMARS_DIR;
