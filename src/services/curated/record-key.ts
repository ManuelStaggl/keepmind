// SPDX-License-Identifier: Apache-2.0
//
// How a curated entry is addressed — one expression, one place.
//
// WHY THIS EXISTS. The corpus holds two kinds of lasting entry, and they are
// stored under two different metadata keys: a decision record under
// `$.record_id` (`0138`), a work item under `$.vorgang_id` (`V-0001`). The two
// keys are deliberate — a work item is where a decision is carried out, and
// merging the two namespaces makes "what did we decide" answer with open tasks.
//
// But every READ path was written against `$.record_id` alone, so half the
// corpus was addressable and half was not: `curated_get "V-0001"` answered "No
// record" about 200 work items the importer had just reported as imported.
// `verifyMigration` had already been fixed once, on its own, with its own copy
// of the COALESCE — which is how a rule becomes two rules that are merely
// supposed to agree.
//
// So: the ID is shared, the KIND stays distinct. An entry is found by its
// number whichever namespace it lives in, and what it is remains readable from
// `kind` — which is what keeps decisions and work items apart where that
// actually matters.

/** Decision record: zero-padded four digits, `0001`…`0999`. */
export const RECORD_ID_PATTERN = /^0\d{3}$/;

/** Work item: `V-` and four digits. */
export const VORGANG_ID_PATTERN = /^V-\d{4}$/;

export type CuratedKindLabel = 'akte' | 'vorgang';

/**
 * The SQL expression for a curated entry's id.
 *
 * `table` names the row when a query joins observations to itself (the
 * supersession reopen compares a row against its own successors). Anything that
 * filters curated rows by number must use THIS, or it silently sees one of the
 * two namespaces.
 */
export function curatedIdSql(table?: string): string {
  const prefix = table ? `${table}.` : '';
  return `COALESCE(`
    + `json_extract(${prefix}metadata, '$.record_id'), `
    + `json_extract(${prefix}metadata, '$.vorgang_id')`
    + `)`;
}

/** The expression for the common, unaliased case. */
export const CURATED_ID_SQL = curatedIdSql();

/**
 * What an id refers to, from its shape alone.
 *
 * The shape is the namespace: `V-0001` is a work item wherever it is stored,
 * `0138` is a decision. Derived rather than read from metadata so a caller can
 * classify an id it was merely handed — a search hit, a command line argument —
 * without a round trip to the store.
 */
export function curatedKindOfId(id: string): CuratedKindLabel | null {
  const trimmed = id.trim();
  if (RECORD_ID_PATTERN.test(trimmed)) return 'akte';
  if (VORGANG_ID_PATTERN.test(trimmed)) return 'vorgang';
  return null;
}

/** True for an id either namespace recognises. */
export function isCuratedId(id: string): boolean {
  return curatedKindOfId(id) !== null;
}

/**
 * What a stored row is, preferring what the row itself declares.
 *
 * `metadata.kind` is written by the work-item importer; decision records carry
 * no kind at all, which is why the id shape is the fallback rather than the
 * other way round.
 */
export function curatedKindOfRow(metadata: string | null, id: string | null): CuratedKindLabel {
  if (metadata) {
    try {
      const parsed = JSON.parse(metadata) as { kind?: unknown };
      if (parsed?.kind === 'vorgang') return 'vorgang';
    } catch {
      /* a malformed blob falls through to the id shape */
    }
  }
  return (id && curatedKindOfId(id)) === 'vorgang' ? 'vorgang' : 'akte';
}
