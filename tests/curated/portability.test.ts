// SPDX-License-Identifier: Apache-2.0
//
// keepmind runs on machines that do not have the curated corpus.
//
// It is developed on one machine and used on another, and the corpus does not
// necessarily follow — the source directories may be on a drive that is not
// mounted, may not exist yet, or may simply belong to a different computer.
// Three relationships, and until now the code could only tell two apart:
//
//   present  — sources readable here. Strict: an import that stopped running is
//              the four-day outage the whole path exists to catch.
//   detached — the RECORDS are held here, their source files are not. Nothing
//              refreshes them; nothing is broken either.
//   absent   — neither sources nor records. Configured for a corpus this
//              machine does not have, and the only correct output is silence.
//
// Measured before this: a development machine holding 333 fully indexed records
// whose fixture directory had been deleted reported two REQUIRED doctor
// failures and put "NOT in the semantic index — semantic search cannot see
// these records" at the top of every session, about records semantic search
// could see perfectly well.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { curatedHealth, describeCuratedHealth } from '../../src/services/curated/health.js';
import { writeImportState } from '../../src/services/curated/import-state.js';
import { renderCuratedHealth } from '../../src/services/context/sections/CuratedHealthRenderer.js';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { runCuratedImport } from '../../src/services/curated/import-run.js';

const PROJECT = 'steuerstand';

let dataDir: string;
let corpusDir: string;

/** Point `curatedSources` at `paths`, as a settings file on this machine would. */
function configureSources(paths: string[]): void {
  writeFileSync(
    join(dataDir, 'settings.json'),
    JSON.stringify({
      KEEPMIND_CURATED_PROJECT: PROJECT,
      curatedSources: paths.map(path => ({ path, kind: 'akten' })),
    }),
    'utf8',
  );
}

function seedFailedRun(failure: string): void {
  writeImportState({
    project: PROJECT,
    lastAttemptEpoch: Date.now(),
    lastSuccessEpoch: null,
    records: 0,
    edges: 0,
    indexed: false,
    failure,
    sources: [],
  }, dataDir);
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'keepmind-portability-'));
  corpusDir = mkdtempSync(join(tmpdir(), 'keepmind-corpus-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(corpusDir, { recursive: true, force: true });
});

describe('a machine that has neither the sources nor the records', () => {
  beforeEach(() => {
    configureSources([join(corpusDir, 'gone')]);
    seedFailedRun('source director(y|ies) missing');
  });

  it('reads as absent, not as a broken import', () => {
    const [health] = curatedHealth(dataDir, { storedRecords: new Map() });

    expect(health.presence).toBe('absent');
    expect(health.storedRecords).toBe(0);
    expect(describeCuratedHealth(health)).toBe('configured for a corpus this machine does not have');
  });

  it('says nothing at all at a session start', () => {
    // A settings file that travels ahead of the corpus must not put a warning
    // at the top of every session on every machine it reaches first.
    const entries = curatedHealth(dataDir, { storedRecords: new Map() });

    expect(renderCuratedHealth({ entries })).toEqual([]);
  });
});

describe('a machine that holds the records but not the files', () => {
  beforeEach(() => {
    configureSources([join(corpusDir, 'gone')]);
    seedFailedRun('source director(y|ies) missing');
  });

  it('reads as detached and says the records are still searchable', () => {
    const [health] = curatedHealth(dataDir, { storedRecords: new Map([[PROJECT, 333]]) });

    expect(health.presence).toBe('detached');
    const line = describeCuratedHealth(health);
    expect(line).toContain('333 record(s) held here, searchable');
    expect(line).toContain('nothing refreshes them here');
  });

  it('never claims the semantic index is missing them', () => {
    // The whole reason this state needed a name: `indexed: false` is a stamp
    // left by a run that could not start, and it was being read out as a fact
    // about the store.
    const [health] = curatedHealth(dataDir, { storedRecords: new Map([[PROJECT, 333]]) });

    expect(describeCuratedHealth(health)).not.toContain('semantic search cannot see');
    expect(describeCuratedHealth(health)).not.toContain('never imported');
  });

  it('is one line at a session start, not the out-of-step banner', () => {
    // The banner ends in "fix it with `curated:import`", which is useless
    // advice where the files are not there to import.
    const entries = curatedHealth(dataDir, { storedRecords: new Map([[PROJECT, 333]]) });
    const rendered = renderCuratedHealth({ entries }).join('\n');

    expect(rendered).not.toContain('CURATED CORPUS OUT OF STEP');
    expect(rendered).toContain('sources not reachable from this machine');
  });
});

