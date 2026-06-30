// SPDX-License-Identifier: Apache-2.0
//
// Phase 4 / Step 3 — heuristic importance scoring + recency-decayed ranking.
// Pure functions, no I/O, unit-testable in isolation. Importance is a 1..10
// integer computed at write time; an optional LLM refinement is deferred to the
// optimizer (Step 7) so the write path stays cheap and synchronous.

export interface ScorableObservation {
  type?: string | null;
  narrative?: string | null;
  files_modified?: unknown;
  created_at_epoch?: number;
  importance?: number | null;
}

// Higher = more worth keeping/injecting. `global` is a pinned user fact.
const TYPE_WEIGHT: Record<string, number> = {
  decision: 9,
  bugfix: 8,
  refactor: 6,
  discovery: 5,
  global: 7,
  other: 3,
  trivial: 1,
};

function fileCount(files: unknown): number {
  if (Array.isArray(files)) return files.length;
  if (typeof files === 'string') {
    try {
      const parsed = JSON.parse(files);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

/** Heuristic default importance (1..10) for a freshly-written observation. */
export function defaultImportance(o: ScorableObservation): number {
  let s = TYPE_WEIGHT[(o.type ?? 'other')] ?? 4;
  if (fileCount(o.files_modified) > 0) s += 1;            // touched code = more important
  const nlen = o.narrative?.length ?? 0;
  if (nlen < 40) s -= 1;                                   // tiny note = less
  if (/\b(TODO|FIXME|WIP)\b/i.test(o.narrative ?? '')) s -= 1;
  return Math.max(1, Math.min(10, s));
}

export const DEFAULT_HALF_LIFE_DAYS = 14;
const DAY_MS = 86_400_000;

/**
 * Combined ranking score = (importance/10) × recency_decay.
 * recency_decay = 0.5 ^ (age / halfLife) — exponential half-life, computed in JS
 * (no dependency on SQLite math functions / EXP being compiled in).
 */
export function scoreObservation(
  o: ScorableObservation,
  opts: { now?: number; halfLifeDays?: number } = {}
): number {
  const now = opts.now ?? Date.now();
  const halfLifeMs = (opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS) * DAY_MS;
  const imp = (o.importance ?? 5) / 10;
  const ageMs = Math.max(0, now - (o.created_at_epoch ?? now));
  const recency = Math.pow(0.5, ageMs / halfLifeMs);
  return imp * recency;
}
