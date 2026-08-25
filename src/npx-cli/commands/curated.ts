// SPDX-License-Identifier: Apache-2.0
//
// `keepmind curated:import` — import the configured curated source set.
//
// The difference from `akten:import` is not the work, it is where the source
// list comes from. Directories typed on a command line cannot be re-run
// identically and cannot be reviewed; a configured list can be both. That
// matters here more than usual, because this importer is idempotent by
// replacing what a file previously produced — replaying a DIFFERENT set of
// directories does not restore the previous state, it produces a third one.
//
// Like every command on this path, it reaches no model and opens no socket.

import { resolve } from 'node:path';
// Type-only: erased at runtime, so the lazy imports below still decide what
// actually gets loaded.
import type { CuratedSource } from '../../services/curated/sources.js';

export interface CuratedImportOptions {
  /** Explicit directories. When empty, the configured set is used. */
  directories: string[];
  /** Only meaningful together with explicit directories. */
  kind?: 'akten' | 'vorgaenge';
  project?: string;
  dryRun: boolean;
  json: boolean;
}

export function parseCuratedImportOptions(args: string[]): CuratedImportOptions {
  const directories: string[] = [];
  let project: string | undefined;
  let kind: 'akten' | 'vorgaenge' | undefined;
  let dryRun = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--json') { json = true; continue; }
    if (arg === '--project') { project = args[++i]; continue; }
    if (arg.startsWith('--project=')) { project = arg.slice('--project='.length); continue; }
    if (arg === '--kind') { kind = args[++i] as 'akten' | 'vorgaenge'; continue; }
    if (arg.startsWith('--kind=')) { kind = arg.slice('--kind='.length) as 'akten' | 'vorgaenge'; continue; }
    if (arg.startsWith('--')) continue;
    directories.push(arg);
  }

  return { directories, kind, project, dryRun, json };
}

function usage(): string {
  return [
    'Usage: keepmind curated:import [<directory>… --kind akten|vorgaenge] [options]',
    '',
    'With no directory, imports the configured source set — `curatedSources` in',
    '~/.keepmind/settings.json, or the KEEPMIND_CURATED_SOURCES environment',
    'variable (inline JSON or a path to a JSON file):',
    '',
    '  "curatedSources": [',
    '    { "path": "C:/Projekte/entscheidungen",  "kind": "akten" },',
    '    { "path": "C:/Projekte/steuerdateien",   "kind": "akten" },',
    '    { "path": "C:/Projekte/vorgaenge",       "kind": "vorgaenge" }',
    '  ]',
    '',
    'Control files belong under "akten": they are not decisions and store no row,',
    'but they demonstrably declare relations that no record carries itself.',
    '',
    'Each entry may name its own "project". Without one, KEEPMIND_CURATED_PROJECT',
    'in the same file decides — and it must, because the worker re-runs this same',
    'import unattended (at startup and when a source file changes) and has no',
    'working directory to fall back on.',
    '',
    'The command exits non-zero unless the imported records are SEARCHABLE, not',
    'merely stored: it starts the worker if needed and verifies the index.',
    '',
    'Options:',
    '  --kind <k>         Kind for directories given on the command line',
    '  --project <name>   File the records under this project',
    '  --dry-run          Report what would be imported, write nothing',
    '  --json             Machine-readable output',
    '',
    'No model is involved at any point.',
  ].join('\n');
}

