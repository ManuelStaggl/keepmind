// SPDX-License-Identifier: Apache-2.0
//
// In-process vector store: sqlite-vec (vec0) loaded into a dedicated node:sqlite
// connection via the db.ts shim's loadExtension(). Replaces the chroma-mcp
// subprocess. Process singleton — one connection, one embedder funnel.
//
// Proven on win32-x64 (Node 24): sqlite-vec 0.1.9 (vec0.dll from
// sqlite-vec-windows-x64) loads via getLoadablePath(); CREATE VIRTUAL TABLE …
// USING vec0(embedding float[384]) + metadata columns; KNN
// `embedding match ? AND k = ? ORDER BY distance` returns correct
// nearest-neighbour order. Gate findings encoded here:
//   • node:sqlite binds JS numbers as FLOAT, and vec0 INTEGER metadata columns
//     are strict — integer columns MUST be bound as BigInt.
//   • vec0 forbids `k = ?` and `LIMIT` together — use `k = ?` only.

import { createRequire } from 'node:module';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { Database } from '../../storage/db.js';
import { VECTOR_DB_DIR } from '../../shared/paths.js';
import { EmbedderService, EMBED_DIM } from './EmbedderService.js';
import { logger } from '../../utils/logger.js';

/** A single embeddable chunk (one vec0 row). Mirrors a Chroma document. */
export interface VecChunk {
  chunk_key: string;          // stable id, e.g. obs_${id}_narrative
  document: string;           // text to embed
  sqlite_id: number;
  doc_type: string;           // 'observation' | 'session_summary' | 'user_prompt'
  field_type?: string | null;
  project: string;
  merged_into_project?: string | null;
  platform_source?: string | null;
  obs_type?: string | null;   // observation.type, for type filters
  created_at_epoch: number;
  /** Full metadata bag returned to the search layer (doc_type, created_at_epoch, …). */
  metadata: Record<string, string | number | null>;
}

/** Flat, translated filter consumed by queryKnn (see VectorSync.translate). */
export interface VecFilter {
  doc_type?: string;
  obs_type?: string;
  platform_source?: string;
  project?: string;           // matched against project OR merged_into_project
}

interface VecRow {
  sqlite_id: number;
  doc_type: string;
  project: string;
  merged_into_project: string;
  platform_source: string;
  obs_type: string;
  created_at_epoch: number;
  chunk_key: string;
  metadata_json: string;
  distance: number;
}

const NONE = ''; // text sentinel for "absent" (avoids relying on vec0 NULL metadata)

function bigIntOf(n: number | null | undefined): bigint {
  return BigInt(Math.trunc(Number(n ?? 0)));
}

