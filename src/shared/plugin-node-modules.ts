// Where the plugin's runtime dependencies live, and how the bundles resolve them.
//
// The worker and MCP bundles are self-contained except for the packages that
// CANNOT be inlined: sqlite-vec and onnxruntime-node ship per-platform binaries,
// the tree-sitter grammars ship .node bindings. Those resolve from a real
// node_modules tree at runtime.
//
// That tree used to live next to the bundle, at <pluginRoot>/node_modules. The
// plugin root is host territory: Claude Code tracks it as a git checkout of the
// marketplace and restores it from the remote, which deletes every gitignored
// path — node_modules included. Observed 2026-07-29: 804 MB of freshly installed
// dependencies wiped ~60s after `npx keepmind install`. The docs are explicit
// that this is by design:
//
//   "${CLAUDE_PLUGIN_ROOT} changes when the plugin updates. [...] treat it as
//    ephemeral and don't write state there."
//
//   "The ${CLAUDE_PLUGIN_DATA} directory resolves to ~/.claude/plugins/data/{id}/"
//
// So the tree moves to the plugin data directory, which survives updates, and
// this module is the ONE place that knows how to find it. Resolution is a chain
// rather than a single path because the installer, the worker and the hooks see
// different environments, and because an existing install must keep working
// until its next `npx keepmind install` (see depsRootCandidates).
//
// Deliberately dependency-free: it is bundled into both worker-service.cjs and
// mcp-server.cjs, and importing paths.ts would drag in that module's import-time
// side effects (data-dir resolution, the legacy DB rename) for nothing.

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

/**
 * Plugin data directory identifier. Per the plugins reference the directory is
 * `~/.claude/plugins/data/{id}/`, where `{id}` is the plugin identifier with
 * every character outside [a-zA-Z0-9_-] replaced by `-`. keepmind installs as
 * `keepmind@keepmind` (plugin name @ marketplace name), hence this. Verified on
 * disk: the host had already created the directory before we ever wrote to it.
 */
const PLUGIN_DATA_ID = 'keepmind-keepmind';

/** Directory this module was loaded from, in both the ESM source and the CJS bundles. */
function moduleDir(): string {
  // The esbuild banner defines __filename in the .cjs bundles; the TS source
  // runs as ESM under tsx, where import.meta.url is the anchor.
  if (typeof __filename !== 'undefined') return dirname(__filename);
  return dirname(fileURLToPath(import.meta.url));
}

