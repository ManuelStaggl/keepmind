import { Database } from '../../storage/db.js';
import { TableNameRow } from '../../types/database.js';
import { DATA_DIR, DB_PATH, ensureDir, resolveOpenDbPath } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import { isDirectChild } from '../../shared/path-utils.js';
import { AppError } from '../server/ErrorHandler.js';
import {
  ObservationSearchResult,
  SessionSummarySearchResult,
  UserPromptSearchResult,
  SearchOptions,
  SearchFilters,
  DateRange,
  ObservationRow,
  UserPromptRow
} from './types.js';
import { DEFAULT_PLATFORM_SOURCE, normalizePlatformSource } from '../../shared/platform-source.js';
import { buildFtsMatchExpression, buildPhraseMatchExpression } from './fts-query.js';
import { normalizeSourceKind, sourceKindCondition } from './source-kind.js';

/** The observations FTS table, named once so the ranking check cannot drift. */
const OBSERVATIONS_FTS = 'observations_fts';

/**
 * bm25 column weights for `observations_fts`, in CREATE-TABLE order:
 * title, subtitle, narrative, text, facts, concepts.
 */
const OBSERVATION_BM25_WEIGHTS = [10, 3, 1, 1, 1, 2] as const;

export class SessionSearch {
  private db: Database;

  private static readonly MISSING_SEARCH_INPUT_MESSAGE = 'Either query or filters required for search';

  /**
   * How many verbatim hits the exact-wording probe returns.
   *
   * A bound on the query, not a judgement about relevance: every row it
   * returns literally contains the wording that was searched for. A distinctive
   * sentence matches a handful of records; a cap only matters if one somehow
   * matches hundreds, and then the ordinary ranking is the better answer anyway.
   */
  private static readonly PHRASE_MATCH_LIMIT = 20;

  constructor(dbPathOrDb: string | Database = DB_PATH) {
    if (dbPathOrDb instanceof Database) {
      this.db = dbPathOrDb;
    } else {
      ensureDir(DATA_DIR);
      const openPath = dbPathOrDb === DB_PATH ? resolveOpenDbPath() : dbPathOrDb;
      // Connection pragmas (incl. busy_timeout) are applied by the Database
      // constructor for every read-write file connection — see pragmas.ts.
      this.db = new Database(openPath);
    }

    this._fts5Available = this.isFts5Available();

    this.ensureFTSTables();
  }

  private _fts5Available: boolean;

  private ensureFTSTables(): void {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'").all() as TableNameRow[];
    const hasFTS = tables.some(t => t.name === 'observations_fts' || t.name === 'session_summaries_fts');

    if (hasFTS) {
      this.migrateObservationsFtsTokenizer();
      return;
    }

    if (!this.isFts5Available()) {
      logger.warn('DB', 'FTS5 not available on this platform — skipping FTS table creation (search uses ChromaDB)');
      return;
    }

    logger.info('DB', 'Creating FTS5 tables');

    try {
      this.createFTSTablesAndTriggers();
      logger.info('DB', 'FTS5 tables created successfully');
    } catch (error) {
      this._fts5Available = false;
      logger.warn('DB', 'FTS5 table creation failed — search will use ChromaDB and LIKE queries', {}, error instanceof Error ? error : undefined);
    }
  }

