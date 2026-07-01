import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { purgeClaudeMem, type ClaudeMemPresence } from '../../src/services/migration/claude-mem-migration.js';

/**
 * Exercises the destructive purge orchestration end-to-end against temp
 * directories. CLAUDE_CONFIG_DIR redirects the plugin registries; a fabricated
 * `presence` points the data dir + marketplace dir at throwaway paths. No real
 * claude-mem processes exist in the test environment, so the process-stop step
 * is a safe no-op.
 */
describe('purgeClaudeMem', () => {
  let cfgDir: string;
  let dataDir: string;
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env.CLAUDE_CONFIG_DIR;
    cfgDir = mkdtempSync(join(tmpdir(), 'cm-purge-cfg-'));
    process.env.CLAUDE_CONFIG_DIR = cfgDir;
    mkdirSync(join(cfgDir, 'plugins'), { recursive: true });

    // A fabricated claude-mem data dir with a marker file inside.
    dataDir = mkdtempSync(join(tmpdir(), 'cm-purge-data-'));
    writeFileSync(join(dataDir, 'claude-mem.db'), 'stub');

    // Registries referencing claude-mem under the "thedotmack" marketplace.
    writeFileSync(
      join(cfgDir, 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'claude-mem@thedotmack': { version: '1.0' }, 'keepmind@keepmind': {} } }),
    );
    writeFileSync(join(cfgDir, 'plugins', 'known_marketplaces.json'), JSON.stringify({ thedotmack: {}, keepmind: {} }));
    writeFileSync(join(cfgDir, 'settings.json'), JSON.stringify({ enabledPlugins: { 'claude-mem@thedotmack': true } }));
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
    rmSync(cfgDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('archives, deregisters the plugin/marketplace, and removes the data dir', async () => {
    const marketplaceDir = join(cfgDir, 'plugins', 'marketplaces', 'thedotmack');
    mkdirSync(marketplaceDir, { recursive: true });
    writeFileSync(join(marketplaceDir, 'marker'), 'x');

    const presence: ClaudeMemPresence = {
      installed: true,
      dataDir,
      dbPath: join(dataDir, 'claude-mem.db'),
      hasData: true,
      counts: null,
      pluginKeys: ['claude-mem@thedotmack'],
      marketplaceKeys: ['thedotmack'],
      marketplaceDirs: [marketplaceDir],
    };

    const report = await purgeClaudeMem({ timestamp: '2026-07-01T00:00:00.000Z', presence });

    // Data dir removed, backup archive created and on disk.
    expect(report.dataDirRemoved).toBe(true);
    expect(existsSync(dataDir)).toBe(false);
    expect(report.archivePath).toBeTruthy();
    expect(existsSync(report.archivePath as string)).toBe(true);

    // Marketplace directory gone.
    expect(existsSync(marketplaceDir)).toBe(false);
    expect(report.marketplacesRemoved).toContain(marketplaceDir);

    // Registry entries for claude-mem removed; keepmind's left intact.
    const installed = JSON.parse(readFileSync(join(cfgDir, 'plugins', 'installed_plugins.json'), 'utf-8'));
    expect(installed.plugins['claude-mem@thedotmack']).toBeUndefined();
    expect(installed.plugins['keepmind@keepmind']).toBeDefined();

    const known = JSON.parse(readFileSync(join(cfgDir, 'plugins', 'known_marketplaces.json'), 'utf-8'));
    expect(known.thedotmack).toBeUndefined();
    expect(known.keepmind).toBeDefined();

    const settings = JSON.parse(readFileSync(join(cfgDir, 'settings.json'), 'utf-8'));
    expect(settings.enabledPlugins['claude-mem@thedotmack']).toBeUndefined();

    expect(report.pluginsRemoved).toContain('claude-mem@thedotmack');
  });
});
