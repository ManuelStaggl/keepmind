// IO discipline (see src/shared/hook-io.ts): this handler is PURE. It returns a
// HookResult and MUST NOT call process.stderr.write / process.stdout.write /
// console.* / process.exit.
//
// Before a question reaches a person, check whether it has already been
// answered.
//
// WHY THIS MOMENT AND NOT ANOTHER. Deciding the same thing twice is the most
// expensive single failure this system has — it costs a person's judgement, and
// the second answer is not guaranteed to match the first. It is also the moment
// that is technically detectable: a question being put to a human is a tool
// call, so there is exactly one place to stand. Injecting the same hint on
// every prompt would be noise; here the candidate set is small and the timing
// is exact.
//
// WHAT IT MAY AND MAY NOT SAY. It offers candidates. It never says "this was
// already decided", and it never says "there is no decision on this" — the
// second sentence may only come from the relation graph, never from a distance
// measure, because real hits and false hits sit 0.001 apart in similarity.
// So: no threshold, no verdict, a short list and the word "candidates".
//
// Only records that still apply are offered. A superseded one answering a live
// question is worse than no answer at all.

import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { executeWithWorkerFallback, isWorkerFallback } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';
import { getProjectContext } from '../../utils/project-name.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { paths } from '../../shared/paths.js';

/** Tool names that put a question to a person. */
const ASK_TOOLS = new Set(['AskUserQuestion']);

interface DecisionCheckConfig {
  enabled: boolean;
  maxRows: number;
  /** Project holding the curated decisions. Empty = the current project. */
  curatedProject: string;
}

function readConfig(): DecisionCheckConfig {
  const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
  const isOff = (value: unknown): boolean => String(value ?? '').toLowerCase() === 'false';
  const parsed = parseInt(String(settings.KEEPMIND_DECISION_CHECK_MAX_ROWS ?? ''), 10);
  return {
    enabled: !isOff(settings.KEEPMIND_ENABLED) && !isOff(settings.KEEPMIND_DECISION_CHECK_ENABLED),
    maxRows: Number.isFinite(parsed) && parsed > 0 ? parsed : 3,
    curatedProject: String(settings.KEEPMIND_CURATED_PROJECT ?? '').trim(),
  };
}

/**
 * Pull the question text out of the tool input.
 *
 * Shape-tolerant on purpose: the handler must not become the reason a question
 * cannot be asked. Anything unrecognised yields no text, and no text means the
 * hook stays silent.
 */
export function questionsFrom(toolInput: unknown): string[] {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const input = toolInput as Record<string, unknown>;

  const out: string[] = [];
  const questions = input.questions;
  if (Array.isArray(questions)) {
    for (const entry of questions) {
      if (entry && typeof entry === 'object') {
        const question = (entry as Record<string, unknown>).question;
        if (typeof question === 'string' && question.trim()) out.push(question.trim());
      }
    }
  }
  if (typeof input.question === 'string' && input.question.trim()) out.push(input.question.trim());

  return out;
}

interface CandidateRow {
  title?: string;
  subtitle?: string;
  type?: string;
  source_path?: string;
  source_line?: number;
  source_kind?: string;
  valid_to?: number | null;
}

/**
 * Curated DECISIONS only, and only the ones that still apply.
 *
 * Three exclusions, each for its own reason:
 *
 * Observed rows, though they are the bulk of the store: the question is "did we
 * already DECIDE this", and an observation records what happened, not what was
 * resolved. Mixing them buries the one kind of row that can answer.
 *
 * Work items, though they are curated too. A work item is the thing a decision
 * is carried out in — offering one as an answer to "has this been decided" is
 * answering with the task instead of the ruling. Observed in the first run:
 * three of six candidates were work items, one of them already closed.
 *
 * Retired records, because a superseded decision answering a live question is
 * worse than no answer at all.
 */
export function usable(row: CandidateRow): boolean {
  return row.source_kind === 'curated'
    && row.type === 'decision'
    && (row.valid_to === null || row.valid_to === undefined);
}

function render(question: string, rows: CandidateRow[]): string {
  const lines: string[] = [];
  lines.push(`[keepmind] Before asking: "${question.slice(0, 120)}"`);
  lines.push('');
  lines.push('Candidate decisions that may already cover this. They are candidates —');
  lines.push('nothing here claims the question is settled, and their absence would not');
  lines.push('mean it is open.');
  lines.push('');
  for (const row of rows) {
    lines.push(`  ${row.title ?? '(untitled)'}`);
    if (row.subtitle) lines.push(`      ${row.subtitle}`);
    if (row.source_path) lines.push(`      ${row.source_path}:${row.source_line ?? 1}`);
  }
  return lines.join('\n');
}

async function checkDecisions(input: NormalizedHookInput): Promise<HookResult> {
  const silent: HookResult = { continue: true, suppressOutput: true };

  if (!input.toolName || !ASK_TOOLS.has(input.toolName)) return silent;

  const config = readConfig();
  if (!config.enabled) return silent;

  const questions = questionsFrom(input.toolInput);
  if (questions.length === 0) return silent;

  // Decisions live in ONE project by construction — the curated corpus is a
  // portfolio, not a per-repository thing. Searching the project of whatever
  // repository happens to be open finds nothing, silently, which is how this
  // first ran: a real question against a store holding the answer returned
  // empty because it looked in the wrong project.
  const project = config.curatedProject || getProjectContext(input.cwd).primary;

  const blocks: string[] = [];
  for (const question of questions) {
    try {
      const url = `/api/search?query=${encodeURIComponent(question)}&project=${encodeURIComponent(project)}&limit=${config.maxRows * 4}&format=json`;
      const result = await executeWithWorkerFallback<{ observations?: CandidateRow[] }>(url, 'GET');
      if (isWorkerFallback(result)) continue;

      const rows = (result?.observations ?? []).filter(usable).slice(0, config.maxRows);
      if (rows.length > 0) blocks.push(render(question, rows));
    } catch (error) {
      // A question must never fail to be asked because this lookup broke.
      logger.debug('HOOK', 'decision-check lookup failed', {}, error instanceof Error ? error : undefined);
    }
  }

  if (blocks.length === 0) return silent;

  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: blocks.join('\n\n---\n\n'),
      // Always allow. This hook informs; it does not gate. A memory system that
      // can block a question is a memory system that can stop the work.
      permissionDecision: 'allow',
    },
  };
}

export const decisionCheckHandler: EventHandler = { execute: checkDecisions };
