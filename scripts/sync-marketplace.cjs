#!/usr/bin/env node

const { execSync } = require('child_process');
const { existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync, rmSync, statSync } = require('fs');
const path = require('path');
const os = require('os');

const INSTALLED_PATH = path.join(os.homedir(), '.claude', 'plugins', 'marketplaces', 'keepmind');
const CACHE_BASE_PATH = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'keepmind', 'keepmind');

// Directories that must NEVER be copied into or deleted from a destination,
// regardless of exclude patterns — deleting these would destroy the installed
// git checkout or the native dependencies (sqlite-vec vec0.dll, onnxruntime).
const HARD_PROTECTED_DIRS = new Set(['.git', 'node_modules']);

function getCurrentBranch() {
  try {
    if (!existsSync(path.join(INSTALLED_PATH, '.git'))) {
      return null;
    }
    return execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: INSTALLED_PATH,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Raw exclude patterns (hardcoded + .gitignore), used to drive the mirror.
 * Replaces the previous rsync `--exclude=` string list so this works on
 * Windows (node-only fork — rsync is not available).
 */
function getExcludePatterns(basePath, extra = []) {
  const patterns = [...extra];
  const gitignorePath = path.join(basePath, '.gitignore');
  if (existsSync(gitignorePath)) {
    for (const raw of readFileSync(gitignorePath, 'utf-8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('!')) continue;
      patterns.push(line);
    }
  }
  return patterns;
}

/** Compile an exclude pattern into a matcher over a posix relative path. */
function makeMatcher(pattern) {
  let p = pattern.trim();
  if ((p.startsWith('"') && p.endsWith('"')) || (p.startsWith("'") && p.endsWith("'"))) {
    p = p.slice(1, -1);
  }
  p = p.replace(/\/+$/, ''); // trailing slash → treat as dir/prefix match
  if (!p) return () => false;

  const globToRe = (s) => new RegExp('^' + s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

  if (p.startsWith('**/')) {
    const base = p.slice(3);
    const re = globToRe(base);
    return (rel, name) => re.test(name);
  }
  if (!p.includes('/')) {
    // bare name or *.ext → match any path segment's basename
    const re = globToRe(p);
    return (rel, name) => re.test(name);
  }
  // path pattern → exact or prefix (directory) match on the relative path
  return (rel) => rel === p || rel.startsWith(p + '/');
}

/**
 * Cross-platform mirror of src → dst honoring exclude patterns, with rsync
 * `--delete` semantics: files present in dst but absent (or excluded) in src
 * are removed. Hard-protected dirs are never copied or deleted.
 */
function mirror(srcRoot, dstRoot, patterns) {
  const matchers = patterns.map(makeMatcher);
  const isExcluded = (rel, name) => matchers.some((m) => m(rel, name));

  const copyDir = (relDir) => {
    const srcDir = relDir ? path.join(srcRoot, relDir) : srcRoot;
    const dstDir = relDir ? path.join(dstRoot, relDir) : dstRoot;
    mkdirSync(dstDir, { recursive: true });

    const srcEntries = readdirSync(srcDir, { withFileTypes: true });
    const keep = new Set();

    for (const entry of srcEntries) {
      const name = entry.name;
      const rel = relDir ? `${relDir}/${name}` : name;
      if (HARD_PROTECTED_DIRS.has(name) || isExcluded(rel, name)) continue;
      keep.add(name);
      if (entry.isDirectory()) {
        copyDir(rel);
      } else if (entry.isFile()) {
        copyFileSync(path.join(srcRoot, rel), path.join(dstRoot, rel));
      }
    }

    // --delete: prune dst entries not kept (never touch protected dirs).
    if (existsSync(dstDir)) {
      for (const entry of readdirSync(dstDir, { withFileTypes: true })) {
        const name = entry.name;
        if (keep.has(name) || HARD_PROTECTED_DIRS.has(name)) continue;
        const rel = relDir ? `${relDir}/${name}` : name;
        // Preserve dst-only excluded paths (e.g. installed .mcp.json, .env) —
        // exactly what rsync --delete with --exclude does.
        if (isExcluded(rel, name)) continue;
        rmSync(path.join(dstDir, name), { recursive: true, force: true });
      }
    }
  };

  copyDir('');
}

const branch = getCurrentBranch();
const isForce = process.argv.includes('--force');

if (branch && branch !== 'main' && !isForce) {
  console.log('');
  console.log('\x1b[33m%s\x1b[0m', `WARNING: Installed plugin is on beta branch: ${branch}`);
  console.log('\x1b[33m%s\x1b[0m', 'Running sync would overwrite beta code.');
  console.log('');
  console.log('Options:');
  console.log('  1. Switch to stable first, then run sync');
  console.log('  2. Force sync: npm run sync-marketplace:force');
  console.log('');
  process.exit(1);
}

function getPluginVersion() {
  try {
    const pluginJsonPath = path.join(__dirname, '..', 'plugin', '.claude-plugin', 'plugin.json');
    const pluginJson = JSON.parse(readFileSync(pluginJsonPath, 'utf-8'));
    return pluginJson.version;
  } catch (error) {
    console.error('\x1b[31m%s\x1b[0m', 'Failed to read plugin version:', error.message);
    process.exit(1);
  }
}

console.log('Syncing to marketplace...');
try {
  const rootDir = path.join(__dirname, '..');

  // Repo → marketplace (full mirror). Hardcoded excludes mirror the previous
  // rsync invocation; the rest come from .gitignore.
  const rootPatterns = getExcludePatterns(rootDir, [
    '.git', 'bun.lock', 'package-lock.json', 'scripts/package.json', 'scripts/node_modules',
  ]);
  mirror(rootDir, INSTALLED_PATH, rootPatterns);

  // NOTE: no `bun install` in the marketplace ROOT. It used to run here and
  // grew to 1.4 GB (735 packages — devDependencies included, since the root
  // manifest is the repo's own). Nothing loads from it: the running worker's
  // native modules (sqlite-vec, onnxruntime, sharp) all resolve out of
  // marketplace/plugin/node_modules, verified against the live process module
  // list. Removed alongside the same dead step in install.ts.
  //
  // The plugin tree below is the one that matters, and NOTHING used to refresh
  // it: the old root install targeted the wrong directory, and node_modules is
  // a hard-protected dir the mirror never touches. So
  // marketplace/plugin/package.json was kept current while the tree beside it
  // aged indefinitely — a dev sync could leave the worker running against
  // months-old dependencies, silently, with no signal that the two disagreed.
  const marketplacePluginDir = path.join(INSTALLED_PATH, 'plugin');
  if (existsSync(path.join(marketplacePluginDir, 'package.json'))) {
    console.log('Running bun install in marketplace plugin...');
    execSync('bun install', { cwd: marketplacePluginDir, stdio: 'inherit' });
  }

  const version = getPluginVersion();
  const CACHE_VERSION_PATH = path.join(CACHE_BASE_PATH, version);

  const pluginDir = path.join(rootDir, 'plugin');
  // Preserve Claude Code's plugin-manager bookkeeping in the cache folder —
  // these are created in the installed cache, not in the plugin source, and
  // deleting them would confuse plugin resolution / version tracking.
  const pluginPatterns = getExcludePatterns(pluginDir, [
    '.git', '.install-version', '.in_use', '.cli-installed', '.mcp.json',
  ]);

  console.log(`Syncing to cache folder (version ${version})...`);
  mirror(pluginDir, CACHE_VERSION_PATH, pluginPatterns);

  console.log(`Running bun install in cache folder (version ${version})...`);
  execSync('bun install', { cwd: CACHE_VERSION_PATH, stdio: 'inherit' });

  console.log('\x1b[32m%s\x1b[0m', 'Sync complete!');
} catch (error) {
  console.error('\x1b[31m%s\x1b[0m', 'Sync failed:', error.message);
  process.exit(1);
}