function vecBlob(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

/**
 * Lazily resolve the `sqlite-vec` native module. It ships a per-platform .dll and
 * therefore CANNOT be inlined into the worker bundle — it must resolve from
 * node_modules at runtime. On installs where the plugin's native deps were never
 * installed (e.g. Bun is absent and its auto-install failed behind a corporate
 * proxy), the module is missing. A top-level `import` here previously crashed the
 * ENTIRE worker on boot with `Cannot find module 'sqlite-vec'` before any handler
 * ran, so the daemon never bound its port. Deferring the require to load() lets
 * the worker boot; a missing native dep degrades vector search to unavailable
 * (FTS/keyword search still works) instead of taking the whole daemon down.
 */
const requireNative = createRequire(import.meta.url);
type SqliteVecModule = { getLoadablePath: () => string };
let sqliteVecModule: SqliteVecModule | null = null;
function loadSqliteVecModule(): SqliteVecModule {
  return (sqliteVecModule ??= requireNative('sqlite-vec') as SqliteVecModule);
}

export class SqliteVecManager {
  private static _instance: SqliteVecManager | null = null;
  static instance(): SqliteVecManager {
    return (this._instance ??= new SqliteVecManager());
  }

  private db: Database | null = null;
  private vecVersion: string | null = null;

  /** Idempotent: open the dedicated vec DB, load sqlite-vec, ensure schema. */
  load(): Database {
    if (this.db) return this.db;
    mkdirSync(VECTOR_DB_DIR, { recursive: true });
    const dbPath = join(VECTOR_DB_DIR, 'vectors.db');
    const db = new Database(dbPath);
    db.loadExtension(loadSqliteVecModule().getLoadablePath());
    const { vec_version } = db.prepare('select vec_version() as vec_version').get() as { vec_version: string };
    this.vecVersion = vec_version;
    this.ensureSchema(db);
    this.db = db;
    logger.info('VEC', 'sqlite-vec loaded', { vec_version, dbPath });
    return db;
  }

  private conn(): Database {
    return this.db ?? this.load();
  }

  isLoaded(): boolean {
    return this.db !== null;
  }

  getVecVersion(): string | null {
    return this.vecVersion;
  }

  /**
   * Best-effort maintenance on the vec DB: truncate the WAL (it otherwise grows
   * unbounded — the maintenance loop only ever checkpointed the main DB, perf
   * plan R3) and, when asked, reclaim space with VACUUM. No-op when the vec store
   * was never loaded (e.g. vector search degraded/disabled). Must only be called
   * from an idle context (no concurrent vec transactions), like the main-DB VACUUM.
   */
  maintain(opts: { vacuum: boolean }): void {
    if (!this.db) return;
    try {
      this.db.run('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) {
      logger.debug('VEC', 'vectors.db wal_checkpoint failed', {}, error as Error);
    }
    if (opts.vacuum) {
      try {
        this.db.run('VACUUM');
        logger.info('VEC', 'vectors.db VACUUM complete');
      } catch (error) {
        logger.debug('VEC', 'vectors.db VACUUM failed', {}, error as Error);
      }
    }
  }

  private ensureSchema(db: Database): void {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_documents USING vec0(
        embedding           float[${EMBED_DIM}] distance_metric=cosine,
        sqlite_id           integer,
        doc_type            text,
        obs_type            text,
        project             text,
        merged_into_project text,
        platform_source     text,
        created_at_epoch    integer,
        +chunk_key          text,
        +metadata_json      text
      )`);
  }

  /** Embed `chunks` and upsert them (delete-by-chunk_key then insert). Returns count written. */
  async addChunks(chunks: VecChunk[]): Promise<number> {
    if (chunks.length === 0) return 0;
    const db = this.conn();
    const vectors = await EmbedderService.instance().embed(chunks.map((c) => c.document));

    const del = db.prepare('DELETE FROM vec_documents WHERE chunk_key = ?');
    const ins = db.prepare(`
      INSERT INTO vec_documents(
        embedding, sqlite_id, doc_type, obs_type, project,
        merged_into_project, platform_source, created_at_epoch, chunk_key, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const write = db.transaction((rows: Array<{ c: VecChunk; v: Float32Array }>) => {
      for (const { c, v } of rows) {
        del.run(c.chunk_key);
        ins.run(
          vecBlob(v),
          bigIntOf(c.sqlite_id),
          c.doc_type,
          c.obs_type ?? NONE,
          c.project,
          c.merged_into_project ?? NONE,
          c.platform_source ?? NONE,
          bigIntOf(c.created_at_epoch),
          c.chunk_key,
          JSON.stringify(c.metadata ?? {})
        );
      }
    });

    write(chunks.map((c, i) => ({ c, v: vectors[i] })));
    return chunks.length;
  }

  /** KNN query with metadata pre-filter + JS project-OR resolution + entity dedupe. */
  async queryKnn(
    query: string,
    limit: number,
    filters: VecFilter
  ): Promise<{ ids: number[]; distances: number[]; metadatas: any[] }> {
    const db = this.conn();
    const qv = await EmbedderService.instance().embedOne(query);

    // Over-fetch: vec0 can't OR project/merged_into_project, so fetch wider and
    // resolve the project-OR + entity dedupe in JS.
    const k = Math.min(Math.max(limit, 1) * 4, 400);

    const where: string[] = ['embedding match ?', 'k = ?'];
    const params: Array<Uint8Array | bigint | string> = [vecBlob(qv), BigInt(k)];
    if (filters.doc_type) { where.push('doc_type = ?'); params.push(filters.doc_type); }
    if (filters.obs_type) { where.push('obs_type = ?'); params.push(filters.obs_type); }
    if (filters.platform_source) { where.push('platform_source = ?'); params.push(filters.platform_source); }

    // NOTE: vec0 rejects `k = ?` together with LIMIT — k alone bounds the scan.
    const sql = `
      SELECT sqlite_id, doc_type, project, merged_into_project, platform_source,
             obs_type, created_at_epoch, chunk_key, metadata_json, distance
      FROM vec_documents
      WHERE ${where.join(' AND ')}
      ORDER BY distance`;

    const rows = db.prepare(sql).all(...(params as never[])) as VecRow[];

    const project = filters.project;
    const filtered = project
      ? rows.filter((r) => r.project === project || r.merged_into_project === project)
      : rows;

    const ids: number[] = [];
    const distances: number[] = [];
    const metadatas: any[] = [];
    const seen = new Set<string>();
    for (const r of filtered) {
      const key = `${r.doc_type}:${r.sqlite_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ids.push(Number(r.sqlite_id));
      distances.push(r.distance);
      let meta: any = null;
      try { meta = r.metadata_json ? JSON.parse(r.metadata_json) : null; } catch { meta = null; }
      metadatas.push(meta);
      if (ids.length >= limit) break;
    }
    return { ids, distances, metadatas };
  }

  /** Existing sqlite_ids per doc_type for a project (backfill watermark bootstrap). */
  getMaxIdsByDocType(project: string): { observations: number; summaries: number; prompts: number } {
    const db = this.conn();
    const rows = db.prepare(`
      SELECT doc_type, MAX(sqlite_id) AS max_id
      FROM vec_documents
      WHERE project = ? OR merged_into_project = ?
      GROUP BY doc_type`).all(project, project) as Array<{ doc_type: string; max_id: number }>;
    const out = { observations: 0, summaries: 0, prompts: 0 };
    for (const r of rows) {
      const v = Number(r.max_id) || 0;
      if (r.doc_type === 'observation') out.observations = v;
      else if (r.doc_type === 'session_summary') out.summaries = v;
      else if (r.doc_type === 'user_prompt') out.prompts = v;
    }
    return out;
  }

  /**
   * Delete every vec row belonging to the given SQLite entity ids of one
   * doc_type (perf plan R2). Deletes by the queryable `sqlite_id` + `doc_type`
   * columns rather than parsing chunk_key, so it is robust across chunk-key
   * schemes (e.g. the R1 primary/facts collapse). Best-effort: a no-op when the
   * vec store was never loaded (vector search degraded/disabled) so a caller in
   * the expiry path never forces a load. Returns the number of vec rows removed.
   */
  deleteBySqliteIds(docType: string, sqliteIds: number[]): number {
    if (sqliteIds.length === 0) return 0;
    if (!this.db) return 0; // vec store not loaded — nothing to clean up
    const db = this.db;
    const del = db.prepare('DELETE FROM vec_documents WHERE doc_type = ? AND sqlite_id = ?');
    let removed = 0;
    const run = db.transaction((ids: number[]) => {
      for (const id of ids) {
        const r = del.run(docType, bigIntOf(id));
        removed += r.changes;
      }
    });
    run(sqliteIds);
    return removed;
  }

  /** Patch merged_into_project for the given sqlite_ids (worktree adoption). */
  updateMergedIntoProject(sqliteIds: number[], mergedIntoProject: string): number {
    if (sqliteIds.length === 0) return 0;
    const db = this.conn();
    const upd = db.prepare('UPDATE vec_documents SET merged_into_project = ? WHERE sqlite_id = ?');
    let patched = 0;
    const run = db.transaction((ids: number[]) => {
      for (const id of ids) {
        const r = upd.run(mergedIntoProject, bigIntOf(id));
        patched += r.changes;
      }
    });
    run(sqliteIds);
    return patched;
  }

  close(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
    }
  }
}
