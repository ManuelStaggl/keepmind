import { homedir } from 'os'
import path from 'path';
import { execFileSync } from 'child_process';
import { logger } from './logger.js';
import { detectWorktree } from './worktree.js';

function expandTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return p.replace(/^~/, homedir())
  }
  return p
}

/**
 * Resolve the git repository ROOT for a directory, so a project's name is
 * stable across its subdirectories and worktrees (#2663). Returns the absolute
 * repo-root path, or null when `dir` is not inside a git repo (or git is
 * unavailable). `--show-toplevel` resolves to the working-tree root even when
 * invoked from a worktree or a nested subdirectory.
 */
// Resolving the repo root costs a `git` PROCESS SPAWN — ~25 ms on Windows,
// measured — and getProjectContext() runs on every observation the worker
// ingests plus every hook that needs a project key. That single spawn dominated
// the per-observation cost.
//
// Positive and negative results are cached differently because they age
// differently: a directory's repo root is effectively immutable for the life of
// a process, while "not a repo" becomes wrong the moment someone runs `git init`
// — so negatives expire and positives do not.
const repoRootCache = new Map<string, string>();
const notARepoCache = new Map<string, number>();
const NOT_A_REPO_TTL_MS = 60_000;
const REPO_CACHE_MAX = 256;

/** Test hook: drop the repo-root caches. */
export function resetProjectNameCacheForTesting(): void {
  repoRootCache.clear();
  notARepoCache.clear();
}

function cachedGitRepoRoot(dir: string, now: number = Date.now()): string | null {
  const hit = repoRootCache.get(dir);
  if (hit !== undefined) return hit;

  const missAt = notARepoCache.get(dir);
  if (missAt !== undefined && now - missAt < NOT_A_REPO_TTL_MS) return null;

  const root = findGitRepoRoot(dir);
  if (root) {
    // Map insertion order is iteration order, so the first key is the oldest.
    if (repoRootCache.size >= REPO_CACHE_MAX) {
      const oldest = repoRootCache.keys().next();
      if (!oldest.done) repoRootCache.delete(oldest.value);
    }
    repoRootCache.set(dir, root);
    notARepoCache.delete(dir);
  } else {
    if (notARepoCache.size >= REPO_CACHE_MAX) {
      const oldest = notARepoCache.keys().next();
      if (!oldest.done) notARepoCache.delete(oldest.value);
    }
    notARepoCache.set(dir, now);
  }
  return root;
}

function findGitRepoRoot(dir: string): string | null {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // windowsHide: this runs on EVERY hook (project-key resolution); without it
      // Windows flashes a console window per invocation (the "terminal flashing"
      // users report). Every spawn on a hot path must set it.
      windowsHide: true,
    }).trim();
    return root || null;
  } catch {
    // Not a git repo, git not installed, or dir does not exist — fall back to basename.
    return null;
  }
}

export function getProjectName(cwd: string | null | undefined): string {
  if (!cwd || cwd.trim() === '') {
    logger.warn('PROJECT_NAME', 'Empty cwd provided, using fallback', { cwd });
    return 'unknown-project';
  }

  const expanded = expandTilde(cwd)

  // #2663 — derive the project name from the git repo root when inside a repo so
  // the name is stable across subdirectories/worktrees. Fall back to the cwd
  // basename when not in a repo.
  const repoRoot = cachedGitRepoRoot(expanded);
  const nameSource = repoRoot ?? expanded;

  const basename = path.basename(nameSource);

  if (basename === '') {
    const isWindows = process.platform === 'win32';
    if (isWindows) {
      const driveMatch = cwd.match(/^([A-Z]):\\/i);
      if (driveMatch) {
        const driveLetter = driveMatch[1].toUpperCase();
        const projectName = `drive-${driveLetter}`;
        logger.info('PROJECT_NAME', 'Drive root detected', { cwd, projectName });
        return projectName;
      }
    }
    logger.warn('PROJECT_NAME', 'Root directory detected, using fallback', { cwd });
    return 'unknown-project';
  }

  return basename;
}

export interface ProjectContext {
  primary: string;
  parent: string | null;
  isWorktree: boolean;
  allProjects: string[];
}

export function getProjectContext(cwd: string | null | undefined): ProjectContext {
  const cwdProjectName = getProjectName(cwd);

  if (!cwd) {
    return { primary: cwdProjectName, parent: null, isWorktree: false, allProjects: [cwdProjectName] };
  }

  const expandedCwd = expandTilde(cwd);
  const worktreeInfo = detectWorktree(expandedCwd);

  if (worktreeInfo.isWorktree && worktreeInfo.parentProjectName) {
    const composite = `${worktreeInfo.parentProjectName}/${cwdProjectName}`;
    return {
      primary: composite,
      parent: worktreeInfo.parentProjectName,
      isWorktree: true,
      allProjects: [worktreeInfo.parentProjectName, composite]
    };
  }

  return { primary: cwdProjectName, parent: null, isWorktree: false, allProjects: [cwdProjectName] };
}
