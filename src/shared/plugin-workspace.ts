// Materialise the directory that `bun install` runs in.
//
// The dependency tree lives in the plugin data directory (see
// plugin-node-modules.ts), but a package manager needs more than a destination:
// it needs the manifest, the lockfile, and anything those reference by path.
// This module copies that set out of a plugin root and into the install root, so
// every install path — the npx installer, the spawn-time repair, the vector
// self-repair, the Setup hook — works from identical inputs.
//
// Local `file:` dependencies are the subtle part. plugin/package.json overrides
// onnxruntime-web to `file:./stubs/onnxruntime-web` (128 MB of dead weight the
// node backend never loads), and plugin/bun.lock pins that spec. Bun resolves it
// relative to the install directory, so `bun install --frozen-lockfile` fails
// unless the stub directory is there too. Rather than hardcode `stubs`, every
// `file:` spec in the manifest is discovered and copied — the same rule the
// tarball test in tests/infrastructure/plugin-distribution.test.ts enforces, so
// the two cannot drift.

import { existsSync, mkdirSync, cpSync, readFileSync } from 'node:fs';
import { join, sep, isAbsolute } from 'node:path';
import { depsInstallRoot } from './plugin-node-modules.js';
import { acquireFileLock, releaseFileLock } from './file-lock.js';

/**
 * A dependency install now has ONE destination shared by every path that can
 * start one: `npx keepmind install`, `npx keepmind repair`, the spawn-time
 * repair, the worker's vector self-repair, and the Setup hook. Previously they
 * wrote to different directories (a version cache, the marketplace copy) and
 * could not corrupt each other; now two concurrent `bun install` runs in the
 * same tree can. The spawn lock does not cover this — it serialises worker
 * spawns, not installs, and the installer and the Setup hook never take it.
 *
 * 6 minutes: longer than the installer's own install timeout, so a live holder
 * is never mistaken for a dead one.
 */
const DEPS_INSTALL_LOCK_STALE_MS = 6 * 60_000;

function depsInstallLockPath(root: string): string {
  return join(root, '.deps-install.lock');
}

/**
 * Run `install` as the only dependency install on this machine.
 *
 * Returns null when another process holds the lock — callers on the hot path
 * (the spawn repair, the vector repair) must treat that as "not now" and let
 * the winner finish, NOT as a failure: retrying is what the next hook is for.
 * Fails open when the filesystem refuses locking, so a lock that cannot be
 * taken degrades to the previous unlocked behaviour.
 */
export function withDepsInstallLock<T>(root: string, install: () => T): T | null {
  const release = tryAcquireDepsInstallLock(root);
  if (!release) return null;
  try {
    return install();
  } finally {
    release();
  }
}

/**
 * Take the install lock without waiting. Returns its release function, or null
 * when another process holds it.
 *
 * For callers whose install is asynchronous and must hold the lock across a
 * callback (the worker's vector self-repair), where withDepsInstallLock's
 * synchronous scope would release too early.
 */
export function tryAcquireDepsInstallLock(root: string): (() => void) | null {
  const lockPath = depsInstallLockPath(root);
  mkdirSync(root, { recursive: true });
  if (!acquireFileLock(lockPath, DEPS_INSTALL_LOCK_STALE_MS)) return null;
  return () => releaseFileLock(lockPath);
}

/**
 * Wait for the install lock, then return its release function.
 *
 * For the user-invoked installer, which must not silently do nothing because a
 * background repair happened to hold the lock. Polls rather than skipping; the
 * staleness breaker in acquireFileLock bounds the wait even if a holder dies.
 */
export async function awaitDepsInstallLock(root: string): Promise<() => void> {
  const lockPath = depsInstallLockPath(root);
  mkdirSync(root, { recursive: true });
  while (!acquireFileLock(lockPath, DEPS_INSTALL_LOCK_STALE_MS)) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  return () => releaseFileLock(lockPath);
}

/** Manifest + lockfile. Both required: without either, --frozen-lockfile fails. */
export const REQUIRED_WORKSPACE_FILES = ['package.json', 'bun.lock'] as const;

interface ManifestSpecs {
  dependencies?: Record<string, string>;
  overrides?: Record<string, string>;
}

/**
 * Directories referenced by a `file:` spec in the manifest, relative to it.
 * Exported for the install-time verification and for tests.
 */
export function localFileDependencies(manifestPath: string): string[] {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as ManifestSpecs;
  const specs = Object.values({ ...(manifest.dependencies ?? {}), ...(manifest.overrides ?? {}) });

  const directories: string[] = [];
  for (const spec of specs) {
    if (typeof spec !== 'string' || !spec.startsWith('file:')) continue;
    const relative = spec.slice('file:'.length).replace(/^\.\//, '');
    // An absolute file: spec needs no copying — it already points somewhere
    // stable. Only repo-relative ones travel with the workspace.
    if (isAbsolute(relative)) continue;
    // Copy the top segment: `stubs/onnxruntime-web` and a sibling stub under the
    // same parent must not each copy over the other.
    const top = relative.split(/[\\/]/)[0];
    if (top && top !== '.' && top !== '..' && !directories.includes(top)) directories.push(top);
  }
  return directories;
}

/**
 * Copy manifest, lockfile and any local `file:` dependency from `sourcePluginRoot`
 * into the install root, creating it if needed. Returns the install root.
 *
 * Idempotent: it overwrites unconditionally. The inputs are five small files, and
 * an unconditional copy is what makes a plugin update reach the workspace at all
 * — whether the dependency set actually changed is decided afterwards by the
 * fingerprint marker in setup-runtime.ts, which is the thing that can tell.
 */
export function ensureDepsWorkspace(sourcePluginRoot: string, targetRoot?: string): string {
  const target = targetRoot ?? depsInstallRoot();

  for (const file of REQUIRED_WORKSPACE_FILES) {
    if (!existsSync(join(sourcePluginRoot, file))) {
      throw new Error(
        `ensureDepsWorkspace: ${sourcePluginRoot} has no ${file} — the plugin install is incomplete.`,
      );
    }
  }

  mkdirSync(target, { recursive: true });

  for (const file of REQUIRED_WORKSPACE_FILES) {
    cpSync(join(sourcePluginRoot, file), join(target, file));
  }

  for (const directory of localFileDependencies(join(sourcePluginRoot, 'package.json'))) {
    const source = join(sourcePluginRoot, directory);
    if (!existsSync(source)) {
      // Loud, not silent: this is exactly the failure that shipped for one
      // release — bun.lock pinning a file: path the package never contained.
      throw new Error(
        `ensureDepsWorkspace: ${sourcePluginRoot} declares a local file: dependency at ` +
          `${directory}${sep} but the directory is missing — the plugin package is incomplete.`,
      );
    }
    cpSync(source, join(target, directory), { recursive: true });
  }

  return target;
}

/** True when the workspace has everything `bun install --frozen-lockfile` needs. */
export function depsWorkspaceReady(root: string): boolean {
  if (!REQUIRED_WORKSPACE_FILES.every((file) => existsSync(join(root, file)))) return false;
  try {
    return localFileDependencies(join(root, 'package.json')).every((dir) => existsSync(join(root, dir)));
  } catch {
    return false;
  }
}
