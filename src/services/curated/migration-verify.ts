// SPDX-License-Identifier: Apache-2.0
//
// Verify that a file corpus arrived in keepmind COMPLETE.
//
// This exists for one moment: the one-time hand-over of an existing file
// archive into keepmind, immediately before those files stop being the place
// the knowledge lives. After that moment there is nothing left to compare
// against, so the comparison has to happen while both sides still exist.
//
// "A replacement must be complete before the old thing goes" is not a slogan
// here — it is the only reason this module is worth its weight. An import that
// silently dropped four records looks exactly like an import that had four
// fewer records to read, and the difference only becomes visible months later,
// as an answer that is missing a rule.
//
// WHAT IS COMPARED, and why those three things:
//   records   — every record number in the files has a row, and no row claims a
//               record the files do not have. Counting alone would pass with
//               one record lost and one invented.
//   relations — every edge the files declare exists in the graph, with the same
//               direction and the same certainty. Relations are what make the
//               archive more than a pile of text, and they are the part an
//               importer can lose without changing any count of records.
//   validity  — which records a DECLARED supersession retires. Computed from
//               the FILES by `supersededRecords` — the contradiction check's
//               own function, which is also the rule `applySupersessions`
//               implements — and compared with the store's open validity
//               windows. A record that arrives but arrives retired is a rule
//               that stopped applying during a migration, which is the worst of
//               the three failures and the quietest.
//
// Deliberately NOT part of the pass/fail comparison: a record whose STATUS says
// "abgelöst" while nothing supersedes it. The importer stores the status
// verbatim and does not map it onto a validity window on purpose — closing a
// window is a supersession, and a supersession needs the record that replaced
// it. Failing the migration over that would fail it for a design decision
// rather than for anything lost in transit. It is reported as a count, and
// `keepmind akten:check` is the command that examines it.
//
// BOTH CURATED NAMESPACES ARE COMPARED. Decision records and work items are
// stored under different metadata keys on purpose, and a check that reads only
// one of them reports the other as lost — 200 work items imported and 200
// reported missing, in the same run.
//
// Nothing here writes. It reads files, reads the store, and reports.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { parseAkte } from './akten-parser.js';
import { parseVorgang } from './vorgang-parser.js';
import { parseEreignisLog } from './ereignis-log.js';
import { EVENT_LOG_FILE } from './vorgang-importer.js';
import { extractEdges, extractEdgesFromControlFile, type DecisionEdge } from './edge-reader.js';
import { supersededRecords, statusSaysValid, statusEndsWithoutSuccessor, type RecordState } from './contradiction-check.js';

export interface VerifySource {
  path: string;
  kind: 'akten' | 'vorgaenge';
}

export interface VerifyStore {
  prepare(sql: string): { all: (...params: unknown[]) => unknown[] };
}

export interface VerifyReport {
  project: string;
  /** Records found in the files, by number. */
  sourceRecords: string[];
  /** Records found in the store, by number. */
  storedRecords: string[];
  /** In the files, missing from the store. THE failure this exists to catch. */
  missingRecords: string[];
  /** In the store, absent from the files. Not necessarily wrong — see below. */
  extraRecords: string[];
  sourceEdgeCount: number;
  storedEdgeCount: number;
  /** Declared in the files, absent from the graph. */
  missingEdges: Array<{ from: string; to: string; relation: string; certainty: string; sourcePath: string; sourceLine: number }>;
  /** In the graph, not declared by any file in the given sources. */
  extraEdges: Array<{ from: string; to: string; relation: string; sourcePath: string }>;
  /** Still in force according to the FILES (declared supersessions only). */
  currentInSource: string[];
  /** Still in force according to the store (`valid_to IS NULL`). */
  currentInStore: string[];
  /** In force in the files, retired in the store — a rule lost in transit. */
  wronglyRetired: string[];
  /** Retired in the files, in force in the store — a rule that came back. */
  wronglyActive: string[];
  /**
   * Records whose status promises a replacement ("abgelöst", "ersetzt durch")
   * while nothing declares a supersession. Informational: this is a property
   * of the CORPUS, present before and after the migration, and `keepmind
   * akten:check` reports it as the contradiction it is.
   */
  statusRetiredWithoutSupersession: string[];
  /**
   * Records that ended on their own terms — withdrawn, expired, used up. A
   * valid resting state, listed so the count is visible and NOT as something
   * to chase: there is no successor to find. See `statusEndsWithoutSuccessor`.
   */
  endedWithoutSuccessor: string[];
  /** Files that could not be read at all. */
  failed: Array<{ file: string; error: string }>;
  /**
   * The work-item event logs found in the sources, and whether each one's
   * wording arrived.
   *
   * Checked because the log is the ONLY record of how each work item reached
   * its state, and until it was stored the migration could report "complete"
   * over a corpus whose entire event history still lived in a file nobody had
   * been told to keep. A log that is on disk and not in the store makes the
   * result incomplete — deleting the file at that point loses history.
   */
  eventLogs: Array<{
    path: string;
    /** Events the file holds. */
    sourceEvents: number;
    /** True when a curated row holds this log's wording, byte for byte. */
    stored: boolean;
    /** Set when a row exists but its text differs from the file's. */
    mismatch?: string;
  }>;
  /** True when records, relations, validity AND the event logs all agree. */
  complete: boolean;
}

