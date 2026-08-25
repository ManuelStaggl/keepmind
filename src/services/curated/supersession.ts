// SPDX-License-Identifier: Apache-2.0
//
// Close the validity window of a record that a later one supersedes.
//
// WHY THIS IS NOT A SEARCH PROBLEM. Retrieval alone carries a stale-fact error
// of 15–40%: the old and the new record are both good matches, and similarity
// cannot tell which one still applies — the two are about the same subject,
// which is exactly why the newer one exists. So the decision "which of these
// holds" is made here, from hard data (a declared relation and a date), and
// never from a distance measure. Search finds the candidates; this decides.
//
// NOTHING IS EVER DELETED. A superseded record keeps its row, its text and its
// place in search results; it only stops being injected as current. The
// alternative — letting a model decide per fact whether to ADD/UPDATE/DELETE —
// is documented losing both statements (mem0 #4536). An expiry timestamp is
// recoverable; a delete is not.
//
// ONLY CERTAIN EDGES ACT. A wrongly applied supersession is worse than a
// missing one: it makes a rule that still applies invisible, and it does so
// silently. Edges the reader marked `vermutet` are reported for a human and
// change nothing.
//
// THE RESULT IS COMPUTED, NOT ACCUMULATED. Every run first reopens the windows
// this module closed before, then closes them again from the current edges. A
// relation removed from a file therefore restores its target, instead of
// leaving a record retired forever by a line nobody can find any more.

import { logger } from '../../utils/logger.js';

/** Marker written into metadata so a later run can tell its own work apart. */
export const SUPERSESSION_MARKER = 'superseded_by_record';

export interface SupersessionStore {
  query(sql: string): { all: (...params: unknown[]) => unknown[]; run?: (...params: unknown[]) => unknown };
  prepare(sql: string): { all: (...params: unknown[]) => unknown[]; get: (...params: unknown[]) => unknown; run: (...params: unknown[]) => unknown };
}

export interface SupersessionReport {
  /**
   * Records whose validity window was closed — one entry per record, not per
   * edge. Two files declaring the same supersession is normal (a record and
   * the index that lists it), and counting edges reported "10 records retired"
   * where 6 records were affected.
   */
  closed: Array<{ record: string; supersededBy: string; sourcePath: string; sourceLine: number }>;
  /** How many edges drove those closures. Always >= closed.length. */
  edgesApplied: number;
  /** Windows reopened because the edge that closed them is gone. */
  reopened: number;
  /**
   * Supersessions the edge reader was not certain about. Reported for a human
   * — never applied, because a wrong one hides a rule that still holds.
   */
  uncertain: Array<{ from: string; to: string; sourcePath: string; sourceLine: number; rawText: string | null }>;
  /** Edges naming a record that has no row. Reported, not guessed at. */
  unknownTargets: Array<{ from: string; to: string; sourcePath: string; sourceLine: number }>;
}

interface EdgeRow {
  from_record: string;
  to_record: string;
  certainty: string;
  source_path: string;
  source_line: number;
  raw_text: string | null;
}

interface RecordRow {
  id: number;
  record_id: string;
  created_at_epoch: number;
}

/**
 * Apply every certain supersession in a project.
 *
 * `nowEpoch` is the fallback stamp for a closed window. The superseding
 * record's own date would be better, but it is free text in the corpus and
 * parsing it wrong would move a window by months; the import time is at least
 * knowably approximate.
 */
