// SPDX-License-Identifier: Apache-2.0
//
// How old is this decision, and what has happened since?
//
// WHY THIS IS THE CHEAPEST USEFUL THING HERE. It asserts nothing. "This record
// has not changed in 34 days, 22 decisions were taken in that time, 3 of them
// name it" is arithmetic over dates and edges — it CANNOT be wrong, it can
// only be uninteresting. Everything else on the curated path has to be careful
// about inventing relations; this one has nothing to invent.
//
// What it buys: a reading order. A backlog sorted by suspicion beats a backlog
// sorted by folder, and nothing else in the system offers one. The record that
// has sat untouched while thirty later decisions cited it is the one worth
// re-reading first.
//
// "Of them name it" is deliberately literal — it counts declared relations
// pointing at the record, not topical similarity. Similarity would need a
// distance measure, and the moment a threshold decides what "same topic" means
// the number stops being arithmetic and starts being a guess.

import { CURATED_ID_SQL, curatedKindOfId } from './record-key.js';

export interface AgingStore {
  prepare(sql: string): { all: (...params: unknown[]) => unknown[] };
}

export interface AgingEntry {
  recordId: string;
  title: string;
  /**
   * Whole days since the record was written, or null when its date cannot be
   * read.
   *
   * NOT derived from the row timestamp. Every curated row is written in the
   * same import, so `created_at_epoch` says how old the IMPORT is — reporting
   * it as the record's age showed all 137 records as "unchanged for 0 days",
   * which is a false statement rather than a missing one. The date comes from
   * the record's own `Datum` field, and when that cannot be parsed the answer
   * is null and the report says so.
   */
  ageDays: number | null;
  /** Records created after it. */
  decisionsSince: number;
  /** Of those, how many declare a relation pointing at this record. */
  citingSince: number;
  /** Free-text status as the file wrote it — never interpreted here. */
  status: string | null;
  /** True when its validity window is closed (superseded). */
  retired: boolean;
  sourcePath: string;
  sourceLine: number;
}

interface Row {
  id: number;
  record_id: string;
  title: string;
  created_at_epoch: number;
  written_on: string | null;
  status: string | null;
  valid_to: number | null;
  source_path: string;
  source_line: number;
}

const DAY_MS = 86_400_000;

/**
 * Read a record's own date. Deliberately narrow: two unambiguous formats and
 * nothing else.
 *
 * A looser parser would turn the corpus's occasional prose date into a number
 * that is off by months, and a wrong age sorts a backlog wrongly while looking
 * authoritative. An unparsable date returns null, which the report prints as
 * "age unknown" — visibly missing beats quietly wrong.
 */
export function parseWrittenOn(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = String(value).trim();

  const german = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (german) {
    const stamp = Date.UTC(Number(german[3]), Number(german[2]) - 1, Number(german[1]));
    return Number.isNaN(stamp) ? null : stamp;
  }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const stamp = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(stamp) ? null : stamp;
  }

  return null;
}

/**
 * Rank curated records by how much has happened since they were written.
 *
 * Sorted by citations first and age second: a record nobody has referred to in
 * a year is merely old, while one that thirty later decisions point at is
 * load-bearing and worth checking. Age alone would put the quiet ones on top.
 */
