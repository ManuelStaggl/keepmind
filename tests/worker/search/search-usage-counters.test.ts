import { describe, it, expect, mock } from 'bun:test';
import { SearchManager } from '../../../src/services/worker/SearchManager.js';

/**
 * ACCEPTANCE TEST 6 — a hit via keyword AND via similarity search increments the
 * respective counter.
 *
 * This is the regression test for a measurement bug, not a feature gap. The
 * channel columns and SearchOrchestrator.recordUsage were both correct — but the
 * orchestrator only serves the corpus path, while the MCP search tools call
 * SearchManager.search(), which touched no counter. So fts_hit_count and
 * vector_hit_count read 0 across all 51,355 rows and search looked unused when
 * it was merely uninstrumented.
 *
 * The test therefore drives SearchManager.search() — the path the tools actually
 * take — rather than the orchestrator.
 */

const observation = {
  id: 42,
  memory_session_id: 'mem-1',
  project: 'proj',
  text: null,
  type: 'discovery',
  title: 'a finding',
  subtitle: null,
  facts: '[]',
  narrative: 'n',
  concepts: '[]',
  files_read: '[]',
  files_modified: '[]',
  prompt_number: 1,
  discovery_tokens: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  created_at_epoch: 1_767_225_600_000,
};

function buildManager(options: { withChroma: boolean }) {
  const marked: Array<{ ids: number[]; channel: string }> = [];

  const sessionSearch = {
    searchObservations: mock(() => [observation]),
    searchSessions: mock(() => []),
    searchUserPrompts: mock(() => []),
  };

  const sessionStore = {
    markObservationsUsed: mock((ids: number[], channel: string) => {
      marked.push({ ids, channel });
    }),
    getObservationsByIds: mock(() => [observation]),
    getSessionSummariesByIds: mock(() => []),
    getUserPromptsByIds: mock(() => []),
  };

  const chromaSync = options.withChroma
    ? {
        queryChroma: mock(() => Promise.resolve({
          ids: ['observation_42'],
          distances: [0.1],
          metadatas: [{ doc_type: 'observation' }],
        })),
      }
    : null;

  const manager = new SearchManager(
    sessionSearch as any,
    sessionStore as any,
    chromaSync as any,
    { } as any,
    { } as any,
  );

  return { manager, marked, sessionStore };
}

describe('search usage counters on the productive path (acceptance test 6)', () => {
  it('counts a keyword hit against fts', async () => {
    const { manager, marked } = buildManager({ withChroma: false });

    await manager.search({ query: 'finding', searchType: 'observations', format: 'json', limit: 5 });

    expect(marked.length).toBe(1);
    expect(marked[0].channel).toBe('fts');
    expect(marked[0].ids).toContain(42);
  });

  it('counts a similarity hit against vector', async () => {
    const { manager, marked } = buildManager({ withChroma: true });

    await manager.search({ query: 'finding', searchType: 'observations', format: 'json', limit: 5 });

    expect(marked.length).toBe(1);
    expect(marked[0].channel).toBe('vector');
    expect(marked[0].ids).toContain(42);
  });

  it('records nothing when the search returns nothing', async () => {
    const { manager, marked } = buildManager({ withChroma: false });
    (manager as any).sessionSearch.searchObservations = mock(() => []);

    await manager.search({ query: 'nothing matches', searchType: 'observations', format: 'json', limit: 5 });

    expect(marked.length).toBe(0);
  });

  it('never lets a bookkeeping failure break a search', async () => {
    const { manager, sessionStore } = buildManager({ withChroma: false });
    sessionStore.markObservationsUsed = mock(() => { throw new Error('db is locked'); });

    const result = await manager.search({ query: 'finding', searchType: 'observations', format: 'json', limit: 5 });

    expect(result.observations.length).toBe(1);
  });
});