export async function runCuratedImportCommand(options: CuratedImportOptions): Promise<void> {
  const { loadCuratedSources, missingSources } = await import('../../services/curated/sources.js');

  let sources: CuratedSource[];
  let origin: string;

  if (options.directories.length > 0) {
    if (!options.kind) {
      console.error('When directories are given, --kind akten|vorgaenge is required.');
      console.error('Guessing the kind from the contents would be right most of the time,');
      console.error('and storing work items as decisions is not a recoverable mistake.\n');
      console.log(usage());
      process.exitCode = 1;
      return;
    }
    sources = options.directories.map(d => ({ path: resolve(d), kind: options.kind! }));
    origin = 'command line';
  } else {
    const configured = loadCuratedSources();
    origin = configured.origin;
    sources = configured.sources;

    if (configured.rejected.length > 0) {
      console.error(`${configured.rejected.length} entr(y|ies) in the source set were rejected:`);
      for (const item of configured.rejected) {
        console.error(`  ${JSON.stringify(item.entry)} — ${item.reason}`);
      }
      process.exitCode = 1;
      return;
    }

    if (sources.length === 0) {
      console.log(`No curated sources configured (looked in ${origin}).\n`);
      console.log(usage());
      process.exitCode = 1;
      return;
    }
  }

  const absent = missingSources(sources);
  if (absent.length > 0) {
    // A configured directory that is not there is a broken configuration, not
    // an empty import. Continuing would report success over a partial corpus.
    console.error('Configured source directories are missing:');
    for (const source of absent) console.error(`  ${source.path}`);
    process.exitCode = 1;
    return;
  }

  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  const { runCuratedImport } = await import('../../services/curated/import-run.js');
  const { getProjectName } = await import('../../utils/project-name.js');
  const { loadCuratedProject } = await import('../../services/curated/sources.js');

  // Same order everywhere a curated write happens: what was asked for, then
  // what is configured, then the directory. The worker has no cwd worth using,
  // so if the CLI fell back to one the same corpus would land under two
  // different projects depending on who ran the import.
  const project = options.project ?? loadCuratedProject() ?? getProjectName(process.cwd());
  const store = new SessionStore();
  const nowEpoch = Date.now();

  // The run itself lives in the service layer, because the worker triggers the
  // very same run when a source file changes. This command renders it.
  const report = await runCuratedImport(store, sources, { project, dryRun: options.dryRun, nowEpoch });
  const summary = report.sources;
  const failedTotal = report.failedTotal;
  const supersession = report.supersession;
  if (report.supersessionError) {
    console.error(`  ⚠ Supersession step failed: ${report.supersessionError}`);
  }

  // Index what we just wrote, and VERIFY it. This process writes rows directly
  // and enqueues nothing — that is what keeps a curated record away from a
  // model — so nothing else tells the worker the rows exist, and their
  // embeddings would otherwise appear only at the next periodic pass. Measured
  // straight after an import: semantic search returned nothing for the new rows
  // and reported no error. An import that ends here without an index has not
  // imported anything anybody can find, and it exits non-zero to say so.
  const indexed = options.dryRun ? null : await ensureCuratedIndexed(project);

  const recordTotal = summary.reduce((sum, entry) => sum + Number(entry.imported ?? 0), 0);
  const edgeTotal = summary.reduce((sum, entry) => sum + Number(entry.edges ?? 0), 0);
  if (!options.dryRun) {
    await stampImportState({
      project,
      sources,
      records: recordTotal,
      edges: edgeTotal,
      nowEpoch,
      indexed: indexed?.indexed === true,
      failure: failedTotal > 0
        ? `${failedTotal} file(s) failed to import`
        : indexed?.indexed === false
          ? `not indexed — ${indexed.reason ?? 'unknown reason'}`
          : null,
    });
  }

  if (indexed && !indexed.indexed) process.exitCode = 1;

  if (options.json) {
    console.log(JSON.stringify({ project, origin, dryRun: options.dryRun, sources: summary, supersession, indexed }, null, 2));
    if (failedTotal > 0) process.exitCode = 1;
    return;
  }

  const verb = options.dryRun ? 'Would import' : 'Imported';
  console.log(`Source set from ${origin}, project "${project}".\n`);

  for (const entry of summary) {
    console.log(`  ${entry.path}  [${entry.kind}]`);
    const fromControl = typeof entry.controlFileEdges === 'number' && entry.controlFileEdges > 0
      ? ` (${entry.controlFileEdges} from files that store no row)`
      : '';
    console.log(`    ${verb} ${entry.imported}, skipped ${entry.skipped}, edges ${entry.edges}${fromControl}`);
    if (entry.states) console.log(`    States: ${JSON.stringify(entry.states)}`);

    // Everything below is a fact about the corpus the operator should see.
    // Summarising these away is how a partial import comes to look complete.
    if (entry.eventLogMissing) {
      console.log(`    ⚠ no ${'EREIGNISSE.log'} — every state is "unbekannt"`);
    } else if (entry.kind === 'vorgaenge') {
      // Said out loud because it is the condition for removing the file: until
      // the log's own wording is in the store, deleting it loses the history of
      // how every work item reached its state.
      console.log(entry.eventLogStored
        ? `    Event log stored verbatim: ${entry.eventCount ?? 0} event(s) — the file is now reproducible from keepmind`
        : `    ⚠ event log NOT stored — do not delete ${'EREIGNISSE.log'}`);
    }
    const orphans = entry.orphanEvents as Array<{ vorgang: string; line: number; raw: string }> | undefined;
    if (orphans?.length) {
      // Not an error: the log is append-only and outlives individual files.
      // Their wording is safe in the stored log; only no state was derived.
      console.log(`    ${orphans.length} event(s) name an item this directory holds no file for — kept in the stored log, no state derived:`);
      for (const item of orphans.slice(0, 10)) console.log(`        line ${item.line}: ${item.raw}`);
      if (orphans.length > 10) console.log(`        … ${orphans.length - 10} more (--json for all)`);
    }
    const malformed = entry.malformedLogLines as Array<{ line: number; reason: string }> | undefined;
    if (malformed?.length) {
      console.log(`    ⚠ ${malformed.length} malformed log line(s):`);
      for (const item of malformed) console.log(`        line ${item.line}: ${item.reason}`);
    }
    const unknown = entry.unknownKinds as Array<{ line: number; art: string; vorgang: string }> | undefined;
    if (unknown?.length) {
      console.log(`    ⚠ ${unknown.length} unknown event kind(s) — state left underived:`);
      for (const item of unknown) console.log(`        line ${item.line}: "${item.art}" on ${item.vorgang}`);
    }
    // Not a warning and not an error: a statement the importer declined to
    // act on, with the place it was written. Printed because the alternative
    // is a graph that quietly holds less than the files say, which is
    // indistinguishable from a reader that stopped working.
    const withheld = entry.withheldSupersessions as Array<{ file: string; to: string; line: number; rawText: string }> | undefined;
    if (withheld?.length) {
      console.log(`    ${withheld.length} supersession(s) declared by files that store no row — not written (only a record may retire a record):`);
      for (const item of withheld.slice(0, 10)) {
        console.log(`        → ${item.to}  ${item.file}:${item.line}`);
      }
      if (withheld.length > 10) console.log(`        … ${withheld.length - 10} more (--json for all)`);
    }
    // The sharpest of the "declined to act" reports: the file was read and
    // stored, but the number already answers with something a person wrote
    // here. Left silent, the run reads as clean while two sources disagree
    // about what a record says — and the file wording would have taken the
    // number without anyone being told.
    const conflicts = entry.authoredConflicts as Array<{ file: string; recordId: string; authoredSource: string }> | undefined;
    if (conflicts?.length) {
      console.log(`    ⚠ ${conflicts.length} record number(s) claimed by a file while an entry written here holds them:`);
      for (const item of conflicts.slice(0, 10)) {
        console.log(`        ${item.recordId}  ${item.file} — kept: ${item.authoredSource}`);
      }
      if (conflicts.length > 10) console.log(`        … ${conflicts.length - 10} more (--json for all)`);
      console.log('        The file was stored but is NOT the current revision. Renumber one of the two.');
    }
    const selfEdges = entry.selfEdges as Array<{ vorgang: string; field: string; sourceLine: number }> | undefined;
    if (selfEdges?.length) {
      console.log(`    ⚠ ${selfEdges.length} relation field(s) pointing at their own item, not written:`);
      for (const item of selfEdges) console.log(`        ${item.vorgang} ${item.field}: ${item.vorgang} (line ${item.sourceLine})`);
    }
    const failed = entry.failed as Array<{ file: string; error: string }>;
    if (failed.length > 0) {
      console.log(`    ✖ ${failed.length} failed:`);
      for (const item of failed) console.log(`        ${item.file} — ${item.error}`);
    }
    console.log('');
  }

  if (supersession) {
    console.log(`  Supersession: ${supersession.closed.length} record(s) retired by ${supersession.edgesApplied} edge(s), ${supersession.reopened} window(s) reopened.`);
    // Uncertain edges are listed, never applied. A wrongly retired record is
    // invisible, and invisible is the one failure nobody notices.
    if (supersession.uncertain.length > 0) {
      console.log(`    ${supersession.uncertain.length} uncertain supersession(s) NOT applied — decide by hand:`);
      for (const item of supersession.uncertain) {
        console.log(`        ${item.from} → ${item.to}  ${item.sourcePath}:${item.sourceLine}`);
      }
    }
    if (supersession.unknownTargets.length > 0) {
      console.log(`    ${supersession.unknownTargets.length} edge(s) name a record with no row:`);
      for (const item of supersession.unknownTargets) {
        console.log(`        ${item.from} → ${item.to}  ${item.sourcePath}:${item.sourceLine}`);
      }
    }
    console.log('');
  }

  reportIndexOutcome(indexed);

  if (failedTotal > 0) process.exitCode = 1;
}

