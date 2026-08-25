// SPDX-License-Identifier: Apache-2.0
//
// How a curated hit says what it is, in a result list.
//
// WHY THIS EXISTS. Search groups its hits under the file they touched, and a
// curated entry touched none — so every lasting entry in the corpus rendered
// under the heading `General`, side by side with model summaries and spelled
// exactly like them. Measured against the running worker: a search for
// "Wortlaut" returned record `V-0110` under `General`, and nothing in the
// output distinguished a sentence a person wrote and keepmind stored verbatim
// from a sentence a model wrote about a session.
//
// That distinction is the whole point of the curated path. An observation is a
// summary and may be wrong about its own subject; a lasting entry is the
// wording itself and is answered from as if it were current. Presenting them
// identically hands the reader the second claim about the first kind of text.
//
// The label is the group heading rather than a per-row column on purpose: it
// costs a fixed string per group instead of one per hit, and search output is
// read by a model that pays for every row.

import { curatedIdOfRow, curatedKindOfRow } from './record-key.js';
import { isCuratedRow } from '../sqlite/source-kind.js';
import { CHECKPOINT_TYPE } from '../../shared/checkpoint.js';

/** A row as far as labelling is concerned. */
export interface LabelledRow {
  type?: string | null;
  source_kind?: string | null;
  metadata?: string | null;
}

/**
 * What a curated row is, for display.
 *
 * Wider than `CuratedKindLabel` on purpose. That type answers "which namespace
 * is this entry numbered in", and its 'akte' fallback is correct there because
 * anything being looked up BY NUMBER is one of the two. But `source_kind` marks
 * more than numbered entries: a session checkpoint and the verbatim event log
 * are both stored curated and carry no number at all, and calling either of
 * them a decision record is a wrong answer, not a rounding.
 */
export type CuratedHitKind = 'akte' | 'vorgang' | 'checkpoint' | 'verbatim';

export interface CuratedHit {
  kind: CuratedHitKind;
  /** The entry number, when the row carries one. */
  recordId: string | null;
}

const GROUP_LABELS: Record<CuratedHitKind, string> = {
  akte: 'Lasting entries · akte (decisions)',
  vorgang: 'Lasting entries · vorgang (open work items)',
  checkpoint: 'Lasting entries · checkpoint (session hand-off)',
  verbatim: 'Lasting entries · verbatim (no entry number)',
};

/**
 * What a row is, or null when it is an ordinary observation.
 *
 * `source_kind` decides — not the presence of an entry number. The event log is
 * stored as a curated row carrying NO number precisely so it can never answer
 * as an entry, and it must still be labelled as verbatim text.
 */
export function curatedHitOf(row: LabelledRow): CuratedHit | null {
  if (!isCuratedRow(row.source_kind)) return null;

  const metadata = row.metadata ?? null;
  const recordId = curatedIdOfRow(metadata);
  if (recordId) {
    return { kind: curatedKindOfRow(metadata, recordId), recordId };
  }

  // No number: the row is verbatim text that is not an entry. A checkpoint is
  // worth naming because it is the one such row a reader acts on directly.
  return { kind: row.type === CHECKPOINT_TYPE ? 'checkpoint' : 'verbatim', recordId: null };
}

/**
 * The group heading for a curated hit.
 *
 * Reads as a noun, like the file paths it sits among, and names the kind —
 * which is the difference between "what did we decide" and "what is still
 * open", and therefore the difference the reader most needs.
 */
export function curatedGroupLabel(hit: CuratedHit): string {
  return GROUP_LABELS[hit.kind];
}

/**
 * The one line that says what a lasting entry is, emitted once per result list
 * that contains any.
 *
 * Without it the heading is a category name and the reader has to already know
 * what the category means — which is the thing they cannot be assumed to know
 * across a fresh session.
 */
export const CURATED_LEGEND =
  '_Lasting entries are stored verbatim — the wording is the record. Everything else is a model summary of a session._';

/**
 * The group label for an observation, or null to fall back to the file
 * grouping. Search and timeline both go through this so a curated hit cannot be
 * marked in one view and unmarked in the other.
 */
export function observationGroupLabel(row: LabelledRow): string | null {
  const hit = curatedHitOf(row);
  return hit ? curatedGroupLabel(hit) : null;
}
