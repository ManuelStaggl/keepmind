// SPDX-License-Identifier: Apache-2.0
//
// claude-mem → keepmind migration & removal.
//
// Three dependency-light, idempotent building blocks shared by the interactive
// installer (`install.ts`) and the `keepmind migrate --purge` CLI:
//
//   detectClaudeMem()  — read-only scan for a legacy claude-mem footprint
//                        (data dir, plugin/marketplace registration, orphaned
//                        chroma processes).
//   verifyMigrated()   — content-hash anti-join proving every source
//                        observation already exists in keepmind. The hard gate
//                        before any destructive removal.
//   purgeClaudeMem()   — stop orphaned processes → archive → deregister the
//                        plugin → clean stray paths → remove ~/.claude-mem, in
//                        that exact order (kill first so file locks release
//                        before removal). Every step is isolated; a failure is
//                        recorded, never thrown.
//
// The migration DB import itself lives in `performMigration` (migrate.ts); this
// module orchestrates detection and cleanup around it.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DATA_DIR, DB_PATH } from '../../shared/paths.js';
import { Database } from '../../storage/db.js';
import {
  claudeSettingsPath,
  installedPluginsPath,
  knownMarketplacesPath,
  pluginsDirectory,
  readJsonSafe,
  writeJsonFileAtomic,
} from '../../npx-cli/utils/paths.js';
import { readCounts, type Counts } from '../../npx-cli/commands/migrate.js';
import { findClaudeMemProcesses, killProcesses } from './claude-mem-processes.js';

const execFileAsync = promisify(execFile);

/** Matches a plugin key/name that belongs to claude-mem (`claude-mem@<market>`). */
const CLAUDE_MEM_RE = /(^|[@/])claude-mem\b/;

export function claudeMemDir(): string {
  return join(homedir(), '.claude-mem');
}
export function claudeMemDbPath(): string {
  return join(claudeMemDir(), 'claude-mem.db');
}

export interface ClaudeMemPresence {
  /** True when any legacy footprint (data, plugin, or process) is found. */
  installed: boolean;
  dataDir: string;
  dbPath: string;
  /** claude-mem.db exists on disk. */
  hasData: boolean;
  /** Source counts, or null when there is no source DB. */
  counts: Counts | null;
  /** installed_plugins / enabledPlugins keys referencing claude-mem. */
  pluginKeys: string[];
  /** known_marketplaces keys (marketplace names) shipping claude-mem. */
  marketplaceKeys: string[];
  /** Resolved on-disk marketplace directories to remove. */
  marketplaceDirs: string[];
}

/** Read-only scan for a legacy claude-mem install. Never throws. */
export function detectClaudeMem(): ClaudeMemPresence {
  const dataDir = claudeMemDir();
  const dbPath = claudeMemDbPath();
  const hasData = existsSync(dbPath);

  const pluginKeys = new Set<string>();
  const marketplaceKeys = new Set<string>();

  // installed_plugins.json: { plugins: { "claude-mem@<market>": {...} } }
  const installed = readJsonSafe<Record<string, any>>(installedPluginsPath(), {});
  for (const key of Object.keys(installed?.plugins ?? {})) {
    if (CLAUDE_MEM_RE.test(key)) {
      pluginKeys.add(key);
      const market = key.split('@')[1];
      if (market) marketplaceKeys.add(market);
    }
  }

  // ~/.claude/settings.json enabledPlugins: { "claude-mem@<market>": true }
  const settings = readJsonSafe<Record<string, any>>(claudeSettingsPath(), {});
  for (const key of Object.keys(settings?.enabledPlugins ?? {})) {
    if (CLAUDE_MEM_RE.test(key)) {
      pluginKeys.add(key);
      const market = key.split('@')[1];
      if (market) marketplaceKeys.add(market);
    }
  }

  // known_marketplaces.json: a marketplace whose checkout ships a "claude-mem"
  // plugin (the marketplace itself may be named anything, e.g. "thedotmack").
  const known = readJsonSafe<Record<string, any>>(knownMarketplacesPath(), {});
  for (const market of Object.keys(known)) {
    if (marketplaceKeys.has(market)) continue;
    if (CLAUDE_MEM_RE.test(market)) {
      marketplaceKeys.add(market);
      continue;
    }
    // Inspect the marketplace manifest for a claude-mem plugin.
    const manifest = readJsonSafe<Record<string, any>>(
      join(pluginsDirectory(), 'marketplaces', market, '.claude-plugin', 'marketplace.json'),
      {},
    );
    const plugins: any[] = Array.isArray(manifest?.plugins) ? manifest.plugins : [];
    if (plugins.some((pl) => typeof pl?.name === 'string' && CLAUDE_MEM_RE.test(pl.name))) {
      marketplaceKeys.add(market);
    }
  }

  const marketplaceDirs = [...marketplaceKeys]
    .map((m) => join(pluginsDirectory(), 'marketplaces', m))
    .filter((dir) => existsSync(dir));

  const installedFlag = hasData || pluginKeys.size > 0 || marketplaceKeys.size > 0;

  return {
    installed: installedFlag,
    dataDir,
    dbPath,
    hasData,
    counts: hasData ? safeReadCounts(dbPath) : null,
    pluginKeys: [...pluginKeys],
    marketplaceKeys: [...marketplaceKeys],
    marketplaceDirs,
  };
}