export function ageReport(
  db: AgingStore,
  project: string,
  nowEpoch: number = Date.now(),
): AgingEntry[] {
  let rows = db.prepare(`
    SELECT id,
           ${CURATED_ID_SQL} AS record_id,
           title,
           created_at_epoch,
           json_extract(metadata, '$.date')      AS written_on,
           json_extract(metadata, '$.status')    AS status,
           valid_to,
           source_path,
           source_line
      FROM observations
     WHERE project = ? AND source_kind = 'curated'
       AND ${CURATED_ID_SQL} IS NOT NULL
  `).all(project) as Row[];

  // DECISIONS only, and decided by the id's shape rather than by which metadata
  // key it happens to sit under. This report answers "how much has happened
  // since this was decided", which is not a question about an open work item —
  // and a work item authored here rather than imported carries its number under
  // the decision key, so filtering by key would have let it in.
  rows = rows.filter(row => curatedKindOfId(String(row.record_id ?? '')) === 'akte');

  if (rows.length === 0) return [];

  // One entry per RECORD, not per row. A record edited in place holds several
  // revisions — same number, one active — and counting each of them would both
  // list the record twice and inflate `decisionsSince` for everything below it,
  // since that number is simply the position in the ordered list. The current
  // revision represents the record; an author-closed one represents it when
  // there is no active revision left.
  const current = new Map<string, Row>();
  for (const row of rows) {
    const key = String(row.record_id);
    const kept = current.get(key);
    if (!kept) { current.set(key, row); continue; }
    const rowIsActive = row.valid_to === null;
    const keptIsActive = kept.valid_to === null;
    if (rowIsActive !== keptIsActive) {
      if (rowIsActive) current.set(key, row);
      continue;
    }
    if (row.created_at_epoch > kept.created_at_epoch
      || (row.created_at_epoch === kept.created_at_epoch && row.id > kept.id)) {
      current.set(key, row);
    }
  }
  rows = [...current.values()];

  // Record numbers are zero-padded and monotonically assigned, so "later" is
  // the number, not the row timestamp. Every row shares an import timestamp —
  // using it would report every record as equally old, which is true of the
  // import and false of the corpus.
  const ordered = [...rows].sort((a, b) => String(a.record_id).localeCompare(String(b.record_id)));

  const citations = new Map<string, Set<string>>();
  try {
    const edges = db.prepare(`
      SELECT from_record, to_record FROM decision_edges WHERE project = ?
    `).all(project) as Array<{ from_record: string; to_record: string }>;
    for (const edge of edges) {
      const set = citations.get(edge.to_record) ?? new Set<string>();
      set.add(edge.from_record);
      citations.set(edge.to_record, set);
    }
  } catch {
    // No edge table: citations stay zero rather than the report failing. The
    // age half still works and says something.
  }

  const out: AgingEntry[] = [];
  ordered.forEach((row, index) => {
    const recordId = String(row.record_id);
    const later = ordered.length - index - 1;
    const citing = citations.get(recordId);

    let citingSince = 0;
    if (citing) {
      for (const other of citing) if (other > recordId) citingSince++;
    }

    out.push({
      recordId,
      title: row.title,
      ageDays: (() => {
        const written = parseWrittenOn(row.written_on);
        return written === null ? null : Math.max(0, Math.floor((nowEpoch - written) / DAY_MS));
      })(),
      decisionsSince: later,
      citingSince,
      status: row.status,
      retired: row.valid_to !== null,
      sourcePath: row.source_path,
      sourceLine: row.source_line,
    });
  });

  return out.sort((a, b) => b.citingSince - a.citingSince || b.decisionsSince - a.decisionsSince);
}

/**
 * The same three numbers, for the entries that claim something is still OPEN.
 *
 * WHY THIS IS A SECOND FUNCTION AND NOT A FLAG. `ageReport` answers "how much
 * has happened since this was decided" and orders by RECORD NUMBER, because
 * decision numbers are zero-padded and monotonically assigned while every
 * curated row shares one import timestamp. A work item's number lives in a
 * different namespace (`V-0187`), so it cannot be compared with `0138` and the
 * ordering trick does not carry over. Here the comparison is by DATE, which is
 * weaker — a record whose date will not parse drops out of the count instead
 * of being mis-ordered — and mixing the two orderings in one function would
 * make it unclear which of them any given number came from.
 *
 * WHY IT MATTERS AT ALL. An open item is a standing claim that something is
 * unresolved, and it is read as current for as long as it stands. It is the
 * one kind of entry that goes stale by the world moving rather than by anyone
 * touching it: nothing writes to `V-0187` when the thing it waits for is
 * settled elsewhere. So the measurement is the whole feature — 118 items in
 * the live corpus say "offen" and 17 say "wartet", and nothing said which of
 * them had been overtaken.
 *
 * IT STILL ASSERTS NOTHING. "Unchanged for 34 days, 68 decisions taken since,
 * 5 of them name it" is arithmetic over dates and declared edges. It cannot be
 * wrong, only uninteresting — the same property that makes `ageReport` worth
 * its weight. Deciding that an item is obsolete stays with the reader.
 */
