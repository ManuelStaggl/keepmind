import { describe, it, expect, beforeEach } from 'bun:test';
import { DatabaseSync } from 'node:sqlite';
import { applySupersessions, SUPERSESSION_MARKER } from '../../src/services/curated/supersession.js';
import { ageReport, parseWrittenOn } from '../../src/services/curated/aging.js';

type Store = Parameters<typeof applySupersessions>[0];

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY,
      project TEXT,
      title TEXT,
      source_kind TEXT,
      source_path TEXT,
      source_line INTEGER,
      created_at_epoch INTEGER,
      valid_to INTEGER,
      metadata TEXT
    );
    CREATE TABLE decision_edges (
      project TEXT, from_record TEXT, to_record TEXT, relation TEXT,
      certainty TEXT, source_path TEXT, source_line INTEGER, raw_text TEXT
    );
  `);
  return db;
}

function addRecord(db: DatabaseSync, id: number, recordId: string, extra: Record<string, unknown> = {}): void {
  db.prepare(`INSERT INTO observations (id, project, title, source_kind, source_path, source_line, created_at_epoch, valid_to, metadata)
              VALUES (?, 'p', ?, 'curated', ?, 1, 1000, NULL, ?)`)
    .run(id, `${recordId} — Titel`, `C:/akten/${recordId}.md`, JSON.stringify({ record_id: recordId, ...extra }));
}

function addEdge(db: DatabaseSync, from: string, to: string, certainty = 'sicher', line = 4): void {
  db.prepare(`INSERT INTO decision_edges (project, from_record, to_record, relation, certainty, source_path, source_line, raw_text)
              VALUES ('p', ?, ?, 'supersedes', ?, ?, ?, ?)`)
    .run(from, to, certainty, `C:/akten/${from}.md`, line, `löst ${to} ab`);
}

describe('supersession', () => {
  let db: DatabaseSync;
  beforeEach(() => { db = makeDb(); });

  it('closes the window of the superseded record, not the superseding one', () => {
    addRecord(db, 1, '0011');
    addRecord(db, 2, '0012');
    addEdge(db, '0012', '0011');

    const report = applySupersessions(db as unknown as Store, 'p', 5000);

    expect(report.closed).toHaveLength(1);
    expect(report.closed[0].record).toBe('0011');
    expect((db.prepare('SELECT valid_to FROM observations WHERE id=1').get() as { valid_to: number }).valid_to).toBe(5000);
    expect((db.prepare('SELECT valid_to FROM observations WHERE id=2').get() as { valid_to: number | null }).valid_to).toBeNull();
  });

  it('never deletes the row', () => {
    // The whole design rests on this: a retired record stays findable and only
    // stops being injected. Deleting loses both statements (mem0 #4536).
    addRecord(db, 1, '0011');
    addRecord(db, 2, '0012');
    addEdge(db, '0012', '0011');
    applySupersessions(db as unknown as Store, 'p', 5000);
    expect((db.prepare('SELECT count(*) c FROM observations').get() as { c: number }).c).toBe(2);
  });

  it('leaves an uncertain supersession alone and reports it', () => {
    // A wrongly retired record is invisible, which is the one failure mode
    // nobody notices. Certainty is the gate.
    addRecord(db, 1, '0011');
    addRecord(db, 2, '0012');
    addEdge(db, '0012', '0011', 'vermutet');

    const report = applySupersessions(db as unknown as Store, 'p', 5000);

    expect(report.closed).toHaveLength(0);
    expect(report.uncertain).toHaveLength(1);
    expect(report.uncertain[0]).toMatchObject({ from: '0012', to: '0011' });
    expect((db.prepare('SELECT valid_to FROM observations WHERE id=1').get() as { valid_to: number | null }).valid_to).toBeNull();
  });

  it('reopens a window when the edge that closed it is gone', () => {
    // Computed, not accumulated. Without this a record stays retired forever
    // because of a line nobody can find any more.
    addRecord(db, 1, '0011');
    addRecord(db, 2, '0012');
    addEdge(db, '0012', '0011');
    applySupersessions(db as unknown as Store, 'p', 5000);

    db.exec('DELETE FROM decision_edges');
    const second = applySupersessions(db as unknown as Store, 'p', 6000);

    expect(second.reopened).toBe(1);
    expect(second.closed).toHaveLength(0);
    expect((db.prepare('SELECT valid_to FROM observations WHERE id=1').get() as { valid_to: number | null }).valid_to).toBeNull();
  });

  it('is idempotent — the same run twice leaves the same state', () => {
    addRecord(db, 1, '0011');
    addRecord(db, 2, '0012');
    addEdge(db, '0012', '0011');

    applySupersessions(db as unknown as Store, 'p', 5000);
    const second = applySupersessions(db as unknown as Store, 'p', 5000);

    expect(second.closed).toHaveLength(1);
    const row = db.prepare('SELECT valid_to, metadata FROM observations WHERE id=1').get() as { valid_to: number; metadata: string };
    expect(row.valid_to).toBe(5000);
    expect(JSON.parse(row.metadata)[SUPERSESSION_MARKER]).toBe('0012');
  });

  it('counts records once even when several files declare the same supersession', () => {
    // A record and the index listing it both declaring one relation is normal.
    addRecord(db, 1, '0011');
    addRecord(db, 2, '0012');
    addEdge(db, '0012', '0011', 'sicher', 4);
    addEdge(db, '0012', '0011', 'sicher', 26);

    const report = applySupersessions(db as unknown as Store, 'p', 5000);

    expect(report.closed).toHaveLength(1);
    expect(report.edgesApplied).toBe(2);
  });

  it('reports an edge naming a record that has no row', () => {
    addRecord(db, 1, '0011');
    addEdge(db, '0012', '0011');
    addEdge(db, '0011', '9999');

    const report = applySupersessions(db as unknown as Store, 'p', 5000);
    expect(report.unknownTargets).toHaveLength(1);
    expect(report.unknownTargets[0].to).toBe('9999');
  });

  it('does not let a record retire itself', () => {
    addRecord(db, 1, '0011');
    addEdge(db, '0011', '0011');
    const report = applySupersessions(db as unknown as Store, 'p', 5000);
    expect(report.closed).toHaveLength(0);
  });
});

describe('aging', () => {
  it('reads the age from the record date, not from the import timestamp', () => {
    // Every curated row shares one import timestamp. Using it reported all 137
    // records as "unchanged for 0 days" — a false statement, not a missing one.
    const db = makeDb();
    addRecord(db, 1, '0005', { date: '09.08.2026' });
    const [entry] = ageReport(db as unknown as Parameters<typeof ageReport>[0], 'p', Date.UTC(2026, 7, 14));
    expect(entry.ageDays).toBe(5);
  });

  it('says the age is unknown rather than guessing at a prose date', () => {
    const db = makeDb();
    addRecord(db, 1, '0005', { date: 'irgendwann im Sommer' });
    const [entry] = ageReport(db as unknown as Parameters<typeof ageReport>[0], 'p', Date.UTC(2026, 7, 14));
    expect(entry.ageDays).toBeNull();
  });

  it('parses both unambiguous date forms and nothing else', () => {
    expect(parseWrittenOn('09.08.2026')).toBe(Date.UTC(2026, 7, 9));
    expect(parseWrittenOn('2026-08-09')).toBe(Date.UTC(2026, 7, 9));
    expect(parseWrittenOn('Sommer 2026')).toBeNull();
    expect(parseWrittenOn(null)).toBeNull();
  });

  it('counts only LATER records as citing', () => {
    const db = makeDb();
    addRecord(db, 1, '0005', { date: '01.08.2026' });
    addRecord(db, 2, '0010', { date: '02.08.2026' });
    addRecord(db, 3, '0003', { date: '01.08.2026' });
    addEdge(db, '0010', '0005');
    addEdge(db, '0003', '0005');

    const report = ageReport(db as unknown as Parameters<typeof ageReport>[0], 'p', Date.UTC(2026, 7, 14));
    const entry = report.find(e => e.recordId === '0005')!;
    expect(entry.citingSince).toBe(1);
    expect(entry.decisionsSince).toBe(1);
  });

  it('marks a retired record as retired', () => {
    const db = makeDb();
    addRecord(db, 1, '0005', { date: '01.08.2026' });
    db.exec('UPDATE observations SET valid_to = 9999 WHERE id = 1');
    const [entry] = ageReport(db as unknown as Parameters<typeof ageReport>[0], 'p', Date.UTC(2026, 7, 14));
    expect(entry.retired).toBe(true);
  });
});
