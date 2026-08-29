// SPDX-License-Identifier: Apache-2.0
//
// The closing line of a queue position (S21).
//
// WHY THIS EXISTS
// ---------------
// Between `ENQUEUED | type=observation` and an observation appearing in the
// database there was NO log line at all. Whether a position was compressed,
// dropped before the model, refused by the model or never touched could only be
// told by counting rows in SQLite — which is why a 31-hour outage went unnoticed
// for two working days, and why the observation stall of 27.-29.08.2026 could
// not be diagnosed from the outside at all. Measured then: 130+ ENQUEUED lines
// in 35 minutes, the observation counter unchanged at 86, and not one error in
// the log.
//
// So every position now leaves EXACTLY ONE closing line at INFO. Not at DEBUG:
// the whole point is that it is readable in normal operation, and a signal that
// goes quiet at the default log level is the failure this file exists to
// prevent (same reasoning as the metrics record in CLAUDE.md).
//
// "Exactly one" is a floor as well as a ceiling. A ceiling alone would let a
// position vanish silently when its session is cleared; a floor alone would log
// a position twice when a batch is resolved and then confirmed. The ledger in
// SessionMessageBuffer enforces both — it is the one place that knows a
// position exists and the one place it can disappear.

import { logger } from '../../utils/logger.js';

/**
 * What became of one queue position. Exhaustive by construction: a position is
 * either compressed into memory, dropped before the model, refused by the
 * model, lost to a failure, or discarded with its session.
 */
export type QueueOutcome =
  /** The model produced at least one observation (or a summary) from it. */
  | 'stored'
  /** observation-gate.ts dropped it before any model call. */
  | 'gated'
  /** It reached the model, which returned nothing usable. */
  | 'skipped'
  /** The generator failed while this position was claimed. */
  | 'failed'
  /** Its session ended (or was cleared) while it was still buffered. */
  | 'dropped';

export interface QueuePositionFacts {
  sessionDbId: number;
  messageId: number;
  type: string;
  tool: string | null;
}

/**
 * One line, one position. The shape mirrors the ENQUEUED line so the two can be
 * paired by `messageId` with a plain grep — that pairing IS the acceptance:
 * "no observations" must be readable from the log without counting the database.
 */
export function logQueueOutcome(
  facts: QueuePositionFacts,
  outcome: QueueOutcome,
  reason?: string
): void {
  const tool = facts.tool ? ` | tool=${facts.tool}` : '';
  const why = reason ? ` | reason=${reason}` : '';
  logger.info(
    'QUEUE',
    `RESOLVED | sessionDbId=${facts.sessionDbId} | messageId=${facts.messageId} | type=${facts.type}${tool} | outcome=${outcome}${why}`,
    { sessionId: facts.sessionDbId }
  );
}
