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
  const { importAktenDirectory } = await import('../../services/curated/akten-importer.js');
  const { importVorgaengeDirectory } = await import('../../services/curated/vorgang-importer.js');
  const { getProjectName } = await import('../../utils/project-name.js');

  const project = options.project ?? getProjectName(process.cwd());
  const store = new SessionStore();
  const nowEpoch = Date.now();

  const summary: Array<Record<string, unknown>> = [];
  let failedTotal = 0;

  for (const source of sources) {
    if (source.kind === 'akten') {
      const report = importAktenDirectory(store as never, source.path, { project, dryRun: options.dryRun, nowEpoch });
      failedTotal += report.failed.length;
      summary.push({
        path: source.path, kind: source.kind,
        imported: report.imported.length,
        skipped: report.skipped.length,
        failed: report.failed,
        // Control files store no row, so their edges are not in `imported` —
        // summing that alone reported 0 for a directory that contributed
        // relations.
        edges: report.imported.reduce((sum, r) => sum + (r.edges ?? 0), 0) + report.controlFileEdges,
        controlFileEdges: report.controlFileEdges,
        withheldSupersessions: report.withheldSupersessions,
      });
    } else {
      const report = importVorgaengeDirectory(store as never, source.path, { project, dryRun: options.dryRun, nowEpoch });
      failedTotal += report.failed.length;
      summary.push({
        path: source.path, kind: source.kind,
        imported: report.imported.length,
        skipped: report.skipped.length,
        failed: report.failed,
        edges: report.imported.reduce((sum, r) => sum + r.edges, 0),
        states: report.imported.reduce((acc: Record<string, number>, r) => {
          acc[r.state] = (acc[r.state] ?? 0) + 1;
          return acc;
        }, {}),
        eventLogMissing: report.eventLogMissing,
        malformedLogLines: report.malformed,
        unknownKinds: report.unknownKinds,
        selfEdges: report.selfEdges,
      });
    }
  }

  // Close the validity window of every record a later one supersedes. This
  // runs after ALL sources, because a record and the record it retires do not
  // have to sit in the same directory.
  let supersession: Awaited<ReturnType<typeof applySupersessionsSafely>> = null;
  if (!options.dryRun) {
    supersession = await applySupersessionsSafely(store, project, nowEpoch);
  }

  // Ask the worker to index what we just wrote. This process writes rows
  // directly and enqueues nothing — that is what keeps a curated record away
  // from a model — so nothing else tells the worker the rows exist, and their
  // embeddings would otherwise appear only at the next periodic pass. Measured
  // straight after an import: semantic search returned nothing for the new
  // rows and reported no error.
  const indexed = options.dryRun ? null : await requestBackfill(project);

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

  if (indexed?.indexed) {
    console.log('  Semantic index updated.\n');
  } else if (indexed) {
    // Never silent. Without this line an import looks complete while semantic
    // search is still blind to every row it just wrote.
    console.log(`  ⚠ Semantic index NOT updated: ${indexed.reason}`);
    console.log('    Keyword search works now; semantic search follows at the worker\'s next pass.\n');
  }

  if (failedTotal > 0) process.exitCode = 1;
}

/**
 * Apply supersessions, reporting rather than failing when the schema is older
 * than the feature. The import already succeeded at this point; refusing to
 * return would throw away a completed import over a bookkeeping step.
 */
async function applySupersessionsSafely(store: unknown, project: string, nowEpoch: number) {
  try {
    const { applySupersessions } = await import('../../services/curated/supersession.js');
    const db = (store as { db: Parameters<typeof applySupersessions>[0] }).db;
    return applySupersessions(db, project, nowEpoch);
  } catch (error) {
    console.error(`  ⚠ Supersession step failed: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Ask the running worker to index the project.
 *
 * A missing worker is a normal state for a CLI command, not a failure — the
 * import already succeeded. It is reported rather than swallowed, because the
 * difference between "indexed" and "indexed later" is the difference between
 * semantic search working and silently returning nothing.
 */
export async function requestBackfill(project: string): Promise<{ indexed: boolean; reason?: string }> {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { homedir } = await import('node:os');

  let port: string;
  try {
    port = readFileSync(join(homedir(), '.keepmind', 'worker.port'), 'utf8').trim();
  } catch {
    return { indexed: false, reason: 'no running worker (worker.port not found)' };
  }

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/chroma/backfill`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project }),
    });
    if (!response.ok) return { indexed: false, reason: `worker replied ${response.status}` };
    const body = await response.json() as { indexed?: boolean; reason?: string };
    return { indexed: body.indexed === true, reason: body.reason ?? 'worker declined' };
  } catch (error) {
    return { indexed: false, reason: `worker unreachable — ${error instanceof Error ? error.message : error}` };
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
  const { loadCuratedSources, missingSources } = await import('../../services/curated/sources.js');
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

  const project = options.project ?? getProjectName(process.cwd());
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
  if (report.statusRetiredWithoutSupersession.length > 0) {
    // A property of the corpus, not of the migration: the importer stores
    // `Stand:` verbatim and does not turn a status word into a closed window,
    // because closing one is a supersession and a supersession needs the record
    // that replaced it. `akten:check` is the command that examines this.
    console.log(`  ${report.statusRetiredWithoutSupersession.length} record(s) call themselves retired with nothing superseding them — \`keepmind akten:check\` examines those: ${report.statusRetiredWithoutSupersession.slice(0, 20).join(', ')}${report.statusRetiredWithoutSupersession.length > 20 ? ' …' : ''}`);
  }

  if (report.complete) {
    console.log('\n  ✔ Every record, every declared relation and every validity window arrived.');
    console.log('    The file archive is now redundant — it can be removed.');
    return;
  }
  console.log('\n  The corpus did NOT arrive complete. Do not remove the files.');
  process.exitCode = 1;
}
