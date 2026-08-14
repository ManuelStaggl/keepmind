import { describe, it, expect } from 'bun:test';
import { buildFtsMatchExpression, queryTerms, spellingVariants } from '../../src/services/sqlite/fts-query.js';

describe('the phrase bug this module exists to fix', () => {
  it('does not wrap a multi-word question in one phrase', () => {
    // The old code produced `"Gestaltung Regelwerk"`, which matched only where
    // that exact word sequence appeared. Measured against the real corpus:
    // 0 rows, where the two words separately matched 2.
    const expression = buildFtsMatchExpression('Gestaltung Regelwerk');
    expect(expression).not.toBe('"Gestaltung Regelwerk"');
    expect(expression).toContain(' OR ');
  });

  it('connects terms with OR, so a word the record does not use cannot empty the result', () => {
    const expression = buildFtsMatchExpression('Wo sitzt der Zurückknopf');
    expect(expression).not.toContain(' AND ');
  });
});

describe('quoting', () => {
  it('quotes every term, so an FTS operator in the question is not parsed as syntax', () => {
    const expression = buildFtsMatchExpression('NEAR AND budget');
    // "NEAR" and "AND" survive as searchable words rather than throwing.
    expect(expression).toContain('"NEAR"');
    expect(expression).toContain('"budget"');
  });

  it('keeps a phrase the user quoted themselves', () => {
    const expression = buildFtsMatchExpression('"Gestaltung gehört nicht ins Regelwerk"');
    expect(expression).toBe('"Gestaltung gehört nicht ins Regelwerk"');
  });

  it('returns null when there is nothing searchable, rather than an invalid empty MATCH', () => {
    expect(buildFtsMatchExpression('   ')).toBeNull();
    expect(buildFtsMatchExpression('!!! ???')).toBeNull();
  });
});

describe('stopwords', () => {
  it('drops German function words', () => {
    expect(queryTerms('Was gilt zu der Größe')).toEqual(['gilt', 'Größe']);
  });

  it('keeps them when they are all the question has', () => {
    // Dropping every term would leave an empty MATCH and return the table.
    expect(queryTerms('was ist das')).toEqual(['was', 'ist', 'das']);
  });

  it('never drops a negation', () => {
    // Guarded here as well as in the reconciler: a stopword may remove noise,
    // never meaning.
    expect(queryTerms('nicht ins Regelwerk')).toContain('nicht');
    expect(queryTerms('kein eigener Inhalt')).toContain('kein');
  });
});

describe('German spellings', () => {
  it('finds the umlaut form from the ASCII form and back', () => {
    expect(spellingVariants('Prüfung')).toContain('Pruefung');
    expect(spellingVariants('Pruefung')).toContain('Prüfung');
  });

  it('transliterates ß, which unicode61 leaves alone', () => {
    expect(spellingVariants('Maßstab')).toContain('Massstab');
    expect(spellingVariants('Massstab')).toContain('Maßstab');
  });

  it('handles a compound carrying two different umlauts', () => {
    expect(spellingVariants('Prüffläche')).toContain('Pruefflaeche');
    expect(spellingVariants('Pruefflaeche')).toContain('Prüffläche');
  });

  it('puts both spellings of every term into the expression', () => {
    const expression = buildFtsMatchExpression('Größenbudget');
    expect(expression).toContain('"Größenbudget"');
    expect(expression).toContain('"Groessenbudget"');
  });

  it('produces a non-word for an ambiguous back-transliteration without breaking the query', () => {
    // "Steuerung" -> "Steürung" is wrong. It is also harmless: an OR term that
    // matches nothing costs nothing. This is why the connector may not be AND.
    const variants = spellingVariants('Steuerung');
    expect(variants).toContain('Steuerung');
    expect(buildFtsMatchExpression('Steuerung')).toContain(' OR ');
  });

  it('leaves a term without umlauts alone', () => {
    expect(spellingVariants('Regelwerk')).toEqual(['Regelwerk']);
  });
});

describe('identifiers', () => {
  it('keeps a hyphenated identifier in one piece', () => {
    // MUST stay in step with `tokenize="unicode61 tokenchars '-'"` on
    // observations_fts. Measured with the index changed and this left
    // splitting: every identifier query returned NOTHING — 0% where it had
    // been 100% at rank 10, with no error raised anywhere. Whole: a bare
    // identifier goes from 29% to 100% at rank 1.
    expect(queryTerms('V-0169')).toEqual(['V-0169']);
    expect(buildFtsMatchExpression('V-0169')).toBe('"V-0169"');
  });

  it('keeps the identifier whole inside a sentence', () => {
    expect(queryTerms('Welche Entscheidung schliesst V-0076?')).toContain('V-0076');
  });

  it('strips a leading or trailing dash, which is punctuation', () => {
    expect(queryTerms('— Entscheidung —')).toEqual(['Entscheidung']);
    expect(queryTerms('Regelwerk -')).toEqual(['Regelwerk']);
  });
});
