// SPDX-License-Identifier: Apache-2.0
//
// The gate that decides whether a batch of tool uses is worth a model call.
//
// WHY THIS EXISTS
// ---------------
// The observer was asked to judge "is this worth recording?" — and the judging
// itself was the expensive part. Measured over one day: ~4.8k compression turns
// for ~3.4k tool uses, at least 65% of which came back with "nothing worth
// recording" while still paying for the full prompt. The decision was made in
// the most expensive place available.
//
// Almost all of those turns are decidable without a model. A Read that returned
// a file nobody changed, a status command that printed the expected thing, a
// navigation step — none of these can produce a durable memory, and none of them
// need Haiku to say so. Deciding here costs microseconds.
//
// CAPTURE PROFILES
// ----------------
// `full`       — record anything with any signal (closest to the old behaviour).
// `balanced`   — require a change, a failure, or a decision-shaped event.
// `governance` — additionally require portfolio-level significance: an
//                architectural decision, a migration, a release, a security
//                finding, or a problem that recurs. This is the profile for a
//                cross-project memory whose job is "what was decided and why",
//                not "what happened".
//
// The profile only ever REMOVES model calls. It never invents an observation,
// and anything it lets through is still judged by the model as before.

import { envValue } from '../../shared/legacy-env.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { paths } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';

export type CaptureProfile = 'full' | 'balanced' | 'governance';

export interface GateToolUse {
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
}

export interface GateDecision {
  compress: boolean;
  /** Machine-readable reason, for logs and for the cheap-idle test. */
  reason: string;
}

const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'ApplyPatch']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'Shell']);

/** Words that mark a failure in tool output, regardless of tool. */
const FAILURE_MARKERS = /\b(error|exception|failed|failure|traceback|panic|fatal|cannot|denied|refused|timed? out|not found)\b/i;

/**
 * Shell commands that change or decide something, as opposed to inspecting it.
 * Deliberately narrow: a false negative costs one unrecorded observation, a
 * false positive costs a model call on every `git status`.
 */
const DECISIVE_COMMAND = /\b(git\s+(commit|merge|rebase|revert|tag|push|cherry-pick)|npm\s+(publish|version)|yarn\s+publish|pnpm\s+publish|docker\s+(build|push)|terraform\s+(apply|destroy)|kubectl\s+(apply|delete)|alembic|flyway|liquibase|prisma\s+migrate|dotnet\s+ef\s+database|rails\s+db:migrate|systemctl\s+(start|stop|restart|enable|disable)|Set-Service|Restart-Service)\b/i;

/**
 * Paths whose modification is architectural rather than incidental — the
 * governance profile treats a change here as portfolio-relevant.
 */
const GOVERNANCE_PATHS = /(^|[\\/])(CLAUDE\.md|AGENTS\.md|README\.md|SECURITY\.md|ARCHITECTURE\.md|ADR[-_]|docs?[\\/]adr|package\.json|tsconfig\.json|Cargo\.toml|go\.mod|pyproject\.toml|requirements\.txt|Dockerfile|docker-compose\.ya?ml|\.github[\\/]workflows[\\/]|terraform[\\/]|migrations?[\\/]|schema\.(sql|prisma)|\.env\.example)/i;

/**
 * Text that marks a decision or a recurring problem in a user request.
 *
 * Bilingual on purpose. The observer runs against whatever language the user
 * actually types, and an English-only matcher silently downgrades every German
 * request to "not portfolio relevant" — the same failure mode the embedder had
 * before it was made multilingual (see CLAUDE.md: German queries degraded to
 * keyword-only hits). A missed match here costs a lost decision record, which is
 * exactly the thing this profile exists to keep.
 */
