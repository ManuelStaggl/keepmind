import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { CuratedAutoImport, type AutoImportHost, type CuratedIndexer } from '../../src/services/curated/auto-import.js';
import { readImportState } from '../../src/services/curated/import-state.js';

const PROJECT = 'steuerstand';

let dataDir: string;
let corpus: string;
let store: SessionStore;
let importer: CuratedAutoImport | null = null;
let indexed: number[][];

/** Stands in for the worker's vector sync: records what it was asked to index. */
function indexerSpy(succeeds = true): CuratedIndexer {
  return {
    async ensureObservationsIndexed(_project: string, ids: number[]) {
      indexed.push(ids);
      return succeeds
        ? { indexed: true, total: ids.length, missing: [], repaired: false }
        : { indexed: false, total: ids.length, missing: ids, repaired: false };
    },
  };
}

function host(indexer: CuratedIndexer | null): AutoImportHost {
  return { store: () => store as never, indexer: () => indexer };
}

function writeRecord(name: string, body: string): void {
  writeFileSync(join(corpus, name), body, 'utf8');
}

function writeSettings(extra: Record<string, unknown> = {}): void {
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
    curatedSources: [{ path: corpus.replace(/\\/g, '/'), kind: 'akten' }],
    KEEPMIND_CURATED_PROJECT: PROJECT,
    ...extra,
  }), 'utf8');
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'keepmind-auto-state-'));
  corpus = mkdtempSync(join(tmpdir(), 'keepmind-auto-corpus-'));
  store = new SessionStore(':memory:');
  indexed = [];
  process.env.KEEPMIND_CURATED_WATCH_DEBOUNCE_MS = '20';
  writeRecord('0001-erste-regel.md', `# 0001 — Erste Regel

**Stand:** gilt · **Datum:** 01.06.2026

Belege bleiben sieben Jahre liegen.
`);
  writeSettings();
});

afterEach(() => {
  importer?.stop();
  importer = null;
  store.close();
  delete process.env.KEEPMIND_CURATED_WATCH_DEBOUNCE_MS;
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(corpus, { recursive: true, force: true });
});

async function until(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return predicate();
}

