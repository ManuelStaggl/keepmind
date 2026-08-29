
import { CHECKPOINT_BLOCK_END_MARKER, type CheckpointRecord } from '../../../shared/checkpoint.js';
import { relativeDayLabel } from '../formatters/AgentFormatter.js';

/**
 * Render the curated checkpoint(s) as a prominent block placed directly under
 * the header, ABOVE the timeline — so it survives the `KEEPMIND_SESSION_START_MAX_CHARS`
 * ceiling (which trims from the end) and reads as the session baton, not as one
 * observation among many. Newest project first (query order).
 *
 * Rendered verbatim: the body was authored and already redacted on write, and
 * the whole point is that the next session resumes from it without re-reading.
 */
export function renderCheckpoints(checkpoints: CheckpointRecord[]): string[] {
  if (!checkpoints || checkpoints.length === 0) return [];

  const output: string[] = [];

  for (const cp of checkpoints) {
    const day = (cp.created_at ?? '').slice(0, 10);
    const age = relativeDayLabel(day);
    const when = age ? `${day} · ${age}` : day;

    let focus: string | null = null;
    try {
      const meta = cp.metadata ? JSON.parse(cp.metadata) as Record<string, unknown> : null;
      if (meta && typeof meta.focus === 'string' && meta.focus.trim()) {
        focus = meta.focus.trim();
      }
    } catch {
      // metadata is best-effort display only — a malformed blob never blocks the block.
    }

    output.push(`# ⏳ CHECKPOINT — ${cp.project} (${when})`);
    output.push('Curated hand-off from the previous session. Resume from here before anything else.');
    if (focus) output.push(`_Focus: ${focus}_`);
    output.push('');
    if (cp.narrative && cp.narrative.trim()) {
      output.push(cp.narrative.trim());
      output.push('');
    }
    output.push('---');
    output.push('');
  }

  // S20: the boundary the character ceiling trims from. Emitted once, after
  // the LAST checkpoint — the hook spends the budget on everything to the
  // right of it, so the baton is served first instead of eaten first.
  output.push(CHECKPOINT_BLOCK_END_MARKER);
  output.push('');

  return output;
}
