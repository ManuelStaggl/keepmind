import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DATA_DIR } from '../src/shared/paths.js';
import {
  ensurePluginDependencies,
  pluginRootFromWorkerScript,
  type PluginDepsRepairDeps,
} from '../src/services/plugin-deps-repair.js';
import { resetPluginResolution } from '../src/shared/plugin-node-modules.js';

const MARKER = join(DATA_DIR, '.deps-repair-failed.json');

let root = '';
let installRoot = '';
let savedNodeModulesEnv: string | undefined;
let savedCwd = '';
let cwdSandbox = '';
let savedArgv1 = '';

/**
 * Sentinel packages that make pluginDepsPresent() true. The repair no longer
 * asks "does a node_modules directory exist" — the worker inherits the user's
 * project as cwd, so their tree would pass for ours — it resolves named
 * packages instead. Tests have to materialise those.
 */
function makeTree(target: string): void {
  for (const name of ['sqlite-vec', 'zod']) {
    const dir = join(target, 'node_modules', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
    writeFileSync(join(dir, 'index.js'), 'module.exports = {};');
  }
}

/** A plugin tree shaped like the marketplace install: <root>/scripts/worker-service.cjs. */
function makePluginRoot(options: { manifest?: boolean; nodeModules?: boolean } = {}): string {
  const { manifest = true, nodeModules = false } = options;
  root = join(tmpdir(), `keepmind-deps-repair-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'worker-service.cjs'), '// stub');
  if (manifest) {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'keepmind-plugin' }));
    // ensureDepsWorkspace needs a lockfile beside the manifest; the real plugin
    // root always ships one.
    writeFileSync(join(root, 'bun.lock'), '{ "lockfileVersion": 1 }');
  }
  // "Legacy" placement: the tree still sitting beside the bundle, which must
  // continue to count as healthy until the install migrates it.
  if (nodeModules) makeTree(root);
  return join(root, 'scripts', 'worker-service.cjs');
}

/**
 * Records what would have run. `onInstall` may materialise node_modules to
 * emulate a real install; by default it succeeds WITHOUT creating the tree, so
 * the post-install verification is exercised unless a test opts in.
 */
function fakeDeps(options: {
  bun?: boolean;
  npm?: boolean;
  failWith?: string | null;
  createsTree?: boolean;
  throws?: boolean;
  lockHeld?: boolean;
} = {}) {
  const { bun = true, npm = true, failWith = null, createsTree = true, throws = false, lockHeld = false } = options;
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const prepared: Array<{ source: string; target: string }> = [];
  const deps: PluginDepsRepairDeps = {
    probe: (cmd) => (cmd.includes('bun') ? bun : cmd === 'npm' ? npm : false),
    runInstall: (cmd, args, cwd) => {
      calls.push({ cmd, args, cwd });
      if (throws) throw new Error('spawn exploded');
      if (failWith) return failWith;
      if (createsTree) makeTree(cwd);
      return null;
    },
    prepareWorkspace: (source, target) => {
      prepared.push({ source, target });
    },
    withInstallLock: (_installRoot, install) => (lockHeld ? null : install()),
  };
  return { deps, calls, prepared };
}

describe('plugin dependency self-repair', () => {
  beforeEach(() => {
    try { rmSync(MARKER, { force: true }); } catch { /* ignore */ }
    // Point the install destination at a temp dir. Without this the tests would
    // install into the real ~/.claude/plugins/data tree.
    installRoot = join(tmpdir(), `keepmind-deps-install-${process.pid}-${Math.random().toString(36).slice(2)}`);
    savedNodeModulesEnv = process.env.KEEPMIND_NODE_MODULES;
    process.env.KEEPMIND_NODE_MODULES = installRoot;
    // The candidate chain ends at the cwd, and this repo HAS a node_modules —
    // which would make the sentinels resolve and suppress every repair. Run from
    // an empty directory so only the roots under test can satisfy them.
    savedCwd = process.cwd();
    cwdSandbox = join(tmpdir(), `keepmind-deps-cwd-${process.pid}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(cwdSandbox, { recursive: true });
    process.chdir(cwdSandbox);
    // The chain also derives a candidate from argv[1] — the worker bundle in
    // production, the test file here, which would make THIS repo's node_modules
    // (zod and friends included) satisfy the sentinels.
    savedArgv1 = process.argv[1];
    process.argv[1] = join(cwdSandbox, 'scripts', 'not-a-real-bundle.cjs');
    resetPluginResolution();
  });
  afterEach(() => {
    try { rmSync(MARKER, { force: true }); } catch { /* ignore */ }
    if (savedCwd) process.chdir(savedCwd);
    process.argv[1] = savedArgv1;
    if (savedNodeModulesEnv === undefined) delete process.env.KEEPMIND_NODE_MODULES;
    else process.env.KEEPMIND_NODE_MODULES = savedNodeModulesEnv;
    resetPluginResolution();
    for (const dir of [root, installRoot, cwdSandbox]) {
      if (dir) try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    root = '';
    installRoot = '';
    cwdSandbox = '';
  });

  it('derives the plugin root from the worker script path', () => {
    expect(pluginRootFromWorkerScript(join('a', 'plugin', 'scripts', 'worker-service.cjs')))
      .toBe(join('a', 'plugin'));
  });

  describe('the common case', () => {
    it('spawns nothing when the dependencies are in the data directory', () => {
      makeTree(installRoot);
      const script = makePluginRoot();
      const { deps, calls } = fakeDeps();

      expect(ensurePluginDependencies(script, deps)).toBe(true);
      expect(calls).toHaveLength(0);
    });

    it('spawns nothing for a legacy install whose tree still sits beside the bundle', () => {
      // Existing installs must keep working until their next `npx keepmind
      // install` migrates them; repairing here would be pure cost. The legacy
      // candidate is derived from argv[1], which in production IS the bundle
      // inside that plugin root — so point it there, as the daemon does.
      const script = makePluginRoot({ nodeModules: true });
      process.argv[1] = script;
      resetPluginResolution();
      const { deps, calls } = fakeDeps();

      expect(ensurePluginDependencies(script, deps)).toBe(true);
      expect(calls).toHaveLength(0);
    });

    it('is not fooled by an unrelated node_modules in the working directory', () => {
      // The lazy-spawn path sets no cwd, so the worker inherits the user's
      // project. A directory-existence check would pass here and suppress the
      // repair the worker actually needs.
      mkdirSync(join(cwdSandbox, 'node_modules', 'lodash'), { recursive: true });
      const script = makePluginRoot();
      const { deps, calls } = fakeDeps();

      expect(ensurePluginDependencies(script, deps)).toBe(true);
      expect(calls).toHaveLength(1);
    });
  });

  describe('repair', () => {
    it('reinstalls with bun --frozen-lockfile into the data directory', () => {
      const script = makePluginRoot();
      const { deps, calls, prepared } = fakeDeps();

      expect(ensurePluginDependencies(script, deps)).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.cmd).toContain('bun');
      expect(calls[0]!.args).toEqual(['install', '--frozen-lockfile', '--ignore-scripts']);
      // The destination is the data directory, NOT the plugin root — installing
      // back into the plugin root would recreate the tree the host deletes.
      expect(calls[0]!.cwd).toBe(installRoot);
      expect(calls[0]!.cwd).not.toBe(pluginRootFromWorkerScript(script));
      // Manifest and lockfile are staged from the plugin root first, otherwise
      // --frozen-lockfile has nothing to install against.
      expect(prepared).toEqual([{ source: pluginRootFromWorkerScript(script), target: installRoot }]);
    });

    it('falls back to npm when bun is unavailable', () => {
      const script = makePluginRoot();
      const { deps, calls } = fakeDeps({ bun: false });

      expect(ensurePluginDependencies(script, deps)).toBe(true);
      expect(calls[0]!.cmd).toBe('npm');
      expect(calls[0]!.args).toEqual(['install', '--omit=dev', '--ignore-scripts']);
    });

    it('refuses to install when the manifest is gone too', () => {
      // No package.json means a partial/absent install, not a wiped tree —
      // installing would be guesswork.
      const script = makePluginRoot({ manifest: false });
      const { deps, calls } = fakeDeps();

      expect(ensurePluginDependencies(script, deps)).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it('fails when neither package manager exists', () => {
      const script = makePluginRoot();
      const { deps, calls } = fakeDeps({ bun: false, npm: false });

      expect(ensurePluginDependencies(script, deps)).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it('reports failure when the install reports success but leaves no tree', () => {
      const script = makePluginRoot();
      const { deps } = fakeDeps({ createsTree: false });

      expect(ensurePluginDependencies(script, deps)).toBe(false);
    });

    it('survives an install that throws', () => {
      const script = makePluginRoot();
      const { deps } = fakeDeps({ throws: true });

      expect(ensurePluginDependencies(script, deps)).toBe(false);
    });

    it('stands down when another process holds the install lock', () => {
      // Every install path writes to the same tree now, and two concurrent
      // `bun install` runs in one directory corrupt each other. The loser waits
      // for the winner's result instead of racing it.
      const script = makePluginRoot();
      const { deps } = fakeDeps({ lockHeld: true });

      expect(ensurePluginDependencies(script, deps)).toBe(false);
    });

    it('does not latch a failure when it merely lost the install lock', () => {
      // Losing the lock is not a failure: latching it would make the next hook
      // sit out the 10-minute cooldown even though nothing is wrong.
      const script = makePluginRoot();
      ensurePluginDependencies(script, fakeDeps({ lockHeld: true }).deps);

      const next = fakeDeps();
      expect(ensurePluginDependencies(script, next.deps)).toBe(true);
      expect(next.calls).toHaveLength(1);
    });
  });

  describe('failure cooldown', () => {
    it('does not retry after a recent failure', () => {
      // Every hook spawns this path; without the latch a broken install would
      // launch a multi-minute reinstall thousands of times a day.
      const script = makePluginRoot();
      const first = fakeDeps({ failWith: 'exit 1' });
      expect(ensurePluginDependencies(script, first.deps)).toBe(false);
      expect(first.calls).toHaveLength(1);

      const second = fakeDeps();
      expect(ensurePluginDependencies(script, second.deps)).toBe(false);
      expect(second.calls).toHaveLength(0);
    });

    it('clears the latch after a success so a later wipe still repairs', () => {
      const script = makePluginRoot();
      const failed = fakeDeps({ failWith: 'exit 1' });
      ensurePluginDependencies(script, failed.deps);

      // Simulate the cooldown having elapsed.
      writeFileSync(MARKER, JSON.stringify({ failedAt: new Date(Date.now() - 60 * 60_000).toISOString() }));

      const recovered = fakeDeps();
      expect(ensurePluginDependencies(script, recovered.deps)).toBe(true);
      expect(recovered.calls).toHaveLength(1);

      // A success must not leave a live failure timestamp behind, or the next
      // genuine wipe would sit out the cooldown for no reason. Assert the marker
      // itself rather than re-running the repair: a second run in this process
      // would be answered by Node's internal resolution cache, which survives
      // deleting the directory and is not ours to clear.
      const marker = JSON.parse(readFileSync(MARKER, 'utf-8'));
      expect(marker.failedAt).toBeUndefined();
      expect(typeof marker.clearedAt).toBe('string');
    });

    it('ignores a marker whose timestamp is in the future', () => {
      // A backwards clock jump must not latch the cooldown permanently.
      const script = makePluginRoot();
      writeFileSync(MARKER, JSON.stringify({ failedAt: new Date(Date.now() + 60 * 60_000).toISOString() }));

      const { deps, calls } = fakeDeps();
      expect(ensurePluginDependencies(script, deps)).toBe(true);
      expect(calls).toHaveLength(1);
    });
  });
});
