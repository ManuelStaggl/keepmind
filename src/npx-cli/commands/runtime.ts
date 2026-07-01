import { spawnHidden } from '../../shared/spawn.js';
import { sanitizeEnv } from '../../supervisor/env-sanitizer.js';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import pc from 'picocolors';
import { resolveWorkerRuntimePath } from '../../services/infrastructure/ProcessManager.js';
import { isPluginInstalled, marketplaceDirectory, pluginCacheDirectory, pluginsDirectory } from '../utils/paths.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';

function ensureInstalledOrExit(): void {
  if (!isPluginInstalled()) {
    console.error(pc.red('keepmind is not installed.'));
    console.error(`Run: ${pc.bold('npx keepmind install')}`);
    process.exit(1);
  }
}

/**
 * Resolve the Node runtime that runs the worker bundle. keepmind is a node-only
 * fork — the worker bundle imports `node:sqlite`, which Bun does not provide, so
 * these lifecycle commands MUST launch it under Node (not Bun). This mirrors the
 * auto-spawn path (worker-utils / ProcessManager), keeping manual and automatic
 * starts on the same runtime.
 */
function resolveNodeRuntimeOrExit(): string {
  const nodePath = resolveWorkerRuntimePath();
  if (!nodePath) {
    console.error(pc.red('Node.js runtime not found.'));
    console.error('keepmind requires Node.js >= 22.5 — install it from https://nodejs.org');
    console.error('After installation, restart your terminal.');
    process.exit(1);
  }
  return nodePath;
}

/** Version of the installed plugin, from the marketplace copy's plugin.json. */
function installedPluginVersion(): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(join(marketplaceDirectory(), 'plugin', '.claude-plugin', 'plugin.json'), 'utf-8'),
    );
    return typeof manifest?.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a plugin runtime script, preferring the cache copy over the
 * marketplace copy. The cache directory is where install runs `bun install`, so
 * it is the ONLY copy with a populated node_modules — the worker bundle
 * externalises runtime deps (zod incl. its zod/v3 subpath, sqlite-vec, the
 * Agent SDK) and requires them at runtime. Running the marketplace copy (source
 * only, no node_modules) fails with `Cannot find module 'zod/v3'`. Falls back
 * to any cached version that has the script, then the marketplace source.
 */
function pluginScriptPath(scriptName: string): string {
  const version = installedPluginVersion();
  if (version) {
    const cacheScript = join(pluginCacheDirectory(version), 'scripts', scriptName);
    if (existsSync(cacheScript)) return cacheScript;
  }
  const cacheBase = join(pluginsDirectory(), 'cache', 'keepmind', 'keepmind');
  if (existsSync(cacheBase)) {
    for (const v of readdirSync(cacheBase)) {
      const candidate = join(cacheBase, v, 'scripts', scriptName);
      if (existsSync(candidate)) return candidate;
    }
  }
  return join(marketplaceDirectory(), 'plugin', 'scripts', scriptName);
}

function workerServiceScriptPath(): string {
  return pluginScriptPath('worker-service.cjs');
}

/**
 * Spawn a plugin .cjs script under Node with inherited stdio, exiting this
 * process with the child's exit code. `args[0]` is the script path. Sanitizes
 * host CLI bleed-through and Anthropic credentials before launch; credentials
 * are re-read from ~/.keepmind/.env at SDK spawn time (#2357 / #2375).
 */
function spawnPlugin(runtimePath: string, args: string[], startFailureLabel = 'worker'): void {
  // cwd = the script's own directory so it runs from the cache tree that owns
  // the populated node_modules (matches where the script path was resolved).
  const child = spawnHidden(runtimePath, args, {
    stdio: 'inherit',
    cwd: dirname(args[0]),
    env: sanitizeEnv(process.env),
  });

  child.on('error', (error) => {
    console.error(pc.red(`Failed to start ${startFailureLabel}: ${error.message}`));
    process.exit(1);
  });

  child.on('close', (exitCode) => {
    process.exit(exitCode ?? 0);
  });
}

function spawnNodeWorkerCommand(command: string, extraArgs: string[] = []): void {
  ensureInstalledOrExit();
  const nodePath = resolveNodeRuntimeOrExit();
  const workerScript = workerServiceScriptPath();

  if (!existsSync(workerScript)) {
    console.error(pc.red(`Worker script not found at: ${workerScript}`));
    console.error('The installation may be corrupted. Try: npx keepmind install');
    process.exit(1);
  }

  spawnPlugin(nodePath, [workerScript, command, ...extraArgs]);
}

export function runStartCommand(): void {
  spawnNodeWorkerCommand('start');
}

export function runStopCommand(): void {
  spawnNodeWorkerCommand('stop');
}

export function runRestartCommand(): void {
  spawnNodeWorkerCommand('restart');
}

export function runStatusCommand(): void {
  spawnNodeWorkerCommand('status');
}

export function runServerApiKeyCommand(extraArgs: string[] = []): void {
  spawnNodeWorkerCommand('server', ['api-key', ...extraArgs]);
}

export function runAdoptCommand(extraArgs: string[] = []): void {
  ensureInstalledOrExit();
  const nodePath = resolveNodeRuntimeOrExit();
  const workerScript = workerServiceScriptPath();

  if (!existsSync(workerScript)) {
    console.error(pc.red(`Worker script not found at: ${workerScript}`));
    console.error('The installation may be corrupted. Try: npx keepmind install');
    process.exit(1);
  }

  const userCwd = process.cwd();
  spawnPlugin(nodePath, [workerScript, 'adopt', '--cwd', userCwd, ...extraArgs]);
}

export function runCleanupCommand(extraArgs: string[] = []): void {
  spawnNodeWorkerCommand('cleanup', extraArgs);
}

export async function runSearchCommand(queryParts: string[]): Promise<void> {
  ensureInstalledOrExit();

  const query = queryParts.join(' ').trim();
  if (!query) {
    console.error(pc.red('Usage: npx keepmind search <query>'));
    process.exit(1);
  }

  const workerPort = SettingsDefaultsManager.get('CLAUDE_MEM_WORKER_PORT');
  const searchUrl = `http://127.0.0.1:${workerPort}/api/search?query=${encodeURIComponent(query)}`;

  let response: Response;
  try {
    response = await fetch(searchUrl);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? (error as any).cause : undefined;
    if (cause?.code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
      console.error(pc.red('Worker is not running.'));
      console.error(`Start it with: ${pc.bold('npx keepmind start')}`);
      process.exit(1);
    }
    console.error(pc.red(`Search failed: ${message}`));
    process.exit(1);
  }

  if (!response.ok) {
    if (response.status === 404) {
      console.error(pc.red('Search endpoint not found. Is the worker running?'));
      console.error(`Try: ${pc.bold('npx keepmind start')}`);
      process.exit(1);
    }
    console.error(pc.red(`Search failed: HTTP ${response.status}`));
    process.exit(1);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(pc.red(`Search failed: invalid JSON response (${message})`));
    process.exit(1);
  }

  if (typeof data === 'object' && data !== null) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(data);
  }
}

export function runTranscriptWatchCommand(): void {
  ensureInstalledOrExit();
  const nodePath = resolveNodeRuntimeOrExit();

  const transcriptWatcherPath = pluginScriptPath('transcript-watcher.cjs');

  if (!existsSync(transcriptWatcherPath)) {
    spawnNodeWorkerCommand('transcript', ['watch']);
    return;
  }

  spawnPlugin(nodePath, [transcriptWatcherPath, 'watch'], 'transcript watcher');
}
