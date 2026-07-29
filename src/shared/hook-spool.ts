// SPDX-License-Identifier: Apache-2.0
//
// Durable buffer for hook API calls the worker could not accept yet.
//
// A hook is a short-lived process with no retry: when the worker was alive but
// not yet READY, executeWithWorkerFallback returned "continue" and the payload
// was gone. In practice that is not a rare edge — during a vector backfill (a
// 700 MB worker) a dozen calls were dropped inside a few minutes, each one an
// observation the user will never get back. The hook cannot wait (it would stall
// the editor) and cannot retry (it is about to exit), so the only place the data
// can survive is disk.
//
// Only write-path calls are spooled. Replaying a context INJECTION would be
// pointless — that moment has passed and the answer went nowhere — so the
// whitelist below is deliberate, not incidental: an entry belongs here when
// losing it loses data, and when replaying it late is still correct.
//
// The second condition is the sharp one. keepmind previously HAD a durable
// replay queue and removed it: SessionMessageBuffer's header records that
// persisting tool-use fragments and replaying them into the stateful,
// non-deterministic reducer "regenerated different/duplicate observations or
// looped forever — that was the retry storm." This spool is not that, and must
// not become it. It holds only payloads the worker demonstrably never accepted
// — no worker reachable, or an explicit 429 refusal — so there is no reducer
// state to resurrect and a replay is indistinguishable from the hook having
// arrived a moment later. Callers must never spool an ambiguous outcome (a 5xx,
// a timeout mid-request); dropping one observation is strictly better than
// re-creating the storm.

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.js';
import { logger } from '../utils/logger.js';

const SPOOL_DIR = join(DATA_DIR, 'spool');

// Bounds. The spool must never become its own disk problem: a worker that never
// comes back would otherwise queue forever.
const MAX_ENTRIES = 1000;
const MAX_BODY_BYTES = 512 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

/**
 * Routes whose payload is worth replaying after the fact. These are all writes,
 * and all tolerate arriving late: observations and summaries are content-hashed
 * server-side, so a double delivery de-duplicates rather than duplicating.
 *
 * NOT included, on purpose:
 *   /api/context/inject, /api/context/semantic — reads; the caller is gone.
 *   /api/session/acquire                       — a refcount for a session that
 *                                                has since ended; replaying it
 *                                                would leak the count upward.
 */
const REPLAYABLE_ROUTES = new Set([
  '/api/sessions/observations',
  '/api/sessions/summarize',
  '/api/sessions/init',
  '/api/memory/save',
]);

export interface SpoolEntry {
  url: string;
  method: string;
  body: unknown;
  queuedAtEpoch: number;
  attempts: number;
}

export function isReplayableRoute(url: string): boolean {
  // Compare the path only — some callers append a query string.
  const path = url.split('?')[0];
  return REPLAYABLE_ROUTES.has(path);
}

function entryFiles(): string[] {
  try {
    // The filename is `<epoch>-<pid>-<counter>.json`; epoch is zero-padded at
    // write time so a plain lexicographic sort is chronological.
    return readdirSync(SPOOL_DIR).filter(n => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

let writeCounter = 0;

/**
 * Persist one undeliverable call. Best-effort in the strongest sense: this runs
 * inside a hook, so any throw here would surface as a hook failure — losing the
 * observation AND disrupting the user's turn, strictly worse than the drop we
 * are trying to prevent.
 */
export function spoolWorkerCall(url: string, method: string, body: unknown): boolean {
  try {
    if (method === 'GET' || !isReplayableRoute(url)) return false;

    const serialized = JSON.stringify({
      url,
      method,
      body,
      queuedAtEpoch: Date.now(),
      attempts: 0,
    } satisfies SpoolEntry);

    if (serialized.length > MAX_BODY_BYTES) {
      logger.debug('HOOK', 'Spool entry exceeds size cap; dropping', { url, bytes: serialized.length });
      return false;
    }

    mkdirSync(SPOOL_DIR, { recursive: true });

    const existing = entryFiles();
    if (existing.length >= MAX_ENTRIES) {
      // Oldest-first eviction: a stuck worker should keep the most recent work,
      // which is the work the user is most likely to still care about.
      for (const stale of existing.slice(0, existing.length - MAX_ENTRIES + 1)) {
        try { unlinkSync(join(SPOOL_DIR, stale)); } catch { /* already gone */ }
      }
    }

    const name = `${String(Date.now()).padStart(15, '0')}-${process.pid}-${writeCounter++}.json`;
    // Write-then-rename: the drain runs in another process and must never read a
    // half-written entry.
    const tmp = join(SPOOL_DIR, `.${name}.tmp`);
    writeFileSync(tmp, serialized, 'utf-8');
    renameSync(tmp, join(SPOOL_DIR, name));
    return true;
  } catch (error) {
    logger.debug('HOOK', 'Failed to spool worker call', {
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export interface DrainResult {
  replayed: number;
  dropped: number;
  deferred: number;
}

export type SpoolDispatch = (entry: SpoolEntry) => Promise<{ ok: boolean; permanent: boolean }>;

/**
 * WORKER-side. Replay everything the hooks could not deliver, oldest first.
 *
 * Three outcomes per entry: delivered (delete), permanently rejected (delete —
 * retrying a 4xx forever just fills the disk), or transiently failed (keep, and
 * count the attempt so a poison entry cannot block the queue indefinitely).
 */
export async function drainHookSpool(dispatch: SpoolDispatch): Promise<DrainResult> {
  const result: DrainResult = { replayed: 0, dropped: 0, deferred: 0 };
  if (!existsSync(SPOOL_DIR)) return result;

  const now = Date.now();

  for (const name of entryFiles()) {
    const path = join(SPOOL_DIR, name);
    let entry: SpoolEntry;
    try {
      entry = JSON.parse(readFileSync(path, 'utf-8')) as SpoolEntry;
    } catch {
      // Corrupt or truncated — unrecoverable, and keeping it would re-fail forever.
      try { unlinkSync(path); } catch { /* already gone */ }
      result.dropped++;
      continue;
    }

    if (!entry?.url || now - (entry.queuedAtEpoch ?? 0) > MAX_AGE_MS || !isReplayableRoute(entry.url)) {
      try { unlinkSync(path); } catch { /* already gone */ }
      result.dropped++;
      continue;
    }

    try {
      const outcome = await dispatch(entry);
      if (outcome.ok) {
        try { unlinkSync(path); } catch { /* already gone */ }
        result.replayed++;
        continue;
      }
      if (outcome.permanent || (entry.attempts ?? 0) + 1 >= MAX_ATTEMPTS) {
        try { unlinkSync(path); } catch { /* already gone */ }
        result.dropped++;
        continue;
      }
      writeFileSync(path, JSON.stringify({ ...entry, attempts: (entry.attempts ?? 0) + 1 }), 'utf-8');
      result.deferred++;
    } catch (error) {
      logger.debug('WORKER', 'Spool replay threw; leaving entry for the next drain', {
        url: entry.url,
        error: error instanceof Error ? error.message : String(error),
      });
      result.deferred++;
    }
  }

  if (result.replayed > 0 || result.dropped > 0) {
    logger.info('WORKER', 'Replayed buffered hook calls', result);
  }
  return result;
}

/** Number of entries currently waiting. Used by `doctor` and tests. */
export function spoolDepth(): number {
  return entryFiles().length;
}

/** Test hook: empty the spool directory. */
export function resetHookSpoolForTesting(): void {
  for (const name of entryFiles()) {
    try { unlinkSync(join(SPOOL_DIR, name)); } catch { /* already gone */ }
  }
}
