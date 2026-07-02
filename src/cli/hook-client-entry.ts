// SPDX-License-Identifier: Apache-2.0
//
// Slim hook client. Bundled as hook-client.cjs (see scripts/build-hooks.js) and
// spawned by bun-runner for every `hook` command. Its ONLY job: make sure the
// worker daemon is up, then run hookCommand — read the hook payload from stdin,
// POST it to the daemon over HTTP, emit the response on stdout.
//
// It MUST NOT import the daemon itself (Database / node:sqlite storage,
// sqlite-vec, the embedder, the MCP server, HTTP routes). Those live in
// worker-service.cjs (~2.7 MB). Loading that whole bundle just to make one HTTP
// POST cost ~380 ms of parse time on EVERY hook — the dominant slice of the
// ~1 s per-hook latency, and enough for Claude Code to cancel the SessionEnd
// hook mid-flight ("Hook cancelled"). This client parses in ~30 ms. See the
// perf plan (P1) and the build-time leak guard in build-hooks.js that fails the
// build if a daemon module ever creeps into this bundle.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { getWorkerPort, resolveWorkerScriptPath } from '../shared/worker-utils.js';
import { ensureWorkerStarted } from '../services/worker-spawner.js';
import { hookCommand } from './hook-command.js';
import { logger } from '../utils/logger.js';

/**
 * The daemon bundle to (lazy-)spawn is worker-service.cjs, which ships in the
 * same scripts dir as this client — prefer that sibling so we always launch the
 * matching version. Fall back to the marketplace/cwd resolver only if the
 * sibling is missing (unexpected partial install).
 */
function resolveDaemonScript(): string | null {
  try {
    const sibling = path.join(__dirname, 'worker-service.cjs');
    if (existsSync(sibling)) return sibling;
  } catch {
    // __dirname unavailable — fall through to the resolver.
  }
  return resolveWorkerScriptPath();
}

async function main(): Promise<void> {
  // bun-runner passes the SAME trailing args it used for worker-service.cjs
  // (`hook <platform> <event>`), so keep the argv offsets: argv[3]=platform,
  // argv[4]=event.
  const platform = process.argv[3];
  const event = process.argv[4];
  if (!platform || !event) {
    console.error('Usage: hook-client hook <platform> <event>');
    process.exit(1);
  }

  const port = getWorkerPort();
  const scriptPath = resolveDaemonScript();
  if (scriptPath) {
    try {
      const result = await ensureWorkerStarted(port, scriptPath);
      if (result === 'dead') {
        logger.warn('SYSTEM', 'Worker failed to start before hook; handler will proceed gracefully');
      }
    } catch (error: unknown) {
      logger.debug('SYSTEM', 'ensureWorkerStarted threw before hook', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } else {
    logger.warn('SYSTEM', 'worker-service.cjs not found next to hook-client; running hook against any live worker');
  }

  // hookCommand owns stdout/stderr/exit from here (see src/shared/hook-io.ts):
  // on the happy path it drains and exits via exitGraceful and never returns.
  await hookCommand(platform, event);
}

main().catch((error: unknown) => {
  // Exit 0 per the project's hook exit-code policy (a hook failure must never
  // break the host / pile up Windows terminal tabs). This catch only covers
  // pre-hookCommand setup failures — hookCommand handles its own errors.
  logger.failure('SYSTEM', 'hook-client fatal error', {}, error instanceof Error ? error : new Error(String(error)));
  process.exit(0);
});
