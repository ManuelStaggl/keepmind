// Perf plan P6: stale plugin-cache versions each carry a ~900 MB dependency
// closure. These tests pin the safety rules, because the failure mode of a bug
// here is deleting the code the host is currently executing.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

let sandbox: string;
let cacheRoot: string;
const savedEnv: Record<string, string | undefined> = {};
const savedArgv1 = process.argv[1];

function makeVersions(...versions: string[]): void {
  for (const version of versions) {
    mkdirSync(path.join(cacheRoot, version, 'scripts'), { recursive: true });
    writeFileSync(path.join(cacheRoot, version, 'scripts', 'worker-service.cjs'), '// bundle');
  }
}

/**
 * The sweep resolves CLAUDE_CONFIG_DIR per call rather than at import time,
 * precisely so a test can redirect it. A frozen module constant would make these
 * cases run against the real ~/.claude and delete real ~900 MB directories.
 */
async function loadSweep() {
  return import('../../src/shared/plugin-cache-sweep.js');
}

beforeEach(() => {
  for (const key of ['CLAUDE_CONFIG_DIR', 'CLAUDE_PLUGIN_ROOT', 'PLUGIN_ROOT']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  sandbox = mkdtempSync(path.join(tmpdir(), 'keepmind-sweep-'));
  process.env.CLAUDE_CONFIG_DIR = sandbox;
  cacheRoot = path.join(sandbox, 'plugins', 'cache', 'keepmind', 'keepmind');
  mkdirSync(cacheRoot, { recursive: true });
  // Point argv[1] somewhere outside the cache unless a case overrides it.
  process.argv[1] = path.join(sandbox, 'unrelated.js');
});

afterEach(() => {
  process.argv[1] = savedArgv1;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(sandbox, { recursive: true, force: true });
});

describe('test isolation', () => {
  // Guard rail with a scar behind it: an earlier draft captured the config dir at
  // import time, so this very suite ran against the real ~/.claude and deleted a
  // genuine 898 MB version directory. Assert the sandbox actually took effect
  // BEFORE any case is allowed to delete anything.
  it('resolves the cache root inside the sandbox, not the real home', async () => {
    const { pluginCacheRoot } = await loadSweep();
    expect(pluginCacheRoot()).toBe(cacheRoot);
    expect(pluginCacheRoot().startsWith(sandbox)).toBe(true);
  });
});

describe('compareVersionsDesc', () => {
  it('sorts newest first, numerically not lexically', async () => {
    const { compareVersionsDesc } = await loadSweep();
    expect(['1.3.3', '2.0.0', '1.4.0', '10.0.0', '9.9.9'].sort(compareVersionsDesc))
      .toEqual(['10.0.0', '9.9.9', '2.0.0', '1.4.0', '1.3.3']);
  });

  it('ranks a release above its own prerelease', async () => {
    const { compareVersionsDesc } = await loadSweep();
    expect(['2.0.0-beta.1', '2.0.0'].sort(compareVersionsDesc)).toEqual(['2.0.0', '2.0.0-beta.1']);
  });
});

describe('sweepPluginCache', () => {
  it('keeps the two newest and removes the rest', async () => {
    makeVersions('1.3.3', '1.4.0', '2.0.0');
    const { sweepPluginCache } = await loadSweep();

    const result = sweepPluginCache();

    expect(result.removed).toEqual(['1.3.3']);
    expect(existsSync(path.join(cacheRoot, '1.3.3'))).toBe(false);
    expect(existsSync(path.join(cacheRoot, '1.4.0'))).toBe(true);
    expect(existsSync(path.join(cacheRoot, '2.0.0'))).toBe(true);
  });

  it('does nothing when only the retained count exists', async () => {
    makeVersions('1.4.0', '2.0.0');
    const { sweepPluginCache } = await loadSweep();

    const result = sweepPluginCache();

    expect(result.removed).toEqual([]);
    expect(result.skipped).toBe('nothing to reclaim');
    expect(existsSync(path.join(cacheRoot, '1.4.0'))).toBe(true);
  });

  it('NEVER removes the version directory the running process lives in', async () => {
    makeVersions('1.0.0', '1.3.3', '1.4.0', '2.0.0');
    // Simulate the worker running out of the OLDEST directory.
    process.argv[1] = path.join(cacheRoot, '1.0.0', 'scripts', 'worker-service.cjs');
    const { sweepPluginCache } = await loadSweep();

    const result = sweepPluginCache();

    expect(existsSync(path.join(cacheRoot, '1.0.0'))).toBe(true);
    expect(result.kept).toContain('1.0.0');
    expect(result.removed).toEqual(['1.3.3']);
  });

  it('honors CLAUDE_PLUGIN_ROOT as the running directory', async () => {
    makeVersions('1.0.0', '1.3.3', '1.4.0', '2.0.0');
    process.env.CLAUDE_PLUGIN_ROOT = path.join(cacheRoot, '1.3.3');
    const { sweepPluginCache } = await loadSweep();

    sweepPluginCache();

    expect(existsSync(path.join(cacheRoot, '1.3.3'))).toBe(true);
    expect(existsSync(path.join(cacheRoot, '1.0.0'))).toBe(false);
  });

  it('pins the version the marketplace reports as installed', async () => {
    makeVersions('1.0.0', '1.3.3', '1.4.0', '2.0.0');
    const marketplace = path.join(sandbox, 'plugins', 'marketplaces', 'keepmind');
    mkdirSync(marketplace, { recursive: true });
    writeFileSync(path.join(marketplace, 'package.json'), JSON.stringify({ version: '1.0.0' }));
    const { sweepPluginCache } = await loadSweep();

    sweepPluginCache();

    expect(existsSync(path.join(cacheRoot, '1.0.0'))).toBe(true);
  });

  it('ignores entries that are not version directories', async () => {
    makeVersions('1.3.3', '1.4.0', '2.0.0');
    mkdirSync(path.join(cacheRoot, 'scratch'), { recursive: true });
    writeFileSync(path.join(cacheRoot, 'notes.txt'), 'x');
    const { sweepPluginCache } = await loadSweep();

    const result = sweepPluginCache();

    expect(result.removed).toEqual(['1.3.3']);
    expect(existsSync(path.join(cacheRoot, 'scratch'))).toBe(true);
    expect(existsSync(path.join(cacheRoot, 'notes.txt'))).toBe(true);
  });

  it('reports without deleting in dryRun mode', async () => {
    makeVersions('1.3.3', '1.4.0', '2.0.0');
    const { sweepPluginCache } = await loadSweep();

    const result = sweepPluginCache({ dryRun: true });

    expect(result.removed).toEqual(['1.3.3']);
    expect(existsSync(path.join(cacheRoot, '1.3.3'))).toBe(true);
  });

  it('does not throw when the cache root is absent', async () => {
    rmSync(cacheRoot, { recursive: true, force: true });
    const { sweepPluginCache } = await loadSweep();

    const result = sweepPluginCache();

    expect(result.skipped).toBe('cache root does not exist');
    expect(result.removed).toEqual([]);
  });
});
