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