const GOVERNANCE_TEXT = new RegExp(
  '\\b(' + [
    // English
    'decide', 'decision', 'architect\\w*', 'migrat\\w*', 'deprecat\\w*',
    'standard\\w*', 'convention', 'policy', 'rollout', 'release',
    'breaking change', 'trade-?off', 'rationale', 'because we', 'instead of',
    'regression', 'recurring', 'keeps happening', 'security', 'vulnerab\\w*', 'CVE',
    // German
    'entscheid\\w*', 'begründ\\w*', 'begruend\\w*', 'architektur\\w*',
    'migration\\w*', 'migrier\\w*', 'umstell\\w*', 'umbau\\w*',
    'standardisier\\w*', 'konvention\\w*', 'richtlinie\\w*', 'vorgabe\\w*',
    'auslieferung', 'veröffentlich\\w*', 'veroeffentlich\\w*',
    'abwägung', 'abwaegung', 'stattdessen', 'weil wir',
    'wiederkehrend\\w*', 'erneut aufgetreten', 'sicherheit\\w*', 'schwachstelle\\w*',
    'zielarchitektur', 'grundsatz\\w*',
  ].join('|') + ')\\b',
  'i'
);

function readProfile(): CaptureProfile {
  const explicit = (envValue('KEEPMIND_CAPTURE_PROFILE') || readFromSettings('KEEPMIND_CAPTURE_PROFILE'))?.toLowerCase();
  if (explicit === 'full' || explicit === 'balanced' || explicit === 'governance') return explicit;
  return defaultProfileForMode();
}

/**
 * The governance heuristics below are calibrated on software development: they
 * look for commits, migrations, CI config and architecture files. Applied to a
 * mode that observes something else entirely — `law-study`, `meme-tokens`,
 * `email-investigation` — none of those signals can ever fire, and the profile
 * would silently suppress nearly everything that mode exists to record.
 *
 * So governance is the default only where its signals mean something. Any other
 * mode falls back to `balanced`, which still removes the idle turns without
 * claiming to know what matters in a domain it was not written for. An explicit
 * KEEPMIND_CAPTURE_PROFILE always wins.
 */
function defaultProfileForMode(): CaptureProfile {
  const mode = (readFromSettings('KEEPMIND_MODE') || 'code').toLowerCase();
  // 'code', plus its language overlays ('code--de', 'code--ja', …).
  return mode === 'code' || mode.startsWith('code-') ? 'governance' : 'balanced';
}

