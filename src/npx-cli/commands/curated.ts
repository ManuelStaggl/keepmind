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
  // runs after ALL sources, because an edge routinely lives in a different
  // directory than the record it retires — a control file declaring two
  // records obsolete is the measured case.
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
async function requestBackfill(project: string): Promise<{ indexed: boolean; reason?: string }> {
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
