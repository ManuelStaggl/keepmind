// SPDX-License-Identifier: Apache-2.0
//
// One curated import run — the work itself, with no console and no process.
//
// WHY IT MOVED HERE. The loop used to live inside the CLI command, which was
// fine while a person typing `curated:import` was the only thing that could
// start one. It is not any more: the worker triggers the same import when a
// source file changes and when a session starts against a stale store. Two
// callers means either one implementation or two — and two implementations of
// "read the corpus into memory" would drift exactly the way the four scripts
// that once defined the source set drifted.
//
// So this function does the work and RETURNS what happened. Rendering it, and
// deciding whether a given outcome is fatal, belongs to the caller: the CLI
// prints and sets an exit code, the worker logs and writes the health stamp.

import type { CuratedSource } from './sources.js';

export interface CuratedSourceReport {
  path: string;
  kind: 'akten' | 'vorgaenge';
  imported: number;
  skipped: number;
  failed: Array<{ file: string; error: string }>;
  edges: number;
  /** Akten only: edges contributed by files that store no row of their own. */
  controlFileEdges?: number;
  /**
   * Akten only: records a file claims while an entry authored here holds the
   * number. The file's row is stored but does not become current.
   */
  authoredConflicts?: Array<{ file: string; recordId: string; authoredSource: string }>;
  /** Akten only: supersessions a control file declared and was not allowed to write. */
  withheldSupersessions?: Array<{ file: string; to: string; line: number; rawText: string }>;
  /** Vorgänge only. */
  states?: Record<string, number>;
  eventLogMissing?: boolean;
  /** Events read from the log, and whether its wording was stored. */
  eventCount?: number;
  eventLogStored?: boolean;
  /** Events naming an item this directory holds no file for. */
  orphanEvents?: Array<{ vorgang: string; line: number; raw: string }>;
  malformedLogLines?: Array<{ line: number; reason: string }>;
  unknownKinds?: Array<{ line: number; art: string; vorgang: string }>;
  selfEdges?: Array<{ vorgang: string; field: string; sourceLine: number }>;
}

export interface SupersessionOutcome {
  closed: unknown[];
  edgesApplied: number;
  reopened: number;
  uncertain: Array<{ from: string; to: string; sourcePath: string; sourceLine: number }>;
  unknownTargets: Array<{ from: string; to: string; sourcePath: string; sourceLine: number }>;
  settled?: Array<{ record: string; reason: string }>;
}

export interface CuratedImportReport {
  project: string;
  sources: CuratedSourceReport[];
  /** Files that could not be read or parsed, across all sources. */
  failedTotal: number;
  /** Rows written, across all sources. */
  records: number;
  /** Declared relations written, across all sources. */
  edges: number;
  supersession: SupersessionOutcome | null;
  /** Set when the supersession step itself failed; the import still stands. */
  supersessionError: string | null;
}

export interface CuratedImportRunOptions {
  project: string;
  dryRun?: boolean;
  nowEpoch?: number;
}

/**
 * Import every configured source into `store`.
 *
 * `store` is whatever `SessionStore` the caller already has open — the worker
 * passes its own rather than opening a second connection to the same file.
 * Nothing here enqueues an observation, so nothing here can reach a model.
 */
export async function runCuratedImport(
  store: unknown,
  sources: CuratedSource[],
  options: CuratedImportRunOptions,
): Promise<CuratedImportReport> {
  const { importAktenDirectory } = await import('./akten-importer.js');
  const { importVorgaengeDirectory } = await import('./vorgang-importer.js');

  const { project } = options;
  const dryRun = options.dryRun === true;
  const nowEpoch = options.nowEpoch ?? Date.now();

  const reports: CuratedSourceReport[] = [];
  let failedTotal = 0;

  for (const source of sources) {
    if (source.kind === 'akten') {
      const report = importAktenDirectory(store as never, source.path, { project, dryRun, nowEpoch });
      failedTotal += report.failed.length;
      reports.push({
        path: source.path,
        kind: source.kind,
        imported: report.imported.length,
        skipped: report.skipped.length,
        failed: report.failed,
        // Control files store no row, so their edges are not in `imported` —
        // summing that alone reported 0 for a directory that contributed
        // relations.
        edges: report.imported.reduce((sum, r) => sum + (r.edges ?? 0), 0) + report.controlFileEdges,
        controlFileEdges: report.controlFileEdges,
        authoredConflicts: report.authoredConflicts,
        withheldSupersessions: report.withheldSupersessions,
      });
    } else {
      const report = importVorgaengeDirectory(store as never, source.path, { project, dryRun, nowEpoch });
      failedTotal += report.failed.length;
      reports.push({
        path: source.path,
        kind: source.kind,
        imported: report.imported.length,
        skipped: report.skipped.length,
        failed: report.failed,
        edges: report.imported.reduce((sum, r) => sum + r.edges, 0),
        states: report.imported.reduce((acc: Record<string, number>, r) => {
          acc[r.state] = (acc[r.state] ?? 0) + 1;
          return acc;
        }, {}),
        eventLogMissing: report.eventLogMissing,
        eventCount: report.eventCount,
        eventLogStored: report.eventLogStored,
        orphanEvents: report.orphanEvents,
        malformedLogLines: report.malformed,
        unknownKinds: report.unknownKinds,
        selfEdges: report.selfEdges,
      });
    }
  }

  // Close the validity window of every record a later one supersedes. This runs
  // after ALL sources, because a record and the record it retires do not have
  // to sit in the same directory.
  let supersession: SupersessionOutcome | null = null;
  let supersessionError: string | null = null;
  if (!dryRun) {
    try {
      const { applySupersessions } = await import('./supersession.js');
      const db = (store as { db: Parameters<typeof applySupersessions>[0] }).db;
      supersession = applySupersessions(db, project, nowEpoch) as unknown as SupersessionOutcome;
    } catch (error) {
      // Reported, not thrown: the import already succeeded at this point, and
      // refusing to return would throw away a completed import over a
      // bookkeeping step.
      supersessionError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    project,
    sources: reports,
    failedTotal,
    records: reports.reduce((sum, r) => sum + r.imported, 0),
    edges: reports.reduce((sum, r) => sum + r.edges, 0),
    supersession,
    supersessionError,
  };
}
