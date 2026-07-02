// SPDX-License-Identifier: Apache-2.0
//
// Proactive in-session update notice. Two halves, split so the hot path never
// touches the network:
//   • WORKER (long-lived): refreshUpdateCacheInBackground() — at most once per
//     TTL, fire-and-forget, fetches the latest published keepmind version and
//     caches it. Never throws; offline/proxy failures are silent.
//   • HOOK (short-lived, per SessionStart): readUpdateHint() — a pure local
//     file read + semver compare against THIS build's version. No network, so
//     it can't slow or hang a session. Returns a one-line hint when npm has a
//     newer release, else null.
//
// The hint compares the cached npm version against the LIVE build version
// (__DEFAULT_PACKAGE_VERSION__), not a cached "updateAvailable" flag — so right
// after `npx keepmind update` the notice disappears immediately, with no stale
// false-positive, even before the worker refreshes the cache again.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.js';
import { logger } from '../utils/logger.js';

declare const __DEFAULT_PACKAGE_VERSION__: string;
const CURRENT_VERSION = typeof __DEFAULT_PACKAGE_VERSION__ !== 'undefined' ? __DEFAULT_PACKAGE_VERSION__ : '0.0.0-dev';

const NPM_LATEST_URL = 'https://registry.npmjs.org/keepmind/latest';
const CACHE_PATH = join(DATA_DIR, '.update-check.json');
const TTL_MS = 24 * 60 * 60 * 1000;        // re-check npm at most once/day
const STALE_MS = 7 * 24 * 60 * 60 * 1000;  // ignore a cache older than a week
const FETCH_TIMEOUT_MS = 3000;

interface UpdateCache { latestVersion: string; checkedAtEpoch: number; }

function normalize(v: string): string { return v.replace(/^v/, '').trim(); }

/** Numeric x.y.z compare (prerelease tags ignored). >0 if `a` is newer than `b`. */
function compareVersions(a: string, b: string): number {
  const pa = normalize(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = normalize(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function readCache(): UpdateCache | null {
  try {
    if (!existsSync(CACHE_PATH)) return null;
    const c = JSON.parse(readFileSync(CACHE_PATH, 'utf-8')) as Partial<UpdateCache>;
    if (c && typeof c.latestVersion === 'string' && typeof c.checkedAtEpoch === 'number') {
      return { latestVersion: c.latestVersion, checkedAtEpoch: c.checkedAtEpoch };
    }
  } catch { /* corrupt/unreadable — treat as no cache */ }
  return null;
}

/**
 * HOOK-side (no network). One-line SessionStart hint when a newer keepmind is on
 * npm than the running build, else null. Compares against the LIVE build version
 * so it self-clears immediately after an update.
 */
export function readUpdateHint(now: number = Date.now()): string | null {
  const cache = readCache();
  if (!cache) return null;
  if (now - cache.checkedAtEpoch > STALE_MS) return null;         // too old to trust
  if (compareVersions(cache.latestVersion, CURRENT_VERSION) <= 0) return null;
  return `📦 keepmind ${normalize(cache.latestVersion)} is available (you have ${normalize(CURRENT_VERSION)}). ` +
    `Update with \`npx keepmind@latest update\`, then restart your editor.`;
}

let refreshInFlight = false;

/**
 * WORKER-side (best-effort, non-blocking). Refresh the npm-latest cache at most
 * once per TTL. Fire-and-forget: returns immediately; the fetch resolves in the
 * background and can never block or fail the caller.
 */
export function refreshUpdateCacheInBackground(now: number = Date.now()): void {
  try {
    if (refreshInFlight) return;
    const cache = readCache();
    if (cache && now - cache.checkedAtEpoch < TTL_MS) return;     // still fresh
    refreshInFlight = true;
    void (async () => {
      try {
        const res = await fetch(NPM_LATEST_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!res.ok) return;
        const body = await res.json() as { version?: string };
        const latest = typeof body.version === 'string' ? body.version.trim() : '';
        if (!latest) return;
        mkdirSync(DATA_DIR, { recursive: true });
        writeFileSync(CACHE_PATH, JSON.stringify({ latestVersion: normalize(latest), checkedAtEpoch: now }));
        if (compareVersions(latest, CURRENT_VERSION) > 0) {
          logger.info('SYSTEM', 'keepmind update available', { current: normalize(CURRENT_VERSION), latest: normalize(latest) });
        }
      } catch {
        // offline / corporate proxy / registry error — silent; retried after TTL.
      } finally {
        refreshInFlight = false;
      }
    })();
  } catch {
    refreshInFlight = false;
  }
}
