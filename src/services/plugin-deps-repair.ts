
// Self-heal a plugin install whose node_modules went missing underneath us.
//
// The worker bundle lives at <pluginRoot>/scripts/worker-service.cjs and
// resolves its runtime deps (node:sqlite bindings aside: sqlite-vec, the
// tree-sitter grammars, @huggingface/transformers) from <pluginRoot>/
// node_modules. That directory is NOT ours alone: the canonical plugin root is
// the marketplace install (see worker-utils.resolveWorkerScriptPath), and the
// host owns that directory. Claude Code tracks it as a git checkout of the
// marketplace source and restores it from the remote — which deletes every
// gitignored path, node_modules included. Observed 2026-07-29: a `clone: from
// github.com/...` reflog entry ~60s after `npx keepmind install` wiped 804 MB
// of freshly installed dependencies while the running worker (already holding
// its modules in memory) kept serving, so nothing surfaced until the NEXT
// spawn — which would have died with an unresolvable require.
//
// Registering the marketplace with autoUpdate:false removes today's trigger,
// but not the class of failure: the host owns the directory and may reasonably
// clean it at any time. So the spawn path repairs instead of dying. A present
// node_modules costs one existsSync; the repair only runs when the tree is
// actually gone, and only under the caller's spawn lock (one repair at a time).
//
// A failed repair is latched for REPAIR_COOLDOWN_MS. Without that latch every
// hook — thousands a day — would launch its own multi-minute install against a
// broken network or a missing package manager, which is far worse than a
// worker that stays down until the user runs `npx keepmind doctor`.

import path from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { logger } from '../utils/logger.js';
import { toError } from '../utils/to-error.js';
import { paths } from '../shared/paths.js';

const REPAIR_TIMEOUT_MS = 180_000;
const REPAIR_COOLDOWN_MS = 10 * 60_000;

const IS_WINDOWS = process.platform === 'win32';

function repairMarkerPath(): string {
  return path.join(paths.dataDir(), '.deps-repair-failed.json');
}

/** Plugin root for a worker script at <pluginRoot>/scripts/worker-service.cjs. */
export function pluginRootFromWorkerScript(workerScriptPath: string): string {
  return path.dirname(path.dirname(workerScriptPath));
}

function isCoolingDown(): boolean {
  try {
    const raw = readFileSync(repairMarkerPath(), 'utf-8');
    const failedAt = Date.parse(JSON.parse(raw)?.failedAt ?? '');
    if (!Number.isFinite(failedAt)) return false;
    // A clock jump backwards must not latch the cooldown forever.
    const age = Date.now() - failedAt;
    return age >= 0 && age < REPAIR_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function recordFailure(reason: string): void {
  try {
    mkdirSync(paths.dataDir(), { recursive: true });
    writeFileSync(
      repairMarkerPath(),
      JSON.stringify({ failedAt: new Date().toISOString(), reason }, null, 2),
    );
  } catch {
    // Marker is an optimisation, not a correctness requirement — a failure to
    // write it only costs us an extra repair attempt on the next spawn.
  }
}

function clearFailure(): void {
  try {
    if (existsSync(repairMarkerPath())) {
      writeFileSync(repairMarkerPath(), JSON.stringify({ clearedAt: new Date().toISOString() }, null, 2));
    }
  } catch {
    // See recordFailure.
  }
}

/**
 * Locate a package manager able to materialise node_modules. Bun first: the
 * plugin ships a bun.lock and `--frozen-lockfile` reproduces the exact closure
 * the release was built against. npm is the fallback so a machine without bun
 * still recovers (keepmind requires bun to *install*, but a user whose PATH
 * changed since should not be left with a dead worker).
 */
function resolvePackageManager(deps: PluginDepsRepairDeps): { cmd: string; args: string[] } | null {
  const bunCandidates = [
    'bun',
    path.join(homedir(), '.bun', 'bin', IS_WINDOWS ? 'bun.exe' : 'bun'),
  ];

  for (const candidate of bunCandidates) {
    if (deps.probe(candidate)) {
      return { cmd: candidate, args: ['install', '--frozen-lockfile', '--ignore-scripts'] };
    }
  }

  if (deps.probe('npm')) {
    return { cmd: 'npm', args: ['install', '--omit=dev', '--ignore-scripts'] };
  }

  return null;
}

/**
 * Seam for tests: the real implementations spawn processes, so a test that
 * exercised them would install packages for real. Mirrors the grammar
 * installer's GrammarInstallDeps.
 */
export interface PluginDepsRepairDeps {
  /** True when `cmd --version` succeeds. */
  probe: (cmd: string) => boolean;
  /** Run the install; return null on success or a reason string on failure. */
  runInstall: (cmd: string, args: string[], cwd: string) => string | null;
}

// windowsHide on both: this runs from the hook-driven spawn path, and an
// unhidden child flashes a console window on Windows (see
// tests/windows-hide-spawn-guard.test.ts).
const defaultDeps: PluginDepsRepairDeps = {
  probe: (cmd) =>
    spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: IS_WINDOWS, windowsHide: true }).status === 0,
  runInstall: (cmd, args, cwd) => {
    const result = spawnSync(cmd, args, {
      cwd,
      stdio: 'ignore',
      timeout: REPAIR_TIMEOUT_MS,
      shell: IS_WINDOWS,
      windowsHide: true,
    });
    if (result.error) return String(result.error.message);
    if (result.status !== 0) return `exit ${result.status}`;
    return null;
  },
};

