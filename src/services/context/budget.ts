// SPDX-License-Identifier: Apache-2.0
//
// Phase 4 / Step 3 — capped injection budget. Greedily fills a hard token
// budget from score-ranked rows, skipping rows that would overflow (so a few
// smaller, lower-ranked rows can still slot in after a large one is skipped).

import type { Observation } from './types.js';
import { calculateObservationTokens } from './TokenCalculator.js';
import { scoreObservation } from '../scoring/importance.js';

export interface RankBudgetOptions {
  tokenBudget: number;
  halfLifeDays: number;
  /** Cap on the number of rows returned (e.g. config.totalObservationCount). */
  maxRows: number;
  now?: number;
}

/** Estimate the injected token cost of one observation. */
export function estimateTokens(obs: Observation): number {
  return calculateObservationTokens(obs);
}

/**
 * Greedily select rows (already score-desc) under a token budget. Rows that
 * would overflow are skipped, not stopped-on — later, cheaper rows still fit.
 */
export function selectWithinBudget(rows: Observation[], maxTokens: number): Observation[] {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return rows;
  const out: Observation[] = [];
  let used = 0;
  for (const r of rows) {
    const cost = estimateTokens(r);
    if (used + cost > maxTokens) continue;
    out.push(r);
    used += cost;
  }
  return out;
}

/**
 * Rank a candidate pool by importance × recency, apply the token budget and row
 * cap, then return the survivors re-sorted by recency (created_at_epoch DESC) so
 * downstream "most recent" semantics and timeline rendering are preserved.
 */
export function rankAndBudget(
  candidates: Array<Observation & { importance?: number | null }>,
  opts: RankBudgetOptions
): Observation[] {
  const now = opts.now ?? Date.now();
  const scored = candidates
    .map((o) => ({ o, score: scoreObservation(o, { now, halfLifeDays: opts.halfLifeDays }) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.o);

  const capped = opts.maxRows > 0 ? scored.slice(0, opts.maxRows) : scored;
  const budgeted = selectWithinBudget(capped, opts.tokenBudget);

  return budgeted.sort((a, b) => (b.created_at_epoch ?? 0) - (a.created_at_epoch ?? 0));
}
