import { describe, it, expect } from 'bun:test';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager.js';
import { DATA_DIR } from '../../src/shared/paths.js';
import { DEFAULT_CONFIG_PATH } from '../../src/services/transcripts/config.js';

/**
 * Where the transcript-watch configuration lives is derived from DATA_DIR, in
 * `paths.ts`. The settings default spelled the same path out as a literal
 * under the home directory — a second statement of the DEFAULT of
 * KEEPMIND_DATA_DIR, agreeing with the first only for as long as nobody moved
 * the data directory.
 *
 * Measured: a worker started with KEEPMIND_DATA_DIR pointing at a scratch
 * directory read the REAL machine's transcript configuration, and said so in
 * its log while nothing else about the run looked wrong. It also made the
 * `|| DEFAULT_CONFIG_PATH` fallback at the single place that reads the setting
 * unreachable, because a populated default is never falsy.
 */
describe('transcript watch config path', () => {
  it('has no default of its own, so the DATA_DIR-derived path is reachable', () => {
    expect(SettingsDefaultsManager.getAllDefaults().KEEPMIND_TRANSCRIPTS_CONFIG_PATH).toBe('');
  });

  it('resolves under the data directory, wherever that is', () => {
    expect(DEFAULT_CONFIG_PATH.startsWith(DATA_DIR)).toBe(true);
  });

  // The failure this guards against is not "wrong string" but "a literal that
  // stops following the data directory".
  it('is not pinned to the home directory by a literal', () => {
    const source = SettingsDefaultsManager.getAllDefaults().KEEPMIND_TRANSCRIPTS_CONFIG_PATH;
    expect(source).not.toContain('.keepmind');
  });
});
