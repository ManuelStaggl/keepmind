// SPDX-License-Identifier: Apache-2.0
//
// `keepmind import` — restore a bundle onto a machine.
//
// THE RULE: verify everything, then write once. The import checks the manifest
// kind, the schema version, every file's row count and every file's hash
// BEFORE it opens a transaction. A restore that discovers a problem halfway
// through has already half-restored, and a half-restored memory is worse than
// none — it looks complete, and the part that is missing is invisible.
//
// PRIMARY KEYS ARE PRESERVED. Not cosmetic: `observation_feedback` points at
// observation ids, `user_prompts` at session ids, and the metadata of a
// superseded or revised row names the row that replaced it BY ID. Re-numbering
// on import would leave every one of those pointing at a different row, and
// nothing would report it — the supersession chain would simply start saying
// something else.
//
// A ROW WHOSE PARENT IS GONE IS STILL MEMORY. The restore runs with foreign
// key enforcement OFF and reports what dangles, rather than enforcing a
// constraint the source machine does not itself satisfy. Measured on the live
// store: 1830 observations and 408 session summaries name a session row that
// no longer exists — pre-3.x rows from one bounded window, spread over nine
// projects, readable and findable to this day, because SQLite never re-checks
// a foreign key after the fact. Enforcing it here rejected the WHOLE bundle
// with a bare "FOREIGN KEY constraint failed", so the real corpus could not be
// restored at all. Dropping those rows instead is worse still: it is the
// half-restored memory this file exists to prevent, and it breaks the one rule
// the whole store rests on — nothing is ever deleted to resolve a conflict.
// So they travel, they are counted, and the count is printed.
//
// Turning enforcement off is safe here BY CONSTRUCTION, not by hope: the
// restore only ever INSERTs, and the 'replace' path deletes children before
// parents explicitly rather than trusting a cascade (see below). The pragma is
// set before the transaction opens — inside one it is a silent no-op — and put
// back afterwards, whatever happened.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Database } from '../../storage/db.js';
import type { TableColumnInfo } from '../../types/database.js';
import { writeFileSync, copyFileSync } from 'node:fs';
import {
  BUNDLE_SCHEMA_VERSION, BUNDLE_TABLES, MANIFEST_FILE, type BundleManifest,
} from './bundle.js';
import { logger } from '../../utils/logger.js';

export type ImportMode = 'fresh' | 'merge' | 'replace';

export interface ImportOptions {
  bundleDir: string;
  /**
   * 'fresh'   — refuse if the target already holds rows for a project in the
   *             bundle. The default, and the only one that cannot lose data by
   *             accident.
   * 'merge'   — keep what is there, skip any row whose primary key already
   *             exists. Safe, and quietly incomplete when ids collide across
   *             two unrelated machines — which is why it is not the default.
   * 'replace' — delete the bundle's projects from the target first.
   */
  mode?: ImportMode;
  dryRun?: boolean;
}

export interface ImportReport {
  manifest: BundleManifest;
  mode: ImportMode;
  dryRun: boolean;
  /** Rows written per table. */
  inserted: Record<string, number>;
  /** Rows skipped because their primary key was already present (merge). */
  skipped: Record<string, number>;
  /** Rows deleted per table before the restore (replace). */
  deleted: Record<string, number>;
  /**
   * Columns present in the bundle but not in the target schema, per table.
   * Reported, never silently dropped: a field the target cannot store is a
   * field the restore did not restore.
   */
  droppedColumns: Record<string, string[]>;
  /**
   * Rows whose declared parent row is in neither the bundle nor the target,
   * per table. Restored as they stand — see the header. Counted here so a
   * restore can never be quietly less connected than the machine it came from.
   */
  dangling: Record<string, number>;
  projects: string[];
}

/**
 * The parent links the schema declares, child → parent.
 *
 * Written out rather than read from `PRAGMA foreign_key_list`, because the
 * point is to report what dangles even when the target's schema has moved on
 * and no longer declares the link at all.
 */
const PARENT_LINKS: ReadonlyArray<{
  table: string; column: string; parentTable: string; parentColumn: string;
}> = [
  { table: 'observations', column: 'memory_session_id', parentTable: 'sdk_sessions', parentColumn: 'memory_session_id' },
  { table: 'session_summaries', column: 'memory_session_id', parentTable: 'sdk_sessions', parentColumn: 'memory_session_id' },
  { table: 'user_prompts', column: 'session_db_id', parentTable: 'sdk_sessions', parentColumn: 'id' },
  { table: 'observation_feedback', column: 'observation_id', parentTable: 'observations', parentColumn: 'id' },
];

