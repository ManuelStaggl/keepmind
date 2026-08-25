import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { importAktenDirectory } from '../../src/services/curated/akten-importer.js';
import { importVorgaengeDirectory } from '../../src/services/curated/vorgang-importer.js';
import { curatedKindOfId, curatedKindOfRow, isCuratedId } from '../../src/services/curated/record-key.js';
import { authorCuratedRecord, type AuthoringStore } from '../../src/services/curated/authoring.js';

const PROJECT = 'steuerstand';

let akten: string;
let vorgaenge: string;
let store: SessionStore;

beforeEach(() => {
  akten = mkdtempSync(join(tmpdir(), 'keepmind-key-akten-'));
  vorgaenge = mkdtempSync(join(tmpdir(), 'keepmind-key-vorgaenge-'));
  store = new SessionStore(':memory:');

  writeFileSync(join(akten, '0138-belegfrist.md'), `# 0138 — Belegfrist

**Stand:** gilt · **Datum:** 01.06.2026 · **Entschieden von:** die Betreiberin

## Entscheidung

Belege bleiben sieben Jahre liegen.
`, 'utf8');

  writeFileSync(join(vorgaenge, 'v-0001-erster-vorgang.md'), `---
id: V-0001
titel: "Ablage neu ordnen"
entscheidet: "offen"
erstellt: "2026-08-01"
herkunft: "Prüfstand"
---

Die Ablage der Belege soll nach Kalenderjahr statt nach Lieferant geordnet werden.
`, 'utf8');

  importAktenDirectory(store as never, akten, { project: PROJECT });
  importVorgaengeDirectory(store as never, vorgaenge, { project: PROJECT });
});

afterEach(() => {
  store.close();
  rmSync(akten, { recursive: true, force: true });
  rmSync(vorgaenge, { recursive: true, force: true });
});

describe('curated ids', () => {
  it('reads the namespace off the shape', () => {
    expect(curatedKindOfId('0138')).toBe('akte');
    expect(curatedKindOfId('V-0001')).toBe('vorgang');
    expect(curatedKindOfId('138')).toBeNull();
    expect(curatedKindOfId('V-1')).toBeNull();
    expect(isCuratedId('0999')).toBe(true);
    expect(isCuratedId('nichts')).toBe(false);
  });

  it('prefers what a row declares over what its id looks like', () => {
    expect(curatedKindOfRow('{"kind":"vorgang"}', '0138')).toBe('vorgang');
    expect(curatedKindOfRow(null, 'V-0001')).toBe('vorgang');
    expect(curatedKindOfRow('{}', '0138')).toBe('akte');
    expect(curatedKindOfRow('nicht json', 'V-0001')).toBe('vorgang');
  });
});

