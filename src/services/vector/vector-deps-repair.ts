// SPDX-License-Identifier: Apache-2.0
//
// One-time, best-effort self-repair of the native vector-search dependencies
// (sqlite-vec + @huggingface/transformers). A Claude Code plugin UPDATE refreshes
// the plugin files but does NOT run `bun install`, so right after an update the
// worker's plugin dir has no node_modules for these native packages and semantic
// search silently degrades to keyword/FTS until the user re-runs `npx keepmind
// install`. This closes that gap: when the worker boots and the deps are missing
// but Bun is available, it reinstalls them into its OWN plugin dir (exactly where
// it resolves them at runtime — which also sidesteps the cache-vs-marketplace
// install inconsistency) and then re-enables vector search, all in the background
// so it never blocks worker startup.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { exec, spawnSync } from 'node:child_process';
import { logger } from '../../utils/logger.js';
import { pluginRequire, pluginResolve } from '../../shared/plugin-node-modules.js';

const IS_WINDOWS = process.platform === 'win32';
const NATIVE_VECTOR_DEPS = ['sqlite-vec', '@huggingface/transformers'] as const;
const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;

// Per-process guard: attempt the (heavy) reinstall at most once per worker
// lifetime. A genuinely un-installable environment (no Bun, offline) then costs
// only the single cheap probe below, and a later `npx keepmind install` / worker
// restart still provides a retry.
let repairAttempted = false;

/** True only when EVERY native vector dep resolves from the plugin dependency tree. */
export function vectorDepsAvailable(): boolean {
  for (const dep of NATIVE_VECTOR_DEPS) {
    try {
      pluginResolve(dep);
    } catch {
      return false;
    }
  }
  return true;
}

export interface VectorDepsProbe {
  ok: boolean;
  /** Machine-readable cause: 'deps_missing' | 'load_failed' | 'binary_missing'. */
  reason: string;
  message: string;
}

/**
 * Verify that vector search can ACTUALLY start — resolve each native dep, load
 * sqlite-vec, and confirm the loadable binary it points at exists on disk.
 *
 * `resolve()` alone is not enough and was the reason the old preflight passed
 * while the store was broken: a package directory can resolve while its
 * per-platform binary sibling (sqlite-vec-windows-x64 and friends) is absent, so
 * the failure only surfaced later, at the first real query. This probe pays the
 * cost of the actual require once at boot to buy a truthful answer.
 */
export function probeVectorDeps(): VectorDepsProbe {
  for (const dep of NATIVE_VECTOR_DEPS) {
    try {
      pluginResolve(dep);
    } catch (error) {
      return {
        ok: false,
        reason: 'deps_missing',
        message: `${dep} is not installed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  try {
    const mod = pluginRequire<{ getLoadablePath?: () => string }>('sqlite-vec');
    if (typeof mod.getLoadablePath !== 'function') {
      return { ok: false, reason: 'load_failed', message: 'sqlite-vec loaded but exposes no getLoadablePath()' };
    }
    const loadablePath = mod.getLoadablePath();
    if (!existsSync(loadablePath)) {
      return {
        ok: false,
        reason: 'binary_missing',
        message: `sqlite-vec resolved but its platform binary is missing at ${loadablePath}`,
      };
    }
  } catch (error) {
    return {
      ok: false,
      reason: 'load_failed',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return { ok: true, reason: 'ok', message: 'vector deps available' };
}

/** Locate a usable Bun, or null when none is installed (self-repair is impossible). */
function findBun(): string | null {
  const candidates = IS_WINDOWS
    ? [path.join(homedir(), '.bun', 'bin', 'bun.exe')]
    : [path.join(homedir(), '.bun', 'bin', 'bun'), '/usr/local/bin/bun', '/opt/homebrew/bin/bun'];
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

/** The plugin dir the worker runs from — worker-service.cjs lives at <plugin>/scripts/. */
function resolvePluginDir(): string | null {
  const scriptPath = process.argv[1];
  if (!scriptPath) return null;
  const pluginDir = path.dirname(path.dirname(scriptPath));
  return existsSync(path.join(pluginDir, 'package.json')) ? pluginDir : null;
}

/**
 * If the native vector deps are missing, reinstall them once in the background.
 * `onRepaired` runs only after a successful reinstall that makes the deps
 * resolvable — the caller uses it to (re)load the vector store and warm the
 * embedder. No-op when the deps are already present, a repair was already tried,
 * Bun is unavailable, or the plugin dir can't be located.
 */
export function attemptVectorDepsSelfRepair(onRepaired: () => void): void {
  if (repairAttempted) return;
  repairAttempted = true;

  if (vectorDepsAvailable()) return;

  const pluginDir = resolvePluginDir();
  if (!pluginDir) {
    logger.warn('VEC', 'Vector deps missing but self-repair skipped: could not locate the plugin dir');
    return;
  }

  const bun = findBun();
  if (!bun) {
    logger.warn('VEC', 'Vector deps missing and Bun is not installed — semantic search stays degraded. Install Bun (winget install Oven-sh.Bun) then run `npx keepmind install`.');
    return;
  }

  const bunCmd = IS_WINDOWS && bun.includes(' ') ? `"${bun}"` : bun;
  logger.warn('VEC', 'Native vector deps missing — attempting one-time background self-repair via bun install', { pluginDir });

  // --frozen-lockfile: honor the shipped bun.lock. --ignore-scripts: skip
  // untrusted postinstalls; the native binaries (onnxruntime-node, sqlite-vec
  // platform pkg) ship prebuilt, so they resolve without running scripts — same
  // flags the npx installer uses.
  exec(
    `${bunCmd} install --frozen-lockfile --ignore-scripts`,
    {
      cwd: pluginDir,
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      ...(IS_WINDOWS ? { shell: process.env.ComSpec ?? 'cmd.exe' } : {}),
    },
    (error) => {
      if (error) {
        logger.warn('VEC', 'Vector deps self-repair failed — semantic search stays degraded; run `npx keepmind install`', {
          error: error.message,
        });
        return;
      }
      if (!vectorDepsAvailable()) {
        logger.warn('VEC', 'Vector deps self-repair ran but deps still do not resolve');
        return;
      }
      logger.info('VEC', 'Vector deps self-repair succeeded — enabling semantic search');
      try {
        onRepaired();
      } catch (callbackError) {
        logger.debug('VEC', 'onRepaired callback threw after self-repair', {}, callbackError as Error);
      }
    }
  );
}