export function applySupersessions(
  db: SupersessionStore,
  project: string,
  nowEpoch: number = Date.now(),
): SupersessionReport {
  const report: SupersessionReport = { closed: [], edgesApplied: 0, reopened: 0, uncertain: [], unknownTargets: [] };
  const closedRecords = new Set<string>();

  const hasEdges = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_edges'").all() as unknown[]).length > 0;
  if (!hasEdges) return report;

  // Reopen first. Doing this second would leave a window closed by an edge
  // that no longer exists — the record would stay retired with nothing in the
  // corpus saying so, which is precisely the invisible state this guards.
  //
  // A superseded row is only re-opened when it is still the NEWEST row for its
  // record. Anything older has been replaced — by an in-place edit, or by a
  // re-import of a changed file — and re-opening it would put two rows for the
  // same record on the surface at once, one of them saying what the record used
  // to say. Nothing errors in that state; the record simply starts answering
  // twice, and the older answer wins as often as the ranker happens to prefer
  // it.
  const reopened = db.prepare(`
    UPDATE observations
       SET valid_to = NULL
     WHERE project = ?
       AND valid_to IS NOT NULL
       AND json_extract(metadata, '$.${SUPERSESSION_MARKER}') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM observations newer
          WHERE newer.project = observations.project
            AND newer.source_kind = 'curated'
            AND json_extract(newer.metadata, '$.record_id')
                = json_extract(observations.metadata, '$.record_id')
            AND (newer.created_at_epoch > observations.created_at_epoch
                 OR (newer.created_at_epoch = observations.created_at_epoch
                     AND newer.id > observations.id))
       )
  `).run(project) as { changes?: number };
  report.reopened = Number(reopened?.changes ?? 0);

  const edges = db.prepare(`
    SELECT from_record, to_record, certainty, source_path, source_line, raw_text
      FROM decision_edges
     WHERE project = ? AND relation = 'supersedes'
  `).all(project) as EdgeRow[];

  if (edges.length === 0) return report;

  // Record number -> row. Read from metadata rather than parsed out of the
  // title: the title is display text and has been reformatted before.
  //
  // A record can hold several ROWS since direct authoring exists: editing an
  // entry in place writes a new revision and closes the previous one, and all
  // of them carry the same `record_id`. The window that a supersession closes
  // must be the CURRENT revision's — closing a revision that an edit already
  // retired would retire nothing anyone can see, and the record would keep
  // applying while the report said it had been retired. Hence the ordering:
  // `byRecord.set` overwrites, so the row that survives is the newest ACTIVE
  // one, with closed revisions kept only as a fallback for a record whose
  // author closed it by hand.
  const rows = db.prepare(`
    SELECT id, json_extract(metadata, '$.record_id') AS record_id, created_at_epoch
      FROM observations
     WHERE project = ? AND source_kind = 'curated'
       AND json_extract(metadata, '$.record_id') IS NOT NULL
     ORDER BY (valid_to IS NULL) ASC, created_at_epoch ASC, id ASC
  `).all(project) as RecordRow[];

  const byRecord = new Map<string, RecordRow>();
  for (const row of rows) byRecord.set(String(row.record_id), row);

  const close = db.prepare(`
    UPDATE observations
       SET valid_to = ?,
           metadata = json_set(
             COALESCE(metadata, '{}'),
             '$.${SUPERSESSION_MARKER}', ?,
             '$.superseded_source_path', ?,
             '$.superseded_source_line', ?
           )
     WHERE id = ?
  `);

  for (const edge of edges) {
    if (edge.certainty !== 'sicher') {
      report.uncertain.push({
        from: edge.from_record, to: edge.to_record,
        sourcePath: edge.source_path, sourceLine: edge.source_line,
        rawText: edge.raw_text,
      });
      continue;
    }

    // `from supersedes to` — the window that closes belongs to `to`.
    const target = byRecord.get(edge.to_record);
    if (!target) {
      report.unknownTargets.push({
        from: edge.from_record, to: edge.to_record,
        sourcePath: edge.source_path, sourceLine: edge.source_line,
      });
      continue;
    }

    // A record cannot supersede itself out of existence.
    if (edge.from_record === edge.to_record) continue;

    close.run(nowEpoch, edge.from_record, edge.source_path, edge.source_line, target.id);
    report.edgesApplied++;
    if (!closedRecords.has(edge.to_record)) {
      closedRecords.add(edge.to_record);
      report.closed.push({
        record: edge.to_record, supersededBy: edge.from_record,
        sourcePath: edge.source_path, sourceLine: edge.source_line,
      });
    }
  }

  logger.info('DB', 'Applied curated supersessions', {
    project,
    closed: report.closed.length,
    edgesApplied: report.edgesApplied,
    reopened: report.reopened,
    uncertain: report.uncertain.length,
    unknownTargets: report.unknownTargets.length,
  });

  return report;
}