// The reported failure: `curated:import` counted 200 work items as imported and
// `curated_get "V-0001"` answered "No record" about every one of them.
describe('a work item is addressable by its number', () => {
  it('returns the work item, with its wording', () => {
    const found = store.getCuratedRecord(PROJECT, 'V-0001');
    expect(found).not.toBeNull();
    expect(found!.narrative).toContain('nach Kalenderjahr statt nach Lieferant');
    expect(found!.title).toContain('Ablage neu ordnen');
  });

  it('says which of the two it is, so the caller never has to guess', () => {
    expect(store.getCuratedRecord(PROJECT, 'V-0001')!.kind).toBe('vorgang');
    expect(store.getCuratedRecord(PROJECT, '0138')!.kind).toBe('akte');
  });

  it('carries the state the event log derived, not an invented one', () => {
    const meta = JSON.parse(store.getCuratedRecord(PROJECT, 'V-0001')!.metadata!);
    expect(meta.kind).toBe('vorgang');
    expect(meta.vorgang_id).toBe('V-0001');
    expect(meta.state).toBe('unbekannt'); // no EREIGNISSE.log in this corpus
  });

  it('lists its revisions', () => {
    expect(store.getCuratedRevisions(PROJECT, 'V-0001')).toHaveLength(1);
  });

  it('re-importing replaces the row instead of stacking a second one', () => {
    importVorgaengeDirectory(store as never, vorgaenge, { project: PROJECT });
    expect(store.getCuratedRevisions(PROJECT, 'V-0001')).toHaveLength(1);
  });

  // The row is de-duplicated on its WORDING, and a work item's state is not in
  // its wording — it comes from the event log, which moves on its own. Measured
  // before the fix: the import reported `wartet` and the stored row kept saying
  // `unbekannt`, so every later read answered with the old state.
  it('picks up a state change that happened only in the event log', () => {
    writeFileSync(join(vorgaenge, 'EREIGNISSE.log'), [
      '2026-08-02 | eroeffnet | V-0001 | quelle=Sitzung',
      '2026-08-10 | wartet | V-0001 | grund=Rueckfrage offen',
    ].join(String.fromCharCode(10)), 'utf8');

    importVorgaengeDirectory(store as never, vorgaenge, { project: PROJECT });

    const record = store.getCuratedRecord(PROJECT, 'V-0001')!;
    const meta = JSON.parse(record.metadata!);
    expect(meta.state).toBe('wartet');
    expect(meta.state_since).toBe('2026-08-10');
    expect(record.subtitle).toContain('wartet');
    // The wording is untouched, and no second revision was stacked.
    expect(record.narrative).toContain('nach Kalenderjahr statt nach Lieferant');
    expect(store.getCuratedRevisions(PROJECT, 'V-0001')).toHaveLength(1);
  });

  it('still answers for a decision record — the two share a lookup, not a namespace', () => {
    expect(store.getCuratedRecord(PROJECT, '0138')!.narrative).toContain('sieben Jahre');
    expect(store.getCuratedRecord(PROJECT, 'V-0138')).toBeNull();
    expect(store.getCuratedRecord(PROJECT, '0001')).toBeNull();
  });

  it('can be closed and reopened by its number like any other entry', () => {
    expect(store.closeCuratedRecord(PROJECT, 'V-0001', { reason: 'erledigt' }).closed).toBe(1);
    expect(store.getCuratedRecord(PROJECT, 'V-0001')).toBeNull();
    // Nothing was deleted — it is still there, and still readable.
    expect(store.getCuratedRecord(PROJECT, 'V-0001', { includeClosed: true })).not.toBeNull();
    expect(store.reopenCuratedRecord(PROJECT, 'V-0001').reopened).toBe(1);
    expect(store.getCuratedRecord(PROJECT, 'V-0001')).not.toBeNull();
  });

  // Authoring a work item is refused OUT LOUD. The renderer would produce a
  // heading the decision-record reader does not read back as an id, and the
  // round-trip guard would then fail with `reads back as id "null"` three
  // layers down. Widening that reader is not a small change: which headings
  // carry a number decides which files count as control files.
  it('refuses to author a work item, and says why', () => {
    expect(() => authorCuratedRecord(store as unknown as AuthoringStore, {
      recordId: 'V-0001',
      title: 'Ablage neu ordnen',
      body: 'Nach Rücksprache doch nach Lieferant.',
    }, { project: PROJECT, expect: 'existing' })).toThrow(/work items are not authored here yet/);

    // And the imported item is untouched by the attempt.
    expect(store.getCuratedRevisions(PROJECT, 'V-0001')).toHaveLength(1);
    expect(store.getCuratedRecord(PROJECT, 'V-0001')!.narrative).toContain('nach Kalenderjahr');
  });

  it('still accepts a work item as the TARGET of a relation from a decision', () => {
    authorCuratedRecord(store as unknown as AuthoringStore, {
      title: 'Ablageordnung',
      body: 'Regelt die Ablage.',
      relations: [{ relation: 'concerns', targets: ['V-0001'] }],
    }, { project: PROJECT });

    const edges = store.getEdges(PROJECT).filter(e => e.to_record === 'V-0001');
    expect(edges).toHaveLength(1);
    expect(edges[0].relation).toBe('concerns');
  });

  it('does not hand a work item number out as the next free decision number', () => {
    expect(store.nextCuratedRecordId(PROJECT)).toBe('0139');
  });
});