/**
 * Ensure <pluginRoot>/node_modules exists, reinstalling it if it vanished.
 *
 * Returns true when the worker can be spawned (tree present, or restored).
 * Callers MUST hold the spawn lock: two concurrent installs into the same
 * directory corrupt each other.
 */
export function ensurePluginDependencies(
  workerScriptPath: string,
  deps: PluginDepsRepairDeps = defaultDeps,
): boolean {
  const pluginRoot = pluginRootFromWorkerScript(workerScriptPath);
  const nodeModules = path.join(pluginRoot, 'node_modules');

  // The overwhelmingly common case: one stat, then out of the way.
  if (existsSync(nodeModules)) return true;

  if (!existsSync(path.join(pluginRoot, 'package.json'))) {
    logger.error(
      'SYSTEM',
      'Plugin dependencies are missing and so is the manifest — the plugin install is incomplete. Run `npx keepmind install`.',
      { pluginRoot },
    );
    return false;
  }

  if (isCoolingDown()) {
    logger.warn(
      'SYSTEM',
      'Plugin dependencies are missing and a recent repair already failed — not retrying yet. Run `npx keepmind install`.',
      { pluginRoot, cooldownMs: REPAIR_COOLDOWN_MS },
    );
    return false;
  }

  const manager = resolvePackageManager(deps);
  if (!manager) {
    logger.error(
      'SYSTEM',
      'Plugin dependencies are missing and neither bun nor npm is on PATH — cannot self-repair. Run `npx keepmind install`.',
      { pluginRoot },
    );
    recordFailure('no-package-manager');
    return false;
  }

  logger.warn(
    'SYSTEM',
    'Plugin node_modules missing — reinstalling before worker spawn. The host may have restored the marketplace directory from git, which deletes gitignored paths.',
    { pluginRoot, manager: manager.cmd },
  );

  const startedAt = Date.now();
  try {
    const reason = deps.runInstall(manager.cmd, manager.args, pluginRoot);
    if (reason !== null) {
      logger.error(
        'SYSTEM',
        'Plugin dependency repair failed — worker cannot start. Run `npx keepmind install`.',
        { pluginRoot, manager: manager.cmd, reason, ms: Date.now() - startedAt },
      );
      recordFailure(reason);
      return false;
    }
  } catch (error: unknown) {
    logger.error(
      'SYSTEM',
      'Plugin dependency repair threw — worker cannot start. Run `npx keepmind install`.',
      { pluginRoot, manager: manager.cmd },
      toError(error),
    );
    recordFailure('threw');
    return false;
  }

  // The install can report success while still leaving nothing behind (wrong
  // cwd, a lockfile describing an empty closure). Verify what we came for.
  if (!existsSync(nodeModules)) {
    logger.error(
      'SYSTEM',
      'Plugin dependency repair reported success but node_modules is still missing. Run `npx keepmind install`.',
      { pluginRoot, manager: manager.cmd },
    );
    recordFailure('no-tree-after-success');
    return false;
  }

  logger.info('SYSTEM', 'Plugin dependencies restored — continuing worker spawn', {
    pluginRoot,
    manager: manager.cmd,
    ms: Date.now() - startedAt,
  });
  clearFailure();
  return true;
}
