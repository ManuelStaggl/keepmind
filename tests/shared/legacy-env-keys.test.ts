
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager.js';
import { envValue, settingValue, legacyKeyFor, hasLegacyKeys } from '../../src/shared/legacy-env.js';

// keepmind renamed its configuration prefix from CLAUDE_MEM_* to KEEPMIND_*.
// Installs that predate the rename must keep working: dropping their values
// would silently reset a configured install to defaults (wrong worker port, a
// re-enabled vector store) with nothing in the log to explain it.
describe('legacy CLAUDE_MEM_* configuration compatibility', () => {
  let tempDir: string;
  let settingsPath: string;
  let prevDataDirEnv: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `legacy-env-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    settingsPath = join(tempDir, 'settings.json');
    // Same reason as settings-defaults-manager.test.ts: the preload tripwire
    // pins KEEPMIND_DATA_DIR, and env overrides are applied on top of file values.
    prevDataDirEnv = process.env.KEEPMIND_DATA_DIR;
    delete process.env.KEEPMIND_DATA_DIR;
  });

  afterEach(() => {
    if (prevDataDirEnv === undefined) delete process.env.KEEPMIND_DATA_DIR;
    else process.env.KEEPMIND_DATA_DIR = prevDataDirEnv;
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('key mapping', () => {
    it('maps a canonical key to its pre-rename spelling', () => {
      expect(legacyKeyFor('KEEPMIND_WORKER_PORT')).toBe('CLAUDE_MEM_WORKER_PORT');
    });

    it('leaves keys keepmind does not own alone', () => {
      // CLAUDE_CODE_PATH is a Claude Code setting keepmind reads but never renamed.
      expect(legacyKeyFor('CLAUDE_CODE_PATH')).toBeNull();
      expect(legacyKeyFor('ANTHROPIC_API_KEY')).toBeNull();
    });
  });

  describe('environment variables', () => {
    it('reads the legacy spelling when the canonical one is unset', () => {
      expect(envValue('KEEPMIND_WORKER_PORT', { CLAUDE_MEM_WORKER_PORT: '37999' })).toBe('37999');
    });

    it('prefers the canonical spelling when both are set', () => {
      const env = { KEEPMIND_WORKER_PORT: '37700', CLAUDE_MEM_WORKER_PORT: '37999' };
      expect(envValue('KEEPMIND_WORKER_PORT', env)).toBe('37700');
    });

    it('honours an explicitly empty canonical value instead of falling through', () => {
      // '' is a deliberate "unset this" for keys like KEEPMIND_TIER_SUMMARY_MODEL;
      // falling back to the legacy value would resurrect a setting the user cleared.
      const env = { KEEPMIND_TIER_SUMMARY_MODEL: '', CLAUDE_MEM_TIER_SUMMARY_MODEL: 'sonnet' };
      expect(envValue('KEEPMIND_TIER_SUMMARY_MODEL', env)).toBe('');
    });

    it('returns undefined when neither spelling is present', () => {
      expect(envValue('KEEPMIND_WORKER_PORT', {})).toBeUndefined();
    });
  });

  describe('settings.json', () => {
    it('reads values written under the pre-rename key names', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_WORKER_PORT: '37999',
        CLAUDE_MEM_LOG_LEVEL: 'DEBUG',
      }));

      const result = SettingsDefaultsManager.loadFromFile(settingsPath, false);

      expect(result.KEEPMIND_WORKER_PORT).toBe('37999');
      expect(result.KEEPMIND_LOG_LEVEL).toBe('DEBUG');
    });

    it('rewrites the file to canonical keys once', () => {
      writeFileSync(settingsPath, JSON.stringify({ CLAUDE_MEM_WORKER_PORT: '37999' }));

      SettingsDefaultsManager.loadFromFile(settingsPath, false);

      const onDisk = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      expect(onDisk.KEEPMIND_WORKER_PORT).toBe('37999');
      expect(onDisk.CLAUDE_MEM_WORKER_PORT).toBeUndefined();
    });

    it('lets a canonical value win over a stale legacy one', () => {
      writeFileSync(settingsPath, JSON.stringify({
        KEEPMIND_WORKER_PORT: '37700',
        CLAUDE_MEM_WORKER_PORT: '37999',
      }));

      const result = SettingsDefaultsManager.loadFromFile(settingsPath, false);
      expect(result.KEEPMIND_WORKER_PORT).toBe('37700');

      const onDisk = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      expect(onDisk.KEEPMIND_WORKER_PORT).toBe('37700');
      expect(onDisk.CLAUDE_MEM_WORKER_PORT).toBeUndefined();
    });

    it('preserves keys the migration does not own', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_WORKER_PORT: '37999',
        CLAUDE_CODE_PATH: '/usr/local/bin/claude',
        KEEPMIND_SOME_FUTURE_KEY: 'keep me',
      }));

      SettingsDefaultsManager.loadFromFile(settingsPath, false);

      const onDisk = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      expect(onDisk.CLAUDE_CODE_PATH).toBe('/usr/local/bin/claude');
      expect(onDisk.KEEPMIND_SOME_FUTURE_KEY).toBe('keep me');
    });

    it('leaves an already-canonical file untouched', () => {
      const canonical = { KEEPMIND_WORKER_PORT: '37700' };
      writeFileSync(settingsPath, JSON.stringify(canonical, null, 2));
      const before = readFileSync(settingsPath, 'utf-8');

      SettingsDefaultsManager.loadFromFile(settingsPath, false);

      expect(readFileSync(settingsPath, 'utf-8')).toBe(before);
    });
  });

  describe('helpers', () => {
    it('detects a settings object that still carries pre-rename keys', () => {
      expect(hasLegacyKeys({ CLAUDE_MEM_LOG_LEVEL: 'DEBUG' })).toBe(true);
      expect(hasLegacyKeys({ KEEPMIND_LOG_LEVEL: 'DEBUG' })).toBe(false);
      expect(hasLegacyKeys({ CLAUDE_CODE_PATH: '/x' })).toBe(false);
    });

    it('resolves a setting through the legacy spelling', () => {
      expect(settingValue<string>('KEEPMIND_LOG_LEVEL', { CLAUDE_MEM_LOG_LEVEL: 'DEBUG' })).toBe('DEBUG');
    });
  });
});