/**
 * Say plainly whether the corpus is searchable — the same words wherever a
 * curated write happens, so the one line that matters reads the same after an
 * import as after a single authored record.
 */
export function reportIndexOutcome(indexed: IndexOutcome | null): void {
  if (!indexed) return;
  if (indexed.indexed) {
    const repaired = indexed.repaired
      ? ' (a stale watermark was rewound — records that had silently fallen out of the index are back)'
      : '';
    console.log(`  Searchable: ${indexed.total ?? 0} curated record(s) are in the semantic index${repaired}.\n`);
    return;
  }
  // Not a footnote under a success message. The import did not do what it says
  // on the tin, and the exit code agrees.
  console.log(`  ✖ NOT searchable: ${indexed.reason ?? 'the semantic index was not updated'}`);
  if (indexed.missing) console.log(`    ${indexed.missing} of ${indexed.total ?? '?'} curated record(s) have no vector.`);
  console.log('    Keyword search still finds them. Semantic search does not — so this run counts as failed.');
  console.log('    `npx keepmind doctor` says which layer is down.\n');
}

/**
 * Record what this run did, so a later session can tell a failed import from
 * one that never ran. Never fatal: a lost stamp costs a redundant re-import.
 */
async function stampImportState(input: {
  project: string;
  sources: CuratedSource[];
  records: number;
  edges: number;
  nowEpoch: number;
  indexed: boolean;
  failure: string | null;
}): Promise<void> {
  try {
    const { readImportState, stampSources, writeImportState } = await import('../../services/curated/import-state.js');
    const previous = readImportState(input.project);
    const success = input.failure === null && input.indexed;
    writeImportState({
      project: input.project,
      lastAttemptEpoch: input.nowEpoch,
      lastSuccessEpoch: success ? input.nowEpoch : previous?.lastSuccessEpoch ?? null,
      records: success ? input.records : previous?.records ?? 0,
      edges: success ? input.edges : previous?.edges ?? 0,
      indexed: input.indexed,
      failure: input.failure,
      // Only a SUCCESSFUL run may move the fingerprint. Stamping after a failure
      // would mark the sources as covered by an import that did not cover them,
      // and the staleness check would then stay quiet forever.
      sources: success ? stampSources(input.sources) : previous?.sources ?? [],
    });
  } catch {
    /* the import itself is done; the stamp is bookkeeping */
  }
}