function readManifest(bundleDir: string): BundleManifest {
  const path = join(bundleDir, MANIFEST_FILE);
  if (!existsSync(path)) {
    throw new Error(`Not a keepmind bundle: no ${MANIFEST_FILE} in ${bundleDir}.`);
  }
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as BundleManifest;
  if (manifest.kind !== 'keepmind-export') {
    throw new Error(`Not a keepmind bundle: manifest kind is "${manifest.kind}".`);
  }
  if (typeof manifest.schemaVersion !== 'number' || manifest.schemaVersion > BUNDLE_SCHEMA_VERSION) {
    throw new Error(
      `Bundle schema version ${manifest.schemaVersion} is newer than this keepmind understands (${BUNDLE_SCHEMA_VERSION}). ` +
      `Refusing to restore part of it — upgrade keepmind first.`,
    );
  }
  return manifest;
}

/** Read and verify one table file. Throws on any mismatch — never repairs. */
function readTable(bundleDir: string, manifest: BundleManifest, table: string): Array<Record<string, unknown>> {
  const entry = manifest.tables[table];
  if (!entry) return [];
  const path = join(bundleDir, entry.file);
  if (!existsSync(path)) {
    throw new Error(`Bundle is incomplete: manifest lists ${entry.file} (${entry.rows} rows) but the file is missing.`);
  }
  const text = readFileSync(path, 'utf8');
  const actualHash = createHash('sha256').update(text, 'utf8').digest('hex');
  if (actualHash !== entry.sha256) {
    throw new Error(
      `${entry.file} does not match its manifest hash. The bundle was modified or truncated after export; ` +
      `restoring it would restore something other than what was exported.`,
    );
  }
  const rows = text.split('\n').filter(line => line.trim().length > 0).map((line, i) => {
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`${entry.file} line ${i + 1} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    }
  });
  if (rows.length !== entry.rows) {
    throw new Error(`${entry.file} holds ${rows.length} rows, the manifest says ${entry.rows}.`);
  }
  return rows;
}

function columnsOf(db: Database, table: string): Set<string> {
  return new Set((db.query(`PRAGMA table_info(${table})`).all() as TableColumnInfo[]).map(c => c.name));
}

function tableExists(db: Database, table: string): boolean {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table) as unknown[]).length > 0;
}

/** Projects named anywhere in the bundle — what a 'replace' would clear. */
function projectsInBundle(manifest: BundleManifest, rowsByTable: Record<string, Array<Record<string, unknown>>>): string[] {
  if (manifest.projects && manifest.projects.length > 0) return [...manifest.projects];
  const found = new Set<string>();
  for (const table of ['sdk_sessions', 'observations', 'session_summaries', 'decision_edges']) {
    for (const row of rowsByTable[table] ?? []) {
      if (typeof row.project === 'string') found.add(row.project);
    }
  }
  return [...found].sort();
}

/**
 * Count the rows whose parent is in neither the bundle nor the target.
 *
 * The target is consulted too, and not as a nicety: under 'merge' the parent
 * may well already be there, and reporting it as dangling would send an
 * operator looking for damage that does not exist.
 */
function findDangling(
  db: Database,
  rowsByTable: Record<string, Array<Record<string, unknown>>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const link of PARENT_LINKS) {
    const rows = rowsByTable[link.table] ?? [];
    if (rows.length === 0) continue;

    const inBundle = new Set(
      (rowsByTable[link.parentTable] ?? [])
        .map(r => r[link.parentColumn])
        .filter(v => v !== null && v !== undefined)
        .map(v => String(v)),
    );

    // A NULL child key points at nothing by design (`user_prompts
    // .session_db_id` is nullable) — that is not a dangling reference.
    const missing = new Set<string>();
    let danglingRows = 0;
    const perKey = new Map<string, number>();
    for (const row of rows) {
      const value = row[link.column];
      if (value === null || value === undefined) continue;
      const key = String(value);
      if (inBundle.has(key)) continue;
      missing.add(key);
      perKey.set(key, (perKey.get(key) ?? 0) + 1);
    }
    if (missing.size === 0) continue;

    if (tableExists(db, link.parentTable)) {
      const keys = [...missing];
      for (let i = 0; i < keys.length; i += 500) {
        const chunk = keys.slice(i, i + 500);
        const marks = chunk.map(() => '?').join(',');
        const found = db.prepare(
          `SELECT "${link.parentColumn}" AS k FROM ${link.parentTable} WHERE "${link.parentColumn}" IN (${marks})`,
        ).all(...chunk) as Array<{ k: unknown }>;
        for (const row of found) missing.delete(String(row.k));
      }
    }

    for (const key of missing) danglingRows += perKey.get(key) ?? 0;
    if (danglingRows > 0) out[link.table] = danglingRows;
  }
  return out;
}

export function importBundle(db: Database, options: ImportOptions): ImportReport {
  const mode = options.mode ?? 'fresh';
  const manifest = readManifest(options.bundleDir);

  // Read and verify EVERY file before touching the database. See the header.
  const rowsByTable: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of BUNDLE_TABLES) {
    rowsByTable[table] = readTable(options.bundleDir, manifest, table);
  }

  const projects = projectsInBundle(manifest, rowsByTable);

  const report: ImportReport = {
    manifest, mode, dryRun: options.dryRun === true,
    inserted: {}, skipped: {}, deleted: {}, droppedColumns: {},
    dangling: findDangling(db, rowsByTable), projects,
  };

  if (mode === 'fresh' && projects.length > 0) {
    const marks = projects.map(() => '?').join(',');
    const present = (db.prepare(
      `SELECT COUNT(*) AS c FROM observations WHERE project IN (${marks})`,
    ).get(...projects) as { c: number }).c;
    if (present > 0) {
      throw new Error(
        `The target database already holds ${present} observation(s) for the bundle's project(s): ${projects.join(', ')}.\n` +
        `Refusing to restore over them. Pass --merge to keep both, or --replace to clear those projects first.`,
      );
    }
  }

  // Statements are built per table from the intersection of bundle columns and
  // target columns, so a bundle from an older or newer schema restores what
  // both sides understand and REPORTS the rest.
  interface TablePlan { table: string; rows: Array<Record<string, unknown>>; usable: string[] }
  const plans: TablePlan[] = [];
  for (const table of BUNDLE_TABLES) {
    const rows = rowsByTable[table];
    if (!tableExists(db, table)) {
      if (rows.length > 0) {
        throw new Error(`The target database has no "${table}" table, and the bundle holds ${rows.length} row(s) for it.`);
      }
      continue;
    }
    if (rows.length === 0) continue;
    const targetColumns = columnsOf(db, table);
    const bundleColumns = [...new Set(rows.flatMap(r => Object.keys(r)))].sort();
    const usable = bundleColumns.filter(c => targetColumns.has(c));
    const dropped = bundleColumns.filter(c => !targetColumns.has(c));
    if (dropped.length > 0) report.droppedColumns[table] = dropped;
    plans.push({ table, rows, usable });
  }

  if (options.dryRun) {
    for (const plan of plans) report.inserted[plan.table] = plan.rows.length;
    return report;
  }

  const run = db.transaction(() => {
    if (mode === 'replace' && projects.length > 0) {
      const marks = projects.map(() => '?').join(',');
      // Order mirrors the restore order in reverse: children first, so a
      // foreign key never has to be trusted to cascade.
      for (const [table, sql] of [
        ['observation_feedback', `DELETE FROM observation_feedback WHERE observation_id IN (SELECT id FROM observations WHERE project IN (${marks}))`],
        ['user_prompts', `DELETE FROM user_prompts WHERE session_db_id IN (SELECT id FROM sdk_sessions WHERE project IN (${marks}))`],
        ['decision_edges', `DELETE FROM decision_edges WHERE project IN (${marks})`],
        ['session_summaries', `DELETE FROM session_summaries WHERE project IN (${marks})`],
        ['observations', `DELETE FROM observations WHERE project IN (${marks})`],
        ['sdk_sessions', `DELETE FROM sdk_sessions WHERE project IN (${marks})`],
      ] as const) {
        if (!tableExists(db, table)) continue;
        const res = db.prepare(sql).run(...projects) as { changes?: number };
        report.deleted[table] = Number(res?.changes ?? 0);
      }
    }

    for (const plan of plans) {
      const columns = plan.usable;
      const marks = columns.map(() => '?').join(',');
      // OR IGNORE, not OR REPLACE: a colliding row is REPORTED as skipped
      // rather than overwritten. Overwriting would make 'merge' silently
      // destructive, which is the one thing it must not be.
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO ${plan.table} (${columns.map(c => `"${c}"`).join(',')}) VALUES (${marks})`,
      );
      let inserted = 0;
      let skipped = 0;
      for (let i = 0; i < plan.rows.length; i++) {
        const row = plan.rows[i];
        let res: { changes?: number };
        try {
          res = stmt.run(...columns.map(c => (row[c] === undefined ? null : row[c] as never))) as { changes?: number };
        } catch (error) {
          // SQLite's own message names neither the table nor the row, and the
          // whole restore surfaces as one line to an operator who then has
          // nothing to look at. Measured: "FOREIGN KEY constraint failed" was
          // the entire report on a 19,032-row bundle.
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Restoring ${plan.table} failed at row ${i + 1} of ${plan.rows.length} ` +
            `(id ${row.id ?? '(none)'}): ${message}. Nothing was written.`,
          );
        }
        if (Number(res?.changes ?? 0) > 0) inserted++;
        else skipped++;
      }
      report.inserted[plan.table] = inserted;
      report.skipped[plan.table] = skipped;
    }
  });

  // Set OUTSIDE the transaction: `PRAGMA foreign_keys` is a no-op while one is
  // open, so doing this inside `run()` would look right and enforce anyway.
  const foreignKeysWere = (db.prepare('PRAGMA foreign_keys').get() as { foreign_keys?: number } | undefined)?.foreign_keys ?? 1;
  db.run('PRAGMA foreign_keys = OFF');
  try {
    run();
  } finally {
    if (foreignKeysWere) db.run('PRAGMA foreign_keys = ON');
  }

  logger.info('SYSTEM', 'keepmind import finished', {
    bundleDir: options.bundleDir,
    mode,
    projects: projects.length,
    inserted: report.inserted,
    skipped: report.skipped,
    dangling: report.dangling,
  });

  return report;
}

