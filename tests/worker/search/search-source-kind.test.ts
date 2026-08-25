// SPDX-License-Identifier: Apache-2.0
//
// A search can be scoped to what a person wrote, and says which hits those are.
//
// Measured against the running worker before this existed: a search for
// "Wortlaut" returned curated record V-0110 under the heading `General`,
// spelled exactly like the model summaries around it, and there was no
// parameter that could have excluded them. Two claims are guarded here — that
// the filter returns ONLY lasting entries, and that a lasting entry is
// distinguishable in the output — because either one alone is useless: an
// unmarked filtered result is only trustworthy if you remember what you asked
// for, and a marked unfiltered result still buries the entry.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../../src/services/sqlite/SessionSearch.js';
import { SearchManager } from '../../../src/services/worker/SearchManager.js';
import { FormattingService } from '../../../src/services/worker/FormattingService.js';
import { TimelineService } from '../../../src/services/worker/TimelineService.js';
import {
  normalizeSourceKind,
  sourceKindCondition,
} from '../../../src/services/sqlite/source-kind.js';
import {
  curatedHitOf,
  curatedGroupLabel,
} from '../../../src/services/curated/search-label.js';
import { CHECKPOINT_TYPE } from '../../../src/shared/checkpoint.js';

const PROJECT = 'steuerstand';
const EPOCH = 1_755_000_000_000;

