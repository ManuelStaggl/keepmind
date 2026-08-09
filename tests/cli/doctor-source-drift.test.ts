import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { checkSourceTreeDrift } from '../../src/npx-cli/utils/source-tree-drift.js';

/**
 * The marketplace directory is a git clone of the repository, refreshed by the
 * host's plugin manager. The runtime that executes is the bundle, replaced by
 * `npx keepmind install` from the npm package — which ships no `src/`.
 *
 * They move independently, so the clone can sit a release behind while
 * everything runs correctly. That cost a real investigation on the first day
 * 3.4.1 was in the field: an audit of the installed tree read `src/`, found the
 * 3.4.0 code path, and reported a shipped fix as missing. The bundle had it.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keepmind-drift-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function withSources(version?: string): void {
  mkdirSync(join(dir, 'src'), { recursive: true });
  if (version !== undefined) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }), 'utf-8');
  }
}

describe('doctor: source tree drift', () => {
  it('says nothing when no source tree is installed', () => {
    const r = checkSourceTreeDrift(dir, '3.4.2');
    expect(r.status).toBe('skip');
  });

  it('warns when the clone is behind the running bundle', () => {
    withSources('3.4.0');
    const r = checkSourceTreeDrift(dir, '3.4.2');
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('3.4.0');
    expect(r.detail).toContain('3.4.2');
    // The point of the check is telling the reader which tree to trust.
    expect(r.detail).toContain('Audit the bundle');
  });

  it('accepts a leading v on the reported bundle version', () => {
    withSources('3.4.2');
    expect(checkSourceTreeDrift(dir, 'v3.4.2').status).toBe('ok');
  });

  it('does not claim drift when the worker is down and no version is known', () => {
    withSources('3.4.0');
    const r = checkSourceTreeDrift(dir, undefined);
    expect(r.status).toBe('ok');
  });

  it('does not claim drift when the clone has no readable manifest', () => {
    withSources(undefined);
    const r = checkSourceTreeDrift(dir, '3.4.2');
    expect(r.status).toBe('ok');
  });

  it('never fails the run — a stale clone is confusing, not broken', () => {
    withSources('3.4.0');
    expect(checkSourceTreeDrift(dir, '3.4.2').required).toBe(false);
  });
});
