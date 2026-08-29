/**
 * Single source of truth for the SECURITY-SENSITIVE SDK options that lock the
 * Observer and KnowledgeAgent sessions down to "no tool access".
 *
 * THREAT MODEL
 * ------------
 * The Observer/KnowledgeAgent system prompts assert "You do not have access to
 * tools" (see plugin/modes/*.json — `system_identity`). Historically that
 * guarantee was enforced ONLY by `disallowedTools`. If a future SDK release
 * shipped a new built-in tool that was not in our deny-list, the Observer could
 * autonomously call Edit/Write/Bash on the user's source tree. This helper
 * makes the prompt's guarantee true at the SDK-config layer with
 * defense-in-depth — no single option is load-bearing:
 *
 *   - belt:        `tools: []`           — the SDK's TRUE restrictive allowlist.
 *                                          Per the SDK type docs, `tools: []`
 *                                          disables ALL built-in tools. (Note:
 *                                          `allowedTools` is an AUTO-APPROVE
 *                                          list, NOT a restriction — see below.)
 *   - empty allow: `allowedTools: []`    — nothing is auto-approved.
 *   - suspenders:  `disallowedTools`     — explicit per-tool deny list.
 *   - braces:      `permissionMode`      — 'dontAsk' = deny unless pre-approved
 *                                          (nothing is pre-approved here).
 *   - backstop:    `canUseTool`          — denies EVERY invocation and writes an
 *                                          append-only audit entry.
 *   - isolation:   `cwd` jail + `mcpServers:{}` + `settingSources:[]` +
 *                  `strictMcpConfig` + `additionalDirectories:[]` — even with
 *                  tools disabled, these prevent settings/MCP inheritance and
 *                  filesystem escape hatches.
 *
 * The redundancy IS the security property: removing any one layer must not
 * re-open the gap. Verified against @anthropic-ai/claude-agent-sdk v0.2.141
 * (sdk.d.ts): `tools`, `allowedTools`, `disallowedTools`, `permissionMode`
 * ('dontAsk' = "Don't prompt for permissions, deny if not pre-approved"),
 * `canUseTool` (returns PermissionResult { behavior: 'deny', message }),
 * `additionalDirectories`, `mcpServers`, `settingSources`, `strictMcpConfig`
 * all exist on the `Options` type.
 */

import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { OBSERVER_SESSIONS_DIR } from '../shared/paths.js';
import { recordObserverToolAttempt } from '../utils/observer-audit.js';
import { logger } from '../utils/logger.js';

/**
 * Tools explicitly named in the deny-list. `tools: []` already disables all
 * built-ins; this list is the redundant "suspenders" layer and documents
 * intent for human reviewers.
 */
export const OBSERVER_DISALLOWED_TOOLS = [
  'Bash',           // Prevent infinite loops
  'Read',           // No file reading
  'Write',          // No file writing
  'Edit',           // No file editing
  'Grep',           // No code searching
  'Glob',           // No file pattern matching
  'WebFetch',       // No web fetching
  'WebSearch',      // No web searching
  'Task',           // No spawning sub-agents
  'NotebookEdit',   // No notebook editing
  'AskUserQuestion',// No asking questions
  'TodoWrite',
] as const;

export interface HardenedSdkOptionsInput {
  /** Which call site is constructing options — flows into audit entries. */
  source: 'Observer' | 'KnowledgeAgent';
  /** Identifiers carried into the audit log for post-incident correlation. */
  sessionDbId?: number;
  contentSessionId?: string;
  project?: string;

  // Pass-through fields the caller still owns:
  model: string;
  env: NodeJS.ProcessEnv;
  pathToClaudeCodeExecutable: string;
  /**
   * Custom system prompt (perf plan L4). When set, it REPLACES the default
   * claude_code preset with a focused, cached identity/format prefix — the
   * Observer needs no coding-agent preamble and this is where the "no tool
   * access" guarantee is now asserted. Omit to keep the SDK default (e.g. the
   * KnowledgeAgent, which carries its identity in the primed conversation).
   */
  systemPrompt?: string;
  /** Defaults to OBSERVER_SESSIONS_DIR. Never falls back to process.cwd(). */
  cwd?: string;
  abortController?: AbortController;
  resume?: string;
  /** SDK SpawnFactory — typed via the SDK's own Options field. */
  spawnClaudeCodeProcess?: Options['spawnClaudeCodeProcess'];
}

/**
 * Build the fully hardened `Options` object for an Observer/KnowledgeAgent
 * `query()` call. Both call sites MUST go through this helper so the lockdown
 * cannot drift between them.
 */
