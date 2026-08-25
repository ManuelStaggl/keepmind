// SPDX-License-Identifier: Apache-2.0
//
// A record that contains your wording is not ranked by how much it resembles it.
//
// Measured against the running worker over 25 sentences lifted verbatim out of
// records' BODIES: the record they came from was returned at rank 1 in 56% of
// cases and not in the top ten at all in 12%. Title quotes all ranked first
// already — `title` carries bm25 weight 10 — which is exactly why the failure
// went unseen: the obvious test could not fail.
//
// Two claims are guarded here, and either one alone is worthless. That a
// verbatim hit LEADS, and that everything else still follows it — a promotion
// that quietly drops the rest of the ranking would pass the first test and
// break search.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../../src/services/sqlite/SessionSearch.js';
import { SearchManager } from '../../../src/services/worker/SearchManager.js';
import { FormattingService } from '../../../src/services/worker/FormattingService.js';
import { TimelineService } from '../../../src/services/worker/TimelineService.js';
import { buildPhraseMatchExpression } from '../../../src/services/sqlite/fts-query.js';

const PROJECT = 'steuerstand';
const EPOCH = 1_755_000_000_000;

/** The sentence that exists in exactly one record, and is searched for. */
const WORDING = 'Der Durchgang an der Prüffläche wurde wieder geöffnet';

describe('what counts as a wording', () => {
  it('asks the whole query as one phrase', () => {
    const expression = buildPhraseMatchExpression('Widerspruch ist Pflicht nicht Höflichkeit');
    expect(expression).toContain('"Widerspruch ist Pflicht nicht Höflichkeit"');
  });

  it('keeps stopwords, because a phrase is a claim about adjacency', () => {
    // `queryTerms` drops "ist" and "nicht" — right for an OR expression, wrong
    // here: it would ask about a sentence nobody wrote.
    expect(buildPhraseMatchExpression('Widerspruch ist Pflicht nicht Höflichkeit')).toContain(' ist ');
  });

  it('offers the phrase in both German spellings', () => {
    const expression = buildPhraseMatchExpression('Die Pruefung ist vollstaendig belegt worden');
    expect(expression).toContain('Prüfung ist vollständig');
    expect(expression).toContain(' OR ');
  });

  it('is not a phrase when it is a couple of words', () => {
    expect(buildPhraseMatchExpression('Prüfung')).toBeNull();
    expect(buildPhraseMatchExpression('offene Prüfung')).toBeNull();
    expect(buildPhraseMatchExpression('die offene Prüfung')).toBeNull();
  });

  it('is not a phrase when nothing in it carries meaning', () => {
    // Four tokens, all of them function words. Promoting every record that
    // happens to contain them would replace the ranking with an accident.
    expect(buildPhraseMatchExpression('und dann ist es')).toBeNull();
  });

  it('takes a phrase the user quoted as written', () => {
    expect(buildPhraseMatchExpression('"Lizenz nennen ist nicht mitliefern"'))
      .toBe('"Lizenz nennen ist nicht mitliefern"');
  });

  it('has nothing to ask about an empty query', () => {
    expect(buildPhraseMatchExpression('   ')).toBeNull();
  });
});

describe('search: exact wording leads', () => {
  let store: SessionStore;
  let search: SessionSearch;
  let quoted: number;
  let scattered: number[];

  function seedObservation(title: string, narrative: string, epoch = EPOCH): number {
    return store.storeObservation(
      'mem-curated',
      PROJECT,
      {
        type: 'decision',
        title,
        subtitle: null,
        facts: [],
        narrative,
        concepts: [],
        files_read: [],
        files_modified: [],
        metadata: null,
        source_kind: 'curated',
      },
      1,
      0,
      epoch,
    ).id;
  }

  beforeEach(() => {
    store = new SessionStore(':memory:');
    search = new SessionSearch(store.db);
    const sdkId = store.createSDKSession('content-curated', PROJECT, 'prompt', undefined, 'claude');
    store.ensureMemorySessionIdRegistered(sdkId, 'mem-curated');

    // The record that holds the wording, and holds it in its BODY — its title
    // says nothing about it, so the bm25 weight that hides this failure in the
    // obvious test is not available here.
    quoted = seedObservation(
      '0068 — Beurteilt wird in echten Anwendungen',
      `Ein Vorbericht ersetzt keine Anwendung.\n\n${WORDING}, nachdem die Messung stand.`,
    );

    // Records using the same words apart. bm25 cannot tell them from the one
    // above: FTS5 does not reward adjacency.
    scattered = [
      seedObservation('0012 — Der Durchgang', 'Der Durchgang wurde geöffnet. Die Prüffläche wartet noch.'),
      seedObservation('0013 — Prüffläche', 'An der Prüffläche wurde nichts geöffnet, der Durchgang bleibt zu.'),
      seedObservation('0014 — Wieder geöffnet', 'Wieder geöffnet wurde der Durchgang an keiner Prüffläche.'),
    ];
  });

  afterEach(() => {
    store.close();
  });

  it('finds the record holding the wording, and only that one', () => {
    const ids = search.observationIdsMatchingPhrase(WORDING, { project: PROJECT });

    expect(ids).toEqual([quoted]);
  });

  it('honours the filters, so a promotion cannot smuggle a row past them', () => {
    expect(search.observationIdsMatchingPhrase(WORDING, { project: PROJECT, sourceKind: 'observed' })).toEqual([]);
    expect(search.observationIdsMatchingPhrase(WORDING, { project: 'anderes-projekt' })).toEqual([]);
  });

  it('says nothing about a query that is not a wording', () => {
    expect(search.observationIdsMatchingPhrase('Prüffläche', { project: PROJECT })).toEqual([]);
  });

  it('puts the record with the wording first even when the ranking buried it', async () => {
    // The semantic leg carries three quarters of the fused weight, so a dense
    // list that ranks the quoted record LAST is what the promotion has to beat.
    const denseIds = [...scattered, quoted];
    const stubbedVectors = {
      queryChroma: async () => ({
        ids: denseIds,
        distances: denseIds.map(() => 0.1),
        metadatas: denseIds.map(() => ({ doc_type: 'observation', created_at_epoch: Date.now() })),
      }),
    };
    const manager = new SearchManager(
      search,
      store,
      stubbedVectors as never,
      new FormattingService(),
      new TimelineService(store),
    );

    const result = await manager.search({ query: WORDING, project: PROJECT, format: 'json' });

    expect(result.observations[0].id).toBe(quoted);
    // …and the rest of the ranking is still there, in its own order.
    expect(result.observations.length).toBe(denseIds.length);
    expect(result.observations.slice(1).map((o: { id: number }) => o.id).sort()).toEqual([...scattered].sort());
  });

  it('leaves a ranking alone when nothing matches the wording', async () => {
    const denseIds = [...scattered, quoted];
    const stubbedVectors = {
      queryChroma: async () => ({
        ids: denseIds,
        distances: denseIds.map(() => 0.1),
        metadatas: denseIds.map(() => ({ doc_type: 'observation', created_at_epoch: Date.now() })),
      }),
    };
    const manager = new SearchManager(
      search,
      store,
      stubbedVectors as never,
      new FormattingService(),
      new TimelineService(store),
    );

    // A paraphrase — the ordinary case. No record contains it verbatim, so the
    // fused ranking must come back untouched rather than reordered by accident.
    const result = await manager.search({
      query: 'Wurde die Fläche für die Beurteilung erneut freigegeben?',
      project: PROJECT,
      format: 'json',
    });

    expect(result.observations[0].id).toBe(scattered[0]);
  });
});