function safeReadCounts(dbPath: string): Counts | null {
  try {
    return readCounts(dbPath);
  } catch {
    return null;
  }
}

export interface VerifyResult {
  /** Hashed source observations absent from keepmind.db (the purge gate). */
  missing: number;
  /** Total source observations examined. */
  total: number;
  /**
   * Source observations with no content_hash (a legacy schema left the column
   * NULL before it became mandatory). These cannot be hash-verified, but the
   * migration copies them regardless (adopt = full snapshot; merge inserts
   * them — NULL hashes never collide on the unique index), so they do NOT block
   * the purge. Surfaced for transparency.
   */
  unhashable: number;
}

/**
 * Content-hash anti-join: is every *hashed* claude-mem observation already in
 * keepmind? `missing === 0` is the precondition for deleting the source data.
 * A missing source (nothing to verify) or missing target reports `missing: 0`.
 *
 * Rows without a content_hash are counted as `unhashable`, never `missing` —
 * otherwise a user whose legacy data predates the content_hash column could
 * never purge claude-mem even after a complete, successful migration.
 */
export function verifyMigrated(source: string = claudeMemDbPath()): VerifyResult {
  if (!existsSync(source) || !existsSync(DB_PATH)) return { missing: 0, total: 0, unhashable: 0 };

  const target = new Database(DB_PATH, { readonly: true });
  const src = new Database(source, { readonly: true });
  try {
    const targetHashes = new Set(
      target
        .prepare<{ content_hash: string }>(
          "SELECT content_hash FROM observations WHERE content_hash IS NOT NULL",
        )
        .all()
        .map((r) => r.content_hash),
    );
    const srcRows = src
      .prepare<{ content_hash: string | null }>('SELECT content_hash FROM observations')
      .all();
    let missing = 0;
    let unhashable = 0;
    for (const row of srcRows) {
      if (!row.content_hash) {
        unhashable++;
      } else if (!targetHashes.has(row.content_hash)) {
        missing++;
      }
    }
    return { missing, total: srcRows.length, unhashable };
  } finally {
    try { src.close(); } catch { /* ignore */ }
    try { target.close(); } catch { /* ignore */ }
  }
}

export interface PurgeReport {
  processesKilled: number;
  archivePath: string | null;
  marketplacesRemoved: string[];
  pluginsRemoved: string[];
  strayPathsRemoved: number;
  dataDirRemoved: boolean;
  errors: string[];
}

export interface PurgeOptions {
  /** ISO timestamp for the backup filename (passed in for determinism/tests). */
  timestamp: string;
  /** Pre-computed detection to act on; re-scanned when omitted. */
  presence?: ClaudeMemPresence;
}

/**
 * Remove claude-mem completely. Caller MUST have confirmed intent and that
 * `verifyMigrated().missing === 0`. Best-effort throughout: each step is
 * isolated and records failures into the report rather than throwing.
 */