describe('curated auto-import', () => {
  it('imports on startup when the store has never seen the sources', async () => {
    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    const outcomes = await importer.start();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ran).toBe(true);
    expect(outcomes[0].project).toBe(PROJECT);
    expect(store.getCuratedRecord(PROJECT, '0001')?.narrative).toContain('sieben Jahre');
    // It also indexed what it wrote — that is the half that used to go missing.
    expect(indexed).toHaveLength(1);
    expect(indexed[0]).toContain(store.getCuratedRecord(PROJECT, '0001')!.id);
  });

  it('does nothing on a second start when nothing changed', async () => {
    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    await importer.start();
    importer.stop();

    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    const outcomes = await importer.start();
    expect(outcomes[0].ran).toBe(false);
    expect(outcomes[0].skipped).toBe('up to date');
  });

  // The acceptance criterion: change a source file, and the new content is
  // findable without anybody running a command.
  it('re-imports when a source file changes, with no manual trigger', async () => {
    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    await importer.start();
    expect(store.getCuratedRecord(PROJECT, '0002')).toBeNull();

    writeRecord('0002-zweite-regel.md', `# 0002 — Zweite Regel

**Stand:** gilt · **Datum:** 02.06.2026

Reisekosten werden monatlich abgerechnet.
`);

    const arrived = await until(() => store.getCuratedRecord(PROJECT, '0002') !== null);
    expect(arrived).toBe(true);
    expect(store.getCuratedRecord(PROJECT, '0002')?.narrative).toContain('monatlich');
  });

  it('records a failed index as a failure, and stays stale so the next start retries', async () => {
    importer = new CuratedAutoImport(host(indexerSpy(false)), dataDir);
    const outcomes = await importer.start();

    expect(outcomes[0].ran).toBe(true);
    expect(outcomes[0].indexed).toBe(false);

    const state = readImportState(PROJECT, dataDir);
    expect(state?.lastSuccessEpoch).toBeNull();
    expect(state?.failure).toContain('not indexed');
    // The record IS stored — nothing is thrown away because the index failed.
    expect(store.getCuratedRecord(PROJECT, '0001')).not.toBeNull();

    importer.stop();
    importer = new CuratedAutoImport(host(indexerSpy(true)), dataDir);
    const retry = await importer.start();
    expect(retry[0].ran).toBe(true);
    expect(readImportState(PROJECT, dataDir)?.lastSuccessEpoch).not.toBeNull();
  });

  it('refuses to guess a project when none is configured and none can be observed', async () => {
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
      curatedSources: [{ path: corpus.replace(/\\/g, '/'), kind: 'akten' }],
    }), 'utf8');

    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    const outcomes = await importer.start();

    expect(outcomes[0].ran).toBe(false);
    expect(outcomes[0].skipped).toContain('no project to import into');
    expect(store.curatedProjects()).toHaveLength(0);
  });

  // The other half of "declared, never guessed": a source that names its own
  // project needs no fallback, and demanding one anyway meant a fully declared
  // configuration never ran on a machine where no project holds curated rows.
  it('runs without any fallback when every source names its own project', async () => {
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
      curatedSources: [{ path: corpus.replace(/\\/g, '/'), kind: 'akten', project: 'p1probe' }],
    }), 'utf8');

    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    const outcomes = await importer.start();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ran).toBe(true);
    expect(outcomes[0].project).toBe('p1probe');
    expect(store.getCuratedRecord('p1probe', '0001')?.narrative).toContain('sieben Jahre');
  });

  // A half run is worse than none: part of the corpus fresh, part stale, and a
  // success stamped over it.
  it('aborts whole when only SOME sources name a project and no fallback exists', async () => {
    const second = mkdtempSync(join(tmpdir(), 'keepmind-auto-corpus2-'));
    try {
      writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
        curatedSources: [
          { path: corpus.replace(/\\/g, '/'), kind: 'akten', project: 'p1probe' },
          { path: second.replace(/\\/g, '/'), kind: 'akten' },
        ],
      }), 'utf8');

      importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
      const outcomes = await importer.start();

      expect(outcomes[0].ran).toBe(false);
      expect(outcomes[0].skipped).toContain('no project to import into');
      expect(store.curatedProjects()).toHaveLength(0);
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('files under the one project that already holds curated rows', async () => {
    // First run establishes the project the way a hand-run import would.
    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    await importer.start();
    importer.stop();

    // Now the configuration loses its project, but the store still knows.
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
      curatedSources: [{ path: corpus.replace(/\\/g, '/'), kind: 'akten' }],
    }), 'utf8');
    writeRecord('0003-dritte-regel.md', `# 0003 — Dritte Regel

**Stand:** gilt · **Datum:** 03.06.2026

Bewirtungsbelege brauchen den Anlass.
`);

    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    const outcomes = await importer.start();
    expect(outcomes[0].project).toBe(PROJECT);
    expect(store.getCuratedRecord(PROJECT, '0003')).not.toBeNull();
  });

  it('does not import when a configured source directory is gone', async () => {
    rmSync(corpus, { recursive: true, force: true });
    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    const outcomes = await importer.start();

    expect(outcomes[0].ran).toBe(false);
    expect(outcomes[0].skipped).toContain('missing');
    expect(store.curatedObservationIds(PROJECT)).toHaveLength(0);
  });

  it('leaves a previous index verdict alone when it cannot run at all', async () => {
    // A skip learns nothing about the index. Asserting `false` here wiped the
    // flag a successful run had set, and the session-start block then reported
    // a fully embedded corpus as missing from the semantic index — on a machine
    // whose only fault was not having the source files.
    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    await importer.start();
    importer.stop();
    expect(readImportState(PROJECT, dataDir)?.indexed).toBe(true);

    rmSync(corpus, { recursive: true, force: true });
    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    await importer.start();

    const state = readImportState(PROJECT, dataDir);
    expect(state?.indexed).toBe(true);
    expect(state?.failure).toContain('missing');
  });

  it('picks up a corpus that arrives after the worker started', async () => {
    // The "not there YET" machine: a drive that gets mounted, a directory about
    // to be created. Without a watch on the nearest existing ancestor, the
    // startup check has already run and nothing looks again until a restart.
    const parent = mkdtempSync(join(tmpdir(), 'keepmind-auto-parent-'));
    const late = join(parent, 'entscheidungen');
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
      curatedSources: [{ path: late.replace(/\\/g, '/'), kind: 'akten' }],
      KEEPMIND_CURATED_PROJECT: PROJECT,
    }), 'utf8');

    importer = new CuratedAutoImport(host(indexerSpy()), dataDir);
    const startup = await importer.start();
    expect(startup[0].ran).toBe(false);
    expect(store.curatedObservationIds(PROJECT)).toHaveLength(0);

    try {
      mkdirSync(late, { recursive: true });
      writeFileSync(join(late, '0007-spaete-regel.md'), `# 0007 — Spaete Regel

**Stand:** gilt · **Datum:** 07.06.2026

Der Bestand kam erst nach dem Start an.
`, 'utf8');

      await waitFor(() => store.getCuratedRecord(PROJECT, '0007') !== null);
      expect(store.getCuratedRecord(PROJECT, '0007')).not.toBeNull();
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

/** Poll until `ready` or the deadline — the watcher path is asynchronous. */
async function waitFor(ready: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
