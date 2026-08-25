// SPDX-License-Identifier: Apache-2.0
//
// `keepmind export` — write the whole source of truth to a readable bundle.
//
// The export is a READ. It opens the database, selects, and writes files; it
// never modifies, never vacuums, never touches the worker. That matters
// because the most likely moment to run it is the moment before a machine
// change, which is the worst possible moment for a maintenance step to decide
// it should also rewrite something.

import { mkdirSync, writeFileSync, openSync, writeSync, closeSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Database } from '../../storage/db.js';
import {
  BUNDLE_SCHEMA_VERSION, BUNDLE_TABLES, EXCLUDED_TABLES, MANIFEST_FILE, SETTINGS_FILE,
  serializeRow, tableFile, type BundleManifest, type BundleFileEntry,
} from './bundle.js';
import { logger } from '../../utils/logger.js';

export interface ExportOptions {
  /** Directory to write into. Created if absent. */
  outDir: string;
  /** Restrict to these projects. Empty/undefined exports everything. */
  projects?: string[];
  /** Include ~/.keepmind/settings.json in the bundle. */
  includeSettings?: boolean;
  keepmindVersion: string;
  /** Absolute path of the settings file, for testability. */
  settingsPath?: string;
  /** The source machine's embedder identity, when it can be read cheaply. */
  sourceEmbedderIdentity?: string | null;
  createdAt?: string;
}

export interface ExportReport {
  outDir: string;
  manifest: BundleManifest;
  totalRows: number;
}

/**
 * Which rows of a table belong to a project filter.
 *
 * Not every table carries a `project` column, and the ones that do not are
 * reachable only through the ones that do. `user_prompts` hangs off a session;
 * `observation_feedback` hangs off an observation. Filtering those by joining
 * rather than by guessing is the difference between a bundle that restores and
 * one that restores with dangling references.
 */
function selectFor(table: string, projects: string[] | null): { sql: string; params: unknown[] } {
  if (!projects || projects.length === 0) {
    return { sql: `SELECT * FROM ${table} ORDER BY rowid`, params: [] };
  }
  const marks = projects.map(() => '?').join(',');
  switch (table) {
    case 'sdk_sessions':
    case 'observations':
    case 'session_summaries':
    case 'decision_edges':
      return { sql: `SELECT * FROM ${table} WHERE project IN (${marks}) ORDER BY rowid`, params: [...projects] };
    case 'user_prompts':
      return {
        sql: `SELECT * FROM user_prompts
               WHERE session_db_id IN (SELECT id FROM sdk_sessions WHERE project IN (${marks}))
               ORDER BY rowid`,
        params: [...projects],
      };
    case 'observation_feedback':
      return {
        sql: `SELECT * FROM observation_feedback
               WHERE observation_id IN (SELECT id FROM observations WHERE project IN (${marks}))
               ORDER BY rowid`,
        params: [...projects],
      };
    default:
      throw new Error(`export: no project filter defined for table "${table}"`);
  }
}

function tableExists(db: Database, table: string): boolean {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").all(table) as unknown[]).length > 0;
}

/**
 * Write one table as JSONL, hashing the bytes as they go out.
 *
 * SYNCHRONOUS on purpose. The first version used `createWriteStream`, which
 * flushes on its own schedule: `exportBundle` returned with a finished manifest
 * while the files it describes were still empty, and an import run immediately
 * afterwards failed with "manifest lists sdk_sessions.jsonl (3 rows) but the
 * file is missing". A function whose whole job is "this data is now on disk"
 * must not return before it is.
 *
 * Rows are written in blocks rather than one call per row: the driver already
 * materialises the result set, so the only thing streaming would still buy is
 * syscall count.
 */
const WRITE_BLOCK_ROWS = 500;

function writeTable(db: Database, table: string, projects: string[] | null, outDir: string): BundleFileEntry {
  const file = tableFile(table);
  const path = join(outDir, file);
  const hash = createHash('sha256');
  const handle = openSync(path, 'w');

  let rows = 0;
  try {
    if (tableExists(db, table)) {
      const { sql, params } = selectFor(table, projects);
      const all = db.prepare(sql).all(...(params as never[])) as Array<Record<string, unknown>>;
      let block: string[] = [];
      const flush = () => {
        if (block.length === 0) return;
        const text = block.join('');
        hash.update(text, 'utf8');
        writeSync(handle, text, null, 'utf8');
        block = [];
      };
      for (const row of all) {
        block.push(`${serializeRow(row)}\n`);
        rows++;
        if (block.length >= WRITE_BLOCK_ROWS) flush();
      }
      flush();
    }
  } finally {
    closeSync(handle);
  }

  return { file, rows, sha256: hash.digest('hex') };
}

export function exportBundle(db: Database, options: ExportOptions): ExportReport {
  const projects = options.projects && options.projects.length > 0 ? [...options.projects].sort() : null;
  mkdirSync(options.outDir, { recursive: true });

  const tables: Record<string, BundleFileEntry> = {};
  let totalRows = 0;
  for (const table of BUNDLE_TABLES) {
    const entry = writeTable(db, table, projects, options.outDir);
    tables[table] = entry;
    totalRows += entry.rows;
  }

  let settingsFile: string | null = null;
  if (options.includeSettings && options.settingsPath && existsSync(options.settingsPath)) {
    // Copied verbatim. Settings decide how the memory is READ — the injection
    // token budget, the origin filter, the curated source list — so a bundle
    // without them restores the data and not the behaviour.
    writeFileSync(join(options.outDir, SETTINGS_FILE), readFileSync(options.settingsPath, 'utf8'), 'utf8');
    settingsFile = SETTINGS_FILE;
  }

  const manifest: BundleManifest = {
    kind: 'keepmind-export',
    schemaVersion: BUNDLE_SCHEMA_VERSION,
    keepmindVersion: options.keepmindVersion,
    createdAt: options.createdAt ?? new Date().toISOString(),
    projects,
    tables,
    sourceEmbedderIdentity: options.sourceEmbedderIdentity ?? null,
    settingsFile,
    excluded: EXCLUDED_TABLES,
  };
  writeFileSync(join(options.outDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  logger.info('SYSTEM', 'keepmind export written', {
    outDir: options.outDir,
    projects: projects?.length ?? 'all',
    rows: totalRows,
  });

  return { outDir: options.outDir, manifest, totalRows };
}
