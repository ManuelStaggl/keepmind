import { Database, type SQLQueryBindings } from '../../storage/db.js';
import { DATA_DIR, DB_PATH, ensureDir, resolveOpenDbPath, OBSERVER_SESSIONS_PROJECT } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import {
  TableColumnInfo,
  IndexInfo,
  TableNameRow,
  SchemaVersion,
  ObservationRecord,
  SessionSummaryRecord,
  UserPromptRecord,
  LatestPromptResult
} from '../../types/database.js';
import type { ObservationSearchResult, SessionSummarySearchResult, UsageChannel } from './types.js';
import { USAGE_CHANNEL_COLUMNS } from './types.js';
import type { SourceKindFilter } from './source-kind.js';
import { normalizeSourceKind, sourceKindCondition } from './source-kind.js';
import { computeObservationContentHash } from './observations/store.js';
import { parseFileList } from './observations/files.js';
import { redactSecrets, redactSecretsDeep, type RedactOptions } from '../redaction/redact-secrets.js';
import { loadMemoryQualityConfig, MEMORY_QUALITY_DEFAULTS, type MemoryQualityConfig } from '../config/memory-quality.js';
import { defaultImportance } from '../scoring/importance.js';
import { reconcile as reconcileObservation, type ReconcileCandidate } from '../reconcile/reconciler.js';
import { subjectKey } from '../reconcile/subject-key.js';
import { DEFAULT_PLATFORM_SOURCE, normalizePlatformSource, sortPlatformSources } from '../../shared/platform-source.js';
import { findRecentDuplicateUserPrompt as findRecentDuplicateUserPromptRecord } from './prompts/get.js';
import { normalizeStoredPromptText } from './prompt-storage.js';
import { SQLITE_BUSY_TIMEOUT_MS, SQLITE_JOURNAL_SIZE_LIMIT_BYTES } from './pragmas.js';
import { envValue } from '../../shared/legacy-env.js';
import { CHECKPOINT_TYPE, deriveCheckpointTitle, type CheckpointRecord } from '../../shared/checkpoint.js';
import { CURATED_ID_SQL, curatedKindOfRow, AUTHORED_SOURCE_SCHEME, REVISION_MARKER, type CuratedKindLabel } from '../curated/record-key.js';

interface IndexColumnInfo {
  seqno: number;
  cid: number;
  name: string;
}

function resolveCreateSessionArgs(
  customTitle?: string,
  platformSource?: string
): { customTitle?: string; platformSource?: string } {
  return {
    customTitle,
    platformSource: platformSource ? normalizePlatformSource(platformSource) : undefined
  };
}

export class SessionStore {
  public db: Database;

  // Phase 4 / Step 1 — secret-scrubbing on write. Computed once at construction.
  private redactEnabled: boolean;
  private redactOpts: RedactOptions;
  // Phase 4 — full memoryQuality config (reconcile/supersession/expiry gates).
  private mq: MemoryQualityConfig;

  /** Redact a single nullable text field if redaction is enabled. */
  private rt(text: string | null | undefined): string | null | undefined {
    return this.redactEnabled ? redactSecrets(text, this.redactOpts) : text;
  }

  /** Redact every string in a list (facts/concepts) if redaction is enabled. */
  private rl(list: string[]): string[] {
    return this.redactEnabled ? redactSecretsDeep(list, this.redactOpts) : list;
  }

