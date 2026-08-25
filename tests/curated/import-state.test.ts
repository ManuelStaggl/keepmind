import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  importIsStale,
  readImportState,
  stampSources,
  writeImportState,
  type CuratedImportState,
} from '../../src/services/curated/import-state.js';
import type { CuratedSource } from '../../src/services/curated/sources.js';

let dataDir: string;
let corpus: string;
let sources: CuratedSource[];

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'keepmind-state-'));
  corpus = mkdtempSync(join(tmpdir(), 'keepmind-corpus-'));
  writeFileSync(join(corpus, '0001-erste.md'), '# 0001 — Erste\n', 'utf8');
  sources = [{ path: corpus, kind: 'akten' }];
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(corpus, { recursive: true, force: true });
});

function successState(overrides: Partial<CuratedImportState> = {}): CuratedImportState {
  return {
    project: 'steuerstand',
    lastAttemptEpoch: Date.now(),
    lastSuccessEpoch: Date.now(),
    records: 1,
    edges: 0,
    indexed: true,
    failure: null,
    sources: stampSources(sources),
    ...overrides,
  };
}

describe('curated import state', () => {
  it('round-trips one project without touching the others', () => {
    writeImportState(successState(), dataDir);
    writeImportState(successState({ project: 'anderes', records: 7 }), dataDir);

    expect(readImportState('steuerstand', dataDir)?.records).toBe(1);
    expect(readImportState('anderes', dataDir)?.records).toBe(7);
  });

  it('reports a project that was never imported as absent, not as empty', () => {
    expect(readImportState('steuerstand', dataDir)).toBeNull();
  });
});

describe('staleness', () => {
  it('is stale when nothing was ever imported', () => {
    expect(importIsStale(null, stampSources(sources)).stale).toBe(true);
  });

  it('is NOT stale right after a successful, indexed import', () => {
    const verdict = importIsStale(successState(), stampSources(sources));
    expect(verdict.stale).toBe(false);
    expect(verdict.reason).toBeNull();
  });

  it('is stale when a source file was touched after the import', () => {
    const state = successState();
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(corpus, '0001-erste.md'), later, later);

    const verdict = importIsStale(state, stampSources(sources));
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toContain('was changed after the last import');
  });

  it('is stale when a file was added, even if no mtime moved', () => {
    const state = successState();
    writeFileSync(join(corpus, '0002-zweite.md'), '# 0002 — Zweite\n', 'utf8');
    // Force the counts apart while claiming the same newest mtime, which is what
    // a copy that preserves timestamps looks like.
    const stamps = stampSources(sources);
    stamps[0].newestMtimeEpoch = state.sources[0].newestMtimeEpoch;

    const verdict = importIsStale(state, stamps);
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toContain('file(s)');
  });

  it('is stale when a subdirectory changed, not only the top level', () => {
    mkdirSync(join(corpus, 'unter'), { recursive: true });
    writeFileSync(join(corpus, 'unter', '0003-tief.md'), '# 0003 — Tief\n', 'utf8');
    const state = successState({ sources: stampSources(sources) });

    const later = new Date(Date.now() + 60_000);
    utimesSync(join(corpus, 'unter', '0003-tief.md'), later, later);

    expect(importIsStale(state, stampSources(sources)).stale).toBe(true);
  });

  // The whole point of the health signal: an import that ran and did not make
  // its rows searchable must NOT read as up to date, or the next check stays
  // quiet forever.
  it('is stale when the last import was not indexed', () => {
    const verdict = importIsStale(successState({ indexed: false }), stampSources(sources));
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toContain('not searchable');
  });

  it('is stale when a configured source was added or removed', () => {
    const state = successState();
    const other = mkdtempSync(join(tmpdir(), 'keepmind-corpus2-'));
    try {
      const withExtra = stampSources([...sources, { path: other, kind: 'vorgaenge' }]);
      expect(importIsStale(state, withExtra).reason).toContain('added');
      expect(importIsStale(state, []).reason).toContain('removed');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('is stale when a source directory has gone missing', () => {
    const state = successState();
    rmSync(corpus, { recursive: true, force: true });
    const verdict = importIsStale(state, stampSources(sources));
    expect(verdict.stale).toBe(true);
    expect(verdict.reason).toContain('missing');
  });
});
