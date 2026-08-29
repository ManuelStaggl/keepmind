// IO discipline (see src/shared/hook-io.ts):
// - hookSpecificOutput.additionalContext → MODEL_CONTEXT (model consumes; via stdout JSON)
// - systemMessage                        → USER_HINT (user-visible; via stdout JSON systemMessage)
// This handler is PURE: it returns a HookResult and MUST NOT call
// process.stderr.write / process.stdout.write / console.* / process.exit.
// logger.* calls are DIAGNOSTIC and route through hook-io's stderr path.
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import {
  executeWithWorkerFallback,
  isWorkerFallback,
  getWorkerPort,
} from '../../shared/worker-utils.js';
import { getProjectContext } from '../../utils/project-name.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { logger } from '../../utils/logger.js';
import { loadFromFileOnce } from '../../shared/hook-settings.js';
import { shouldTrackProject } from '../../shared/should-track-project.js';
import { readUpdateHint } from '../../shared/update-check.js';
import {
  CHECKPOINT_BLOCK_END_MARKER,
  CHECKPOINT_BUDGET_MULTIPLIER,
  CHECKPOINT_RELOAD_HINT,
} from '../../shared/checkpoint.js';
import {
  collectUserAlerts,
  renderAlertsForModel,
  renderAlertsForTerminal,
} from '../../shared/user-alerts.js';
import { normalizePlatformSource } from '../../shared/platform-source.js';
import { callMcpToolOnce } from '../../shared/mcp-client.js';

