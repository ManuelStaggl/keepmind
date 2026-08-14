// SPDX-License-Identifier: Apache-2.0
//
// Importer for curated decision records.
//
// THE GUARANTEE THIS FILE EXISTS TO MAKE: a curated record never reaches a
// provider. That is enforced by the WRITE PATH, not by where the bytes land —
// this module calls SessionStore.storeObservation directly and never enqueues
// anything on the observation queue, which is the only thing in keepmind that
// calls a model. Building the same feature as a KEEPMIND_MODE would NOT give
// this guarantee: a mode swaps prompts and vocabulary while leaving the
// processing chain intact, so curated records would still be compressed.
//
// The acceptance condition is therefore testable rather than promised:
// importing the whole corpus must produce zero outbound calls.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { parseAkte, type ParsedAkte } from './akten-parser.js';
import { extractEdges, extractEdgesFromControlFile, type DecisionEdge } from './edge-reader.js';
import { logger } from '../../utils/logger.js';

export interface ImportedRecord {
  /** Row id in `observations`. */
  id: number;
  /** Record number from the heading, e.g. "0068". */
  recordId: string;
  title: string;
  sourcePath: string;
  sourceLine: number;
  /** True when the row already existed and was matched by content hash. */
  unchanged: boolean;
  /** Declared relations read out of this record's header. */
  edges?: number;
}

export interface ImportReport {
  /** Files that carried a record number and were stored. */
  imported: ImportedRecord[];
  /**
   * Files skipped with the reason. Indexes, templates and readme files have no
   * record number; they are recognised by that absence rather than by
   * filename, so a renamed index does not silently become a record.
   */
  skipped: Array<{ file: string; reason: string }>;
  /** Files that could not be read or parsed at all. */
  failed: Array<{ file: string; error: string }>;
}

/**
 * The minimum of SessionStore this importer touches. Narrow on purpose: it
 * documents that the curated path uses the plain store call and nothing else —
 * no queue, no compressor, no provider.
 */
export interface CuratedStore {
  getOrCreateManualSession(project: string): string;
  /**
   * Optional so the importer stays usable against a store that predates the
   * edge table. When absent, records still import and only the graph is
   * missing — a partial result the caller can see, rather than a crash.
   */
  replaceEdgesForSource?(
    project: string,
    sourcePath: string,
    edges: Array<{ from: string; to: string; relation: string; certainty: string; sourceLine: number; rawText?: string | null }>,
    nowEpoch?: number,
  ): { inserted: number; removed: number };
  storeObservation(
    memorySessionId: string,
    project: string,
    observation: {
      type: string;
      title: string | null;
      subtitle: string | null;
      facts: string[];
      narrative: string | null;
      concepts: string[];
      files_read: string[];
      files_modified: string[];
      metadata?: string | null;
      source_kind?: string | null;
      source_path?: string | null;
      source_line?: number | null;
      subject?: string | null;
      last_verified_at?: number | null;
    },
    promptNumber?: number,
    discoveryTokens?: number,
    overrideTimestampEpoch?: number,
  ): { id: number; createdAtEpoch: number };
}

export interface ImportOptions {
  /** Project the records are filed under. */
  project: string;
  /** Set when the caller knows the wall clock; keeps imports reproducible. */
  nowEpoch?: number;
  /** Report what would happen without writing. */
  dryRun?: boolean;
}

/** Build the narrative stored for a record: header first, then body, verbatim. */
export function renderRecord(parsed: ParsedAkte): string {
  const header = parsed.headerText.trim();
  const body = parsed.body.trim();
  return [header, body].filter(part => part.length > 0).join('\n\n');
}

/**
 * `Stand: gilt` / `abgelöst` / `zurückgezogen` decides whether a record still
 * counts. We store the status verbatim and do NOT map it onto valid_to here:
 * closing a validity window is a supersession, and a supersession needs the
 * record that replaced it. That link comes from the declared relation, which
 * is the edge reader's job — not from the status word alone.
 */
export function subtitleFor(parsed: ParsedAkte): string {
  const parts: string[] = [];
  if (parsed.status) parts.push(`Stand: ${parsed.status}`);
  if (parsed.date) parts.push(parsed.date);
  if (parsed.decidedBy) parts.push(parsed.decidedBy);
  return parts.length > 0 ? parts.join(' · ') : 'Kuratierte Akte';
}

/** Files worth opening. Everything else is not a candidate at all. */
function isMarkdown(file: string): boolean {
  return extname(file).toLowerCase() === '.md';
}

/** Shape the edge reader's output for the store. */
function toEdgeRows(edges: DecisionEdge[]) {
  return edges.map(edge => ({
    from: edge.from,
    to: edge.to,
    relation: edge.relation,
    certainty: edge.certainty,
    sourceLine: edge.sourceLine,
    rawText: edge.rawText,
  }));
}

