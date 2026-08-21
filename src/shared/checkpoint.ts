
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