export interface SettingsRestoreResult {
  /** The bundle carries a settings file at all. */
  present: boolean;
  applied: boolean;
  /** Where the previous settings file was kept, when one was replaced. */
  backupPath?: string;
  targetPath?: string;
  reason?: string;
}

/**
 * Put the bundled settings file in place — only when asked.
 *
 * The bundle has always CARRIED settings (the export says so out loud:
 * "settings.json included") and the import never read them. A file that
 * travels and is silently dropped is the quiet failure this whole module
 * exists to rule out, and the operator's reasonable belief — "my settings came
 * across" — was wrong with nothing to indicate it.
 *
 * It stays OPT-IN, and here is why it is not simply applied: settings describe
 * a MACHINE, not a memory. `curatedSources` names directories that may not
 * exist on the target, `KEEPMIND_DATA_DIR` may point somewhere else entirely,
 * and the target's own working configuration is not the restore's to discard.
 * (Pointing at absent source directories is survivable — `CuratedPresence`
 * reads that as `detached` and stays quiet — but survivable is not a reason to
 * do it uninvited.)
 *
 * When it IS applied, the previous file is kept beside it rather than
 * overwritten. Nothing in keepmind is deleted to make room for something newer.
 */
export function restoreBundledSettings(
  bundleDir: string,
  manifest: BundleManifest,
  targetPath: string,
  apply: boolean,
): SettingsRestoreResult {
  if (!manifest.settingsFile) return { present: false, applied: false };
  const source = join(bundleDir, manifest.settingsFile);
  if (!existsSync(source)) {
    return { present: true, applied: false, reason: `the manifest lists ${manifest.settingsFile} but the file is missing` };
  }
  if (!apply) return { present: true, applied: false, targetPath };

  const text = readFileSync(source, 'utf8');
  try {
    JSON.parse(text);
  } catch (error) {
    return { present: true, applied: false, reason: `${manifest.settingsFile} is not valid JSON: ${error instanceof Error ? error.message : error}` };
  }

  let backupPath: string | undefined;
  if (existsSync(targetPath)) {
    backupPath = `${targetPath}.bak-before-import`;
    copyFileSync(targetPath, backupPath);
  }
  writeFileSync(targetPath, text, 'utf8');
  return { present: true, applied: true, backupPath, targetPath };
}
