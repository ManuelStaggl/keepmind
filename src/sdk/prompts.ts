
import { logger } from '../utils/logger.js';
import type { ModeConfig } from '../services/domain/types.js';
import { redactOutbound, redactOutboundDeep, sensitivePathInPayload } from '../services/redaction/outbound.js';

export const SUMMARY_MODE_MARKER = 'MODE SWITCH: PROGRESS SUMMARY';

export interface Observation {
  id: number;
  tool_name: string;
  tool_input: string;
  tool_output: string;
  created_at_epoch: number;
  cwd?: string;
}

export interface SDKSession {
  id: number;
  memory_session_id: string | null;
  project: string;
  user_prompt: string;
  last_assistant_message?: string;
}

/**
 * The stable identity + output-format scaffold for an Observer session. It is
 * byte-identical across every turn of a session, so (perf plan L4) it now rides
 * in the SDK `systemPrompt` option instead of being re-injected into every user
 * turn. As a system prompt it is a cached, resume-independent prefix: the ~1k
 * identity/format tokens are paid once (and cached) rather than re-sent on each
 * init / continuation / observation turn. The security guarantee ("no tool
 * access") that hardened-options.ts documents is thereby asserted at the actual
 * SDK system-prompt layer, not merely in a user message.
 */
export function buildObserverSystemPrompt(mode: ModeConfig): string {
  return `${mode.prompts.system_identity}

${mode.prompts.observer_role}

${mode.prompts.spatial_awareness}

${mode.prompts.recording_focus}

${mode.prompts.skip_guidance}

${mode.prompts.output_format_header}

<observation>
  <type>[ ${mode.observation_types.map(t => t.id).join(' | ')} ]</type>
  <!--
    ${mode.prompts.type_guidance}
  -->
  <title>${mode.prompts.xml_title_placeholder}</title>
  <subtitle>${mode.prompts.xml_subtitle_placeholder}</subtitle>
  <facts>
    <fact>${mode.prompts.xml_fact_placeholder}</fact>
    <fact>${mode.prompts.xml_fact_placeholder}</fact>
    <fact>${mode.prompts.xml_fact_placeholder}</fact>
  </facts>
  <!--
    ${mode.prompts.field_guidance}
  -->
  <narrative>${mode.prompts.xml_narrative_placeholder}</narrative>
  <concepts>
    <concept>${mode.prompts.xml_concept_placeholder}</concept>
    <concept>${mode.prompts.xml_concept_placeholder}</concept>
  </concepts>
  <!--
    ${mode.prompts.concept_guidance}
  -->
</observation>

Do NOT emit <files_read> or <files_modified>. File paths, tool names and
timestamps are recorded from the hook payload directly — they are exact there
and would only be a lossy copy here. Any file element you emit is discarded.
${mode.prompts.format_examples}

${mode.prompts.footer}

Do not include internal or system XML tags in your response.`;
}

// The init/continuation user turns are now SLIM (perf plan L4): the identity +
// format scaffold lives in buildObserverSystemPrompt (SDK systemPrompt), so
// these carry only the per-turn signal — which primary-session request is being
// observed and the start/continue cue.
export function buildInitPrompt(project: string, sessionId: string, userPrompt: string, mode: ModeConfig): string {
  return `<observed_from_primary_session>
  <user_request>${redactOutbound(userPrompt)}</user_request>
  <requested_at>${new Date().toISOString().split('T')[0]}</requested_at>
</observed_from_primary_session>

${mode.prompts.header_memory_start}`;
}

// Per-field character budget for the <parameters> / <outcome> blocks in an
// observation prompt. Each field is allowed up to OBS_PROMPT_FIELD_MAX_CHARS;
// content past that is replaced with a head + tail slice plus an explicit
// <elided ...> marker so the observer model can see *that* truncation
// happened (and won't fabricate detail about the missing range).
//
// The old budget was 16k chars per field. With two fields per observation and
// up to 12 observations coalesced into one turn, a single turn could carry
// 384k chars (~96k tokens); the largest actually measured was 158k chars. That
// bought very little: an observation is two or three sentences, and what
// decides its content is the head of the tool result — the file path, the error
// message, the command header. The middle of a 16k-char blob was paid for on
// every turn and summarised by nothing.
//
// 2k per field is the default now. It is a budget, not a limit on what can be
// observed: the head/tail split keeps both ends, and the <elided> marker tells
// the model that it is looking at a fragment so it does not invent the middle.
// Raise it with KEEPMIND_OBS_FIELD_MAX_CHARS if a mode needs more.
//
// Head/tail ratio (60% / 30%) keeps the start of the field (where most
// tools put their canonical signal — file path, error message, command
// header) and the tail (where errors / final-line context typically sit)
// while dropping the middle. The 10% remainder is the elision marker.
export const OBS_PROMPT_FIELD_MAX_CHARS = 2_000;
const OBS_PROMPT_FIELD_HEAD_RATIO = 0.6;
const OBS_PROMPT_FIELD_TAIL_RATIO = 0.3;

