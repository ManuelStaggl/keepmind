// IO discipline (see src/shared/hook-io.ts): this handler is PURE. It returns a
// HookResult and MUST NOT call process.stderr.write / process.stdout.write /
// console.* / process.exit. logger.* calls are DIAGNOSTIC; thrown errors are
// caught by hookCommand and routed through emitBlockingError.
import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { executeWithWorkerFallback, isWorkerFallback } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';
import { parseJsonArray } from '../../shared/timeline-formatting.js';
import { statSync } from 'fs';
import path from 'path';
import { shouldTrackProject } from '../../shared/should-track-project.js';
import { getProjectContext } from '../../utils/project-name.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { paths } from '../../shared/paths.js';

// These were hardcoded, which meant the per-Read injection could be neither
// tuned nor switched off: the only filter was mechanical (skip subagents, skip
// files under 1.5 KB, skip files newer than the newest observation) and whatever
// survived got the top 5 rows unconditionally — regardless of whether those rows
// had anything to do with the file. It fires on nearly every Read, so a weak row
// is not free.
//
// Now: an explicit enable switch, a real specificity threshold, and both limits
// configurable.
const FETCH_LOOKAHEAD_LIMIT = 40;
const MAX_FILE_CONTEXT_PATHS = 10;

interface FileContextConfig {
  enabled: boolean;
  minBytes: number;
  maxRows: number;
  minScore: number;
}

function readFileContextConfig(): FileContextConfig {
  const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
  const num = (value: unknown, fallback: number): number => {
    const parsed = parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const isOff = (value: unknown): boolean => String(value ?? '').toLowerCase() === 'false';
  return {
    enabled: !isOff(settings.KEEPMIND_ENABLED) && !isOff(settings.KEEPMIND_FILE_CONTEXT_ENABLED),
    minBytes: num(settings.KEEPMIND_FILE_CONTEXT_MIN_BYTES, 1_500),
    maxRows: Math.max(1, num(settings.KEEPMIND_FILE_CONTEXT_MAX_ROWS, 3)),
    minScore: num(settings.KEEPMIND_FILE_CONTEXT_MIN_SCORE, 2),
  };
}

const TYPE_ICONS: Record<string, string> = {
  decision: '\u2696\uFE0F',
  bugfix: '\uD83D\uDD34',
  feature: '\uD83D\uDFE3',
  refactor: '\uD83D\uDD04',
  discovery: '\uD83D\uDD35',
  change: '\u2705',
};

function compactTime(timeStr: string): string {
  return timeStr.toLowerCase().replace(' am', 'a').replace(' pm', 'p');
}

function formatTime(epoch: number): string {
  const date = new Date(epoch);
  return date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDate(epoch: number): string {
  const date = new Date(epoch);
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface ObservationRow {
  id: number;
  memory_session_id: string;
  title: string | null;
  type: string;
  created_at_epoch: number;
  files_read: string | null;
  files_modified: string | null;
}

function deduplicateObservations(
  observations: ObservationRow[],
  targetPath: string,
  displayLimit: number,
  minScore: number
): ObservationRow[] {
  const seenSessions = new Set<string>();
  const dedupedBySession: ObservationRow[] = [];
  for (const obs of observations) {
    const sessionKey = obs.memory_session_id ?? `no-session-${obs.id}`;
    if (!seenSessions.has(sessionKey)) {
      seenSessions.add(sessionKey);
      dedupedBySession.push(obs);
    }
  }

  const scored = dedupedBySession.map(obs => {
    const filesRead = parseJsonArray(obs.files_read);
    const filesModified = parseJsonArray(obs.files_modified);
    const totalFiles = filesRead.length + filesModified.length;
    const normalizedTarget = targetPath.replace(/\\/g, '/');
    const inModified = filesModified.some(f => f.replace(/\\/g, '/') === normalizedTarget);

    let specificityScore = 0;
    if (inModified) specificityScore += 2;
    if (totalFiles <= 3) specificityScore += 2;
    else if (totalFiles <= 8) specificityScore += 1;

    return { obs, specificityScore };
  });

  scored.sort((a, b) => b.specificityScore - a.specificityScore);

  // The threshold is the point of this function now. Previously every surviving
  // row was shown, so an observation that merely happened to touch this file
  // among twenty others was injected with the same weight as one that changed
  // it. Below minScore a row costs tokens on every Read and says nothing.
  return scored
    .filter(s => s.specificityScore >= minScore)
    .slice(0, displayLimit)
    .map(s => s.obs);
}

function formatFileTimeline(
  observations: ObservationRow[],
  filePath: string
): string {
  const safePath = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const byDay = new Map<string, ObservationRow[]>();
  for (const obs of observations) {
    const day = formatDate(obs.created_at_epoch);
    if (!byDay.has(day)) {
      byDay.set(day, []);
    }
    byDay.get(day)!.push(obs);
  }

  const sortedDays = Array.from(byDay.entries()).sort((a, b) => {
    const aEpoch = Math.min(...a[1].map(o => o.created_at_epoch));
    const bEpoch = Math.min(...b[1].map(o => o.created_at_epoch));
    return aEpoch - bEpoch;
  });

  const now = new Date();
  const currentDate = now.toLocaleDateString('en-CA'); 
  const currentTime = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).toLowerCase().replace(' ', '');
  const currentTimezone = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();

  // One compact meta line instead of four: this block is injected on EVERY
  // tracked Read, so trimming the fixed header ~60-80 tokens/read adds up to
  // thousands of tokens over a session (see perf plan T1). Keeps the two facts
  // that matter: the Read result below is complete (not truncated by us), and
  // the two follow-up affordances.
  const lines: string[] = [
    `Current: ${currentDate} ${currentTime} ${currentTimezone}`,
    `Prior observations for this file (the Read result below is complete). Detail: get_observations([IDs]) · structure: smart_outline("${safePath}").`,
  ];

  for (const [day, dayObservations] of sortedDays) {
    const chronological = [...dayObservations].sort((a, b) => a.created_at_epoch - b.created_at_epoch);
    lines.push(`### ${day}`);
    for (const obs of chronological) {
      const title = (obs.title || 'Untitled').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      const icon = TYPE_ICONS[obs.type] || '\u2753';
      const time = compactTime(formatTime(obs.created_at_epoch));
      lines.push(`${obs.id} ${time} ${icon} ${title}`);
    }
  }

  return lines.join('\n');
}

export const fileContextHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    // Subagents get a fresh context per run and rarely act on a file's history,
    // so the per-Read timeline is pure token cost there (upstream 7435435b).
    if (input.agentId) {
      logger.debug('HOOK', 'Subagent context, skipping file context', { agentId: input.agentId });
      return { continue: true, suppressOutput: true };
    }

    let config: FileContextConfig;
    try {
      config = readFileContextConfig();
    } catch (error) {
      logger.debug('HOOK', 'File context config read failed, using defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
      config = { enabled: true, minBytes: 1_500, maxRows: 3, minScore: 2 };
    }
    if (!config.enabled) {
      return { continue: true, suppressOutput: true };
    }

    const toolInput = input.toolInput as Record<string, unknown> | undefined;
    const filePaths = Array.isArray(toolInput?.filePaths)
      ? (toolInput.filePaths as unknown[]).filter((p): p is string => typeof p === 'string').slice(0, MAX_FILE_CONTEXT_PATHS)
      : [];
    const filePath = toolInput?.file_path as string | undefined;
    const candidatePaths = filePaths.length > 0 ? filePaths : (filePath ? [filePath] : []);

    if (candidatePaths.length === 0) {
      return { continue: true, suppressOutput: true };
    }

    if (input.cwd && !shouldTrackProject(input.cwd)) {
      logger.debug('HOOK', 'Project excluded from tracking, skipping file context', { cwd: input.cwd });
      return { continue: true, suppressOutput: true };
    }

    const timelineResults = await Promise.allSettled(
      candidatePaths.map(candidatePath => buildFileContextTimeline(input, candidatePath, config))
    );
    const timelines: string[] = [];

    timelineResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value) timelines.push(result.value);
        return;
      }
      logger.debug('HOOK', 'File context timeline lookup failed, skipping path', {
        filePath: candidatePaths[index],
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    });

    if (timelines.length === 0) {
      return { continue: true, suppressOutput: true };
    }

    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: timelines.join('\n\n---\n\n'),
        permissionDecision: 'allow',
      },
    };
  },
};

