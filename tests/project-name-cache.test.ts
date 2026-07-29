import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  getProjectName,
  getProjectContext,
  resetProjectNameCacheForTesting,
} from '../src/utils/project-name.js';

// getProjectName resolves the repo root with `git rev-parse --show-toplevel`,
// a process spawn measured at ~25 ms on Windows — and getProjectContext runs on
// every observation the worker ingests. These tests pin both the caching and,
// more importantly, that caching did not change the answers.

describe('project name repo-root cache', () => {
  let root: string;

  beforeEach(() => {
    resetProjectNameCacheForTesting();
    root = mkdtempSync(join(tmpdir(), 'keepmind-projname-'));
  });
  afterEach(() => {
    resetProjectNameCacheForTesting();
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function initRepo(dir: string): void {
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
  }

  it('names a non-repo directory after its basename', () => {
    const dir = join(root, 'plain-dir');
    mkdirSync(dir);
    expect(getProjectName(dir)).toBe('plain-dir');
  });

  it('names a repo after its ROOT, from a nested subdirectory', () => {
    const repo = join(root, 'my-repo');
    mkdirSync(repo);
    initRepo(repo);
    const nested = join(repo, 'src', 'deep');
    mkdirSync(nested, { recursive: true });

    expect(getProjectName(nested)).toBe('my-repo');
  });

  it('returns the same answer on a cache hit as on the first call', () => {
    const repo = join(root, 'stable-repo');
    mkdirSync(repo);
    initRepo(repo);

    const first = getProjectName(repo);
    const second = getProjectName(repo);
    const third = getProjectName(repo);

    expect(first).toBe('stable-repo');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('is dramatically faster once cached', () => {
    const repo = join(root, 'perf-repo');
    mkdirSync(repo);
    initRepo(repo);

    getProjectName(repo); // prime

    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) getProjectName(repo);
    const perCallMs = Number(process.hrtime.bigint() - t0) / 200 / 1e6;

    // A git spawn is ~20-25ms on Windows, ~5ms on Linux. Anything under 1ms
    // proves no process is being spawned per call.
    expect(perCallMs).toBeLessThan(1);
  });

  it('re-checks a directory that was not a repo, so `git init` is picked up', () => {
    const dir = join(root, 'later-a-repo');
    mkdirSync(dir);

    expect(getProjectName(dir)).toBe('later-a-repo');

    initRepo(dir);
    // Negative results expire; clearing the cache models the TTL elapsing.
    resetProjectNameCacheForTesting();

    expect(getProjectName(dir)).toBe('later-a-repo');
  });

  it('keeps separate answers for separate directories', () => {
    const a = join(root, 'repo-a');
    const b = join(root, 'repo-b');
    mkdirSync(a); mkdirSync(b);
    initRepo(a); initRepo(b);

    expect(getProjectName(a)).toBe('repo-a');
    expect(getProjectName(b)).toBe('repo-b');
    // Re-read in the opposite order to catch a single-slot cache.
    expect(getProjectName(b)).toBe('repo-b');
    expect(getProjectName(a)).toBe('repo-a');
  });

  it('still reports a plain repo as not a worktree', () => {
    const repo = join(root, 'plain-repo');
    mkdirSync(repo);
    initRepo(repo);

    const ctx = getProjectContext(repo);
    expect(ctx.isWorktree).toBe(false);
    expect(ctx.primary).toBe('plain-repo');
    expect(ctx.allProjects).toEqual(['plain-repo']);
  });

  it('handles an empty cwd without consulting git', () => {
    expect(getProjectName('')).toBe('unknown-project');
    expect(getProjectName(null)).toBe('unknown-project');
    expect(getProjectName(undefined)).toBe('unknown-project');
  });

  it('handles a nonexistent directory as a non-repo', () => {
    const missing = join(root, 'does-not-exist');
    expect(getProjectName(missing)).toBe('does-not-exist');
  });
});
