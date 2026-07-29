// SPDX-License-Identifier: Apache-2.0
//
// Sweep stale keepmind versions out of the host's plugin cache.
//
// Claude Code keeps each installed plugin version in its own directory under
// ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/, and its own in_use
// sweep does not reliably reclaim ours.
//
// Installs no longer put a dependency closure in there — there is one tree, in
// the plugin data directory (src/shared/plugin-node-modules.ts) — so new version
// directories hold only bundles and are cheap. The sweep still matters for two
// reasons: those directories still accumulate one per version, and machines
// upgraded from an older keepmind still carry the old ~900 MB-per-version
// closures (three versions measured on one machine: 2.69 GB, of which 1.79 GB
// was two versions not installed for weeks). Those are reclaimed here.
//
// This is deliberately conservative. It keeps the newest RETAINED_VERSIONS
// version directories, plus unconditionally whatever directory the running
// process lives in and whatever version the marketplace currently reports —
// deleting the code you are executing is not a tradeoff worth any disk space.
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { logger } from '../utils/logger.js';

/** Newest N version directories to keep. One predecessor allows a rollback. */
const RETAINED_VERSIONS = 2;

/**
 * Resolved per call, NOT captured at import time. paths.ts freezes
 * CLAUDE_CONFIG_DIR into a module constant, which makes anything built on it
 * untestable without pointing the test at the real ~/.claude — and a sweep whose
 * root cannot be redirected is a sweep that deletes real directories from a test
 * run. Resolving here keeps the config dir overridable by the caller.
 */
function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
}

export function pluginCacheRoot(): string {
  return path.join(claudeConfigDir(), 'plugins', 'cache', 'keepmind', 'keepmind');
}

function marketplaceRoot(): string {
  return path.join(claudeConfigDir(), 'plugins', 'marketplaces', 'keepmind');
}

export interface SweepResult {
  /** Version directory names removed. */
  removed: string[];
  /** Version directory names deliberately kept. */
  kept: string[];
  /** Set when the sweep did not run at all (nothing to do, or unreadable). */
  skipped?: string;
}

/**
 * Compare two version directory names, newest first. Numeric segment compare so
 * "10.0.0" sorts above "9.0.0" (a plain string sort gets that wrong), with a
 * prerelease suffix sorting BELOW the matching release.
 */
export function compareVersionsDesc(a: string, b: string): number {
  const parse = (raw: string): { nums: number[]; pre: string } => {
    const [core, ...rest] = raw.split('-');
    return {
      nums: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
      pre: rest.join('-'),
    };
  };
  const left = parse(a);
  const right = parse(b);

  const segments = Math.max(left.nums.length, right.nums.length);
  for (let i = 0; i < segments; i += 1) {
    const diff = (right.nums[i] ?? 0) - (left.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // Same numeric core: a release (no prerelease tag) outranks a prerelease.
  if (left.pre === right.pre) return 0;
  if (!left.pre) return -1;
  if (!right.pre) return 1;
  return right.pre.localeCompare(left.pre);
}

/** The version directory the given file path lives in, if any. */
function versionDirOf(filePath: string | undefined): string | null {
  if (!filePath) return null;
  try {
    const relative = path.relative(pluginCacheRoot(), path.resolve(filePath));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }
    const [first] = relative.split(path.sep);
    return first || null;
  } catch {
    return null;
  }
}

/** Version reported by the marketplace install, or null if unreadable. */
function installedVersion(): string | null {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(marketplaceRoot(), 'package.json'), 'utf-8'),
    ) as { version?: string };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    // Not installed via the marketplace, or mid-write. Not a problem: the
    // newest-N rule and the running-directory pin already protect the live code.
    return null;
  }
}

/**
 * Remove stale version directories from the plugin cache. Never throws: a
 * failure to reclaim disk space must not break an install or a worker boot.
 */
export function sweepPluginCache(options: { dryRun?: boolean } = {}): SweepResult {
  if (!existsSync(pluginCacheRoot())) {
    return { removed: [], kept: [], skipped: 'cache root does not exist' };
  }

  let versions: string[];
  try {
    versions = readdirSync(pluginCacheRoot()).filter((name) => {
      if (!/^\d/.test(name)) return false;
      try {
        return statSync(path.join(pluginCacheRoot(), name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch (error: unknown) {
    logger.debug('SYSTEM', 'Plugin cache sweep could not read the cache root', {
      root: pluginCacheRoot(),
      error: error instanceof Error ? error.message : String(error),
    });
    return { removed: [], kept: [], skipped: 'cache root unreadable' };
  }

  if (versions.length <= RETAINED_VERSIONS) {
    return { removed: [], kept: versions, skipped: 'nothing to reclaim' };
  }

  const sorted = [...versions].sort(compareVersionsDesc);
  const keep = new Set(sorted.slice(0, RETAINED_VERSIONS));

  // Pin the directory we are running from. process.argv[1] is the bundle the
  // host launched (worker-service.cjs / hook-client.cjs live inside a version
  // dir); CLAUDE_PLUGIN_ROOT is the host-injected root when present.
  for (const candidate of [process.env.CLAUDE_PLUGIN_ROOT, process.env.PLUGIN_ROOT, process.argv[1]]) {
    const own = versionDirOf(candidate);
    if (own) keep.add(own);
  }

  // Pin whatever the marketplace currently reports as installed, even if a
  // version-string oddity would have sorted it out of the top N.
  const installed = installedVersion();
  if (installed && versions.includes(installed)) keep.add(installed);

  const doomed = sorted.filter((version) => !keep.has(version));
  if (doomed.length === 0) {
    return { removed: [], kept: [...keep], skipped: 'nothing to reclaim' };
  }

  const removed: string[] = [];
  for (const version of doomed) {
    const target = path.join(pluginCacheRoot(), version);
    if (options.dryRun) {
      removed.push(version);
      continue;
    }
    try {
      rmSync(target, { recursive: true, force: true });
      removed.push(version);
    } catch (error: unknown) {
      // A locked file (worker still running out of an old dir, AV scan) is not
      // an error worth surfacing — the next sweep will get it.
      logger.debug('SYSTEM', 'Plugin cache sweep could not remove a stale version', {
        version,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (removed.length > 0) {
    logger.info('SYSTEM', 'Reclaimed stale keepmind versions from the plugin cache', {
      removed,
      kept: [...keep],
      dryRun: options.dryRun === true,
    });
  }

  return { removed, kept: [...keep] };
}
