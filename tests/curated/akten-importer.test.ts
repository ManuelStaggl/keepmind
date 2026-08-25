import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importAktenDirectory,
  renderRecord,
  subtitleFor,
  type CuratedStore,
} from '../../src/services/curated/akten-importer.js';
import { parseAkte } from '../../src/services/curated/akten-parser.js';

/**
 * A store that records what it was asked to do. The point of the acceptance
 * test below is what is NOT called, so the double has to be able to notice
 * calls it does not expect.
 */
function makeStore() {
  const stored: any[] = [];
  const store: CuratedStore = {
    getOrCreateManualSession: () => 'session-1',
    storeObservation: (_sid, project, observation) => {
      stored.push({ project, ...observation });
      return { id: stored.length, createdAtEpoch: 1_700_000_000_000 };
    },
  };
  return { store, stored };
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'akten-import-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): void {
  writeFileSync(join(dir, name), content, 'utf8');
}

const RECORD = `# 0068 — Beurteilt wird in echten Anwendungen

**Datum:** 09.08.2026 · **Entschieden von:** Manuel · **Stand:** gilt · **Schränkt ein:** 0042, 0043

## Ausgangslage

Der Durchgang wurde wieder aufgenommen.

## Entscheidung

Beurteilt wird erst nach der Ablösung.
`;

describe('importAktenDirectory — the model-free guarantee', () => {
  it('NEVER calls anything but the plain store — the whole point of A1', () => {
    // The acceptance condition was stated as "not one outbound call over the
    // corpus". It is enforced structurally: this importer is handed a store
    // with exactly two methods, so there is no queue and no provider to reach.
    // A Proxy makes any other call an immediate, named failure rather than a
    // silent extra round trip.
    const { stored } = makeStore();
    const forbidden: string[] = [];
    // The allowed set is written out in full and on purpose. Every name here
    // is a plain storage call; none of them enqueues work, and the queue is
    // the only thing in keepmind that reaches a model. Adding a name to this
    // list is the moment to check that property again.
    const strict = new Proxy(
      {
        getOrCreateManualSession: () => 'session-1',
        storeObservation: (_s: string, project: string, observation: any) => {
          stored.push({ project, ...observation });
          return { id: stored.length, createdAtEpoch: 1 };
        },
        replaceEdgesForSource: () => ({ inserted: 0, removed: 0 }),
        // Checked when it was added: a single UPDATE that closes the validity
        // window of an earlier revision of the same record. It writes to the
        // observations table and enqueues nothing, so the model-free property
        // is unchanged.
        closeOtherCuratedRevisions: () => ({ closed: 0 }),
      } as any,
      {
        get(target, prop: string) {
          if (prop in target) return target[prop];
          forbidden.push(prop);
          return () => { throw new Error(`importer reached for ${prop}`); };
        },
      },
    ) as CuratedStore;

    for (let i = 1; i <= 20; i++) {
      write(`0${100 + i}-record.md`, RECORD.replace('0068', `0${100 + i}`));
    }

    const report = importAktenDirectory(strict, dir, { project: 'p' });

    expect(report.imported).toHaveLength(20);
    expect(report.failed).toHaveLength(0);
    expect(forbidden).toEqual([]);
    // Every row is marked curated, which is what keeps it out of the
    // compressor and lets the A9 origin filter separate it later.
    expect(stored.every(o => o.source_kind === 'curated')).toBe(true);
  });

  it('stores path and 1-based heading line on every row (A4)', () => {
    write('0068-record.md', RECORD);
    const { store, stored } = makeStore();

    const report = importAktenDirectory(store, dir, { project: 'p' });

    expect(report.imported).toHaveLength(1);
    expect(stored[0].source_path).toBe(join(dir, '0068-record.md'));
    expect(stored[0].source_line).toBe(1);
    // A citation must survive on the observation itself — a record with no
    // relations at all still has to be quotable.
    expect(report.imported[0].sourceLine).toBe(1);
    expect(report.imported[0].recordId).toBe('0068');
  });

  it('skips files without a record number, by the number and not the filename', () => {
    write('0068-record.md', RECORD);
    write('LIESMICH.md', '# Verzeichnis der Akten\n\nÜbersicht über alles.\n');
    write('VORLAGE.md', '# Vorlage\n\n**Stand:** —\n');
    const { store } = makeStore();

    const report = importAktenDirectory(store, dir, { project: 'p' });

    expect(report.imported.map(r => r.recordId)).toEqual(['0068']);
    expect(report.skipped.map(s => s.file).sort()).toEqual(['LIESMICH.md', 'VORLAGE.md']);
    expect(report.skipped.every(s => s.reason.includes('record number'))).toBe(true);
  });

  it('ignores non-markdown files and subdirectories without failing', () => {
    write('0068-record.md', RECORD);
    write('notizen.txt', 'kein Markdown');
    mkdirSync(join(dir, 'unterordner'));
    const { store } = makeStore();

    const report = importAktenDirectory(store, dir, { project: 'p' });

    expect(report.imported).toHaveLength(1);
    expect(report.failed).toHaveLength(0);
    expect(report.skipped.map(s => s.file)).toContain('notizen.txt');
  });

  it('dry run reports the same records without touching the store', () => {
    write('0068-record.md', RECORD);
    const { store, stored } = makeStore();

    const report = importAktenDirectory(store, dir, { project: 'p', dryRun: true });

    expect(report.imported).toHaveLength(1);
    expect(report.imported[0].recordId).toBe('0068');
    expect(stored).toHaveLength(0);
  });

  it('one unreadable file does not abort the run', () => {
    write('0068-record.md', RECORD);
    write('0069-record.md', RECORD.replace('0068', '0069'));
    const store: CuratedStore = {
      getOrCreateManualSession: () => 's',
      storeObservation: (_s, _p, observation) => {
        if (observation.title?.startsWith('0068')) throw new Error('disk gone');
        return { id: 2, createdAtEpoch: 1 };
      },
    };

    const report = importAktenDirectory(store, dir, { project: 'p' });

    expect(report.failed.map(f => f.file)).toEqual(['0068-record.md']);
    expect(report.imported.map(r => r.recordId)).toEqual(['0069']);
  });
});