  /**
   * Rebuild `observations_fts` once, when it predates the hyphen tokenizer.
   *
   * The index and the query builder MUST agree on whether a hyphen splits a
   * token. Measured: with the tokenizer changed and `queryTerms` left alone,
   * every identifier query returned NOTHING — 0% where it had been 100% at
   * rank 10. That is why this migration exists rather than a settings flag:
   * a switch would let the two halves drift apart, and the failure is total
   * and silent.
   *
   * Cheap and idempotent: it fires only while the stored DDL lacks
   * `tokenchars`, and `rebuild` refills from the content table.
   */
  private migrateObservationsFtsTokenizer(): void {
    try {
      const row = this.db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='observations_fts'")
        .get() as { sql?: string } | undefined;
      if (!row?.sql || row.sql.includes('tokenchars')) return;

      logger.info('DB', 'Rebuilding observations_fts with the hyphen-aware tokenizer');
      this.db.run('DROP TABLE IF EXISTS observations_fts');
      this.createObservationsFtsTable();
      this.db.run("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')");
      logger.info('DB', 'observations_fts rebuilt');
    } catch (error) {
      // Never fatal: the old index still answers every query except the
      // identifier ones, and losing search entirely would be worse.
      logger.warn('DB', 'observations_fts tokenizer migration failed — identifier search stays split', {}, error instanceof Error ? error : undefined);
    }
  }

