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
 * A stored row's entry number — the JS side of `CURATED_ID_SQL`.
 *
 * Same COALESCE, same order, same reason: a caller holding a row rather than a
 * query still has to look under both namespace keys, and doing it inline is how
 * the SQL side ended up with two copies of itself.
 */
export function curatedIdOfRow(metadata: string | null | undefined): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { record_id?: unknown; vorgang_id?: unknown };
    const id = parsed?.record_id ?? parsed?.vorgang_id;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
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

/**
 * The source path an entry authored in keepmind cites, rather than a file.
 *
 * It lives HERE, next to the id rule, because it is the second half of the
 * same question: `CURATED_ID_SQL` says how an entry is addressed, this says
 * where it came from. Both are read by the store and by the curated services,
 * and a second spelling of either is how one rule becomes two that are merely
 * supposed to agree.
 */
export const AUTHORED_SOURCE_SCHEME = 'keepmind://curated/';

/** The synthetic source path for a record number. Stable for its lifetime. */
export function authoredSourcePath(recordId: string): string {
  return `${AUTHORED_SOURCE_SCHEME}${recordId}`;
}

/** True for an entry that lives in keepmind rather than in a file. */
export function isAuthoredSourcePath(sourcePath: string | null | undefined): boolean {
  return typeof sourcePath === 'string' && sourcePath.startsWith(AUTHORED_SOURCE_SCHEME);
}

/**
 * Metadata key naming the revision that replaced this row.
 *
 * Here rather than private to the store because it is READ outside it: a
 * search result carrying `valid_to` has to say WHY it is closed, and "an
 * earlier wording of an entry that still applies" and "a record another record
 * superseded" are different statements to a reader. Written by
 * `settleCuratedRevisions`; its counterpart for the other reason is
 * `SUPERSESSION_MARKER` in supersession.ts, which stays where it is written.
 */
export const REVISION_MARKER = 'revised_by';
