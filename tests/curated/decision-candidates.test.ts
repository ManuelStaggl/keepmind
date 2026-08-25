// SPDX-License-Identifier: Apache-2.0
//
// What a decision candidate shows a reader — the one filter there is, because
// three measurements say these candidates cannot be filtered by similarity
// with this embedder (see the module header).

import { describe, it, expect } from 'bun:test';
import {
  findingOf, usable, toCandidates, FINDING_LIMIT,
} from '../../src/services/curated/decision-candidates.js';

const RECORD = `**Stand:** gilt · **Datum:** 11.08.2026 · **Entschieden von:** Manuel

> Nachträglich abgelegt am 12.08.2026.

## Ausgangslage

Es war unklar, wo die Grenze verläuft.

## Entscheidung

Die Grenze ist das Firmennetz, nicht das Internet. Alles innerhalb gilt als
erreichbar, alles außerhalb braucht einen Auftrag.

## Folgen

Zwei Vorgänge werden umgeschrieben.`;

const row = (over: Record<string, unknown> = {}) => ({
  source_kind: 'curated', type: 'decision', valid_to: null,
  title: '0110 — Die Grenze ist das Firmennetz, nicht das Internet',
  subtitle: '**Stand:** gilt · **Datum:** 11.08.2026 · **Entschieden von:** Manuel',
  narrative: RECORD, metadata: null, source_path: 'C:/akten/0110.md', source_line: 1,
  ...over,
});

describe('the finding, not the filing', () => {
  it('shows what the record decided, not its header line', () => {
    // The header line is what the old rendering showed, and it is the same for
    // every record — a false candidate looked exactly like a real one.
    const finding = findingOf(row());
    expect(finding).toContain('Die Grenze ist das Firmennetz, nicht das Internet.');
    expect(finding).not.toContain('**Stand:**');
    expect(finding).not.toContain('Entschieden von');
  });

  it('reads the decision, not the situation that preceded it', () => {
    expect(findingOf(row())).not.toContain('Es war unklar');
  });

  it('stops at the next heading rather than running into the consequences', () => {
    expect(findingOf(row())).not.toContain('Zwei Vorgänge');
  });

  it("prefers the author's own one-line summary when the record carries one", () => {
    const finding = findingOf(row({ metadata: JSON.stringify({ summary: 'Firmennetz ist die Grenze.' }) }));
    expect(finding).toBe('Firmennetz ist die Grenze.');
  });

  it('falls back to the narrative when the metadata is unreadable', () => {
    // A malformed blob is not a reason to show nothing: the statement is still
    // in the text.
    expect(findingOf(row({ metadata: '{not json' }))).toContain('Die Grenze ist das Firmennetz');
  });

  it('reads a record with no decision heading at all', () => {
    const finding = findingOf(row({
      narrative: '**Stand:** gilt\n\nEin Satz ohne Überschrift, der trotzdem die Entscheidung ist.',
      metadata: null,
    }));
    expect(finding).toBe('Ein Satz ohne Überschrift, der trotzdem die Entscheidung ist.');
  });

  it('says nothing rather than something wrong when there is no text', () => {
    expect(findingOf(row({ narrative: '', metadata: null }))).toBe('');
    expect(findingOf(row({ narrative: null, metadata: null }))).toBe('');
  });

  it('shortens at a word boundary, so it reads as cut and not as broken', () => {
    const long = `## Entscheidung\n\n${'wortwortwort '.repeat(60)}`;
    const finding = findingOf(row({ narrative: long, metadata: null }));
    expect(finding.length).toBeLessThanOrEqual(FINDING_LIMIT + 1);
    expect(finding.endsWith('…')).toBe(true);
    expect(finding).not.toContain('wortwortwor…');
  });
});

describe('which rows may be offered at all', () => {
  it('keeps a curated decision that still applies', () => {
    expect(usable(row())).toBe(true);
    expect(usable(row({ valid_to: undefined }))).toBe(true);
  });

  it('drops an observation, a work item and a retired decision', () => {
    // An observation records what happened, not what was resolved; a work item
    // is where a decision is carried out, so offering one answers with the task
    // instead of the ruling; a superseded decision answering a live question is
    // worse than no answer at all.
    expect(usable(row({ source_kind: 'observed' }))).toBe(false);
    expect(usable(row({ type: 'change' }))).toBe(false);
    expect(usable(row({ valid_to: 1_700_000_000_000 }))).toBe(false);
  });
});

