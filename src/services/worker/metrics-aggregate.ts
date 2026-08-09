// SPDX-License-Identifier: Apache-2.0
//
// Reading the cost records back. The writing half lives in session-metrics.ts;
// this half is what `npx keepmind metrics` runs, and it is deliberately free of
// the worker's logger and append path so the CLI does not drag them in.
//
// WHY THIS IS CODE AND NOT A DOCUMENTED ONE-LINER
// ----------------------------------------------
// 3.4.1 shipped the metrics file with a snippet for reading it:
//
//     … | Measure-Object -Property tokensPerTurn -Average
//
// Both halves of that are wrong, and both were caught in the field on the same
// day the file shipped:
//
//  - `tokensPerTurn` is null when a session dispatched nothing — deliberately,
//    because 0 would drag the result toward a figure nobody was charged.
//    Measure-Object counts the null as zero anyway. On three records reporting
//    12000 / null / 10000 it answers 7333.
//  - Even with nulls removed, averaging per-record values weights a session
//    with two compressions the same as one with two hundred. The observed
//    spread is exactly that: many very short runs, a few long ones. The same
//    three records give 11000 that way, and 10200 as Σ billed ÷ Σ turns.
//
// A measurement people assemble by hand gets assembled differently each time.
// This is the one definition: sums divided by sums, never an average of
// averages, and nothing null folded in as a zero.

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { LOGS_DIR } from '../../shared/paths.js';
import { METRICS_SCHEMA_VERSION } from './session-metrics.js';

export interface MetricsAggregate {
  /** Records that contributed to the totals. */
  records: number;
  /** Records skipped because they predate the current schema. */
  skippedOldSchema: number;
  /** Distinct host sessions behind those records — see contentSessionId. */
  sessions: number;
  compressionTurns: number;
  gatedBatches: number;
  skippedBatches: number;
  observationsProduced: number;
  inputTokens: number;
  cacheReadInputTokens: number;
  outputTokens: number;
  billedTokens: number;
  /** Σ billed / Σ turns — NOT the mean of the per-record values. */
  tokensPerTurn: number | null;
  /** Σ gated / Σ(turns + gated) — likewise a ratio of sums. */
  gatedShare: number;
}

const METRICS_FILE_RE = /^metrics-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Days that have a metrics file, oldest first. Empty when none exist yet. */
export function listMetricsDays(): string[] {
  try {
    if (!existsSync(LOGS_DIR)) return [];
    return readdirSync(LOGS_DIR)
      .map((name) => METRICS_FILE_RE.exec(name)?.[1])
      .filter((day): day is string => !!day)
      .sort();
  } catch {
    return [];
  }
}

export interface MetricsDay {
  records: Array<Record<string, unknown>>;
  /**
   * Lines that could not be parsed. Counted rather than swallowed: a file being
   * appended to by a live worker can have a partial last line, which is
   * harmless — but silently dropping ten of them would understate the day's
   * cost while still looking like a complete answer.
   */
  unreadableLines: number;
}

/** Parse one day's records, reporting how many lines had to be skipped. */
export function readMetricsDay(day: string): MetricsDay {
  const file = join(LOGS_DIR, `metrics-${day}.jsonl`);
  if (!existsSync(file)) return { records: [], unreadableLines: 0 };

  const records: Array<Record<string, unknown>> = [];
  let unreadableLines = 0;
  let contents: string;
  try {
    contents = readFileSync(file, 'utf-8');
  } catch {
    // Unreadable file: report it as one skipped line rather than as an empty
    // day, which would read as "the observer did nothing".
    return { records: [], unreadableLines: 1 };
  }

  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') records.push(parsed as Record<string, unknown>);
      else unreadableLines++;
    } catch {
      unreadableLines++;
    }
  }
  return { records, unreadableLines };
}

/** Fold a set of records into one balance. See the note at the top of the file. */
export function aggregateSessionMetrics(records: Array<Record<string, unknown>>): MetricsAggregate {
  const agg: MetricsAggregate = {
    records: 0,
    skippedOldSchema: 0,
    sessions: 0,
    compressionTurns: 0,
    gatedBatches: 0,
    skippedBatches: 0,
    observationsProduced: 0,
    inputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
    billedTokens: 0,
    tokensPerTurn: null,
    gatedShare: 0,
  };

  const sessionIds = new Set<string>();
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  for (const r of records) {
    // Schema 1 (3.4.1) reported an inputTokens that excluded cache reads under
    // the same name, so folding those rows in would understate the bill by
    // roughly the size of the missing figure. Dropped, and counted so the drop
    // can be reported rather than silently applied.
    if (num(r.schema) !== METRICS_SCHEMA_VERSION) {
      agg.skippedOldSchema++;
      continue;
    }
    agg.records++;
    if (typeof r.contentSessionId === 'string' && r.contentSessionId) {
      sessionIds.add(r.contentSessionId);
    }
    agg.compressionTurns += num(r.compressionTurns);
    agg.gatedBatches += num(r.gatedBatches);
    agg.skippedBatches += num(r.skippedBatches);
    agg.observationsProduced += num(r.observationsProduced);
    agg.inputTokens += num(r.inputTokens);
    agg.cacheReadInputTokens += num(r.cacheReadInputTokens);
    agg.outputTokens += num(r.outputTokens);
  }

  agg.sessions = sessionIds.size;
  agg.billedTokens = agg.inputTokens + agg.cacheReadInputTokens + agg.outputTokens;
  agg.tokensPerTurn =
    agg.compressionTurns > 0 ? Math.round(agg.billedTokens / agg.compressionTurns) : null;
  const seen = agg.compressionTurns + agg.gatedBatches;
  agg.gatedShare = seen > 0 ? agg.gatedBatches / seen : 0;

  return agg;
}
