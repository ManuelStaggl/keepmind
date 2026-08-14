// SPDX-License-Identifier: Apache-2.0
//
// `keepmind akten:import` — read curated decision records into memory.
//
// This command is the ONLY user-facing entry to the curated path. It talks to
// SessionStore directly rather than posting to the worker, for the same reason
// the importer takes a two-method store: every hop that could enqueue work is
// a hop that could reach a model, and the guarantee this feature sells is that
// none of them do.

import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

export interface AktenImportOptions {
  /** Directories to read. More than one is normal — see the note below. */
  directories: string[];
  /** Project the records are filed under. */
  project?: string;
  /** Report what would happen without writing. */
  dryRun: boolean;
  /** Machine-readable output. */
  json: boolean;
}

export function parseAktenImportOptions(args: string[]): AktenImportOptions {
  const directories: string[] = [];
  let project: string | undefined;
  let dryRun = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--json') { json = true; continue; }
    if (arg === '--project') { project = args[++i]; continue; }
    if (arg.startsWith('--project=')) { project = arg.slice('--project='.length); continue; }
    if (arg.startsWith('--')) continue;
    directories.push(arg);
  }

  return { directories, project, dryRun, json };
}

function usage(): string {
  return [
    'Usage: keepmind akten:import <directory> [<directory>…] [options]',
    '',
    'Reads curated decision records and stores them verbatim. No model is',
    'involved at any point: records are written straight to storage and never',
    'enter the observation queue.',
    '',
    'Options:',
    '  --project <name>   File the records under this project',
    '  --dry-run          Report what would be imported, write nothing',
    '  --json             Machine-readable output',
    '',
    'Pass every directory that contains relation notes, not just the folder',
    'holding the records. Notes about a record routinely live outside it — a',
    'control file that declares two records obsolete is an edge nothing inside',
    'the records folder knows about, and an importer pointed at one directory',
    'builds a graph that provably misses it.',
  ].join('\n');
}

/**
 * `keepmind akten:check` — report structural contradictions, exit non-zero.
 *
 * A command rather than a hook on save, because keepmind has no hook there: it
 * sees tool use inside a session, not the moment an editor writes a file or a
 * commit is made. A system that claims to report "on save" but only manages it
 * sometimes is worse than one that honestly reports on demand — you would
 * start trusting its silence.
 *
 * As a pre-commit step it runs demonstrably on every commit, its silence means
 * something, and it can stop the commit. A message in a chat session can do
 * none of those.
 */
export async function runAktenCheckCommand(options: AktenImportOptions): Promise<void> {
  if (options.directories.length === 0) {
    console.log('Usage: keepmind akten:check <directory> [<directory>…] [--json]');
    process.exitCode = 1;
    return;
  }

  const { parseAkte } = await import('../../services/curated/akten-parser.js');
  const { extractEdges, extractEdgesFromControlFile } = await import('../../services/curated/edge-reader.js');
  const { checkContradictions, currentRecords } = await import('../../services/curated/contradiction-check.js');
  const { readdirSync, readFileSync, statSync: stat } = await import('node:fs');
  const { join } = await import('node:path');

  const edges: Parameters<typeof checkContradictions>[0] = [];
  const records: Parameters<typeof checkContradictions>[1] = [];

  for (const directory of options.directories) {
    const absolute = resolve(directory);
    if (!existsSync(absolute) || !stat(absolute).isDirectory()) {
      console.error(`Not a directory: ${absolute}`);
      process.exitCode = 1;
      return;
    }
    for (const entry of readdirSync(absolute).sort()) {
      if (!entry.toLowerCase().endsWith('.md')) continue;
      const file = join(absolute, entry);
      if (stat(file).isDirectory()) continue;
      const content = readFileSync(file, 'utf8');
      const parsed = parseAkte(content);
      if (parsed.id) {
        records.push({ id: parsed.id, status: parsed.status, sourcePath: file, sourceLine: parsed.headingLine });
        edges.push(...extractEdges(parsed, file).edges);
      } else {
        // Not a record, still a source of relations.
        edges.push(...extractEdgesFromControlFile(content, file).edges);
      }
    }
  }

  const findings = checkContradictions(edges, records);
  const current = currentRecords(edges, records);

  if (options.json) {
    console.log(JSON.stringify({ records: records.length, edges: edges.length, current: current.length, findings }, null, 2));
    if (findings.length > 0) process.exitCode = 1;
    return;
  }

  console.log(`${records.length} record(s), ${edges.length} declared relation(s), ${current.length} still in force.`);

  if (findings.length === 0) {
    // Saying this out loud matters: the value of this check is its silence,
    // and silence you cannot distinguish from "did not run" is worth nothing.
    console.log('No structural contradictions found.');
    return;
  }

  console.log(`\n${findings.length} contradiction(s):`);
  for (const finding of findings) {
    console.log(`\n  [${finding.kind} · ${finding.certainty}] ${finding.summary}`);
    for (const citation of finding.citations) {
      console.log(`      ${citation.path}:${citation.line}`);
      console.log(`        ${citation.text}`);
    }
  }
  console.log('\nStructural findings only. Whether two records that both apply say');
  console.log('incompatible things is a question about the subject matter, and this');
  console.log('command deliberately does not answer it.');
  process.exitCode = 1;
}

export async function runAktenImportCommand(options: AktenImportOptions): Promise<void> {
  if (options.directories.length === 0) {
    console.log(usage());
    process.exitCode = 1;
    return;
  }

  const resolved: string[] = [];
  for (const directory of options.directories) {
    const absolute = resolve(directory);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      console.error(`Not a directory: ${absolute}`);
      process.exitCode = 1;
      return;
    }
    resolved.push(absolute);
  }

  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  const { importAktenDirectory } = await import('../../services/curated/akten-importer.js');
  const { getProjectName } = await import('../../utils/project-name.js');

  const project = options.project ?? getProjectName(process.cwd());
  const store = new SessionStore();

  const imported: Array<{ recordId: string; title: string; sourcePath: string; sourceLine: number }> = [];
  const skipped: Array<{ file: string; reason: string }> = [];
  const failed: Array<{ file: string; error: string }> = [];

  for (const directory of resolved) {
    const report = importAktenDirectory(store as never, directory, {
      project,
      dryRun: options.dryRun,
    });
    imported.push(...report.imported.map(r => ({
      recordId: r.recordId,
      title: r.title,
      sourcePath: r.sourcePath,
      sourceLine: r.sourceLine,
    })));
    skipped.push(...report.skipped);
    failed.push(...report.failed);
  }

  if (options.json) {
    console.log(JSON.stringify({
      project,
      dryRun: options.dryRun,
      directories: resolved,
      imported,
      skipped,
      failed,
    }, null, 2));
    if (failed.length > 0) process.exitCode = 1;
    return;
  }

  const verb = options.dryRun ? 'Would import' : 'Imported';
  console.log(`${verb} ${imported.length} record(s) into project "${project}".`);

  // Skips are printed, not summarised away. A file that silently did not
  // arrive looks exactly like a file that had nothing to say.
  if (skipped.length > 0) {
    console.log(`\nSkipped ${skipped.length}:`);
    for (const entry of skipped) console.log(`  ${entry.file} — ${entry.reason}`);
  }

  if (failed.length > 0) {
    console.log(`\nFailed ${failed.length}:`);
    for (const entry of failed) console.log(`  ${entry.file} — ${entry.error}`);
    process.exitCode = 1;
  }
}
