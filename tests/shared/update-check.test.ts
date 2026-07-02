import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from '../../src/shared/paths.js';
import { readUpdateHint, refreshUpdateCacheInBackground } from '../../src/shared/update-check.js';

// Under tsx (no esbuild define) the build version resolves to the '0.0.0-dev'
// fallback → effectively [0,0,0]. So any real cached version reads as "newer",
// and '0.0.0' reads as "not newer" — enough to exercise the compare + TTL/stale
// gating without depending on the injected package version.
const CACHE_PATH = join(DATA_DIR, '.update-check.json');
const DAY = 24 * 60 * 60 * 1000;

function writeCache(latestVersion: string, checkedAtEpoch: number): void {
  writeFileSync(CACHE_PATH, JSON.stringify({ latestVersion, checkedAtEpoch }));
}

describe('readUpdateHint (hook-side, no network)', () => {
  const NOW = 1_000_000_000_000;
  beforeEach(() => { try { rmSync(CACHE_PATH, { force: true }); } catch { /* none */ } });
  afterEach(() => { try { rmSync(CACHE_PATH, { force: true }); } catch { /* none */ } });

  it('returns null when there is no cache', () => {
    expect(readUpdateHint(NOW)).toBeNull();
  });

  it('surfaces a hint (with version + update command) when npm is newer than this build', () => {
    writeCache('1.3.2', NOW);
    const hint = readUpdateHint(NOW);
    expect(hint).toBeTruthy();
    expect(hint!).toContain('1.3.2');
    expect(hint!).toContain('npx keepmind@latest update');
  });

  it('returns null when the cached version is not newer than this build', () => {
    writeCache('0.0.0', NOW);
    expect(readUpdateHint(NOW)).toBeNull();
  });

  it('ignores a cache older than a week (too stale to trust)', () => {
    writeCache('1.3.2', NOW - 8 * DAY);
    expect(readUpdateHint(NOW)).toBeNull();
  });

  it('does not throw on a corrupt cache file', () => {
    writeFileSync(CACHE_PATH, '{not json');
    expect(readUpdateHint(NOW)).toBeNull();
  });
});

describe('refreshUpdateCacheInBackground (worker-side, best-effort)', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => { try { rmSync(CACHE_PATH, { force: true }); } catch { /* none */ } });
  afterEach(() => { globalThis.fetch = realFetch; try { rmSync(CACHE_PATH, { force: true }); } catch { /* none */ } });

  it('fetches and writes the cache when none exists', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })) as typeof fetch;
    refreshUpdateCacheInBackground(2_000_000_000_000);
    // fire-and-forget: let the background microtasks settle
    await new Promise(r => setTimeout(r, 50));
    expect(existsSync(CACHE_PATH)).toBe(true);
    const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    expect(cache.latestVersion).toBe('9.9.9');
  });

  it('does NOT re-fetch when the cache is still within its TTL', async () => {
    const NOW = 2_000_000_000_000;
    writeCache('1.0.0', NOW - 1000); // written 1s ago → fresh
    let fetched = false;
    globalThis.fetch = (async () => { fetched = true; return new Response('{}', { status: 200 }); }) as typeof fetch;
    refreshUpdateCacheInBackground(NOW);
    await new Promise(r => setTimeout(r, 30));
    expect(fetched).toBe(false);
    // cache untouched
    expect(JSON.parse(readFileSync(CACHE_PATH, 'utf-8')).latestVersion).toBe('1.0.0');
  });

  it('stays silent (no throw, no cache) when the registry fetch fails', async () => {
    globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
    expect(() => refreshUpdateCacheInBackground(3_000_000_000_000)).not.toThrow();
    await new Promise(r => setTimeout(r, 30));
    expect(existsSync(CACHE_PATH)).toBe(false);
  });
});