/** Clamp a configured per-field budget into a range that cannot break the turn. */
export function clampFieldMaxChars(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return OBS_PROMPT_FIELD_MAX_CHARS;
  return Math.min(Math.max(raw, 200), 16_000);
}

function truncateObservationField(value: unknown, maxChars: number = OBS_PROMPT_FIELD_MAX_CHARS): string {
  // JSON.stringify returns undefined for undefined / functions / symbols;
  // fall back to empty string so the call sites (template literal output)
  // and the length check below stay well-defined.
  const raw = JSON.stringify(value, null, 2) ?? '';
  if (raw.length <= maxChars) return raw;
  const headChars = Math.max(0, Math.floor(maxChars * OBS_PROMPT_FIELD_HEAD_RATIO));
  const tailChars = Math.max(0, Math.floor(maxChars * OBS_PROMPT_FIELD_TAIL_RATIO));
  const head = raw.slice(0, headChars);
  const tail = tailChars > 0 ? raw.slice(-tailChars) : '';
  const elidedChars = Math.max(0, raw.length - head.length - tail.length);
  return `${head}\n... <elided chars="${elidedChars}" original_size_chars="${raw.length}" reason="oversize" /> ...\n${tail}`;
}

/**
 * One `<observed_from_primary_session>` block for a single tool use.
 *
 * This is the last point at which tool content is still structured data, and
 * the first point at which it is bound for the network — so it is where
 * redaction belongs. Everything variable in the block is either dropped (a
 * secret-bearing file), deep-redacted (parsed payloads) or string-redacted
 * (fallback raw text) before it is rendered.
 */
function buildObservedBlock(obs: Observation, maxChars: number = OBS_PROMPT_FIELD_MAX_CHARS): string {
  let toolInput: any;
  let toolOutput: any;

  try {
    toolInput = typeof obs.tool_input === 'string' ? JSON.parse(obs.tool_input) : obs.tool_input;
  } catch (error: unknown) {
    logger.debug('SDK', 'Tool input is plain string, using as-is', {
      toolName: obs.tool_name
    }, error instanceof Error ? error : new Error(String(error)));
    toolInput = obs.tool_input;
  }

  try {
    toolOutput = typeof obs.tool_output === 'string' ? JSON.parse(obs.tool_output) : obs.tool_output;
  } catch (error: unknown) {
    logger.debug('SDK', 'Tool output is plain string, using as-is', {
      toolName: obs.tool_name
    }, error instanceof Error ? error : new Error(String(error)));
    toolOutput = obs.tool_output;
  }

  const header = `<observed_from_primary_session>
  <what_happened>${redactOutbound(obs.tool_name)}</what_happened>
  <occurred_at>${new Date(obs.created_at_epoch).toISOString()}</occurred_at>${obs.cwd ? `\n  <working_directory>${redactOutbound(obs.cwd)}</working_directory>` : ''}`;

  // A .env dump or a PEM body is a secret in its entirety. Pattern redaction is
  // the wrong instrument there — one rule miss leaks the remainder — so the
  // payload never enters the prompt. The path stays: "the agent read .env" is
  // itself a worthwhile observation, and it is not sensitive.
  const sensitive = sensitivePathInPayload(toolInput);
  if (sensitive) {
    return `${header}
  <parameters>${JSON.stringify({ file_path: sensitive.filePath }, null, 2)}</parameters>
  <outcome>«withheld: ${sensitive.reason} — content not sent»</outcome>
</observed_from_primary_session>`;
  }

  return `${header}
  <parameters>${truncateObservationField(redactOutboundDeep(toolInput), maxChars)}</parameters>
  <outcome>${truncateObservationField(redactOutboundDeep(toolOutput), maxChars)}</outcome>
</observed_from_primary_session>`;
}

export function buildObservationPrompt(obs: Observation, maxChars?: number): string {
  return `${buildObservedBlock(obs, maxChars)}

If a <parameters> or <outcome> block above contains an "<elided chars=... />" marker, that field was truncated to fit the observer's context window. Describe only what you can see in the kept portion and do not infer details about the elided range.

Return either one or more <observation>...</observation> blocks, or an empty response if this tool use should be skipped.
Concrete debugging findings from logs, queue state, database rows, session routing, or code-path inspection count as durable discoveries and should be recorded.
Never reply with prose such as "Skipping", "No substantive tool executions", or any explanation outside XML. Non-XML text is discarded.`;
}

/**
 * Prompt for a BATCH of tool uses coalesced into one compression turn (perf plan
 * L1). A single-element batch delegates to buildObservationPrompt so the common
 * (non-batched) path stays byte-for-byte identical. For a real batch it presents
 * every tool use in order and asks for observations covering them.
 */
