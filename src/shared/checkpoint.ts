
/**
 * A curated session checkpoint — the "state baton" a session writes with the
 * `/checkpoint` command and the next session reads at the very top of its
 * injected context.
 *
 * A checkpoint is stored as an ordinary observation carrying this reserved
 * `type`, which buys three things for free and keeps the write path honest:
 *   - it inherits the exact same secret redaction, content hashing and
 *     bi-temporal validity window (`valid_to IS NULL` = active) as every other
 *     observation — no second write path to keep in step;
 *   - the reserved type is never part of a mode's `observation_types`, so it
 *     never leaks into the normal timeline (it is rendered in its own prominent
 *     block instead of as one row among many);
 *   - "exactly one active checkpoint per project" is expressible as: insert the
 *     new row, then close the validity window of every OTHER active checkpoint
 *     for that project.
 */
export const CHECKPOINT_TYPE = 'session-checkpoint';

/**
 * S20. The boundary between "the baton" and "the timeline" inside the injected
 * block, so the character ceiling can be spent from the RIGHT end.
 *
 * The ceiling is applied hook-side, on one flat string, where the structure is
 * gone: `slice(0, max)` back to the last newline. The checkpoint sits at the
 * top, so it was the FIRST thing eaten. Measured 29.08.2026, project
 * `Projekte`: preamble 681 chars, checkpoint 12,055, whole block 17,743, budget
 * 4,500 — the checkpoint stopped about a third of the way in, mid-list, and
 * everything after it (the rest of the baton AND the entire observation list)
 * was gone. A hand-off that is silently halved is worse than none, because it
 * looks complete.
 *
 * An HTML comment rather than a sentinel word: it is invisible wherever the
 * block is rendered as markdown, it cannot collide with prose, and a reader who
 * does see it can tell what it is for.
 */
export const CHECKPOINT_BLOCK_END_MARKER = '<!-- keepmind:checkpoint-end -->';

/**
 * How far the checkpoint may outgrow `KEEPMIND_SESSION_START_MAX_CHARS` before
 * it is trimmed itself. Not "never trim": an unbounded block would let one
 * pathological checkpoint fill a session's context. Four is chosen so the
 * measured 12,055-character case fits under the 4,500 default with room to
 * spare, and is overridable with KEEPMIND_CHECKPOINT_MAX_CHARS.
 */
export const CHECKPOINT_BUDGET_MULTIPLIER = 4;

/** Named here so the trim notice and the docs cannot drift apart. */
export const CHECKPOINT_RELOAD_HINT =
  'load the rest with session_start_context(project, full:true) before doing anything else';

/** Currently-active checkpoint row, as read back for injection. */
export interface CheckpointRecord {
  id: number;
  project: string;
  title: string | null;
  narrative: string | null;
  metadata: string | null;
  created_at: string;
  created_at_epoch: number;
}

/**
 * A readable fallback title when the caller supplied none: the first non-empty
 * line of the body, stripped of leading markdown heading/emphasis marks and
 * capped. Never throws — a checkpoint always gets a title.
 */
export function deriveCheckpointTitle(text: string): string {
  const firstLine = text
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0) ?? 'Session checkpoint';
  const cleaned = firstLine.replace(/^#+\s*/, '').replace(/^\*+\s*/, '').replace(/\*+$/, '').trim();
  if (!cleaned) return 'Session checkpoint';
  return cleaned.length > 80 ? `${cleaned.slice(0, 80).trimEnd()}…` : cleaned;
}
