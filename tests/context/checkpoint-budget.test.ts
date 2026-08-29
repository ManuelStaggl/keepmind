// S20 — the checkpoint must not be cut mid-sentence.
//
// Measured 29.08.2026, project `Projekte`: preamble 681 chars, checkpoint
// 12,055, whole block 17,743, budget 4,500. `slice(0, max)` from the front ate
// the checkpoint first: it stopped about a third of the way in, mid-list, and
// everything after it — the rest of the baton AND the entire observation list —
// was gone with one "… (trimmed by …)" line to show for it.
//
// Acceptance from the finding: "Ein Checkpoint über 4.500 Zeichen erscheint beim
// Sitzungsstart vollständig; wird gekürzt, trifft es die Observations, und der
// Hinweis benennt den Nachladeweg."

import { describe, it, expect } from '../bun-test-shim.js';
import { capInjectedContext } from '../../src/cli/handlers/context.js';
import { CHECKPOINT_BLOCK_END_MARKER } from '../../src/shared/checkpoint.js';

const CHECKPOINT_BODY = Array.from(
  { length: 200 },
  (_, i) => `checkpoint line ${i} — a decision, its reason, and an open item`,
).join('\n');

function block(checkpoint: string, timeline: string): string {
  return `# [keepmind] recent context\n\n${checkpoint}\n${CHECKPOINT_BLOCK_END_MARKER}\n${timeline}`;
}

const TIMELINE = Array.from({ length: 400 }, (_, i) => `1234 9:0${i % 10}a ● observation ${i}`).join('\n');

describe('S20 — the checkpoint gets its own budget', () => {
  it('a 12k checkpoint survives a 4.5k budget intact', () => {
    const text = block(CHECKPOINT_BODY, TIMELINE);
    expect(CHECKPOINT_BODY.length).toBeGreaterThan(4_500);

    const capped = capInjectedContext(text, 4_500);

    // Every line of the baton is still there, in order.
    for (const line of CHECKPOINT_BODY.split('\n')) {
      expect(capped).toContain(line);
    }
  });

  it('the trimming hits the timeline, not the baton', () => {
    const capped = capInjectedContext(block(CHECKPOINT_BODY, TIMELINE), 4_500);

    expect(capped).toContain('checkpoint line 199');
    expect(capped).not.toContain('observation 399');
  });

  it('when the budget is spent on the baton, the omission is named with a way back', () => {
    const capped = capInjectedContext(block(CHECKPOINT_BODY, TIMELINE), 4_500);

    expect(capped).toContain('session_start_context');
    expect(capped).toContain('full:true');
  });

  it('a runaway checkpoint IS trimmed, and says what is missing', () => {
    const huge = Array.from({ length: 5_000 }, (_, i) => `line ${i}`).join('\n');
    const capped = capInjectedContext(block(huge, TIMELINE), 4_500, 6_000);

    expect(capped.length).toBeLessThanOrEqual(6_000);
    expect(capped).toContain('checkpoint trimmed');
    expect(capped).toContain('session_start_context');
  });

  it('a block with no checkpoint trims exactly as before', () => {
    const capped = capInjectedContext(TIMELINE, 1_000);

    expect(capped.length).toBeLessThanOrEqual(1_000);
    expect(capped).toContain('trimmed by KEEPMIND_SESSION_START_MAX_CHARS');
    expect(capped).toContain('observation 0');
  });

  it('a block that fits is returned untouched', () => {
    const text = block('short baton', 'short timeline');
    expect(capInjectedContext(text, 100_000)).toBe(text);
  });

  it('a checkpoint that fits inside the budget still leaves room for timeline', () => {
    const small = 'baton line one\nbaton line two';
    const capped = capInjectedContext(block(small, TIMELINE), 4_500);

    expect(capped).toContain('baton line two');
    expect(capped).toContain('observation 0');
    expect(capped.length).toBeLessThanOrEqual(4_500);
  });
});