describe('what gets stored', () => {
  it('keeps the record verbatim — header block then body', () => {
    const parsed = parseAkte(RECORD);
    const rendered = renderRecord(parsed);
    expect(rendered).toContain('**Schränkt ein:** 0042, 0043');
    expect(rendered).toContain('## Entscheidung');
    expect(rendered).toContain('Beurteilt wird erst nach der Ablösung.');
    // The heading is already the title; repeating it in the narrative would
    // pay for it twice on every injection.
    expect(rendered).not.toContain('# 0068 —');
  });

  it('carries every harvested label into metadata, as written', () => {
    write('0068-record.md', RECORD);
    const { store, stored } = makeStore();
    importAktenDirectory(store, dir, { project: 'p' });

    const metadata = JSON.parse(stored[0].metadata);
    expect(metadata.record_id).toBe('0068');
    expect(metadata.status).toBe('gilt');
    const names = metadata.fields.map((f: any) => f.name);
    expect(names).toContain('Schränkt ein');
    // The relation is preserved with its own value so the edge reader can work
    // from storage instead of reopening the file.
    const edge = metadata.fields.find((f: any) => f.name === 'Schränkt ein');
    expect(edge.value).toBe('0042, 0043');
  });

  it('summarises status, date and author into the subtitle', () => {
    expect(subtitleFor(parseAkte(RECORD))).toBe('Stand: gilt · 09.08.2026 · Manuel');
  });

  it('does not invent a status for a record that carries none', () => {
    const parsed = parseAkte('# 0113 — Titel\n\n**Datum:** 11.08.2026\n\n## X\n\nText\n');
    expect(subtitleFor(parsed)).toBe('11.08.2026');
    expect(subtitleFor(parsed)).not.toContain('Stand');
  });
});