export interface IndexOutcome {
  indexed: boolean;
  /** Curated rows checked. */
  total?: number;
  /** Rows still without a vector. */
  missing?: number;
  /** True when a watermark had to be rewound to make the rows visible again. */
  repaired?: boolean;
  reason?: string;
}

/**
 * A corpus import can re-embed hundreds of records; the default API timeout is
 * sized for a hook. Overridable for a corpus that outgrows even this.
 */
function indexTimeoutMs(): number {
  const raw = Number(process.env.KEEPMIND_CURATED_INDEX_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15 * 60_000;
}

/**
 * Make what was just written FINDABLE, and say so only if it is.
 *
 * This used to be a best-effort ping: it read `worker.port`, posted a backfill
 * request, and reported whatever came back as a footnote under a success
 * message. Every failure mode of that arrangement was silent from the outside —
 * no port file, a worker that declined, a worker that embedded nothing — and
 * the import still ended with "Imported 200". The store held the records and
 * search could not see them, which is the same thing as not holding them.
 *
 * So: START the worker rather than noticing it is absent (it is the only
 * process that may touch the vector store and its watermarks), then ask it to
 * verify, not merely to try. The caller is expected to treat `indexed: false`
 * as a failed import, because that is what it is.
 */
export async function ensureCuratedIndexed(project: string): Promise<IndexOutcome> {
  const { ensureWorkerRunning, workerHttpRequest } = await import('../../shared/worker-utils.js');

  let running = false;
  try {
    running = await ensureWorkerRunning();
  } catch (error) {
    return { indexed: false, reason: `the worker could not be started — ${error instanceof Error ? error.message : error}` };
  }
  if (!running) {
    return { indexed: false, reason: 'the worker could not be started, so nothing embedded the new records' };
  }

  try {
    const response = await workerHttpRequest('/api/curated/ensure-indexed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project }),
      timeoutMs: indexTimeoutMs(),
    });
    if (!response.ok) return { indexed: false, reason: `the worker replied ${response.status}` };
    const body = await response.json() as {
      indexed?: boolean; total?: number; missing?: number; repaired?: boolean; reason?: string;
    };
    return {
      indexed: body.indexed === true,
      total: body.total,
      missing: body.missing,
      repaired: body.repaired,
      reason: body.reason,
    };
  } catch (error) {
    return { indexed: false, reason: `the worker was unreachable — ${error instanceof Error ? error.message : error}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// `keepmind curated:verify` — did the file corpus arrive complete?
//
// Run it AFTER the one-time import and BEFORE the files are removed. It is the
// only moment both sides exist, so it is the only moment the question can be
// answered at all. See src/services/curated/migration-verify.ts for what is
// compared and why those three things.
// ─────────────────────────────────────────────────────────────────────────

export async function runCuratedVerifyCommand(options: CuratedImportOptions): Promise<void> {
  const { loadCuratedSources, loadCuratedProject, missingSources } = await import('../../services/curated/sources.js');
  const { verifyMigration } = await import('../../services/curated/migration-verify.js');
  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  const { getProjectName } = await import('../../utils/project-name.js');

  let sources: CuratedSource[];
  let origin: string;

  if (options.directories.length > 0) {
    if (!options.kind) {
      console.error('When directories are given, --kind akten|vorgaenge is required.');
      process.exitCode = 1;
      return;
    }
    sources = options.directories.map(d => ({ path: resolve(d), kind: options.kind! }));
    origin = 'command line';
  } else {
    const configured = loadCuratedSources();
    origin = configured.origin;
    sources = configured.sources;
    if (sources.length === 0) {
      console.log(`No curated sources configured (looked in ${origin}).`);
      process.exitCode = 1;
      return;
    }
  }

  const absent = missingSources(sources);
  if (absent.length > 0) {
    // A source directory that is gone cannot be compared against. Saying "the
    // migration is complete" while one of the sources is unreadable is exactly
    // the false all-clear this command exists to prevent.
    console.error('Configured source directories are missing — cannot verify against them:');
    for (const source of absent) console.error(`  ${source.path}`);
    process.exitCode = 1;
    return;
  }

  const project = options.project ?? loadCuratedProject() ?? getProjectName(process.cwd());
  const store = new SessionStore();
  const report = verifyMigration(store.db as never, project, sources);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    if (!report.complete) process.exitCode = 1;
    return;
  }

  console.log(`Comparing ${sources.length} source director(y|ies) from ${origin} with project "${project}".\n`);
  console.log(`  Records:   ${report.sourceRecords.length} in the files, ${report.storedRecords.length} in keepmind`);
  console.log(`  Relations: ${report.sourceEdgeCount} declared, ${report.storedEdgeCount} in the graph`);
  console.log(`  In force:  ${report.currentInSource.length} per the files, ${report.currentInStore.length} per keepmind\n`);

  const list = (label: string, items: string[]) => {
    if (items.length === 0) return;
    console.log(`  ✖ ${label} (${items.length}): ${items.join(', ')}`);
  };
  list('In the files, MISSING from keepmind', report.missingRecords);
  list('In force in the files, RETIRED in keepmind', report.wronglyRetired);
  list('Retired in the files, IN FORCE in keepmind', report.wronglyActive);

  if (report.missingEdges.length > 0) {
    console.log(`  ✖ Declared relations missing from the graph (${report.missingEdges.length}):`);
    for (const edge of report.missingEdges.slice(0, 25)) {
      console.log(`      ${edge.from} -[${edge.relation}/${edge.certainty}]-> ${edge.to}   ${edge.sourcePath}:${edge.sourceLine}`);
    }
    if (report.missingEdges.length > 25) console.log(`      … ${report.missingEdges.length - 25} more (--json for all)`);
  }

  if (report.failed.length > 0) {
    console.log(`  ✖ Files that could not be read (${report.failed.length}):`);
    for (const item of report.failed) console.log(`      ${item.file} — ${item.error}`);
  }

  // Reported, never fatal: an entry authored directly in keepmind is
  // legitimately absent from the files, and it becomes more common the longer
  // the file-free way of working is used.
  if (report.extraRecords.length > 0) {
    console.log(`\n  ${report.extraRecords.length} record(s) in keepmind that no file declares — expected for anything authored here: ${report.extraRecords.slice(0, 20).join(', ')}${report.extraRecords.length > 20 ? ' …' : ''}`);
  }
  if (report.extraEdges.length > 0) {
    console.log(`  ${report.extraEdges.length} relation(s) in the graph that these sources do not declare.`);
  }
  if (report.endedWithoutSuccessor.length > 0) {
    // A resting state, not an open question. Named as one, because the earlier
    // wording sent someone looking for a successor that was never meant to
    // exist — 0036 expired with its one run, 0109 was withdrawn as a duplicate.
    console.log(`  ${report.endedWithoutSuccessor.length} record(s) ended on their own terms (withdrawn, expired, used up) — no successor expected: ${report.endedWithoutSuccessor.slice(0, 20).join(', ')}${report.endedWithoutSuccessor.length > 20 ? ' …' : ''}`);
  }
  if (report.statusRetiredWithoutSupersession.length > 0) {
    // A property of the corpus, not of the migration: the importer stores
    // `Stand:` verbatim and does not turn a status word into a closed window,
    // because closing one is a supersession and a supersession needs the record
    // that replaced it. `akten:check` is the command that examines this.
    console.log(`  ${report.statusRetiredWithoutSupersession.length} record(s) say they were REPLACED while naming no replacement — \`keepmind akten:check\` examines those: ${report.statusRetiredWithoutSupersession.slice(0, 20).join(', ')}${report.statusRetiredWithoutSupersession.length > 20 ? ' …' : ''}`);
  }

  for (const log of report.eventLogs) {
    if (log.stored) {
      console.log(`  Event log: ${log.sourceEvents} event(s) from ${log.path} are stored verbatim.`);
    } else {
      // The one thing a green result used to say nothing about. Only the
      // DERIVED state was stored, so a corpus could arrive "complete" while the
      // history of how every work item got there still lived in a file nobody
      // had been told to keep.
      console.log(`  ✖ Event log NOT stored: ${log.path} (${log.sourceEvents} event(s))${log.mismatch ? ` — ${log.mismatch}` : ''}`);
    }
  }

  if (report.complete) {
    console.log('\n  ✔ Every record, every declared relation, every validity window and every event log arrived.');
    console.log('    The file archive is now redundant — it can be removed.');
    return;
  }
  console.log('\n  The corpus did NOT arrive complete. Do not remove the files.');
  process.exitCode = 1;
}
