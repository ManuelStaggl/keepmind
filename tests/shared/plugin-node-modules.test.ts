import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  depsRoot,
  depsRootCandidates,
  depsInstallRoot,
  pluginResolve,
  pluginRequire,
  pluginCanResolve,
  resetPluginResolution,
} from '../../src/shared/plugin-node-modules.js';

const ENV_KEYS = ['KEEPMIND_NODE_MODULES', 'CLAUDE_PLUGIN_DATA', 'CLAUDE_CONFIG_DIR'] as const;

let scratch = '';
let saved: Record<string, string | undefined> = {};

/** A dependency tree at <root>/node_modules containing `name`, exporting `value`. */
function makePackage(root: string, name: string, body: string): void {
  const dir = join(root, 'node_modules', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
  writeFileSync(join(dir, 'index.js'), body);
}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const key of ENV_KEYS) delete process.env[key];
  scratch = join(tmpdir(), `keepmind-deps-root-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(scratch, { recursive: true });
  resetPluginResolution();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetPluginResolution();
  rmSync(scratch, { recursive: true, force: true });
});

describe('depsRootCandidates', () => {
  it('orders the escape hatch ahead of the host variable and the derived path', () => {
    const hatch = join(scratch, 'hatch');
    const hostData = join(scratch, 'host-data');
    const config = join(scratch, 'config');
    process.env.KEEPMIND_NODE_MODULES = hatch;
    process.env.CLAUDE_PLUGIN_DATA = hostData;
    process.env.CLAUDE_CONFIG_DIR = config;

    const candidates = depsRootCandidates();
    const derived = join(config, 'plugins', 'data', 'keepmind-keepmind');

    expect(candidates[0]).toBe(hatch);
    expect(candidates[1]).toBe(hostData);
    expect(candidates[2]).toBe(derived);
  });

  it('keeps the derived data directory even when the host injects its own', () => {
    // A host that reports a different plugin id must win where it is visible,
    // but the installer never sees that variable — so both have to be tried.
    process.env.CLAUDE_PLUGIN_DATA = join(scratch, 'injected');
    process.env.CLAUDE_CONFIG_DIR = scratch;

    const candidates = depsRootCandidates();
    expect(candidates).toContain(join(scratch, 'injected'));
    expect(candidates).toContain(join(scratch, 'plugins', 'data', 'keepmind-keepmind'));
  });

  it('includes the legacy bundle-relative plugin root so existing installs keep working', () => {
    // <pluginRoot>/scripts/<bundle> is the shape both the marketplace install
    // and every cache version have; argv[1] is what the daemon is launched with.
    const pluginRoot = join(scratch, 'marketplace', 'plugin');
    const entry = join(pluginRoot, 'scripts', 'worker-service.cjs');
    const originalArgv = process.argv[1];
    process.argv[1] = entry;
    try {
      expect(depsRootCandidates()).toContain(pluginRoot);
    } finally {
      process.argv[1] = originalArgv;
    }
  });

  it('lists no duplicates', () => {
    process.env.CLAUDE_PLUGIN_DATA = scratch;
    process.env.KEEPMIND_NODE_MODULES = scratch;
    const candidates = depsRootCandidates();
    expect(candidates.length).toBe(new Set(candidates).size);
  });
});

describe('depsRoot', () => {
  it('returns the first candidate that actually carries a tree, not merely a path', () => {
    const empty = join(scratch, 'empty');
    const populated = join(scratch, 'populated');
    mkdirSync(empty, { recursive: true });
    makePackage(populated, 'anything', 'module.exports = 1;');

    process.env.KEEPMIND_NODE_MODULES = empty;
    process.env.CLAUDE_PLUGIN_DATA = populated;

    expect(depsRoot()).toBe(populated);
  });

  it('returns null when no candidate has a tree', () => {
    process.env.KEEPMIND_NODE_MODULES = join(scratch, 'nowhere');
    process.env.CLAUDE_PLUGIN_DATA = join(scratch, 'also-nowhere');
    process.env.CLAUDE_CONFIG_DIR = join(scratch, 'config');
    // The dev-tree candidates (cwd) are still tried; this repo has node_modules,
    // so assert against a cwd that does not.
    const originalCwd = process.cwd();
    process.chdir(scratch);
    try {
      expect(depsRoot()).toBeNull();
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe('depsInstallRoot', () => {
  it('always names the data directory, never a legacy location', () => {
    process.env.CLAUDE_CONFIG_DIR = scratch;
    // Even with a populated legacy tree present, installs must not target it —
    // that is the directory the host deletes.
    makePackage(join(scratch, 'legacy'), 'anything', 'module.exports = 1;');
    expect(depsInstallRoot()).toBe(join(scratch, 'plugins', 'data', 'keepmind-keepmind'));
  });

  it('follows the same overrides the resolver honors, so both stay coherent', () => {
    process.env.KEEPMIND_NODE_MODULES = join(scratch, 'hatch');
    expect(depsInstallRoot()).toBe(join(scratch, 'hatch'));
    expect(depsRootCandidates()[0]).toBe(join(scratch, 'hatch'));
  });
});

describe('pluginResolve / pluginRequire', () => {
  it('loads a package from the data directory', () => {
    const data = join(scratch, 'data');
    makePackage(data, 'demo-pkg', 'module.exports = { from: "data" };');
    process.env.CLAUDE_PLUGIN_DATA = data;

    expect(pluginRequire<{ from: string }>('demo-pkg').from).toBe('data');
    expect(pluginResolve('demo-pkg').startsWith(data)).toBe(true);
  });

  it('falls back per package, not per tree', () => {
    // A half-migrated machine: one package already in the data dir, another
    // still only in the legacy tree. Both must load.
    const data = join(scratch, 'data');
    const legacy = join(scratch, 'legacy');
    makePackage(data, 'in-data', 'module.exports = "data";');
    makePackage(legacy, 'in-legacy', 'module.exports = "legacy";');

    process.env.CLAUDE_PLUGIN_DATA = data;
    process.env.KEEPMIND_NODE_MODULES = legacy;

    expect(pluginRequire('in-data')).toBe('data');
    expect(pluginRequire('in-legacy')).toBe('legacy');
  });

  it('governs only the first hop — transitive deps resolve inside their own tree', () => {
    // This is the load-bearing property of the whole design: @huggingface/
    // transformers must find onnxruntime-node, and sqlite-vec its platform
    // binary, without the anchor knowing anything about them.
    const data = join(scratch, 'data');
    makePackage(data, 'inner-dep', 'module.exports = "inner";');
    makePackage(data, 'outer-dep', 'module.exports = require("inner-dep") + "+outer";');
    process.env.CLAUDE_PLUGIN_DATA = data;

    expect(pluginRequire('outer-dep')).toBe('inner+outer');
  });

  it('honors the package exports map, as zod subpaths require', () => {
    const data = join(scratch, 'data');
    const dir = join(data, 'node_modules', 'subpath-pkg');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'subpath-pkg', version: '1.0.0', exports: { './v3': './sub/v3.js' } }),
    );
    writeFileSync(join(dir, 'sub', 'v3.js'), 'module.exports = "v3";');
    process.env.CLAUDE_PLUGIN_DATA = data;

    expect(pluginRequire('subpath-pkg/v3')).toBe('v3');
  });

  it('names every root it searched when resolution fails', () => {
    const data = join(scratch, 'data');
    mkdirSync(data, { recursive: true });
    process.env.CLAUDE_PLUGIN_DATA = data;

    // The failure this replaces was a bare "Cannot find module" whose require
    // stack pointed at the bundle and told nobody where we actually looked.
    expect(() => pluginResolve('definitely-not-installed')).toThrow(/definitely-not-installed/);
    try {
      pluginResolve('definitely-not-installed');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain(data);
      expect(message).toContain('npx keepmind install');
    }
  });

  it('pluginCanResolve reports misses without throwing', () => {
    const data = join(scratch, 'data');
    makePackage(data, 'present-pkg', 'module.exports = 1;');
    process.env.CLAUDE_PLUGIN_DATA = data;

    expect(pluginCanResolve('present-pkg')).toBe(true);
    expect(pluginCanResolve('absent-pkg')).toBe(false);
  });

  it('resetPluginResolution lets a repaired dependency become resolvable', () => {
    // A successful repair installs the tree while the worker is running, so a
    // spec that just failed has to be retryable.
    const data = join(scratch, 'data');
    mkdirSync(data, { recursive: true });
    process.env.CLAUDE_PLUGIN_DATA = data;
    process.env.KEEPMIND_NODE_MODULES = data;

    expect(pluginCanResolve('late-pkg')).toBe(false);
    makePackage(data, 'late-pkg', 'module.exports = "repaired";');
    resetPluginResolution();

    expect(pluginRequire('late-pkg')).toBe('repaired');
  });
});
