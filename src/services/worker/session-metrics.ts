// SPDX-License-Identifier: Apache-2.0
//
// The per-session cost record, written where a log level cannot hide it.
//
// WHY THIS IS NOT A LOG LINE
// --------------------------
// The end-of-session balance used to be written with `logger.success(...)`,
// which delegates to `info`. With KEEPMIND_LOG_LEVEL=WARN — a perfectly
// reasonable setting for a background service — the line is dropped, and the
// documented way to measure the release ("grep the log for 'Stateless observer
// session ended'") returns nothing at all.
//
// Zero matches is indistinguishable from "the observer did no work". That is
// exactly the failure mode that made the search counters read as "search is
// unused" when they were merely uninstrumented, and the same shape as the two
// silent faults fixed in 3.4.0: no error, no warning, just an absence that
// looks like data. A measurement that goes quiet when a setting is inconvenient
// is worse than no measurement, because it is believed.
//
// So the balance is an operating result, not chatter, and it gets its own
// channel: one JSON object per session in ~/.keepmind/logs/metrics-<date>.jsonl,
// independent of KEEPMIND_LOG_LEVEL. Being JSONL it also aggregates, which grep
// over a prose log never did well.
//
// Everything here is best-effort and must never throw into the caller: a
// metrics write failing is not worth losing an observation over.

import { appendFileSync } from 'fs';
import { join } from 'path';
import { LOGS_DIR, ensureDir } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';

export interface SessionMetrics {
  /** Epoch millis when the session ended. */
  endedAt: number;
  sessionDbId: number;
  project: string;
  /** Compression turns actually dispatched to the model. */
  compressionTurns: number;
  /** Batches dropped by the gate before any request — these cost nothing. */
  gatedBatches: number;
  /** Dispatched turns the model answered with "nothing worth recording". */
  skippedBatches: number;
  observationsProduced: number;
  /** Cumulative token usage for the session, as reported by the provider. */
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model?: string;
  captureProfile?: string;
  trigger?: string;
  observerMode?: string;
}

/** Share of batches the gate removed, as a fraction of everything it saw. */
export function gatedShare(m: Pick<SessionMetrics, 'compressionTurns' | 'gatedBatches'>): number {
  const total = m.compressionTurns + m.gatedBatches;
  return total > 0 ? m.gatedBatches / total : 0;
}

/**
 * Mean tokens per dispatched compression — the figure that compares directly
 * against the pre-3.4.0 measurements. Null when nothing was dispatched, which
 * is meaningfully different from zero.
 */
export function tokensPerTurn(m: SessionMetrics): number | null {
  if (m.compressionTurns <= 0) return null;
  return Math.round((m.inputTokens + m.outputTokens) / m.compressionTurns);
}

function metricsFilePath(endedAt: number): string {
  const day = new Date(endedAt).toISOString().slice(0, 10);
  return join(LOGS_DIR, `metrics-${day}.jsonl`);
}

/**
 * Append one session record. Never throws; a failure is reported at WARN (which
 * is visible at every level that a person would actually run in production) and
 * then dropped.
 */
export function recordSessionMetrics(metrics: SessionMetrics): void {
  try {
    ensureDir(LOGS_DIR);
    const line = JSON.stringify({
      ...metrics,
      endedAtIso: new Date(metrics.endedAt).toISOString(),
      gatedShare: Number(gatedShare(metrics).toFixed(4)),
      tokensPerTurn: tokensPerTurn(metrics),
    });
    appendFileSync(metricsFilePath(metrics.endedAt), `${line}\n`, 'utf-8');
  } catch (error) {
    logger.warn('SDK', 'Failed to write session metrics', {
      sessionId: metrics.sessionDbId,
    }, error instanceof Error ? error : new Error(String(error)));
  }
}
