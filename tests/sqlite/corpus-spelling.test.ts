import { describe, it, expect } from 'bun:test';
import {
  attestedSpelling,
  canonicalSpelling,
  vocabFold,
  type SpellingVocabulary,
} from '../../src/services/sqlite/corpus-spelling.js';

/** A vocabulary built from measured document counts on the live corpus. */
function vocabularyOf(counts: Record<string, number>): SpellingVocabulary {
  return { documentsWith: (term: string) => counts[term] ?? 0 };
}

/** The pairs as `observations_fts` actually holds them (333-record corpus). */
const LIVE = vocabularyOf({
  prufung: 65, pruefung: 20,
  vollstandig: 64, vollstaendig: 8,
  ausdrucklich: 98, ausdruecklich: 32,
  ablosung: 21,
  maßstab: 19, massstab: 9,
  steuerung: 26,
  masse: 11, maße: 36,
});

describe('the index folds terms its own way, not the reconciler\'s', () => {
  it('removes diacritics rather than transliterating them', () => {
    // `fold()` in the reconciler answers 'pruefung' here. The index answers
    // 'prufung', and a lookup spelled the other way finds nothing at all.
    expect(vocabFold('Prüfung')).toBe('prufung');
    expect(vocabFold('Ablösung')).toBe('ablosung');
  });

  it('leaves ß alone, because unicode61 does', () => {
    expect(vocabFold('Maßstab')).toBe('maßstab');
  });

  it('lowercases, so a capitalised query term still addresses the index', () => {
    expect(vocabFold('VOLLSTÄNDIG')).toBe('vollstandig');
  });
});

describe('the corpus decides the spelling', () => {
  it('rewrites the ASCII spelling into the one the corpus attests more often', () => {
    expect(attestedSpelling('Pruefung', LIVE)).toBe('Prüfung');
    expect(attestedSpelling('Abloesung', LIVE)).toBe('Ablösung');
    expect(attestedSpelling('Massstab', LIVE)).toBe('Maßstab');
  });

  it('leaves the dominant spelling alone', () => {
    expect(attestedSpelling('Prüfung', LIVE)).toBe('Prüfung');
    expect(attestedSpelling('Maßstab', LIVE)).toBe('Maßstab');
  });

  it('resolves both spellings to the SAME text — which is the whole point', () => {
    // Two vectors cannot be OR'd. The two queries have to become one query, or
    // the semantic channel keeps answering them differently.
    for (const pair of [['Prüfung', 'Pruefung'], ['vollständig', 'vollstaendig'], ['ausdrücklich', 'ausdruecklich']]) {
      expect(attestedSpelling(pair[0], LIVE)).toBe(attestedSpelling(pair[1], LIVE));
    }
  });
});

describe('an unattested spelling is never chosen', () => {
  it('does not turn a real word into the non-word its variant produces', () => {
    // `ue → ü` yields "Steürung". In the keyword channel that costs nothing —
    // a term that does not occur matches nothing. Here it would be a nonsense
    // vector with a hundred nearest neighbours, all of them noise.
    expect(attestedSpelling('Steuerung', LIVE)).toBe('Steuerung');
  });

  it('leaves a word the corpus does not contain in either spelling as typed', () => {
    expect(attestedSpelling('Feuerwerk', LIVE)).toBe('Feuerwerk');
    expect(attestedSpelling('Pruefnorm', LIVE)).toBe('Pruefnorm');
  });

  it('rewrites even a term the query spells in a form the corpus never uses', () => {
    // "abloesung" is absent; "ablosung" (i.e. Ablösung) has 21 documents.
    expect(attestedSpelling('Abloesung', LIVE)).toBe('Ablösung');
  });
});

describe('the choice cannot depend on the order the variants were generated in', () => {
  it('picks the same spelling from either end of an equally attested pair', () => {
    const tied = vocabularyOf({ grosse: 12, große: 12 });
    expect(attestedSpelling('Grosse', tied)).toBe(attestedSpelling('Große', tied));
  });

  it('prefers the German form when the counts tie', () => {
    const tied = vocabularyOf({ grosse: 12, große: 12 });
    expect(attestedSpelling('Grosse', tied)).toBe('Große');
  });
});

describe('rewriting a whole query', () => {
  it('keeps punctuation and word order, because an embedder reads the text', () => {
    expect(canonicalSpelling('Wie wird die Pruefung vollstaendig belegt?', LIVE))
      .toBe('Wie wird die Prüfung vollständig belegt?');
  });

  it('leaves a query with nothing to correct byte-identical', () => {
    const query = 'Welche Entscheidung schliesst V-0076 ab?';
    // Only terms with an attested alternative may move; "schliesst" has none
    // in this vocabulary, so the query must come back untouched.
    expect(canonicalSpelling(query, vocabularyOf({}))).toBe(query);
  });

  it('does not split a hyphenated identifier', () => {
    expect(canonicalSpelling('V-0076', LIVE)).toBe('V-0076');
  });

  it('is a fixed point: canonicalising twice changes nothing further', () => {
    const once = canonicalSpelling('Pruefung und Abloesung', LIVE);
    expect(canonicalSpelling(once, LIVE)).toBe(once);
  });
});

describe('the cost of a rewrite, recorded rather than hidden', () => {
  it('moves a word whose other spelling is a different German word', () => {
    // `Masse` and `Maße` are not the same word. This corpus writes `maße` 36
    // times and `masse` 11, so the semantic leg embeds the question about
    // `Masse` as `Maße`. Nothing becomes unfindable — the keyword leg still
    // carries the spelling as typed and still ORs both — but the semantic leg
    // does move, and that is the price of having one vector instead of two.
    expect(attestedSpelling('Masse', LIVE)).toBe('Maße');
  });
});