async function buildFileContextTimeline(
  input: NormalizedHookInput,
  filePath: string,
  config: FileContextConfig
): Promise<string | null> {
  let fileMtimeMs = 0;
  try {
    const statPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(input.cwd || process.cwd(), filePath);
    const stat = statSync(statPath);
    if (!stat.isFile() || stat.size < config.minBytes) {
      return null;
    }
    fileMtimeMs = stat.mtimeMs;
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    logger.debug('HOOK', 'File stat failed, proceeding with gate', { error: err instanceof Error ? err.message : String(err) });
  }

  const context = getProjectContext(input.cwd);
  const cwd = input.cwd || process.cwd();
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  const relativePath = path.relative(cwd, absolutePath).split(path.sep).join("/");

  // #2691 — PostToolUse stores whatever path form the observer recorded
  // (absolute tool-input path, or project-root-relative per the prompt). The
  // PreToolUse:Read query previously sent ONLY the cwd-relative form, so it
  // never matched absolute-path storage. Send both candidate forms (forward-
  // slashed, de-duped) as repeated `path` params so the key matches across
  // both events regardless of how the path was stored.
  const candidateQueryPaths = Array.from(new Set([
    absolutePath.split(path.sep).join("/"),
    relativePath,
  ].filter(Boolean)));
  const queryParams = new URLSearchParams();
  for (const candidate of candidateQueryPaths) {
    queryParams.append('path', candidate);
  }
  if (context.allProjects.length > 0) {
    queryParams.set('projects', context.allProjects.join(','));
  }
  queryParams.set('limit', String(FETCH_LOOKAHEAD_LIMIT));

  const result = await executeWithWorkerFallback<{ observations: ObservationRow[]; count: number }>(
    `/api/observations/by-file?${queryParams.toString()}`,
    'GET',
  );
  if (isWorkerFallback(result)) {
    return null;
  }
  if (!result || !Array.isArray((result as any).observations)) {
    logger.warn('HOOK', 'File context query returned malformed body, skipping', { filePath });
    return null;
  }
  const data = result;

  if (!data.observations || data.observations.length === 0) {
    return null;
  }

  if (fileMtimeMs > 0) {
    const newestObservationMs = Math.max(...data.observations.map(o => o.created_at_epoch));
    if (fileMtimeMs >= newestObservationMs) {
      logger.debug('HOOK', 'File modified since last observation, skipping context injection', {
        filePath: relativePath,
        fileMtimeMs,
        newestObservationMs,
      });
      return null;
    }
  }

  const dedupedObservations = deduplicateObservations(
    data.observations,
    relativePath,
    config.maxRows,
    config.minScore
  );
  if (dedupedObservations.length === 0) {
    logger.debug('HOOK', 'No observation cleared the specificity threshold, skipping injection', {
      filePath: relativePath,
      candidates: data.observations.length,
      minScore: config.minScore,
    });
    return null;
  }

  return formatFileTimeline(dedupedObservations, filePath);
}
