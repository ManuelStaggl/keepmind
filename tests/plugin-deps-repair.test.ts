import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DATA_DIR } from '../src/shared/paths.js';
import {
  ensurePluginDependencies,
  pluginRootFromWorkerScript,
  type PluginDepsRepairDeps,
} from '../src/services/plugin-deps-repair.js';

const MARKER = join(DATA_DIR, '.deps-repair-failed.json');

let root = '';

/** A plugin tree shaped like the marketplace install: <root>/scripts/worker-service.cjs. */
function makePluginRoot(options: { manifest?: boolean; nodeModules?: boolean } = {}): string {
  const { manifest = true, nodeModules = false } = options;
  root = join(tmpdir(), `keepmind-deps-repair-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'worker-service.cjs'), '// stub');
  if (manifest) writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'keepmind-plugin' }));
  if (nodeModules) mkdirSync(join(root, 'node_modules'), { recursive: true });
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
} = {}) {
  const { bun = true, npm = true, failWith = null, createsTree = true, throws = false } = options;
  const calls: Array<{ cmd: string; args: string[]; cwd: string }> = [];
  const deps: PluginDepsRepairDeps = {
    probe: (cmd) => (cmd.includes('bun') ? bun : cmd === 'npm' ? npm : false),
    runInstall: (cmd, args, cwd) => {
      calls.push({ cmd, args, cwd });
      if (throws) throw new Error('spawn exploded');
      if (failWith) return failWith;
      if (createsTree) mkdirSync(join(cwd, 'node_modules'), { recursive: true });
      return null;
    },
  };
  return { deps, calls };
}

describe('plugin dependency self-repair', () => {
  beforeEach(() => {
    try { rmSync(MARKER, { force: true }); } catch { /* ignore */ }
  });
  afterEach(() => {
    try { rmSync(MARKER, { force: true }); } catch { /* ignore */ }
    if (root) try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    root = '';
  });

  it('derives the plugin root from the worker script path', () => {
    expect(pluginRootFromWorkerScript(join('a', 'plugin', 'scripts', 'worker-service.cjs')))
      .toBe(join('a', 'plugin'));
  });

  describe('the common case', () => {
    it('spawns nothing when node_modules is present', () => {
      const script = makePluginRoot({ nodeModules: true });
      const { deps, calls } = fakeDeps();

      expect(ensurePluginDependencies(script, deps)).toBe(true);
      expect(calls).toHaveLength(0);
    });
  });

  describe('repair', () => {
    it('reinstalls with bun --frozen-lockfile when the tree vanished', () => {
      const script = makePluginRoot();
      const { deps, calls } = fakeDeps();

      expect(ensurePluginDependencies(script, deps)).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.cmd).toContain('bun');
      expect(calls[0]!.args).toEqual(['install', '--frozen-lockfile', '--ignore-scripts']);
      expect(calls[0]!.cwd).toBe(pluginRootFromWorkerScript(script));
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

      // A success must not leave a live failure timestamp behind.
      rmSync(join(root, 'node_modules'), { recursive: true, force: true });
      const later = fakeDeps();
      expect(ensurePluginDependencies(script, later.deps)).toBe(true);
      expect(later.calls).toHaveLength(1);
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
