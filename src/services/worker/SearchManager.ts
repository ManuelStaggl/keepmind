
import { SessionSearch } from '../sqlite/SessionSearch.js';
import { identifierTerms } from '../sqlite/fts-query.js';
import { SessionStore } from '../sqlite/SessionStore.js';
import { ChromaSync } from '../sync/ChromaSync.js';
import { FormattingService } from './FormattingService.js';
import { TimelineService } from './TimelineService.js';
import type { TimelineItem } from './TimelineService.js';
import type { ObservationSearchResult, SessionSummarySearchResult, UserPromptSearchResult, SearchOptions } from '../sqlite/types.js';
import { logger } from '../../utils/logger.js';
import { getProjectContext } from '../../utils/project-name.js';
import { normalizePlatformSource } from '../../shared/platform-source.js';
import { normalizeSourceKind } from '../sqlite/source-kind.js';
import { CURATED_LEGEND, curatedHitOf, observationGroupLabel } from '../curated/search-label.js';
import type { SourceKindFilter } from '../sqlite/source-kind.js';
import { formatDate, formatTime, formatDateTime, extractFirstFile, groupByDate, estimateTokens } from '../../shared/timeline-formatting.js';
import { ModeManager } from '../domain/ModeManager.js';

import {
  SearchOrchestrator,
  SEARCH_CONSTANTS
} from './search/index.js';
import { ResultFormatter } from './search/ResultFormatter.js';
import { ChromaUnavailableError } from './search/errors.js';

/**
 * Telemetry envelope for search_performed (see docs/public/telemetry.mdx).
 * Populated by SearchManager.search() via a mutable sink param so response
 * shapes (json and text formats) stay untouched. Privacy: counts, booleans,
 * and closed enums only — never query text, results, or error messages.
 */
export interface SearchTelemetryEnvelope {
  result_count?: number;
  search_strategy?: 'chroma' | 'fts' | 'filter_only';
  chroma_available?: boolean;
  fallback_reason?: 'none' | 'chroma_connection' | 'chroma_error' | 'chroma_not_initialized';
}

/**
 * The ` matching "…"` fragment of a result header, or a filter-only note.
 *
 * Search legitimately runs without query text — filters alone — and every call
 * site interpolated the absent query anyway, rendering `matching "undefined"`.
 * One site had been patched individually; the rest had not, so the same defect
 * kept reappearing under a different heading.
 */
function matching(query?: string): string {
  return query ? ` matching "${query}"` : ' (filters only, no query text)';
}

/**
 * Fusion weights for an identifier lookup.
 *
 * Keyword ranks lead. The semantic side is damped rather than dropped, and
 * that distinction was measured rather than assumed:
 *
 *   dropped  (0 / 1)      bare id @1 100%, MRR 1.000 | in a sentence @1  7%, MRR 0.236
 *   damped   (0.15 / 0.85) bare id @1  93%, MRR 0.964 | in a sentence @1 36%, MRR 0.485
 *
 * Dropping it makes the bare-identifier lookup perfect and the sentence form
 * useless. Damping costs 7 points on the first and buys 29 on the second, and
 * a question that names a record while asking something about it is the more
 * common of the two.
 */
const IDENTIFIER_FUSION = { wDense: 0.15, wSparse: 0.85 };

export class SearchManager {
  private orchestrator: SearchOrchestrator;

  constructor(
    private sessionSearch: SessionSearch,
    private sessionStore: SessionStore,
    private chromaSync: ChromaSync | null,
    private formatter: FormattingService,
    private timelineService: TimelineService
  ) {
    this.orchestrator = new SearchOrchestrator(
      sessionSearch,
      sessionStore,
      chromaSync
    );
  }

  getOrchestrator(): SearchOrchestrator {
    return this.orchestrator;
  }

  getFormatter(): FormattingService {
    return this.formatter;
  }

  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  private async queryChroma(
    query: string,
    limit: number,
    whereFilter?: Record<string, any>
  ): Promise<{ ids: number[]; distances: number[]; metadatas: any[] }> {
    if (!this.chromaSync) {
      return { ids: [], distances: [], metadatas: [] };
    }
    return await this.chromaSync.queryChroma(query, limit, whereFilter);
  }

  /**
   * Build a Chroma where-filter scoped to a single doc_type, applying the
   * dual-project ($or: project + merged_into_project) scoping used by every
   * single-type hybrid search path.
   */
  private buildDocTypeWhereFilter(docType: string, project?: string, platformSource?: string): Record<string, any> {
    const filters: Array<Record<string, any>> = [{ doc_type: docType }];
    if (project) {
      const projectFilter = {
        $or: [
          { project },
          { merged_into_project: project }
        ]
      };
      filters.push(projectFilter);
    }
    if (platformSource) {
      filters.push({ platform_source: normalizePlatformSource(platformSource) });
    }
    return filters.length === 1 ? filters[0] : { $and: filters };
  }

  private buildObservationWhereFilter(
    filters: { project?: string; platformSource?: string },
    type?: string
  ): Record<string, any> {
    const whereFilters: Array<Record<string, any>> = [{ doc_type: 'observation' }];
    if (type) {
      whereFilters.push({ type });
    }
    if (filters.project) {
      whereFilters.push({
        $or: [
          { project: filters.project },
          { merged_into_project: filters.project }
        ]
      });
    }
    if (filters.platformSource) {
      whereFilters.push({ platform_source: normalizePlatformSource(filters.platformSource) });
    }
    return whereFilters.length === 1 ? whereFilters[0] : { $and: whereFilters };
  }

