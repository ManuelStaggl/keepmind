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
// measure. So: no threshold, no verdict, a short list and the word
// "candidates". That "no threshold" was originally an assertion; it is now
// three measurements, in `decision-candidates.ts`. One of them killed a
// threshold that had already been drafted.
//
// What the candidates ARE is therefore load-bearing, because the reader is the
// only filter there is. They show what each record says, in its own words.
//
// Only records that still apply are offered. A superseded one answering a live
// question is worse than no answer at all.

import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { executeWithWorkerFallback, isWorkerFallback } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';
import { getProjectContext } from '../../utils/project-name.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { paths } from '../../shared/paths.js';
import {
  toCandidates, type CandidateRow, type DecisionCandidate,
} from '../../services/curated/decision-candidates.js';

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

// `usable` and the reasoning behind its three exclusions moved to
// `decision-candidates.ts`, together with the finding extraction and the
// measurements that say why there is no relevance threshold. Re-exported so
// the handler's own tests keep their entry point.
export { usable } from '../../services/curated/decision-candidates.js';

/**
 * Render the candidates so a READER can tell a real one from a false one.
 *
 * This shows what each record SAYS, not what it is filed under. The previous
 * rendering showed the title and the SUBTITLE, and a record's subtitle is its
 * header line (`Stand: gilt · 11.08.2026 · Manuel`) — metadata about the
 * decision rather than the decision. So a false candidate looked exactly like
 * a real one, and the reader had to open the file to find out which it was.
 *
 * The reader IS the filter, and not by preference: three measurements say
 * these candidates cannot be filtered by similarity with the embedder this
 * store runs on. They are written out in `decision-candidates.ts` — read them
 * before adding a threshold here.
 */
function render(question: string, candidates: DecisionCandidate[]): string {
  const lines: string[] = [];
  lines.push(`[keepmind] Before asking: "${question.slice(0, 120)}"`);
  lines.push('');
  lines.push('Candidate decisions that may already cover this. They are candidates —');
  lines.push('nothing here claims the question is settled, and their absence would not');
  lines.push('mean it is open. Judge them by what they say:');
  lines.push('');
  for (const candidate of candidates) {
    lines.push(`  ${candidate.title}`);
    if (candidate.finding) lines.push(`      ${candidate.finding}`);
    if (candidate.sourcePath) lines.push(`      ${candidate.sourcePath}:${candidate.sourceLine ?? 1}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
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
      // `sourceKind=curated` so the result cap is spent on rows that can
      // answer. Measured: no difference on the corpus this runs against, where
      // the curated project holds nothing else — which is exactly why it is
      // passed rather than relied on. `usable` discards the rest either way,
      // and a cap filled with rows about to be discarded is the failure
      // `filterObservationIdsBySourceKind` exists to prevent one layer down.
      const url = `/api/search?query=${encodeURIComponent(question)}&project=${encodeURIComponent(project)}&sourceKind=curated&limit=${config.maxRows * 4}&format=json`;
      const result = await executeWithWorkerFallback<{ observations?: CandidateRow[] }>(url, 'GET');
      if (isWorkerFallback(result)) continue;

      const candidates = toCandidates(result?.observations ?? [], config.maxRows);
      if (candidates.length > 0) blocks.push(render(question, candidates));
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
