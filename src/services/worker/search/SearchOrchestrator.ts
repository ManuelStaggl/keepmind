
import { SessionSearch } from '../../sqlite/SessionSearch.js';
import { SessionStore } from '../../sqlite/SessionStore.js';
import { ChromaSync } from '../../sync/ChromaSync.js';

import { ChromaSearchStrategy } from './strategies/ChromaSearchStrategy.js';
import { SQLiteSearchStrategy } from './strategies/SQLiteSearchStrategy.js';
import { HybridSearchStrategy } from './strategies/HybridSearchStrategy.js';

import type {
  StrategySearchOptions,
  StrategySearchResult,
  ObservationSearchResult
} from './types.js';
import { ChromaUnavailableError } from './errors.js';
import { logger } from '../../../utils/logger.js';
import { normalizePlatformSource } from '../../../shared/platform-source.js';

interface NormalizedParams extends StrategySearchOptions {
  concepts?: string[];
  files?: string[];
  obsType?: string[];
}

export class SearchOrchestrator {
  private chromaStrategy: ChromaSearchStrategy | null = null;
  private sqliteStrategy: SQLiteSearchStrategy;
  private hybridStrategy: HybridSearchStrategy | null = null;

  constructor(
    private sessionSearch: SessionSearch,
    private sessionStore: SessionStore,
    private chromaSync: ChromaSync | null
  ) {
    this.sqliteStrategy = new SQLiteSearchStrategy(sessionSearch);

    if (chromaSync) {
      this.chromaStrategy = new ChromaSearchStrategy(chromaSync, sessionStore);
      this.hybridStrategy = new HybridSearchStrategy(chromaSync, sessionStore, sessionSearch);
    }
  }

  async search(args: any): Promise<StrategySearchResult> {
    const options = this.normalizeParams(args);

    return this.recordUsage(await this.executeWithFallback(options));
  }

  /**
   * Count a search hit against the observations it returned (C1').
   *
   * Search was the one retrieval path with no instrumentation at all: only
   * SessionStart injection and explicit get_observations fetches ever bumped a
   * counter. That made the corpus statistics unreadable — a low "used" rate
   * could not be distinguished from an uncounted one — and it also meant a
   * record that search surfaced daily never reset its expiry timer.
   *
   * Attributed by the strategy that produced the result, so vector and keyword
   * retrieval stay separable; hybrid counts as vector because that is the leg
   * that contributes the ranking. Best-effort throughout: search results must
   * never fail over bookkeeping.
   */
  private recordUsage(result: StrategySearchResult): StrategySearchResult {
    try {
      const ids = result.results.observations
        .map((o: ObservationSearchResult) => o.id)
        .filter((id): id is number => typeof id === 'number');
      if (ids.length === 0) return result;
      this.sessionStore.markObservationsUsed(ids, result.usedChroma ? 'vector' : 'fts');
    } catch (error) {
      logger.debug('SEARCH', 'Failed to record search usage', {}, error instanceof Error ? error : undefined);
    }
    return result;
  }

  private async executeWithFallback(
    options: NormalizedParams
  ): Promise<StrategySearchResult> {
    if (!options.query) {
      logger.debug('SEARCH', 'Orchestrator: Filter-only query, using SQLite', {});
      return await this.sqliteStrategy.search(options);
    }

    if (this.chromaStrategy) {
      logger.debug('SEARCH', 'Orchestrator: Using Chroma semantic search', {});
      try {
        const chromaResult = await this.chromaStrategy.search(options);
        if (options.platformSource && this.isEmptyResult(chromaResult)) {
          logger.debug('SEARCH', 'Orchestrator: platform-scoped Chroma search returned zero matches; falling back to SQLite', {});
          return await this.sqliteStrategy.search(options);
        }
        return chromaResult;
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        throw new ChromaUnavailableError(
          `Chroma query failed: ${errorObj.message}`,
          errorObj
        );
      }
    }

    logger.debug('SEARCH', 'Orchestrator: Chroma not configured', {});
    return {
      results: { observations: [], sessions: [], prompts: [] },
      usedChroma: false,
      strategy: 'sqlite'
    };
  }

  private isEmptyResult(result: StrategySearchResult): boolean {
    return result.results.observations.length === 0
      && result.results.sessions.length === 0
      && result.results.prompts.length === 0;
  }

  async findByConcept(concept: string, args: any): Promise<StrategySearchResult> {
    const options = this.normalizeParams(args);

    if (this.hybridStrategy) {
      return this.recordUsage(await this.hybridStrategy.findByConcept(concept, options));
    }

    const results = this.sqliteStrategy.findByConcept(concept, options);
    return this.recordUsage({
      results: { observations: results, sessions: [], prompts: [] },
      usedChroma: false,
      strategy: 'sqlite'
    });
  }

  async findByType(type: string | string[], args: any): Promise<StrategySearchResult> {
    const options = this.normalizeParams(args);

    if (this.hybridStrategy) {
      return this.recordUsage(await this.hybridStrategy.findByType(type, options));
    }

    const results = this.sqliteStrategy.findByType(type, options);
    return this.recordUsage({
      results: { observations: results, sessions: [], prompts: [] },
      usedChroma: false,
      strategy: 'sqlite'
    });
  }

  async findByFile(filePath: string, args: any): Promise<{
    observations: ObservationSearchResult[];
    sessions: any[];
    usedChroma: boolean;
  }> {
    const options = this.normalizeParams(args);

    const found = this.hybridStrategy
      ? await this.hybridStrategy.findByFile(filePath, options)
      : { ...this.sqliteStrategy.findByFile(filePath, options), usedChroma: false };

    this.recordUsage({
      results: { observations: found.observations, sessions: [], prompts: [] },
      usedChroma: found.usedChroma,
      strategy: found.usedChroma ? 'chroma' : 'sqlite',
    });
    return found;
  }

  private normalizeParams(args: any): NormalizedParams {
    const normalized: any = { ...args };

    if (normalized.concepts && typeof normalized.concepts === 'string') {
      normalized.concepts = normalized.concepts.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    if (normalized.files && typeof normalized.files === 'string') {
      normalized.files = normalized.files.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    if (normalized.obs_type && typeof normalized.obs_type === 'string') {
      normalized.obsType = normalized.obs_type.split(',').map((s: string) => s.trim()).filter(Boolean);
      delete normalized.obs_type;
    }

    if (normalized.type && typeof normalized.type === 'string' && normalized.type.includes(',')) {
      normalized.type = normalized.type.split(',').map((s: string) => s.trim()).filter(Boolean);
    }

    if (normalized.type && !normalized.searchType) {
      if (['observations', 'sessions', 'prompts'].includes(normalized.type)) {
        normalized.searchType = normalized.type;
        delete normalized.type;
      }
    }

    // Accept all three spellings of the date window (see SearchManager.ts for
    // the same normalization — upstream 309125bd).
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

    const rawPlatformSource = normalized.platformSource ?? normalized.platform_source;
    if (typeof rawPlatformSource === 'string' && rawPlatformSource.trim()) {
      normalized.platformSource = normalizePlatformSource(rawPlatformSource);
    } else {
      delete normalized.platformSource;
    }
    delete normalized.platform_source;

    return normalized;
  }
}
