
// Self-heal a plugin install whose node_modules went missing underneath us.
//
// The dependency tree now lives in the plugin data directory and is resolved
// through src/shared/plugin-node-modules.ts, precisely so the host cannot delete
// it. This path remains the backstop, because a data directory can still be
// absent (a fresh checkout the installer never ran against, a user clearing
// ~/.claude) and because installs that predate the move still keep their tree
// beside the bundle.
//
// Why it exists at all: the host tracks the marketplace install as a git
// checkout and restores it from the remote, which deletes every gitignored path,
// node_modules included. Observed 2026-07-29 twice — once ~60s after `npx
// keepmind install` (804 MB), and again at 16:43 during an unrelated session
// with autoUpdate:false already set (472 MB → 59 MB). The running worker holds
// its modules in memory and keeps serving, so nothing surfaces until the NEXT
// spawn, which would die on an unresolvable require. autoUpdate:false removes
// one trigger, not the class of failure.
//
// A present tree costs one existsSync; the repair only runs when nothing
// resolves, and only under the caller's spawn lock (one repair at a time).
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
import { depsInstallRoot, pluginDepsPresent, resetPluginResolution } from '../shared/plugin-node-modules.js';
import { ensureDepsWorkspace, withDepsInstallLock } from '../shared/plugin-workspace.js';

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
  /** Copy manifest, lockfile and local file: deps from the plugin root into the install root. */
  prepareWorkspace: (sourcePluginRoot: string, installRoot: string) => void;
  /** Run the install exclusively; null when another process holds the lock. */
  withInstallLock: <T>(installRoot: string, install: () => T) => T | null;
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
  prepareWorkspace: (sourcePluginRoot, installRoot) => {
    ensureDepsWorkspace(sourcePluginRoot, installRoot);
  },
  withInstallLock: (installRoot, install) => withDepsInstallLock(installRoot, install),
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
  const installRoot = depsInstallRoot();
  const nodeModules = path.join(installRoot, 'node_modules');

  // The overwhelmingly common case: resolve two sentinel packages, then out of
  // the way. Named packages rather than a node_modules directory check: this
  // path runs with the user's project as cwd, and their node_modules would
  // otherwise pass for ours. An install that has not migrated yet — tree still
  // beside the bundle — resolves through the legacy candidate and is left alone.
  if (pluginDepsPresent()) return true;

  // The plugin root is the SOURCE of the manifest and lockfile; the data
  // directory is the DESTINATION. Without the former there is nothing to
  // install from.
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
    { pluginRoot, installRoot, manager: manager.cmd },
  );

  const startedAt = Date.now();
  try {
    // Stage the manifest, lockfile and any local file: dependency into the data
    // directory first: bun needs all of them in its cwd, and --frozen-lockfile
    // fails without the lockfile.
    //
    // Under the install lock, because the spawn lock does not cover this: the
    // installer and the Setup hook write to the same tree and never take it.
    // A held lock means someone else is already installing — not an error, and
    // explicitly not latched, so the next hook simply tries again.
    // Wrapped in an object rather than returned bare: a successful install
    // reports `null` too, and the lock's "someone else has it" must not be
    // mistaken for success.
    const outcome = deps.withInstallLock(installRoot, () => {
      deps.prepareWorkspace(pluginRoot, installRoot);
      return { reason: deps.runInstall(manager.cmd, manager.args, installRoot) };
    });
    if (outcome === null) {
      logger.info(
        'SYSTEM',
        'Another process is installing the plugin dependencies — skipping this repair and waiting for it',
        { installRoot },
      );
      return false;
    }
    const reason = outcome.reason;
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

  // The install can report success while still leaving nothing usable behind (a
  // lockfile describing an empty closure, a partial tree). Drop the memoized
  // handles — they answered against the pre-install state — and verify by
  // resolving what the worker will actually need.
  resetPluginResolution();
  if (!pluginDepsPresent()) {
    logger.error(
      'SYSTEM',
      'Plugin dependency repair reported success but the dependencies still do not resolve. Run `npx keepmind install`.',
      { pluginRoot, installRoot, nodeModules, manager: manager.cmd },
    );
    recordFailure('no-tree-after-success');
    return false;
  }

  logger.info('SYSTEM', 'Plugin dependencies restored — continuing worker spawn', {
    pluginRoot,
    installRoot,
    manager: manager.cmd,
    ms: Date.now() - startedAt,
  });
  clearFailure();
  return true;
}