  /**
   * Shared "Chroma semantic match -> 90-day recency filter -> SQLite hydrate"
   * pipeline for the single-doc-type hybrid searches. Returns the hydrated rows
   * (empty when Chroma yields nothing recent); callers own their own FTS
   * fallback and formatting so per-caller behavior is preserved exactly.
   */
  /**
   * Reciprocal Rank Fusion of a dense (vector KNN) id list and a sparse (FTS5
   * BM25) id list. Both are SQLite row ids in rank order. Weighted toward
   * semantic recall (0.75) while letting exact keyword hits (ids, filenames,
   * error codes) rescue out-of-embedding-vocabulary queries (0.25). k=60 is the
   * standard RRF constant (Cormack et al.). When `dense` is empty (embedder
   * cold/unavailable) this degrades to pure BM25 order.
   */
  private rrfFuse(
    dense: number[],
    sparse: number[],
    { k = 60, wDense = 0.75, wSparse = 0.25, limit = 100 }: { k?: number; wDense?: number; wSparse?: number; limit?: number } = {}
  ): number[] {
    const score = new Map<number, number>();
    dense.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + wDense / (k + i + 1)));
    sparse.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + wSparse / (k + i + 1)));
    return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  }

  /**
   * Put the records that contain the query VERBATIM at the front of a ranking.
   *
   * WHY THIS IS A PROMOTION AND NOT A THIRD CHANNEL IN THE FUSION. "This record
   * contains these words in this order" is a fact, not a score. Fusing it would
   * turn it back into one — RRF ranks by reciprocal rank, so a verbatim hit
   * would enter as "rank 1 of a third list" and could still be outvoted by two
   * channels that merely resemble the query. The same reasoning the supersession
   * marker rests on: a deterministic answer is not improved by being averaged
   * with a guess.
   *
   * WHAT IT FIXES. FTS5's bm25 does not reward adjacency, so the keyword leg
   * cannot tell a record that contains your sentence from one that uses the same
   * words apart — and that undifferentiated score carries a quarter of the
   * weight against a similarity score carrying three quarters. Measured against
   * the running worker, 25 sentences lifted verbatim out of records' BODIES
   * (a title quote proves nothing: `title` is bm25 weight 10, and every one of
   * those already ranked first):
   *
   *   before   @1 56%   @10 88%   MRR 0.656
   *
   * NOTHING IS DROPPED. The fused ranking follows in full, minus the ids that
   * moved up. A verbatim probe that finds nothing — the ordinary case, since
   * most questions are not quotations — returns the fused list untouched.
   */
  private promoteExactWording(query: string, fused: number[], options: SearchOptions): number[] {
    if (!query || fused.length === 0) return fused;

    let verbatim: number[];
    try {
      verbatim = this.sessionSearch.observationIdsMatchingPhrase(query, options);
    } catch (error) {
      logger.warn('SEARCH', 'Exact-wording promotion skipped', {}, error instanceof Error ? error : undefined);
      return fused;
    }
    if (verbatim.length === 0) return fused;

    // A verbatim hit is promoted even when the fused list did not contain it,
    // and that is the point rather than an oversight: three of the measured
    // misses were not in the top ten at all. It is safe because the probe runs
    // through the SAME `buildFilterClause` as the keyword leg — which is itself
    // not recency-filtered — and because hydration applies project, origin and
    // platform filters once more by id.
    const promoted = new Set(verbatim);
    logger.debug('SEARCH', 'Exact wording found — promoting', { count: verbatim.length });
    return [...verbatim, ...fused.filter(id => !promoted.has(id))];
  }

  /**
   * S22 — put the active session checkpoint back where a reader can find it.
   *
   * The active checkpoint is the state baton and the documented alternative to
   * `/compact`. Search is how it is fetched when the injection did not deliver
   * it whole (S20), so the two failures compound: a halved hand-off plus a
   * search that cannot find the other half means the baton is lost while
   * sitting intact in the database.
   *
   * Measured 29.08.2026 against the running worker. `Nummernkollision` occurs
   * verbatim in exactly ONE row in the entire store — the active keepmind
   * checkpoint #16021. Keyword-only search ranked it 1 of 1. The unified search
   * returned three observations, none of them that one, and filled the rest
   * with user prompts reading "ja", "erledigt" and "passt". The reported
   * six-word query behaved the same way and additionally returned a RETIRED
   * Krossr checkpoint while two active ones were missing.
   *
   * Same shape as `promoteExactWording`, and the same three reasons:
   *
   *  - It is a PROMOTION, not a third fusion channel. "The corpus holds an
   *    active hand-off containing these words" is a fact the keyword index
   *    answers exactly; re-entering it as "rank 1 of a third list" would let
   *    two resemblance channels outvote it, which is what buried it in the
   *    first place. RRF at k=60 scores a rank-1 sparse hit 0.25/61 ≈ 0.0041 and
   *    a rank-120 dense hit 0.75/180 ≈ 0.0042, so a unique exact match sits
   *    below roughly the first 120 semantic neighbours before the limit is even
   *    applied.
   *  - Nothing is dropped and nothing is demoted. The fused ranking follows in
   *    full, minus the ids that moved up. A query that matches no active
   *    checkpoint — the ordinary case — returns it untouched.
   *  - No relevance threshold. The probe fires on a keyword match or not at
   *    all, which is a fact rather than a score; `decision-candidates.ts`
   *    already records what happens when a threshold is put on this corpus.
   *
   * It runs AFTER the verbatim promotion so a reader who quoted a sentence
   * still gets that sentence first: quoting is a statement about what they are
   * looking for, and the baton is a statement about what is current.
   */
  private promoteActiveCheckpoints(query: string, ranked: number[], options: SearchOptions): number[] {
    if (!query) return ranked;

    let active: number[];
    try {
      active = this.sessionSearch.activeCheckpointIdsMatching(query, options);
    } catch (error) {
      logger.warn('SEARCH', 'Active-checkpoint promotion skipped', {}, error instanceof Error ? error : undefined);
      return ranked;
    }
    if (active.length === 0) return ranked;

    const promoted = new Set(active);
    logger.debug('SEARCH', 'Active checkpoint matched — promoting', { count: active.length });
    return [...active, ...ranked.filter(id => !promoted.has(id))];
  }

  /** BM25 (FTS5) row ids for a doc type, in rank order. Errors degrade to []. */
  /**
   * How many semantic candidates to ask the vector index for.
   *
   * The origin filter is the ONE search filter that cannot be pushed down into
   * the index: `vec_items` filters on its own metadata columns (doc_type,
   * project, platform_source, obs_type) and `source_kind` is not one of them —
   * adding it means re-embedding the whole corpus, which is a real cost for a
   * filter this narrow. So the candidates arrive unfiltered and hydration cuts
   * them down.
   *
   * The candidates are cut down before fusion rather than after
   * (`filterObservationIdsBySourceKind`), so the fusion cap is spent on rows
   * that can still be returned. That fixes the correctness problem but not the
   * recall one: curated rows are a low single-digit percentage of the store, so
   * a top-100 KNN leaves a handful of survivors and the semantic channel goes
   * quiet — the search still answers, from keyword hits alone, and looks like
   * it worked. Widening the pool when a source filter is active keeps that
   * channel contributing. It is a wider KNN over a local index, not a second
   * search, and only happens when someone asked for one origin by name.
   */
  private denseCandidateLimit(sourceKind: SourceKindFilter): number {
    return sourceKind === 'all'
      ? SearchManager.DENSE_CANDIDATES
      : SearchManager.DENSE_CANDIDATES_FILTERED;
  }

  private static readonly DENSE_CANDIDATES = 100;
  private static readonly DENSE_CANDIDATES_FILTERED = 1000;

  private ftsIdsFor(
    docType: string,
    query: string,
    options: { project?: string; platformSource?: string; type?: any; concepts?: any; files?: any; limit?: number; sourceKind?: SourceKindFilter } = {}
  ): number[] {
    try {
      if (docType === 'observation') {
        return this.sessionSearch.searchObservations(query, { ...options, limit: options.limit ?? 100 }).map(r => r.id);
      }
      if (docType === 'session_summary') {
        return this.sessionSearch.searchSessions(query, { ...options, limit: options.limit ?? 100 }).map(r => r.id);
      }
      if (docType === 'user_prompt') {
        return this.sessionSearch.searchUserPrompts(query, { ...options, limit: options.limit ?? 100 }).map(r => r.id);
      }
    } catch (ftsError) {
      logger.warn('SEARCH', 'BM25 side of hybrid search failed', { docType }, ftsError instanceof Error ? ftsError : undefined);
    }
    return [];
  }

  private async hybridSemanticHydrate<T>(
    query: string,
    docType: string,
    project: string | undefined,
    platformSource: string | undefined,
    hydrate: (ids: number[]) => T[]
  ): Promise<T[]> {
    const whereFilter = this.buildDocTypeWhereFilter(docType, project, platformSource);
    const chromaResults = await this.queryChroma(query, 100, whereFilter);
    logger.debug('SEARCH', 'Vector store returned semantic matches', { matchCount: chromaResults?.ids?.length ?? 0 });

    // Dense side: recency-filter the semantic matches (stale semantic hits are
    // noisy). Keyword-exact matches are not recency-filtered (matches prior FTS
    // fallback behaviour), so the fused set can still surface old exact hits.
    let denseIds: number[] = [];
    if (chromaResults?.ids && chromaResults.ids.length > 0) {
      const ninetyDaysAgo = Date.now() - SEARCH_CONSTANTS.RECENCY_WINDOW_MS;
      denseIds = chromaResults.ids.filter((_id, idx) => {
        const meta = chromaResults.metadatas[idx];
        return meta && meta.created_at_epoch > ninetyDaysAgo;
      });
      logger.debug('SEARCH', 'Results within 90-day window', { count: denseIds.length });
    }

    const sparseIds = query ? this.ftsIdsFor(docType, query, { project, platformSource }) : [];
    const fused = this.rrfFuse(denseIds, sparseIds);
    logger.debug('SEARCH', 'Hybrid RRF fused ids', { dense: denseIds.length, sparse: sparseIds.length, fused: fused.length });

    if (fused.length > 0) {
      return hydrate(fused);
    }
    return [];
  }

  private async searchChromaForTimeline(query: string, project?: string, platformSource?: string): Promise<ObservationSearchResult[]> {
    return this.hybridSemanticHydrate(query, 'observation', project, platformSource, (ids) =>
      this.sessionStore.getObservationsByIds(ids, { orderBy: 'date_desc', limit: 1, project, platformSource })
    );
  }

  /**
   * Render a list of timeline items as grouped day -> file -> observation
   * markdown tables (with session/prompt rows interleaved). Returns the body
   * lines only; callers prepend their own title/window header. An item is the
   * anchor when its id matches a numeric anchorId (observation) or an "S{id}"
   * string anchorId (session).
   */
  private renderTimeline(
    filteredItems: TimelineItem[],
    anchorId: number | string | null,
    cwd: string
  ): string[] {
    const lines: string[] = [];

    const dayMap = new Map<string, TimelineItem[]>();
    for (const item of filteredItems) {
      const day = formatDate(item.epoch);
      if (!dayMap.has(day)) {
        dayMap.set(day, []);
      }
      dayMap.get(day)!.push(item);
    }

    const sortedDays = Array.from(dayMap.entries()).sort((a, b) => {
      const aDate = new Date(a[0]).getTime();
      const bDate = new Date(b[0]).getTime();
      return aDate - bDate;
    });

    for (const [day, dayItems] of sortedDays) {
      lines.push(`### ${day}`);
      lines.push('');

      let currentFile: string | null = null;
      let lastTime = '';
      let tableOpen = false;

      for (const item of dayItems) {
        const isAnchor = (
          (typeof anchorId === 'number' && item.type === 'observation' && item.data.id === anchorId) ||
          (typeof anchorId === 'string' && anchorId.startsWith('S') && item.type === 'session' && `S${item.data.id}` === anchorId)
        );

        if (item.type === 'session') {
          if (tableOpen) {
            lines.push('');
            tableOpen = false;
            currentFile = null;
            lastTime = '';
          }

          const sess = item.data as SessionSummarySearchResult;
          const title = sess.request || 'Session summary';
          const marker = isAnchor ? ' <- **ANCHOR**' : '';

          lines.push(`**🎯 #S${sess.id}** ${title} (${formatDateTime(item.epoch)})${marker}`);
          lines.push('');
        } else if (item.type === 'prompt') {
          if (tableOpen) {
            lines.push('');
            tableOpen = false;
            currentFile = null;
            lastTime = '';
          }

          const prompt = item.data as UserPromptSearchResult;
          const truncated = prompt.prompt_text.length > 100 ? prompt.prompt_text.substring(0, 100) + '...' : prompt.prompt_text;

          lines.push(`**💬 User Prompt #${prompt.prompt_number}** (${formatDateTime(item.epoch)})`);
          lines.push(`> ${truncated}`);
          lines.push('');
        } else if (item.type === 'observation') {
          const obs = item.data as ObservationSearchResult;
          // Same rule as search: a lasting entry is grouped by what it IS, not
          // by a file it never touched. Timeline is step 2 of the three-layer
          // sequence, so a hit marked in step 1 and unmarked here would undo
          // the marking on the way to reading it.
          const file = observationGroupLabel(obs)
            ?? extractFirstFile(obs.files_modified, cwd, obs.files_read);

          if (file !== currentFile) {
            if (tableOpen) {
              lines.push('');
            }

            lines.push(`**${file}**`);
            lines.push(`| ID | Time | T | Title | Tokens |`);
            lines.push(`|----|------|---|-------|--------|`);

            currentFile = file;
            tableOpen = true;
            lastTime = '';
          }

          const icon = ModeManager.getInstance().getTypeIcon(obs.type);

          const time = formatTime(item.epoch);
          const title = obs.title || 'Untitled';
          const tokens = estimateTokens(obs.narrative);

          const showTime = time !== lastTime;
          const timeDisplay = showTime ? time : '"';
          lastTime = time;

          const anchorMarker = isAnchor ? ' <- **ANCHOR**' : '';
          lines.push(`| #${obs.id} | ${timeDisplay} | ${icon} | ${title}${anchorMarker} | ~${tokens} |`);
        }
      }

      if (tableOpen) {
        lines.push('');
      }
    }

    return lines;
  }

  private normalizeParams(args: any): any {
    const normalized: any = { ...args };

    if (normalized.filePath && !normalized.files) {
      normalized.files = normalized.filePath;
      delete normalized.filePath;
    }

    if (normalized.concept && !normalized.concepts) {
      normalized.concepts = normalized.concept;
      delete normalized.concept;
    }

    if (normalized.concepts && typeof normalized.concepts === 'string') {
      normalized.concepts = normalized.concepts.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    if (normalized.files && typeof normalized.files === 'string') {
      normalized.files = normalized.files.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    if (normalized.obs_type && typeof normalized.obs_type === 'string') {
      normalized.obs_type = normalized.obs_type.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    if (normalized.type && typeof normalized.type === 'string' && normalized.type.includes(',')) {
      normalized.type = normalized.type.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    // Callers spell the date window three ways (camelCase from the HTTP layer,
    // snake_case from MCP, date_from/date_to in the documented tool schema).
    // Only camelCase was read, so a snake_case window was silently dropped and
    // the search returned unfiltered results (upstream 309125bd).
    const dateStart = normalized.dateStart ?? normalized.date_start ?? normalized.date_from;
    const dateEnd = normalized.dateEnd ?? normalized.date_end ?? normalized.date_to;
    if (dateStart || dateEnd) {
      normalized.dateRange = { start: dateStart, end: dateEnd };
    }
    delete normalized.dateStart;
    delete normalized.dateEnd;
    delete normalized.date_start;
    delete normalized.date_end;
    delete normalized.date_from;
    delete normalized.date_to;

    if (normalized.isFolder === 'true') {
      normalized.isFolder = true;
    } else if (normalized.isFolder === 'false') {
      normalized.isFolder = false;
    }

    // Source-scoping (#2389): normalize the platform_source filter so that a
    // codex/cursor/etc. agent only sees its own memory. Accept both the
    // camelCase API param and the snake_case column name for robustness.
    const rawPlatformSource = normalized.platformSource ?? normalized.platform_source;
    if (typeof rawPlatformSource === 'string' && rawPlatformSource.trim()) {
      normalized.platformSource = normalizePlatformSource(rawPlatformSource);
    } else {
      delete normalized.platformSource;
    }
    delete normalized.platform_source;

    // Origin filter. Spelled three ways by three callers (the MCP tool schema
    // says `sourceKind`, the HTTP layer forwards whatever the query string
    // carried, and the column itself is `source_kind`), so all three are read
    // and exactly one is emitted. Normalized eagerly rather than at each use:
    // an unrecognised value must widen to 'all', and a value that reaches the
    // SQL layer unnormalized would be compared literally and match nothing —
    // which reads as "there is no curated corpus", not as "you typo'd".
    normalized.sourceKind = normalizeSourceKind(
      normalized.sourceKind ?? normalized.source_kind ?? normalized.source
    );
    delete normalized.source_kind;
    delete normalized.source;

    return normalized;
  }

  async search(args: any, telemetryOut?: SearchTelemetryEnvelope): Promise<any> {
    const normalized = this.normalizeParams(args);
    const { query, type, obs_type, concepts, files, format, ...options } = normalized;
    let observations: ObservationSearchResult[] = [];
    let sessions: SessionSummarySearchResult[] = [];
    let prompts: UserPromptSearchResult[] = [];
    let chromaFailed = false;
    let platformScopedChromaZeroFallback = false;
    let chromaFailureReason: { message: string; isConnectionError: boolean } | null = null;

    // `normalizeParams` guarantees this is one of the three values.
    const sourceKind: SourceKindFilter = options.sourceKind ?? 'all';

    // Session summaries and user prompts have no origin of their own: a summary
    // is a model's account of a session and a prompt is a transcript line, so
    // neither can ever be curated. Asking for curated hits therefore excludes
    // both tables entirely — that, not a WHERE clause, is what makes "only
    // lasting entries" return only lasting entries.
    const curatedOnly = sourceKind === 'curated';
    const searchObservations = !type || type === 'observations';
    const searchSessions = (!type || type === 'sessions') && !curatedOnly;
    const searchPrompts = (!type || type === 'prompts') && !curatedOnly;

    if (!query) {
      logger.debug('SEARCH', 'Filter-only query (no query text), using direct SQLite filtering', { enablesDateFilters: true });
      const obsOptions = { ...options, type: obs_type, concepts, files };
      if (searchObservations) {
        observations = this.sessionSearch.searchObservations(undefined, obsOptions);
      }
      if (searchSessions) {
        sessions = this.sessionSearch.searchSessions(undefined, options);
      }
      if (searchPrompts) {
        prompts = this.sessionSearch.searchUserPrompts(undefined, options);
      }
    }
    // PATH 2: CHROMA SEMANTIC SEARCH (query text + Chroma available)
    else if (this.chromaSync) {
      let chromaSucceeded = false;
      logger.debug('SEARCH', 'Using ChromaDB semantic search', { typeFilter: type || 'all' });

      const whereFilters: Array<Record<string, any>> = [];
      if (type === 'observations') {
        whereFilters.push({ doc_type: 'observation' });
      } else if (type === 'sessions') {
        whereFilters.push({ doc_type: 'session_summary' });
      } else if (type === 'prompts') {
        whereFilters.push({ doc_type: 'user_prompt' });
      }

      if (options.project) {
        whereFilters.push({
          $or: [
            { project: options.project },
            { merged_into_project: options.project }
          ]
        });
      }

      if (options.platformSource) {
        whereFilters.push({ platform_source: normalizePlatformSource(options.platformSource) });
      }

      const whereFilter = whereFilters.length === 0
        ? undefined
        : whereFilters.length === 1
          ? whereFilters[0]
          : { $and: whereFilters };

      try {
        const chromaResults = await this.queryChroma(query, this.denseCandidateLimit(sourceKind), whereFilter);
        chromaSucceeded = true;
        logger.debug('SEARCH', 'Vector store returned semantic matches', { matchCount: chromaResults.ids.length });

        const { dateRange } = options;
        let startEpoch: number | undefined;
        let endEpoch: number | undefined;

        if (dateRange) {
          if (dateRange.start) {
            startEpoch = typeof dateRange.start === 'number'
              ? dateRange.start
              : new Date(dateRange.start).getTime();
          }
          if (dateRange.end) {
            endEpoch = typeof dateRange.end === 'number'
              ? dateRange.end
              : new Date(dateRange.end).getTime();
          }
        } else {
          startEpoch = Date.now() - SEARCH_CONSTANTS.RECENCY_WINDOW_MS;
        }

        // Dense side: recency/date-range filtered semantic matches, partitioned
        // by doc type.
        const denseObs: number[] = [];
        const denseSessions: number[] = [];
        const densePrompts: number[] = [];
        chromaResults.metadatas.forEach((meta, idx) => {
          const isRecent = meta && meta.created_at_epoch != null
            && (!startEpoch || meta.created_at_epoch >= startEpoch)
            && (!endEpoch || meta.created_at_epoch <= endEpoch);
          if (!isRecent) return;
          const id = chromaResults.ids[idx];
          const docType = meta?.doc_type;
          if (docType === 'observation' && searchObservations) denseObs.push(id);
          else if (docType === 'session_summary' && searchSessions) denseSessions.push(id);
          else if (docType === 'user_prompt' && searchPrompts) densePrompts.push(id);
        });

        // Sparse side: BM25 keyword ids per active doc type. Fuse with RRF so
        // exact keyword hits reinforce semantic recall and the path still
        // returns results when the embedder is cold (dense empty → pure BM25).
        // An identifier query is a lookup, not a similarity question.
        //
        // There is no meaning in `V-0076` for an embedding model to place, and
        // the measurement says exactly that: the semantic channel answers 7%
        // of identifier questions at rank 10 — guessing — while the keyword
        // channel answers 100%. At the default weights the blind channel is
        // weighted three times as heavily as the accurate one, so fusing them
        // scored 64% where keyword alone scored 100%. Fusion is the right
        // default and the wrong answer here.
        const identifiers = identifierTerms(query);
        const fuseOptions = identifiers.length > 0 ? IDENTIFIER_FUSION : undefined;
        if (identifiers.length > 0) {
          logger.debug('SEARCH', 'Identifier query — leaning on keyword ranks', { count: identifiers.length });
        }

        // The origin filter has to be applied to the semantic candidates BEFORE
        // fusion. Hydration filters too, and that is what makes the result
        // correct — but fusion caps the list it produces, and the semantic leg
        // carries three quarters of the weight, so filtering only afterwards
        // means the cap is filled with rows about to be discarded. Measured:
        // 1 of 20 matching entries returned.
        // Skipped outright for the default, rather than relying on the filter
        // being a no-op there: an unfiltered search must reach the store on
        // exactly the path it always did.
        const denseObsScoped = sourceKind === 'all'
          ? denseObs
          : this.sessionStore.filterObservationIdsBySourceKind(denseObs, sourceKind);
        const obsScopedOptions = { ...options, type: obs_type, concepts, files, sourceKind };
        const obsIds = searchObservations
          ? this.promoteActiveCheckpoints(
              query,
              this.promoteExactWording(
                query,
                this.rrfFuse(denseObsScoped, this.ftsIdsFor('observation', query, obsScopedOptions), fuseOptions),
                obsScopedOptions,
              ),
              obsScopedOptions,
            )
          : [];
        const sessionIds = searchSessions
          ? this.rrfFuse(denseSessions, this.ftsIdsFor('session_summary', query, options), fuseOptions)
          : [];
        const promptIds = searchPrompts
          ? this.rrfFuse(densePrompts, this.ftsIdsFor('user_prompt', query, options), fuseOptions)
          : [];

        logger.debug('SEARCH', 'Hybrid RRF fused ids (search PATH 2)', {
          obs: obsIds.length, sessions: sessionIds.length, prompts: promptIds.length
        });

        if (obsIds.length === 0 && sessionIds.length === 0 && promptIds.length === 0) {
          logger.debug('SEARCH', 'Hybrid search found no matches', {});
        }

        // The RRF fusion above produces a ranking, and the ONLY thing carrying
        // it is the order of these id arrays. `get*ByIds` preserves that order
        // for `relevance` alone; its default is `date_desc`, and the three
        // calls below used to take it. The fused ranking was therefore
        // computed and then thrown away on every search: a question quoting a
        // record almost verbatim ("Lizenz nennen ist nicht mitliefern",
        // record 0081) returned the five most recently imported records
        // instead, and record 0081 was not among them.
        //
        // An explicit date order from the caller still wins — someone asking
        // for newest-first means it. Absent that, a search returns its best
        // matches first, which is what "search" means.
        const rankedOrderBy = options.orderBy ?? 'relevance';

        // `WHERE id IN (…)` does not promise to return rows in the order the
        // ids were given, with or without an ORDER BY. Every other ranked call
        // site re-sorts for that reason; these three did not exist to.
        const byRank = <T extends { id: number }>(ids: number[]) =>
          (a: T, b: T) => ids.indexOf(a.id) - ids.indexOf(b.id);

        if (obsIds.length > 0) {
          const obsOptions = { ...options, type: obs_type, concepts, files, orderBy: rankedOrderBy };
          observations = this.sessionStore.getObservationsByIds(obsIds, obsOptions);
          if (rankedOrderBy === 'relevance') observations.sort(byRank(obsIds));
        }
        if (sessionIds.length > 0) {
          sessions = this.sessionStore.getSessionSummariesByIds(sessionIds, {
            orderBy: rankedOrderBy,
            limit: options.limit,
            project: options.project,
            platformSource: options.platformSource
          });
          if (rankedOrderBy === 'relevance') sessions.sort(byRank(sessionIds));
        }
        if (promptIds.length > 0) {
          prompts = this.sessionStore.getUserPromptsByIds(promptIds, {
            orderBy: rankedOrderBy,
            limit: options.limit,
            project: options.project,
            platformSource: options.platformSource
          });
          if (rankedOrderBy === 'relevance') prompts.sort(byRank(promptIds));
        }
      } catch (chromaError) {
        const errorObject = chromaError instanceof Error ? chromaError : new Error(String(chromaError));
        chromaFailureReason = {
          message: errorObject.message,
          isConnectionError: chromaError instanceof ChromaUnavailableError,
        };
        logger.warn('SEARCH', 'ChromaDB semantic search failed, falling back to FTS5 keyword search', {}, errorObject);
        chromaFailed = true;

        if (searchObservations) {
          observations = this.sessionSearch.searchObservations(query, { ...options, type: obs_type, concepts, files });
        }
        if (searchSessions) {
          sessions = this.sessionSearch.searchSessions(query, options);
        }
        if (searchPrompts) {
          prompts = this.sessionSearch.searchUserPrompts(query, options);
        }
      }
    }
    // PATH 3: FTS5 KEYWORD SEARCH (Chroma not initialized)
    else if (query) {
      logger.debug('SEARCH', 'ChromaDB not initialized — falling back to FTS5 keyword search', {});
      try {
        if (searchObservations) {
          observations = this.sessionSearch.searchObservations(query, { ...options, type: obs_type, concepts, files });
        }
        if (searchSessions) {
          sessions = this.sessionSearch.searchSessions(query, options);
        }
        if (searchPrompts) {
          prompts = this.sessionSearch.searchUserPrompts(query, options);
        }
      } catch (ftsError) {
        const errorObject = ftsError instanceof Error ? ftsError : new Error(String(ftsError));
        logger.error('WORKER', 'FTS5 fallback search failed', {}, errorObject);
        chromaFailed = true;
      }
    }

    const totalResults = observations.length + sessions.length + prompts.length;

    // Count the hit against the observations it returned.
    //
    // SearchOrchestrator.recordUsage has done this correctly since the channel
    // columns were added — but the orchestrator only serves the corpus path.
    // THIS method is what the MCP search tools call, and it never touched a
    // counter, which is why fts_hit_count and vector_hit_count read 0 across all
    // 51,355 rows. That was read as "search is unused"; what it actually showed
    // was that the instrumentation sat on a different code path. Without it the
    // corpus statistics cannot answer whether search earns its keep, and expiry
    // (once enabled) would archive rows that search surfaces daily.
    if (observations.length > 0) {
      try {
        const ids = observations
          .map(o => (o as { id?: number }).id)
          .filter((id): id is number => typeof id === 'number');
        if (ids.length > 0) {
          // Attributed to the leg that actually produced the ranking: 'vector'
          // when the semantic path served the result, 'fts' when keyword search
          // did — including when it served as the fallback.
          const usedVector = !!query && this.chromaSync !== null && !chromaFailed && !platformScopedChromaZeroFallback;
          this.sessionStore.markObservationsUsed(ids, usedVector ? 'vector' : 'fts');
        }
      } catch (error) {
        // Bookkeeping must never fail a search.
        logger.debug('SEARCH', 'Failed to record search usage', {}, error instanceof Error ? error : undefined);
      }
    }

    // Telemetry envelope (search_performed): derive the strategy from the
    // three paths above. Enum/count values only — never the Chroma error
    // message, query text, or result content.
    if (telemetryOut) {
      let searchStrategy: SearchTelemetryEnvelope['search_strategy'];
      let fallbackReason: SearchTelemetryEnvelope['fallback_reason'];
      if (!query) {
        // PATH 1: filter-only SQLite (no query text; Chroma never consulted)
        searchStrategy = 'filter_only';
        fallbackReason = 'none';
      } else if (this.chromaSync) {
        // PATH 2: Chroma semantic search, degrading to FTS5 on error or
        // platform-scoped zeroes caused by pre-platform Chroma metadata.
        searchStrategy = chromaFailed || platformScopedChromaZeroFallback ? 'fts' : 'chroma';
        if (chromaFailed) {
          fallbackReason = chromaFailureReason?.isConnectionError ? 'chroma_connection' : 'chroma_error';
        } else if (platformScopedChromaZeroFallback) {
          fallbackReason = 'chroma_error';
        } else {
          fallbackReason = 'none';
        }
      } else {
        // PATH 3: FTS5 keyword search (Chroma not initialized)
        searchStrategy = 'fts';
        fallbackReason = 'chroma_not_initialized';
      }
      telemetryOut.result_count = totalResults;
      telemetryOut.search_strategy = searchStrategy;
      telemetryOut.chroma_available = this.chromaSync !== null && !chromaFailed;
      telemetryOut.fallback_reason = fallbackReason;
    }

    if (format === 'json') {
      return {
        observations,
        sessions,
        prompts,
        totalResults,
        query: query || ''
      };
    }

    if (totalResults === 0) {
      if (chromaFailureReason !== null) {
        return {
          content: [{
            type: 'text' as const,
            text: ResultFormatter.formatChromaFailureMessage(chromaFailureReason)
          }]
        };
      }
      return {
        content: [{
          type: 'text' as const,
          text: `No results found${matching(query)}`
        }]
      };
    }

    interface CombinedResult {
      type: 'observation' | 'session' | 'prompt';
      data: any;
      epoch: number;
      created_at: string;
    }

    const allResults: CombinedResult[] = [
      ...observations.map(obs => ({
        type: 'observation' as const,
        data: obs,
        epoch: obs.created_at_epoch,
        created_at: obs.created_at
      })),
      ...sessions.map(sess => ({
        type: 'session' as const,
        data: sess,
        epoch: sess.created_at_epoch,
        created_at: sess.created_at
      })),
      ...prompts.map(prompt => ({
        type: 'prompt' as const,
        data: prompt,
        epoch: prompt.created_at_epoch,
        created_at: prompt.created_at
      }))
    ];

    if (options.orderBy === 'date_desc') {
      allResults.sort((a, b) => b.epoch - a.epoch);
    } else if (options.orderBy === 'date_asc') {
      allResults.sort((a, b) => a.epoch - b.epoch);
    }

    const limitedResults = allResults.slice(0, options.limit || 20);

    const cwd = process.cwd();
    const resultsByDate = groupByDate(limitedResults, item => item.created_at);

    const curatedCount = observations.filter(obs => curatedHitOf(obs) !== null).length;

    const lines: string[] = [];
    lines.push(
      curatedOnly
        ? `Found ${curatedCount} lasting entr${curatedCount === 1 ? 'y' : 'ies'}${matching(query)} — verbatim only, nothing observed.`
        : `Found ${totalResults} result(s)${matching(query)} (${observations.length} obs, ${sessions.length} sessions, ${prompts.length} prompts)`
    );
    // The legend earns its tokens only when the reader is actually holding both
    // kinds of text, or asked for one of them by name.
    if (curatedCount > 0 || curatedOnly) {
      lines.push(CURATED_LEGEND);
    }
    lines.push('');

    for (const [day, dayResults] of resultsByDate) {
      lines.push(`### ${day}`);
      lines.push('');

      const resultsByFile = new Map<string, CombinedResult[]>();
      for (const result of dayResults) {
        let file = 'General';
        if (result.type === 'observation') {
          // A curated entry touched no file, so the file grouping has nothing
          // to say about it and used to file it under `General` — next to
          // model summaries and spelled like one.
          file = observationGroupLabel(result.data)
            ?? extractFirstFile(result.data.files_modified, cwd, result.data.files_read);
        }
        if (!resultsByFile.has(file)) {
          resultsByFile.set(file, []);
        }
        resultsByFile.get(file)!.push(result);
      }

      for (const [file, fileResults] of resultsByFile) {
        lines.push(`**${file}**`);
        lines.push(this.formatter.formatSearchTableHeader());

        let lastTime = '';
        for (const result of fileResults) {
          if (result.type === 'observation') {
            const formatted = this.formatter.formatObservationSearchRow(result.data as ObservationSearchResult, lastTime);
            lines.push(formatted.row);
            lastTime = formatted.time;
          } else if (result.type === 'session') {
            const formatted = this.formatter.formatSessionSearchRow(result.data as SessionSummarySearchResult, lastTime);
            lines.push(formatted.row);
            lastTime = formatted.time;
          } else {
            const formatted = this.formatter.formatUserPromptSearchRow(result.data as UserPromptSearchResult, lastTime);
            lines.push(formatted.row);
            lastTime = formatted.time;
          }
        }

        lines.push('');
      }
    }

    return {
      content: [{
        type: 'text' as const,
        text: lines.join('\n')
      }]
    };
  }

  private parseNumericAnchor(anchor: unknown): number | null {
    if (typeof anchor === 'number') return anchor;
    if (typeof anchor === 'string' && /^\d+$/.test(anchor.trim())) {
      return Number(anchor.trim());
    }
    return null;
  }

  async timeline(args: any): Promise<any> {
    const normalized = this.normalizeParams(args);
    const { anchor, query, depth_before, depth_after, project, platformSource } = normalized;
    const depthBefore = depth_before != null ? Number(depth_before) : 10;
    const depthAfter = depth_after != null ? Number(depth_after) : 10;
    const anchorAsNumber = this.parseNumericAnchor(anchor);
    const cwd = process.cwd();

    if (!anchor && !query) {
      return {
        content: [{
          type: 'text' as const,
          text: 'Error: Must provide either "anchor" or "query" parameter'
        }],
        isError: true
      };
    }

    if (anchor && query) {
      return {
        content: [{
          type: 'text' as const,
          text: 'Error: Cannot provide both "anchor" and "query" parameters. Use one or the other.'
        }],
        isError: true
      };
    }

    let anchorId: string | number;
    let anchorEpoch: number;
    let timelineData: any;

    if (query) {
      let results: ObservationSearchResult[] = [];

      if (this.chromaSync) {
        logger.debug('SEARCH', 'Using hybrid semantic search for timeline query', {});
        try {
          results = await this.searchChromaForTimeline(query, project, platformSource);
        } catch (chromaError) {
          const errorObject = chromaError instanceof Error ? chromaError : new Error(String(chromaError));
          logger.error('WORKER', 'Chroma search failed for timeline, continuing without semantic results', {}, errorObject);
        }
      }

      if (results.length === 0) {
        try {
          const ftsResults = this.sessionSearch.searchObservations(query, { project, platformSource, limit: 1 });
          if (ftsResults.length > 0) {
            results = ftsResults;
          }
        } catch (ftsError) {
          logger.warn('SEARCH', 'FTS fallback failed for timeline', {}, ftsError instanceof Error ? ftsError : undefined);
        }
      }

      if (results.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `No observations found matching "${query}". Try a different search query.`
          }]
        };
      }

      const topResult = results[0];
      anchorId = topResult.id;
      anchorEpoch = topResult.created_at_epoch;
      logger.debug('SEARCH', 'Query mode: Using observation as timeline anchor', { observationId: topResult.id });
      timelineData = this.sessionStore.getTimelineAroundObservation(topResult.id, topResult.created_at_epoch, depthBefore, depthAfter, project, platformSource);
    }
    // MODE 2: Anchor-based timeline
    else if (anchorAsNumber !== null) {
      const obs = this.sessionStore.getObservationsByIds([anchorAsNumber], { project, platformSource, limit: 1 })[0] ?? null;
      if (!obs) {
        return {
          content: [{
            type: 'text' as const,
            text: `Observation #${anchorAsNumber} not found`
          }],
          isError: true
        };
      }
      anchorId = anchorAsNumber;
      anchorEpoch = obs.created_at_epoch;
      timelineData = this.sessionStore.getTimelineAroundObservation(anchorAsNumber, anchorEpoch, depthBefore, depthAfter, project, platformSource);
    } else if (typeof anchor === 'string') {
      if (anchor.startsWith('S') || anchor.startsWith('#S')) {
        const sessionId = anchor.replace(/^#?S/, '');
        const sessionNum = parseInt(sessionId, 10);
        const sessions = this.sessionStore.getSessionSummariesByIds([sessionNum], { project, platformSource });
        if (sessions.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `Session #${sessionNum} not found`
            }],
            isError: true
          };
        }
        anchorEpoch = sessions[0].created_at_epoch;
        anchorId = `S${sessionNum}`;
        timelineData = this.sessionStore.getTimelineAroundTimestamp(anchorEpoch, depthBefore, depthAfter, project, platformSource);
      } else {
        const date = new Date(anchor);
        if (isNaN(date.getTime())) {
          return {
            content: [{
              type: 'text' as const,
              text: `Invalid timestamp: ${anchor}`
            }],
            isError: true
          };
        }
        anchorEpoch = date.getTime();
        anchorId = anchor;
        timelineData = this.sessionStore.getTimelineAroundTimestamp(anchorEpoch, depthBefore, depthAfter, project, platformSource);
      }
    } else {
      return {
        content: [{
          type: 'text' as const,
          text: 'Invalid anchor: must be observation ID (number), session ID (e.g., "S123"), or ISO timestamp'
        }],
        isError: true
      };
    }

    const items: TimelineItem[] = [
      ...(timelineData.observations || []).map((obs: any) => ({ type: 'observation' as const, data: obs, epoch: obs.created_at_epoch })),
      ...(timelineData.sessions || []).map((sess: any) => ({ type: 'session' as const, data: sess, epoch: sess.created_at_epoch })),
      ...(timelineData.prompts || []).map((prompt: any) => ({ type: 'prompt' as const, data: prompt, epoch: prompt.created_at_epoch }))
    ];
    items.sort((a, b) => a.epoch - b.epoch);
    const filteredItems = this.timelineService.filterByDepth(items, anchorId, anchorEpoch, depthBefore, depthAfter);

    if (!filteredItems || filteredItems.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: query
            ? `Found observation matching "${query}", but no timeline context available (${depthBefore} records before, ${depthAfter} records after).`
            : `No context found around anchor (${depthBefore} records before, ${depthAfter} records after)`
        }]
      };
    }

    const lines: string[] = [];

    if (query) {
      const anchorObs = filteredItems.find(item => item.type === 'observation' && item.data.id === anchorId);
      const anchorTitle = anchorObs && anchorObs.type === 'observation' ? ((anchorObs.data as ObservationSearchResult).title || 'Untitled') : 'Unknown';
      lines.push(`# Timeline for query: "${query}"`);
      lines.push(`**Anchor:** Observation #${anchorId} - ${anchorTitle}`);
    } else {
      lines.push(`# Timeline around anchor: ${anchorId}`);
    }

    lines.push(`**Window:** ${depthBefore} records before -> ${depthAfter} records after | **Items:** ${filteredItems?.length ?? 0}`);
    lines.push('');

    lines.push(...this.renderTimeline(filteredItems, anchorId, cwd));

    return {
      content: [{
        type: 'text' as const,
        text: lines.join('\n')
      }]
    };
  }

  async decisions(args: any): Promise<any> {
    const normalized = this.normalizeParams(args);
    const { query, ...filters } = normalized;
    let results: ObservationSearchResult[] = [];

    if (this.chromaSync) {
      if (query) {
        logger.debug('SEARCH', 'Using Chroma semantic search with type=decision filter', {});
        try {
          const chromaResults = await this.queryChroma(
            query,
            Math.min((filters.limit || 20) * 2, 100),
            this.buildObservationWhereFilter(filters, 'decision')
          );
          const obsIds = chromaResults.ids;

          if (obsIds.length > 0) {
            results = this.sessionStore.getObservationsByIds(obsIds, { ...filters, type: 'decision' });
            results.sort((a, b) => obsIds.indexOf(a.id) - obsIds.indexOf(b.id));
          }
        } catch (chromaError) {
          const errorObject = chromaError instanceof Error ? chromaError : new Error(String(chromaError));
          logger.error('WORKER', 'Chroma search failed for decisions, falling back to metadata search', {}, errorObject);
        }
      } else {
        logger.debug('SEARCH', 'Using metadata-first + semantic ranking for decisions', {});
        const metadataResults = this.sessionSearch.findByType('decision', filters);

        if (metadataResults.length > 0) {
          const ids = metadataResults.map(obs => obs.id);
          try {
            const chromaResults = await this.queryChroma(
              'decision',
              Math.min(ids.length, 100),
              this.buildObservationWhereFilter(filters)
            );

            const rankedIds: number[] = [];
            for (const chromaId of chromaResults.ids) {
              if (ids.includes(chromaId) && !rankedIds.includes(chromaId)) {
                rankedIds.push(chromaId);
              }
            }

            if (rankedIds.length > 0) {
              results = this.sessionStore.getObservationsByIds(rankedIds, {
                orderBy: 'relevance',
                limit: filters.limit || 20,
                project: filters.project,
                platformSource: filters.platformSource
              });
              results.sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));
            }
          } catch (chromaError) {
            const errorObject = chromaError instanceof Error ? chromaError : new Error(String(chromaError));
            logger.error('WORKER', 'Chroma semantic ranking failed for decisions, falling back to metadata search', {}, errorObject);
          }
        }
      }
    }

    if (results.length === 0) {
      results = this.sessionSearch.findByType('decision', filters);
    }

    if (results.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No decision observations found'
        }]
      };
    }

    const header = `Found ${results.length} decision(s)\n\n${this.formatter.formatTableHeader()}`;
    const formattedResults = results.map((obs, i) => this.formatter.formatObservationIndex(obs, i));

    return {
      content: [{
        type: 'text' as const,
        text: header + '\n' + formattedResults.join('\n')
      }]
    };
  }

  async changes(args: any): Promise<any> {
    const normalized = this.normalizeParams(args);
    const { ...filters } = normalized;
    let results: ObservationSearchResult[] = [];

    if (this.chromaSync) {
      logger.debug('SEARCH', 'Using hybrid search for change-related observations', {});

      const typeResults = this.sessionSearch.findByType('change', filters);
      const conceptChangeResults = this.sessionSearch.findByConcept('change', filters);
      const conceptWhatChangedResults = this.sessionSearch.findByConcept('what-changed', filters);

      const allIds = new Set<number>();
      [...typeResults, ...conceptChangeResults, ...conceptWhatChangedResults].forEach(obs => allIds.add(obs.id));

      if (allIds.size > 0) {
        const idsArray = Array.from(allIds);
        try {
          const chromaResults = await this.queryChroma(
            'what changed',
            Math.min(idsArray.length, 100),
            this.buildObservationWhereFilter(filters)
          );

          const rankedIds: number[] = [];
          for (const chromaId of chromaResults.ids) {
            if (idsArray.includes(chromaId) && !rankedIds.includes(chromaId)) {
              rankedIds.push(chromaId);
            }
          }

          if (rankedIds.length > 0) {
            results = this.sessionStore.getObservationsByIds(rankedIds, {
              orderBy: 'relevance',
              limit: filters.limit || 20,
              project: filters.project,
              platformSource: filters.platformSource
            });
            results.sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));
          }
        } catch (chromaError) {
          const errorObject = chromaError instanceof Error ? chromaError : new Error(String(chromaError));
          logger.error('WORKER', 'Chroma search failed for changes, falling back to metadata search', {}, errorObject);
        }
      }
    }

    if (results.length === 0) {
      const typeResults = this.sessionSearch.findByType('change', filters);
      const conceptResults = this.sessionSearch.findByConcept('change', filters);
      const whatChangedResults = this.sessionSearch.findByConcept('what-changed', filters);

      const allIds = new Set<number>();
      [...typeResults, ...conceptResults, ...whatChangedResults].forEach(obs => allIds.add(obs.id));

      results = Array.from(allIds).map(id =>
        typeResults.find(obs => obs.id === id) ||
        conceptResults.find(obs => obs.id === id) ||
        whatChangedResults.find(obs => obs.id === id)
      ).filter(Boolean) as ObservationSearchResult[];

      results.sort((a, b) => b.created_at_epoch - a.created_at_epoch);
      results = results.slice(0, filters.limit || 20);
    }

    if (results.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No change-related observations found'
        }]
      };
    }

    const header = `Found ${results.length} change-related observation(s)\n\n${this.formatter.formatTableHeader()}`;
    const formattedResults = results.map((obs, i) => this.formatter.formatObservationIndex(obs, i));

    return {
      content: [{
        type: 'text' as const,
        text: header + '\n' + formattedResults.join('\n')
      }]
    };
  }

  async howItWorks(args: any): Promise<any> {
    const normalized = this.normalizeParams(args);
    const { ...filters } = normalized;
    let results: ObservationSearchResult[] = [];

    if (this.chromaSync) {
      logger.debug('SEARCH', 'Using metadata-first + semantic ranking for how-it-works', {});
      const metadataResults = this.sessionSearch.findByConcept('how-it-works', filters);

      if (metadataResults.length > 0) {
        const ids = metadataResults.map(obs => obs.id);
        const chromaResults = await this.queryChroma(
          'how it works architecture',
          Math.min(ids.length, 100),
          this.buildObservationWhereFilter(filters)
        );

        const rankedIds: number[] = [];
        for (const chromaId of chromaResults.ids) {
          if (ids.includes(chromaId) && !rankedIds.includes(chromaId)) {
            rankedIds.push(chromaId);
          }
        }

        if (rankedIds.length > 0) {
          results = this.sessionStore.getObservationsByIds(rankedIds, {
            orderBy: 'relevance',
            limit: filters.limit || 20,
            project: filters.project,
            platformSource: filters.platformSource
          });
          results.sort((a, b) => rankedIds.indexOf(a.id) - rankedIds.indexOf(b.id));
        }
      }
    }

    if (results.length === 0) {
      results = this.sessionSearch.findByConcept('how-it-works', filters);
    }

    if (results.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: 'No "how it works" observations found'
        }]
      };
    }

    const header = `Found ${results.length} "how it works" observation(s)\n\n${this.formatter.formatTableHeader()}`;
    const formattedResults = results.map((obs, i) => this.formatter.formatObservationIndex(obs, i));

    return {
      content: [{
        type: 'text' as const,
        text: header + '\n' + formattedResults.join('\n')
      }]
    };
  }

  async searchObservations(args: any): Promise<any> {
    const normalized = this.normalizeParams(args);
    const { query, ...options } = normalized;
    let results: ObservationSearchResult[] = [];

    if (this.chromaSync) {
      logger.debug('SEARCH', 'Using hybrid semantic search (Chroma + SQLite)', {});
      try {
        const limit = options.limit || 20;
        results = await this.hybridSemanticHydrate(query, 'observation', options.project, options.platformSource, (ids) =>
          this.sessionStore.getObservationsByIds(ids, {
            orderBy: 'date_desc',
            limit,
            project: options.project,
            platformSource: options.platformSource
          })
        );
      } catch (chromaError) {
        const errorObject = chromaError instanceof Error ? chromaError : new Error(String(chromaError));
        logger.error('WORKER', 'Chroma search failed for observations, falling back to FTS', {}, errorObject);
      }
    }

    if (results.length === 0) {
      try {
        const ftsResults = this.sessionSearch.searchObservations(query, options);
        if (ftsResults.length > 0) {
          results = ftsResults;
        }
      } catch (ftsError) {
        logger.warn('SEARCH', 'FTS fallback failed for observations', {}, ftsError instanceof Error ? ftsError : undefined);
      }
    }

    if (results.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `No observations found${matching(query)}`
        }]
      };
    }

    const header = `Found ${results.length} observation(s)${matching(query)}\n\n${this.formatter.formatTableHeader()}`;
    const formattedResults = results.map((obs, i) => this.formatter.formatObservationIndex(obs, i));

    return {
      content: [{
        type: 'text' as const,
        text: header + '\n' + formattedResults.join('\n')
      }]
    };
  }

  async searchSessions(args: any): Promise<any> {
    const normalized = this.normalizeParams(args);
    const { query, ...options } = normalized;
    let results: SessionSummarySearchResult[] = [];

    if (this.chromaSync) {
      logger.debug('SEARCH', 'Using hybrid semantic search for sessions', {});
      try {
        const limit = options.limit || 20;
        results = await this.hybridSemanticHydrate(query, 'session_summary', options.project, options.platformSource, (ids) =>
          this.sessionStore.getSessionSummariesByIds(ids, {
            orderBy: 'date_desc',
            limit,
            project: options.project,
            platformSource: options.platformSource
          })
        );
      } catch (chromaError) {
        const errorObject = chromaError instanceof Error ? chromaError : new Error(String(chromaError));
        logger.error('WORKER', 'Chroma search failed for sessions, falling back to FTS', {}, errorObject);
      }
    }

    if (results.length === 0) {
      try {
        const ftsResults = this.sessionSearch.searchSessions(query, options);
        if (ftsResults.length > 0) {
          results = ftsResults;
        }
      } catch (ftsError) {
        logger.warn('SEARCH', 'FTS fallback failed for sessions', {}, ftsError instanceof Error ? ftsError : undefined);
      }
    }

    if (results.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `No sessions found${matching(query)}`
        }]
      };
    }

    const header = `Found ${results.length} session(s)${matching(query)}\n\n${this.formatter.formatTableHeader()}`;
    const formattedResults = results.map((session, i) => this.formatter.formatSessionIndex(session, i));

    return {
      content: [{
        type: 'text' as const,
        text: header + '\n' + formattedResults.join('\n')
      }]
    };
  }

  async searchUserPrompts(args: any): Promise<any> {
    const normalized = this.normalizeParams(args);
    const { query, ...options } = normalized;
    let results: UserPromptSearchResult[] = [];

    if (this.chromaSync) {
      logger.debug('SEARCH', 'Using hybrid semantic search for user prompts', {});
      try {
        const limit = options.limit || 20;
        results = await this.hybridSemanticHydrate(query, 'user_prompt', options.project, options.platformSource, (ids) =>
          this.sessionStore.getUserPromptsByIds(ids, {
            orderBy: 'date_desc',
            limit,
            project: options.project,
            platformSource: options.platformSource
          })
        );
      } catch (chromaError) {
        const errorObject = chromaError instanceof Error ? chromaError : new Error(String(chromaError));
        logger.error('WORKER', 'Chroma search failed for user prompts, falling back to FTS', {}, errorObject);
      }
    }

    if (results.length === 0 && query) {
      try {
        const ftsResults = this.sessionSearch.searchUserPrompts(query, options);
        if (ftsResults.length > 0) {
          results = ftsResults;
        }
      } catch (ftsError) {
        logger.warn('SEARCH', 'FTS fallback failed for user prompts', {}, ftsError instanceof Error ? ftsError : undefined);
      }
    }

    if (results.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `No user prompts found${matching(query)}`
        }]
      };
    }

    const header = `Found ${results.length} user prompt(s)${matching(query)}\n\n${this.formatter.formatTableHeader()}`;
    const formattedResults = results.map((prompt, i) => this.formatter.formatUserPromptIndex(prompt, i));

    return {
      content: [{
        type: 'text' as const,
        text: header + '\n' + formattedResults.join('\n')
      }]
    };
  }

  async getRecentContext(args: any): Promise<any> {
    const normalized = this.normalizeParams(args);
    const project = normalized.project || getProjectContext(process.cwd()).primary;
    const parsedLimit = parseInt(String(normalized.limit ?? '3'), 10);
    const limit = parsedLimit > 0 ? parsedLimit : 3;
    const { platformSource } = normalized;

    const sessions = this.sessionStore.getRecentSessionsWithStatus(project, limit, platformSource);

    if (sessions.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `# Recent Session Context\n\nNo previous sessions found for project "${project}".`
        }]
      };
    }

    const lines: string[] = [];
    lines.push('# Recent Session Context');
    lines.push('');
    lines.push(`Showing last ${sessions.length} session(s) for **${project}**:`);
    lines.push('');

    for (const session of sessions) {
      if (!session.memory_session_id) continue;

      lines.push('---');
      lines.push('');

      if (session.has_summary) {
        const summary = this.sessionStore.getSummaryForSession(session.memory_session_id, platformSource);
        if (summary) {
          const promptLabel = summary.prompt_number ? ` (Prompt #${summary.prompt_number})` : '';
          lines.push(`**Summary${promptLabel}**`);
          lines.push('');

          if (summary.request) lines.push(`**Request:** ${summary.request}`);
          if (summary.completed) lines.push(`**Completed:** ${summary.completed}`);
          if (summary.learned) lines.push(`**Learned:** ${summary.learned}`);
          if (summary.next_steps) lines.push(`**Next Steps:** ${summary.next_steps}`);

          if (summary.files_read) {
            try {
              const filesRead = JSON.parse(summary.files_read);
              if (Array.isArray(filesRead) && filesRead.length > 0) {
                lines.push(`**Files Read:** ${filesRead.join(', ')}`);
              }
            } catch (error) {
              const errorObject = error instanceof Error ? error : new Error(String(error));
              logger.debug('WORKER', 'files_read is plain string, using as-is', {}, errorObject);
              if (summary.files_read.trim()) {
                lines.push(`**Files Read:** ${summary.files_read}`);
              }
            }
          }

          if (summary.files_edited) {
            try {
              const filesEdited = JSON.parse(summary.files_edited);
              if (Array.isArray(filesEdited) && filesEdited.length > 0) {
                lines.push(`**Files Edited:** ${filesEdited.join(', ')}`);
              }
            } catch (error) {
              const errorObject = error instanceof Error ? error : new Error(String(error));
              logger.debug('WORKER', 'files_edited is plain string, using as-is', {}, errorObject);
              if (summary.files_edited.trim()) {
                lines.push(`**Files Edited:** ${summary.files_edited}`);
              }
            }
          }

          const date = new Date(summary.created_at).toLocaleString();
          lines.push(`**Date:** ${date}`);
        }
      } else if (session.status === 'active') {
        lines.push('**In Progress**');
        lines.push('');

        if (session.user_prompt) {
          lines.push(`**Request:** ${session.user_prompt}`);
        }

        const observations = this.sessionStore.getObservationsForSession(session.memory_session_id, platformSource);
        if (observations.length > 0) {
          lines.push('');
          lines.push(`**Observations (${observations.length}):**`);
          for (const obs of observations) {
            lines.push(`- ${obs.title}`);
          }
        } else {
          lines.push('');
          lines.push('*No observations yet*');
        }

        lines.push('');
        lines.push('**Status:** Active - summary pending');

        const date = new Date(session.started_at).toLocaleString();
        lines.push(`**Date:** ${date}`);
      } else {
        lines.push(`**${session.status.charAt(0).toUpperCase() + session.status.slice(1)}**`);
        lines.push('');

        if (session.user_prompt) {
          lines.push(`**Request:** ${session.user_prompt}`);
        }

        lines.push('');
        lines.push(`**Status:** ${session.status} - no summary available`);

        const date = new Date(session.started_at).toLocaleString();
        lines.push(`**Date:** ${date}`);
      }

      lines.push('');
    }

    return {
      content: [{
        type: 'text' as const,
        text: lines.join('\n')
      }]
    };
  }

  async getContextTimeline(args: any): Promise<any> {
    const normalized = this.normalizeParams(args);
    const { anchor, depth_before, depth_after, project, platformSource } = normalized;
    const depthBefore = depth_before != null ? Number(depth_before) : 10;
    const depthAfter = depth_after != null ? Number(depth_after) : 10;
    const cwd = process.cwd();
    let anchorEpoch: number;
    let anchorId: string | number = anchor;

    let timelineData;
    if (typeof anchor === 'number') {
      const obs = this.sessionStore.getObservationsByIds([anchor], { project, platformSource, limit: 1 })[0] ?? null;
      if (!obs) {
        return {
          content: [{
            type: 'text' as const,
            text: `Observation #${anchor} not found`
          }],
          isError: true
        };
      }
      anchorEpoch = obs.created_at_epoch;
      timelineData = this.sessionStore.getTimelineAroundObservation(anchor, anchorEpoch, depthBefore, depthAfter, project, platformSource);
    } else if (typeof anchor === 'string') {
      if (anchor.startsWith('S') || anchor.startsWith('#S')) {
        const sessionId = anchor.replace(/^#?S/, '');
        const sessionNum = parseInt(sessionId, 10);
        const sessions = this.sessionStore.getSessionSummariesByIds([sessionNum], { project, platformSource });
        if (sessions.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `Session #${sessionNum} not found`
            }],
            isError: true
          };
        }
        anchorEpoch = sessions[0].created_at_epoch;
        anchorId = `S${sessionNum}`;
        timelineData = this.sessionStore.getTimelineAroundTimestamp(anchorEpoch, depthBefore, depthAfter, project, platformSource);
      } else {
        const date = new Date(anchor);
        if (isNaN(date.getTime())) {
          return {
            content: [{
              type: 'text' as const,
              text: `Invalid timestamp: ${anchor}`
            }],
            isError: true
          };
        }
        anchorEpoch = date.getTime(); 
        timelineData = this.sessionStore.getTimelineAroundTimestamp(anchorEpoch, depthBefore, depthAfter, project, platformSource);
      }
    } else {
      return {
        content: [{
          type: 'text' as const,
          text: 'Invalid anchor: must be observation ID (number), session ID (e.g., "S123"), or ISO timestamp'
        }],
        isError: true
      };
    }

    const items: TimelineItem[] = [
      ...timelineData.observations.map(obs => ({ type: 'observation' as const, data: obs, epoch: obs.created_at_epoch })),
      ...timelineData.sessions.map(sess => ({ type: 'session' as const, data: sess, epoch: sess.created_at_epoch })),
      ...timelineData.prompts.map(prompt => ({ type: 'prompt' as const, data: prompt, epoch: prompt.created_at_epoch }))
    ];
    items.sort((a, b) => a.epoch - b.epoch);
    const filteredItems = this.timelineService.filterByDepth(items, anchorId, anchorEpoch, depthBefore, depthAfter);

    if (!filteredItems || filteredItems.length === 0) {
      const anchorDate = new Date(anchorEpoch).toLocaleString();
      return {
        content: [{
          type: 'text' as const,
          text: `No context found around ${anchorDate} (${depthBefore} records before, ${depthAfter} records after)`
        }]
      };
    }

    const lines: string[] = [];

    lines.push(`# Timeline around anchor: ${anchorId}`);
    lines.push(`**Window:** ${depthBefore} records before -> ${depthAfter} records after | **Items:** ${filteredItems?.length ?? 0}`);
    lines.push('');

    lines.push(...this.renderTimeline(filteredItems, anchorId, cwd));

    return {
      content: [{
        type: 'text' as const,
        text: lines.join('\n')
      }]
    };
  }

  async getTimelineByQuery(args: any): Promise<any> {
    const normalized = this.normalizeParams(args);
    const { query, mode = 'auto', depth_before, depth_after, limit = 5, project, platformSource } = normalized;

    // A timeline BY QUERY without a query has nothing to anchor on. Unguarded,
    // it embedded the absent value and reported back `matching "undefined"`.
    if (!query) {
      return {
        content: [{
          type: 'text' as const,
          text: 'Error: Must provide a "query" parameter to build a timeline by query. Use the timeline tool with an "anchor" to build one around a known observation.'
        }]
      };
    }

    const depthBefore = depth_before != null ? Number(depth_before) : 10;
    const depthAfter = depth_after != null ? Number(depth_after) : 10;
    const cwd = process.cwd();

    let results: ObservationSearchResult[] = [];

    if (this.chromaSync) {
      logger.debug('SEARCH', 'Using hybrid semantic search for timeline query', {});
      try {
        results = await this.hybridSemanticHydrate(query, 'observation', project, platformSource, (ids) =>
          this.sessionStore.getObservationsByIds(ids, {
            orderBy: 'date_desc',
            limit: mode === 'auto' ? 1 : limit,
            project,
            platformSource
          })
        );
      } catch (chromaError) {
        const errorObject = chromaError instanceof Error ? chromaError : new Error(String(chromaError));
        logger.error('WORKER', 'Chroma search failed for timeline by query, falling back to FTS', {}, errorObject);
      }
    }

    if (results.length === 0) {
      try {
        const ftsResults = this.sessionSearch.searchObservations(query, { project, platformSource, limit: mode === 'auto' ? 1 : limit });
        if (ftsResults.length > 0) {
          results = ftsResults;
        }
      } catch (ftsError) {
        logger.warn('SEARCH', 'FTS fallback failed for timeline by query', {}, ftsError instanceof Error ? ftsError : undefined);
      }
    }

    if (results.length === 0) {
      return {
        content: [{
          type: 'text' as const,
          text: `No observations found matching "${query}". Try a different search query.`
        }]
      };
    }

    if (mode === 'interactive') {
      const lines: string[] = [];
      lines.push(`# Timeline Anchor Search Results`);
      lines.push('');
      lines.push(`Found ${results.length} observation(s) matching "${query}"`);
      lines.push('');
      lines.push(`To get timeline context around any of these observations, use the \`get_context_timeline\` tool with the observation ID as the anchor.`);
      lines.push('');
      lines.push(`**Top ${results.length} matches:**`);
      lines.push('');

      for (let i = 0; i < results.length; i++) {
        const obs = results[i];
        const title = obs.title || `Observation #${obs.id}`;
        const date = new Date(obs.created_at_epoch).toLocaleString();
        const type = obs.type ? `[${obs.type}]` : '';

        lines.push(`${i + 1}. **${type} ${title}**`);
        lines.push(`   - ID: ${obs.id}`);
        lines.push(`   - Date: ${date}`);
        if (obs.subtitle) {
          lines.push(`   - ${obs.subtitle}`);
        }
        lines.push('');
      }

      return {
        content: [{
          type: 'text' as const,
          text: lines.join('\n')
        }]
      };
    } else {
      const topResult = results[0];
      logger.debug('SEARCH', 'Auto mode: Using observation as timeline anchor', { observationId: topResult.id });

      const timelineData = this.sessionStore.getTimelineAroundObservation(
        topResult.id,
        topResult.created_at_epoch,
        depthBefore,
        depthAfter,
        project,
        platformSource
      );

      const items: TimelineItem[] = [
        ...(timelineData.observations || []).map(obs => ({ type: 'observation' as const, data: obs, epoch: obs.created_at_epoch })),
        ...(timelineData.sessions || []).map(sess => ({ type: 'session' as const, data: sess, epoch: sess.created_at_epoch })),
        ...(timelineData.prompts || []).map(prompt => ({ type: 'prompt' as const, data: prompt, epoch: prompt.created_at_epoch }))
      ];
      items.sort((a, b) => a.epoch - b.epoch);
      const filteredItems = this.timelineService.filterByDepth(items, topResult.id, 0, depthBefore, depthAfter);

      if (!filteredItems || filteredItems.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: `Found observation #${topResult.id} matching "${query}", but no timeline context available (${depthBefore} records before, ${depthAfter} records after).`
          }]
        };
      }

      const lines: string[] = [];

      lines.push(`# Timeline for query: "${query}"`);
      lines.push(`**Anchor:** Observation #${topResult.id} - ${topResult.title || 'Untitled'}`);
      lines.push(`**Window:** ${depthBefore} records before -> ${depthAfter} records after | **Items:** ${filteredItems?.length ?? 0}`);
      lines.push('');

      lines.push(...this.renderTimeline(filteredItems, topResult.id, cwd));

      return {
        content: [{
          type: 'text' as const,
          text: lines.join('\n')
        }]
      };
    }
  }
}
