// SPDX-License-Identifier: Apache-2.0
//
// `keepmind export` / `keepmind import` — carry the whole memory to another
// machine.
//
// This is a precondition, not a feature. keepmind can only be the single place
// lasting knowledge lives if that knowledge can leave the machine it was
// written on. The bundle format and the reasoning behind what it does and does
// not contain are in src/services/portability/bundle.ts.

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { ImportMode } from '../../services/portability/import.js';

export interface ExportCommandOptions {
  outDir?: string;
  projects: string[];
  includeSettings: boolean;
  json: boolean;
}

export interface ImportCommandOptions {
  bundleDir?: string;
  mode: ImportMode;
  dryRun: boolean;
  json: boolean;
  /** Skip the vector rebuild. Only for tests and for a deliberate deferral. */
  noIndex: boolean;
  /**
   * Put the bundled settings.json in place. Opt-in: settings describe a
   * machine, not a memory — see `restoreBundledSettings`.
   */
  settings: boolean;
}

function readValue(args: string[], i: number, arg: string): [string, number] {
  const eq = arg.indexOf('=');
  if (eq > 0) return [arg.slice(eq + 1), i];
  return [args[i + 1], i + 1];
}

export function parseExportOptions(args: string[]): ExportCommandOptions {
  const options: ExportCommandOptions = { projects: [], includeSettings: true, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const name = arg.startsWith('--') ? arg.split('=')[0] : arg;
    if (name === '--json') { options.json = true; continue; }
    if (name === '--no-settings') { options.includeSettings = false; continue; }
    if (name === '--out') { const [v, j] = readValue(args, i, arg); options.outDir = v; i = j; continue; }
    if (name === '--project') { const [v, j] = readValue(args, i, arg); options.projects.push(v); i = j; continue; }
    if (arg.startsWith('--')) continue;
    if (!options.outDir) options.outDir = arg;
  }
  return options;
}

export function parseImportOptions(args: string[]): ImportCommandOptions {
  const options: ImportCommandOptions = { mode: 'fresh', dryRun: false, json: false, noIndex: false, settings: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const name = arg.startsWith('--') ? arg.split('=')[0] : arg;
    if (name === '--json') { options.json = true; continue; }
    if (name === '--dry-run') { options.dryRun = true; continue; }
    if (name === '--merge') { options.mode = 'merge'; continue; }
    if (name === '--replace') { options.mode = 'replace'; continue; }
    if (name === '--no-index') { options.noIndex = true; continue; }
    if (name === '--settings') { options.settings = true; continue; }
    if (arg.startsWith('--')) continue;
    if (!options.bundleDir) options.bundleDir = arg;
  }
  return options;
}

export function exportUsage(): string {
  return [
    'Usage: keepmind export <directory> [--project <name>]… [--no-settings] [--json]',
    '',
    'Writes every source-of-truth row to one readable, versioned bundle:',
    'JSONL per table plus a manifest with a row count and a SHA-256 per file.',
    'Curated records, their declared relations, checkpoints, observations,',
    'session summaries, prompts and feedback all travel; vectors do NOT — they',
    'are derived from the text and are rebuilt on import by whatever embedder',
    'the target machine has.',
    '',
    'Options:',
    '  --project <name>   Export only this project (repeatable). Default: everything',
    '  --no-settings      Leave ~/.keepmind/settings.json out of the bundle',
    '  --json             Machine-readable output',
    '',
    'Read-only: nothing in the database is modified.',
  ].join('\n');
}

export function importUsage(): string {
  return [
    'Usage: keepmind import <directory> [--merge|--replace] [--dry-run] [--json]',
    '',
    'Restores a bundle written by `keepmind export`. Every file is verified',
    'against the manifest — row count and hash — BEFORE anything is written, and',
    'the whole restore runs in one transaction. Primary keys are preserved, so',
    'supersession links, feedback and prompt history keep pointing where they did.',
    '',
    'Modes:',
    '  (default)   Refuse if the target already holds rows for a bundled project',
    '  --merge     Keep what is there; skip rows whose primary key already exists',
    '  --replace   Delete the bundled projects from the target, then restore',
    '',
    'Options:',
    '  --dry-run   Verify the bundle and report what would be written',
    '  --no-index  Skip the semantic-index rebuild (keyword search still works)',
    '  --settings  Also put the bundle\'s settings.json in place, keeping the',
    '              current one beside it as settings.json.bak-before-import.',
    '              Off by default: settings describe a machine (source paths,',
    '              data directory), not a memory.',
    '  --json      Machine-readable output',
    '',
    'After a restore the semantic index is rebuilt from the restored text.',
  ].join('\n');
}

