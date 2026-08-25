import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCuratedGroup, summarizeReport, type WorkerProbe } from '../../src/npx-cli/commands/doctor.js';
import { stampSources, writeImportState } from '../../src/services/curated/import-state.js';

const PROJECT = 'steuerstand';

let dataDir: string;
let corpus: string;

const workerUp: WorkerProbe = { reachable: true, port: 37777, pidAlive: true, pidPort: 37777 };
const workerDown: WorkerProbe = { reachable: false, port: 37777, pidAlive: false, pidPort: null };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'keepmind-doctor-state-'));
  corpus = mkdtempSync(join(tmpdir(), 'keepmind-doctor-corpus-'));
  writeFileSync(join(corpus, '0001-erste.md'), '# 0001 — Erste\n', 'utf8');
  writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({
    curatedSources: [{ path: corpus.replace(/\\/g, '/'), kind: 'akten', project: PROJECT }],
  }), 'utf8');
  writeImportState({
    project: PROJECT,
    lastAttemptEpoch: Date.now(),
    lastSuccessEpoch: Date.now(),
    records: 147,
    edges: 80,
    indexed: true,
    failure: null,
    sources: stampSources([{ path: corpus, kind: 'akten', project: PROJECT }]),
  }, dataDir);
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(corpus, { recursive: true, force: true });
});

function find(group: ReturnType<typeof buildCuratedGroup>, prefix: string) {
  return group.checks.find(check => check.name.startsWith(prefix));
}

describe('doctor: curated corpus', () => {
  it('passes the corpus checks when everything is in step', () => {
    const group = buildCuratedGroup(workerUp, dataDir);
    expect(find(group, 'Sources')?.status).toBe('ok');
    expect(find(group, 'Last import')?.status).toBe('ok');
    expect(find(group, 'Worker')?.status).toBe('ok');
  });

  // The acceptance criterion: a stopped worker turns the check red on a machine
  // that carries a curated corpus, because nothing is keeping it current.
  it('goes red when the worker is down', () => {
    const group = buildCuratedGroup(workerDown, dataDir);
    const worker = find(group, 'Worker');
    expect(worker?.status).toBe('fail');
    expect(worker?.required).toBe(true);

    const report = summarizeReport([group]);
    expect(report.ok).toBe(false);
    expect(report.hardFailures).toBeGreaterThan(0);
  });

  it('goes red when a configured source directory cannot be read', () => {
    rmSync(corpus, { recursive: true, force: true });
    const group = buildCuratedGroup(workerUp, dataDir);
    const sources = find(group, 'Sources');
    expect(sources?.status).toBe('fail');
    expect(sources?.required).toBe(true);
  });

  it('names an unindexed corpus as its own failure', () => {
    writeImportState({
      project: PROJECT,
      lastAttemptEpoch: Date.now(),
      lastSuccessEpoch: Date.now() - 86_400_000,
      records: 147,
      edges: 80,
      indexed: false,
      failure: 'not indexed — the worker could not be started',
      sources: stampSources([{ path: corpus, kind: 'akten', project: PROJECT }]),
    }, dataDir);

    const group = buildCuratedGroup(workerUp, dataDir);
    expect(find(group, 'Semantic index')?.status).toBe('fail');
    expect(summarizeReport([group]).ok).toBe(false);
  });

  it('skips the whole group on a machine with no curated sources', () => {
    writeFileSync(join(dataDir, 'settings.json'), '{}', 'utf8');
    rmSync(join(dataDir, 'curated-import-state.json'), { force: true });

    const group = buildCuratedGroup(workerDown, dataDir);
    expect(group.checks).toHaveLength(1);
    expect(group.checks[0].status).toBe('skip');
    expect(summarizeReport([group]).ok).toBe(true);
  });
});
