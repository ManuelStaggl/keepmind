import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { detectClaudeMem } from '../../src/services/migration/claude-mem-migration.js';
import { findClaudeMemProcesses, killProcesses } from '../../src/services/migration/claude-mem-processes.js';

/**
 * detectClaudeMem must recognise claude-mem even when its marketplace was
 * installed under an arbitrary name (the upstream repo registers as
 * "thedotmack", not "claude-mem"). Detection keys off the plugin identity
 * (`claude-mem@<market>`) and the marketplace manifest's plugin list, never a
 * hard-coded `claude-mem@claude-mem` literal.
 */
describe('detectClaudeMem', () => {
  let cfgDir: string;
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.CLAUDE_CONFIG_DIR;
    cfgDir = mkdtempSync(join(tmpdir(), 'cm-cfg-'));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
    mkdirSync(join(cfgDir, 'plugins'), { recursive: true });
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    rmSync(cfgDir, { recursive: true, force: true });
  });

  function writeMarketplaceManifest(market: string, pluginNames: string[]): void {
    const dir = join(cfgDir, 'plugins', 'marketplaces', market, '.claude-plugin');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'marketplace.json'),
      JSON.stringify({ name: market, plugins: pluginNames.map((name) => ({ name })) }),
    );
  }

  it('detects claude-mem installed under a differently-named marketplace (thedotmack)', () => {
    writeFileSync(
      join(cfgDir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'claude-mem@thedotmack': { version: '1.0' } } }),
    );
    writeFileSync(join(cfgDir, 'plugins', 'known_marketplaces.json'), JSON.stringify({ thedotmack: {} }));
    writeFileSync(join(cfgDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'claude-mem@thedotmack': true } }));
    writeMarketplaceManifest('thedotmack', ['claude-mem']);

    const d = detectClaudeMem();
    expect(d.pluginKeys).toContain('claude-mem@thedotmack');
    expect(d.marketplaceKeys).toContain('thedotmack');
    expect(d.marketplaceDirs.some((x) => x.includes('thedotmack'))).toBe(true);
    expect(d.installed).toBe(true);
  });

  it('detects a claude-mem marketplace discoverable only via its manifest', () => {
    writeFileSync(join(cfgDir, 'plugins', 'known_marketplaces.json'), JSON.stringify({ weirdname: {} }));
    writeMarketplaceManifest('weirdname', ['something-else', 'claude-mem']);

    const d = detectClaudeMem();
    expect(d.marketplaceKeys).toContain('weirdname');
  });

  it('reports no plugin footprint for a keepmind-only config', () => {
    writeFileSync(
      join(cfgDir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'keepmind@keepmind': {} } }),
    );
    writeFileSync(join(cfgDir, 'plugins', 'known_marketplaces.json'), JSON.stringify({ keepmind: {} }));

    const d = detectClaudeMem();
    expect(d.pluginKeys.length).toBe(0);
    expect(d.marketplaceKeys.length).toBe(0);
  });
});

describe('claude-mem process scan', () => {
  it('findClaudeMemProcesses returns an array; killProcesses([]) is a no-op', async () => {
    const procs = await findClaudeMemProcesses();
    expect(Array.isArray(procs)).toBe(true);
    expect(await killProcesses([])).toBe(0);
  });
});