export function importAkteFile(
  store: CuratedStore,
  memorySessionId: string,
  absolutePath: string,
  options: ImportOptions,
): { record?: ImportedRecord; skipped?: string } {
  const content = readFileSync(absolutePath, 'utf8');
  const parsed = parseAkte(content);

  if (!parsed.id) {
    // No record number: an index, a template or a control file. Recognised by
    // the missing number rather than by filename — filename rules need a
    // second list to keep in sync, and the corpus renames files freely.
    //
    // NOT A RECORD IS NOT THE SAME AS NOT A SOURCE. In the measured corpus a
    // control file declares two records obsolete, and nothing inside those
    // records knows it; another names a supersession that the superseded
    // record does carry. Skipping these files as RECORDS is right — they are
    // not decisions and must not become rows — but their edges are read all
    // the same, or the graph provably misses relations that exist in writing.
    if (!options.dryRun && store.replaceEdgesForSource) {
      const { edges } = extractEdgesFromControlFile(content, absolutePath);
      store.replaceEdgesForSource(options.project, absolutePath, toEdgeRows(edges), options.nowEpoch);
      return { skipped: `no record number in heading (read ${edges.length} edge(s) anyway)` };
    }
    return { skipped: 'no record number in heading' };
  }

  if (options.dryRun) {
    return {
      record: {
        id: -1,
        recordId: parsed.id,
        title: parsed.title,
        sourcePath: absolutePath,
        sourceLine: parsed.headingLine,
        unchanged: false,
      },
    };
  }

  const narrative = renderRecord(parsed);
  const result = store.storeObservation(
    memorySessionId,
    options.project,
    {
      // 'decision' is what these records are. The type is not inferred from
      // the text — every file in a curated corpus is a decision by
      // construction, which is exactly why no model is needed to label them.
      type: 'decision',
      title: `${parsed.id} — ${parsed.title}`,
      subtitle: subtitleFor(parsed),
      facts: [],
      narrative,
      concepts: [],
      files_read: [],
      files_modified: [],
      source_kind: 'curated',
      source_path: absolutePath,
      source_line: parsed.headingLine,
      subject: parsed.title,
      last_verified_at: null,
      metadata: JSON.stringify({
        record_id: parsed.id,
        status: parsed.status,
        date: parsed.date,
        decided_by: parsed.decidedBy,
        summary: parsed.summary,
        // Every harvested label, kept as written. The edge reader works from
        // this rather than re-opening the file, and it is the record of what
        // the corpus actually offered — which is the only defence against a
        // parser that quietly stops recognising a label.
        fields: parsed.fields.map(f => ({ name: f.name, value: f.value, line: f.line })),
        unlabelled: parsed.unlabelled,
      }),
    },
    0,
    0,
    options.nowEpoch,
  );

  // Edges are replaced per file, so re-reading one changed record neither
  // drops what other files declared nor leaves its own stale edges behind.
  let edgeCount = 0;
  if (store.replaceEdgesForSource) {
    const { edges } = extractEdges(parsed, absolutePath);
    store.replaceEdgesForSource(options.project, absolutePath, toEdgeRows(edges), options.nowEpoch);
    edgeCount = edges.length;
  }

  return {
    record: {
      id: result.id,
      recordId: parsed.id,
      title: parsed.title,
      sourcePath: absolutePath,
      sourceLine: parsed.headingLine,
      unchanged: false,
      edges: edgeCount,
    },
  };
}

/**
 * Import every record in `directory`.
 *
 * The caller decides which directories to hand in. That is deliberate: the
 * corpus this was measured against keeps relation notes in files OUTSIDE its
 * records folder — a control file declared two records obsolete and nothing
 * inside the folder knew. An importer hard-wired to one directory builds a
 * graph that provably misses edges, so the source set is a configuration
 * decision, not a constant.
 */
export function importAktenDirectory(
  store: CuratedStore,
  directory: string,
  options: ImportOptions,
): ImportReport {
  const root = resolve(directory);
  const report: ImportReport = { imported: [], skipped: [], failed: [] };

  let entries: string[];
  try {
    entries = readdirSync(root).sort();
  } catch (error) {
    report.failed.push({ file: root, error: error instanceof Error ? error.message : String(error) });
    return report;
  }

  const memorySessionId = options.dryRun
    ? 'dry-run'
    : store.getOrCreateManualSession(options.project);

  for (const entry of entries) {
    const absolutePath = join(root, entry);
    try {
      if (statSync(absolutePath).isDirectory()) continue;
      if (!isMarkdown(entry)) {
        report.skipped.push({ file: entry, reason: 'not markdown' });
        continue;
      }
      const outcome = importAkteFile(store, memorySessionId, absolutePath, options);
      if (outcome.skipped) {
        report.skipped.push({ file: entry, reason: outcome.skipped });
      } else if (outcome.record) {
        report.imported.push(outcome.record);
      }
    } catch (error) {
      report.failed.push({ file: entry, error: error instanceof Error ? error.message : String(error) });
    }
  }

  logger.info('DB', 'Curated import finished', {
    directory: root,
    project: options.project,
    imported: report.imported.length,
    skipped: report.skipped.length,
    failed: report.failed.length,
    dryRun: options.dryRun === true,
  });

  return report;
}
