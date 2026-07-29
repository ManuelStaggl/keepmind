// IO discipline (see src/shared/hook-io.ts): this handler is PURE. It returns a
// HookResult and MUST NOT call process.stderr.write / process.stdout.write /
// console.* / process.exit. logger.* calls are DIAGNOSTIC.
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { logger } from '../../utils/logger.js';
import { sessionAcquireHandler } from './session-acquire.js';
import { contextHandler } from './context.js';

/**
 * Perf plan P3: ONE SessionStart hook instead of three.
 *
 * Claude Code used to fire three separate commands at every session start, each
 * paying a full Node cold start plus the defensive plugin-root resolution in the
 * shell prelude:
 *
 *   1. `worker-service.cjs start`          2736ms / 1299ms  (two measured runs)
 *   2. `hook claude-code context`          5319ms / 2719ms
 *   3. `hook claude-code session-acquire`  4954ms / 2516ms
 *
 * Step 1 is gone entirely: it only called ensureWorkerStarted() and printed a
 * suppressed status object, and hook-client-entry.ts already calls the very same
 * ensureWorkerStarted() at the top of EVERY hook. It was the most expensive hook
 * of the session purely because it parsed the ~2.7MB worker bundle to do it.
 *
 * Steps 2 and 3 are this handler. `session-acquire` and `context` stay
 * registered as their own events — the Codex / Cursor / Gemini adapters and
 * older installed hook configs still dispatch to them individually.
 */
export const sessionStartHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    // Acquire FIRST so the worker's active-session refcount is incremented
    // before context injection runs. It contributes no model context — it exists
    // for that side effect — so its result is intentionally discarded.
    //
    // A failure here must never cost the user their session context, which is
    // the visible half of SessionStart. hookCommand's catch-all would have
    // swallowed the whole invocation, so contain it locally instead.
    try {
      await sessionAcquireHandler.execute(input);
    } catch (error: unknown) {
      logger.warn('HOOK', 'Session acquire failed during session-start; continuing with context injection', {
        sessionId: input.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return contextHandler.execute(input);
  },
};