  /**
   * The observations index.
   *
   * `tokenchars '-'` keeps `V-0169` one token instead of `v` + `0169`.
   * Measured over evals/memory: a bare identifier went from 29% to 100% at
   * rank 1 (MRR 0.607 -> 1.000), and the paraphrase set improved slightly too.
   * The cost is that a hyphenated word no longer matches its own halves; the
   * question sets show that trade landing far on the profitable side.
   */
  private createObservationsFtsTable(): void {
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
        title,
        subtitle,
        narrative,
        text,
        facts,
        concepts,
        content='observations',
        content_rowid='id',
        tokenize="unicode61 tokenchars '-'"
      );
    `);
  }

  private isFts5Available(): boolean {
    try {
      this.db.run('CREATE VIRTUAL TABLE _fts5_probe USING fts5(test_column)');
      this.db.run('DROP TABLE _fts5_probe');
      return true;
    } catch {
      return false;
    }
  }

  private createFTSTablesAndTriggers(): void {
    // One definition, used by both first creation and the migration above —
    // two copies of this DDL is how the tokenizer would come back on a fresh
    // install after being migrated away on an existing one.
    this.createObservationsFtsTable();

    this.db.run(`
      INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
      SELECT id, title, subtitle, narrative, text, facts, concepts
      FROM observations;
    `);

    this.db.run(`
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
    `);

    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS session_summaries_fts USING fts5(
        request,
        investigated,
        learned,
        completed,
        next_steps,
        notes,
        content='session_summaries',
        content_rowid='id'
      );
    `);

    this.db.run(`
      INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
      SELECT id, request, investigated, learned, completed, next_steps, notes
      FROM session_summaries;
    `);

    this.db.run(`
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
    `);
  }

  private buildFilterClause(
    filters: SearchFilters,
    params: any[],
    tableAlias: string = 'o',
    // Only `observations` has a `type` column. session_summaries and
    // user_prompts do not, so every clause naming `type` must be suppressed for
    // them or the statement is invalid SQL.
    //
    // This was implicit, and the project filter emitted `type = 'global'`
    // unconditionally: a project-scoped session search therefore died with
    // "no such column: s.type". It stayed hidden because the two callers that
    // pass 's' only stripped the caller-supplied `type` FILTER, which is a
    // different clause, and because every other route to session summaries goes
    // through hydrate-by-id and never builds this clause at all. The one path
    // that did — a filter-only unified search with a project and no query text —
    // returned HTTP 500 for every such request.
    hasTypeColumn: boolean = true,
  ): string {
    const conditions: string[] = [];

    if (filters.project) {
      // Phase 4 / Step 2 — default-scope to the project, but keep cross-project
      // user-pinned rows (type='global') eligible unless explicitly excluded.
      // Tables without a `type` column have no global rows to keep, so they get
      // the plain project predicate.
      if (filters.includeGlobal === false || !hasTypeColumn) {
        conditions.push(`${tableAlias}.project = ?`);
        params.push(filters.project);
      } else {
        conditions.push(`(${tableAlias}.project = ? OR ${tableAlias}.type = 'global')`);
        params.push(filters.project);
      }
    }

    // Source-scoping (#2389): when a platformSource is supplied, restrict to
    // rows whose owning sdk_session has that platform_source. observations and
    // session_summaries both carry memory_session_id, which is the FK into
    // sdk_sessions. COALESCE mirrors PaginationHelper: legacy rows with a NULL
    // platform_source are treated as 'claude' so they never bleed into a
    // codex/other-agent search.
    if (filters.platformSource) {
      conditions.push(
        `COALESCE(NULLIF((SELECT s2.platform_source FROM sdk_sessions s2 WHERE s2.memory_session_id = ${tableAlias}.memory_session_id), ''), '${DEFAULT_PLATFORM_SOURCE}') = ?`
      );
      params.push(normalizePlatformSource(filters.platformSource));
    }

    // Origin filter. `source_kind` sits on `observations` only, exactly like
    // `type` — session summaries and user prompts have no column to filter on,
    // and a caller asking for curated rows should not be served them at all,
    // which SearchManager arranges by not searching those tables. Emitting the
    // clause for them anyway would be invalid SQL, the same way the project
    // filter's `type = 'global'` once was.
    if (hasTypeColumn) {
      const origin = sourceKindCondition(normalizeSourceKind(filters.sourceKind), tableAlias);
      if (origin) {
        conditions.push(origin.sql);
        params.push(origin.param);
      }
    }

    if (filters.type && hasTypeColumn) {
      if (Array.isArray(filters.type)) {
        const placeholders = filters.type.map(() => '?').join(',');
        conditions.push(`${tableAlias}.type IN (${placeholders})`);
        params.push(...filters.type);
      } else {
        conditions.push(`${tableAlias}.type = ?`);
        params.push(filters.type);
      }
    }

    if (filters.dateRange) {
      const { start, end } = filters.dateRange;
      if (start) {
        const startEpoch = typeof start === 'number' ? start : new Date(start).getTime();
        conditions.push(`${tableAlias}.created_at_epoch >= ?`);
        params.push(startEpoch);
      }
      if (end) {
        const endEpoch = typeof end === 'number' ? end : new Date(end).getTime();
        conditions.push(`${tableAlias}.created_at_epoch <= ?`);
        params.push(endEpoch);
      }
    }

    if (filters.concepts) {
      const concepts = Array.isArray(filters.concepts) ? filters.concepts : [filters.concepts];
      const conceptConditions = concepts.map(() => {
        return `EXISTS (SELECT 1 FROM json_each(${tableAlias}.concepts) WHERE value = ?)`;
      });
      if (conceptConditions.length > 0) {
        conditions.push(`(${conceptConditions.join(' OR ')})`);
        params.push(...concepts);
      }
    }

    if (filters.files) {
      const files = Array.isArray(filters.files) ? filters.files : [filters.files];
      const fileConditions = files.map(() => {
        return `(
          EXISTS (SELECT 1 FROM json_each(${tableAlias}.files_read) WHERE value LIKE ?)
          OR EXISTS (SELECT 1 FROM json_each(${tableAlias}.files_modified) WHERE value LIKE ?)
        )`;
      });
      if (fileConditions.length > 0) {
        conditions.push(`(${fileConditions.join(' OR ')})`);
        files.forEach(file => {
          params.push(`%${file}%`, `%${file}%`);
        });
      }
    }

    return conditions.length > 0 ? conditions.join(' AND ') : '';
  }

  private buildOrderClause(orderBy: SearchOptions['orderBy'] = 'relevance', hasFTS: boolean = true, ftsTable: string = 'observations_fts'): string {
    switch (orderBy) {
      case 'relevance': {
        if (!hasFTS) return 'ORDER BY o.created_at_epoch DESC';
        // Weighted bm25 rather than the default rank.
        //
        // The default treats a hit in a 5 KB narrative as worth exactly as much
        // as a hit in the title, and bm25 sums per-term contributions across
        // columns — so a long body full of common words outranks the record
        // whose title IS the answer. Measured over evals/memory: 54% -> 71% at
        // rank 1, MRR 0.612 -> 0.743, with recall@10 up 4 points too. Nothing
        // else in this change set moved a number that far.
        //
        // The weights are deliberately round. Several profiles land within one
        // question of each other over a 24-question set, which is noise, not
        // signal — the real finding is "weighted beats unweighted", and tuning
        // the third digit against this sample would be fitting it.
        //
        // Column order is fixed by the CREATE VIRTUAL TABLE above: title,
        // subtitle, narrative, text, facts, concepts. Adding a column there
        // without adding a weight here silently shifts every weight by one.
        if (ftsTable === OBSERVATIONS_FTS) {
          return `ORDER BY bm25(${ftsTable}, ${OBSERVATION_BM25_WEIGHTS.join(', ')}) ASC`;
        }
        return `ORDER BY ${ftsTable}.rank ASC`;
      }
      case 'date_desc':
        return 'ORDER BY o.created_at_epoch DESC';
      case 'date_asc':
        return 'ORDER BY o.created_at_epoch ASC';
      default:
        return 'ORDER BY o.created_at_epoch DESC';
    }
  }

  searchObservations(query: string | undefined, options: SearchOptions = {}): ObservationSearchResult[] {
    const params: any[] = [];
    const { limit = 50, offset = 0, orderBy = 'relevance', ...filters } = options;

    if (!query) {
      const filterClause = this.buildFilterClause(filters, params, 'o');
      if (!filterClause) {
        throw new AppError(SessionSearch.MISSING_SEARCH_INPUT_MESSAGE, 400, 'INVALID_SEARCH_REQUEST');
      }

      const orderClause = this.buildOrderClause(orderBy, false);

      const sql = `
        SELECT o.*, o.discovery_tokens
        FROM observations o
        WHERE ${filterClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      params.push(limit, offset);
      return this.db.prepare(sql).all(...params) as ObservationSearchResult[];
    }

    if (this._fts5Available) {
      const filterClause = this.buildFilterClause(filters, params, 'o');
      const orderClause = this.buildOrderClause(orderBy, true, 'observations_fts');

      const sql = `
        SELECT o.*, o.discovery_tokens
        FROM observations o
        JOIN observations_fts ON observations_fts.rowid = o.id
        WHERE observations_fts MATCH ?
        ${filterClause ? 'AND ' + filterClause : ''}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      const matchExpression = buildFtsMatchExpression(query);
      if (matchExpression === null) return [];
      params.unshift(matchExpression);
      params.push(limit, offset);

      try {
        return this.db.prepare(sql).all(...params) as ObservationSearchResult[];
      } catch (error) {
        logger.warn('DB', 'FTS5 observation search failed', {}, error instanceof Error ? error : undefined);
        throw error;
      }
    }

    logger.warn('DB', 'Text search unavailable: ChromaDB disabled and FTS5 not available');
    return [];
  }

  /**
   * Row ids of observations that contain the query VERBATIM, in bm25 order.
   *
   * Ids rather than rows: the caller already hydrates, and this exists only to
   * say which records hold the wording — not to be a second search path with
   * its own result shape that would then have to agree with the first.
   *
   * The caller's `limit` and `orderBy` are deliberately NOT honoured. This is
   * not a result list; it is the leading edge of one, and its own cap is about
   * bounding the query rather than about how many results the caller wants.
   * Every FILTER is honoured, through the same `buildFilterClause` the ordinary
   * search uses — a promoted row that the filters would have excluded is a row
   * the caller asked not to see.
   */
  observationIdsMatchingPhrase(query: string, options: SearchOptions = {}): number[] {
    if (!this._fts5Available) return [];
    const expression = buildPhraseMatchExpression(query);
    if (expression === null) return [];

    const { limit: _limit, offset: _offset, orderBy: _orderBy, ...filters } = options;
    const params: any[] = [];
    const filterClause = this.buildFilterClause(filters, params, 'o');

    const sql = `
      SELECT o.id
      FROM observations o
      JOIN observations_fts ON observations_fts.rowid = o.id
      WHERE observations_fts MATCH ?
      ${filterClause ? 'AND ' + filterClause : ''}
      ORDER BY bm25(observations_fts, ${OBSERVATION_BM25_WEIGHTS.join(', ')}) ASC
      LIMIT ?
    `;
    params.unshift(expression);
    params.push(SessionSearch.PHRASE_MATCH_LIMIT);

    try {
      return (this.db.prepare(sql).all(...params) as Array<{ id: number }>).map(row => row.id);
    } catch (error) {
      // An exact-wording probe that fails must cost nothing but the promotion:
      // the ordinary ranking is already computed and still correct.
      logger.warn('DB', 'Exact-wording probe failed', {}, error instanceof Error ? error : undefined);
      return [];
    }
  }

  searchSessions(query: string | undefined, options: SearchOptions = {}): SessionSummarySearchResult[] {
    const params: any[] = [];
    const { limit = 50, offset = 0, orderBy = 'relevance', ...filters } = options;

    if (!query) {
      // hasTypeColumn=false replaces the previous `delete filters.type`: one
      // mechanism now covers BOTH clauses that name `type`, instead of stripping
      // the filter while the project predicate still emitted `s.type='global'`.
      const filterClause = this.buildFilterClause({ ...filters }, params, 's', false);
      if (!filterClause) {
        throw new AppError(SessionSearch.MISSING_SEARCH_INPUT_MESSAGE, 400, 'INVALID_SEARCH_REQUEST');
      }

      const orderClause = orderBy === 'date_asc'
        ? 'ORDER BY s.created_at_epoch ASC'
        : 'ORDER BY s.created_at_epoch DESC';

      const sql = `
        SELECT s.*, s.discovery_tokens
        FROM session_summaries s
        WHERE ${filterClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      params.push(limit, offset);
      return this.db.prepare(sql).all(...params) as SessionSummarySearchResult[];
    }

    if (this._fts5Available) {
      const filterClause = this.buildFilterClause({ ...filters }, params, 's', false);

      const orderClause = orderBy === 'date_asc'
        ? 'ORDER BY s.created_at_epoch ASC'
        : orderBy === 'date_desc'
          ? 'ORDER BY s.created_at_epoch DESC'
          : 'ORDER BY session_summaries_fts.rank ASC';

      const sql = `
        SELECT s.*, s.discovery_tokens
        FROM session_summaries s
        JOIN session_summaries_fts ON session_summaries_fts.rowid = s.id
        WHERE session_summaries_fts MATCH ?
        ${filterClause ? 'AND ' + filterClause : ''}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      const matchExpression = buildFtsMatchExpression(query);
      if (matchExpression === null) return [];
      params.unshift(matchExpression);
      params.push(limit, offset);

      try {
        return this.db.prepare(sql).all(...params) as SessionSummarySearchResult[];
      } catch (error) {
        logger.warn('DB', 'FTS5 session search failed', {}, error instanceof Error ? error : undefined);
        throw error;
      }
    }

    logger.warn('DB', 'Text search unavailable: ChromaDB disabled and FTS5 not available');
    return [];
  }

  findByConcept(concept: string, options: SearchOptions = {}): ObservationSearchResult[] {
    const params: any[] = [];
    const { limit = 50, offset = 0, orderBy = 'date_desc', ...filters } = options;

    const conceptFilters = { ...filters, concepts: concept };
    const filterClause = this.buildFilterClause(conceptFilters, params, 'o');
    const orderClause = this.buildOrderClause(orderBy, false);

    const sql = `
      SELECT o.*, o.discovery_tokens
      FROM observations o
      WHERE ${filterClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    return this.db.prepare(sql).all(...params) as ObservationSearchResult[];
  }

  private hasDirectChildFile(obs: ObservationSearchResult, folderPath: string): boolean {
    const checkFiles = (filesJson: string | null): boolean => {
      if (!filesJson) return false;
      try {
        const files = JSON.parse(filesJson);
        if (Array.isArray(files)) {
          return files.some(f => isDirectChild(f, folderPath));
        }
      } catch (error) {
        logger.debug('DB', `Failed to parse files JSON for observation ${obs.id}`, undefined, error instanceof Error ? error : undefined);
      }
      return false;
    };

    return checkFiles(obs.files_modified) || checkFiles(obs.files_read);
  }

  private hasDirectChildFileSession(session: SessionSummarySearchResult, folderPath: string): boolean {
    const checkFiles = (filesJson: string | null): boolean => {
      if (!filesJson) return false;
      try {
        const files = JSON.parse(filesJson);
        if (Array.isArray(files)) {
          return files.some(f => isDirectChild(f, folderPath));
        }
      } catch (error) {
        logger.debug('DB', `Failed to parse files JSON for session summary ${session.id}`, undefined, error instanceof Error ? error : undefined);
      }
      return false;
    };

    return checkFiles(session.files_read) || checkFiles(session.files_edited);
  }

  findByFile(filePath: string, options: SearchOptions = {}): {
    observations: ObservationSearchResult[];
    sessions: SessionSummarySearchResult[];
  } {
    const params: any[] = [];
    const { limit = 50, offset = 0, orderBy = 'date_desc', isFolder = false, ...filters } = options;

    const queryLimit = isFolder ? limit * 3 : limit;

    const fileFilters = { ...filters, files: filePath };
    const filterClause = this.buildFilterClause(fileFilters, params, 'o');
    const orderClause = this.buildOrderClause(orderBy, false);

    const observationsSql = `
      SELECT o.*, o.discovery_tokens
      FROM observations o
      WHERE ${filterClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    params.push(queryLimit, offset);

    let observations = this.db.prepare(observationsSql).all(...params) as ObservationSearchResult[];

    if (isFolder) {
      observations = observations.filter(obs => this.hasDirectChildFile(obs, filePath)).slice(0, limit);
    }

    const sessionParams: any[] = [];
    const sessionFilters = { ...filters };
    delete sessionFilters.type; 

    const baseConditions: string[] = [];
    if (sessionFilters.project) {
      baseConditions.push('s.project = ?');
      sessionParams.push(sessionFilters.project);
    }

    if (sessionFilters.platformSource) {
      baseConditions.push(
        `COALESCE(NULLIF((SELECT s2.platform_source FROM sdk_sessions s2 WHERE s2.memory_session_id = s.memory_session_id), ''), '${DEFAULT_PLATFORM_SOURCE}') = ?`
      );
      sessionParams.push(normalizePlatformSource(sessionFilters.platformSource));
    }

    if (sessionFilters.dateRange) {
      const { start, end } = sessionFilters.dateRange;
      if (start) {
        const startEpoch = typeof start === 'number' ? start : new Date(start).getTime();
        baseConditions.push('s.created_at_epoch >= ?');
        sessionParams.push(startEpoch);
      }
      if (end) {
        const endEpoch = typeof end === 'number' ? end : new Date(end).getTime();
        baseConditions.push('s.created_at_epoch <= ?');
        sessionParams.push(endEpoch);
      }
    }

    baseConditions.push(`(
      EXISTS (SELECT 1 FROM json_each(s.files_read) WHERE value LIKE ?)
      OR EXISTS (SELECT 1 FROM json_each(s.files_edited) WHERE value LIKE ?)
    )`);
    sessionParams.push(`%${filePath}%`, `%${filePath}%`);

    const sessionsSql = `
      SELECT s.*, s.discovery_tokens
      FROM session_summaries s
      WHERE ${baseConditions.join(' AND ')}
      ORDER BY s.created_at_epoch DESC
      LIMIT ? OFFSET ?
    `;

    sessionParams.push(queryLimit, offset);

    let sessions = this.db.prepare(sessionsSql).all(...sessionParams) as SessionSummarySearchResult[];

    if (isFolder) {
      sessions = sessions.filter(s => this.hasDirectChildFileSession(s, filePath)).slice(0, limit);
    }

    return { observations, sessions };
  }

  findByType(
    type: ObservationRow['type'] | ObservationRow['type'][],
    options: SearchOptions = {}
  ): ObservationSearchResult[] {
    const params: any[] = [];
    const { limit = 50, offset = 0, orderBy = 'date_desc', ...filters } = options;

    const typeFilters = { ...filters, type };
    const filterClause = this.buildFilterClause(typeFilters, params, 'o');
    const orderClause = this.buildOrderClause(orderBy, false);

    const sql = `
      SELECT o.*, o.discovery_tokens
      FROM observations o
      WHERE ${filterClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    return this.db.prepare(sql).all(...params) as ObservationSearchResult[];
  }

  searchUserPrompts(query: string | undefined, options: SearchOptions = {}): UserPromptSearchResult[] {
    const params: any[] = [];
    const { limit = 20, offset = 0, orderBy = 'relevance', ...filters } = options;

    const baseConditions: string[] = [];
    if (filters.project) {
      baseConditions.push('s.project = ?');
      params.push(filters.project);
    }

    if (filters.platformSource) {
      baseConditions.push(`COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') = ?`);
      params.push(normalizePlatformSource(filters.platformSource));
    }

    if (filters.dateRange) {
      const { start, end } = filters.dateRange;
      if (start) {
        const startEpoch = typeof start === 'number' ? start : new Date(start).getTime();
        baseConditions.push('up.created_at_epoch >= ?');
        params.push(startEpoch);
      }
      if (end) {
        const endEpoch = typeof end === 'number' ? end : new Date(end).getTime();
        baseConditions.push('up.created_at_epoch <= ?');
        params.push(endEpoch);
      }
    }

    if (!query) {
      if (baseConditions.length === 0) {
        throw new AppError(SessionSearch.MISSING_SEARCH_INPUT_MESSAGE, 400, 'INVALID_SEARCH_REQUEST');
      }

      const whereClause = `WHERE ${baseConditions.join(' AND ')}`;
      const orderClause = orderBy === 'date_asc'
        ? 'ORDER BY up.created_at_epoch ASC'
        : 'ORDER BY up.created_at_epoch DESC';

      const sql = `
        SELECT
          up.*,
          s.project,
          s.memory_session_id,
          COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') as platform_source
        FROM user_prompts up
        JOIN sdk_sessions s ON up.session_db_id = s.id
        ${whereClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      params.push(limit, offset);
      return this.db.prepare(sql).all(...params) as UserPromptSearchResult[];
    }

    const escapedQuery = query.replace(/[\\%_]/g, '\\$&');
    baseConditions.push("up.prompt_text LIKE ? ESCAPE '\\'");
    params.push(`%${escapedQuery}%`);

    const whereClause = `WHERE ${baseConditions.join(' AND ')}`;
    const orderClause = orderBy === 'date_asc'
      ? 'ORDER BY up.created_at_epoch ASC'
      : 'ORDER BY up.created_at_epoch DESC';

    const sql = `
      SELECT
        up.*,
        s.project,
        s.memory_session_id,
        COALESCE(NULLIF(s.platform_source, ''), '${DEFAULT_PLATFORM_SOURCE}') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      ${whereClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    return this.db.prepare(sql).all(...params) as UserPromptSearchResult[];
  }

  getUserPromptsBySession(contentSessionId: string): UserPromptRow[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        content_session_id,
        prompt_number,
        prompt_text,
        created_at,
        created_at_epoch
      FROM user_prompts
      WHERE content_session_id = ?
      ORDER BY prompt_number ASC
    `);

    return stmt.all(contentSessionId) as UserPromptRow[];
  }

  close(): void {
    this.db.close();
  }
}