async function fetchSessionStartContextViaMcp(args: {
  projects: string[];
  platformSource?: string;
  colors?: boolean;
}): Promise<string | null> {
  try {
    const result = await callMcpToolOnce('session_start_context', {
      projects: args.projects,
      ...(args.platformSource ? { platformSource: args.platformSource } : {}),
      ...(args.colors !== undefined ? { colors: args.colors } : {}),
    });
    if (result.isError) {
      logger.warn('HOOK', 'MCP session_start_context returned an error; falling back to worker HTTP', {
        preview: result.text.slice(0, 200),
      });
      return null;
    }
    return result.text.trim();
  } catch (error: unknown) {
    logger.warn('HOOK', 'MCP session_start_context failed; falling back to worker HTTP', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Cap the injected timeline at a hard character ceiling.
 *
 * The SessionStart injection is the one part of keepmind with a demonstrated
 * payoff — it is measured at ~4.2k chars (~1k tokens) and it is why the session
 * does not have to be re-explained. But nothing enforced that size: it is
 * rendered from a token budget that is itself an estimate, so a busy project
 * could quietly push it well past the figure it was tuned for. The ceiling
 * makes the cost of a session start knowable rather than typical.
 *
 * Trimmed on a line boundary so a row is never half-shown, and the truncation
 * is announced — an unmarked cut would read as "there was nothing more".
 */
function trimToLineBoundary(text: string, room: number): string {
  const cut = text.slice(0, Math.max(0, room));
  const lastBreak = cut.lastIndexOf('\n');
  return lastBreak > room * 0.5 ? cut.slice(0, lastBreak) : cut;
}

/**
 * S20: spend the ceiling from the RIGHT end.
 *
 * The checkpoint is the single most expensive text in the block to lose: it was
 * curated by hand for exactly this moment and it is the documented alternative
 * to `/compact`. The observation list below it is regenerated every session and
 * is searchable besides. So the checkpoint is served FIRST and in full, and the
 * budget is spent on what follows it.
 *
 * "In full" has a ceiling of its own (CHECKPOINT_BUDGET_MULTIPLIER) so one
 * runaway checkpoint cannot fill a session's context. When even that is
 * exceeded the checkpoint IS trimmed — but then the notice names what is
 * missing and how to fetch it, because a silent cut reads as "there was nothing
 * more", which is the whole failure being fixed.
 */
export function capInjectedContext(
  text: string,
  maxChars: number,
  checkpointMaxChars?: number,
): string {
  if (maxChars <= 0 || text.length <= maxChars) return text;

  const notice = '\n… (trimmed by KEEPMIND_SESSION_START_MAX_CHARS)';
  const markerAt = text.indexOf(CHECKPOINT_BLOCK_END_MARKER);

  // No checkpoint in this block: unchanged behaviour.
  if (markerAt === -1) {
    return `${trimToLineBoundary(text, Math.max(0, maxChars - notice.length))}${notice}`;
  }

  const headEnd = markerAt + CHECKPOINT_BLOCK_END_MARKER.length;
  const head = text.slice(0, headEnd);
  const tail = text.slice(headEnd);
  const checkpointCeiling = checkpointMaxChars ?? maxChars * CHECKPOINT_BUDGET_MULTIPLIER;

  if (head.length > checkpointCeiling) {
    const cutNotice =
      `\n… (checkpoint trimmed at KEEPMIND_CHECKPOINT_MAX_CHARS — ${CHECKPOINT_RELOAD_HINT})`;
    const body = trimToLineBoundary(head, Math.max(0, checkpointCeiling - cutNotice.length));
    return `${body}${cutNotice}`;
  }

  // The checkpoint fits. Whatever is left of the budget goes to the timeline;
  // when nothing is left, say so rather than ending on a bare marker.
  const remaining = maxChars - head.length;
  if (remaining <= notice.length) {
    return `${head}\n… (timeline omitted — the checkpoint used the KEEPMIND_SESSION_START_MAX_CHARS budget; ${CHECKPOINT_RELOAD_HINT})`;
  }
  if (tail.length <= remaining) return text;
  return `${head}${trimToLineBoundary(tail, remaining - notice.length)}${notice}`;
}

export const contextHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const cwd = input.cwd ?? process.cwd();

    // Honor KEEPMIND_EXCLUDED_PROJECTS on the inject/read path too. The write
    // path (ingestObservation) already skips excluded projects, but the
    // SessionStart summary was injected regardless — so an excluded dir (e.g.
    // "~") still got a context dump on every new session (upstream 0409d9e4).
    if (!shouldTrackProject(cwd)) {
      logger.debug('HOOK', 'Project excluded from tracking, skipping context injection', { cwd });
      return {
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
        exitCode: HOOK_EXIT_CODES.SUCCESS,
      };
    }

    const context = getProjectContext(cwd);
    const port = getWorkerPort();

    const settings = loadFromFileOnce();
    const showTerminalOutput = settings.KEEPMIND_CONTEXT_SHOW_TERMINAL_OUTPUT === 'true';

    const emptyContext: HookResult = {
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' },
      exitCode: HOOK_EXIT_CODES.SUCCESS,
    };
    const off = (value: unknown) => String(value ?? '').toLowerCase() === 'false';
    if (off(settings.KEEPMIND_ENABLED) || off(settings.KEEPMIND_SESSION_START_INJECT)) {
      logger.debug('HOOK', 'Session start injection disabled by settings', { cwd });
      return emptyContext;
    }
    const maxInjectChars = (() => {
      const parsed = parseInt(String(settings.KEEPMIND_SESSION_START_MAX_CHARS ?? ''), 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 4_500;
    })();

    // S20: the checkpoint's own ceiling, so the baton is not measured against a
    // budget that was tuned for the observation list.
    const checkpointMaxChars = (() => {
      const parsed = parseInt(String(settings.KEEPMIND_CHECKPOINT_MAX_CHARS ?? ''), 10);
      return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : maxInjectChars * CHECKPOINT_BUDGET_MULTIPLIER;
    })();

    const projectsParam = context.allProjects.join(',');
    const normalizedPlatformSource = input.platform
      ? normalizePlatformSource(input.platform)
      : undefined;
    const platformSourceParam = input.platform
      ? `&platformSource=${encodeURIComponent(normalizedPlatformSource!)}`
      : '';
    const apiPath = `/api/context/inject?projects=${encodeURIComponent(projectsParam)}${platformSourceParam}`;
    const colorApiPath = input.platform === 'claude-code' ? `${apiPath}&colors=true` : apiPath;

    // S15: computed BEFORE the worker is asked anything. Every alert source is
    // a file on disk, so an alert survives exactly the situation it is most
    // needed in — a worker that is down, wedged, or not writing memory. The old
    // code read the markers only AFTER a successful context fetch, so a dead
    // worker returned an empty context and said nothing at all.
    const alerts = collectUserAlerts();
    const alertBlockForModel = renderAlertsForModel(alerts);
    const alertBlockForTerminal = renderAlertsForTerminal(alerts);

    const emptyResult: HookResult = {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: alertBlockForModel,
        ...(alertBlockForTerminal ? { systemMessage: alertBlockForTerminal } : {}),
      },
      exitCode: HOOK_EXIT_CODES.SUCCESS,
    };

    let additionalContext: string;
    const mcpContextResult = input.platform === 'codex'
      ? await fetchSessionStartContextViaMcp({
          projects: context.allProjects,
          ...(normalizedPlatformSource ? { platformSource: normalizedPlatformSource } : {}),
        })
      : null;

    if (mcpContextResult !== null) {
      additionalContext = mcpContextResult;
    } else {
      const contextResult = await executeWithWorkerFallback<string>(apiPath, 'GET');
      if (isWorkerFallback(contextResult)) {
        return emptyResult;
      }

      if (typeof contextResult === 'string') {
        additionalContext = contextResult.trim();
      } else if (contextResult === undefined) {
        additionalContext = '';
      } else {
        logger.warn('HOOK', 'Context response was not a string', { type: typeof contextResult });
        return emptyResult;
      }
    }

    // Apply the ceiling to the timeline BEFORE the hints are prepended: the
    // hints are short, urgent and must never be the thing that gets trimmed.
    const beforeCap = additionalContext.length;
    additionalContext = capInjectedContext(
      additionalContext,
      maxInjectChars,
      checkpointMaxChars,
    );
    if (additionalContext.length < beforeCap) {
      logger.debug('HOOK', 'Session start context trimmed to ceiling', {
        beforeCap,
        afterCap: additionalContext.length,
        maxInjectChars,
      });
    }

    // Proactive update notice: a one-line hint when a newer keepmind is on npm.
    // Pure local cache read (the worker runs the networked poll on its own), so
    // it never slows SessionStart; compares npm-latest against THIS build, so it
    // self-clears right after an update. Opt-out: KEEPMIND_UPDATE_CHECK_ENABLED
    // =false. Prepended first so the (more urgent) stale-OAuth hint lands above.
    if (String(settings.KEEPMIND_UPDATE_CHECK_ENABLED ?? 'true').toLowerCase() !== 'false') {
      const updateHint = readUpdateHint();
      if (updateHint) {
        additionalContext = additionalContext ? `${updateHint}\n\n${additionalContext}` : updateHint;
      }
    }

    // S15: one block, at the very top, carrying an explicit instruction to the
    // model to relay it. The stale-OAuth and vector hints used to be prepended
    // as bare lines, which reaches the MODEL but never the person: verified
    // 29.08.2026 that the Claude Code Desktop App displays neither a hook's
    // `systemMessage` nor a status line, so a notice with no relay instruction
    // is a notice the user never sees. collectUserAlerts() carries both of
    // those plus the generator-health state (S13/S14).
    if (alertBlockForModel) {
      additionalContext = additionalContext
        ? `${alertBlockForModel}\n\n${additionalContext}`
        : alertBlockForModel;
    }

    let coloredTimeline = '';
    if (showTerminalOutput) {
      const mcpColorResult = input.platform === 'codex'
        ? await fetchSessionStartContextViaMcp({
            projects: context.allProjects,
            ...(normalizedPlatformSource ? { platformSource: normalizedPlatformSource } : {}),
            colors: true,
          })
        : null;
      if (mcpColorResult !== null) {
        coloredTimeline = mcpColorResult;
      } else {
        const colorResult = await executeWithWorkerFallback<string>(colorApiPath, 'GET');
        if (!isWorkerFallback(colorResult) && typeof colorResult === 'string') {
          coloredTimeline = colorResult.trim();
        }
      }
    }

    const platform = input.platform;

    const displayContent = coloredTimeline || (platform === 'gemini-cli' || platform === 'gemini' ? additionalContext : '');

    // The degradation warning must reach the user even when the timeline output
    // is switched off (the default) — that setting governs cosmetics, not alerts.
    const timelineMessage = showTerminalOutput && displayContent
      ? `${displayContent}\n\nView Observations Live @ http://localhost:${port}`
      : undefined;
    const systemMessage = alertBlockForTerminal
      ? (timelineMessage ? `${alertBlockForTerminal}\n\n${timelineMessage}` : alertBlockForTerminal)
      : timelineMessage;

    return {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext
      },
      systemMessage
    };
  }
};