export async function purgeClaudeMem(opts: PurgeOptions): Promise<PurgeReport> {
  const presence = opts.presence ?? detectClaudeMem();
  const report: PurgeReport = {
    processesKilled: 0,
    archivePath: null,
    marketplacesRemoved: [],
    pluginsRemoved: [],
    strayPathsRemoved: 0,
    dataDirRemoved: false,
    errors: [],
  };

  // 1) Stop orphaned processes FIRST so chroma file locks release before rm.
  try {
    const procs = await findClaudeMemProcesses();
    report.processesKilled = await killProcesses(procs.map((p) => p.pid));
  } catch (e) {
    report.errors.push(`process stop: ${errMsg(e)}`);
  }

  // 2) Archive the data dir before deleting it (safety net / rollback point).
  // A failed backup MUST NOT proceed to deletion — losing the archive is the
  // one thing the two-step design promises never to do.
  let backupOk = true;
  if (existsSync(presence.dataDir)) {
    try {
      report.archivePath = await archiveDirectory(presence.dataDir, opts.timestamp);
    } catch (e) {
      backupOk = false;
      report.errors.push(`archive: ${errMsg(e)}`);
    }
  }

  // 3) Deregister the plugin + marketplace from Claude Code.
  try {
    deregister(presence, report);
  } catch (e) {
    report.errors.push(`deregister: ${errMsg(e)}`);
  }

  // 4) Clean stray npx/cache/log paths, shell aliases, and ~/.claude.json.
  try {
    report.strayPathsRemoved = removeStrayPaths();
  } catch (e) {
    report.errors.push(`stray paths: ${errMsg(e)}`);
  }
  try {
    stripClaudeMemShellAliases(report);
  } catch (e) {
    report.errors.push(`shell alias: ${errMsg(e)}`);
  }
  try {
    cleanClaudeJsonUsage(report);
  } catch (e) {
    report.errors.push(`claude.json: ${errMsg(e)}`);
  }

  // 5) Finally remove the data directory (locks released by step 1) — but only
  // if the backup succeeded, so a failed archive never means silent data loss.
  if (existsSync(presence.dataDir)) {
    if (!backupOk) {
      report.errors.push('data dir kept: backup failed, refusing to delete without an archive');
    } else {
      try {
        rmSync(presence.dataDir, { recursive: true, force: true });
        report.dataDirRemoved = !existsSync(presence.dataDir);
      } catch (e) {
        report.errors.push(`remove data dir: ${errMsg(e)}`);
      }
    }
  }

  return report;
}

