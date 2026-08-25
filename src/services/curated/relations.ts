// SPDX-License-Identifier: Apache-2.0
//
// What a curated record is related to — from both ends, resolved.
//
// WHY THIS EXISTS. A relation is declared once, by one record, and stored once
// in that direction. That is right: only one end wrote anything down, and
// inventing the other end is exactly what the edge reader refuses to do. But it
// left the far end of every edge unreachable. `0090` was superseded by `0138`,
// `decision_edges` has carried an `idx_edges_to` index for it since the table
// was created, and every read path answered `0090` without mentioning it.
//
// That is the same failure the supersession machinery exists to prevent, one
// layer up: a retired record that does not say it was retired reads as current.
//
// Two things are resolved here that a bare edge row cannot carry:
//
//   • The COUNTERPART. `supersedes 0138` is not usable — nobody knows what 0138
//     says. Its title, its kind, and whether it is itself still current all
//     decide what the relation is worth, and "superseded by a record that has
//     since been retired" is a different sentence from "superseded".
//   • The VOICE. An incoming edge read in the stored direction points backwards.
//     `RELATION_PHRASES` is the one place that says how each relation reads from
//     either end.
//
// Nothing is inferred and nothing is dropped: an edge naming a record the
// corpus does not hold is returned with `otherExists: false`, because a reader
// that silently declines is indistinguishable from one that did not look.

import { RELATION_PHRASES, type RelationName } from './relation-lexicon.js';
import { curatedKindOfId, type CuratedKindLabel } from './record-key.js';

export type RelationDirection = 'outgoing' | 'incoming';

export interface CuratedRelation {
  /** 'outgoing' — this record declared it. 'incoming' — the other one did. */
  direction: RelationDirection;
  relation: RelationName;
  /** How it reads in this direction, e.g. `supersedes` / `superseded by`. */
  phrase: string;
  /** The record at the other end. */
  other: string;
  otherKind: CuratedKindLabel | null;
  otherTitle: string | null;
  /** False when nothing in the corpus carries that number. */
  otherExists: boolean;
  /** False when the counterpart's own validity window is closed. */
  otherCurrent: boolean;
  /**
   * 'sicher' — the record wrote the verb. 'vermutet' — the reference sits
   * under a noun heading and nobody said what it means.
   *
   * Carried through because supersession never applies a `vermutet` edge, so
   * presenting the two alike would show a reader a retirement that did not
   * happen.
   */
  certainty: string;
  /**
   * Every place the relation is written down.
   *
   * A relation is a fact; a declaration is evidence for it. The two are not the
   * same count and must not be presented as if they were: on the live corpus
   * 228 stored edges are 126 relations, because a record saying "abgelöst durch
   * 0137" and an index saying "löst 0064 ab" are two declarations of one
   * supersession. Listed as two, they read as two separate claims that
   * contradict each other on certainty; collapsed away entirely, the second
   * source disappears and a dispute has nothing to check.
   */
  declaredIn: Array<{
    certainty: string;
    sourcePath: string;
    sourceLine: number;
    /** The clause it was read from — for display, and for disputes. */
    rawText: string | null;
  }>;
}

/** The store surface this needs. Narrow on purpose: it only ever reads. */
export interface RelationStore {
  getCuratedRelations(project: string, recordId: string): Array<{
    direction: 'outgoing' | 'incoming';
    other: string;
    relation: string;
    certainty: string;
    source_path: string;
    source_line: number;
    raw_text: string | null;
  }>;
  getCuratedRecord(
    project: string,
    recordId: string,
    opts?: { includeClosed?: boolean },
  ): { title: string | null; valid_to: number | null; kind: CuratedKindLabel } | null;
}

function phraseFor(relation: string, direction: RelationDirection): string {
  const known = RELATION_PHRASES[relation as RelationName];
  // An unknown relation name can only come from a row written by a version
  // that knew a verb this one does not. Its own name is a worse label than a
  // phrase but a much better one than silence.
  if (!known) return direction === 'outgoing' ? relation : `${relation} (by)`;
  return direction === 'outgoing' ? known.outgoing : known.incoming;
}

/**
 * Every relation touching `recordId`, both directions, counterparts resolved.
 *
 * The counterpart is looked up through `getCuratedRecord` rather than joined in
 * SQL, deliberately: that method is where "collapse a record's revisions to the
 * current one" lives, and a second copy of that collapse is how a record starts
 * being counted twice. `includeClosed` so a retired counterpart is reported as
 * retired instead of as missing — the two mean opposite things.
 */
export function curatedRelationsOf(
  store: RelationStore,
  project: string,
  recordId: string,
): CuratedRelation[] {
  const rows = store.getCuratedRelations(project, recordId);
  const resolved = new Map<string, { title: string | null; valid_to: number | null; kind: CuratedKindLabel } | null>();
  const byRelation = new Map<string, CuratedRelation>();

  for (const row of rows) {
    const key = `${row.direction}|${row.relation}|${row.other}`;
    const existing = byRelation.get(key);
    if (existing) {
      existing.declaredIn.push({
        certainty: row.certainty,
        sourcePath: row.source_path,
        sourceLine: row.source_line,
        rawText: row.raw_text,
      });
      // The STRONGEST declaration decides, because that is what the store
      // already does: `applySupersessions` walks edge rows and retires the
      // target as soon as ONE of them is 'sicher'. Reporting the weakest, or
      // the last one read, would describe a retirement that demonstrably
      // happened as merely supposed.
      if (row.certainty === 'sicher') existing.certainty = 'sicher';
      continue;
    }

    if (!resolved.has(row.other)) {
      resolved.set(row.other, store.getCuratedRecord(project, row.other, { includeClosed: true }));
    }
    const other = resolved.get(row.other) ?? null;
    byRelation.set(key, {
      direction: row.direction,
      relation: row.relation as RelationName,
      phrase: phraseFor(row.relation, row.direction),
      other: row.other,
      // From the row when the corpus holds it, from the number's shape when it
      // does not — an edge naming a record nobody wrote still says which
      // namespace it meant.
      otherKind: other?.kind ?? curatedKindOfId(row.other),
      otherTitle: other?.title ?? null,
      otherExists: other !== null,
      otherCurrent: other !== null && other.valid_to === null,
      certainty: row.certainty,
      declaredIn: [{
        certainty: row.certainty,
        sourcePath: row.source_path,
        sourceLine: row.source_line,
        rawText: row.raw_text,
      }],
    });
  }

  return [...byRelation.values()];
}
