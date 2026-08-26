import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// node ESM has no __dirname (bun provides it); node 20.11+ exposes import.meta.dirname.
const __dirname = import.meta.dirname;
const REPO_ROOT = path.join(__dirname, '../..');
const SOURCE_ENTRY = path.join(REPO_ROOT, 'src/services/worker-service.ts');

/**
 * "Was this module RUN, or merely imported?"
 *
 * Measured: `npx tsx src/services/worker-service.ts --daemon` loaded the
 * module, ran NOTHING and exited 0 — no daemon, no command, one WARN line from
 * module init and nothing after it even at DEBUG. A worker that was asked to
 * start, did not, and said so nowhere. The node-ESM branch of the entry guard
 * could not match a Windows source-tree path by any of its four routes.
 *
 * `status` is the cheapest command that PROVES the guard let the command run:
 * it reaches no worker, writes nothing, and answers in one line. Silence is
 * the bug; the wording is not what is asserted.
 */
let dataDir: string | null = null;

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = null;
});

describe('worker-service source entry point', () => {
  it('runs its command instead of exiting silently', () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'keepmind-entry-'));

    // NODE explicitly, never `process.execPath`: under `bun test` that is bun,
    // which takes the CJS branch of the guard and cannot see this failure at
    // all — the test would then pass while measuring the wrong runtime.
    const result = spawnSync('node', ['--import', 'tsx', SOURCE_ENTRY, 'status'], {
      encoding: 'utf-8',
      timeout: 120_000,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        KEEPMIND_DATA_DIR: dataDir,
        // A port nothing on a developer machine binds, so "not running" is the
        // honest answer rather than a stray hit on a real worker.
        KEEPMIND_WORKER_PORT: '37991',
      },
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    // Not "some output" — that would pass on a stray warning from the runner,
    // which is the same shape of test that cannot fail. It must be an ANSWER
    // about the worker.
    expect(output).toMatch(/worker is (not )?running/i);
  });
});