describe('a machine that has the sources', () => {
  beforeEach(() => {
    mkdirSync(join(corpusDir, 'entscheidungen'), { recursive: true });
    configureSources([join(corpusDir, 'entscheidungen')]);
  });

  it('stays strict about an import that never succeeded', () => {
    // The four-day outage. Nothing in this change is allowed to soften it: the
    // sources are right here and the store is behind them.
    seedFailedRun('3 file(s) failed to import');

    const [health] = curatedHealth(dataDir, { storedRecords: new Map([[PROJECT, 333]]) });

    expect(health.presence).toBe('present');
    expect(health.ok).toBe(false);
    const rendered = renderCuratedHealth({ entries: [health] }).join('\n');
    expect(rendered).toContain('CURATED CORPUS OUT OF STEP');
    expect(rendered).toContain('3 file(s) failed to import');
  });

  it('treats a partly reachable source set as present, not as detached', () => {
    // Half the corpus missing IS the outage case: the import refuses to run,
    // and the records the missing directory holds really would go stale with
    // nobody told. Only a set with nothing reachable is a portability question.
    configureSources([join(corpusDir, 'entscheidungen'), join(corpusDir, 'weg')]);
    seedFailedRun('source director(y|ies) missing');

    const [health] = curatedHealth(dataDir, { storedRecords: new Map([[PROJECT, 333]]) });

    expect(health.presence).toBe('present');
  });
});

describe('a corpus that arrives before its contents do', () => {
  it('does not retire anything when the directory is there but still empty', async () => {
    // The half-mounted drive, and the reason the arrival watcher is safe to
    // have at all: a network share or a syncing folder can appear seconds
    // before its files. If an import over an empty directory retired the
    // records whose files it could not see, watching for the directory to
    // appear would be a way to lose the corpus.
    const store = new SessionStore(':memory:');
    const source = mkdtempSync(join(tmpdir(), 'keepmind-arriving-'));
    try {
      writeFileSync(join(source, '0001-belegfrist.md'), `# 0001 — Belegfrist

**Stand:** gilt · **Datum:** 01.06.2026

Belege bleiben sieben Jahre liegen.
`, 'utf8');
      await runCuratedImport(store as never, [{ path: source, kind: 'akten' }], { project: PROJECT });
      expect(store.getCuratedRecord(PROJECT, '0001')).not.toBeNull();

      for (const file of readdirSync(source)) unlinkSync(join(source, file));
      const report = await runCuratedImport(store as never, [{ path: source, kind: 'akten' }], { project: PROJECT });

      expect(report.records).toBe(0);
      expect(store.getCuratedRecord(PROJECT, '0001')).not.toBeNull();
    } finally {
      store.close();
      rmSync(source, { recursive: true, force: true });
    }
  });
});

describe('when the store cannot be counted', () => {
  it('keeps the strict reading rather than assuming the corpus is elsewhere', () => {
    // "Cannot tell" must not resolve to "nothing here": that would silence the
    // outage on exactly the machine that owns the corpus.
    configureSources([join(corpusDir, 'gone')]);
    seedFailedRun('source director(y|ies) missing');

    const [health] = curatedHealth(dataDir, { storedRecords: null });

    expect(health.presence).toBe('unknown');
    expect(health.storedRecords).toBeNull();
    expect(renderCuratedHealth({ entries: [health] }).join('\n')).toContain('CURATED CORPUS OUT OF STEP');
  });
});
