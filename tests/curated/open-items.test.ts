// SPDX-License-Identifier: Apache-2.0
//
// The age report for entries that CLAIM something is still open.
//
// An open work item is the one kind of entry that goes stale by the world
// moving rather than by anyone touching it: nothing writes to `V-0187` when
// the thing it waits for is settled elsewhere. On the live corpus 118 items
// say "offen" and 17 say "wartet", and nothing said which of them had been
// overtaken — `aging.ts` reports decisions only, deliberately, because its
// ordering trick (record numbers are monotonic) does not carry over to a
// second namespace.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { openItemsReport } from '../../src/services/curated/aging.js';

const PROJECT = 'steuerstand';
const NOW = Date.UTC(2026, 7, 25); // 25.08.2026

let store: SessionStore;
let session: string;

beforeEach(() => {
  store = new SessionStore(':memory:');
  const dbId = store.createSDKSession('content-1', PROJECT, 'Prüfstand');
  session = 'mem-content-1';
  store.ensureMemorySessionIdRegistered(dbId, session);
});

afterEach(() => store.close());

function put(title: string, metadata: Record<string, unknown>, sourcePath = 'C:/x.md'): number {
  return store.storeObservation(session, PROJECT, {
    type: 'decision', title, subtitle: null, facts: [], narrative: title,
    concepts: [], files_read: [], files_modified: [],
    metadata: JSON.stringify(metadata),
    source_kind: 'curated', source_path: sourcePath, source_line: 8,
  }, 0, 0, NOW).id;
}

function decision(id: string, date: string): void {
  put(`${id} — Eine Entscheidung`, { record_id: id, status: 'gilt', date });
}

function item(id: string, state: string, extra: Record<string, unknown> = {}): void {
  put(`${id} — Ein offener Punkt`, {
    vorgang_id: id, kind: 'vorgang', state, erstellt: '2026-08-01', ...extra,
  });
}

const db = () => (store as unknown as { db: Parameters<typeof openItemsReport>[0] }).db;

describe('the entries that claim something is open', () => {
  it('reports the open ones and leaves the settled ones out', () => {
    item('V-0001', 'offen');
    item('V-0002', 'wartet');
    item('V-0003', 'erledigt');
    item('V-0004', 'verworfen');

    const ids = openItemsReport(db(), PROJECT, NOW).map(e => e.itemId).sort();
    expect(ids).toEqual(['V-0001', 'V-0002']);
  });

  it('leaves decisions out — they are the other report', () => {
    decision('0001', '01.08.2026');
    item('V-0001', 'offen');

    const report = openItemsReport(db(), PROJECT, NOW);
    expect(report).toHaveLength(1);
    expect(report[0].itemId).toBe('V-0001');
  });

  it('counts the days since the state last MOVED, not since the file was written', () => {
    // "Unchanged" is the claim, and the state moving is the only thing that
    // counts as a change: an item's own file does not move when the log
    // records that it is now waiting.
    item('V-0001', 'wartet', { erstellt: '2026-07-01', state_since: '2026-08-20' });

    const [entry] = openItemsReport(db(), PROJECT, NOW);
    expect(entry.ageDays).toBe(5);
    expect(entry.ageFrom).toBe('state');
  });

  it('falls back to the creation date, and says which one it used', () => {
    // Different claims: "unchanged since it was created" does not mean anyone
    // has looked at it.
    item('V-0001', 'offen', { erstellt: '2026-08-15', state_since: null });

    const [entry] = openItemsReport(db(), PROJECT, NOW);
    expect(entry.ageDays).toBe(10);
    expect(entry.ageFrom).toBe('created');
  });

  it('counts decisions taken since, by DATE — the two namespaces cannot be compared', () => {
    // `ageReport` orders decisions by record number because they are
    // monotonically assigned. `V-0187` and `0138` are different namespaces, so
    // here the comparison has to be the date.
    item('V-0001', 'offen', { state_since: '2026-08-10' });
    decision('0001', '01.08.2026');   // before
    decision('0002', '12.08.2026');   // after
    decision('0003', '20.08.2026');   // after

    const [entry] = openItemsReport(db(), PROJECT, NOW);
    expect(entry.decisionsSince).toBe(2);
  });

  it('counts only the later decisions that NAME it', () => {
    item('V-0001', 'offen', { state_since: '2026-08-10' });
    decision('0001', '01.08.2026');
    decision('0002', '12.08.2026');
    store.replaceEdgesForSource(PROJECT, 'C:/0002.md', [
      { from: '0002', to: 'V-0001', relation: 'concerns', certainty: 'sicher', sourceLine: 1 },
    ], NOW);
    store.replaceEdgesForSource(PROJECT, 'C:/0001.md', [
      { from: '0001', to: 'V-0001', relation: 'concerns', certainty: 'sicher', sourceLine: 1 },
    ], NOW);

    const [entry] = openItemsReport(db(), PROJECT, NOW);
    // 0001 names it but predates the state, so it says nothing about whether
    // the item has been overtaken since.
    expect(entry.citingSince).toBe(1);
  });

  it('says nothing rather than zero when the item has no readable date', () => {
    // A zero would sort a date-less item to the bottom as though nothing had
    // happened since, which is a claim the data does not support.
    item('V-0001', 'offen', { erstellt: 'irgendwann im Sommer', state_since: null });
    decision('0001', '20.08.2026');

    const [entry] = openItemsReport(db(), PROJECT, NOW);
    expect(entry.ageDays).toBeNull();
    expect(entry.ageFrom).toBeNull();
    expect(entry.decisionsSince).toBe(0);
  });

  it('puts the most suspect on top: cited first, then overtaken, then oldest', () => {
    item('V-0001', 'offen', { state_since: '2026-08-01' }); // old, uncited
    item('V-0002', 'offen', { state_since: '2026-08-20' }); // recent, cited
    decision('0001', '22.08.2026');
    store.replaceEdgesForSource(PROJECT, 'C:/0001.md', [
      { from: '0001', to: 'V-0002', relation: 'concerns', certainty: 'sicher', sourceLine: 1 },
    ], NOW);

    expect(openItemsReport(db(), PROJECT, NOW).map(e => e.itemId)).toEqual(['V-0002', 'V-0001']);
  });

  it('ignores a revision that is no longer active', () => {
    // Anything reading curated rows has to collapse to the current revision,
    // or it counts one entry several times.
    const first = put('V-0001 — Erste Fassung', { vorgang_id: 'V-0001', kind: 'vorgang', state: 'offen', erstellt: '2026-08-01' });
    put('V-0001 — Zweite Fassung', { vorgang_id: 'V-0001', kind: 'vorgang', state: 'offen', erstellt: '2026-08-01' });
    store.settleCuratedRevisions(PROJECT, 'V-0001', first + 1, NOW);

    expect(openItemsReport(db(), PROJECT, NOW)).toHaveLength(1);
  });

  it('reports nothing at all when nothing is open', () => {
    item('V-0001', 'erledigt');
    expect(openItemsReport(db(), PROJECT, NOW)).toEqual([]);
  });
});
