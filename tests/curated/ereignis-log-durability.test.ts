import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { importVorgaengeDirectory, EVENT_LOG_FILE } from '../../src/services/curated/vorgang-importer.js';
import { verifyMigration } from '../../src/services/curated/migration-verify.js';

const PROJECT = 'steuerstand';
const LF = String.fromCharCode(10);

let dir: string;
let store: SessionStore;

function writeItem(id: string, titel: string, body: string): void {
  writeFileSync(join(dir, `${id.toLowerCase()}.md`), [
    '---',
    `id: ${id}`,
    `titel: "${titel}"`,
    'entscheidet: "offen"',
    'erstellt: "2026-08-01"',
    'herkunft: "Prüfstand"',
    '---',
    '',
    body,
    '',
  ].join(LF), 'utf8');
}

function writeLog(lines: string[]): void {
  writeFileSync(join(dir, EVENT_LOG_FILE), lines.join(LF) + LF, 'utf8');
}

const LOG_LINES = [
  '# Ereignisse der Vorgänge, append-only',
  '2026-08-02 | eroeffnet | V-0001 | quelle=Sitzung',
  '2026-08-05 | vermerk | V-0001 | notiz=Rueckfrage an die Buchhaltung',
  '2026-08-10 | wartet | V-0001 | grund=Antwort steht aus',
  '2026-08-11 | eroeffnet | V-0002 | quelle=Mail',
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keepmind-log-'));
  store = new SessionStore(':memory:');
  writeItem('V-0001', 'Ablage neu ordnen', 'Belege nach Kalenderjahr ablegen.');
  writeItem('V-0002', 'Kassenbuch prüfen', 'Das Kassenbuch für Juli durchsehen.');
  writeLog(LOG_LINES);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function logRow(): { narrative: string | null; metadata: string | null } | undefined {
  return store.db.prepare(`
    SELECT narrative, metadata FROM observations
     WHERE project = ? AND source_kind = 'curated'
       AND json_extract(metadata, '$.kind') = 'ereignis-log'
       AND valid_to IS NULL
  `).get(PROJECT) as never;
}

// Until this existed, only the DERIVED state was stored. Deleting
// EREIGNISSE.log would have taken the history of how every item reached its
// state with it — silently, and after a `curated:verify` that said "complete".
describe('the event log survives its file', () => {
  it('stores the log verbatim, comments and all', () => {
    const report = importVorgaengeDirectory(store as never, dir, { project: PROJECT });

    expect(report.eventLogStored).toBe(true);
    expect(report.eventCount).toBe(4);
    const row = logRow();
    expect(row).toBeDefined();
    // Byte for byte, including the comment line the reader skips.
    expect(row!.narrative).toBe(LOG_LINES.join(LF));
    expect(JSON.parse(row!.metadata!).kind).toBe('ereignis-log');
  });

  it('does not let the log answer as a work item', () => {
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });
    // It carries no entry number, so it is invisible to every read that
    // addresses entries by number.
    expect(store.getCuratedRecord(PROJECT, EVENT_LOG_FILE)).toBeNull();
    expect(store.curatedObservationIds(PROJECT)).toHaveLength(3); // 2 items + the log
  });

  it('gives each item its own events, verbatim, next to the derived state', () => {
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });

    const meta = JSON.parse(store.getCuratedRecord(PROJECT, 'V-0001')!.metadata!);
    expect(meta.state).toBe('wartet');
    expect(meta.events).toHaveLength(3);
    expect(meta.events.map((e: { art: string }) => e.art)).toEqual(['eroeffnet', 'vermerk', 'wartet']);
    expect(meta.events[2].raw).toBe('2026-08-10 | wartet | V-0001 | grund=Antwort steht aus');
    // The neutral event is kept too — the history is not filtered down to what
    // moved the state.
    expect(meta.events[1].felder.notiz).toContain('Buchhaltung');

    const second = JSON.parse(store.getCuratedRecord(PROJECT, 'V-0002')!.metadata!);
    expect(second.events).toHaveLength(1);
    expect(second.state).toBe('offen');
  });

  it('replaces the stored log when the file changes, keeping the old one readable', () => {
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });
    writeLog([...LOG_LINES, '2026-08-20 | geschlossen | V-0001 | grund=Erledigt']);
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });

    const active = store.db.prepare(`
      SELECT COUNT(*) AS n FROM observations
       WHERE project = ? AND json_extract(metadata, '$.kind') = 'ereignis-log' AND valid_to IS NULL
    `).get(PROJECT) as { n: number };
    const all = store.db.prepare(`
      SELECT COUNT(*) AS n FROM observations
       WHERE project = ? AND json_extract(metadata, '$.kind') = 'ereignis-log'
    `).get(PROJECT) as { n: number };

    expect(active.n).toBe(1);
    expect(all.n).toBe(2); // nothing deleted
    expect(logRow()!.narrative).toContain('geschlossen');
    expect(JSON.parse(store.getCuratedRecord(PROJECT, 'V-0001')!.metadata!).state).toBe('erledigt');
  });

  it('names events whose item this directory has no file for, and keeps their wording', () => {
    writeLog([...LOG_LINES, '2026-08-12 | eroeffnet | V-0099 | quelle=Altbestand']);
    const report = importVorgaengeDirectory(store as never, dir, { project: PROJECT });

    expect(report.orphanEvents).toHaveLength(1);
    expect(report.orphanEvents[0].vorgang).toBe('V-0099');
    // Not lost: the stored log holds the line either way.
    expect(logRow()!.narrative).toContain('V-0099');
  });
});

describe('verify refuses to bless a corpus whose log did not arrive', () => {
  const sources = () => [{ path: dir, kind: 'vorgaenge' as const }];

  it('is complete once records and log are both in', () => {
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });
    const report = verifyMigration(store.db as never, PROJECT, sources());

    expect(report.eventLogs).toHaveLength(1);
    expect(report.eventLogs[0].stored).toBe(true);
    expect(report.eventLogs[0].sourceEvents).toBe(4);
    expect(report.missingRecords).toEqual([]);
    expect(report.complete).toBe(true);
  });

  // The failure this check exists for: every item arrived, so the old verify
  // said "complete" — and the file still held the only copy of the history.
  it('is INCOMPLETE when the items arrived but the log did not', () => {
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });
    store.db.prepare(`
      DELETE FROM observations
       WHERE project = ? AND json_extract(metadata, '$.kind') = 'ereignis-log'
    `).run(PROJECT);

    const report = verifyMigration(store.db as never, PROJECT, sources());
    expect(report.missingRecords).toEqual([]);
    expect(report.eventLogs[0].stored).toBe(false);
    expect(report.complete).toBe(false);
  });

  it('is INCOMPLETE when the stored log no longer matches the file', () => {
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });
    writeLog([...LOG_LINES, '2026-08-20 | geschlossen | V-0001 | grund=Erledigt']);

    const report = verifyMigration(store.db as never, PROJECT, sources());
    expect(report.eventLogs[0].stored).toBe(false);
    expect(report.eventLogs[0].mismatch).toContain('differs from the file');
    expect(report.complete).toBe(false);
  });

  it('says nothing about event logs when a directory has none', () => {
    rmSync(join(dir, EVENT_LOG_FILE));
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });

    const report = verifyMigration(store.db as never, PROJECT, sources());
    expect(report.eventLogs).toEqual([]);
    expect(report.complete).toBe(true);
  });
});
