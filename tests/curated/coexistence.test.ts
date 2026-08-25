// SPDX-License-Identifier: Apache-2.0
//
// Two ways into the corpus, one store: an entry authored HERE and an archive
// still being read from FILES have to live side by side.
//
// This is the state Weg B passes through, not a corner case. The file archive
// is handed over once and the files are removed only after `curated:verify`
// says the corpus arrived; in between, both paths write to the same table. An
// authored entry that a file import quietly closes is indistinguishable from
// one that was never written — and the next thing that happens is a new entry
// under a number already taken.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { importAktenDirectory } from '../../src/services/curated/akten-importer.js';
import { applySupersessions } from '../../src/services/curated/supersession.js';
import { authorCuratedRecord, type AuthoringStore } from '../../src/services/curated/authoring.js';

const PROJECT = 'gemischt';
const NOW = 1_700_000_000_000;

let dir: string;
let store: SessionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keepmind-gemischt-'));
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

function writeCorpus(): void {
  write('0001-erste-regel.md', `# 0001 — Erste Regel

**Stand:** gilt · **Datum:** 01.06.2026 · **Entschieden von:** die Betreiberin

## Entscheidung

So wurde es zuerst festgelegt.
`);
  write('0002-zweite-regel.md', `# 0002 — Zweite Regel

**Stand:** gilt · **Datum:** 01.07.2026 · **Vermerk:** betrifft 0001

## Entscheidung

Und so ergänzt.
`);
}

function importCorpus(): void {
  importAktenDirectory(store as never, dir, { project: PROJECT, nowEpoch: NOW });
  applySupersessions(store.db as never, PROJECT, NOW);
}

function author(draft: Parameters<typeof authorCuratedRecord>[1], expectMode?: 'new' | 'existing') {
  return authorCuratedRecord(store as unknown as AuthoringStore, draft, {
    project: PROJECT, ...(expectMode ? { expect: expectMode } : {}),
  });
}

/** The active revisions of a record — the invariant is that there is exactly one. */
function active(recordId: string) {
  return store.db.prepare(`
    SELECT id, source_path FROM observations
     WHERE project = ? AND source_kind = 'curated' AND valid_to IS NULL
       AND COALESCE(json_extract(metadata, '$.record_id'), json_extract(metadata, '$.vorgang_id')) = ?
  `).all(PROJECT, recordId);
}

/** Everything about a record that a later import must not have changed. */
function fingerprint(recordId: string) {
  const row = store.db.prepare(`
    SELECT id, title, narrative, source_path, valid_from, valid_to, metadata
      FROM observations
     WHERE project = ? AND source_kind = 'curated'
       AND COALESCE(json_extract(metadata, '$.record_id'), json_extract(metadata, '$.vorgang_id')) = ?
     ORDER BY id
  `).all(PROJECT, recordId);
  const edges = store.db.prepare(`
    SELECT from_record, to_record, relation, certainty, source_path, source_line
      FROM decision_edges WHERE project = ? AND from_record = ?
     ORDER BY to_record, relation
  `).all(PROJECT, recordId);
  return { row, edges };
}

describe('an entry authored here survives a file import', () => {
  it('is untouched when the same corpus is read again', () => {
    importCorpus();
    const authored = author({
      title: 'Nur hier geschrieben', status: 'gilt', date: '05.08.2026',
      body: '## Entscheidung\n\nDiese Akte hat nie eine Datei gehabt.',
    });
    const before = fingerprint(authored.recordId);
    expect(before.row).toHaveLength(1);

    importCorpus();

    expect(fingerprint(authored.recordId)).toEqual(before);
    expect(store.getCuratedRecord(PROJECT, authored.recordId)).not.toBeNull();
  });

  it('keeps the relations it declared', () => {
    importCorpus();
    const authored = author({
      title: 'Ergänzt eine Dateiakte', status: 'gilt', date: '06.08.2026',
      relations: [{ relation: 'concerns', targets: ['0001'] }],
      body: '## Entscheidung\n\nBezieht sich auf eine Akte, die aus einer Datei kam.',
    });
    const before = fingerprint(authored.recordId);
    expect(before.edges.length).toBeGreaterThan(0);

    importCorpus();

    // Edges are replaced per SOURCE PATH, and an authored record cites
    // `keepmind://curated/<id>` — a path no directory scan can produce. That
    // is what keeps a file import from deleting them.
    expect(fingerprint(authored.recordId).edges).toEqual(before.edges);
  });

  it('is not retired by an import that has nothing to say about it', () => {
    importCorpus();
    const authored = author({
      title: 'Bleibt in Kraft', status: 'gilt', date: '07.08.2026',
      body: '## Entscheidung\n\nKein Dateisatz erwähnt diese Akte.',
    });

    importCorpus();
    applySupersessions(store.db as never, PROJECT, NOW + 1000);

    // getCuratedRecord returns the ACTIVE revision only, so a non-null answer
    // is the claim: the record is still in force.
    const record = store.getCuratedRecord(PROJECT, authored.recordId);
    expect(record).not.toBeNull();
    expect(record!.valid_to).toBeNull();
  });

  it('survives the source directory going away entirely', () => {
    importCorpus();
    const authored = author({
      title: 'Überlebt den Wegfall der Quellen', status: 'gilt', date: '08.08.2026',
      body: '## Entscheidung\n\nDie Dateien verschwinden, der Eintrag bleibt.',
    });
    const before = fingerprint(authored.recordId);

    unlinkSync(join(dir, '0001-erste-regel.md'));
    unlinkSync(join(dir, '0002-zweite-regel.md'));
    importCorpus();

    expect(fingerprint(authored.recordId)).toEqual(before);
  });

  it('is still what an authored record reads as, not a file record', () => {
    importCorpus();
    const authored = author({
      title: 'Herkunft bleibt erkennbar', status: 'gilt', date: '09.08.2026',
      body: '## Entscheidung\n\nDie Herkunft ist Teil der Aussage.',
    });

    importCorpus();

    const row = store.db.prepare(`
      SELECT source_path FROM observations
       WHERE project = ? AND source_kind = 'curated' AND valid_to IS NULL
         AND json_extract(metadata, '$.record_id') = ?
    `).get(PROJECT, authored.recordId) as { source_path: string };
    expect(row.source_path).toBe(`keepmind://curated/${authored.recordId}`);
  });
});