export async function runExportCommand(options: ExportCommandOptions): Promise<void> {
  if (!options.outDir) {
    console.log(exportUsage());
    process.exitCode = 1;
    return;
  }

  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  const { exportBundle } = await import('../../services/portability/export.js');
  const { readPluginVersion } = await import('../utils/paths.js');
  const { USER_SETTINGS_PATH } = await import('../../shared/paths.js');

  const store = new SessionStore();
  const outDir = resolve(options.outDir);

  const report = exportBundle(store.db, {
    outDir,
    projects: options.projects,
    includeSettings: options.includeSettings,
    settingsPath: USER_SETTINGS_PATH,
    keepmindVersion: readPluginVersion(),
    sourceEmbedderIdentity: await readEmbedderIdentity(),
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Exported to ${outDir}\n`);
  for (const [table, entry] of Object.entries(report.manifest.tables)) {
    console.log(`  ${entry.rows.toString().padStart(7)}  ${table}`);
  }
  console.log(`\n  ${report.totalRows} row(s) total.`);
  if (report.manifest.settingsFile) console.log('  settings.json included.');
  // Said out loud rather than left to the manifest: an operator who believes
  // the vectors travelled will not run the rebuild, and semantic search on the
  // new machine will return nothing while reporting no error.
  console.log('  Vectors are NOT in the bundle — `keepmind import` rebuilds them.');
}

/**
 * The embedder that filled the source machine's vector store.
 *
 * Best-effort: the vector store may be disabled, unloadable, or simply absent,
 * and none of that should stop an export. It is recorded so a puzzled operator
 * can see that the two machines embed differently — never used to decide
 * anything.
 */
async function readEmbedderIdentity(): Promise<string | null> {
  try {
    const { SqliteVecManager } = await import('../../services/vector/SqliteVecManager.js');
    const vec = SqliteVecManager.instance();
    // Deliberately does NOT force a load: an export must not be the thing that
    // pulls the native modules in, and a store that is not open has nothing to
    // report anyway.
    if (!vec.isLoaded()) return null;
    return vec.readIndexIdentity();
  } catch {
    return null;
  }
}

export async function runImportCommand(options: ImportCommandOptions): Promise<void> {
  if (!options.bundleDir) {
    console.log(importUsage());
    process.exitCode = 1;
    return;
  }
  const bundleDir = resolve(options.bundleDir);
  if (!existsSync(bundleDir)) {
    console.error(`No such directory: ${bundleDir}`);
    process.exitCode = 1;
    return;
  }

  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  const { importBundle } = await import('../../services/portability/import.js');

  const store = new SessionStore();

  let report: Awaited<ReturnType<typeof importBundle>>;
  try {
    report = importBundle(store.db, { bundleDir, mode: options.mode, dryRun: options.dryRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(message);
    process.exitCode = 1;
    return;
  }

  const { restoreBundledSettings } = await import('../../services/portability/import.js');
  const { USER_SETTINGS_PATH } = await import('../../shared/paths.js');
  const settings = restoreBundledSettings(bundleDir, report.manifest, USER_SETTINGS_PATH, options.settings && !options.dryRun);

  let indexed: Array<{ project: string; indexed: boolean; reason?: string }> = [];
  if (!options.dryRun && !options.noIndex) {
    indexed = await rebuildIndex(report.projects);
  }

  if (options.json) {
    console.log(JSON.stringify({ ok: true, ...report, settings, indexed }, null, 2));
    return;
  }

  const verb = report.dryRun ? 'Would restore' : 'Restored';
  console.log(`${verb} bundle from ${bundleDir} (schema ${report.manifest.schemaVersion}, written by keepmind ${report.manifest.keepmindVersion}).\n`);
  for (const table of Object.keys(report.manifest.tables)) {
    const inserted = report.inserted[table] ?? 0;
    const skipped = report.skipped[table] ?? 0;
    const deleted = report.deleted[table] ?? 0;
    const extras = [
      skipped > 0 ? `${skipped} already present` : null,
      deleted > 0 ? `${deleted} cleared first` : null,
    ].filter(Boolean).join(', ');
    console.log(`  ${inserted.toString().padStart(7)}  ${table}${extras ? `   (${extras})` : ''}`);
  }
  console.log(`\n  Projects: ${report.projects.join(', ') || '(none)'}`);

  // Never summarised away: a column the target could not store is a field this
  // restore did not restore, and it is invisible in every count above.
  // Same reasoning as the dropped columns below: invisible in every count
  // above, and an operator who is not told will read the restore as a clean
  // one. These rows ARE restored — the source machine holds them the same way.
  const dangling = Object.entries(report.dangling);
  if (dangling.length > 0) {
    const total = dangling.reduce((sum, [, n]) => sum + n, 0);
    console.log(`\n  ${total} row(s) name a parent row that is in neither the bundle nor this database:`);
    for (const [table, count] of dangling) console.log(`      ${table}: ${count}`);
    console.log('      Restored as they stand — they are readable and searchable, as on the source machine.');
  }

  const dropped = Object.entries(report.droppedColumns);
  if (dropped.length > 0) {
    console.log('\n  ⚠ Columns in the bundle that this database has no place for:');
    for (const [table, columns] of dropped) console.log(`      ${table}: ${columns.join(', ')}`);
    console.log('      Everything else was restored. Upgrade keepmind and re-import to keep them.');
  }

  // The export says "settings.json included" out loud, so the import has to
  // account for them either way. Silence here is what made an operator believe
  // their settings had crossed over when nothing had read the file at all.
  if (settings.present) {
    if (settings.applied) {
      console.log(`\n  Settings restored to ${settings.targetPath}.`);
      if (settings.backupPath) console.log(`      Previous settings kept at ${settings.backupPath}.`);
    } else if (settings.reason) {
      console.log(`\n  ⚠ Bundled settings NOT applied: ${settings.reason}`);
    } else {
      console.log('\n  The bundle carries a settings.json; it was NOT applied.');
      console.log('      Re-run with --settings to put it in place (the current one is kept beside it).');
    }
  }

  if (report.dryRun) {
    console.log('\nNothing was written.');
    return;
  }

  if (options.noIndex) {
    console.log('\n  Semantic index NOT rebuilt (--no-index). Keyword search works now.');
    return;
  }
  for (const entry of indexed) {
    if (entry.indexed) console.log(`  Semantic index rebuilt for ${entry.project}.`);
    else console.log(`  ⚠ Semantic index NOT rebuilt for ${entry.project}: ${entry.reason}`);
  }
  if (indexed.some(e => !e.indexed)) {
    console.log('    Start the worker and re-run `keepmind import <dir> --merge` — or wait for its next periodic pass.');
  }
}

/**
 * Re-embed the restored text.
 *
 * The watermarks are cleared FIRST. Backfill is watermark-driven: it indexes
 * rows above the highest id it has already seen for a project. Restoring rows
 * whose ids sit BELOW an existing watermark — which is exactly what happens
 * when a bundle is merged into a machine that already had that project — would
 * otherwise leave every restored row unembedded, with semantic search silently
 * blind to them and nothing in the log.
 */
async function rebuildIndex(projects: string[]): Promise<Array<{ project: string; indexed: boolean; reason?: string }>> {
  const out: Array<{ project: string; indexed: boolean; reason?: string }> = [];
  try {
    const { ChromaSyncState } = await import('../../services/sync/ChromaSyncState.js');
    for (const project of projects) {
      ChromaSyncState.replace(project, { observations: 0, summaries: 0, prompts: 0 });
    }
  } catch (error) {
    // Reported through the per-project result below rather than thrown: the
    // rows are restored either way, and a failed re-index is recoverable.
    for (const project of projects) {
      out.push({ project, indexed: false, reason: `could not reset backfill watermarks — ${error instanceof Error ? error.message : error}` });
    }
    return out;
  }

  const { ensureCuratedIndexed } = await import('./curated.js');
  for (const project of projects) {
    const outcome = await ensureCuratedIndexed(project);
    out.push({ project, indexed: outcome.indexed, reason: outcome.reason });
  }
  return out;
}