function readFromSettings(key: 'KEEPMIND_CAPTURE_PROFILE' | 'KEEPMIND_MODE'): string | undefined {
  try {
    const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
    const value = settings[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function asText(value: unknown, limit = 4_000): string {
  if (typeof value === 'string') return value.slice(0, limit);
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value).slice(0, limit);
  } catch {
    return '';
  }
}

/**
 * The tool input as a record, whether it arrives as one or as JSON text.
 *
 * It arrives as TEXT in production: the ingest route queues
 * `stripMemoryTagsFromJson(JSON.stringify(payload.toolInput))`
 * (`http/shared.ts`), so everything the gate is handed carries `tool_input` as a
 * string. Reading it as an object only — the previous behaviour — made
 * `commandOf` and `pathsOf` return the empty string for EVERY live tool use, so
 * `decisiveCommand` and `governancePath` were false for every batch that has
 * ever reached this function. Nothing failed and nothing was logged: the
 * remaining signals (a write tool by NAME, a failure word in the output, output
 * length) still fired, so the gate went on answering, just never for the two
 * reasons it was written for. Measured live afterwards on the running worker:
 * `git tag --list` — a command DECISIVE_COMMAND matches — was dropped as
 * `read_only`, while the same batch built by hand in a test compressed.
 *
 * That is also why the tests could not catch it. They pass objects, which is the
 * shape the type allows and the production path never sends;
 * `gate-json-tool-input.test.ts` now asserts both shapes decide alike.
 */
function inputRecord(toolInput: unknown): Record<string, unknown> | null {
  if (!toolInput) return null;
  if (typeof toolInput === 'string') {
    try {
      const parsed = JSON.parse(toolInput);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return typeof toolInput === 'object' ? toolInput as Record<string, unknown> : null;
}

function pathsOf(toolInput: unknown): string {
  const record = inputRecord(toolInput);
  if (!record) return '';
  const parts: string[] = [];
  for (const key of ['file_path', 'filePath', 'path', 'notebook_path']) {
    if (typeof record[key] === 'string') parts.push(record[key] as string);
  }
  if (Array.isArray(record.filePaths)) {
    for (const p of record.filePaths) if (typeof p === 'string') parts.push(p);
  }
  return parts.join(' ');
}

function commandOf(toolInput: unknown): string {
  const record = inputRecord(toolInput);
  if (!record) return '';
  const cmd = record.command ?? record.script;
  return typeof cmd === 'string' ? cmd : '';
}

/** Signals present in a single tool use, computed without a model. */
interface Signals {
  changedFiles: boolean;
  failed: boolean;
  decisiveCommand: boolean;
  governancePath: boolean;
  substantialOutput: boolean;
}

function signalsFor(use: GateToolUse): Signals {
  const tool = use.tool_name ?? '';
  const output = asText(use.tool_response);
  const command = commandOf(use.tool_input);
  const filePaths = pathsOf(use.tool_input);

  return {
    changedFiles: WRITE_TOOLS.has(tool),
    // A failure in the shell is a finding; a failure word inside a file someone
    // merely read is just the file's content.
    failed: SHELL_TOOLS.has(tool) && FAILURE_MARKERS.test(output),
    decisiveCommand: SHELL_TOOLS.has(tool) && DECISIVE_COMMAND.test(command),
    governancePath: GOVERNANCE_PATHS.test(filePaths),
    substantialOutput: output.length >= 200,
  };
}

/**
 * Decide whether this batch reaches the model.
 *
 * `userPrompt` participates: an explicit request to decide, migrate or
 * standardise something makes the whole batch governance-relevant even when the
 * individual tool uses look mechanical — that is exactly the case where the
 * rationale is worth keeping.
 */
export function shouldCompressBatch(
  batch: GateToolUse[],
  context: { userPrompt?: string; profile?: CaptureProfile } = {}
): GateDecision {
  const profile = context.profile ?? readProfile();
  if (batch.length === 0) return { compress: false, reason: 'empty_batch' };

  const signals = batch.map(signalsFor);
  const any = (pick: (s: Signals) => boolean) => signals.some(pick);

  const changed = any(s => s.changedFiles);
  const failed = any(s => s.failed);
  const decisive = any(s => s.decisiveCommand);
  const governancePath = any(s => s.governancePath);
  const substantial = any(s => s.substantialOutput);

  // Nothing happened that could become a durable memory, in ANY profile: no
  // change, no failure, no decisive command, and nothing of substance returned.
  if (!changed && !failed && !decisive && !substantial) {
    return { compress: false, reason: 'no_signal' };
  }

  if (profile === 'full') {
    return { compress: true, reason: 'profile_full' };
  }

  if (profile === 'balanced') {
    if (changed || failed || decisive) return { compress: true, reason: 'change_or_failure' };
    return { compress: false, reason: 'read_only' };
  }

  // governance
  const promptIsGovernance = !!context.userPrompt && GOVERNANCE_TEXT.test(context.userPrompt);
  if (decisive) return { compress: true, reason: 'decisive_command' };
  if (governancePath && changed) return { compress: true, reason: 'governance_path_changed' };
  if (promptIsGovernance && (changed || failed)) return { compress: true, reason: 'governance_request' };
  if (failed && decisive) return { compress: true, reason: 'failed_decisive' };
  return { compress: false, reason: 'not_portfolio_relevant' };
}

/** Log helper so the skipped-vs-compressed ratio stays visible in the worker log. */
export function logGateDecision(sessionDbId: number, batchSize: number, decision: GateDecision): void {
  if (decision.compress) return;
  logger.debug('SDK', 'Batch skipped without a model call', {
    sessionId: sessionDbId,
    batchSize,
    reason: decision.reason,
  });
}

export { readProfile as readCaptureProfile };
