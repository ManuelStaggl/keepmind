// SPDX-License-Identifier: Apache-2.0
//
// Visibility for a degraded vector store.
//
// sqlite-vec ships a per-platform native binary and therefore cannot be bundled
// into the worker — it must resolve from node_modules at runtime. When it does
// not (a `claude plugin update` refreshes plugin files WITHOUT running an
// install, and the self-repair needs a Bun that may be absent), semantic search
// silently falls back to keyword/FTS. In a real install that state persisted for
// WEEKS across two major versions: thousands of ERROR lines a day, and not one
// of them reachable by the person using the tool. The only symptom visible from
// the outside is search quietly getting worse.
//
// Same split as update-check.ts, for the same reason:
//   • WORKER (long-lived): records the outcome of its vector-store load.
//   • HOOK (short-lived, per SessionStart): a pure local file read, no network
//     and no worker round-trip, so it can never slow or hang a session.
//
// The marker is written on EVERY worker boot — including the healthy case, which
// deletes it — so a fixed install stops warning immediately rather than waiting
// out a TTL.

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.js';

const MARKER_PATH = join(DATA_DIR, '.vector-health.json');

// A marker from a worker that has not run for a week is not evidence about the
// worker running now; ignore it rather than nag forever after an uninstall.
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface VectorHealthMarker {
  /** Short machine-readable cause, e.g. 'deps_missing' | 'load_failed'. */
  reason: string;
  /** First line of the underlying error, for the log/doctor output. */
  detail: string;
  /** What the user should actually do about it. */
  remediation: string;
  recordedAtEpoch: number;
}

/**
 * WORKER-side. Record that the vector store failed to load. Best-effort: a
 * failure to write the marker must never escalate into a worker boot failure.
 */
export function recordVectorDegraded(reason: string, detail: string, remediation: string): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    const marker: VectorHealthMarker = {
      reason,
      detail: detail.split('\n')[0].slice(0, 300),
      remediation,
      recordedAtEpoch: Date.now(),
    };
    writeFileSync(MARKER_PATH, JSON.stringify(marker));
  } catch {
    // Visibility is best-effort; never break the worker over it.
  }
}

/**
 * WORKER-side. Clear the marker — the vector store is up. Called on every
 * successful load (boot and post-self-repair) so recovery is immediate.
 */
export function clearVectorDegraded(): void {
  try {
    if (existsSync(MARKER_PATH)) unlinkSync(MARKER_PATH);
  } catch {
    // Same: best-effort.
  }
}

/** Raw marker read, or null when absent/corrupt/stale. Used by doctor + hooks. */
export function readVectorHealthMarker(now: number = Date.now()): VectorHealthMarker | null {
  try {
    if (!existsSync(MARKER_PATH)) return null;
    const raw = JSON.parse(readFileSync(MARKER_PATH, 'utf-8')) as Partial<VectorHealthMarker>;
    if (typeof raw?.reason !== 'string' || typeof raw?.recordedAtEpoch !== 'number') return null;
    if (now - raw.recordedAtEpoch > STALE_MS) return null;
    return {
      reason: raw.reason,
      detail: typeof raw.detail === 'string' ? raw.detail : '',
      remediation: typeof raw.remediation === 'string' ? raw.remediation : '',
      recordedAtEpoch: raw.recordedAtEpoch,
    };
  } catch {
    return null;
  }
}

/**
 * HOOK-side (no network, no worker call). One-line SessionStart hint when
 * semantic search is degraded, else null.
 */
export function readVectorHealthHint(now: number = Date.now()): string | null {
  const marker = readVectorHealthMarker(now);
  if (!marker) return null;
  const remediation = marker.remediation ? ` ${marker.remediation}` : '';
  return `⚠ keepmind: semantic search is DEGRADED — memory search is running on keywords only ` +
    `(${marker.reason}).${remediation}`;
}

/** Test hook: remove the marker file regardless of state. */
export function resetVectorHealthForTesting(): void {
  clearVectorDegraded();
}