/** Compress the data dir into ~/.keepmind/backups. Returns the archive path. */
async function archiveDirectory(dataDir: string, timestamp: string): Promise<string> {
  const backupsDir = join(DATA_DIR, 'backups');
  mkdirSync(backupsDir, { recursive: true });
  const stamp = timestamp.replace(/[:.]/g, '-');

  if (process.platform === 'win32') {
    const dest = join(backupsDir, `claude-mem-${stamp}.zip`);
    await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Compress-Archive -Path ${psQuote(join(dataDir, '*'))} -DestinationPath ${psQuote(dest)} -Force`],
      { windowsHide: true, timeout: 120000 },
    );
    return dest;
  }

  const dest = join(backupsDir, `claude-mem-${stamp}.tar.gz`);
  await execFileAsync('tar', ['-czf', dest, '-C', homedir(), '.claude-mem'], { timeout: 120000 });
  return dest;
}

/** Remove the claude-mem plugin + marketplace from Claude Code's registries. */
function deregister(presence: ClaudeMemPresence, report: PurgeReport): void {
  // installed_plugins.json
  const installed = readJsonSafe<Record<string, any>>(installedPluginsPath(), {});
  let installedDirty = false;
  for (const key of presence.pluginKeys) {
    if (installed?.plugins?.[key] !== undefined) {
      delete installed.plugins[key];
      report.pluginsRemoved.push(key);
      installedDirty = true;
    }
  }
  if (installedDirty) writeJsonFileAtomic(installedPluginsPath(), installed);

  // ~/.claude/settings.json enabledPlugins
  const settings = readJsonSafe<Record<string, any>>(claudeSettingsPath(), {});
  let settingsDirty = false;
  for (const key of presence.pluginKeys) {
    if (settings?.enabledPlugins?.[key] !== undefined) {
      delete settings.enabledPlugins[key];
      settingsDirty = true;
    }
  }
  if (settingsDirty) writeJsonFileAtomic(claudeSettingsPath(), settings);

  // known_marketplaces.json + on-disk marketplace directories
  const known = readJsonSafe<Record<string, any>>(knownMarketplacesPath(), {});
  let knownDirty = false;
  for (const market of presence.marketplaceKeys) {
    if (known?.[market] !== undefined) {
      delete known[market];
      knownDirty = true;
    }
  }
  if (knownDirty) writeJsonFileAtomic(knownMarketplacesPath(), known);

  for (const dir of presence.marketplaceDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      report.marketplacesRemoved.push(dir);
    }
  }
}

/**
 * Clean stray claude-mem artifacts outside the registries. Mirrors the pattern
 * in uninstall.ts:removeStrayClaudeMemPaths but targets claude-mem, not keepmind.
 */
function removeStrayPaths(): number {
  const home = homedir();
  let removed = 0;

  // ~/.npm/_npx/<hash>/node_modules/claude-mem
  const npxRoot = join(home, '.npm', '_npx');
  if (existsSync(npxRoot)) {
    for (const hashDir of safeReaddir(npxRoot)) {
      const candidate = join(npxRoot, hashDir, 'node_modules', 'claude-mem');
      if (existsSync(candidate) && tryRm(candidate)) removed++;
    }
  }

  // ~/.cache/claude-cli-nodejs/<project>/mcp-logs-plugin-claude-mem-*
  const cacheRoot = join(home, '.cache', 'claude-cli-nodejs');
  if (existsSync(cacheRoot)) {
    for (const projectDir of safeReaddir(cacheRoot)) {
      const projectPath = join(cacheRoot, projectDir);
      for (const entry of safeReaddir(projectPath)) {
        if (entry.startsWith('mcp-logs-plugin-claude-mem-') && tryRm(join(projectPath, entry))) removed++;
      }
    }
  }

  // ~/.claude/plugins/data/claude-mem-*
  const pluginDataRoot = join(home, '.claude', 'plugins', 'data');
  if (existsSync(pluginDataRoot)) {
    for (const entry of safeReaddir(pluginDataRoot)) {
      if (entry.startsWith('claude-mem-') && tryRm(join(pluginDataRoot, entry))) removed++;
    }
  }

  return removed;
}

/**
 * Remove any `alias claude-mem=…` line from the user's shell profiles so the
 * old command name doesn't linger after removal. Mirrors the pattern in
 * uninstall.ts:stripLegacyClaudeMemAlias. Best-effort per file.
 */
function stripClaudeMemShellAliases(report: PurgeReport): void {
  const home = homedir();
  const candidates = [
    join(home, '.bashrc'),
    join(home, '.zshrc'),
    join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
  ];
  const aliasRe = /^\s*(alias\s+claude-mem\s*=|Set-Alias\s+(-Name\s+)?claude-mem\b)/;

  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    try {
      const lines = readFileSync(filePath, 'utf-8').split('\n');
      const filtered = lines.filter((line) => !aliasRe.test(line));
      if (filtered.length !== lines.length) {
        writeFileSync(filePath, filtered.join('\n'));
        report.strayPathsRemoved += lines.length - filtered.length;
      }
    } catch (e) {
      report.errors.push(`shell alias (${filePath}): ${errMsg(e)}`);
    }
  }
}

/**
 * Strip claude-mem usage bookkeeping from ~/.claude.json. Never rewrites the
 * file unless it parsed to a real object AND we actually removed a key — a
 * guard against clobbering the user's config (which holds unrelated state and
 * secrets) if the read/parse ever fails.
 */
function cleanClaudeJsonUsage(report: PurgeReport): void {
  const claudeJsonPath = join(homedir(), '.claude.json');
  if (!existsSync(claudeJsonPath)) return;

  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'));
  } catch (e) {
    report.errors.push(`claude.json parse (left intact): ${errMsg(e)}`);
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

  let dirty = false;
  for (const bucket of ['skillUsage', 'pluginUsage', 'usageStats']) {
    const obj = parsed[bucket];
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      for (const key of Object.keys(obj)) {
        if (CLAUDE_MEM_RE.test(key)) {
          delete obj[key];
          dirty = true;
        }
      }
    }
  }
  if (dirty) writeJsonFileAtomic(claudeJsonPath, parsed);
}

function safeReaddir(dir: string): string[] {
  try { return readdirSync(dir); } catch { return []; }
}
function tryRm(target: string): boolean {
  try { rmSync(target, { recursive: true, force: true }); return true; } catch { return false; }
}
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
