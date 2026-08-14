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
  const rows = db.prepare(`
    SELECT id,
           json_extract(metadata, '$.record_id') AS record_id,
           title,
           created_at_epoch,
           json_extract(metadata, '$.date')      AS written_on,
           json_extract(metadata, '$.status')    AS status,
           valid_to,
           source_path,
           source_line
      FROM observations
     WHERE project = ? AND source_kind = 'curated'
       AND json_extract(metadata, '$.record_id') IS NOT NULL
  `).all(project) as Row[];

  if (rows.length === 0) return [];

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