function markdownFilesIn(directory: string): string[] {
  const root = resolve(directory);
  return readdirSync(root).sort()
    .map(entry => join(root, entry))
    .filter(path => {
      try { return !statSync(path).isDirectory() && extname(path).toLowerCase() === '.md'; }
      catch { return false; }
    });
}

function edgeKey(edge: { from: string; to: string; relation: string }): string {
  return `${edge.from}|${edge.relation}|${edge.to}`;
}

/**
 * Read the file side of the comparison with the SAME readers the importer
 * uses. A verifier with its own parser verifies its own parser.
 */
function readSources(sources: VerifySource[], failed: VerifyReport['failed']) {
  const records: RecordState[] = [];
  const edges: DecisionEdge[] = [];
  const vorgaenge: string[] = [];

  for (const source of sources) {
    let files: string[];
    try { files = markdownFilesIn(source.path); }
    catch (error) { failed.push({ file: source.path, error: error instanceof Error ? error.message : String(error) }); continue; }

    for (const file of files) {
      try {
        const content = readFileSync(file, 'utf8');
        if (source.kind === 'vorgaenge') {
          const parsed = parseVorgang(content);
          if (parsed.id) vorgaenge.push(parsed.id);
          continue;
        }
        const parsed = parseAkte(content);
        if (parsed.id) {
          records.push({ id: parsed.id, status: parsed.status, sourcePath: file, sourceLine: parsed.headingLine });
          edges.push(...extractEdges(parsed, file).edges);
        } else {
          // Not a record, still a source of relations. Supersessions are left
          // to the records themselves — the default of
          // `extractEdgesFromControlFile`, and the same default the importer
          // writes under, so the two sides of this comparison can never
          // disagree about what a row-less file is allowed to say.
          edges.push(...extractEdgesFromControlFile(content, file).edges);
        }
      } catch (error) {
        failed.push({ file, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return { records, edges, vorgaenge };
}

/**
 * Compare a file corpus with what keepmind holds for a project.
 *
 * `extraRecords` is reported but does NOT make the result incomplete: a record
 * authored directly in keepmind after the import is legitimately not in the
 * files, and treating that as an error would make the check fail more the
 * longer the new way of working is used.
 */
export function verifyMigration(
  db: VerifyStore,
  project: string,
  sources: VerifySource[],
): VerifyReport {
  const failed: VerifyReport['failed'] = [];
  const { records, edges, vorgaenge } = readSources(sources, failed);
  const eventLogs = verifyEventLogs(db, project, sources, failed);

  const sourceIds = [...new Set([...records.map(r => r.id), ...vorgaenge])].sort();

  // BOTH curated namespaces, or the check reports the one it cannot see as
  // lost. Decision records carry `$.record_id`, work items carry
  // `$.vorgang_id` — two keys because the two are deliberately never
  // conflated (a work item is where a decision is carried out, and merging
  // them makes "what did we decide" answer with open tasks). Reading only the
  // first key made a complete import of 200 work items report 200 records
  // MISSING and exit 1, with the importer's own line saying "Imported 200"
  // three lines further up. The rows were there the whole time; the query was
  // looking under one of the two names they are stored under.
  const storedRows = db.prepare(`
    SELECT COALESCE(
             json_extract(metadata, '$.record_id'),
             json_extract(metadata, '$.vorgang_id')
           ) AS record_id, valid_to
      FROM observations
     WHERE project = ? AND source_kind = 'curated'
       AND COALESCE(
             json_extract(metadata, '$.record_id'),
             json_extract(metadata, '$.vorgang_id')
           ) IS NOT NULL
     ORDER BY (valid_to IS NULL) ASC
  `).all(project) as Array<{ record_id: string; valid_to: number | null }>;

  // One entry per record; the active revision wins, exactly as everywhere else.
  const storedState = new Map<string, number | null>();
  for (const row of storedRows) storedState.set(String(row.record_id), row.valid_to);

  const storedIds = [...storedState.keys()].sort();
  const sourceSet = new Set(sourceIds);
  const storedSet = new Set(storedIds);

  const storedEdges = db.prepare(`
    SELECT from_record, to_record, relation, certainty, source_path
      FROM decision_edges WHERE project = ?
  `).all(project) as Array<{ from_record: string; to_record: string; relation: string; certainty: string; source_path: string }>;

  const storedEdgeKeys = new Set(storedEdges.map(e => edgeKey({ from: e.from_record, to: e.to_record, relation: e.relation })));
  const sourceEdgeKeys = new Set(edges.map(edgeKey));

  const missingEdges = edges
    .filter(e => !storedEdgeKeys.has(edgeKey(e)))
    .map(e => ({ from: e.from, to: e.to, relation: e.relation, certainty: e.certainty, sourcePath: e.sourcePath, sourceLine: e.sourceLine }));

  const extraEdges = storedEdges
    .filter(e => !sourceEdgeKeys.has(edgeKey({ from: e.from_record, to: e.to_record, relation: e.relation })))
    .map(e => ({ from: e.from_record, to: e.to_record, relation: e.relation, sourcePath: e.source_path }));

  // Which records the FILES say still apply, on the half the store also
  // computes: a declared, certain supersession. Same function the
  // contradiction check uses, so the two can never drift apart.
  const superseded = supersededRecords(edges);
  const currentInSource = records.filter(r => !superseded.has(r.id)).map(r => r.id).sort();
  const currentSourceSet = new Set(currentInSource);
  const currentInStore = storedIds.filter(id => storedState.get(id) === null);
  const currentStoreSet = new Set(currentInStore);

  // Validity is only meaningful for records BOTH sides have; a record that is
  // missing altogether is already reported as missing, and reporting it a
  // second time as "wrongly retired" would just double the noise.
  const comparable = sourceIds.filter(id => storedSet.has(id) && records.some(r => r.id === id));
  const wronglyRetired = comparable.filter(id => currentSourceSet.has(id) && !currentStoreSet.has(id));
  const wronglyActive = comparable.filter(id => !currentSourceSet.has(id) && currentStoreSet.has(id));

  const missingRecords = sourceIds.filter(id => !storedSet.has(id));
  const extraRecords = storedIds.filter(id => !sourceSet.has(id));

  // A corpus property, not a migration result — see the header. Split in two,
  // because only one half is a question: a record that says it was REPLACED
  // and names no replacement has a relation missing somewhere, while one that
  // says it was withdrawn or used up is simply finished.
  const retiredByStatus = records.filter(r => !superseded.has(r.id) && statusSaysValid(r.status) === false);
  const endedWithoutSuccessor = retiredByStatus
    .filter(r => statusEndsWithoutSuccessor(r.status))
    .map(r => r.id)
    .sort();
  const statusRetiredWithoutSupersession = retiredByStatus
    .filter(r => !statusEndsWithoutSuccessor(r.status))
    .map(r => r.id)
    .sort();

  return {
    project,
    sourceRecords: sourceIds,
    storedRecords: storedIds,
    missingRecords,
    extraRecords,
    sourceEdgeCount: edges.length,
    storedEdgeCount: storedEdges.length,
    missingEdges,
    extraEdges,
    currentInSource,
    currentInStore,
    wronglyRetired,
    wronglyActive,
    statusRetiredWithoutSupersession,
    endedWithoutSuccessor,
    failed,
    eventLogs,
    complete:
      missingRecords.length === 0 &&
      missingEdges.length === 0 &&
      wronglyRetired.length === 0 &&
      wronglyActive.length === 0 &&
      eventLogs.every(log => log.stored) &&
      failed.length === 0,
  };
}

/**
 * Did each work-item event log's wording arrive?
 *
 * Compared as TEXT, not as a count of parsed events: the point of storing the
 * log is that a line the reader misunderstands is still readable afterwards, so
 * the check has to be blind to the reader. Only line endings and trailing
 * whitespace are normalised, exactly as the importer normalises them.
 */
function verifyEventLogs(
  db: VerifyStore,
  project: string,
  sources: VerifySource[],
  failed: VerifyReport['failed'],
): VerifyReport['eventLogs'] {
  const out: VerifyReport['eventLogs'] = [];

  for (const source of sources) {
    if (source.kind !== 'vorgaenge') continue;
    const path = join(resolve(source.path), EVENT_LOG_FILE);
    if (!existsSync(path)) continue;

    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch (error) {
      failed.push({ file: path, error: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const expected = normaliseForCompare(content);
    const sourceEvents = parseEreignisLog(content).events.length;

    const rows = db.prepare(`
      SELECT narrative FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND json_extract(metadata, '$.kind') = 'ereignis-log'
         AND source_path = ?
         AND valid_to IS NULL
    `).all(project, path) as Array<{ narrative: string | null }>;

    if (rows.length === 0) {
      out.push({ path, sourceEvents, stored: false });
      continue;
    }
    const storedText = normaliseForCompare(rows[0].narrative ?? '');
    if (storedText === expected) {
      out.push({ path, sourceEvents, stored: true });
    } else {
      out.push({
        path,
        sourceEvents,
        stored: false,
        mismatch: `the stored log differs from the file (${storedText.length} vs ${expected.length} characters) — re-run the import`,
      });
    }
  }

  return out;
}

function normaliseForCompare(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '');
}
