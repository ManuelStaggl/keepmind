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

import { join } from 'path';
import { mkdirSync } from 'fs';
import { Database } from '../../storage/db.js';
import { VECTOR_DB_DIR } from '../../shared/paths.js';
import { SQLITE_BUSY_TIMEOUT_MS, SQLITE_JOURNAL_SIZE_LIMIT_BYTES } from '../sqlite/pragmas.js';
import { EmbedderService, EMBED_DIM } from './EmbedderService.js';
import { logger } from '../../utils/logger.js';
import { pluginRequire } from '../../shared/plugin-node-modules.js';
import { canonicaliseQuerySpelling } from '../sqlite/corpus-spelling.js';

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
// Resolved through plugin-node-modules rather than a bundle-relative
// createRequire: the tree now lives in the plugin data directory, which survives
// the host restoring the plugin root from git.
type SqliteVecModule = { getLoadablePath: () => string };
let sqliteVecModule: SqliteVecModule | null = null;
function loadSqliteVecModule(): SqliteVecModule {
  return (sqliteVecModule ??= pluginRequire<SqliteVecModule>('sqlite-vec'));
}

export class SqliteVecManager {
  private static _instance: SqliteVecManager | null = null;
  static instance(): SqliteVecManager {
    return (this._instance ??= new SqliteVecManager());
  }

  private db: Database | null = null;
  private vecVersion: string | null = null;
  /**
   * Sticky first-failure. conn() falls back to load() on EVERY operation, so a
   * missing native module made each individual observation pay a failed
   * createRequire + throw, and emit its own ERROR line carrying a multi-line
   * "Require stack:". That is how one broken install produced 2157 error lines
   * in a single day. The cause cannot change without a reinstall, so latch it:
   * re-throw the original error cheaply and let the caller degrade to FTS.
   * Cleared by resetLoadFailure() after a successful dependency self-repair.
   */
  private loadFailure: Error | null = null;

  /** Idempotent: open the dedicated vec DB, load sqlite-vec, ensure schema. */
  load(): Database {
    if (this.db) return this.db;
    if (this.loadFailure) throw this.loadFailure;
    try {
      return this.openAndInit();
    } catch (error) {
      this.loadFailure = error instanceof Error ? error : new Error(String(error));
      throw this.loadFailure;
    }
  }

  /**
   * Drop the sticky load failure so the next load() genuinely retries. Called
   * after the dependency self-repair reinstalls the native modules.
   */
  resetLoadFailure(): void {
    this.loadFailure = null;
  }

  private openAndInit(): Database {
    mkdirSync(VECTOR_DB_DIR, { recursive: true });
    const dbPath = join(VECTOR_DB_DIR, 'vectors.db');
    const db = new Database(dbPath);
    // The main DB caps its WAL at 4 MB; the vec DB had no cap, so its WAL grew to
    // the size of the store itself and stayed there. busy_timeout keeps a locked
    // read from failing outright during a concurrent embed batch.
    db.run(`PRAGMA journal_size_limit = ${SQLITE_JOURNAL_SIZE_LIMIT_BYTES}`);
    db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    db.loadExtension(loadSqliteVecModule().getLoadablePath());
    const { vec_version } = db.prepare('select vec_version() as vec_version').get() as { vec_version: string };
    this.vecVersion = vec_version;
    this.ensureSchema(db);
    this.db = db;
    // Boot is the one moment nothing else holds this DB, so a TRUNCATE checkpoint
    // is guaranteed to succeed here. Without it a WAL left oversized by an earlier
    // VACUUM (or by a checkpoint that was blocked every tick) survives restarts
    // indefinitely — observed at 129 MB next to a 135 MB store.
    this.checkpointWal();
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
    // VACUUM in WAL mode rewrites the ENTIRE database through the WAL, so a
    // checkpoint BEFORE the vacuum leaves a WAL the full size of the DB behind
    // (observed: 136 MB WAL next to a 135 MB vectors.db — double the disk for
    // the same data). Checkpoint AFTER, and verify it actually truncated:
    // wal_checkpoint(TRUNCATE) returns busy=1 instead of throwing when a reader
    // holds the DB, so a silent failure looked like success.
    if (opts.vacuum) {
      try {
        this.db.run('VACUUM');
        logger.info('VEC', 'vectors.db VACUUM complete');
      } catch (error) {
        logger.debug('VEC', 'vectors.db VACUUM failed', {}, error as Error);
      }
    }
    this.checkpointWal();
  }