function claudeConfigDir(): string {
  // Resolved per call, not frozen at import: tests point CLAUDE_CONFIG_DIR at a
  // temp directory, and a frozen constant would make this module untestable.
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

/**
 * Candidate roots, in priority order. A "root" is the directory CONTAINING
 * node_modules, not the tree itself.
 *
 * The order is contractual — it mirrors the shell prelude's chain in
 * src/build/hook-shell-template.ts, and for the same reason: no single entry is
 * reliable on its own.
 *
 *   1. KEEPMIND_NODE_MODULES — escape hatch for tests and air-gapped installs.
 *   2. CLAUDE_PLUGIN_DATA — injected by the host into hook and MCP processes.
 *      NOT present in the detached worker or in `npx keepmind install`, so it
 *      cannot be the only source.
 *   3. The derived data directory — the normal case, and the one the installer
 *      uses. Kept right behind (2) rather than instead of it so a host that
 *      injects a different id still wins where it is visible.
 *   4. Bundle-relative <pluginRoot> — the LEGACY location. Covers both the
 *      marketplace install and the version cache with one rule, and is what
 *      keeps an existing install working before it is reinstalled.
 *   5. The dev tree, for `npm run build-and-sync` and tests run from the repo.
 */
export function depsRootCandidates(): string[] {
  const candidates: string[] = [];
  const add = (dir: string | undefined | null): void => {
    if (dir && !candidates.includes(dir)) candidates.push(dir);
  };

  add(process.env.KEEPMIND_NODE_MODULES);
  add(process.env.CLAUDE_PLUGIN_DATA);
  add(join(claudeConfigDir(), 'plugins', 'data', PLUGIN_DATA_ID));

  // <pluginRoot>/scripts/<bundle>.cjs → <pluginRoot>. argv[1] is the script the
  // runtime was launched with, which for the daemon IS the bundle; the module
  // anchor covers the case where something else launched us (the CLI, a test).
  add(dirname(moduleDir()));
  const entry = process.argv[1];
  if (entry) add(dirname(dirname(entry)));

  add(join(process.cwd(), 'plugin'));
  add(process.cwd());

  return candidates;
}

/**
 * First candidate that actually carries a node_modules tree, or null.
 *
 * Callers that INSTALL (the installer, the repair paths) must not use this —
 * they want the canonical destination even when it is still empty. Use
 * depsInstallRoot() for that.
 */
export function depsRoot(): string | null {
  for (const candidate of depsRootCandidates()) {
    if (existsSync(join(candidate, 'node_modules'))) return candidate;
  }
  return null;
}

/**
 * Where dependencies should be INSTALLED. Always the data directory — never a
 * legacy location, or an install would recreate the very tree the host deletes.
 * Honors the same two env overrides so tests and air-gapped setups stay coherent
 * with what depsRootCandidates() will later find.
 */
export function depsInstallRoot(): string {
  return (
    process.env.KEEPMIND_NODE_MODULES ||
    process.env.CLAUDE_PLUGIN_DATA ||
    join(claudeConfigDir(), 'plugins', 'data', PLUGIN_DATA_ID)
  );
}

type RequireHandle = ReturnType<typeof createRequire>;

/** This module's own require, for loading already-resolved absolute paths. */
const localRequire: RequireHandle = createRequire(
  typeof __filename !== 'undefined' ? __filename : import.meta.url,
);

let requireCache: Map<string, RequireHandle> | null = null;
const resolveCache = new Map<string, string>();

function requireForRoot(root: string): RequireHandle {
  requireCache ??= new Map();
  let handle = requireCache.get(root);
  if (!handle) {
    // Anchor INSIDE the root so Node's resolution walks <root>/node_modules
    // first and honors each package's `exports` map. The file need not exist —
    // only its directory is used to seed the lookup paths. Same trick as
    // grammar-installer.ts and setup-runtime.ts's verifyCriticalModules.
    handle = createRequire(join(root, 'noop.js'));
    requireCache.set(root, handle);
  }
  return handle;
}

function describeCandidates(): string {
  return depsRootCandidates()
    .map((root) => `${root} (node_modules ${existsSync(join(root, 'node_modules')) ? 'present' : 'missing'})`)
    .join(', ');
}

/**
 * Resolve a package to an absolute path, trying each candidate root in order.
 *
 * Per-package rather than per-tree on purpose: a half-migrated machine can serve
 * sqlite-vec from the data directory and the grammars from the legacy tree, and
 * that is correct — each package carries a closed sub-closure, because a flat
 * `bun install` hoists its whole dependency graph into the same tree. The anchor
 * only governs the FIRST hop; everything that package requires afterwards
 * resolves relative to the package's own location.
 */
export function pluginResolve(spec: string): string {
  const cached = resolveCache.get(spec);
  if (cached) return cached;

  let lastError: unknown;
  for (const root of depsRootCandidates()) {
    try {
      const resolved = requireForRoot(root).resolve(spec);
      // Node's resolution walks PARENT directories too, so an anchor at
      // <root>/noop.js happily returns a hit from a node_modules several levels
      // above. That is how a candidate like <repo>/src silently served packages
      // out of <repo>/node_modules — and in production it would let the user's
      // project tree (the worker inherits their cwd) answer for ours. Accept a
      // hit only from THIS candidate's own tree; the parent, if it is a
      // legitimate root, is a candidate in its own right.
      if (resolved.startsWith(join(root, 'node_modules'))) {
        resolveCache.set(spec, resolved);
        return resolved;
      }
    } catch (error: unknown) {
      lastError = error;
    }
  }

  // Name every root that was tried: the failure mode this replaces produced a
  // bare "Cannot find module" whose require stack pointed at the bundle, which
  // told nobody where we actually looked.
  const failure = new Error(
    `Cannot resolve plugin dependency '${spec}'. Searched: ${describeCandidates()}. ` +
      `Run \`npx keepmind install\` to restore the plugin dependencies.`,
  );
  (failure as { cause?: unknown }).cause = lastError;
  throw failure;
}

/** Load a package from the first candidate root that can resolve it. */
export function pluginRequire<T = unknown>(spec: string): T {
  // Resolve first so a miss reports every root tried, then load the concrete
  // absolute path. Loading by absolute path is anchor-independent, so any handle
  // does — reuse the module's own rather than building one per call.
  return localRequire(pluginResolve(spec)) as T;
}

/** True when `spec` resolves from any candidate root. Never throws. */
export function pluginCanResolve(spec: string): boolean {
  try {
    pluginResolve(spec);
    return true;
  } catch {
    return false;
  }
}

/**
 * Packages that stand in for "the dependency tree is usable".
 *
 * Both are hard requirements of the worker and neither is inlined: sqlite-vec
 * carries the vector store's native binary, zod is required transitively by the
 * MCP SDK (including its zod/v3 subpath, which a partial install is known to
 * break — #2730).
 */
const SENTINEL_DEPS = ['sqlite-vec', 'zod'] as const;

/**
 * True when the plugin's dependencies are actually resolvable.
 *
 * Deliberately NOT `existsSync(<root>/node_modules)`. The lazy-spawn path does
 * not set a cwd, so the worker inherits the user's project directory — and any
 * project with its own node_modules would satisfy a directory check while the
 * plugin's own packages are missing, silently suppressing the repair that was
 * supposed to fix exactly that. Resolving named packages cannot be fooled that
 * way: an unrelated tree does not contain sqlite-vec.
 */
export function pluginDepsPresent(): boolean {
  return SENTINEL_DEPS.every((spec) => pluginCanResolve(spec));
}

/**
 * Drop memoized handles and resolutions. Tests move roots between cases, and a
 * successful dependency repair makes a previously failing spec resolvable.
 */
export function resetPluginResolution(): void {
  requireCache = null;
  resolveCache.clear();
}
