import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { importAktenDirectory } from '../../src/services/curated/akten-importer.js';
import { applySupersessions } from '../../src/services/curated/supersession.js';
import { verifyMigration } from '../../src/services/curated/migration-verify.js';
import { authorCuratedRecord, type AuthoringStore } from '../../src/services/curated/authoring.js';

const PROJECT = 'altbestand';

let dir: string;
let store: SessionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keepmind-altbestand-'));
  store = new SessionStore(':memory:');
  writeCorpus();
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): void {
  writeFileSync(join(dir, name), content, 'utf8');
}

/**
 * A miniature of the shapes the real archive uses: a plain record, a record
 * that declares a supersession, a record that is only retired by a CONTROL
 * FILE, and an index that stores no row of its own.
 */
function writeCorpus(): void {
  write('0001-erste-regel.md', `# 0001 — Erste Regel

**Stand:** gilt · **Datum:** 01.06.2026 · **Entschieden von:** die Betreiberin

## Entscheidung

So wurde es zuerst festgelegt.
`);
  write('0002-zweite-regel.md', `# 0002 — Zweite Regel

**Stand:** gilt · **Datum:** 01.07.2026 · **Vermerk:** löst 0001 ab · betrifft 0003

## Entscheidung

Ab hier gilt das hier.
`);
  write('0003-dritte-regel.md', `# 0003 — Dritte Regel

**Stand:** gilt · **Datum:** 01.08.2026

## Entscheidung

Bleibt in Kraft.
`);
  write('0004-vierte-regel.md', `# 0004 — Vierte Regel

**Stand:** gilt · **Datum:** 02.08.2026

## Entscheidung

Steht im Widerspruch zu nichts.
`);
  // A control file: not a record, but it asserts a supersession that 0004
  // itself knows nothing about. This is the shape the whole "read control files
  // too" rule exists for. Note that the edge it yields is 'vermutet' — a third
  // party asserting a relation about two records is weaker evidence than a
  // record asserting it about itself — so nothing APPLIES it. That is the point
  // of including it here: both sides have to reach that same conclusion.
  write('UEBERSICHT.md', `# Übersicht über die Regeln

0003 löst 0004 ab.
`);
}

function importCorpus(): void {
  importAktenDirectory(store as never, dir, { project: PROJECT, nowEpoch: 1_700_000_000_000 });
  applySupersessions(store.db as never, PROJECT, 1_700_000_000_000);
}

const sources = () => [{ path: dir, kind: 'akten' as const }];

describe('migration round trip — did the file archive arrive complete?', () => {
  it('reports a full import as complete', () => {
    importCorpus();
    const report = verifyMigration(store.db as never, PROJECT, sources());

    expect(report.missingRecords).toEqual([]);
    expect(report.missingEdges).toEqual([]);
    expect(report.wronglyRetired).toEqual([]);
    expect(report.wronglyActive).toEqual([]);
    expect(report.failed).toEqual([]);
    expect(report.complete).toBe(true);

    expect(report.sourceRecords).toEqual(['0001', '0002', '0003', '0004']);
    expect(report.storedRecords).toEqual(['0001', '0002', '0003', '0004']);
  });

  it('agrees with the files on which records are still in force', () => {
    importCorpus();
    const report = verifyMigration(store.db as never, PROJECT, sources());

    // 0001 is retired by the record that says so. 0004 is NOT — the only thing
    // claiming it is a control file, whose assertion is 'vermutet', and an
    // uncertain supersession is reported for a human and never applied. Both
    // sides reach that conclusion independently, which is exactly what makes
    // the comparison worth anything.
    expect(report.currentInSource).toEqual(['0002', '0003', '0004']);
    expect(report.currentInStore).toEqual(['0002', '0003', '0004']);
  });

  it('catches a record that did not arrive', () => {
    importCorpus();
    store.db.prepare(
      `DELETE FROM observations WHERE project = ? AND json_extract(metadata, '$.record_id') = '0003'`,
    ).run(PROJECT);

    const report = verifyMigration(store.db as never, PROJECT, sources());
    expect(report.missingRecords).toEqual(['0003']);
    expect(report.complete).toBe(false);
  });

  it('catches a declared relation that did not arrive', () => {
    importCorpus();
    store.db.prepare(
      `DELETE FROM decision_edges WHERE project = ? AND from_record = '0002' AND to_record = '0003'`,
    ).run(PROJECT);

    const report = verifyMigration(store.db as never, PROJECT, sources());
    expect(report.missingEdges).toEqual([
      expect.objectContaining({ from: '0002', to: '0003', relation: 'concerns' }),
    ]);
    expect(report.complete).toBe(false);
  });

  it('catches a rule that arrived retired', () => {
    importCorpus();
    store.db.prepare(
      `UPDATE observations SET valid_to = 1
        WHERE project = ? AND json_extract(metadata, '$.record_id') = '0003'`,
    ).run(PROJECT);

    const report = verifyMigration(store.db as never, PROJECT, sources());
    // The quietest of the three failures: the record is there, searchable, and
    // simply stops being current.
    expect(report.wronglyRetired).toEqual(['0003']);
    expect(report.complete).toBe(false);
  });

  it('catches a rule that came back in force', () => {
    importCorpus();
    store.db.prepare(
      `UPDATE observations SET valid_to = NULL
        WHERE project = ? AND json_extract(metadata, '$.record_id') = '0001'`,
    ).run(PROJECT);

    const report = verifyMigration(store.db as never, PROJECT, sources());
    expect(report.wronglyActive).toEqual(['0001']);
    expect(report.complete).toBe(false);
  });

  it('does not fail over an entry that was authored in keepmind after the import', () => {
    importCorpus();
    authorCuratedRecord(store as unknown as AuthoringStore, {
      recordId: '0100', title: 'Direkt hier geschrieben', status: 'gilt',
      body: '## Entscheidung\n\nDiese Akte hat nie eine Datei gehabt.',
    }, { project: PROJECT });

    const report = verifyMigration(store.db as never, PROJECT, sources());
    // Reported so it is visible, but not a failure — otherwise the check would
    // fail more the longer the file-free way of working is used.
    expect(report.extraRecords).toEqual(['0100']);
    expect(report.complete).toBe(true);
  });

  it('does not fail over a status word that no supersession backs', () => {
    // The importer stores `Stand:` verbatim and deliberately does not turn it
    // into a closed window. Failing the migration over that would fail it for
    // a design decision rather than for anything lost.
    write('0005-zurueckgezogen.md', `# 0005 — Zurückgezogene Regel

**Stand:** zurückgezogen · **Datum:** 03.08.2026

## Entscheidung

Gilt nicht mehr, und nichts löst sie ab.
`);
    importCorpus();

    const report = verifyMigration(store.db as never, PROJECT, sources());
    expect(report.statusRetiredWithoutSupersession).toEqual(['0005']);
    expect(report.wronglyActive).toEqual([]);
    expect(report.complete).toBe(true);
  });

  it('refuses to call the migration complete when a source file could not be read', () => {
    importCorpus();
    const report = verifyMigration(store.db as never, PROJECT, [{ path: join(dir, 'gibt-es-nicht'), kind: 'akten' }]);
    expect(report.failed).toHaveLength(1);
    expect(report.complete).toBe(false);
  });

  it('sees a record deleted from the files as an extra, not as a loss', () => {
    importCorpus();
    unlinkSync(join(dir, '0004-vierte-regel.md'));

    const report = verifyMigration(store.db as never, PROJECT, sources());
    expect(report.missingRecords).toEqual([]);
    expect(report.extraRecords).toEqual(['0004']);
  });
});
