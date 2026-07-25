// SPDX-License-Identifier: Apache-2.0
//
// Phase 4 / Step 3 — capped injection budget. Greedily fills a hard token
// budget from score-ranked rows, skipping rows that would overflow (so a few
// smaller, lower-ranked rows can still slot in after a large one is skipped).

import type { Observation } from './types.js';
import { CHARS_PER_TOKEN_ESTIMATE } from './types.js';
import { calculateObservationTokens } from './TokenCalculator.js';
import { scoreObservation } from '../scoring/importance.js';

export interface RankBudgetOptions {
  tokenBudget: number;
  halfLifeDays: number;
  /** Cap on the number of rows returned (e.g. config.totalObservationCount). */
  maxRows: number;
  now?: number;
}

/**
 * Estimate the injected token cost of one observation.
 *
 * This must model what is actually INJECTED, not what is stored. The agent
 * context renders one headline per observation (`ID TIME ICON TITLE`) and leaves
 * narrative/facts to be fetched on demand — but this used to charge the budget
 * for the whole record (title + subtitle + narrative + all facts, ~350 tokens
 * each). Measured effect: a 4000-token budget admitted 11 of 439 candidates
 * while the rendered block came to ~900 tokens. Charging the rendered line
 * instead fits 40-50 headlines into the same real footprint, so a session sees
 * far more of its own timeline for the same money.
 */
export function estimateTokens(obs: Observation): number {
  return estimateRenderedTokens(obs);
}

/** Fixed per-line overhead of the rendered headline: id, time, icon, separators. */
const RENDERED_LINE_OVERHEAD_CHARS = 20;

function estimateRenderedTokens(obs: Observation): number {
  const titleChars = (obs.title?.length ?? 'Untitled'.length) + RENDERED_LINE_OVERHEAD_CHARS;
  return Math.max(1, Math.ceil(titleChars / CHARS_PER_TOKEN_ESTIMATE));
}

/** Full stored size of an observation — what a `get_observations` fetch would cost. */
export function estimateStoredTokens(obs: Observation): number {
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
