// IO discipline (see src/shared/hook-io.ts): this handler is PURE. It returns a
// HookResult and MUST NOT call process.stderr.write / process.stdout.write /
// console.* / process.exit. logger.* calls are DIAGNOSTIC.
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { executeWithWorkerFallback } from '../../shared/worker-utils.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { logger } from '../../utils/logger.js';

/**
 * SessionStart refcount: register this session with the shared worker. Uses the
 * worker-fallback transport, which ensures the worker is running (starting it
 * if needed) and then increments the active-session counter. Idempotent — a
 * repeated SessionStart for the same id just refreshes its last-seen stamp.
 */
export const sessionAcquireHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const sessionId = input.sessionId;
    if (sessionId) {
      await executeWithWorkerFallback('/api/session/acquire', 'POST', { sessionId });
      logger.debug('HOOK', 'Session acquire sent', { sessionId });
    }
    return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
  },
};