  constructor(dbPathOrDb: string | Database = DB_PATH) {
    try {
      this.mq = loadMemoryQualityConfig();
      const rc = this.mq.redactSecrets;
      this.redactEnabled = rc.enabled;
      this.redactOpts = { entropySweep: rc.entropySweep, entropyThreshold: rc.entropyThreshold };
    } catch {
      // Fail-safe: redaction ON by defaults if config can't load.
      this.mq = MEMORY_QUALITY_DEFAULTS;
      this.redactEnabled = envValue('KEEPMIND_REDACT_SECRETS') !== '0' && envValue('KEEPMIND_REDACT_SECRETS') !== 'false';
      this.redactOpts = { entropySweep: true, entropyThreshold: 4.0 };
    }
    if (dbPathOrDb instanceof Database) {
      this.db = dbPathOrDb;
    } else {
      if (dbPathOrDb !== ':memory:') {
        ensureDir(DATA_DIR);
      }
      // For the canonical DB, run the one-time legacy claude-mem.db → keepmind.db
      // rename and open whichever file actually holds the data (fallback-safe).
      const openPath = dbPathOrDb === DB_PATH ? resolveOpenDbPath() : dbPathOrDb;
      this.db = new Database(openPath);

      this.db.run('PRAGMA journal_mode = WAL');
      this.db.run('PRAGMA synchronous = NORMAL');
      this.db.run('PRAGMA foreign_keys = ON');
      this.db.run(`PRAGMA journal_size_limit = ${SQLITE_JOURNAL_SIZE_LIMIT_BYTES}`);
      // See pragmas.ts: without a busy_timeout SQLite fails a locked read/write
      // immediately instead of waiting, which silently emptied the injected
      // context block whenever a hook read during an observation write.
      this.db.run(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    }

    this.initializeSchema();

    this.ensureWorkerPortColumn();
    this.ensurePromptTrackingColumns();
    this.removeSessionSummariesUniqueConstraint();
    this.addObservationHierarchicalFields();
    this.makeObservationsTextNullable();
    this.createUserPromptsTable();
    this.ensureDiscoveryTokensColumn();
    this.createPendingMessagesTable();
    this.renameSessionIdColumns();
    this.repairSessionIdColumnRename();
    this.addFailedAtEpochColumn();
    this.addOnUpdateCascadeToForeignKeys();
    this.addObservationContentHashColumn();
    this.addSessionCustomTitleColumn();
    this.addSessionPlatformSourceColumn();
    this.addObservationModelColumns();
    this.ensureMergedIntoProjectColumns();
    this.addObservationSubagentColumns();
    this.addObservationsUniqueContentHashIndex();
    this.addObservationsMetadataColumn();
    this.dropDeadPendingMessagesColumns();
    this.ensurePendingMessagesToolUseIdColumn();
    this.dropWorkerPidColumn();
    this.ensureSDKSessionsPlatformContentIdentity();
    this.ensureUserPromptsSessionDbId();
    this.ensurePendingMessagesSessionToolUniqueIndex();
    this.addObservationImportanceColumn();
    this.addObservationBitemporalColumns();
    this.addObservationLastUsedColumn();
    this.addObservationUsageChannelColumns();
    // Must run after addObservationBitemporalColumns — it needs subject_key to exist.
    this.recomputeSubjectKeys();
    this.addCuratedSourceColumns();
    this.createDecisionEdgesTable();
  }

  /**
   * Declared relations between curated records.
   *
   * A separate table, not a column: an edge has its own source location, its
   * own certainty and its own relation type, and the same pair of records can
   * be linked by several relations declared in several files. None of that
   * fits in a field on either endpoint.
   *
   * `certainty` keeps 'sicher' apart from 'vermutet' — an edge whose verb and
   * target sit in one clause is better evidence than one inferred from the
   * field label alone, and better again than one a third-party control file
   * asserts about two records. The distinction is not decoration: A2 forbids
   * inventing relations, and the honest way to honour that while still using
   * weaker signals is to carry the strength with the edge.
   *
   * UNIQUE covers the source location, so the SAME relation declared in three
   * different files stays three rows. That is deliberate — each row is a
   * citation, and "three places say so" is exactly the kind of thing a
   * contradiction check needs to be able to see.
   */
  private createDecisionEdgesTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(42) as SchemaVersion | undefined;
    const existing = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_edges'").all();
    if (applied && existing.length > 0) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS decision_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        from_record TEXT NOT NULL,
        to_record TEXT NOT NULL,
        relation TEXT NOT NULL,
        certainty TEXT NOT NULL,
        source_path TEXT NOT NULL,
        source_line INTEGER NOT NULL,
        raw_text TEXT,
        created_at_epoch INTEGER NOT NULL,
        UNIQUE(project, from_record, to_record, relation, source_path, source_line)
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_from ON decision_edges(project, from_record)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_to ON decision_edges(project, to_record)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_edges_relation ON decision_edges(project, relation)');

    if (!applied) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(42, new Date().toISOString());
    }
  }

  /**
   * Replace all edges read from one file.
   *
   * Per-file rather than per-project: re-reading one changed record must not
   * drop the edges every other file declared, and re-reading it must not leave
   * its old edges behind either. Deleting by source_path is the only key that
   * gets both.
   */
  replaceEdgesForSource(
    project: string,
    sourcePath: string,
    edges: Array<{
      from: string;
      to: string;
      relation: string;
      certainty: string;
      sourceLine: number;
      rawText?: string | null;
    }>,
    nowEpoch: number = Date.now(),
  ): { inserted: number; removed: number } {
    const removed = this.db.prepare('DELETE FROM decision_edges WHERE project = ? AND source_path = ?')
      .run(project, sourcePath) as unknown as { changes?: number };
    const stmt = this.db.prepare(`
      INSERT INTO decision_edges
        (project, from_record, to_record, relation, certainty, source_path, source_line, raw_text, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING
    `);
    let inserted = 0;
    for (const edge of edges) {
      stmt.run(project, edge.from, edge.to, edge.relation, edge.certainty, sourcePath, edge.sourceLine, edge.rawText ?? null, nowEpoch);
      inserted++;
    }
    return { inserted, removed: removed?.changes ?? 0 };
  }

  /** Every edge declared in a project, newest source first. */
  getEdges(project: string): Array<{
    from_record: string;
    to_record: string;
    relation: string;
    certainty: string;
    source_path: string;
    source_line: number;
    raw_text: string | null;
  }> {
    return this.db.prepare(`
      SELECT from_record, to_record, relation, certainty, source_path, source_line, raw_text
      FROM decision_edges WHERE project = ?
      ORDER BY from_record, to_record, relation
    `).all(project) as never;
  }

  /**
   * Curated knowledge: source kind, provenance, and subject freshness.
   *
   * ONE store, two source kinds — not a second database and not a mode.
   * A mode only swaps prompts and vocabulary, so curated rows built that way
   * would still hang off the compressor; the guarantee that the model never
   * sees them is enforced by the WRITE PATH, not by where the bytes live.
   *
   *   source_kind      NULL/'observed' = produced by the observer.
   *                    'curated'       = imported verbatim from a file the
   *                                      user owns. Never compressed, never
   *                                      shown to a provider.
   *   source_path      Absolute path of the file a curated row came from.
   *   source_line      1-based line of its heading in that file.
   *   subject          What the row is *about*, carried so an answer can name
   *                    it. keepmind never checks whether the subject still
   *                    exists on disk — that is a question about someone
   *                    else's working tree, at their moment, under their
   *                    rules, and a wrong negative there is worse than none.
   *   last_verified_at When the owner last confirmed the row against reality.
   *
   * source_path/source_line are what let every answer cite a file and a line
   * instead of asserting. They are deliberately on the observation itself, so
   * a citation survives even when a row carries no edges at all.
   */
  private addCuratedSourceColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(41) as SchemaVersion | undefined;
    const cols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const has = (n: string) => cols.some(c => c.name === n);
    const columns: Array<[string, string]> = [
      ['source_kind', 'TEXT'],
      ['source_path', 'TEXT'],
      ['source_line', 'INTEGER'],
      ['subject', 'TEXT'],
      ['last_verified_at', 'INTEGER'],
    ];
    if (applied && columns.every(([name]) => has(name))) return;

    for (const [name, type] of columns) {
      if (!has(name)) {
        this.db.run(`ALTER TABLE observations ADD COLUMN ${name} ${type}`);
      }
    }
    // The A9 origin filter is a WHERE on this index, not a subquery.
    this.db.run('CREATE INDEX IF NOT EXISTS idx_obs_source_kind ON observations(project, source_kind)');
    // Re-importing a file must update its rows rather than duplicate them.
    this.db.run('CREATE INDEX IF NOT EXISTS idx_obs_source_path ON observations(source_path)');

    if (!applied) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(41, new Date().toISOString());
    }
  }

  /**
   * Per-channel usage counters.
   *
   * `relevance_count` alone could not answer "is this memory worth keeping".
   * It was bumped from exactly two places — SessionStart context injection and
   * an explicit get_observations fetch — while neither FTS nor vector search
   * touched it. So a 96%-never-used reading was not evidence that 96% of
   * observations are ballast; it was evidence that two of the four retrieval
   * paths were instrumented. Worse, the apparent "value" differences between
   * types tracked the injection ranker's own importance × recency weighting,
   * which is circular: the counter measured what injection chose to show, and
   * injection chose by a score the counter had no part in.
   *
   * Splitting the channels makes the number interpretable, and is a
   * precondition for any pruning or retention decision — not an optimisation
   * of one.
   */
  private addObservationUsageChannelColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(39) as SchemaVersion | undefined;
    const cols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const has = (n: string) => cols.some(c => c.name === n);
    const columns = ['injection_count', 'explicit_fetch_count', 'fts_hit_count', 'vector_hit_count'];
    if (applied && columns.every(has)) return;

    for (const column of columns) {
      if (!has(column)) {
        this.db.run(`ALTER TABLE observations ADD COLUMN ${column} INTEGER DEFAULT 0`);
      }
    }

    if (!applied) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(39, new Date().toISOString());
    }
  }

  // Phase 4 / Step 5 — bi-temporal supersession columns. Additive + idempotent.
  // valid_from backfills to created_at_epoch; valid_to NULL = currently valid.
  private addObservationBitemporalColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(37) as SchemaVersion | undefined;
    const cols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const has = (n: string) => cols.some(c => c.name === n);
    if (applied && has('valid_from') && has('valid_to') && has('subject_key')) return;

    if (!has('valid_from')) this.db.run('ALTER TABLE observations ADD COLUMN valid_from INTEGER');
    if (!has('valid_to')) this.db.run('ALTER TABLE observations ADD COLUMN valid_to INTEGER');
    if (!has('subject_key')) this.db.run('ALTER TABLE observations ADD COLUMN subject_key TEXT');
    this.db.run('UPDATE observations SET valid_from = created_at_epoch WHERE valid_from IS NULL');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_obs_subject_valid ON observations(project, subject_key, valid_to)');

    if (!applied) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(37, new Date().toISOString());
    }
  }

  // Schema 40 — recompute subject_key after the reconciler's normalizer became
  // Unicode-aware (src/services/reconcile/reconciler.ts).
  //
  // subject_key is a hash of the NORMALIZED title, so changing the normalizer
  // changes the key for every subject whose title carries a non-ASCII letter or
  // a German function word. Rows written before that change and rows written
  // after it would then sit in two different subject spaces for the same
  // subject, and supersession would quietly stop finding the predecessor it is
  // supposed to close. That is the same failure mode `vec_meta.embedder_identity`
  // exists to prevent one table over, and it presents the same way: nothing
  // errors, the feature just stops working.
  //
  // Cheap and idempotent: ASCII-only titles hash to exactly what they did
  // before, so the UPDATE is a no-op for most rows on an English corpus.
  private recomputeSubjectKeys(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(40) as SchemaVersion | undefined;
    if (applied) return;

    const cols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    if (cols.some(c => c.name === 'subject_key')) {
      const rows = this.db.query(
        'SELECT id, title, facts, narrative FROM observations WHERE subject_key IS NOT NULL'
      ).all() as Array<{ id: number; title: string | null; facts: string | null; narrative: string | null }>;

      const update = this.db.prepare('UPDATE observations SET subject_key = ? WHERE id = ?');
      let changed = 0;
      this.db.run('BEGIN TRANSACTION');
      try {
        for (const row of rows) {
          const next = subjectKey({ title: row.title, facts: row.facts, narrative: row.narrative });
          update.run(next, row.id);
          changed++;
        }
        this.db.run('COMMIT');
      } catch (error) {
        this.db.run('ROLLBACK');
        logger.warn(
          'DB',
          'subject_key recompute failed — supersession may not match across the normalizer change',
          { rows: rows.length },
          error instanceof Error ? error : new Error(String(error))
        );
        return;
      }
      if (changed > 0) {
        logger.info('DB', 'Recomputed subject_key for Unicode-aware normalization', { rows: changed });
      }
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(40, new Date().toISOString());
  }

  // Phase 4 / Step 6 — auto-expiry: last_used_at (reset-on-use timer). Additive.
  private addObservationLastUsedColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(38) as SchemaVersion | undefined;
    const cols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const hasColumn = cols.some(c => c.name === 'last_used_at');
    if (applied && hasColumn) return;

    if (!hasColumn) this.db.run('ALTER TABLE observations ADD COLUMN last_used_at INTEGER');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_obs_last_used ON observations(last_used_at)');

    if (!applied) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(38, new Date().toISOString());
    }
  }

  // Phase 4 / Step 3 — importance scoring. Additive, idempotent: NULL = unscored
  // (ranked as the neutral mid-score via COALESCE in the inject path).
  private addObservationImportanceColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(36) as SchemaVersion | undefined;
    const cols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const hasColumn = cols.some(c => c.name === 'importance');
    if (applied && hasColumn) return;

    if (!hasColumn) {
      this.db.run('ALTER TABLE observations ADD COLUMN importance INTEGER');
    }
    this.db.run('CREATE INDEX IF NOT EXISTS idx_observations_importance ON observations(importance)');

    if (!applied) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(36, new Date().toISOString());
    }
  }

  private getIndexColumns(indexName: string): string[] {
    return (this.db.query(`PRAGMA index_info(${JSON.stringify(indexName)})`).all() as IndexColumnInfo[])
      .map(col => col.name);
  }

  private hasUniqueIndexOnColumns(table: string, columns: string[]): boolean {
    const indexes = this.db.query(`PRAGMA index_list(${table})`).all() as IndexInfo[];
    return indexes.some(index => {
      if (index.unique !== 1) return false;
      const indexColumns = this.getIndexColumns(index.name);
      return indexColumns.length === columns.length
        && indexColumns.every((column, i) => column === columns[i]);
    });
  }

  private resolvePromptSessionDbId(contentSessionId: string, sessionDbId?: number, platformSource?: string): number | null {
    if (sessionDbId !== undefined) return sessionDbId;

    const normalizedPlatformSource = platformSource ? normalizePlatformSource(platformSource) : undefined;
    if (normalizedPlatformSource) {
      const row = this.db.prepare(`
        SELECT id
        FROM sdk_sessions
        WHERE COALESCE(NULLIF(platform_source, ''), ?) = ?
          AND content_session_id = ?
        LIMIT 1
      `).get(DEFAULT_PLATFORM_SOURCE, normalizedPlatformSource, contentSessionId) as { id: number } | undefined;

      return row?.id ?? null;
    }

    const row = this.db.prepare(`
      SELECT id
      FROM sdk_sessions
      WHERE content_session_id = ?
      ORDER BY CASE COALESCE(NULLIF(platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}')
        WHEN '${DEFAULT_PLATFORM_SOURCE}' THEN 0
        ELSE 1
      END, id
      LIMIT 1
    `).get(contentSessionId) as { id: number } | undefined;

    return row?.id ?? null;
  }

  private dropWorkerPidColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(32) as SchemaVersion | undefined;

    const cols = this.db.query('PRAGMA table_info(pending_messages)').all() as TableColumnInfo[];
    const hasColumn = cols.some(c => c.name === 'worker_pid');
    if (applied && !hasColumn) return;

    if (hasColumn) {
      try {
        this.db.run('DROP INDEX IF EXISTS idx_pending_messages_worker_pid');
        this.db.run('ALTER TABLE pending_messages DROP COLUMN worker_pid');
        logger.debug('DB', 'Dropped worker_pid column and its index from pending_messages');
      } catch (error) {
        logger.warn('DB', 'Failed to drop worker_pid column from pending_messages', {}, error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }

    if (!applied) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(32, new Date().toISOString());
    }
  }

  private ensureSDKSessionsPlatformContentIdentity(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(33) as SchemaVersion | undefined;
    const hasGlobalContentUnique = this.hasUniqueIndexOnColumns('sdk_sessions', ['content_session_id']);
    const hasCompositeUnique = this.hasUniqueIndexOnColumns('sdk_sessions', ['platform_source', 'content_session_id']);
    const columns = this.db.query('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const hasPlatformSource = columns.some(col => col.name === 'platform_source');

    if (applied && !hasGlobalContentUnique && hasCompositeUnique && hasPlatformSource) return;

    if (!hasPlatformSource) {
      this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${DEFAULT_PLATFORM_SOURCE}'`);
    }

    this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${DEFAULT_PLATFORM_SOURCE}'
      WHERE platform_source IS NULL OR platform_source = ''
    `);

    if (hasGlobalContentUnique) {
      this.db.run('PRAGMA foreign_keys = OFF');
      this.db.run('BEGIN TRANSACTION');
      try {
        this.db.run('DROP TABLE IF EXISTS sdk_sessions_new');
        this.db.run(`
          CREATE TABLE sdk_sessions_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_session_id TEXT NOT NULL,
            memory_session_id TEXT UNIQUE,
            project TEXT NOT NULL,
            platform_source TEXT NOT NULL DEFAULT '${DEFAULT_PLATFORM_SOURCE}',
            user_prompt TEXT,
            started_at TEXT NOT NULL,
            started_at_epoch INTEGER NOT NULL,
            completed_at TEXT,
            completed_at_epoch INTEGER,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'failed')),
            worker_port INTEGER,
            prompt_counter INTEGER DEFAULT 0,
            custom_title TEXT
          )
        `);
        this.db.run(`
          INSERT INTO sdk_sessions_new (
            id, content_session_id, memory_session_id, project, platform_source,
            user_prompt, started_at, started_at_epoch, completed_at, completed_at_epoch,
            status, worker_port, prompt_counter, custom_title
          )
          SELECT
            id, content_session_id, memory_session_id, project,
            COALESCE(NULLIF(platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}'),
            user_prompt, started_at, started_at_epoch, completed_at, completed_at_epoch,
            status, worker_port, prompt_counter, custom_title
          FROM sdk_sessions
        `);
        this.db.run('DROP TABLE sdk_sessions');
        this.db.run('ALTER TABLE sdk_sessions_new RENAME TO sdk_sessions');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC)');
        this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)');
        this.db.run('CREATE UNIQUE INDEX IF NOT EXISTS ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id)');
        if (!applied) {
          this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(33, new Date().toISOString());
        }
        this.db.run('COMMIT');
      } catch (error) {
        this.db.run('ROLLBACK');
        throw error;
      } finally {
        this.db.run('PRAGMA foreign_keys = ON');
      }
      return;
    }

    this.db.run('CREATE UNIQUE INDEX IF NOT EXISTS ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)');

    if (!applied) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(33, new Date().toISOString());
    }
  }

  private ensureUserPromptsSessionDbId(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(34) as SchemaVersion | undefined;
    const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='user_prompts'").all() as TableNameRow[];
    if (tables.length === 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(34, new Date().toISOString());
      return;
    }

    const cols = this.db.query('PRAGMA table_info(user_prompts)').all() as TableColumnInfo[];
    const hasSessionDbId = cols.some(col => col.name === 'session_db_id');
    const fks = this.db.query('PRAGMA foreign_key_list(user_prompts)').all() as Array<{ table: string; from: string; to: string }>;
    const hasContentSessionFk = fks.some(fk => fk.table === 'sdk_sessions' && fk.from === 'content_session_id');

    if (applied && hasSessionDbId && !hasContentSessionFk) return;

    const hasFTS = (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='user_prompts_fts'").all() as { name: string }[]).length > 0;
    const sessionDbIdSelect = hasSessionDbId
      ? `COALESCE(up.session_db_id, (
          SELECT s.id FROM sdk_sessions s
          WHERE s.content_session_id = up.content_session_id
          ORDER BY CASE COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}')
            WHEN '${DEFAULT_PLATFORM_SOURCE}' THEN 0
            ELSE 1
          END, s.id
          LIMIT 1
        ))`
      : `(
          SELECT s.id FROM sdk_sessions s
          WHERE s.content_session_id = up.content_session_id
          ORDER BY CASE COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}')
            WHEN '${DEFAULT_PLATFORM_SOURCE}' THEN 0
            ELSE 1
          END, s.id
          LIMIT 1
        )`;

    this.db.run('PRAGMA foreign_keys = OFF');
    this.db.run('BEGIN TRANSACTION');
    try {
      this.db.run('DROP TRIGGER IF EXISTS user_prompts_ai');
      this.db.run('DROP TRIGGER IF EXISTS user_prompts_ad');
      this.db.run('DROP TRIGGER IF EXISTS user_prompts_au');
      this.db.run('DROP TABLE IF EXISTS user_prompts_new');
      this.db.run(`
        CREATE TABLE user_prompts_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_db_id INTEGER,
          content_session_id TEXT NOT NULL,
          prompt_number INTEGER NOT NULL,
          prompt_text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
        )
      `);
      this.db.run(`
        INSERT INTO user_prompts_new (
          id, session_db_id, content_session_id, prompt_number,
          prompt_text, created_at, created_at_epoch
        )
        SELECT
          up.id,
          ${sessionDbIdSelect},
          up.content_session_id,
          up.prompt_number,
          up.prompt_text,
          up.created_at,
          up.created_at_epoch
        FROM user_prompts up
      `);
      this.db.run('DROP TABLE user_prompts');
      this.db.run('ALTER TABLE user_prompts_new RENAME TO user_prompts');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_prompts_session ON user_prompts(session_db_id)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_prompts_claude_session ON user_prompts(content_session_id)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_prompts_created ON user_prompts(created_at_epoch DESC)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_prompts_prompt_number ON user_prompts(prompt_number)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_prompts_lookup ON user_prompts(session_db_id, prompt_number)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_user_prompts_content_lookup ON user_prompts(content_session_id, prompt_number)');

      if (hasFTS) {
        this.db.run(`
          CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
            INSERT INTO user_prompts_fts(rowid, prompt_text)
            VALUES (new.id, new.prompt_text);
          END;

          CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
            INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
            VALUES('delete', old.id, old.prompt_text);
          END;

          CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
            INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
            VALUES('delete', old.id, old.prompt_text);
            INSERT INTO user_prompts_fts(rowid, prompt_text)
            VALUES (new.id, new.prompt_text);
          END;
        `);
        this.db.run("INSERT INTO user_prompts_fts(user_prompts_fts) VALUES('rebuild')");
      }

      if (!applied) {
        this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(34, new Date().toISOString());
      }
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    } finally {
      this.db.run('PRAGMA foreign_keys = ON');
    }
  }

  private ensurePendingMessagesSessionToolUniqueIndex(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(35) as SchemaVersion | undefined;
    const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all() as TableNameRow[];
    if (tables.length === 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(35, new Date().toISOString());
      return;
    }

    const hasExpectedIndex = this.hasUniqueIndexOnColumns('pending_messages', ['session_db_id', 'tool_use_id']);
    if (applied && hasExpectedIndex) return;

    this.db.run('BEGIN TRANSACTION');
    try {
      this.db.run('DROP INDEX IF EXISTS ux_pending_session_tool');
      this.db.run(`
        DELETE FROM pending_messages
         WHERE id IN (
           SELECT id
             FROM (
               SELECT id,
                      ROW_NUMBER() OVER (
                        PARTITION BY session_db_id, tool_use_id
                        ORDER BY CASE status
                          WHEN 'processing' THEN 0
                          WHEN 'pending' THEN 1
                          ELSE 2
                        END, id
                      ) AS duplicate_rank
                 FROM pending_messages
                WHERE tool_use_id IS NOT NULL
             )
            WHERE duplicate_rank > 1
           )
      `);
      this.db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_session_tool
        ON pending_messages(session_db_id, tool_use_id)
        WHERE tool_use_id IS NOT NULL
      `);
      if (!applied) {
        this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(35, new Date().toISOString());
      }
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  private dropDeadPendingMessagesColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(31) as SchemaVersion | undefined;

    const cols = this.db.query('PRAGMA table_info(pending_messages)').all() as TableColumnInfo[];
    const colNames = new Set(cols.map(c => c.name));
    const deadColumns = ['retry_count', 'failed_at_epoch', 'completed_at_epoch'];
    const toDrop = deadColumns.filter(name => colNames.has(name));
    if (applied && toDrop.length === 0) return;

    if (toDrop.length > 0) {
      this.db.run('BEGIN TRANSACTION');
      try {
        this.db.run(`DELETE FROM pending_messages WHERE status NOT IN ('pending', 'processing')`);
        for (const colName of toDrop) {
          this.db.run(`ALTER TABLE pending_messages DROP COLUMN ${colName}`);
          logger.debug('DB', `Dropped dead column ${colName} from pending_messages`);
        }
        if (!applied) {
          this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(31, new Date().toISOString());
        }
        this.db.run('COMMIT');
      } catch (error) {
        this.db.run('ROLLBACK');
        logger.warn('DB', 'Failed to drop dead columns from pending_messages', {}, error instanceof Error ? error : new Error(String(error)));
        return;
      }
      return;
    }

    if (!applied) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(31, new Date().toISOString());
    }
  }

  private initializeSchema(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS sdk_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        platform_source TEXT NOT NULL DEFAULT 'claude',
        user_prompt TEXT,
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_sdk_sessions_platform_content ON sdk_sessions(platform_source, content_session_id);

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT UNIQUE NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(4, new Date().toISOString());
  }

  private ensureWorkerPortColumn(): void {
    const tableInfo = this.db.query('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const hasWorkerPort = tableInfo.some(col => col.name === 'worker_port');

    if (!hasWorkerPort) {
      this.db.run('ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER');
      logger.debug('DB', 'Added worker_port column to sdk_sessions table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(5, new Date().toISOString());
  }

  private ensurePromptTrackingColumns(): void {
    const sessionsInfo = this.db.query('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const hasPromptCounter = sessionsInfo.some(col => col.name === 'prompt_counter');

    if (!hasPromptCounter) {
      this.db.run('ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0');
      logger.debug('DB', 'Added prompt_counter column to sdk_sessions table');
    }

    const observationsInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const obsHasPromptNumber = observationsInfo.some(col => col.name === 'prompt_number');

    if (!obsHasPromptNumber) {
      this.db.run('ALTER TABLE observations ADD COLUMN prompt_number INTEGER');
      logger.debug('DB', 'Added prompt_number column to observations table');
    }

    const summariesInfo = this.db.query('PRAGMA table_info(session_summaries)').all() as TableColumnInfo[];
    const sumHasPromptNumber = summariesInfo.some(col => col.name === 'prompt_number');

    if (!sumHasPromptNumber) {
      this.db.run('ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER');
      logger.debug('DB', 'Added prompt_number column to session_summaries table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(6, new Date().toISOString());
  }

  private removeSessionSummariesUniqueConstraint(): void {
    const summariesIndexes = this.db.query('PRAGMA index_list(session_summaries)').all() as IndexInfo[];
    const hasUniqueConstraint = summariesIndexes.some(idx => idx.unique === 1 && idx.origin !== 'pk');

    if (!hasUniqueConstraint) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(7, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Removing UNIQUE constraint from session_summaries.memory_session_id');

    this.db.run('BEGIN TRANSACTION');

    this.db.run('DROP TABLE IF EXISTS session_summaries_new');

    this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, created_at, created_at_epoch
      FROM session_summaries
    `);

    this.db.run('DROP TABLE session_summaries');

    this.db.run('ALTER TABLE session_summaries_new RENAME TO session_summaries');

    this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `);

    this.db.run('COMMIT');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(7, new Date().toISOString());

    logger.debug('DB', 'Successfully removed UNIQUE constraint from session_summaries.memory_session_id');
  }

  private addObservationHierarchicalFields(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(8) as SchemaVersion | undefined;
    if (applied) return;

    const tableInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const hasTitle = tableInfo.some(col => col.name === 'title');

    if (hasTitle) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(8, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Adding hierarchical fields to observations table');

    this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(8, new Date().toISOString());

    logger.debug('DB', 'Successfully added hierarchical fields to observations table');
  }

  private makeObservationsTextNullable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(9) as SchemaVersion | undefined;
    if (applied) return;

    const tableInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const textColumn = tableInfo.find(col => col.name === 'text');

    if (!textColumn || textColumn.notnull === 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(9, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Making observations.text nullable');

    this.db.run('BEGIN TRANSACTION');

    this.db.run('DROP TABLE IF EXISTS observations_new');

    this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `);

    this.db.run('DROP TABLE observations');

    this.db.run('ALTER TABLE observations_new RENAME TO observations');

    this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `);

    this.db.run('COMMIT');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(9, new Date().toISOString());

    logger.debug('DB', 'Successfully made observations.text nullable');
  }

  private createUserPromptsTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(10) as SchemaVersion | undefined;
    if (applied) return;

    const tableInfo = this.db.query('PRAGMA table_info(user_prompts)').all() as TableColumnInfo[];
    if (tableInfo.length > 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(10, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Creating user_prompts table with FTS5 support');

    this.db.run('BEGIN TRANSACTION');

    this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_session ON user_prompts(session_db_id);
      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(session_db_id, prompt_number);
      CREATE INDEX idx_user_prompts_content_lookup ON user_prompts(content_session_id, prompt_number);
    `);

    const ftsCreateSQL = `
      CREATE VIRTUAL TABLE user_prompts_fts USING fts5(
        prompt_text,
        content='user_prompts',
        content_rowid='id'
      );
    `;
    const ftsTriggersSQL = `
      CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;

      CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
      END;

      CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;
    `;

    try {
      this.db.run(ftsCreateSQL);
      this.db.run(ftsTriggersSQL);
    } catch (ftsError) {
      if (ftsError instanceof Error) {
        logger.warn('DB', 'FTS5 not available — user_prompts_fts skipped (search uses ChromaDB)', {}, ftsError);
      } else {
        logger.warn('DB', 'FTS5 not available — user_prompts_fts skipped (search uses ChromaDB)', {}, new Error(String(ftsError)));
      }
      this.db.run('COMMIT');
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(10, new Date().toISOString());
      logger.debug('DB', 'Created user_prompts table (without FTS5)');
      return;
    }

    this.db.run('COMMIT');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(10, new Date().toISOString());

    logger.debug('DB', 'Successfully created user_prompts table');
  }

  private ensureDiscoveryTokensColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(11) as SchemaVersion | undefined;
    if (applied) return;

    const observationsInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const obsHasDiscoveryTokens = observationsInfo.some(col => col.name === 'discovery_tokens');

    if (!obsHasDiscoveryTokens) {
      this.db.run('ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0');
      logger.debug('DB', 'Added discovery_tokens column to observations table');
    }

    const summariesInfo = this.db.query('PRAGMA table_info(session_summaries)').all() as TableColumnInfo[];
    const sumHasDiscoveryTokens = summariesInfo.some(col => col.name === 'discovery_tokens');

    if (!sumHasDiscoveryTokens) {
      this.db.run('ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0');
      logger.debug('DB', 'Added discovery_tokens column to session_summaries table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(11, new Date().toISOString());
  }

  private createPendingMessagesTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(16) as SchemaVersion | undefined;
    if (applied) return;

    const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all() as TableNameRow[];
    if (tables.length > 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(16, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Creating pending_messages table');

    this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing')),
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(16, new Date().toISOString());

    logger.debug('DB', 'pending_messages table created successfully');
  }

  private renameSessionIdColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(17) as SchemaVersion | undefined;
    if (applied) return;

    logger.debug('DB', 'Checking session ID columns for semantic clarity rename');

    let renamesPerformed = 0;

    const safeRenameColumn = (table: string, oldCol: string, newCol: string): boolean => {
      const tableInfo = this.db.query(`PRAGMA table_info(${table})`).all() as TableColumnInfo[];
      const hasOldCol = tableInfo.some(col => col.name === oldCol);
      const hasNewCol = tableInfo.some(col => col.name === newCol);

      if (hasNewCol) {
        return false;
      }

      if (hasOldCol) {
        this.db.run(`ALTER TABLE ${table} RENAME COLUMN ${oldCol} TO ${newCol}`);
        logger.debug('DB', `Renamed ${table}.${oldCol} to ${newCol}`);
        return true;
      }

      logger.warn('DB', `Column ${oldCol} not found in ${table}, skipping rename`);
      return false;
    };

    if (safeRenameColumn('sdk_sessions', 'claude_session_id', 'content_session_id')) renamesPerformed++;
    if (safeRenameColumn('sdk_sessions', 'sdk_session_id', 'memory_session_id')) renamesPerformed++;

    if (safeRenameColumn('pending_messages', 'claude_session_id', 'content_session_id')) renamesPerformed++;

    if (safeRenameColumn('observations', 'sdk_session_id', 'memory_session_id')) renamesPerformed++;

    if (safeRenameColumn('session_summaries', 'sdk_session_id', 'memory_session_id')) renamesPerformed++;

    if (safeRenameColumn('user_prompts', 'claude_session_id', 'content_session_id')) renamesPerformed++;

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(17, new Date().toISOString());

    if (renamesPerformed > 0) {
      logger.debug('DB', `Successfully renamed ${renamesPerformed} session ID columns`);
    } else {
      logger.debug('DB', 'No session ID column renames needed (already up to date)');
    }
  }

  private repairSessionIdColumnRename(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(19) as SchemaVersion | undefined;
    if (applied) return;

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(19, new Date().toISOString());
  }

  private addFailedAtEpochColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(20) as SchemaVersion | undefined;
    if (applied) return;

    const tableInfo = this.db.query('PRAGMA table_info(pending_messages)').all() as TableColumnInfo[];
    const hasColumn = tableInfo.some(col => col.name === 'failed_at_epoch');

    if (!hasColumn) {
      this.db.run('ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER');
      logger.debug('DB', 'Added failed_at_epoch column to pending_messages table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(20, new Date().toISOString());
  }

  private addOnUpdateCascadeToForeignKeys(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(21) as SchemaVersion | undefined;
    if (applied) return;

    logger.debug('DB', 'Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries');

    this.db.run('PRAGMA foreign_keys = OFF');
    this.db.run('BEGIN TRANSACTION');

    this.db.run('DROP TRIGGER IF EXISTS observations_ai');
    this.db.run('DROP TRIGGER IF EXISTS observations_ad');
    this.db.run('DROP TRIGGER IF EXISTS observations_au');

    this.db.run('DROP TABLE IF EXISTS observations_new');

    const observationsCols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const observationsHasMetadata = observationsCols.some(c => c.name === 'metadata');
    const observationsHasContentHash = observationsCols.some(c => c.name === 'content_hash');
    const metadataColumnSQL = observationsHasMetadata ? ',\n        metadata TEXT' : '';
    const metadataSelectSQL = observationsHasMetadata ? ', metadata' : '';
    const contentHashColumnSQL = observationsHasContentHash ? ',\n        content_hash TEXT' : '';
    const contentHashSelectSQL = observationsHasContentHash ? ', content_hash' : '';

    const observationsNewSQL = `
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL${metadataColumnSQL}${contentHashColumnSQL},
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `;
    const observationsCopySQL = `
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             discovery_tokens, created_at, created_at_epoch${metadataSelectSQL}${contentHashSelectSQL}
      FROM observations
    `;
    const observationsIndexesSQL = `
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `;
    const observationsFTSTriggersSQL = `
      CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;
    `;

    this.db.run('DROP TRIGGER IF EXISTS session_summaries_ai');
    this.db.run('DROP TRIGGER IF EXISTS session_summaries_ad');
    this.db.run('DROP TRIGGER IF EXISTS session_summaries_au');

    this.db.run('DROP TABLE IF EXISTS session_summaries_new');

    const summariesNewSQL = `
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `;
    const summariesCopySQL = `
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, discovery_tokens, created_at, created_at_epoch
      FROM session_summaries
    `;
    const summariesIndexesSQL = `
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `;
    const summariesFTSTriggersSQL = `
      CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_au AFTER UPDATE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
      END;
    `;

    try {
      this.recreateObservationsWithCascade(observationsNewSQL, observationsCopySQL, observationsIndexesSQL, observationsFTSTriggersSQL);
      this.recreateSessionSummariesWithCascade(summariesNewSQL, summariesCopySQL, summariesIndexesSQL, summariesFTSTriggersSQL);

      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(21, new Date().toISOString());
      this.db.run('COMMIT');
      this.db.run('PRAGMA foreign_keys = ON');
      logger.debug('DB', 'Successfully added ON UPDATE CASCADE to FK constraints');
    } catch (error) {
      this.db.run('ROLLBACK');
      this.db.run('PRAGMA foreign_keys = ON');
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }

  private recreateObservationsWithCascade(createSQL: string, copySQL: string, indexesSQL: string, ftsTriggersSQL: string): void {
    this.db.run(createSQL);
    this.db.run(copySQL);
    this.db.run('DROP TABLE observations');
    this.db.run('ALTER TABLE observations_new RENAME TO observations');
    this.db.run(indexesSQL);

    const hasFTS = (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all() as { name: string }[]).length > 0;
    if (hasFTS) {
      this.db.run(ftsTriggersSQL);
    }
  }

  private recreateSessionSummariesWithCascade(createSQL: string, copySQL: string, indexesSQL: string, ftsTriggersSQL: string): void {
    this.db.run(createSQL);
    this.db.run(copySQL);
    this.db.run('DROP TABLE session_summaries');
    this.db.run('ALTER TABLE session_summaries_new RENAME TO session_summaries');
    this.db.run(indexesSQL);

    const hasSummariesFTS = (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all() as { name: string }[]).length > 0;
    if (hasSummariesFTS) {
      this.db.run(ftsTriggersSQL);
    }
  }

  private addObservationContentHashColumn(): void {
    const tableInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const hasColumn = tableInfo.some(col => col.name === 'content_hash');

    if (hasColumn) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(22, new Date().toISOString());
      return;
    }

    this.db.run('ALTER TABLE observations ADD COLUMN content_hash TEXT');
    this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL");
    this.db.run('CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)');
    logger.debug('DB', 'Added content_hash column to observations table with backfill and index');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(22, new Date().toISOString());
  }

  private addSessionCustomTitleColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(23) as SchemaVersion | undefined;
    if (applied) return;

    const tableInfo = this.db.query('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const hasColumn = tableInfo.some(col => col.name === 'custom_title');

    if (!hasColumn) {
      this.db.run('ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT');
      logger.debug('DB', 'Added custom_title column to sdk_sessions table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(23, new Date().toISOString());
  }

  private addSessionPlatformSourceColumn(): void {
    const tableInfo = this.db.query('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const hasColumn = tableInfo.some(col => col.name === 'platform_source');
    const indexInfo = this.db.query('PRAGMA index_list(sdk_sessions)').all() as IndexInfo[];
    const hasIndex = indexInfo.some(index => index.name === 'idx_sdk_sessions_platform_source');
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(24) as SchemaVersion | undefined;

    if (applied && hasColumn && hasIndex) return;

    if (!hasColumn) {
      this.db.run(`ALTER TABLE sdk_sessions ADD COLUMN platform_source TEXT NOT NULL DEFAULT '${DEFAULT_PLATFORM_SOURCE}'`);
      logger.debug('DB', 'Added platform_source column to sdk_sessions table');
    }

    this.db.run(`
      UPDATE sdk_sessions
      SET platform_source = '${DEFAULT_PLATFORM_SOURCE}'
      WHERE platform_source IS NULL OR platform_source = ''
    `);

    if (!hasIndex) {
      this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_platform_source ON sdk_sessions(platform_source)');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(24, new Date().toISOString());
  }

  private addObservationModelColumns(): void {
    const columns = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const hasGeneratedByModel = columns.some(col => col.name === 'generated_by_model');
    const hasRelevanceCount = columns.some(col => col.name === 'relevance_count');

    if (hasGeneratedByModel && hasRelevanceCount) return;

    if (!hasGeneratedByModel) {
      this.db.run('ALTER TABLE observations ADD COLUMN generated_by_model TEXT');
    }
    if (!hasRelevanceCount) {
      this.db.run('ALTER TABLE observations ADD COLUMN relevance_count INTEGER DEFAULT 0');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(26, new Date().toISOString());
  }

  private ensureMergedIntoProjectColumns(): void {
    const obsCols = this.db
      .query('PRAGMA table_info(observations)')
      .all() as TableColumnInfo[];
    if (!obsCols.some(c => c.name === 'merged_into_project')) {
      this.db.run('ALTER TABLE observations ADD COLUMN merged_into_project TEXT');
    }
    this.db.run(
      'CREATE INDEX IF NOT EXISTS idx_observations_merged_into ON observations(merged_into_project)'
    );

    const sumCols = this.db
      .query('PRAGMA table_info(session_summaries)')
      .all() as TableColumnInfo[];
    if (!sumCols.some(c => c.name === 'merged_into_project')) {
      this.db.run('ALTER TABLE session_summaries ADD COLUMN merged_into_project TEXT');
    }
    this.db.run(
      'CREATE INDEX IF NOT EXISTS idx_summaries_merged_into ON session_summaries(merged_into_project)'
    );
  }

  private addObservationSubagentColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(27) as SchemaVersion | undefined;

    const obsCols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const obsHasAgentType = obsCols.some(col => col.name === 'agent_type');
    const obsHasAgentId = obsCols.some(col => col.name === 'agent_id');

    if (!obsHasAgentType) {
      this.db.run('ALTER TABLE observations ADD COLUMN agent_type TEXT');
    }
    if (!obsHasAgentId) {
      this.db.run('ALTER TABLE observations ADD COLUMN agent_id TEXT');
    }
    this.db.run('CREATE INDEX IF NOT EXISTS idx_observations_agent_type ON observations(agent_type)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_observations_agent_id ON observations(agent_id)');

    const pendingCols = this.db.query('PRAGMA table_info(pending_messages)').all() as TableColumnInfo[];
    if (pendingCols.length > 0) {
      const pendingHasAgentType = pendingCols.some(col => col.name === 'agent_type');
      const pendingHasAgentId = pendingCols.some(col => col.name === 'agent_id');
      if (!pendingHasAgentType) {
        this.db.run('ALTER TABLE pending_messages ADD COLUMN agent_type TEXT');
      }
      if (!pendingHasAgentId) {
        this.db.run('ALTER TABLE pending_messages ADD COLUMN agent_id TEXT');
      }
    }

    if (!applied) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(27, new Date().toISOString());
    }
  }

  private ensurePendingMessagesToolUseIdColumn(): void {
    const tables = this.db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'"
    ).all() as TableNameRow[];
    if (tables.length === 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(28, new Date().toISOString());
      return;
    }

    const cols = this.db.query('PRAGMA table_info(pending_messages)').all() as TableColumnInfo[];
    const hasToolUseId = cols.some(c => c.name === 'tool_use_id');

    if (!hasToolUseId) {
      this.db.run('ALTER TABLE pending_messages ADD COLUMN tool_use_id TEXT');
    }

    this.db.run('BEGIN TRANSACTION');
    try {
      this.db.run(`
        DELETE FROM pending_messages
         WHERE id IN (
           SELECT id
             FROM (
               SELECT id,
                      ROW_NUMBER() OVER (
                        PARTITION BY session_db_id, tool_use_id
                        ORDER BY CASE status
                          WHEN 'processing' THEN 0
                          WHEN 'pending' THEN 1
                          ELSE 2
                        END, id
                      ) AS duplicate_rank
                 FROM pending_messages
                WHERE tool_use_id IS NOT NULL
             )
            WHERE duplicate_rank > 1
           )
      `);
      this.db.run(`
        -- tool_use_id is optional for summaries and legacy rows; enforce de-dupe
        -- only for rows that came from a concrete tool-use event.
        CREATE UNIQUE INDEX IF NOT EXISTS ux_pending_session_tool
        ON pending_messages(session_db_id, tool_use_id)
        WHERE tool_use_id IS NOT NULL
      `);

      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(28, new Date().toISOString());
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  private addObservationsUniqueContentHashIndex(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(29) as SchemaVersion | undefined;
    if (applied) return;

    const obsCols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const hasMem = obsCols.some(c => c.name === 'memory_session_id');
    const hasHash = obsCols.some(c => c.name === 'content_hash');
    if (!hasMem || !hasHash) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(29, new Date().toISOString());
      return;
    }

    this.db.run('BEGIN TRANSACTION');
    try {
      this.db.run(`
        UPDATE observations
           SET content_hash = '__null_migration_' || id || '__'
         WHERE content_hash IS NULL
      `);

      this.db.run(`
        DELETE FROM observations
         WHERE id IN (
           SELECT id
             FROM (
               SELECT id,
                      ROW_NUMBER() OVER (
                        PARTITION BY memory_session_id, content_hash
                        ORDER BY id
                      ) AS duplicate_rank
                 FROM observations
             )
            WHERE duplicate_rank > 1
         )
      `);
      this.db.run(`
        CREATE UNIQUE INDEX IF NOT EXISTS ux_observations_session_hash
        ON observations(memory_session_id, content_hash)
      `);
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(29, new Date().toISOString());
      this.db.run('COMMIT');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  private addObservationsMetadataColumn(): void {
    const cols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const hasColumn = cols.some(c => c.name === 'metadata');

    if (!hasColumn) {
      this.db.run('ALTER TABLE observations ADD COLUMN metadata TEXT');
      logger.debug('DB', 'Added metadata column to observations table (#2116)');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(30, new Date().toISOString());
  }

  updateMemorySessionId(sessionDbId: number, memorySessionId: string | null): void {
    this.db.prepare(`
      UPDATE sdk_sessions
      SET memory_session_id = ?
      WHERE id = ?
    `).run(memorySessionId, sessionDbId);
  }

  markSessionCompleted(sessionDbId: number): void {
    const nowEpoch = Date.now();
    const nowIso = new Date(nowEpoch).toISOString();
    this.db.prepare(`
      UPDATE sdk_sessions
      SET status = 'completed', completed_at = ?, completed_at_epoch = ?
      WHERE id = ?
    `).run(nowIso, nowEpoch, sessionDbId);
  }

  ensureMemorySessionIdRegistered(
    sessionDbId: number,
    memorySessionId: string,
    workerPort?: number
  ): void {
    const session = this.db.prepare(`
      SELECT id, memory_session_id, worker_port FROM sdk_sessions WHERE id = ?
    `).get(sessionDbId) as { id: number; memory_session_id: string | null; worker_port: number | null } | undefined;

    if (!session) {
      throw new Error(`Session ${sessionDbId} not found in sdk_sessions`);
    }

    if (session.memory_session_id !== memorySessionId) {
      this.db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?
      `).run(memorySessionId, sessionDbId);

      logger.info('DB', 'Registered memory_session_id before storage (FK fix)', {
        sessionDbId,
        oldId: session.memory_session_id,
        newId: memorySessionId
      });
    }

    // Session identity (#2533): record which worker owns this session before
    // any observation is accepted, so a row is never persisted for a session
    // whose identity is half-set. Only write when we have a port and it isn't
    // already recorded, to avoid churn on every storage round.
    if (typeof workerPort === 'number' && session.worker_port !== workerPort) {
      this.db.prepare(`
        UPDATE sdk_sessions SET worker_port = ? WHERE id = ?
      `).run(workerPort, sessionDbId);
    }
  }

  getRecentSummaries(project: string, limit: number = 10): Array<{
    request: string | null;
    investigated: string | null;
    learned: string | null;
    completed: string | null;
    next_steps: string | null;
    files_read: string | null;
    files_edited: string | null;
    notes: string | null;
    prompt_number: number | null;
    created_at: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `);

    return stmt.all(project, limit) as Array<{
      request: string | null;
      investigated: string | null;
      learned: string | null;
      completed: string | null;
      next_steps: string | null;
      files_read: string | null;
      files_edited: string | null;
      notes: string | null;
      prompt_number: number | null;
      created_at: string;
    }>;
  }

  getRecentSummariesWithSessionInfo(project: string, limit: number = 3): Array<{
    memory_session_id: string;
    request: string | null;
    learned: string | null;
    completed: string | null;
    next_steps: string | null;
    prompt_number: number | null;
    created_at: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        memory_session_id, request, learned, completed, next_steps,
        prompt_number, created_at
      FROM session_summaries
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `);

    return stmt.all(project, limit) as Array<{
      memory_session_id: string;
      request: string | null;
      learned: string | null;
      completed: string | null;
      next_steps: string | null;
      prompt_number: number | null;
      created_at: string;
    }>;
  }

  getRecentObservations(project: string, limit: number = 20): Array<{
    type: string;
    text: string;
    prompt_number: number | null;
    created_at: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT type, text, prompt_number, created_at
      FROM observations
      WHERE project = ?
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `);

    return stmt.all(project, limit) as Array<{
      type: string;
      text: string;
      prompt_number: number | null;
      created_at: string;
    }>;
  }

  getAllRecentObservations(limit: number = 100): Array<{
    id: number;
    type: string;
    title: string | null;
    subtitle: string | null;
    text: string;
    project: string;
    platform_source: string;
    prompt_number: number | null;
    created_at: string;
    created_at_epoch: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        o.id,
        o.type,
        o.title,
        o.subtitle,
        o.text,
        o.project,
        COALESCE(s.platform_source, '${DEFAULT_PLATFORM_SOURCE}') as platform_source,
        o.prompt_number,
        o.created_at,
        o.created_at_epoch
      FROM observations o
      LEFT JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      ORDER BY o.created_at_epoch DESC
      LIMIT ?
    `);

    return stmt.all(limit) as Array<{
      id: number;
      type: string;
      title: string | null;
      subtitle: string | null;
      text: string;
      project: string;
      platform_source: string;
      prompt_number: number | null;
      created_at: string;
      created_at_epoch: number;
    }>;
  }

  getAllRecentSummaries(limit: number = 50): Array<{
    id: number;
    request: string | null;
    investigated: string | null;
    learned: string | null;
    completed: string | null;
    next_steps: string | null;
    files_read: string | null;
    files_edited: string | null;
    notes: string | null;
    project: string;
    platform_source: string;
    prompt_number: number | null;
    created_at: string;
    created_at_epoch: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        ss.id,
        ss.request,
        ss.investigated,
        ss.learned,
        ss.completed,
        ss.next_steps,
        ss.files_read,
        ss.files_edited,
        ss.notes,
        ss.project,
        COALESCE(s.platform_source, '${DEFAULT_PLATFORM_SOURCE}') as platform_source,
        ss.prompt_number,
        ss.created_at,
        ss.created_at_epoch
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON ss.memory_session_id = s.memory_session_id
      ORDER BY ss.created_at_epoch DESC
      LIMIT ?
    `);

    return stmt.all(limit) as Array<{
      id: number;
      request: string | null;
      investigated: string | null;
      learned: string | null;
      completed: string | null;
      next_steps: string | null;
      files_read: string | null;
      files_edited: string | null;
      notes: string | null;
      project: string;
      platform_source: string;
      prompt_number: number | null;
      created_at: string;
      created_at_epoch: number;
    }>;
  }

  getAllRecentUserPrompts(limit: number = 100): Array<{
    id: number;
    content_session_id: string;
    project: string;
    platform_source: string;
    prompt_number: number;
    prompt_text: string;
    created_at: string;
    created_at_epoch: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        up.id,
        up.content_session_id,
        s.project,
        COALESCE(s.platform_source, '${DEFAULT_PLATFORM_SOURCE}') as platform_source,
        up.prompt_number,
        up.prompt_text,
        up.created_at,
        up.created_at_epoch
      FROM user_prompts up
      LEFT JOIN sdk_sessions s ON up.session_db_id = s.id
      ORDER BY up.created_at_epoch DESC
      LIMIT ?
    `);

    return stmt.all(limit) as Array<{
      id: number;
      content_session_id: string;
      project: string;
      platform_source: string;
      prompt_number: number;
      prompt_text: string;
      created_at: string;
      created_at_epoch: number;
    }>;
  }

  getAllProjects(platformSource?: string): string[] {
    const normalizedPlatformSource = platformSource ? normalizePlatformSource(platformSource) : undefined;
    let query = `
      SELECT DISTINCT project
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
    `;
    const params: SQLQueryBindings[] = [OBSERVER_SESSIONS_PROJECT];

    if (normalizedPlatformSource) {
      query += ' AND COALESCE(platform_source, ?) = ?';
      params.push(DEFAULT_PLATFORM_SOURCE, normalizedPlatformSource);
    }

    query += ' ORDER BY project ASC';

    const rows = this.db.prepare(query).all(...params) as Array<{ project: string }>;
    return rows.map(row => row.project);
  }

  getProjectCatalog(): {
    projects: string[];
    sources: string[];
    projectsBySource: Record<string, string[]>;
  } {
    const rows = this.db.prepare(`
      SELECT
        COALESCE(platform_source, '${DEFAULT_PLATFORM_SOURCE}') as platform_source,
        project,
        MAX(started_at_epoch) as latest_epoch
      FROM sdk_sessions
      WHERE project IS NOT NULL AND project != ''
        AND project != ?
      GROUP BY COALESCE(platform_source, '${DEFAULT_PLATFORM_SOURCE}'), project
      ORDER BY latest_epoch DESC
    `).all(OBSERVER_SESSIONS_PROJECT) as Array<{ platform_source: string; project: string; latest_epoch: number }>;

    const projects: string[] = [];
    const seenProjects = new Set<string>();
    const projectsBySource: Record<string, string[]> = {};

    for (const row of rows) {
      const source = normalizePlatformSource(row.platform_source);

      if (!projectsBySource[source]) {
        projectsBySource[source] = [];
      }

      if (!projectsBySource[source].includes(row.project)) {
        projectsBySource[source].push(row.project);
      }

      if (!seenProjects.has(row.project)) {
        seenProjects.add(row.project);
        projects.push(row.project);
      }
    }

    const sources = sortPlatformSources(Object.keys(projectsBySource));

    return {
      projects,
      sources,
      projectsBySource: Object.fromEntries(
        sources.map(source => [source, projectsBySource[source] || []])
      )
    };
  }

  getLatestUserPrompt(contentSessionId: string, sessionDbId?: number): {
    id: number;
    content_session_id: string;
    memory_session_id: string;
    project: string;
    platform_source: string;
    prompt_number: number;
    prompt_text: string;
    created_at_epoch: number;
  } | undefined {
    const resolvedSessionDbId = this.resolvePromptSessionDbId(contentSessionId, sessionDbId);
    const whereClause = resolvedSessionDbId !== null ? 'up.session_db_id = ?' : 'up.content_session_id = ?';
    const param = resolvedSessionDbId !== null ? resolvedSessionDbId : contentSessionId;
    const stmt = this.db.prepare(`
      SELECT
        up.*,
        s.memory_session_id,
        s.project,
        COALESCE(s.platform_source, '${DEFAULT_PLATFORM_SOURCE}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE ${whereClause}
      ORDER BY up.created_at_epoch DESC
      LIMIT 1
    `);

    return stmt.get(param) as LatestPromptResult | undefined;
  }

  findRecentDuplicateUserPrompt(
    contentSessionId: string,
    promptText: string,
    windowMs: number,
    sessionDbId?: number
  ): LatestPromptResult | undefined {
    return findRecentDuplicateUserPromptRecord(
      this.db,
      contentSessionId,
      normalizeStoredPromptText(promptText),
      windowMs,
      this.resolvePromptSessionDbId(contentSessionId, sessionDbId) ?? undefined
    );
  }

  getRecentSessionsWithStatus(project: string, limit: number = 3, platformSource?: string): Array<{
    memory_session_id: string | null;
    status: string;
    started_at: string;
    user_prompt: string | null;
    has_summary: boolean;
  }> {
    const params: any[] = [project];
    let platformClause = '';
    if (platformSource) {
      platformClause = `AND COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') = ?`;
      params.push(normalizePlatformSource(platformSource));
    }
    params.push(limit);

    const stmt = this.db.prepare(`
      SELECT * FROM (
        SELECT
          s.memory_session_id,
          s.status,
          s.started_at,
          s.started_at_epoch,
          s.user_prompt,
          CASE WHEN sum.memory_session_id IS NOT NULL THEN 1 ELSE 0 END as has_summary
        FROM sdk_sessions s
        LEFT JOIN session_summaries sum ON s.memory_session_id = sum.memory_session_id
        WHERE s.project = ? AND s.memory_session_id IS NOT NULL
        ${platformClause}
        GROUP BY s.memory_session_id
        ORDER BY s.started_at_epoch DESC
        LIMIT ?
      )
      ORDER BY started_at_epoch ASC
    `);

    return stmt.all(...params) as Array<{
      memory_session_id: string | null;
      status: string;
      started_at: string;
      user_prompt: string | null;
      has_summary: boolean;
    }>;
  }

  getObservationsForSession(memorySessionId: string, platformSource?: string): Array<{
    title: string;
    subtitle: string;
    type: string;
    prompt_number: number | null;
  }> {
    const params: any[] = [memorySessionId];
    let platformClause = '';
    if (platformSource) {
      platformClause = `
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions s
          WHERE s.memory_session_id = observations.memory_session_id
            AND COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') = ?
        )
      `;
      params.push(normalizePlatformSource(platformSource));
    }

    const stmt = this.db.prepare(`
      SELECT title, subtitle, type, prompt_number
      FROM observations
      WHERE memory_session_id = ?
      ${platformClause}
      ORDER BY created_at_epoch ASC
    `);

    return stmt.all(...params) as Array<{
      title: string;
      subtitle: string;
      type: string;
      prompt_number: number | null;
    }>;
  }

  getObservationById(id: number, platformSource?: string): ObservationRecord | null {
    if (!platformSource) {
      const stmt = this.db.prepare(`
        SELECT *
        FROM observations
        WHERE id = ?
      `);

      return stmt.get(id) as ObservationRecord | undefined || null;
    }

    const stmt = this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      WHERE o.id = ?
        AND COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') = ?
    `);

    return stmt.get(id, normalizePlatformSource(platformSource)) as ObservationRecord | undefined || null;
  }

  /**
   * Which of `ids` have the given origin, in the order they were given.
   *
   * The semantic leg of a hybrid search cannot filter by origin itself —
   * `vec_items` has no such column — so its candidates used to be cut down at
   * hydration, AFTER reciprocal-rank fusion had already capped the fused list
   * at 100. Measured: `sourceKind=curated` without a project filter returned 1
   * of 20 matching entries, because the unfiltered semantic candidates carry
   * three quarters of the fusion weight and filled the cap on their own. The
   * search still answered, and looked like the corpus simply held one match.
   *
   * Ids only, and in one statement: this runs over the whole candidate pool on
   * every filtered search, and hydrating a thousand rows to throw most of them
   * away is what the cap was avoiding in the first place. `json_each` rather
   * than a placeholder per id keeps that pool from bumping into the host
   * parameter limit as it grows.
   */
  filterObservationIdsBySourceKind(ids: number[], sourceKind: SourceKindFilter | undefined): number[] {
    const origin = sourceKindCondition(normalizeSourceKind(sourceKind), 'o');
    if (!origin || ids.length === 0) return ids;

    const rows = this.db.prepare(`
      SELECT o.id FROM observations o
      WHERE o.id IN (SELECT value FROM json_each(?)) AND ${origin.sql}
    `).all(JSON.stringify(ids), origin.param) as Array<{ id: number }>;

    const keep = new Set(rows.map(r => r.id));
    return ids.filter(id => keep.has(id));
  }

  getObservationsByIds(
    ids: number[],
    options: { orderBy?: 'date_desc' | 'date_asc' | 'relevance'; limit?: number; project?: string; platformSource?: string; type?: string | string[]; concepts?: string | string[]; files?: string | string[]; sourceKind?: SourceKindFilter } = {}
  ): ObservationSearchResult[] {
    if (ids.length === 0) return [];

    const { orderBy = 'date_desc', limit, project, platformSource, type, concepts, files, sourceKind } = options;
    const preserveIdOrder = orderBy === 'relevance';
    const orderClause = preserveIdOrder ? '' : `ORDER BY o.created_at_epoch ${orderBy === 'date_asc' ? 'ASC' : 'DESC'}`;
    const limitClause = limit && !preserveIdOrder ? `LIMIT ${limit}` : '';

    const placeholders = ids.map(() => '?').join(',');
    const params: any[] = [...ids];
    const additionalConditions: string[] = [];

    if (project) {
      additionalConditions.push('o.project = ?');
      params.push(project);
    }

    if (platformSource) {
      additionalConditions.push(`COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') = ?`);
      params.push(normalizePlatformSource(platformSource));
    }

    // Origin filter. This is the AUTHORITATIVE place it is applied on the
    // semantic path: the vector index has no source_kind column of its own, so
    // its candidates arrive unfiltered and are cut down here on hydration.
    const origin = sourceKindCondition(normalizeSourceKind(sourceKind), 'o');
    if (origin) {
      additionalConditions.push(origin.sql);
      params.push(origin.param);
    }

    if (type) {
      if (Array.isArray(type)) {
        const typePlaceholders = type.map(() => '?').join(',');
        additionalConditions.push(`o.type IN (${typePlaceholders})`);
        params.push(...type);
      } else {
        additionalConditions.push('o.type = ?');
        params.push(type);
      }
    }

    if (concepts) {
      const conceptsList = Array.isArray(concepts) ? concepts : [concepts];
      const conceptConditions = conceptsList.map(() =>
        'EXISTS (SELECT 1 FROM json_each(o.concepts) WHERE value = ?)'
      );
      params.push(...conceptsList);
      additionalConditions.push(`(${conceptConditions.join(' OR ')})`);
    }

    if (files) {
      const filesList = Array.isArray(files) ? files : [files];
      const fileConditions = filesList.map(() => {
        return '(EXISTS (SELECT 1 FROM json_each(o.files_read) WHERE value LIKE ?) OR EXISTS (SELECT 1 FROM json_each(o.files_modified) WHERE value LIKE ?))';
      });
      filesList.forEach(file => {
        params.push(`%${file}%`, `%${file}%`);
      });
      additionalConditions.push(`(${fileConditions.join(' OR ')})`);
    }

    const whereClause = additionalConditions.length > 0
      ? `WHERE o.id IN (${placeholders}) AND ${additionalConditions.join(' AND ')}`
      : `WHERE o.id IN (${placeholders})`;

    const stmt = this.db.prepare(`
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      ${whereClause}
      ${orderClause}
      ${limitClause}
    `);

    const rows = stmt.all(...params) as ObservationSearchResult[];
    if (!preserveIdOrder) return rows;

    const rowMap = new Map(rows.map(r => [r.id, r]));
    const ordered = ids.map(id => rowMap.get(id)).filter((r): r is ObservationSearchResult => !!r);
    return limit ? ordered.slice(0, limit) : ordered;
  }

  getSummaryForSession(memorySessionId: string, platformSource?: string): {
    request: string | null;
    investigated: string | null;
    learned: string | null;
    completed: string | null;
    next_steps: string | null;
    files_read: string | null;
    files_edited: string | null;
    notes: string | null;
    prompt_number: number | null;
    created_at: string;
    created_at_epoch: number;
  } | null {
    const params: any[] = [memorySessionId];
    let platformClause = '';
    if (platformSource) {
      platformClause = `
        AND EXISTS (
          SELECT 1
          FROM sdk_sessions sdk
          WHERE sdk.memory_session_id = session_summaries.memory_session_id
            AND COALESCE(NULLIF(sdk.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') = ?
        )
      `;
      params.push(normalizePlatformSource(platformSource));
    }

    const stmt = this.db.prepare(`
      SELECT
        request, investigated, learned, completed, next_steps,
        files_read, files_edited, notes, prompt_number, created_at,
        created_at_epoch
      FROM session_summaries
      WHERE memory_session_id = ?
      ${platformClause}
      ORDER BY created_at_epoch DESC
      LIMIT 1
    `);

    return (stmt.get(...params) as {
      request: string | null;
      investigated: string | null;
      learned: string | null;
      completed: string | null;
      next_steps: string | null;
      files_read: string | null;
      files_edited: string | null;
      notes: string | null;
      prompt_number: number | null;
      created_at: string;
      created_at_epoch: number;
    } | null) || null;
  }

  getFilesForSession(memorySessionId: string): {
    filesRead: string[];
    filesModified: string[];
  } {
    const stmt = this.db.prepare(`
      SELECT files_read, files_modified
      FROM observations
      WHERE memory_session_id = ?
    `);

    const rows = stmt.all(memorySessionId) as Array<{
      files_read: string | null;
      files_modified: string | null;
    }>;

    const filesReadSet = new Set<string>();
    const filesModifiedSet = new Set<string>();

    for (const row of rows) {
      parseFileList(row.files_read).forEach(f => filesReadSet.add(f));

      parseFileList(row.files_modified).forEach(f => filesModifiedSet.add(f));
    }

    return {
      filesRead: Array.from(filesReadSet),
      filesModified: Array.from(filesModifiedSet)
    };
  }

  getSessionById(id: number): {
    id: number;
    content_session_id: string;
    memory_session_id: string | null;
    project: string;
    platform_source: string;
    user_prompt: string;
    custom_title: string | null;
    status: string;
  } | null {
    const stmt = this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${DEFAULT_PLATFORM_SOURCE}') as platform_source,
             user_prompt, custom_title, status
      FROM sdk_sessions
      WHERE id = ?
      LIMIT 1
    `);

    return (stmt.get(id) as {
      id: number;
      content_session_id: string;
      memory_session_id: string | null;
      project: string;
      platform_source: string;
      user_prompt: string;
      custom_title: string | null;
      status: string;
    } | null) || null;
  }

  getSdkSessionsBySessionIds(memorySessionIds: string[]): {
    id: number;
    content_session_id: string;
    memory_session_id: string;
    project: string;
    platform_source: string;
    user_prompt: string;
    custom_title: string | null;
    started_at: string;
    started_at_epoch: number;
    completed_at: string | null;
    completed_at_epoch: number | null;
    status: string;
  }[] {
    if (memorySessionIds.length === 0) return [];

    const placeholders = memorySessionIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT id, content_session_id, memory_session_id, project,
             COALESCE(platform_source, '${DEFAULT_PLATFORM_SOURCE}') as platform_source,
             user_prompt, custom_title,
             started_at, started_at_epoch, completed_at, completed_at_epoch, status
      FROM sdk_sessions
      WHERE memory_session_id IN (${placeholders})
      ORDER BY started_at_epoch DESC
    `);

    return stmt.all(...memorySessionIds) as any[];
  }

  getPromptNumberFromUserPrompts(contentSessionId: string, sessionDbId?: number): number {
    const resolvedSessionDbId = this.resolvePromptSessionDbId(contentSessionId, sessionDbId);
    if (resolvedSessionDbId !== null) {
      const result = this.db.prepare(`
        SELECT COUNT(*) as count FROM user_prompts WHERE session_db_id = ?
      `).get(resolvedSessionDbId) as { count: number };
      return result.count;
    }

    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts WHERE content_session_id = ?
    `).get(contentSessionId) as { count: number };
    return result.count;
  }

  createSDKSession(
    contentSessionId: string,
    project: string,
    userPrompt: string,
    customTitle?: string,
    platformSource?: string
  ): number {
    const now = new Date();
    const nowEpoch = now.getTime();
    const resolved = resolveCreateSessionArgs(customTitle, platformSource);
    const normalizedPlatformSource = resolved.platformSource ?? DEFAULT_PLATFORM_SOURCE;
    const storedUserPrompt = this.rt(normalizeStoredPromptText(userPrompt));

    const existing = this.db.prepare(`
      SELECT id, platform_source
      FROM sdk_sessions
      WHERE COALESCE(NULLIF(platform_source, ''), ?) = ?
        AND content_session_id = ?
    `).get(DEFAULT_PLATFORM_SOURCE, normalizedPlatformSource, contentSessionId) as { id: number; platform_source: string | null } | undefined;

    if (existing) {
      if (project) {
        this.db.prepare(`
          UPDATE sdk_sessions SET project = ?
          WHERE id = ? AND (project IS NULL OR project = '')
        `).run(project, existing.id);
      }
      if (resolved.customTitle) {
        this.db.prepare(`
          UPDATE sdk_sessions SET custom_title = ?
          WHERE id = ? AND custom_title IS NULL
        `).run(resolved.customTitle, existing.id);
      }
      return existing.id;
    }

    const result = this.db.prepare(`
      INSERT INTO sdk_sessions
      (content_session_id, memory_session_id, project, platform_source, user_prompt, custom_title, started_at, started_at_epoch, status)
      VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'active')
    `).run(contentSessionId, project, normalizedPlatformSource, storedUserPrompt, resolved.customTitle || null, now.toISOString(), nowEpoch);

    return Number(result.lastInsertRowid);
  }

  saveUserPrompt(contentSessionId: string, promptNumber: number, promptText: string, sessionDbId?: number): number {
    const now = new Date();
    const nowEpoch = now.getTime();
    // Phase 4 / Step 1 — redact secrets from the user prompt before persistence.
    const storedPromptText = this.rt(normalizeStoredPromptText(promptText));
    const resolvedSessionDbId = this.resolvePromptSessionDbId(contentSessionId, sessionDbId);

    const stmt = this.db.prepare(`
      INSERT INTO user_prompts
      (session_db_id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(resolvedSessionDbId, contentSessionId, promptNumber, storedPromptText, now.toISOString(), nowEpoch);
    return result.lastInsertRowid as number;
  }

  getUserPrompt(contentSessionId: string, promptNumber: number, sessionDbId?: number): string | null {
    const resolvedSessionDbId = this.resolvePromptSessionDbId(contentSessionId, sessionDbId);
    if (resolvedSessionDbId !== null) {
      const result = this.db.prepare(`
        SELECT prompt_text
        FROM user_prompts
        WHERE session_db_id = ? AND prompt_number = ?
        LIMIT 1
      `).get(resolvedSessionDbId, promptNumber) as { prompt_text: string } | undefined;
      return result?.prompt_text ?? null;
    }

    const stmt = this.db.prepare(`
      SELECT prompt_text
      FROM user_prompts
      WHERE content_session_id = ? AND prompt_number = ?
      LIMIT 1
    `);

    const result = stmt.get(contentSessionId, promptNumber) as { prompt_text: string } | undefined;
    return result?.prompt_text ?? null;
  }

  storeObservation(
    memorySessionId: string,
    project: string,
    observation: {
      type: string;
      title: string | null;
      subtitle: string | null;
      facts: string[];
      narrative: string | null;
      concepts: string[];
      files_read: string[];
      files_modified: string[];
      agent_type?: string | null;
      agent_id?: string | null;
      metadata?: string | null;
      /**
       * 'curated' marks a row imported verbatim from a file the user owns.
       * It changes two things: the near-dup reconciler is skipped (see below),
       * and the A9 origin filter can separate these rows from observed ones.
       */
      source_kind?: string | null;
      /** Absolute path of the source file — half of every citation. */
      source_path?: string | null;
      /** 1-based line of the record's heading — the other half. */
      source_line?: number | null;
      /** What the row is about, carried for display. Never verified here. */
      subject?: string | null;
      /** Epoch millis when the owner last confirmed the row against reality. */
      last_verified_at?: number | null;
    },
    promptNumber?: number,
    discoveryTokens: number = 0,
    overrideTimestampEpoch?: number,
    generatedByModel?: string
  ): { id: number; createdAtEpoch: number } {
    const timestampEpoch = overrideTimestampEpoch ?? Date.now();
    const timestampIso = new Date(timestampEpoch).toISOString();

    // Curated content is stored VERBATIM — the write-path redaction is skipped
    // for it, deliberately.
    //
    // The on-write redaction exists to keep an accidental secret out of the
    // LOCAL database. Curated rows are different on both counts. They carry a
    // person's hand-written archive that is answered from as if it were current,
    // so the exact wording is the value — and, the load-bearing half, they NEVER
    // reach a provider: the observation queue is the only thing in keepmind that
    // calls a model, and no curated path enqueues (two Proxy tests enforce it).
    // The network is therefore already protected without touching the stored
    // row, and if a curated row is ever sent to a provider AS CONTEXT the
    // outbound redaction in src/sdk/prompts.ts still guards that copy — this only
    // keeps the STORED row exact.
    //
    // Left in, the entropy backstop's deliberate over-redaction ("false-positives
    // are acceptable" where readability is the only cost) is NOT acceptable here:
    // it masks structured metadata such as `aus=DURCHGANG-BEFUNDE.md#s1-5` as
    // «redacted:HIGH_ENTROPY», which is SHORTER than the original, so the stored
    // event log stops matching the file byte for byte. `curated:verify` compares
    // the stored log against the file AS TEXT and then reports the corpus
    // INCOMPLETE — permanently, because re-importing re-masks the same tokens.
    //
    // A CHECKPOINT is the exception. It is stored `source_kind='curated'` too —
    // to keep the reconciler away and to be injected verbatim next session — but
    // it carries no verbatim CONTRACT: there is no source file, `curated:verify`
    // never byte-compares it, and its text is a summary OF a session, which is
    // the one curated shape where a secret the session touched could ride along.
    // Verbatim reproduction is owed to the imported/authored archive, not to a
    // generated hand-off, so a checkpoint keeps the on-write scrub. (The
    // reconciler skip below is broader — EVERY curated row, checkpoint included,
    // states its own relations and must stay away from the guessing decider.)
    const isCurated = observation.source_kind === 'curated';
    const storeVerbatim = isCurated && observation.type !== CHECKPOINT_TYPE;

    // Phase 4 / Step 1 — redact secrets BEFORE hashing so dedup keys are stable
    // over redacted text (no leak via hash divergence). Verbatim curated content
    // bypasses both — see above.
    const rTitle = storeVerbatim ? observation.title : this.rt(observation.title);
    const rSubtitle = storeVerbatim ? observation.subtitle : this.rt(observation.subtitle);
    const rNarrative = storeVerbatim ? observation.narrative : this.rt(observation.narrative);
    const rFacts = storeVerbatim ? observation.facts : this.rl(observation.facts);
    const rMetadata = storeVerbatim
      ? (observation.metadata ?? null)
      : this.rt(observation.metadata ?? null);

    const contentHash = computeObservationContentHash(memorySessionId, rTitle ?? null, rNarrative ?? null);

    // Phase 4 / Step 3 — heuristic importance computed over redacted content.
    const importance = defaultImportance({ type: observation.type, narrative: rNarrative, files_modified: observation.files_modified });

    // Phase 4 / Step 4 — optional near-dup reconciliation (default OFF). On NOOP
    // we reuse the existing row; on UPDATE we insert then close the old window.
    let pendingSupersedeId: number | undefined;
    // Curated rows never reach the reconciler. It decides supersession from
    // trigram and token similarity — it GUESSES the relation — and a curated
    // corpus states its relations outright ("löst 0093 ab"). Letting it run
    // here would invent edges beside the declared ones and silently fold two
    // records onto one another; the bi-temporal columns are worth reusing, the
    // decider behind them is not. Curated supersession is written from the
    // declared note instead.
    if (this.mq.reconcile.enabled && !isCurated) {
      const decision = this.reconcileBeforeInsert(project, observation.type, rTitle ?? null, rNarrative ?? null);
      if (decision.action === 'NOOP' && decision.candidateId) {
        const existing = this.db.prepare('SELECT id, created_at_epoch FROM observations WHERE id = ?').get(decision.candidateId) as { id: number; created_at_epoch: number } | undefined;
        if (existing) return { id: existing.id, createdAtEpoch: existing.created_at_epoch };
      } else if (decision.action === 'UPDATE') {
        pendingSupersedeId = decision.candidateId;
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
       generated_by_model, metadata, importance, valid_from, subject_key,
       source_kind, source_path, source_line, subject, last_verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_session_id, content_hash) DO NOTHING
      RETURNING id, created_at_epoch
    `);

    const inserted = stmt.get(
      memorySessionId,
      project,
      observation.type,
      rTitle,
      rSubtitle,
      JSON.stringify(rFacts),
      rNarrative,
      JSON.stringify(observation.concepts),
      JSON.stringify(observation.files_read),
      JSON.stringify(observation.files_modified),
      promptNumber || null,
      discoveryTokens,
      observation.agent_type ?? null,
      observation.agent_id ?? null,
      contentHash,
      timestampIso,
      timestampEpoch,
      generatedByModel || null,
      rMetadata,
      importance,
      timestampEpoch,
      subjectKey({ title: rTitle ?? null, facts: rFacts, narrative: rNarrative ?? null }),
      observation.source_kind ?? null,
      observation.source_path ?? null,
      observation.source_line ?? null,
      observation.subject ?? null,
      observation.last_verified_at ?? null
    ) as { id: number; created_at_epoch: number } | null;

    if (inserted) {
      // Phase 4 / Step 5 — close the superseded row's validity window (soft).
      if (pendingSupersedeId !== undefined && this.mq.supersession.enabled) {
        this.supersedeObservation(pendingSupersedeId, inserted.id, timestampEpoch);
      }
      return { id: inserted.id, createdAtEpoch: inserted.created_at_epoch };
    }

    const existing = this.db.prepare(
      'SELECT id, created_at_epoch FROM observations WHERE memory_session_id = ? AND content_hash = ?'
    ).get(memorySessionId, contentHash) as { id: number; created_at_epoch: number } | null;

    if (!existing) {
      throw new Error(
        `storeObservation: ON CONFLICT without existing row for content_hash=${contentHash}`
      );
    }
    return { id: existing.id, createdAtEpoch: existing.created_at_epoch };
  }

  storeSummary(
    memorySessionId: string,
    project: string,
    summary: {
      request: string;
      investigated: string;
      learned: string;
      completed: string;
      next_steps: string;
      notes: string | null;
    },
    promptNumber?: number,
    discoveryTokens: number = 0,
    overrideTimestampEpoch?: number
  ): { id: number; createdAtEpoch: number } {
    const timestampEpoch = overrideTimestampEpoch ?? Date.now();
    const timestampIso = new Date(timestampEpoch).toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO session_summaries
      (memory_session_id, project, request, investigated, learned, completed,
       next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      memorySessionId,
      project,
      this.rt(summary.request),
      this.rt(summary.investigated),
      this.rt(summary.learned),
      this.rt(summary.completed),
      this.rt(summary.next_steps),
      this.rt(summary.notes),
      promptNumber || null,
      discoveryTokens,
      timestampIso,
      timestampEpoch
    );

    return {
      id: Number(result.lastInsertRowid),
      createdAtEpoch: timestampEpoch
    };
  }

  storeObservations(
    memorySessionId: string,
    project: string,
    observations: Array<{
      type: string;
      title: string | null;
      subtitle: string | null;
      facts: string[];
      narrative: string | null;
      concepts: string[];
      files_read: string[];
      files_modified: string[];
      agent_type?: string | null;
      agent_id?: string | null;
    }>,
    summary: {
      request: string;
      investigated: string;
      learned: string;
      completed: string;
      next_steps: string;
      notes: string | null;
    } | null,
    promptNumber?: number,
    discoveryTokens: number = 0,
    overrideTimestampEpoch?: number,
    generatedByModel?: string
  ): { observationIds: number[]; summaryId: number | null; createdAtEpoch: number } {
    const timestampEpoch = overrideTimestampEpoch ?? Date.now();
    const timestampIso = new Date(timestampEpoch).toISOString();

    const storeTx = this.db.transaction(() => {
      const observationIds: number[] = [];

      const obsStmt = this.db.prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, agent_type, agent_id, content_hash, created_at, created_at_epoch,
         generated_by_model, importance, valid_from, subject_key)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_session_id, content_hash) DO NOTHING
        RETURNING id
      `);
      const lookupExistingStmt = this.db.prepare(
        'SELECT id FROM observations WHERE memory_session_id = ? AND content_hash = ?'
      );

      for (const observation of observations) {
        // Phase 4 / Step 1 — redact before hashing (same chokepoint as single-obs path).
        const rTitle = this.rt(observation.title);
        const rSubtitle = this.rt(observation.subtitle);
        const rNarrative = this.rt(observation.narrative);
        const rFacts = this.rl(observation.facts);
        const contentHash = computeObservationContentHash(memorySessionId, rTitle ?? null, rNarrative ?? null);
        const inserted = obsStmt.get(
          memorySessionId,
          project,
          observation.type,
          rTitle,
          rSubtitle,
          JSON.stringify(rFacts),
          rNarrative,
          JSON.stringify(observation.concepts),
          JSON.stringify(observation.files_read),
          JSON.stringify(observation.files_modified),
          promptNumber || null,
          discoveryTokens,
          observation.agent_type ?? null,
          observation.agent_id ?? null,
          contentHash,
          timestampIso,
          timestampEpoch,
          generatedByModel || null,
          defaultImportance({ type: observation.type, narrative: rNarrative, files_modified: observation.files_modified }),
          timestampEpoch,
          subjectKey({ title: rTitle ?? null, facts: rFacts, narrative: rNarrative ?? null })
        ) as { id: number } | null;

        if (inserted) {
          observationIds.push(inserted.id);
          continue;
        }

        const existing = lookupExistingStmt.get(memorySessionId, contentHash) as { id: number } | null;
        if (!existing) {
          throw new Error(
            `storeObservations: ON CONFLICT without existing row for content_hash=${contentHash}`
          );
        }
        observationIds.push(existing.id);
      }

      let summaryId: number | null = null;
      if (summary) {
        const summaryStmt = this.db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed,
           next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = summaryStmt.run(
          memorySessionId,
          project,
          this.rt(summary.request),
          this.rt(summary.investigated),
          this.rt(summary.learned),
          this.rt(summary.completed),
          this.rt(summary.next_steps),
          this.rt(summary.notes),
          promptNumber || null,
          discoveryTokens,
          timestampIso,
          timestampEpoch
        );
        summaryId = Number(result.lastInsertRowid);
      }

      return { observationIds, summaryId, createdAtEpoch: timestampEpoch };
    });

    return storeTx();
  }

  /**
   * Record that these observations were actually delivered to a model: bump
   * `last_used_at` (the expiry "timer reset on use") and increment
   * `relevance_count`. Idempotent + bounded.
   *
   * Both columns existed but were effectively dead: `relevance_count` was never
   * incremented anywhere, and `last_used_at` was only written when expiry was
   * already enabled. So the two fields that are supposed to tell us which
   * memories earn their keep read 0/NULL for every row — which also made them
   * useless as evidence for *whether* to enable expiry, and would have let
   * expiry archive rows that are being read every day. Writing them
   * unconditionally is cheap and must precede any retention decision.
   */
  markObservationsUsed(ids: number[], channel: UsageChannel = 'explicit_fetch', now: number = Date.now()): void {
    if (ids.length === 0) return;
    try {
      const cols = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
      const has = (n: string) => cols.some(c => c.name === n);
      const hasLastUsed = has('last_used_at');
      const hasRelevance = has('relevance_count');
      const channelColumn = USAGE_CHANNEL_COLUMNS[channel];
      const hasChannel = has(channelColumn);
      if (!hasLastUsed && !hasRelevance && !hasChannel) return;

      const assignments: string[] = [];
      const params: SQLQueryBindings[] = [];
      if (hasLastUsed) {
        // Every channel resets the expiry timer. Only injection and explicit
        // fetches used to, so an observation that search found every day still
        // aged out as untouched — a latent data-loss bug that would only have
        // bitten once expiry was switched on.
        assignments.push('last_used_at = ?');
        params.push(now);
      }
      if (hasRelevance) {
        // Kept as the total across all channels. Values written before schema
        // v39 counted injection + explicit fetch only.
        assignments.push('relevance_count = COALESCE(relevance_count, 0) + 1');
      }
      if (hasChannel) {
        assignments.push(`${channelColumn} = COALESCE(${channelColumn}, 0) + 1`);
      }

      const placeholders = ids.map(() => '?').join(',');
      this.db
        .prepare(`UPDATE observations SET ${assignments.join(', ')} WHERE id IN (${placeholders})`)
        .run(...params, ...ids);
    } catch (error) {
      logger.debug('DB', 'markObservationsUsed failed', { count: ids.length, channel }, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Phase 4 / Step 6 — evaporate session-scoped scratch observations at
   * SessionEnd. Returns the number removed.
   */
  evaporateScratch(memorySessionId: string): number {
    try {
      const res = this.db.prepare("DELETE FROM observations WHERE memory_session_id = ? AND type = 'scratch'").run(memorySessionId);
      const n = Number(res.changes ?? 0);
      if (n > 0) logger.info('DB', 'Evaporated scratch observations at SessionEnd', { memorySessionId, count: n });
      return n;
    } catch (error) {
      logger.warn('DB', 'evaporateScratch failed', { memorySessionId }, error instanceof Error ? error : new Error(String(error)));
      return 0;
    }
  }

  /**
   * Evaporate ALL ephemeral scratch observations. Called on idle shutdown, when
   * no session is active — this replaces the per-session evaporation that used to
   * run on the (now-removed) SessionEnd hook, so scratch working-memory rows
   * don't accumulate across the worker's lifetime.
   */
  evaporateAllScratch(): number {
    try {
      const res = this.db.prepare("DELETE FROM observations WHERE type = 'scratch'").run();
      const n = Number(res.changes ?? 0);
      if (n > 0) logger.info('DB', 'Evaporated all scratch observations on idle shutdown', { count: n });
      return n;
    } catch (error) {
      logger.warn('DB', 'evaporateAllScratch failed', {}, error instanceof Error ? error : new Error(String(error)));
      return 0;
    }
  }

  /**
   * Phase 4 / Step 4 — heuristic near-dup reconciliation on the write path.
   * Returns a decision against same-project recent candidates. NEVER deletes.
   * Only consulted when memoryQuality.reconcile.enabled. On NOOP the caller
   * skips the insert and reuses the candidate row.
   */
  private reconcileBeforeInsert(
    project: string,
    type: string,
    title: string | null,
    narrative: string | null
  ): { action: 'ADD' | 'NOOP' | 'UPDATE'; candidateId?: number } {
    try {
      const ninetyDaysAgo = Date.now() - 90 * 86_400_000;
      // Only consider currently-valid rows when the supersession window column
      // exists; otherwise fall back to all recent same-project rows.
      const hasValidTo = (this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[]).some(c => c.name === 'valid_to');
      const validClause = hasValidTo ? 'AND valid_to IS NULL' : '';
      const candidates = this.db.prepare(`
        SELECT id, title, narrative, importance
        FROM observations
        WHERE project = ? AND type = ? AND created_at_epoch >= ? ${validClause}
        ORDER BY created_at_epoch DESC
        LIMIT 20
      `).all(project, type, ninetyDaysAgo) as ReconcileCandidate[];

      if (candidates.length === 0) return { action: 'ADD' };

      const supersessionEnabled = this.mq.supersession.enabled && hasValidTo;
      const decision = reconcileObservation(
        { title, narrative },
        candidates,
        {
          noopThreshold: this.mq.reconcile.noopThreshold,
          updateBand: this.mq.reconcile.updateBand,
          supersessionEnabled,
        }
      );
      return decision;
    } catch (error) {
      logger.warn('DB', 'reconcileBeforeInsert failed; defaulting to ADD', { project, type }, error instanceof Error ? error : new Error(String(error)));
      return { action: 'ADD' };
    }
  }

  /**
   * Phase 4 / Step 5 — close the validity window of a superseded observation
   * instead of deleting it (bi-temporal). Records the superseding row id.
   */
  private supersedeObservation(oldId: number, newId: number, now: number): void {
    try {
      this.db.prepare(`
        UPDATE observations
           SET valid_to = ?,
               metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by', ?)
         WHERE id = ? AND valid_to IS NULL
      `).run(now, newId, oldId);
    } catch (error) {
      logger.warn('DB', 'supersedeObservation failed', { oldId, newId }, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Phase 4 / Step 5 — point-in-time query: observations valid at `asOfEpoch`.
   */
  getObservationsAsOf(project: string, asOfEpoch: number): ObservationRecord[] {
    const hasValidFrom = (this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[]).some(c => c.name === 'valid_from');
    if (!hasValidFrom) {
      return this.db.prepare('SELECT * FROM observations WHERE project = ?').all(project) as ObservationRecord[];
    }
    return this.db.prepare(`
      SELECT * FROM observations
      WHERE project = ?
        AND COALESCE(valid_from, created_at_epoch) <= ?
        AND (valid_to IS NULL OR valid_to > ?)
    `).all(project, asOfEpoch, asOfEpoch) as ObservationRecord[];
  }

  /**
   * Persist a curated session checkpoint — the hand-off block injected at the
   * top of the next SessionStart for this project.
   *
   * Exactly ONE checkpoint stays active per project. The row is written through
   * the ordinary `storeObservation` path (so it is redacted, hashed and stamped
   * with `source_kind='curated'` — which keeps the near-dup reconciler away from
   * it), then every OTHER still-open checkpoint for the project has its validity
   * window closed. Idempotent: saving byte-identical text reuses the existing
   * row (content-hash dedup) and re-activates it, so re-running `/checkpoint`
   * never leaves two batons standing.
   *
   * Unlike the imported/authored corpus, a checkpoint DOES keep the on-write
   * secret scrub: it is a summary of a session (a secret the session touched
   * could ride along) and carries no verbatim contract — nothing byte-compares
   * it against a source file. See the `storeVerbatim` gate in `storeObservation`.
   */
  storeCheckpoint(
    project: string,
    text: string,
    opts: { title?: string | null; focus?: string | null; generatedByModel?: string | null } = {}
  ): { id: number; createdAtEpoch: number } {
    const memorySessionId = this.getOrCreateManualSession(project);
    const now = Date.now();

    const title = opts.title && opts.title.trim()
      ? opts.title.trim()
      : deriveCheckpointTitle(text);

    const metadata: Record<string, unknown> = { checkpoint: true };
    if (opts.focus && opts.focus.trim()) metadata.focus = opts.focus.trim();

    const stored = this.storeObservation(
      memorySessionId,
      project,
      {
        type: CHECKPOINT_TYPE,
        title,
        subtitle: 'Session checkpoint',
        facts: [],
        narrative: text,
        concepts: [],
        files_read: [],
        files_modified: [],
        metadata: JSON.stringify(metadata),
        source_kind: 'curated',
      },
      0,
      0,
      now,
      opts.generatedByModel ?? undefined
    );

    // Re-activate the row we just stored. A brand-new row is already active;
    // this only matters when identical text dedup'd onto a checkpoint that a
    // later save had already superseded — without this it would stay closed.
    this.db.prepare(`
      UPDATE observations
         SET valid_to = NULL,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.superseded_by_checkpoint')
       WHERE id = ? AND type = ?
    `).run(stored.id, CHECKPOINT_TYPE);

    // Close every other active checkpoint for the project — soft, bi-temporal,
    // pointing at the row that replaced it (mirrors supersedeObservation).
    this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.superseded_by_checkpoint', ?)
       WHERE project = ? AND type = ? AND valid_to IS NULL AND id != ?
    `).run(now, stored.id, project, CHECKPOINT_TYPE, stored.id);

    logger.info('DB', 'Saved session checkpoint', { id: stored.id, project, title });
    return stored;
  }

  /**
   * Retire the active checkpoint(s) for a project — the "erledigt → weg" path
   * ("no baton without an open point"). Soft-closes the window rather than
   * deleting, so the history stays inspectable. Returns how many were closed.
   */
  clearCheckpoint(project: string): { cleared: number } {
    const now = Date.now();
    const res = this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.checkpoint_cleared', 1)
       WHERE project = ? AND type = ? AND valid_to IS NULL
    `).run(now, project, CHECKPOINT_TYPE);
    const cleared = Number(res.changes ?? 0);
    logger.info('DB', 'Cleared session checkpoint(s)', { project, cleared });
    return { cleared };
  }

  // ───────────────────────────────────────────────────────────────────────
  // Directly authored curated records — created and CHANGED inside keepmind,
  // with no source file. See src/services/curated/authoring.ts for why the
  // text is rendered and read back through the file importer's own reader
  // rather than parsed a second way.
  //
  // The identity of such an entry is its RECORD NUMBER, not its row id. A
  // change writes a new revision and closes the previous one's validity
  // window — so the history survives (the curated path's "nothing is ever
  // deleted" invariant) while the SURFACE stays at exactly one row per
  // record. Everything that reads current state already filters on
  // `valid_to IS NULL`, so no read path had to learn about revisions.
  // ───────────────────────────────────────────────────────────────────────

  /** Marker on a revision that a later revision of the same record replaced. */

  /**
   * The active revision of one curated record, or null.
   *
   * Matched on `metadata.record_id` rather than on the title: the title is
   * display text and has been reformatted before (the same reason
   * supersession.ts reads the number out of metadata).
   */
  getCuratedRecord(
    project: string,
    recordId: string,
    opts: { includeClosed?: boolean } = {},
  ): {
    id: number; project: string; record_id: string; title: string | null; subtitle: string | null;
    narrative: string | null; metadata: string | null; source_path: string | null;
    source_line: number | null; valid_from: number | null; valid_to: number | null;
    created_at_epoch: number;
    /** `akte` (a decision) or `vorgang` (an open item) — never inferred by the caller. */
    kind: CuratedKindLabel;
  } | null {
    // `includeClosed` answers a different question: not "what does this record
    // currently say" but "does this record exist at all". An edit needs the
    // second — refusing to edit a retired record would make its text
    // permanently uncorrectable, and creating it fresh instead would resurrect
    // it. The ordering puts the active revision first when there is one.
    const activeOnly = opts.includeClosed ? '' : 'AND valid_to IS NULL';
    const row = this.db.prepare(`
      SELECT id, project, ${CURATED_ID_SQL} AS record_id,
             title, subtitle, narrative, metadata, source_path, source_line,
             valid_from, valid_to, created_at_epoch
        FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${CURATED_ID_SQL} = ?
         ${activeOnly}
       ORDER BY (valid_to IS NULL) DESC, created_at_epoch DESC, id DESC
       LIMIT 1
    `).get(project, recordId) as { metadata: string | null; record_id: string | null } | undefined;
    if (!row) return null;
    // What it IS travels with it. The two namespaces share this lookup on
    // purpose; what must never blur is the answer to "is this a decision or an
    // open item", and a caller that only ever sees the text cannot tell.
    return { ...row, kind: curatedKindOfRow(row.metadata, row.record_id) } as never;
  }

  /**
   * Every declared relation touching one record, from BOTH ends.
   *
   * An edge is stored once, in the direction the record wrote it. That is
   * correct — only one end declared anything — but it means a record can only
   * be asked what IT said, and the far end of every edge is unreachable. The
   * consequence is not subtle: `0090` was superseded by `0138`, the store knew
   * it, `decision_edges` had carried an `idx_edges_to` index for it since the
   * table was created, and every read path answered `0090` without mentioning
   * it. A retired record that does not say it was retired reads as current.
   *
   * `direction` is derived here rather than by the caller so that "which way
   * does this point" is answered once. Both namespaces are matched, because an
   * edge may name a work item (`V-0001`) as readily as a decision.
   */
  getCuratedRelations(project: string, recordId: string): Array<{
    direction: 'outgoing' | 'incoming';
    other: string;
    relation: string;
    certainty: string;
    source_path: string;
    source_line: number;
    raw_text: string | null;
  }> {
    return this.db.prepare(`
      SELECT 'outgoing' AS direction, to_record AS other,
             relation, certainty, source_path, source_line, raw_text
        FROM decision_edges
       WHERE project = ? AND from_record = ?
      UNION ALL
      SELECT 'incoming' AS direction, from_record AS other,
             relation, certainty, source_path, source_line, raw_text
        FROM decision_edges
       WHERE project = ? AND to_record = ?
       ORDER BY direction, relation, other
    `).all(project, recordId, project, recordId) as never;
  }

  /**
   * Every revision of one record, newest first — the history the bi-temporal
   * columns exist to carry. Closed revisions are included by definition; that
   * is what makes this different from `getCuratedRecord`.
   */
  getCuratedRevisions(project: string, recordId: string): Array<{
    id: number; title: string | null; narrative: string | null; metadata: string | null;
    valid_from: number | null; valid_to: number | null; created_at_epoch: number;
  }> {
    return this.db.prepare(`
      SELECT id, title, narrative, metadata, valid_from, valid_to, created_at_epoch
        FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${CURATED_ID_SQL} = ?
       ORDER BY created_at_epoch DESC, id DESC
    `).all(project, recordId) as never;
  }

  /**
   * Projects that already hold curated rows.
   *
   * The unattended import uses this to answer "where does this corpus go?"
   * without guessing: exactly one such project is an observed fact about the
   * store, several are a question only the operator can settle.
   */
  curatedProjects(): string[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT project FROM observations
       WHERE source_kind = 'curated' AND project IS NOT NULL AND project != ''
       ORDER BY project ASC
    `).all() as Array<{ project: string }>;
    return rows.map(row => String(row.project));
  }

  /**
   * Make the row a file import just wrote the ONE active revision of its entry
   * — unless an entry authored here holds the number, in which case leave that
   * one in force and say so.
   *
   * WHY THE FILE IMPORTERS NEED THIS. Direct authoring goes through
   * `storeCuratedRecord`, which settles the revisions as part of the write.
   * The file importers do not: they call `storeObservation`, whose
   * de-duplication is by wording — so an UNCHANGED file reuses its row (right)
   * while a CHANGED one inserts a second row and leaves the first one active
   * (wrong). Measured: editing a record's file and re-importing left two rows
   * with `valid_to IS NULL`, holding both the old and the new wording on the
   * surface at once.
   *
   * Reads happen to survive that — `getCuratedRecord` takes the newest — but
   * the vector index does not: both rows are embedded, so the record answers
   * twice and the older answer wins as often as the ranker happens to prefer
   * it. "Exactly one revision per record has `valid_to IS NULL`" is the
   * invariant every curated read path is written against.
   *
   * RE-ACTIVATION IS PART OF THE JOB, and leaving it out cost an entry its
   * whole existence. De-duplication lands an unchanged file back on its own
   * row — INCLUDING a row some earlier edit had already closed. Closing every
   * other revision then left NONE active: measured on the sequence "import a
   * file, edit the record here, import again", `getCuratedRecord` answered
   * null about a record whose two revisions both sat in the table, readable,
   * with nothing deleted and nothing logged. The same trap is documented on
   * `storeCuratedRecord`; the file path simply never had the second half.
   *
   * AN AUTHORED REVISION IS NOT A STALE ONE. Re-activating alone would have
   * turned the vanishing into a silent revert — the file's older wording back
   * in force over the entry a person wrote HERE. Both halves of the acceptance
   * ("an authored entry must neither disappear nor be overwritten by the next
   * file import") fail on their own. So when the active revision was authored
   * here, this closes the file's row instead and reports `authoredWins`: two
   * independent claims on one number is not something an importer can settle,
   * and the corpus is mid-hand-over precisely when it happens.
   *
   * Nothing is deleted either way. A revision that loses keeps its text and
   * gets its window closed, marked with the revision that replaced it.
   */
  settleCuratedRevisions(
    project: string,
    curatedId: string,
    keepId: number,
    nowEpoch: number = Date.now(),
  ): { closed: number; reactivated: boolean; authoredWins: string | null } {
    const authored = this.db.prepare(`
      SELECT id, source_path FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${CURATED_ID_SQL} = ?
         AND valid_to IS NULL AND id != ?
         AND source_path LIKE '${AUTHORED_SOURCE_SCHEME}%'
       ORDER BY id DESC LIMIT 1
    `).get(project, curatedId, keepId) as { id: number; source_path: string } | undefined;

    if (authored) {
      // The file does not take the number. Its row is closed rather than left
      // active beside the authored one — two active revisions is the very
      // thing this method exists to rule out.
      this.db.prepare(`
        UPDATE observations
           SET valid_to = COALESCE(valid_to, ?),
               metadata = json_set(COALESCE(metadata, '{}'), '$.${REVISION_MARKER}', ?)
         WHERE id = ?
      `).run(nowEpoch, authored.id, keepId);
      return { closed: 0, reactivated: false, authoredWins: authored.source_path };
    }

    // Re-open the row just stored before closing the rest. Order matters: the
    // other direction leaves a window in which no revision is active, and a
    // failure in between would leave the entry unreachable.
    const reopened = this.db.prepare(`
      UPDATE observations
         SET valid_to = NULL,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.${REVISION_MARKER}')
       WHERE id = ? AND valid_to IS NOT NULL
    `).run(keepId) as { changes?: number };

    const result = this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.${REVISION_MARKER}', ?)
       WHERE project = ? AND source_kind = 'curated'
         AND ${CURATED_ID_SQL} = ?
         AND valid_to IS NULL AND id != ?
    `).run(nowEpoch, keepId, project, curatedId, keepId) as { changes?: number };
    return {
      closed: Number(result?.changes ?? 0),
      reactivated: Number(reopened?.changes ?? 0) > 0,
      authoredWins: null,
    };
  }

  /**
   * Close every OTHER active curated row that came from one source file.
   *
   * The id-based counterpart above cannot serve a source that carries no entry
   * number of its own — the work-item event log is one file for a whole
   * directory, and it is stored so its wording survives the file. A changed log
   * writes a new row, and this closes the one it replaced.
   */
  closeOtherCuratedRowsForSource(
    project: string,
    sourcePath: string,
    keepId: number,
    nowEpoch: number = Date.now(),
  ): { closed: number } {
    const result = this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.${REVISION_MARKER}', ?)
       WHERE project = ? AND source_kind = 'curated'
         AND source_path = ?
         AND valid_to IS NULL AND id != ?
    `).run(nowEpoch, keepId, project, sourcePath, keepId) as { changes?: number };
    return { closed: Number(result?.changes ?? 0) };
  }

  /**
   * Refresh the DERIVED parts of a stored curated row.
   *
   * WHY THIS IS NEEDED. `storeObservation` de-duplicates on (session, title,
   * narrative) — deliberately, so re-importing an unchanged file reuses its row
   * instead of stacking a revision that says the same thing. Metadata is not in
   * that key. For a work item that is precisely wrong: its state is derived
   * from `EREIGNISSE.log`, which moves without the item's own file changing at
   * all. Measured: an event log that moved an item to `wartet` produced an
   * import that REPORTED `wartet` while the stored row kept saying `unbekannt`
   * — the report and the store disagreeing, which is the failure this whole
   * path exists to prevent.
   *
   * Only derived fields move. The title and the narrative — the wording, the
   * part a person wrote — are not touched here, and nothing is deleted: the
   * event log remains the history of how the state got where it is.
   */
  refreshCuratedDerived(
    id: number,
    fields: { subtitle?: string | null; metadata?: string | null; lastVerifiedAt?: number | null },
  ): void {
    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    // Stored VERBATIM, matching the curated insert path — this method only ever
    // touches `source_kind='curated'` rows, which are not redacted on write (see
    // `storeObservation`). Redacting here would re-introduce the very masks the
    // insert avoids: the work-item metadata carries each event's raw log line
    // under `metadata.events[].raw`, and the entropy backstop masks structured
    // tokens in those lines (`aus=FILE.md#s1-5`), so a redacting refresh would
    // silently re-mangle the verbatim event history the row is meant to preserve.
    if (fields.subtitle !== undefined) { sets.push('subtitle = ?'); values.push(fields.subtitle ?? null); }
    if (fields.metadata !== undefined) { sets.push('metadata = ?'); values.push(fields.metadata ?? null); }
    if (fields.lastVerifiedAt !== undefined) { sets.push('last_verified_at = ?'); values.push(fields.lastVerifiedAt ?? null); }
    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE observations SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  /**
   * Every curated observation id in a project — retired revisions included.
   *
   * Used to check that the curated corpus is actually searchable. Closed and
   * superseded revisions are in the list on purpose: nothing on this path is
   * ever deleted, so "what did this say before it was replaced" has to stay
   * findable, and a revision that is in the store but not in the index is
   * exactly the kind of silent hole this list exists to expose.
   */
  curatedObservationIds(project: string): number[] {
    const rows = this.db.prepare(`
      SELECT id FROM observations
       WHERE project = ? AND source_kind = 'curated'
       ORDER BY id ASC
    `).all(project) as Array<{ id: number }>;
    return rows.map(row => Number(row.id));
  }

  /**
   * The next free record number in a project.
   *
   * Computed over EVERY curated row, retired and imported ones included. A
   * number that is free only because its record was superseded is not free:
   * every declared relation in the corpus names records by number, and reusing
   * one would silently re-point those edges at a different decision.
   */
  nextCuratedRecordId(project: string): string {
    const rows = this.db.prepare(`
      SELECT DISTINCT ${CURATED_ID_SQL} AS record_id
        FROM observations
       WHERE project = ? AND source_kind = 'curated'
         AND ${CURATED_ID_SQL} IS NOT NULL
    `).all(project) as Array<{ record_id: string | null }>;

    let max = 0;
    for (const row of rows) {
      const id = String(row.record_id ?? '');
      // `V-…` is the process namespace, not the decision namespace.
      if (!/^0\d{3}$/.test(id)) continue;
      const n = parseInt(id, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    const next = max + 1;
    if (next > 999) {
      // Said out loud rather than wrapped around: the edge reader recognises a
      // decision number only when it is zero-padded and four digits
      // (`isRecordNumber`), so 1000 would stop being a reference at all — and
      // it would stop silently, as a relation that simply never appears.
      throw new Error(
        `curated authoring: project "${project}" has reached record 0999. ` +
        `The edge reader only recognises zero-padded four-digit decision numbers, ` +
        `so the numbering cannot continue without widening relation-lexicon/edge-reader.`,
      );
    }
    return String(next).padStart(4, '0');
  }

  /**
   * Write one revision of a curated record and make it the current one.
   *
   * Mirrors `storeCheckpoint` deliberately — that pattern is already proven
   * against the idempotence trap here: identical text dedups onto an EXISTING
   * row via the content hash, and if that row happens to be a revision an
   * earlier edit had closed, it must be re-opened or the record would vanish
   * from the surface entirely. Order therefore matters: store, re-activate the
   * stored row, then close every OTHER revision of the same record.
   *
   * Goes through `storeObservation`, so the row is hashed, scored and stamped
   * exactly like an imported one — and, being `source_kind='curated'`, kept away
   * from the near-dup reconciler that would otherwise guess at relations the
   * record states outright AND stored VERBATIM: the authoring round-trip re-reads
   * the rendered text with `parseAkte`, so a masked token would not read back as
   * declared, and an authored record never reaches a provider anyway.
   */
  storeCuratedRecord(
    memorySessionId: string,
    project: string,
    record: {
      recordId: string;
      title: string;
      subtitle: string;
      narrative: string;
      metadata: string;
      sourcePath: string;
      sourceLine: number;
      subject: string;
      validFrom: number;
      validTo: number | null;
      lastVerifiedAt: number | null;
    },
    nowEpoch: number = Date.now(),
  ): { id: number; createdAtEpoch: number; revisionsClosed: number } {
    const stored = this.storeObservation(
      memorySessionId,
      project,
      {
        type: 'decision',
        title: record.title,
        subtitle: record.subtitle,
        facts: [],
        narrative: record.narrative,
        concepts: [],
        files_read: [],
        files_modified: [],
        metadata: record.metadata,
        source_kind: 'curated',
        source_path: record.sourcePath,
        source_line: record.sourceLine,
        subject: record.subject,
        last_verified_at: record.lastVerifiedAt,
      },
      0,
      0,
      nowEpoch,
    );

    // The author's own validity window. `storeObservation` stamps valid_from
    // with the write time and knows nothing about a declared one, so it is set
    // here — together with re-opening a revision that a previous edit closed.
    this.db.prepare(`
      UPDATE observations
         SET valid_from = ?,
             valid_to = ?,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.${REVISION_MARKER}')
       WHERE id = ?
    `).run(record.validFrom, record.validTo, stored.id);

    const closed = this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.${REVISION_MARKER}', ?)
       WHERE project = ? AND source_kind = 'curated'
         AND ${CURATED_ID_SQL} = ?
         AND valid_to IS NULL AND id != ?
    `).run(nowEpoch, stored.id, project, record.recordId, stored.id) as { changes?: number };

    return { ...stored, revisionsClosed: Number(closed?.changes ?? 0) };
  }

  /**
   * Retire a curated record by hand — "this no longer applies", with no
   * successor to point at.
   *
   * Distinct from supersession on purpose. `applySupersessions` recomputes its
   * work on every run: it first re-opens every window IT closed, then closes
   * them again from the current edges. A manual close carries a different
   * marker so that recomputation cannot silently undo it — a record the owner
   * retired must stay retired until the owner says otherwise, whatever the
   * graph does.
   */
  closeCuratedRecord(
    project: string,
    recordId: string,
    opts: { reason?: string | null; nowEpoch?: number } = {},
  ): { closed: number } {
    const now = opts.nowEpoch ?? Date.now();
    const res = this.db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(
               COALESCE(metadata, '{}'),
               '$.closed_by_author', 1,
               '$.closed_reason', ?
             )
       WHERE project = ? AND source_kind = 'curated'
         AND ${CURATED_ID_SQL} = ?
         AND valid_to IS NULL
    `).run(now, opts.reason ?? null, project, recordId) as { changes?: number };
    const closed = Number(res?.changes ?? 0);
    logger.info('DB', 'Closed curated record', { project, recordId, closed });
    return { closed };
  }

  /**
   * Re-open a record the author closed. Reported separately from supersession
   * for the same reason the close is: the two must not overwrite each other.
   */
  reopenCuratedRecord(project: string, recordId: string): { reopened: number } {
    const res = this.db.prepare(`
      UPDATE observations
         SET valid_to = NULL,
             metadata = json_remove(COALESCE(metadata, '{}'), '$.closed_by_author', '$.closed_reason')
       WHERE project = ? AND source_kind = 'curated'
         AND ${CURATED_ID_SQL} = ?
         AND json_extract(metadata, '$.closed_by_author') IS NOT NULL
    `).run(project, recordId) as { changes?: number };
    return { reopened: Number(res?.changes ?? 0) };
  }

  /**
   * Currently-active checkpoints for the given projects, newest first. At most
   * one per project by construction, but a project chain (worktrees / merged
   * projects) can surface several — the caller renders each, newest project on
   * top. Deliberately independent of the `injectSourceKind` origin filter: a
   * checkpoint is the session baton and always injects.
   */
  getActiveCheckpoints(projects: string[]): CheckpointRecord[] {
    if (projects.length === 0) return [];
    const placeholders = projects.map(() => '?').join(',');
    return this.db.prepare(`
      SELECT id, project, title, narrative, metadata, created_at, created_at_epoch
        FROM observations
       WHERE project IN (${placeholders})
         AND type = ?
         AND valid_to IS NULL
       ORDER BY created_at_epoch DESC
    `).all(...projects, CHECKPOINT_TYPE) as CheckpointRecord[];
  }

  /**
   * Phase 4 / Step 2 — delete all observations (and summaries) for a project.
   * Irreversible. `dryRun` returns the counts that WOULD be deleted without
   * touching anything. Refuses empty/`*` project. Leaves sdk_sessions intact.
   */
  deleteObservationsByProject(
    project: string,
    options: { dryRun?: boolean } = {}
  ): { project: string; dryRun: boolean; observationsDeleted: number; summariesDeleted: number; edgesDeleted: number } {
    const p = (project ?? '').trim();
    if (p === '' || p === '*') {
      throw new Error(`deleteObservationsByProject: refusing unsafe project '${project}'`);
    }

    const obsCount = (this.db.prepare('SELECT count(*) AS c FROM observations WHERE project = ?').get(p) as { c: number }).c;
    const sumCount = (this.db.prepare('SELECT count(*) AS c FROM session_summaries WHERE project = ?').get(p) as { c: number }).c;

    // Declared relations belong to the project too, and nothing else removes
    // them. Clearing a project and re-importing it used to leave every edge
    // from the previous import in place, still pointing at source files that
    // no longer exist — 197 of them, indistinguishable from live ones except
    // by their paths, and counted in every total. An orphaned edge is worse
    // than a missing one: it asserts a relation nobody can check.
    const hasEdges = (this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='decision_edges'")
      .all() as { name: string }[]).length > 0;
    const edgeCount = hasEdges
      ? (this.db.prepare('SELECT count(*) AS c FROM decision_edges WHERE project = ?').get(p) as { c: number }).c
      : 0;

    if (options.dryRun) {
      return { project: p, dryRun: true, observationsDeleted: obsCount, summariesDeleted: sumCount, edgesDeleted: edgeCount };
    }

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM observations WHERE project = ?').run(p);
      this.db.prepare('DELETE FROM session_summaries WHERE project = ?').run(p);
      if (edgeCount > 0) this.db.prepare('DELETE FROM decision_edges WHERE project = ?').run(p);
    });
    tx();

    // Keep the observations FTS index consistent if it exists (triggers may not
    // cascade for every historical schema).
    try {
      const hasFts = (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all() as { name: string }[]).length > 0;
      if (hasFts) {
        this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')");
      }
    } catch (error) {
      logger.warn('DB', 'observations_fts rebuild after project delete failed', { project: p }, error instanceof Error ? error : new Error(String(error)));
    }

    logger.info('DB', 'Deleted observations by project', { project: p, observationsDeleted: obsCount, summariesDeleted: sumCount, edgesDeleted: edgeCount });
    return { project: p, dryRun: false, observationsDeleted: obsCount, summariesDeleted: sumCount, edgesDeleted: edgeCount };
  }

  getSessionSummariesByIds(
    ids: number[],
    options: { orderBy?: 'date_desc' | 'date_asc' | 'relevance'; limit?: number; project?: string; platformSource?: string } = {}
  ): SessionSummarySearchResult[] {
    if (ids.length === 0) return [];

    const { orderBy = 'date_desc', limit, project, platformSource } = options;
    const preserveIdOrder = orderBy === 'relevance';
    const orderClause = preserveIdOrder ? '' : `ORDER BY ss.created_at_epoch ${orderBy === 'date_asc' ? 'ASC' : 'DESC'}`;
    const limitClause = limit && !preserveIdOrder ? `LIMIT ${limit}` : '';
    const placeholders = ids.map(() => '?').join(',');
    const params: any[] = [...ids];
    const additionalConditions: string[] = [];

    if (project) {
      additionalConditions.push('ss.project = ?');
      params.push(project);
    }

    if (platformSource) {
      additionalConditions.push(`COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') = ?`);
      params.push(normalizePlatformSource(platformSource));
    }

    const additionalFilter = additionalConditions.length > 0
      ? `AND ${additionalConditions.join(' AND ')}`
      : '';

    const stmt = this.db.prepare(`
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON s.memory_session_id = ss.memory_session_id
      WHERE ss.id IN (${placeholders}) ${additionalFilter}
      ${orderClause}
      ${limitClause}
    `);

    const rows = stmt.all(...params) as SessionSummarySearchResult[];
    if (!preserveIdOrder) return rows;

    const rowMap = new Map(rows.map(r => [r.id, r]));
    const ordered = ids.map(id => rowMap.get(id)).filter((r): r is SessionSummarySearchResult => !!r);
    return limit ? ordered.slice(0, limit) : ordered;
  }

  getUserPromptsByIds(
    ids: number[],
    options: { orderBy?: 'date_desc' | 'date_asc' | 'relevance'; limit?: number; project?: string; platformSource?: string } = {}
  ): UserPromptRecord[] {
    if (ids.length === 0) return [];

    const { orderBy = 'date_desc', limit, project, platformSource } = options;
    const preserveIdOrder = orderBy === 'relevance';
    const orderClause = preserveIdOrder ? '' : `ORDER BY up.created_at_epoch ${orderBy === 'date_asc' ? 'ASC' : 'DESC'}`;
    const limitClause = limit ? `LIMIT ${limit}` : '';
    const placeholders = ids.map(() => '?').join(',');
    const params: any[] = [...ids];
    const additionalConditions: string[] = [];

    if (project) {
      additionalConditions.push('s.project = ?');
      params.push(project);
    }

    if (platformSource) {
      additionalConditions.push(`COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') = ?`);
      params.push(normalizePlatformSource(platformSource));
    }

    const additionalFilter = additionalConditions.length > 0
      ? `AND ${additionalConditions.join(' AND ')}`
      : '';

    const stmt = this.db.prepare(`
      SELECT
        up.*,
        s.project,
        s.memory_session_id,
        COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.id IN (${placeholders}) ${additionalFilter}
      ${orderClause}
      ${limitClause}
    `);

    const rows = stmt.all(...params) as UserPromptRecord[];
    if (!preserveIdOrder) return rows;

    const rowMap = new Map(rows.map(r => [r.id, r]));
    return ids.map(id => rowMap.get(id)).filter((r): r is UserPromptRecord => !!r);
  }

  getTimelineAroundTimestamp(
    anchorEpoch: number,
    depthBefore: number = 10,
    depthAfter: number = 10,
    project?: string,
    platformSource?: string
  ): {
    observations: any[];
    sessions: any[];
    prompts: any[];
  } {
    return this.getTimelineAroundObservation(null, anchorEpoch, depthBefore, depthAfter, project, platformSource);
  }

  getTimelineAroundObservation(
    anchorObservationId: number | null,
    anchorEpoch: number,
    depthBefore: number = 10,
    depthAfter: number = 10,
    project?: string,
    platformSource?: string
  ): {
    observations: any[];
    sessions: any[];
    prompts: any[];
  } {
    const normalizedPlatformSource = platformSource ? normalizePlatformSource(platformSource) : undefined;
    const buildScope = (rowAlias: string, sessionAlias: string): { clause: string; params: any[] } => {
      const conditions: string[] = [];
      const params: any[] = [];

      if (project) {
        conditions.push(`${rowAlias}.project = ?`);
        params.push(project);
      }

      if (normalizedPlatformSource) {
        conditions.push(`COALESCE(NULLIF(${sessionAlias}.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') = ?`);
        params.push(normalizedPlatformSource);
      }

      return {
        clause: conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '',
        params
      };
    };
    const observationScope = buildScope('o', 'src');
    const summaryScope = buildScope('ss', 'src');
    const promptScope = buildScope('s', 's');

    let startEpoch: number;
    let endEpoch: number;

    if (anchorObservationId !== null) {
      const beforeQuery = `
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.id <= ? ${observationScope.clause}
        ORDER BY o.id DESC
        LIMIT ?
      `;
      const afterQuery = `
        SELECT o.id, o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.id >= ? ${observationScope.clause}
        ORDER BY o.id ASC
        LIMIT ?
      `;

      try {
        const beforeRecords = this.db.prepare(beforeQuery).all(anchorObservationId, ...observationScope.params, depthBefore + 1) as Array<{id: number; created_at_epoch: number}>;
        const afterRecords = this.db.prepare(afterQuery).all(anchorObservationId, ...observationScope.params, depthAfter + 1) as Array<{id: number; created_at_epoch: number}>;

        if (beforeRecords.length === 0 && afterRecords.length === 0) {
          return { observations: [], sessions: [], prompts: [] };
        }

        startEpoch = beforeRecords.length > 0 ? beforeRecords[beforeRecords.length - 1].created_at_epoch : anchorEpoch;
        endEpoch = afterRecords.length > 0 ? afterRecords[afterRecords.length - 1].created_at_epoch : anchorEpoch;
      } catch (err) {
        if (err instanceof Error) {
          logger.error('DB', 'Error getting boundary observations', { project }, err);
        } else {
          logger.error('DB', 'Error getting boundary observations with non-Error', {}, new Error(String(err)));
        }
        return { observations: [], sessions: [], prompts: [] };
      }
    } else {
      const beforeQuery = `
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch <= ? ${observationScope.clause}
        ORDER BY o.created_at_epoch DESC
        LIMIT ?
      `;
      const afterQuery = `
        SELECT o.created_at_epoch
        FROM observations o
        LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
        WHERE o.created_at_epoch >= ? ${observationScope.clause}
        ORDER BY o.created_at_epoch ASC
        LIMIT ?
      `;

      try {
        const beforeRecords = this.db.prepare(beforeQuery).all(anchorEpoch, ...observationScope.params, depthBefore) as Array<{created_at_epoch: number}>;
        const afterRecords = this.db.prepare(afterQuery).all(anchorEpoch, ...observationScope.params, depthAfter + 1) as Array<{created_at_epoch: number}>;

        if (beforeRecords.length === 0 && afterRecords.length === 0) {
          return { observations: [], sessions: [], prompts: [] };
        }

        startEpoch = beforeRecords.length > 0 ? beforeRecords[beforeRecords.length - 1].created_at_epoch : anchorEpoch;
        endEpoch = afterRecords.length > 0 ? afterRecords[afterRecords.length - 1].created_at_epoch : anchorEpoch;
      } catch (err) {
        if (err instanceof Error) {
          logger.error('DB', 'Error getting boundary timestamps', { project }, err);
        } else {
          logger.error('DB', 'Error getting boundary timestamps with non-Error', {}, new Error(String(err)));
        }
        return { observations: [], sessions: [], prompts: [] };
      }
    }

    const obsQuery = `
      SELECT o.*
      FROM observations o
      LEFT JOIN sdk_sessions src ON src.memory_session_id = o.memory_session_id
      WHERE o.created_at_epoch >= ? AND o.created_at_epoch <= ? ${observationScope.clause}
      ORDER BY o.created_at_epoch ASC
    `;

    const sessQuery = `
      SELECT ss.*
      FROM session_summaries ss
      LEFT JOIN sdk_sessions src ON src.memory_session_id = ss.memory_session_id
      WHERE ss.created_at_epoch >= ? AND ss.created_at_epoch <= ? ${summaryScope.clause}
      ORDER BY ss.created_at_epoch ASC
    `;

    const promptQuery = `
      SELECT up.*, s.project, s.memory_session_id, COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE up.created_at_epoch >= ? AND up.created_at_epoch <= ? ${promptScope.clause}
      ORDER BY up.created_at_epoch ASC
    `;

    const observations = this.db.prepare(obsQuery).all(startEpoch, endEpoch, ...observationScope.params) as ObservationRecord[];
    const sessions = this.db.prepare(sessQuery).all(startEpoch, endEpoch, ...summaryScope.params) as SessionSummaryRecord[];
    const prompts = this.db.prepare(promptQuery).all(startEpoch, endEpoch, ...promptScope.params) as UserPromptRecord[];

    return {
      observations,
      sessions: sessions.map(s => ({
        id: s.id,
        memory_session_id: s.memory_session_id,
        project: s.project,
        request: s.request,
        completed: s.completed,
        next_steps: s.next_steps,
        created_at: s.created_at,
        created_at_epoch: s.created_at_epoch
      })),
      prompts: prompts.map(p => ({
        id: p.id,
        content_session_id: p.content_session_id,
        prompt_number: p.prompt_number,
        prompt_text: p.prompt_text,
        project: p.project,
        platform_source: p.platform_source,
        created_at: p.created_at,
        created_at_epoch: p.created_at_epoch
      }))
    };
  }

  getPromptById(id: number): {
    id: number;
    content_session_id: string;
    prompt_number: number;
    prompt_text: string;
    project: string;
    created_at: string;
    created_at_epoch: number;
  } | null {
    const stmt = this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
	      FROM user_prompts p
	      LEFT JOIN sdk_sessions s ON p.session_db_id = s.id
	      WHERE p.id = ?
      LIMIT 1
    `);

    return (stmt.get(id) as {
      id: number;
      content_session_id: string;
      prompt_number: number;
      prompt_text: string;
      project: string;
      created_at: string;
      created_at_epoch: number;
    } | null) || null;
  }

  getPromptsByIds(ids: number[]): Array<{
    id: number;
    content_session_id: string;
    prompt_number: number;
    prompt_text: string;
    project: string;
    created_at: string;
    created_at_epoch: number;
  }> {
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT
        p.id,
        p.content_session_id,
        p.prompt_number,
        p.prompt_text,
        s.project,
        p.created_at,
        p.created_at_epoch
	      FROM user_prompts p
	      LEFT JOIN sdk_sessions s ON p.session_db_id = s.id
	      WHERE p.id IN (${placeholders})
      ORDER BY p.created_at_epoch DESC
    `);

    return stmt.all(...ids) as Array<{
      id: number;
      content_session_id: string;
      prompt_number: number;
      prompt_text: string;
      project: string;
      created_at: string;
      created_at_epoch: number;
    }>;
  }

  getOrCreateManualSession(project: string): string {
    const memorySessionId = `manual-${project}`;
    const contentSessionId = `manual-content-${project}`;

    const existing = this.db.prepare(
      'SELECT memory_session_id FROM sdk_sessions WHERE memory_session_id = ?'
    ).get(memorySessionId) as { memory_session_id: string } | undefined;

    if (existing) {
      return memorySessionId;
    }

    const now = new Date();
    this.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, content_session_id, project, platform_source, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(memorySessionId, contentSessionId, project, DEFAULT_PLATFORM_SOURCE, now.toISOString(), now.getTime());

    logger.info('SESSION', 'Created manual session', { memorySessionId, project });

    return memorySessionId;
  }

  close(): void {
    this.db.close();
  }

  importSdkSession(session: {
    content_session_id: string;
    memory_session_id: string;
    project: string;
    platform_source?: string;
    user_prompt: string;
    started_at: string;
    started_at_epoch: number;
    completed_at: string | null;
    completed_at_epoch: number | null;
    status: string;
  }): { imported: boolean; id: number } {
    const normalizedPlatformSource = normalizePlatformSource(session.platform_source);
    const existing = this.db.prepare(
      `SELECT id FROM sdk_sessions
       WHERE platform_source = ? AND content_session_id = ?`
    ).get(normalizedPlatformSource, session.content_session_id) as { id: number } | undefined;

    if (existing) {
      return { imported: false, id: existing.id };
    }

    const stmt = this.db.prepare(`
      INSERT INTO sdk_sessions (
        content_session_id, memory_session_id, project, platform_source, user_prompt,
        started_at, started_at_epoch, completed_at, completed_at_epoch, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
	      session.content_session_id,
	      session.memory_session_id,
	      session.project,
	      normalizedPlatformSource,
      session.user_prompt,
      session.started_at,
      session.started_at_epoch,
      session.completed_at,
      session.completed_at_epoch,
      session.status
    );

    return { imported: true, id: result.lastInsertRowid as number };
  }

  importSessionSummary(summary: {
    memory_session_id: string;
    project: string;
    request: string | null;
    investigated: string | null;
    learned: string | null;
    completed: string | null;
    next_steps: string | null;
    files_read: string | null;
    files_edited: string | null;
    notes: string | null;
    prompt_number: number | null;
    discovery_tokens: number;
    created_at: string;
    created_at_epoch: number;
  }): { imported: boolean; id: number } {
    const existing = this.db.prepare(
      'SELECT id FROM session_summaries WHERE memory_session_id = ?'
    ).get(summary.memory_session_id) as { id: number } | undefined;

    if (existing) {
      return { imported: false, id: existing.id };
    }

    const stmt = this.db.prepare(`
      INSERT INTO session_summaries (
        memory_session_id, project, request, investigated, learned,
        completed, next_steps, files_read, files_edited, notes,
        prompt_number, discovery_tokens, created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      summary.memory_session_id,
      summary.project,
      summary.request,
      summary.investigated,
      summary.learned,
      summary.completed,
      summary.next_steps,
      summary.files_read,
      summary.files_edited,
      summary.notes,
      summary.prompt_number,
      summary.discovery_tokens || 0,
      summary.created_at,
      summary.created_at_epoch
    );

    return { imported: true, id: result.lastInsertRowid as number };
  }

  importObservation(obs: {
    memory_session_id: string;
    project: string;
    text: string | null;
    type: string;
    title: string | null;
    subtitle: string | null;
    facts: string | null;
    narrative: string | null;
    concepts: string | null;
    files_read: string | null;
    files_modified: string | null;
    prompt_number: number | null;
    discovery_tokens: number;
    created_at: string;
    created_at_epoch: number;
    agent_type?: string | null;
    agent_id?: string | null;
  }): { imported: boolean; id: number } {
    const existing = this.db.prepare(`
      SELECT id FROM observations
      WHERE memory_session_id = ? AND title = ? AND created_at_epoch = ?
    `).get(obs.memory_session_id, obs.title, obs.created_at_epoch) as { id: number } | undefined;

    if (existing) {
      return { imported: false, id: existing.id };
    }

    const stmt = this.db.prepare(`
      INSERT INTO observations (
        memory_session_id, project, text, type, title, subtitle,
        facts, narrative, concepts, files_read, files_modified,
        prompt_number, discovery_tokens, agent_type, agent_id,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      obs.memory_session_id,
      obs.project,
      obs.text,
      obs.type,
      obs.title,
      obs.subtitle,
      obs.facts,
      obs.narrative,
      obs.concepts,
      obs.files_read,
      obs.files_modified,
      obs.prompt_number,
      obs.discovery_tokens || 0,
      obs.agent_type ?? null,
      obs.agent_id ?? null,
      obs.created_at,
      obs.created_at_epoch
    );

    return { imported: true, id: result.lastInsertRowid as number };
  }

  rebuildObservationsFTSIndex(): void {
    const hasFTS = (this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'"
    ).all() as { name: string }[]).length > 0;

    if (!hasFTS) {
      return;
    }

    this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')");
  }

  importUserPrompt(prompt: {
    session_db_id?: number | null;
    content_session_id: string;
    platform_source?: string | null;
    prompt_number: number;
    prompt_text: string;
    created_at: string;
    created_at_epoch: number;
  }): { imported: boolean; id: number } {
    let sessionDbId: number | null = null;
    const normalizedPlatformSource = prompt.platform_source
      ? normalizePlatformSource(prompt.platform_source)
      : undefined;

    if (typeof prompt.session_db_id === 'number') {
      const explicitSession = this.db.prepare(`
        SELECT id, content_session_id, COALESCE(NULLIF(platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') as platform_source
        FROM sdk_sessions
        WHERE id = ?
        LIMIT 1
      `).get(prompt.session_db_id) as { id: number; content_session_id: string; platform_source: string } | undefined;

      if (
        explicitSession
        && explicitSession.content_session_id === prompt.content_session_id
        && (!normalizedPlatformSource || normalizePlatformSource(explicitSession.platform_source) === normalizedPlatformSource)
      ) {
        sessionDbId = explicitSession.id;
      }
    }

    if (sessionDbId === null) {
      sessionDbId = this.resolvePromptSessionDbId(
        prompt.content_session_id,
        undefined,
        normalizedPlatformSource
      );
    }

    const existing = this.db.prepare(`
      SELECT id FROM user_prompts
      WHERE ${sessionDbId !== null ? 'session_db_id = ?' : 'content_session_id = ?'} AND prompt_number = ?
    `).get(sessionDbId ?? prompt.content_session_id, prompt.prompt_number) as { id: number } | undefined;

    if (existing) {
      return { imported: false, id: existing.id };
    }

    const stmt = this.db.prepare(`
      INSERT INTO user_prompts (
        session_db_id, content_session_id, prompt_number, prompt_text,
        created_at, created_at_epoch
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      sessionDbId,
      prompt.content_session_id,
      prompt.prompt_number,
      prompt.prompt_text,
      prompt.created_at,
      prompt.created_at_epoch
    );

    return { imported: true, id: result.lastInsertRowid as number };
  }
}