export function buildBatchedObservationPrompt(observations: Observation[], maxChars?: number): string {
  if (observations.length <= 1) {
    return buildObservationPrompt(observations[0], maxChars);
  }
  const blocks = observations.map(o => buildObservedBlock(o, maxChars)).join('\n\n');
  return `${blocks}

${observations.length} tool uses from the primary session are shown above, in chronological order.

If a <parameters> or <outcome> block above contains an "<elided chars=... />" marker, that field was truncated to fit the observer's context window. Describe only what you can see in the kept portion and do not infer details about the elided range.

Return one or more <observation>...</observation> blocks covering the tool uses above — merge closely related tool uses into a single observation where that reads better, and skip any that are not worth recording. Reply with an empty response only if NONE of them should be recorded.
Concrete debugging findings from logs, queue state, database rows, session routing, or code-path inspection count as durable discoveries and should be recorded.
Never reply with prose such as "Skipping", "No substantive tool executions", or any explanation outside XML. Non-XML text is discarded.`;
}

/**
 * The bounded stand-in for a conversation history.
 *
 * In the conversational path every observation was pushed as another user turn
 * into the SAME resumed SDK session, so each turn re-read everything before it.
 * Measured over 1,046 observer sessions that re-read was 91.7% of all tokens
 * billed — 1.21bn of 1.32bn — and within a single session it grew from 14k to
 * 50k cache-read tokens by turn 12. The information the observer actually needed
 * from that history is small and nearly constant: what the user asked for, and
 * roughly what has already been recorded so it does not repeat itself.
 *
 * This block supplies exactly that, at a fixed size. It is capped by count AND
 * by characters, so it cannot grow with session length — which is what
 * acceptance test 3 checks.
 */
const STATELESS_CONTEXT_MAX_TITLES = 8;
const STATELESS_CONTEXT_MAX_CHARS = 1_200;

export function buildStatelessContextBlock(
  userPrompt: string,
  recentTitles: string[]
): string {
  const request = redactOutbound(userPrompt).slice(0, 600);
  const lines: string[] = [
    '<session_context>',
    `  <user_request>${request}</user_request>`,
  ];
  const titles = recentTitles.slice(0, STATELESS_CONTEXT_MAX_TITLES);
  if (titles.length > 0) {
    lines.push('  <already_recorded>');
    let budget = STATELESS_CONTEXT_MAX_CHARS;
    for (const title of titles) {
      const clean = redactOutbound(title).replace(/[\r\n]+/g, ' ').trim().slice(0, 140);
      if (clean.length === 0) continue;
      if (clean.length > budget) break;
      budget -= clean.length;
      lines.push(`    <recorded>${clean}</recorded>`);
    }
    lines.push('  </already_recorded>');
  }
  lines.push('</session_context>');
  return lines.join('\n');
}

/**
 * A complete, self-contained compression prompt: no resumed conversation, no
 * accumulated prefix. Everything the model needs is here, and the size of this
 * prompt is a function of the batch alone — not of how long the session has run.
 */
export function buildStatelessObservationPrompt(
  observations: Observation[],
  context: { userPrompt: string; recentTitles: string[] },
  maxChars?: number
): string {
  return `${buildStatelessContextBlock(context.userPrompt, context.recentTitles)}

${buildBatchedObservationPrompt(observations, maxChars)}`;
}

export function buildSummaryPrompt(session: SDKSession, mode: ModeConfig): string {
  const lastAssistantMessage = session.last_assistant_message || (() => {
    logger.error('SDK', 'Missing last_assistant_message in session for summary prompt', {
      sessionId: session.id
    });
    return '';
  })();

  return `--- ${SUMMARY_MODE_MARKER} ---
⚠️ CRITICAL TAG REQUIREMENT — READ CAREFULLY:
• You MUST wrap your ENTIRE response in <summary>...</summary> tags.
• Do NOT use <observation> tags. <observation> output will be DISCARDED and cause a system error.
• The ONLY accepted root tag is <summary>. Any other root tag is a protocol violation.

${mode.prompts.header_summary_checkpoint}
${mode.prompts.summary_instruction}

${mode.prompts.summary_context_label}
${redactOutbound(lastAssistantMessage)}

${mode.prompts.summary_format_instruction}
<summary>
  <request>${mode.prompts.xml_summary_request_placeholder}</request>
  <investigated>${mode.prompts.xml_summary_investigated_placeholder}</investigated>
  <learned>${mode.prompts.xml_summary_learned_placeholder}</learned>
  <completed>${mode.prompts.xml_summary_completed_placeholder}</completed>
  <next_steps>${mode.prompts.xml_summary_next_steps_placeholder}</next_steps>
  <notes>${mode.prompts.xml_summary_notes_placeholder}</notes>
</summary>

REMINDER: Your response MUST use <summary> as the root tag, NOT <observation>.
${mode.prompts.summary_footer}`;
}

export function buildContinuationPrompt(userPrompt: string, promptNumber: number, contentSessionId: string, mode: ModeConfig): string {
  return `${mode.prompts.continuation_greeting}

<observed_from_primary_session>
  <user_request>${redactOutbound(userPrompt)}</user_request>
  <requested_at>${new Date().toISOString().split('T')[0]}</requested_at>
</observed_from_primary_session>

${mode.prompts.continuation_instruction}

${mode.prompts.header_memory_continued}`;
}
