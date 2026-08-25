// SPDX-License-Identifier: Apache-2.0
//
// Where an observation row came from — one rule, one place.
//
// WHY THIS EXISTS. `source_kind` splits the store into the two things it holds:
// text a person wrote and keepmind stored verbatim ('curated'), and text the
// observer's model produced about a session (NULL / 'observed'). Answering from
// the second as if it were the first is the failure this column exists to
// prevent, so every read path that cares has to spell the distinction the same
// way.
//
// It was already spelled twice — `ObservationCompiler` for the injected block,
// and `decision-check` filtering rows in JS after the fact — and the search
// layer was about to make it four. The clause has one non-obvious part, and
// getting THAT wrong is silent: rows written before the curated path existed
// carry `source_kind IS NULL`, so a plain `= 'observed'` drops the entire
// pre-3.x corpus out of an "observed only" search and the result still looks
// like a perfectly ordinary, slightly short answer.

/** Which origin a read may see. */
export type SourceKindFilter = 'all' | 'curated' | 'observed';

/**
 * Unknown values fall back to 'all'.
 *
 * A typo must not narrow a search. An over-narrow result is indistinguishable
 * from "there was nothing to find", which is the failure mode this project
 * keeps paying for — so the fallback is the widest option, never the narrowest.
 */
export function normalizeSourceKind(raw: unknown): SourceKindFilter {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return value === 'curated' || value === 'observed' ? value : 'all';
}

/**
 * The SQL expression for a row's origin, NULL folded into 'observed'.
 *
 * `alias` names the row when the query joins more than one table.
 */
export function sourceKindSql(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return `COALESCE(${prefix}source_kind, 'observed')`;
}

/**
 * A WHERE fragment for the given filter, or null when nothing needs adding.
 *
 * Returns the fragment AND its parameter together so a caller cannot push one
 * without the other — the two-parameter `(? = 'all' OR … = ?)` form invites
 * exactly that mistake.
 */
export function sourceKindCondition(
  filter: SourceKindFilter,
  alias?: string,
): { sql: string; param: string } | null {
  if (filter === 'all') return null;
  return { sql: `${sourceKindSql(alias)} = ?`, param: filter };
}

/** True for a row whose stored `source_kind` marks it as written by hand. */
export function isCuratedRow(sourceKind: string | null | undefined): boolean {
  return sourceKind === 'curated';
}