export interface OpenItemEntry {
  itemId: string;
  title: string;
  /** `offen`, `wartet` — as the event log derived it, never interpreted here. */
  state: string | null;
  /**
   * Days since the item last MOVED, from `state_since`, falling back to the
   * date it was created. "Unchanged" is the claim, and the state moving is the
   * only thing that counts as a change: an item's own file does not move when
   * the log records that it is now waiting.
   */
  ageDays: number | null;
  /** Whether the age came from the state moving or from the item's creation. */
  ageFrom: 'state' | 'created' | null;
  /** Decisions dated after that. */
  decisionsSince: number;
  /** Of those, how many declare a relation pointing at this item. */
  citingSince: number;
  sourcePath: string;
  sourceLine: number;
}

/** States that still claim something is unresolved. */
const OPEN_STATES = new Set(['offen', 'wartet']);

export function openItemsReport(
  db: AgingStore,
  project: string,
  nowEpoch: number = Date.now(),
): OpenItemEntry[] {
  const rows = db.prepare(`
    SELECT id,
           ${CURATED_ID_SQL} AS record_id,
           title,
           created_at_epoch,
           json_extract(metadata, '$.state')       AS state,
           json_extract(metadata, '$.state_since') AS state_since,
           json_extract(metadata, '$.erstellt')    AS created_on,
           json_extract(metadata, '$.date')        AS written_on,
           json_extract(metadata, '$.status')      AS status,
           valid_to,
           source_path,
           source_line
      FROM observations
     WHERE project = ? AND source_kind = 'curated'
       AND ${CURATED_ID_SQL} IS NOT NULL
       AND valid_to IS NULL
  `).all(project) as Array<Row & { state: string | null; state_since: string | null; created_on: string | null }>;

  // Decision dates, for "how many were taken since". Read from the same rows —
  // a second query would be a second definition of which rows are decisions.
  const decisionDates: number[] = [];
  const decisionDateById = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.record_id ?? '');
    if (curatedKindOfId(id) !== 'akte') continue;
    const written = parseWrittenOn(row.written_on);
    if (written === null) continue;
    decisionDates.push(written);
    decisionDateById.set(id, written);
  }
  decisionDates.sort((a, b) => a - b);

  const citedBy = new Map<string, Set<string>>();
  try {
    const edges = db.prepare(`
      SELECT from_record, to_record FROM decision_edges WHERE project = ?
    `).all(project) as Array<{ from_record: string; to_record: string }>;
    for (const edge of edges) {
      const set = citedBy.get(edge.to_record) ?? new Set<string>();
      set.add(edge.from_record);
      citedBy.set(edge.to_record, set);
    }
  } catch {
    // No edge table: citations stay zero rather than the report failing.
  }

  const out: OpenItemEntry[] = [];
  for (const row of rows) {
    const itemId = String(row.record_id ?? '');
    if (curatedKindOfId(itemId) !== 'vorgang') continue;
    const state = row.state ?? null;
    if (!OPEN_STATES.has(String(state ?? '').toLowerCase())) continue;

    const movedOn = parseWrittenOn(row.state_since);
    const createdOn = movedOn === null ? parseWrittenOn(row.created_on) : null;
    const since = movedOn ?? createdOn;

    // Counted only when the item's own date is known. A missing date makes the
    // count meaningless rather than zero, and a zero here would sort a
    // date-less item to the bottom as though nothing had happened since.
    let decisionsSince = 0;
    let citingSince = 0;
    if (since !== null) {
      for (const date of decisionDates) if (date > since) decisionsSince++;
      for (const other of citedBy.get(itemId) ?? []) {
        const date = decisionDateById.get(other);
        if (date !== undefined && date > since) citingSince++;
      }
    }

    out.push({
      itemId,
      title: row.title,
      state,
      ageDays: since === null ? null : Math.max(0, Math.floor((nowEpoch - since) / DAY_MS)),
      ageFrom: movedOn !== null ? 'state' : (createdOn !== null ? 'created' : null),
      decisionsSince,
      citingSince,
      sourcePath: row.source_path,
      sourceLine: row.source_line,
    });
  }

  // Same order as `ageReport`, for the same reason: an item that later
  // decisions point at is worth re-reading before one nobody has referred to.
  // Age breaks the tie, so the oldest untouched claim still rises.
  return out.sort((a, b) =>
    b.citingSince - a.citingSince
    || b.decisionsSince - a.decisionsSince
    || (b.ageDays ?? -1) - (a.ageDays ?? -1));
}