describe('the two paths cannot claim the same number', () => {
  it('does not hand out a number the file archive already uses', () => {
    importCorpus();
    const authored = author({
      title: 'Nach der Datei', status: 'gilt', date: '10.08.2026',
      body: '## Entscheidung\n\nMuss hinter 0002 einsortiert werden.',
    });
    expect(authored.recordId).toBe('0003');
  });

  it('a file claiming an authored number does not silently take it over', () => {
    importCorpus();
    const authored = author({
      title: 'Hier geschrieben', status: 'gilt', date: '11.08.2026',
      body: '## Entscheidung\n\nDer Wortlaut, der zählt.',
    });
    const before = fingerprint(authored.recordId);

    // Somebody writes a file under the number keepmind just handed out.
    write(`${authored.recordId}-fremde-datei.md`, `# ${authored.recordId} — Ganz etwas anderes

**Stand:** gilt · **Datum:** 12.08.2026

## Entscheidung

Ein Text, den niemand hier geschrieben hat.
`);
    importCorpus();

    const after = fingerprint(authored.recordId);
    // Nothing is deleted: the authored wording is still readable.
    const wordings = after.row.map(r => (r as { narrative: string }).narrative);
    expect(wordings.some(w => w.includes('Der Wortlaut, der zählt.'))).toBe(true);
    expect(before.row).toHaveLength(1);

    // And the sharper claim, which is what "not overwritten" actually means:
    // the number must not now ANSWER with the file's text.
    const current = store.getCuratedRecord(PROJECT, authored.recordId);
    expect(current).not.toBeNull();
    expect(current!.narrative).toContain('Der Wortlaut, der zählt.');
  });
});

describe('an entry may never end up with NO active revision', () => {
  /**
   * The sequence that cost a record its whole existence: import a file, edit
   * the record here, import again. De-duplication landed the unchanged file
   * back on the row the edit had already closed, and closing "every other
   * revision" then closed the authored one too. Both revisions sat in the
   * table, readable, nothing deleted and nothing logged — and
   * `getCuratedRecord` answered null.
   */
  it('survives import → edit here → import again', () => {
    importCorpus();
    author({
      recordId: '0001', title: 'Erste Regel', status: 'gilt', date: '01.06.2026',
      body: '## Entscheidung\n\nHier bearbeitet, nicht in der Datei.',
    }, 'existing');

    importCorpus();

    const record = store.getCuratedRecord(PROJECT, '0001');
    expect(record).not.toBeNull();
    expect(record!.narrative).toContain('Hier bearbeitet, nicht in der Datei.');
    expect(active('0001')).toHaveLength(1);
  });

  it('leaves exactly one revision active when a file changes back to an older wording', () => {
    // Same trap without any authoring: A → B → A lands the third import back
    // on the row the second one closed.
    importCorpus();
    const first = store.getCuratedRecord(PROJECT, '0001')!.narrative;

    write('0001-erste-regel.md', `# 0001 — Erste Regel

**Stand:** gilt · **Datum:** 01.06.2026 · **Entschieden von:** die Betreiberin

## Entscheidung

Zwischendurch stand hier etwas anderes.
`);
    importCorpus();
    expect(active('0001')).toHaveLength(1);

    write('0001-erste-regel.md', `# 0001 — Erste Regel

**Stand:** gilt · **Datum:** 01.06.2026 · **Entschieden von:** die Betreiberin

## Entscheidung

So wurde es zuerst festgelegt.
`);
    importCorpus();

    const rows = active('0001');
    expect(rows).toHaveLength(1);
    expect(store.getCuratedRecord(PROJECT, '0001')!.narrative).toBe(first);
  });

  it('reports the conflict rather than resolving it quietly', () => {
    importCorpus();
    const authored = author({
      title: 'Hier geschrieben', status: 'gilt', date: '11.08.2026',
      body: '## Entscheidung\n\nDer Wortlaut, der zählt.',
    });
    write(`${authored.recordId}-fremde-datei.md`, `# ${authored.recordId} — Ganz etwas anderes

**Stand:** gilt · **Datum:** 12.08.2026

## Entscheidung

Ein Text, den niemand hier geschrieben hat.
`);

    const report = importAktenDirectory(store as never, dir, { project: PROJECT, nowEpoch: NOW });

    expect(report.authoredConflicts).toHaveLength(1);
    expect(report.authoredConflicts[0].recordId).toBe(authored.recordId);
    expect(report.authoredConflicts[0].authoredSource).toBe(`keepmind://curated/${authored.recordId}`);
    // Stored, not dropped — the file's wording is still readable.
    expect(fingerprint(authored.recordId).row).toHaveLength(2);
    expect(active(authored.recordId)).toHaveLength(1);
  });
});
