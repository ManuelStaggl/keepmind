import { describe, it, expect } from 'bun:test';
import { parseAkte } from '../../src/services/curated/akten-parser.js';
import { extractEdges, extractEdgesFromControlFile } from '../../src/services/curated/edge-reader.js';
import { negatesRelation, matchRelation } from '../../src/services/curated/relation-lexicon.js';

function edgesOf(header: string, path = 'C:/akten/0090-x.md') {
  return extractEdges(parseAkte(`# 0090 — Titel\n\n${header}\n\n## X\n\nText\n`), path);
}

describe('direction', () => {
  it('`löst 0093 ab` points away from the declaring record', () => {
    const { edges } = edgesOf('**Vermerk:** löst 0093 ab');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: '0090', to: '0093', relation: 'supersedes' });
  });

  it('`abgelöst durch 0110` points the OTHER way', () => {
    // Reading both forms as from -> to points half the supersession chain
    // backwards, and a backwards supersession makes a dead record look current.
    const { edges } = edgesOf('**Stand:** abgelöst durch 0110 am 11.08.2026');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: '0110', to: '0090', relation: 'supersedes' });
  });

  it('`ersetzt durch 0012` reverses too, and `ersetzt 0011` does not', () => {
    expect(edgesOf('**Stand:** ersetzt durch 0012').edges[0]).toMatchObject({ from: '0012', to: '0090' });
    expect(edgesOf('**Vermerk:** Ersetzt Akte 0011').edges[0]).toMatchObject({ from: '0090', to: '0011' });
  });

  it('reversing patterns are tested before their forward counterparts', () => {
    // `abgelöst durch` contains `abgelöst`; the wrong order reads every
    // reversal forwards without failing anywhere visible.
    expect(matchRelation('abgelöst durch ')?.forward).toBe(false);
    expect(matchRelation('löst ')?.forward).toBe(true);
  });
});

describe('negation — the trap the corpus contains as data', () => {
  it('`berührt 0110 nicht` creates NO edge', () => {
    // Record 0119. A reader matching "verb plus number" makes an edge here;
    // the note says the exact opposite. This is the client's own warning —
    // "a wrongly placed supersession hides a rule that still applies" —
    // present as a record rather than as a worry.
    const { edges, rejected } = edgesOf('**Vermerk:** Manuel, 12.08.2026 · berührt 0110 nicht');
    expect(edges).toHaveLength(0);
    expect(rejected.some(r => r.to === '0110' && r.reason === 'relation negated')).toBe(false);
    // `berührt` is not a relation at all, so there is nothing to negate and
    // nothing to report — the edge never gets proposed.
  });

  it('`werden nicht geschlossen` cancels an otherwise valid closes', () => {
    const { edges, rejected } = edgesOf('**Schliesst:** V-0183 und V-0184 werden nicht geschlossen');
    expect(edges).toHaveLength(0);
    expect(rejected.map(r => r.to).sort()).toEqual(['V-0183', 'V-0184']);
    expect(rejected.every(r => r.reason === 'relation negated')).toBe(true);
  });

  it('a negation in ONE clause does not cancel the next clause', () => {
    // `Schliesst: keinen Vorgang · betrifft V-0187` — the "keinen" belongs to
    // the closing statement. Scanning the whole line lost five valid edges.
    const { edges } = edgesOf('**Stand:** gilt Schliesst: keinen Vorgang · betrifft V-0187, V-0190');
    expect(edges.map(e => e.to).sort()).toEqual(['V-0187', 'V-0190']);
    expect(edges.every(e => e.relation === 'concerns')).toBe(true);
  });

  it('a negation inside parentheses belongs to the target, not the relation', () => {
    // `0010 (Pilot bezieht die Bausteine nicht), 0050, 0052` is three edges.
    // Treating the parenthetical as a cancel drops all three.
    expect(negatesRelation('schliesst 0010 (Pilot bezieht die Bausteine nicht), 0050')).toBe(false);
    expect(negatesRelation('werden nicht geschlossen')).toBe(true);
  });
});

