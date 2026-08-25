// SPDX-License-Identifier: Apache-2.0
//
// A relation can be read from both ends.
//
// An edge is declared once, by one record, and stored once in that direction —
// correctly, because only one end wrote anything down. But that left the far
// end unreachable: `0090` was superseded by `0138`, `decision_edges` had
// carried an `idx_edges_to` index for it since the table was created, and every
// read path answered `0090` without mentioning it. A retired record that does
// not say it was retired reads as current, which is the failure the whole
// supersession machinery exists to prevent, one layer up.
//
// What is guarded here is the pair of claims that make the answer usable: the
// incoming direction is REACHED, and it is read in the right VOICE. Reaching it
// and printing the stored relation name would point half the corpus backwards.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { importAktenDirectory } from '../../src/services/curated/akten-importer.js';
import { applySupersessions } from '../../src/services/curated/supersession.js';
import { curatedRelationsOf, type CuratedRelation } from '../../src/services/curated/relations.js';

const PROJECT = 'steuerstand';

let akten: string;
let store: SessionStore;

function write(name: string, body: string): void {
  writeFileSync(join(akten, name), body, 'utf8');
}

function relationsOf(recordId: string): CuratedRelation[] {
  return curatedRelationsOf(store as never, PROJECT, recordId);
}

function importAll(): void {
  importAktenDirectory(store as never, akten, { project: PROJECT });
}

beforeEach(() => {
  akten = mkdtempSync(join(tmpdir(), 'keepmind-relations-'));
  store = new SessionStore(':memory:');

  write('0090-posteingang.md', `# 0090 — Ein voller Posteingang ist kein Befund

**Stand:** gilt · **Datum:** 01.06.2026 · **Entschieden von:** die Betreiberin

## Entscheidung

Ein voller Posteingang allein begruendet keinen Befund.
`);

  write('0138-belegfrist.md', `# 0138 — Belegfrist neu gefasst

**Stand:** gilt · **Datum:** 01.08.2026 · **Löst ab:** 0090

## Entscheidung

Belege bleiben sieben Jahre liegen.
`);

  importAll();
});

afterEach(() => {
  store.close();
  rmSync(akten, { recursive: true, force: true });
});

describe('both ends of a declared relation', () => {
  it('answers the record that declared it', () => {
    const [edge] = relationsOf('0138');

    expect(edge.direction).toBe('outgoing');
    expect(edge.relation).toBe('supersedes');
    expect(edge.phrase).toBe('supersedes');
    expect(edge.other).toBe('0090');
  });

  it('answers the record that was never asked', () => {
    // The whole point. Nothing in 0090's own text mentions 0138.
    const [edge] = relationsOf('0090');

    expect(edge.direction).toBe('incoming');
    expect(edge.other).toBe('0138');
  });

  it('reads an incoming edge in the reverse voice', () => {
    // Reached but printed in the stored direction, 0090 would claim to
    // supersede the record that replaced it — and a backwards supersession
    // makes a retired record look current, which is the failure being fixed.
    const [edge] = relationsOf('0090');

    expect(edge.phrase).toBe('superseded by');
    expect(edge.phrase).not.toBe('supersedes');
  });

  it('names the counterpart instead of only its number', () => {
    const [edge] = relationsOf('0090');

    expect(edge.otherTitle).toContain('Belegfrist neu gefasst');
    expect(edge.otherKind).toBe('akte');
    expect(edge.otherExists).toBe(true);
    expect(edge.otherCurrent).toBe(true);
  });

  it('carries the certainty, because a vermutet edge retires nothing', () => {
    const [edge] = relationsOf('0090');

    // `**Löst ab:** 0090` is the canonical header form of a declared verb.
    expect(edge.certainty).toBe('sicher');
    expect(edge.declaredIn[0].rawText).toContain('0090');
  });
});

describe('one relation, several declarations', () => {
  beforeEach(() => {
    // Two files declaring the same relation: the record itself, in the header
    // form (`Betrifft: 0090` — the verb is there, so 'sicher'), and a control
    // file asserting it about two OTHER records (a third party, so 'vermutet').
    // On the live corpus this is nearly half the edge table — 228 stored edges
    // are 126 relations.
    //
    // `concerns` rather than `supersedes` on purpose: a file with no record
    // number of its own may not retire a record, so a control file's
    // supersession is withheld and never reaches the table at all.
    write('0138-belegfrist.md', `# 0138 — Belegfrist neu gefasst

**Stand:** gilt · **Datum:** 01.08.2026 · **Betrifft:** 0090

## Entscheidung

Belege bleiben sieben Jahre liegen.
`);
    write('LIESMICH.md', `# Übersicht

0138 betrifft 0090.
`);
    importAll();
  });

  it('is one relation, not two that disagree about certainty', () => {
    const incoming = relationsOf('0090').filter(edge => edge.relation === 'concerns');

    expect(incoming).toHaveLength(1);
    expect(incoming[0].declaredIn.length).toBe(2);
  });

  it('reports the strongest declaration, matching what the store did', () => {
    // `applySupersessions` walks edge ROWS and acts as soon as ONE is 'sicher'.
    // Reporting the weakest would describe something that demonstrably
    // happened as merely supposed.
    const [relation] = relationsOf('0090').filter(edge => edge.relation === 'concerns');

    expect(relation.certainty).toBe('sicher');
    expect(relation.declaredIn.some(d => d.certainty === 'vermutet')).toBe(true);
  });

  it('keeps every source, so a dispute has something to check', () => {
    const [relation] = relationsOf('0090').filter(edge => edge.relation === 'concerns');
    const files = relation.declaredIn.map(d => d.sourcePath);

    expect(files.some(f => f.includes('LIESMICH'))).toBe(true);
    expect(new Set(files).size).toBe(2);
  });
});