describe('the candidate list', () => {
  it('carries the record number so the reader can look it up', () => {
    const [candidate] = toCandidates([row({ metadata: JSON.stringify({ record_id: '0110' }) })], 3);
    expect(candidate.recordId).toBe('0110');
    expect(candidate.sourcePath).toBe('C:/akten/0110.md');
  });

  it('honours the row limit after filtering, not before', () => {
    // Filtering after the cut is how a list of three arrives holding one: the
    // same failure shape as filtering search results after the fusion cap.
    const rows = [
      row({ source_kind: 'observed' }), row({ source_kind: 'observed' }),
      row({ metadata: JSON.stringify({ record_id: '0110' }) }),
      row({ metadata: JSON.stringify({ record_id: '0111' }) }),
    ];
    expect(toCandidates(rows, 2)).toHaveLength(2);
  });

  it('offers nothing when nothing usable came back', () => {
    expect(toCandidates([row({ source_kind: 'observed' })], 3)).toEqual([]);
    expect(toCandidates([], 3)).toEqual([]);
  });
});

describe('the finding reads as prose in a terminal', () => {
  it('drops markdown marks and keeps the words', () => {
    const finding = findingOf(row({
      narrative: '## Entscheidung\n\n**Farbfragen** werden hier entschieden, nicht im `Marketing` — siehe [0034](./0034.md).',
      metadata: null,
    }));
    expect(finding).toBe('Farbfragen werden hier entschieden, nicht im Marketing — siehe 0034.');
  });

  it('reads past a paragraph that only introduces the statement', () => {
    // Measured on record 0002: the finding was the lead-in ending in a colon,
    // which is a heading for what follows and nothing a reader can judge.
    const finding = findingOf(row({
      narrative: '## Entscheidung\n\nJe Datenart eine eigene Behandlung:\n\nEntscheidungen kommen in die Akten.\n',
      metadata: null,
    }));
    expect(finding).toContain('Entscheidungen kommen in die Akten.');
  });

  it('reads a lead-in that the corpus wrapped across lines', () => {
    // The corpus wraps its prose, so the colon that ends a lead-in usually
    // sits on a different line from the words that make it one. Testing the
    // last LINE instead of the collected text stopped after the first wrapped
    // line and cut record 0002's finding off mid-sentence.
    const finding = findingOf(row({
      narrative: [
        '## Entscheidung',
        '',
        'Je Datenart eine eigene Behandlung, und ein maschinischer Rueckhalt',
        'fuer den Moment der Entscheidung:',
        '',
        'Entscheidungen kommen in die Akten.',
      ].join('\n'),
      metadata: null,
    }));
    expect(finding).toContain('Entscheidungen kommen in die Akten.');
    expect(finding).not.toMatch(/der Entscheidung:$/);
  });

  it('does not read past a sentence that stands on its own', () => {
    expect(findingOf(row())).not.toContain('Zwei Vorgänge');
  });
});

describe('a lead-in is only followed when what follows can be read', () => {
  it('sees the colon through the bold marks the corpus writes it in', () => {
    // The corpus writes lead-ins in bold, so the raw line ends `Entscheidung:**`
    // and a colon test on the raw text answers "no" about the clearest lead-in
    // there is.
    const finding = findingOf(row({
      narrative: '## Entscheidung\n\n**Je Datenart eine eigene Behandlung:**\n\nEntscheidungen kommen in die Akten.\n',
      metadata: null,
    }));
    expect(finding).toContain('Entscheidungen kommen in die Akten.');
  });

  it('keeps the lead-in rather than splicing half a table onto it', () => {
    // Measured on record 0002, whose lead-in introduces a five-row table. Half
    // a table row on the end of a sentence is less readable than the lead-in
    // alone, and the lead-in IS the best one-line version of that record.
    const finding = findingOf(row({
      narrative: [
        '## Entscheidung', '',
        'Je Datenart eine eigene Behandlung, und ein maschinischer Rueckhalt',
        'fuer den Moment der Entscheidung:', '',
        '| Datenart | Wohin | Verhalten |',
        '|---|---|---|',
        '| Entscheidungen | entscheidungen/ | waechst, wird nie ueberschrieben |',
      ].join('\n'),
      metadata: null,
    }));
    expect(finding).toContain('Je Datenart eine eigene Behandlung');
    expect(finding).not.toContain('|');
  });
});
