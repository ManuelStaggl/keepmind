import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { curatedHealth, describeCuratedHealth } from '../../src/services/curated/health.js';
import { stampSources, writeImportState } from '../../src/services/curated/import-state.js';
import { renderCuratedHealth } from '../../src/services/context/sections/CuratedHealthRenderer.js';

const PROJECT = 'steuerstand';

let dataDir: string;
let corpus: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'keepmind-health-state-'));
  corpus = mkdtempSync(join(tmpdir(), 'keepmind-health-corpus-'));
  writeFileSync(join(corpus, '0001-erste.md'), '# 0001 — Erste\n', 'utf8');
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
    curatedSources: [{ path: corpus.replace(/\\/g, '/'), kind: 'akten', project: PROJECT }],
  }), 'utf8');
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(corpus, { recursive: true, force: true });
});

function recordSuccess(now = Date.now()): void {
  writeImportState({
    project: PROJECT,
    lastAttemptEpoch: now,
    lastSuccessEpoch: now,
    records: 147,
    edges: 80,
    indexed: true,
    failure: null,
    sources: stampSources([{ path: corpus, kind: 'akten', project: PROJECT }]),
  }, dataDir);
}

describe('curated health', () => {
  it('reports a configured corpus that was never imported', () => {
    const [health] = curatedHealth(dataDir);
    expect(health.project).toBe(PROJECT);
    expect(health.ok).toBe(false);
    expect(health.lastSuccessEpoch).toBeNull();
    expect(describeCuratedHealth(health)).toContain('never');
  });

  it('reports a fresh import as in order, with the counts', () => {
    recordSuccess();
    const [health] = curatedHealth(dataDir);
    expect(health.ok).toBe(true);
    const line = describeCuratedHealth(health);
    expect(line).toContain('147 record(s)');
    expect(line).toContain('80 relation(s)');
    expect(line).toContain('index in sync');
  });

  // The failure that went unnoticed for four days: the sources moved on and
  // nothing said so.
  it('goes loud when a source is newer than the last successful import', () => {
    recordSuccess();
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(corpus, '0001-erste.md'), later, later);

    const [health] = curatedHealth(dataDir);
    expect(health.ok).toBe(false);
    expect(health.stale).toBe(true);
    expect(describeCuratedHealth(health)).toContain('was changed after the last import');
  });

  it('calls a stored-but-unindexed corpus out by name', () => {
    const now = Date.now();
    writeImportState({
      project: PROJECT,
      lastAttemptEpoch: now,
      lastSuccessEpoch: null,
      records: 0,
      edges: 0,
      indexed: false,
      failure: 'not indexed — the worker could not be started',
      sources: [],
    }, dataDir);

    const [health] = curatedHealth(dataDir);
    expect(health.ok).toBe(false);
    expect(describeCuratedHealth(health)).toContain('semantic search cannot see');
  });
});

describe('session-start rendering', () => {
  it('says nothing at all when no curated corpus exists', () => {
    expect(renderCuratedHealth({ entries: [] })).toEqual([]);
  });

  it('is one quiet line when everything is in order', () => {
    recordSuccess();
    const output = renderCuratedHealth({ entries: curatedHealth(dataDir) });
    expect(output.filter(Boolean)).toHaveLength(1);
    expect(output[0]).toContain(`Curated corpus [${PROJECT}]`);
    expect(output.join('\n')).not.toContain('⚠');
  });

  it('is a heading a reader cannot skim past when it is not', () => {
    const output = renderCuratedHealth({ entries: curatedHealth(dataDir) }).join('\n');
    expect(output).toContain('⚠ CURATED CORPUS OUT OF STEP');
    expect(output).toContain('curated:import');
  });
});
