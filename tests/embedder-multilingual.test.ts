// SPDX-License-Identifier: Apache-2.0
//
// Guards the cross-language search fix.
//
// The vector path could not cross a language boundary: observations are titled
// and summarised in English, questions are often not, and all-MiniLM-L6-v2 is
// English-only. Same data, same meaning — "theme switch crash WPF" returned 6
// on-point observations, the German phrasing returned 0.
//
// These tests cover the two mechanical halves of the fix that CAN be asserted
// without loading a 120 MB model: the query/passage asymmetry (getting it wrong
// silently degrades retrieval) and the index identity stamp (without which a
// model change mixes two incomparable vector spaces and looks like "search
// stopped working").

import { describe, it, expect } from 'bun:test';
import { EmbedderService, EMBED_DIM } from '../src/services/vector/EmbedderService.js';
import { decideEmbeddingSpaceAction } from '../src/services/sync/VectorSync.js';

/** Reach past the singleton so each case gets a known model id. */
function embedderFor(modelId: string): EmbedderService {
  const instance = Object.create(EmbedderService.prototype) as EmbedderService;
  Object.assign(instance, {
    modelId,
    dtype: 'int8',
    needsPrefix: /(^|[/-])e5([-/]|$)/i.test(modelId),
  });
  return instance;
}

/** decorate() is private; exercise it the way embed() does. */
function decorate(embedder: EmbedderService, texts: string[], kind: 'query' | 'passage'): string[] {
  return (embedder as unknown as {
    decorate(t: string[], k: 'query' | 'passage'): string[];
  }).decorate(texts, kind);
}

describe('embedder: default model', () => {
  it('defaults to a multilingual model', () => {
    // The whole point of the change. An English-only default silently caps
    // recall for every non-English query.
    const identity = EmbedderService.instance().identity();
    expect(identity.toLowerCase()).toContain('multilingual');
  });

  it('keeps the 384-dimensional vec0 schema', () => {
    // Chosen precisely so no schema migration is needed — only a re-embed.
    expect(EMBED_DIM).toBe(384);
    expect(EmbedderService.instance().identity()).toContain('|384');
  });
});

describe('embedder: query/passage asymmetry', () => {
  it('labels queries and passages differently for e5 models', () => {
    const e5 = embedderFor('Xenova/multilingual-e5-small');
    expect(decorate(e5, ['crash on theme switch'], 'query')).toEqual(['query: crash on theme switch']);
    expect(decorate(e5, ['crash on theme switch'], 'passage')).toEqual(['passage: crash on theme switch']);
  });

  it('leaves symmetric models untouched', () => {
    // Applying an e5 prefix to a model that was not trained with one degrades
    // retrieval, so the prefix must follow the model, not the code path.
    const minilm = embedderFor('Xenova/all-MiniLM-L6-v2');
    expect(decorate(minilm, ['crash on theme switch'], 'query')).toEqual(['crash on theme switch']);
    expect(decorate(minilm, ['crash on theme switch'], 'passage')).toEqual(['crash on theme switch']);
  });

  it('recognises the e5 family without matching unrelated names', () => {
    for (const id of ['intfloat/multilingual-e5-large', 'Xenova/e5-base', 'some/e5']) {
      expect(embedderFor(id)).toHaveProperty('needsPrefix', true);
    }
    // 'e5' must not match as a substring of an unrelated model name.
    for (const id of ['Xenova/all-MiniLM-L6-v2', 'org/reverse5-model', 'org/base5']) {
      expect(embedderFor(id)).toHaveProperty('needsPrefix', false);
    }
  });
});

describe('embedder: index identity', () => {
  it('changes when the model changes', () => {
    // This string is what the store is stamped with; if two different models
    // produced the same identity, the stale-index detection would not fire.
    const a = embedderFor('Xenova/multilingual-e5-small').identity();
    const b = embedderFor('Xenova/all-MiniLM-L6-v2').identity();
    expect(a).not.toBe(b);
  });

  it('changes when the quantization changes', () => {
    const base = embedderFor('Xenova/multilingual-e5-small');
    const other = embedderFor('Xenova/multilingual-e5-small');
    Object.assign(other, { dtype: 'fp32' });
    // Different dtype means different vectors, so it must invalidate the index.
    expect(base.identity()).not.toBe(other.identity());
  });
});

describe('stale-index detection', () => {
  const NEW = 'Xenova/multilingual-e5-small|int8|384';
  const OLD = 'Xenova/all-MiniLM-L6-v2|int8|384';

  it('leaves a matching index alone', () => {
    expect(decideEmbeddingSpaceAction(NEW, NEW, 12_345)).toBe('current');
    expect(decideEmbeddingSpaceAction(NEW, NEW, 0)).toBe('current');
  });

  it('rebuilds when the recorded model differs', () => {
    expect(decideEmbeddingSpaceAction(OLD, NEW, 12_345)).toBe('rebuild');
  });

  it('only stamps a fresh, empty store', () => {
    expect(decideEmbeddingSpaceAction(null, NEW, 0)).toBe('stamp');
  });

  it('rebuilds an untracked but populated store', () => {
    // The case that matters for every existing install: ~35k observations
    // embedded by an unknown (pre-tracking) model. Treating this as 'current'
    // would leave the English-only index in place forever — the bug, not a fix.
    expect(decideEmbeddingSpaceAction(null, NEW, 35_000)).toBe('rebuild');
  });
});