export function buildHardenedSdkOptions(input: HardenedSdkOptionsInput): Options {
  const canUseTool: Options['canUseTool'] = async (toolName, toolInput) => {
    recordObserverToolAttempt({
      source: input.source,
      sessionDbId: input.sessionDbId,
      contentSessionId: input.contentSessionId,
      project: input.project,
      tool_name: toolName,
      tool_input: toolInput,
      result: 'denied',
    });
    // Real-time visibility for the persistent audit trail. The append-only log
    // (recordObserverToolAttempt above) is the authoritative record; this WARN
    // surfaces the attempt in the live worker log for incident detection.
    logger.warn('SECURITY', `Blocked tool use by ${input.source}: ${toolName}`, {
      sessionId: input.sessionDbId,
      source: input.source,
      tool_name: toolName,
    });
    return {
      behavior: 'deny',
      message: `${input.source} is forbidden from tool use (keepmind hard lockdown).`,
    };
  };

  return {
    model: input.model,
    cwd: input.cwd ?? OBSERVER_SESSIONS_DIR,
    env: input.env,
    pathToClaudeCodeExecutable: input.pathToClaudeCodeExecutable,
    ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
    ...(input.abortController ? { abortController: input.abortController } : {}),
    ...(input.resume ? { resume: input.resume } : {}),
    ...(input.spawnClaudeCodeProcess ? { spawnClaudeCodeProcess: input.spawnClaudeCodeProcess } : {}),
    // Observer turns are mechanical reformatting, not reasoning: the prompt fully
    // specifies the output shape. Thinking on every compression turn buys nothing
    // and is billed on top of a conversation prefix that already grows per turn
    // (upstream 09391a74). Behavior-only — outside the tool-lockdown boundary.
    //
    // BOTH options are set, and `maxThinkingTokens` is the one that currently
    // acts. `thinkingConfig: { type: 'disabled' }` is what the SDK types
    // document ("takes precedence over the deprecated maxThinkingTokens"), but
    // Claude Code 2.1.234 does not honour it. Measured on the REAL observer
    // prompt pair (buildObserverSystemPrompt + buildStatelessObservationPrompt),
    // claude-haiku-4-5, two runs per variant:
    //
    //   thinkingConfig alone   2 assistant messages, 4,788 in, $0.0107
    //                          (one run of the four went to 3 messages after the
    //                          CLI appended "[Your previous response had no
    //                          visible output…]": 7,222 in, $0.0179)
    //   thinkingConfig removed 2 assistant messages, 4,788 in, $0.0093
    //   maxThinkingTokens: 0   1 assistant message,  2,364 in, $0.0050
    //
    // So every observation was paid for TWICE: a thinking-only message with no
    // text, then the answer. `maxThinkingTokens: 0` collapsed every run to one
    // message carrying the XML — on haiku-4-5, sonnet-5 and opus-5 alike. The
    // note that used to stand here, that Haiku has no adaptive thinking to
    // disable, was wrong: it has one, and it was using it. Keep both options —
    // they say the same thing, and the documented one takes over on its own once
    // the CLI honours it.
    //
    // The split turn is also a CORRECTNESS trap, which is why ClaudeProvider
    // defers an assistant message with no text instead of parsing it: an empty
    // response reads as "nothing worth recording" and closes the claimed batch
    // as `skipped` while the real answer is still in flight.
    //
    // Model interaction, verified against the model docs 2026-07-29: on the
    // thinking-capable models a user may select, disabling thinking makes the
    // model occasionally leak internal XML into the visible response, which
    // would reach the observation parser. buildObserverSystemPrompt therefore
    // forbids internal/system tags generically; do NOT name thinking tags there
    // and do NOT add a "don't reason" instruction — both measurably worsen the
    // leak. Disabling thinking is also rejected above effort `high` on Opus 5,
    // which is safe here only because keepmind never raises effort (the API
    // default is high) — the opus-5 run above returned normally.
    ...(input.source === 'Observer'
      ? { thinkingConfig: { type: 'disabled' as const }, maxThinkingTokens: 0 }
      : {}),

    // === Tool lockdown (defense-in-depth) ===
    tools: [],                                        // belt: disable ALL built-in tools
    allowedTools: [],                                 // nothing auto-approved
    disallowedTools: [...OBSERVER_DISALLOWED_TOOLS],  // suspenders: explicit deny
    permissionMode: 'dontAsk',                        // braces: deny unless pre-approved (nothing is)
    canUseTool,                                       // backstop: deny + audit every attempt

    // === Filesystem / settings / MCP isolation ===
    additionalDirectories: [],                        // no extra writable roots
    mcpServers: {},                                   // no MCP tool surface
    settingSources: [],                               // no ~/.claude settings inheritance
    strictMcpConfig: true,
  };
}