describe('references and spans', () => {
  it('does not read the year of a date as a record number', () => {
    // `abgelöst durch 0110 am 11.08.2026` holds two four-digit numbers and
    // only one is a record. The year inherits the active relation and invents
    // a supersession by record "2026". Dates are in nearly every header, so
    // this is the common case, not an edge case.
    const { edges } = edgesOf('**Stand:** abgelöst durch 0110 am 11.08.2026');
    expect(edges.map(e => `${e.from}->${e.to}`)).toEqual(['0110->0090']);
  });

  it('still reads a record that happens to look like a year', () => {
    // `V-2026` carries its namespace prefix, so it is unambiguous.
    const { edges } = edgesOf('**Schliesst:** V-2026');
    expect(edges.map(e => e.to)).toEqual(['V-2026']);
  });

  it('reads every target in an enumeration', () => {
    const { edges } = edgesOf('**Schränkt ein:** 0042, 0043, 0044, 0045');
    expect(edges.map(e => e.to)).toEqual(['0042', '0043', '0044', '0045']);
    expect(edges.every(e => e.relation === 'restricts')).toBe(true);
  });

  it('expands a small span into the records it names', () => {
    const { edges } = edgesOf('**Setzt fort:** 0050–0053');
    expect(edges.map(e => e.to)).toEqual(['0050', '0051', '0052', '0053']);
  });

  it('refuses a wide span — an index range is not four hundred relations', () => {
    const { edges, rejected } = edgesOf('**Setzt fort:** 0001–0049');
    expect(edges).toHaveLength(0);
    expect(rejected[0].reason).toContain('span too wide');
  });

  it('keeps the V- namespace distinct from record numbers', () => {
    const { edges } = edgesOf('**Schliesst:** V-0008, V-0017');
    expect(edges.map(e => e.to)).toEqual(['V-0008', 'V-0017']);
  });

  it('never links a record to itself', () => {
    const { edges } = edgesOf('**Vermerk:** schärft 0090');
    expect(edges).toHaveLength(0);
  });

  it('reduces a markdown link before judging the sentence', () => {
    // The href is a slug built from the target title and contains "nicht".
    const { edges } = edgesOf('**Vermerk:** berichtigt [0024](./0024-verbrauch-wird-nicht-geschaetzt.md)');
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ to: '0024', relation: 'corrects' });
  });
});

describe('certainty', () => {
  it('a verb in the same clause is `sicher`', () => {
    expect(edgesOf('**Vermerk:** schärft 0093').edges[0].certainty).toBe('sicher');
  });

  it('a bare reference under a relation-bearing LABEL is `vermutet`', () => {
    // The label says what the relation is; no sentence does. Weaker evidence,
    // kept apart rather than discarded or promoted.
    const { edges } = edgesOf('**Grundlage:** 0002, 0003');
    expect(edges.every(e => e.certainty === 'vermutet')).toBe(true);
    expect(edges.every(e => e.relation === 'based_on')).toBe(true);
  });

  it('a reference with no relation anywhere produces nothing at all', () => {
    const { edges } = edgesOf('**Datum:** 09.08.2026 · **Entschieden von:** Manuel');
    expect(edges).toHaveLength(0);
  });
});

describe('provenance', () => {
  it('every edge carries the file and the line it was read from', () => {
    const { edges } = edgesOf('**Vermerk:** löst 0093 ab', 'C:/akten/0110-x.md');
    expect(edges[0].sourcePath).toBe('C:/akten/0110-x.md');
    expect(edges[0].sourceLine).toBe(3);
    expect(edges[0].rawText).toContain('löst 0093 ab');
  });
});

describe('control files', () => {
  it('reads edges from a file that is not a record at all', () => {
    // A control file declares two records obsolete while both still read
    // `Stand: gilt`. Nothing inside those records knows it, so an importer
    // that only reads the records folder misses the relation entirely.
    const { edges } = extractEdgesFromControlFile(
      'Die Akte 0110 ersetzt 0093 und 0094 in diesem Punkt.\n',
      'C:/nachtrag/LEGALISIERUNG.md',
    );
    expect(edges.map(e => `${e.from}->${e.to}`)).toEqual(['0110->0093', '0110->0094']);
    // A third party asserting a relation about two other records is weaker
    // evidence than a record asserting it about itself.
    expect(edges.every(e => e.certainty === 'vermutet')).toBe(true);
    expect(edges[0].sourceLine).toBe(1);
  });

  it('needs two references in one clause — there is no implicit subject', () => {
    const { edges } = extractEdgesFromControlFile('Akte 0110 gilt weiterhin.\n', 'C:/x.md');
    expect(edges).toHaveLength(0);
  });
});