describe('what the relation is worth', () => {
  it('says when the counterpart has itself been retired', () => {
    // "Superseded by a record that has since been retired" is a different
    // sentence from "superseded", and only one of them means the reader should
    // stop here.
    write('0150-zurueck.md', `# 0150 — Belegfrist zurueckgenommen

**Stand:** gilt · **Datum:** 01.09.2026 · **Löst ab:** 0138

## Entscheidung

Die Neufassung wird zurueckgenommen.
`);
    importAll();
    applySupersessions(store.db as never, PROJECT);

    const incoming = relationsOf('0090').find(edge => edge.direction === 'incoming');

    expect(incoming?.other).toBe('0138');
    expect(incoming?.otherExists).toBe(true);
    expect(incoming?.otherCurrent).toBe(false);
  });

  it('reports an edge naming a record the corpus does not hold', () => {
    // Never dropped: a reader that silently declines is indistinguishable from
    // one that did not look.
    write('0200-verweist.md', `# 0200 — Verweist ins Leere

**Stand:** gilt · **Datum:** 01.09.2026 · **Löst ab:** 0999

## Entscheidung

Die abgeloeste Akte gibt es nicht.
`);
    importAll();

    const [edge] = relationsOf('0200');

    expect(edge.other).toBe('0999');
    expect(edge.otherExists).toBe(false);
    expect(edge.otherCurrent).toBe(false);
    expect(edge.otherTitle).toBeNull();
    // The shape still says which namespace was meant.
    expect(edge.otherKind).toBe('akte');
  });

  it('resolves the current revision of a counterpart, not an older one', () => {
    // Editing a record writes a new revision and closes the previous one. A
    // second copy of that collapse is how a record starts being counted twice,
    // so the lookup goes through getCuratedRecord.
    write('0090-posteingang.md', `# 0090 — Ein voller Posteingang ist kein Befund

**Stand:** gilt · **Datum:** 01.07.2026 · **Entschieden von:** die Betreiberin

## Entscheidung

Ein voller Posteingang allein begruendet keinen Befund. Neu formuliert.
`);
    importAll();

    const outgoing = relationsOf('0138').filter(edge => edge.direction === 'outgoing');

    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].otherCurrent).toBe(true);
  });
});

describe('following a relation to its far end', () => {
  it('reads a retired entry instead of denying it exists', async () => {
    // `supersedes` points at retired entries BY CONSTRUCTION, so this is the
    // normal destination of the most consequential relation in the corpus.
    // Measured against the live store: record 0064 exists, still reads, was
    // superseded by 0137 — and `curated_get "0064"` answered
    // "No record 0064 in project steuerstand", which reads as "never existed".
    write('0137-neu.md', `# 0137 — Neu gefasst

**Stand:** gilt · **Datum:** 01.09.2026 · **Löst ab:** 0090

## Entscheidung

Die Regel wird neu gefasst.
`);
    importAll();
    applySupersessions(store.db as never, PROJECT);

    // Retired: no active revision.
    expect(store.getCuratedRecord(PROJECT, '0090')).toBeNull();

    // But the entry is there, with its text, and the graph can be followed.
    const retired = store.getCuratedRecord(PROJECT, '0090', { includeClosed: true });
    expect(retired).not.toBeNull();
    expect(retired?.title).toContain('Posteingang');
    expect(retired?.valid_to).not.toBeNull();

    const incoming = relationsOf('0090').filter(edge => edge.direction === 'incoming');
    expect(incoming.map(edge => edge.other)).toContain('0137');
  });
});

describe('across the two namespaces', () => {
  it('follows an edge that names a work item', () => {
    // A decision may point at the work item it is carried out in. The id is
    // shared; the kind is not.
    write('0160-vorgang.md', `# 0160 — Umsetzung angeordnet

**Stand:** gilt · **Datum:** 01.09.2026 · **Betrifft:** V-0110

## Entscheidung

Die Umsetzung laeuft im Vorgang.
`);
    importAll();

    const [edge] = relationsOf('0160');

    expect(edge.other).toBe('V-0110');
    expect(edge.otherKind).toBe('vorgang');
    expect(edge.phrase).toBe('concerns');

    // And from the work item's end, without it having written anything.
    const [back] = relationsOf('V-0110');
    expect(back.direction).toBe('incoming');
    expect(back.other).toBe('0160');
    expect(back.phrase).toBe('concerned by');
  });
});
