import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCuratedImportCommand } from '../../src/npx-cli/commands/curated.js';

// The CLI and the worker run the SAME import over the SAME configured source
// set. When they disagree about which project a source belongs to, the corpus
// lands under two names depending on who ran it — and both runs report success,
// so the only symptom is that half of every project-filtered read is empty.
//
// Measured before this was fixed: two sources that each name their own project
// were both filed under the working directory's name.

let dataDir: string;
let alpha: string;
let beta: string;
let lines: string[];
let restore: (() => void) | null = null;

function captureStdout(): void {
  const original = console.log;
  lines = [];
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  restore = () => { console.log = original; };
}

function record(dir: string, id: string, title: string): void {
  writeFileSync(join(dir, `${id}-${title.toLowerCase().replace(/[^a-z]+/g, '-')}.md`), `# ${id} — ${title}

**Stand:** gilt · **Datum:** 26.08.2026

Der Text dieses Datensatzes spielt hier keine Rolle.
`, 'utf8');
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'keepmind-cli-group-data-'));
  alpha = mkdtempSync(join(tmpdir(), 'keepmind-cli-group-alpha-'));
  beta = mkdtempSync(join(tmpdir(), 'keepmind-cli-group-beta-'));
  record(alpha, '0001', 'Erste Regel');
  record(beta, '0001', 'Regel im anderen Projekt');
  process.env.KEEPMIND_CURATED_SOURCES = JSON.stringify([
    { path: alpha.replace(/\\/g, '/'), kind: 'akten', project: 'alpha-projekt' },
    { path: beta.replace(/\\/g, '/'), kind: 'akten', project: 'beta-projekt' },
  ]);
});

afterEach(() => {
  restore?.();
  restore = null;
  delete process.env.KEEPMIND_CURATED_SOURCES;
  process.exitCode = 0;
  for (const dir of [dataDir, alpha, beta]) rmSync(dir, { recursive: true, force: true });
});

describe('curated:import project grouping', () => {
  it('runs once per project when the entries name their own', async () => {
    captureStdout();
    await runCuratedImportCommand({ directories: [], dryRun: true, json: true });
    restore?.();

    const payload = JSON.parse(lines.join('\n'));
    expect(Array.isArray(payload.runs)).toBe(true);
    expect(payload.runs.map((run: { project: string }) => run.project).sort())
      .toEqual(['alpha-projekt', 'beta-projekt']);
    // Each run sees only its own source — not the whole set twice over.
    for (const run of payload.runs) expect(run.sources).toHaveLength(1);
  });

  // `--project` is the fallback for entries that declare nothing, never an
  // override: filing a declared corpus elsewhere is not undone by re-running.
  it('does not let --project take a source away from the project it declares', async () => {
    captureStdout();
    await runCuratedImportCommand({ directories: [], dryRun: true, json: true, project: 'ganz-woanders' });
    restore?.();

    const payload = JSON.parse(lines.join('\n'));
    expect(payload.runs.map((run: { project: string }) => run.project).sort())
      .toEqual(['alpha-projekt', 'beta-projekt']);
  });

  it('still files an entry that names no project under the fallback', async () => {
    process.env.KEEPMIND_CURATED_SOURCES = JSON.stringify([
      { path: alpha.replace(/\\/g, '/'), kind: 'akten', project: 'alpha-projekt' },
      { path: beta.replace(/\\/g, '/'), kind: 'akten' },
    ]);

    captureStdout();
    await runCuratedImportCommand({ directories: [], dryRun: true, json: true, project: 'die-rueckfallebene' });
    restore?.();

    const payload = JSON.parse(lines.join('\n'));
    expect(payload.runs.map((run: { project: string }) => run.project).sort())
      .toEqual(['alpha-projekt', 'die-rueckfallebene']);
  });
});

// `curated:verify` answers "did the corpus arrive complete". Comparing a
// directory against a project it was never imported into reports every record
// of it as MISSING — a false alarm that reads exactly like the real one this
// command exists to raise, and the corpus is mid-hand-over when it fires.
describe('curated:verify project grouping', () => {
  it('compares each source against the project it declares', async () => {
    const { SessionStore } = await import('../../src/services/sqlite/SessionStore.js');
    const { runCuratedImport } = await import('../../src/services/curated/import-run.js');
    const { runCuratedVerifyCommand } = await import('../../src/npx-cli/commands/curated.js');

    // Populate the default store the command will open, the way an import does.
    const store = new SessionStore();
    for (const [dir, project] of [[alpha, 'alpha-projekt'], [beta, 'beta-projekt']] as const) {
      await runCuratedImport(store as never, [{ path: dir, kind: 'akten' }], {
        project, dryRun: false, nowEpoch: Date.now(),
      });
    }
    store.close();

    captureStdout();
    await runCuratedVerifyCommand({ directories: [], dryRun: false, json: true });
    restore?.();

    const payload = JSON.parse(lines.join('\n'));
    const reports = payload.reports as Array<{ project: string; missingRecords: string[] }>;
    expect(reports.map(r => r.project).sort()).toEqual(['alpha-projekt', 'beta-projekt']);
    // The point: neither project reports the other's record as lost.
    for (const report of reports) expect(report.missingRecords).toEqual([]);
  });
});

describe('curated:import --project note', () => {
  // A caller reading --json is exactly the one who cannot see a note printed
  // for a human.
  it('says in the JSON which entries kept their own project', async () => {
    captureStdout();
    await runCuratedImportCommand({ directories: [], dryRun: true, json: true, project: 'ganz-woanders' });
    restore?.();

    const payload = JSON.parse(lines.join('\n'));
    expect(payload.keptOwnProject).toHaveLength(2);
    expect(payload.keptOwnProject.map((k: { keptProject: string }) => k.keptProject).sort())
      .toEqual(['alpha-projekt', 'beta-projekt']);
  });

  it('says nothing when --project was not given', async () => {
    captureStdout();
    await runCuratedImportCommand({ directories: [], dryRun: true, json: true });
    restore?.();

    expect(JSON.parse(lines.join('\n')).keptOwnProject).toBeUndefined();
  });
});
