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
