// IO discipline (see src/shared/hook-io.ts): this handler is PURE. It returns a
// HookResult and MUST NOT call process.stderr.write / process.stdout.write /
// console.* / process.exit. logger.* calls are DIAGNOSTIC.
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { workerHttpRequest } from '../../shared/worker-utils.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { logger } from '../../utils/logger.js';

/**
 * SessionEnd refcount: deregister this session from the shared worker. This is
 * a best-effort, NON-spawning POST: if the worker is already gone we must NOT
 * resurrect it (so we bypass executeWithWorkerFallback, which would lazy-spawn).
 * When the count reaches 0 the worker self-shuts-down after its grace period.
 */
export const sessionReleaseHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const sessionId = input.sessionId;
    if (sessionId) {
      try {
        await workerHttpRequest('/api/session/release', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
          timeoutMs: 2000,
        });
        logger.debug('HOOK', 'Session release sent', { sessionId });
      } catch (error: unknown) {
        logger.debug('HOOK', 'Session release failed (worker likely already stopped)', {
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
  },
};