describe('search: origin filter', () => {
  let store: SessionStore;
  let search: SessionSearch;
  let manager: SearchManager;

  function seedSession(memorySessionId: string): void {
    const sdkId = store.createSDKSession(`content-${memorySessionId}`, PROJECT, 'prompt', undefined, 'claude');
    store.ensureMemorySessionIdRegistered(sdkId, memorySessionId);
  }

  function seedObservation(opts: {
    memorySessionId: string;
    title: string;
    narrative: string;
    sourceKind?: string | null;
    metadata?: string | null;
    type?: string;
    epoch?: number;
  }): number {
    return store.storeObservation(
      opts.memorySessionId,
      PROJECT,
      {
        type: opts.type ?? 'decision',
        title: opts.title,
        subtitle: null,
        facts: [],
        narrative: opts.narrative,
        concepts: [],
        files_read: [],
        files_modified: [],
        metadata: opts.metadata ?? null,
        source_kind: opts.sourceKind ?? null,
      },
      1,
      0,
      opts.epoch ?? EPOCH,
    ).id;
  }

  beforeEach(() => {
    store = new SessionStore(':memory:');
    search = new SessionSearch(store.db);
    manager = new SearchManager(search, store, null, new FormattingService(), new TimelineService(store));

    seedSession('mem-curated');
    seedSession('mem-observed');
    seedSession('mem-legacy');

    seedObservation({
      memorySessionId: 'mem-curated',
      title: '0138 — Belegfrist',
      narrative: 'Belege bleiben sieben Jahre liegen.',
      sourceKind: 'curated',
      metadata: JSON.stringify({ record_id: '0138' }),
    });
    seedObservation({
      memorySessionId: 'mem-curated',
      title: 'V-0110 — Ablage neu ordnen',
      narrative: 'Belege sollen nach Kalenderjahr geordnet werden.',
      sourceKind: 'curated',
      metadata: JSON.stringify({ vorgang_id: 'V-0110', kind: 'vorgang' }),
    });
    seedObservation({
      memorySessionId: 'mem-observed',
      title: 'Belegimport repariert',
      narrative: 'Der Import der Belege lief wieder durch.',
      sourceKind: 'observed',
      type: 'bugfix',
    });
    // The pre-3.x shape: written before the column existed, so NULL.
    seedObservation({
      memorySessionId: 'mem-legacy',
      title: 'Belege aus dem Altbestand',
      narrative: 'Alte Belege wurden gesichtet.',
      sourceKind: null,
      type: 'discovery',
    });
  });

  afterEach(() => {
    store.close();
  });

  describe('the clause itself', () => {
    it('widens an unrecognised value instead of narrowing it', () => {
      // An over-narrow result is indistinguishable from "nothing was found",
      // which is the failure this project keeps paying for.
      expect(normalizeSourceKind('kuratiert')).toBe('all');
      expect(normalizeSourceKind(undefined)).toBe('all');
      expect(normalizeSourceKind('CURATED')).toBe('curated');
      expect(sourceKindCondition('all')).toBeNull();
      expect(sourceKindCondition('curated', 'o')?.sql).toBe("COALESCE(o.source_kind, 'observed') = ?");
    });
  });

  describe('keyword path', () => {
    it('returns only lasting entries when asked for them', () => {
      const rows = search.searchObservations('Belege', { project: PROJECT, sourceKind: 'curated' });

      expect(rows.length).toBe(2);
      expect(rows.every((r) => r.source_kind === 'curated')).toBe(true);
    });

    it('counts a row written before the column existed as observed', () => {
      // The silent one: a plain `source_kind = 'observed'` drops every
      // pre-curated row and the answer still looks like an ordinary result.
      const rows = search.searchObservations('Belege', { project: PROJECT, sourceKind: 'observed' });
      const titles = rows.map((r) => r.title);

      expect(titles).toContain('Belege aus dem Altbestand');
      expect(titles).toContain('Belegimport repariert');
      expect(titles.some((t) => t?.startsWith('0138'))).toBe(false);
    });

    it('returns both kinds by default', () => {
      const rows = search.searchObservations('Belege', { project: PROJECT });

      expect(rows.length).toBe(4);
    });
  });

  describe('hydration path (the semantic leg)', () => {
    it('filters candidates the vector index could not filter itself', () => {
      // vec_items has no source_kind column, so its candidates arrive
      // unfiltered and this is the only place the filter can be applied.
      const allIds = search.searchObservations('Belege', { project: PROJECT }).map((r) => r.id);

      const curated = store.getObservationsByIds(allIds, { sourceKind: 'curated' });
      const observed = store.getObservationsByIds(allIds, { sourceKind: 'observed' });

      expect(curated.length).toBe(2);
      expect(curated.every((r) => r.source_kind === 'curated')).toBe(true);
      expect(observed.length).toBe(2);
      expect(store.getObservationsByIds(allIds).length).toBe(4);
    });
  });

  describe('what the row says it is', () => {
    it('reads the kind off either namespace key', () => {
      const rows = search.searchObservations('Belege', { project: PROJECT, sourceKind: 'curated' });
      const byTitle = new Map(rows.map((r) => [r.title, curatedHitOf(r)]));

      expect(byTitle.get('0138 — Belegfrist')).toEqual({ kind: 'akte', recordId: '0138' });
      expect(byTitle.get('V-0110 — Ablage neu ordnen')).toEqual({ kind: 'vorgang', recordId: 'V-0110' });
    });

    it('labels a curated row carrying no number without calling it a decision', () => {
      // The event log is stored as a curated row with no entry number
      // precisely so it can never answer as an entry — it still has to read as
      // verbatim text, and the numbered-lookup fallback of 'akte' would label
      // it a decision record, which is a wrong answer rather than a rough one.
      const hit = curatedHitOf({ source_kind: 'curated', metadata: JSON.stringify({ kind: 'ereignis-log' }) });

      expect(hit).toEqual({ kind: 'verbatim', recordId: null });
      expect(curatedGroupLabel(hit!)).not.toContain('decisions');
    });

    it('names a session checkpoint as what it is', () => {
      const hit = curatedHitOf({
        type: CHECKPOINT_TYPE,
        source_kind: 'curated',
        metadata: JSON.stringify({ checkpoint: true, focus: 'weg-b' }),
      });

      expect(hit).toEqual({ kind: 'checkpoint', recordId: null });
      expect(curatedGroupLabel(hit!)).toContain('session hand-off');
    });

    it('says nothing about an observed row', () => {
      expect(curatedHitOf({ source_kind: null, metadata: null })).toBeNull();
      expect(curatedHitOf({ source_kind: 'observed', metadata: null })).toBeNull();
    });
  });

  describe('the rendered result', () => {
    async function searchText(args: Record<string, unknown>): Promise<string> {
      const result = await manager.search({ query: 'Belege', project: PROJECT, ...args });
      return result.content[0].text as string;
    }

    it('groups a lasting entry by what it is, not under General', async () => {
      const text = await searchText({});

      expect(text).toContain('Lasting entries · akte (decisions)');
      expect(text).toContain('Lasting entries · vorgang (open work items)');
      expect(text).toContain('Lasting entries are stored verbatim');
      expect(text).toContain('0138 — Belegfrist');
    });

    it('returns only lasting entries when filtered, and says so', async () => {
      const text = await searchText({ sourceKind: 'curated' });

      expect(text).toContain('Found 2 lasting entries');
      expect(text).toContain('verbatim only, nothing observed');
      expect(text).toContain('0138 — Belegfrist');
      expect(text).not.toContain('Belegimport repariert');
      expect(text).not.toContain('Belege aus dem Altbestand');
    });

    it('accepts the column spelling as well as the parameter spelling', async () => {
      // The HTTP layer forwards whatever the query string carried.
      const text = await searchText({ source_kind: 'curated' });

      expect(text).toContain('Found 2 lasting entries');
    });

    it('excludes session summaries and prompts, which have no origin', async () => {
      store.importSessionSummary({
        memory_session_id: 'mem-observed',
        project: PROJECT,
        request: 'Belege sortieren',
        investigated: null,
        learned: null,
        completed: null,
        next_steps: null,
        files_read: null,
        files_edited: null,
        notes: null,
        prompt_number: 1,
        discovery_tokens: 0,
        created_at: new Date(EPOCH).toISOString(),
        created_at_epoch: EPOCH,
      });

      expect(await searchText({})).toContain('Belege sortieren');
      expect(await searchText({ sourceKind: 'curated' })).not.toContain('Belege sortieren');
    });

    it('survives a semantic leg that filled the fusion cap with observed rows', async () => {
      // The measured regression. Reciprocal-rank fusion caps its output at 100
      // and weights the semantic leg at 0.75, so unfiltered semantic candidates
      // fill the cap on their own and hydration then discards nearly all of
      // them: `sourceKind=curated` without a project filter returned 1 of 20
      // matching entries against the real corpus. Guarded by making the dense
      // side big enough to fill the cap by itself.
      const now = Date.now();
      const denseIds: number[] = [];
      for (let i = 0; i < 120; i++) {
        denseIds.push(seedObservation({
          memorySessionId: 'mem-observed',
          title: `Belegstapel ${i} gesichtet`,
          narrative: `Belege im Stapel ${i} wurden durchgesehen.`,
          sourceKind: 'observed',
          type: 'discovery',
          epoch: now,
        }));
      }

      const stubbedVectors = {
        queryChroma: async () => ({
          ids: denseIds,
          distances: denseIds.map(() => 0.1),
          metadatas: denseIds.map(() => ({ doc_type: 'observation', created_at_epoch: now })),
        }),
      };
      const hybrid = new SearchManager(
        search,
        store,
        stubbedVectors as never,
        new FormattingService(),
        new TimelineService(store),
      );

      const result = await hybrid.search({
        query: 'Belege',
        project: PROJECT,
        sourceKind: 'curated',
        format: 'json',
      });

      expect(result.observations.length).toBe(2);
      expect(result.observations.every((o: { source_kind?: string | null }) => o.source_kind === 'curated')).toBe(true);
    });

    it('leaves an ordinary search untouched', async () => {
      const text = await searchText({ sourceKind: 'observed' });

      expect(text).toContain('Belegimport repariert');
      expect(text).not.toContain('Lasting entries ·');
    });
  });
});