  /** TRUNCATE-checkpoint the vec WAL, logging when SQLite reports it was blocked. */
  private checkpointWal(): void {
    if (!this.db) return;
    try {
      const row = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as
        | { busy?: number; log?: number; checkpointed?: number }
        | undefined;
      if (row && Number(row.busy) === 1) {
        // INFO, not DEBUG: a WAL that cannot be truncated silently costs disk equal
        // to the whole store, which is exactly the failure this method exists to
        // prevent — it should be visible at the default log level.
        logger.info('VEC', 'vectors.db wal_checkpoint blocked by an open reader; WAL not truncated', {
          walPages: row.log ?? null,
        });
      }
    } catch (error) {
      logger.debug('VEC', 'vectors.db wal_checkpoint failed', {}, error as Error);
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

    // Records which embedder produced the vectors in this store. Without it a
    // model change is undetectable: old and new rows sit in the same table but
    // in different vector spaces, and cosine distance between them is noise.
    // The symptom is "search stopped finding things", with nothing in the log.
    db.exec(`CREATE TABLE IF NOT EXISTS vec_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  }

  /** The embedder identity recorded for this store, or null when never stamped. */
  readIndexIdentity(): string | null {
    const db = this.conn();
    const row = db.prepare(`SELECT value FROM vec_meta WHERE key = 'embedder_identity'`).get() as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  /** Stamp the store with the embedder identity that produced its vectors. */
  writeIndexIdentity(identity: string): void {
    const db = this.conn();
    db.prepare(
      `INSERT INTO vec_meta (key, value) VALUES ('embedder_identity', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(identity);
  }

  /** Row count, used to tell an empty store from a populated stale one. */
  countRows(): number {
    const db = this.conn();
    const row = db.prepare('SELECT COUNT(*) AS c FROM vec_documents').get() as { c: number } | undefined;
    return Number(row?.c ?? 0);
  }

  /**
   * Which of `sqliteIds` have NO vec row of this doc_type.
   *
   * This is the only honest answer to "is what was just written searchable?".
   * The backfill reports what it embedded, which is a statement about its own
   * run; this is a statement about the store. They diverged in production —
   * an import reported success while the rows it wrote were invisible to
   * semantic search — and that gap is exactly what a caller must be able to
   * see. Chunked in blocks because a corpus import passes hundreds of ids and
   * SQLite caps the number of bound parameters.
   */
  missingSqliteIds(docType: string, sqliteIds: number[]): number[] {
    if (sqliteIds.length === 0) return [];
    const db = this.conn();
    const missing: number[] = [];
    const CHUNK = 400;
    for (let i = 0; i < sqliteIds.length; i += CHUNK) {
      const block = sqliteIds.slice(i, i + CHUNK);
      const placeholders = block.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT DISTINCT sqlite_id FROM vec_documents
          WHERE doc_type = ? AND sqlite_id IN (${placeholders})`,
      ).all(docType, ...block.map(id => bigIntOf(id))) as Array<{ sqlite_id: number }>;
      const present = new Set(rows.map(row => Number(row.sqlite_id)));
      for (const id of block) if (!present.has(id)) missing.push(id);
    }
    return missing;
  }

  /**
   * Discard every vector so the store can be rebuilt in a new embedding space.
   * Returns the number of rows dropped. VACUUMs afterwards: the whole point is
   * to reclaim the space the stale index occupied, and sqlite would otherwise
   * keep it as free pages.
   */
  purgeAllVectors(): number {
    const db = this.conn();
    const before = this.countRows();
    db.exec('DELETE FROM vec_documents');
    try {
      db.exec('VACUUM');
    } catch (error) {
      // Non-fatal: the index is still correct, it just occupies stale pages.
      logger.debug('VEC', 'VACUUM after purge failed', {}, error as Error);
    }
    return before;
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

  /** KNN query with metadata + project pre-filter and entity dedupe. */
  async queryKnn(
    query: string,
    limit: number,
    filters: VecFilter
  ): Promise<{ ids: number[]; distances: number[]; metadatas: any[] }> {
    // This is the ONE place that turns query text into a vector, so it is also
    // the one place that decides how that text is spelled. A vector has no OR:
    // the keyword channel answers "Pruefung" and "Prüfung" alike by expanding
    // both, and the semantic channel can only pick one. It picks the one the
    // corpus itself attests — see corpus-spelling.ts for the measurement and
    // for why an unattested spelling is never chosen.
    const text = canonicaliseQuerySpelling(query);
    if (text !== query) {
      logger.debug('VEC', 'Query re-spelled as the corpus spells it', { query, text });
    }

    // 'query', not the default 'passage': the stored side is embedded as
    // passages, and an asymmetric model needs the two sides labelled correctly.
    const qv = await EmbedderService.instance().embedOne(text, 'query');
    return this.queryKnnWithVector(qv, limit, filters);
  }

  /**
   * The retrieval half of queryKnn, taking an already-embedded query vector.
   *
   * Split out so the filter/ranking behaviour can be tested with hand-built
   * vectors instead of a 120 MB model — the project-scoping bug this guards
   * against was invisible in unit tests and only showed up against a populated
   * multi-project store.
   */
  async queryKnnWithVector(
    qv: Float32Array,
    limit: number,
    filters: VecFilter,
  ): Promise<{ ids: number[]; distances: number[]; metadatas: any[] }> {
    const db = this.conn();

    const k = Math.min(Math.max(limit, 1) * 4, 400);

    const baseWhere: string[] = ['embedding match ?', 'k = ?'];
    const baseParams: Array<Uint8Array | bigint | string> = [vecBlob(qv), BigInt(k)];
    if (filters.doc_type) { baseWhere.push('doc_type = ?'); baseParams.push(filters.doc_type); }
    if (filters.obs_type) { baseWhere.push('obs_type = ?'); baseParams.push(filters.obs_type); }
    if (filters.platform_source) { baseWhere.push('platform_source = ?'); baseParams.push(filters.platform_source); }

    const runKnn = (where: string[], params: Array<Uint8Array | bigint | string>): VecRow[] => {
      // NOTE: vec0 rejects `k = ?` together with LIMIT — k alone bounds the scan.
      const sql = `
        SELECT sqlite_id, doc_type, project, merged_into_project, platform_source,
               obs_type, created_at_epoch, chunk_key, metadata_json, distance
        FROM vec_documents
        WHERE ${where.join(' AND ')}
        ORDER BY distance`;
      return db.prepare(sql).all(...(params as never[])) as VecRow[];
    };

    // The project constraint goes INTO the KNN, not after it.
    //
    // This used to fetch the global top-k and drop non-matching projects in JS,
    // which silently made a project-scoped search depend on how the whole corpus
    // ranks. Measured on an 18-project store: the global top-32 contained ZERO
    // rows of the requested project for every query tried, in both languages —
    // the first matching row sat at global rank #55, #103, #299. The search
    // returned nothing while the documents were present and correctly embedded.
    //
    // It survived under a model whose distances spread widely enough for the
    // true match to dominate globally. Under a model that packs the whole
    // neighbourhood into a ~0.03 band (measured), rank within that band is
    // decided by corpus density rather than relevance, and the post-filter
    // collapses. Constraining the KNN itself makes the result independent of
    // both — vec0 filters project the same way it already filters doc_type.
    //
    // Two queries because vec0 has no OR: a row matches on `project` or on
    // `merged_into_project` (worktree adoption). Each is a proper in-partition
    // KNN; merging and re-sorting by distance yields the same ordering a single
    // OR-capable query would.
    let rows: VecRow[];
    const project = filters.project;
    if (project) {
      rows = [
        ...runKnn([...baseWhere, 'project = ?'], [...baseParams, project]),
        ...runKnn([...baseWhere, 'merged_into_project = ?'], [...baseParams, project]),
      ].sort((a, b) => a.distance - b.distance);
    } else {
      rows = runKnn(baseWhere, baseParams);
    }
    const filtered = rows;

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

  /**
   * Drop every vec row belonging to a project (retention eviction). Returns the
   * number removed. No-op when the vec store was never loaded, so an eviction
   * pass never forces a load on a degraded install.
   */
  deleteByProject(project: string): number {
    if (!this.db) return 0;
    const res = this.db
      .prepare('DELETE FROM vec_documents WHERE project = ? OR merged_into_project = ?')
      .run(project, project);
    return Number(res.changes ?? 0);
  }

  /** Distinct projects currently holding vectors. */
  listProjects(): string[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT DISTINCT project FROM vec_documents').all() as Array<{ project: string }>;
    return rows.map(r => r.project).filter((p): p is string => typeof p === 'string' && p.length > 0);
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
