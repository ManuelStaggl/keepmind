// IO discipline (see src/shared/hook-io.ts): this handler is PURE. It returns a
// HookResult and MUST NOT call process.stderr.write / process.stdout.write /
// console.* / process.exit. logger.* calls are DIAGNOSTIC.
//
// Phase 4 / Step 7 — PreCompact hook. Claude Code fires this before it
// compacts/evicts context. We capture the about-to-be-evicted span as a memory
// through the SAME store chokepoint (/api/memory/save -> SessionStore), so it is
// automatically redacted (Step 1), importance-scored (Step 3) and reconciled
// (Step 4). This prevents loss of context on compaction (MemGPT-style).
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { executeWithWorkerFallback, isWorkerFallback } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';
import { extractLastMessage } from '../../shared/transcript-parser.js';
import { stripMemoryTagsFromPrompt } from '../../utils/tag-stripping.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { shouldTrackProject } from '../../shared/should-track-project.js';
import { getProjectName } from '../../utils/project-name.js';

const MAX_CAPTURE_CHARS = 8000;

export const precompactHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const ok: HookResult = { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };

    if (input.cwd && !shouldTrackProject(input.cwd)) return ok;

    // Capture the evicted span. Prefer an explicitly-provided last assistant
    // message; otherwise pull it from the transcript. Bounded to keep the write
    // cheap; the store chokepoint redacts + scores it.
    let captured = '';
    try {
      if (input.lastAssistantMessage) {
        captured = stripMemoryTagsFromPrompt(input.lastAssistantMessage);
      } else if (input.transcriptPath) {
        captured = stripMemoryTagsFromPrompt(extractLastMessage(input.transcriptPath, 'assistant', true));
      }
    } catch (error) {
      logger.debug('HOOK', 'precompact: transcript extraction failed', { sessionId: input.sessionId }, error instanceof Error ? error : new Error(String(error)));
    }

    captured = (captured ?? '').trim().slice(0, MAX_CAPTURE_CHARS);
    if (!captured) {
      logger.debug('HOOK', 'precompact: nothing to capture, skipping', { sessionId: input.sessionId });
      return ok;
    }

    const project = input.cwd ? getProjectName(input.cwd) : undefined;

    try {
      const result = await executeWithWorkerFallback('/api/memory/save', 'POST', {
        text: captured,
        title: 'Pre-compaction context capture',
        project,
        metadata: { source: 'precompact', sessionId: input.sessionId },
      }, { timeoutMs: 5000 });

      if (isWorkerFallback(result)) {
        logger.debug('HOOK', 'precompact: worker unreachable, capture skipped', { sessionId: input.sessionId });
      } else {
        logger.info('HOOK', 'precompact: captured evicted context through store chokepoint', { sessionId: input.sessionId, chars: captured.length });
      }
    } catch (error) {
      logger.warn('HOOK', 'precompact: capture failed', { sessionId: input.sessionId }, error instanceof Error ? error : new Error(String(error)));
    }

    return ok;
  },
};
