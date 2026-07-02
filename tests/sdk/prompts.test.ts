import { describe, expect, it } from 'bun:test';

import { buildObservationPrompt, buildBatchedObservationPrompt } from '../../src/sdk/prompts.js';

describe('buildObservationPrompt', () => {
  it('instructs the observer to avoid prose skip responses', () => {
    const prompt = buildObservationPrompt({
      id: 1,
      tool_name: 'exec_command',
      tool_input: JSON.stringify({ cmd: 'pwd' }),
      tool_output: JSON.stringify({ output: '/repo' }),
      created_at_epoch: Date.now(),
      cwd: '/repo',
    });

    expect(prompt).toContain('Return either one or more <observation>...</observation> blocks, or an empty response');
    expect(prompt).toContain('Concrete debugging findings from logs, queue state, database rows, session routing, or code-path inspection');
    expect(prompt).toContain('Never reply with prose such as "Skipping", "No substantive tool executions"');
  });
});

describe('buildBatchedObservationPrompt (L1 batching)', () => {
  const one = {
    id: 1,
    tool_name: 'exec_command',
    tool_input: JSON.stringify({ cmd: 'pwd' }),
    tool_output: JSON.stringify({ output: '/repo' }),
    created_at_epoch: 1_700_000_000_000,
    cwd: '/repo',
  };

  it('is byte-identical to buildObservationPrompt for a single-element batch (default path unchanged)', () => {
    expect(buildBatchedObservationPrompt([one])).toBe(buildObservationPrompt(one));
  });

  it('emits one observed block per tool use and a covering instruction for a real batch', () => {
    const two = { ...one, tool_name: 'Read', tool_input: JSON.stringify({ file: 'a.ts' }) };
    const prompt = buildBatchedObservationPrompt([one, two]);
    // Both tool uses present.
    expect(prompt).toContain('<what_happened>exec_command</what_happened>');
    expect(prompt).toContain('<what_happened>Read</what_happened>');
    // Two observed blocks.
    expect(prompt.match(/<observed_from_primary_session>/g)?.length).toBe(2);
    // Batch-aware instruction.
    expect(prompt).toContain('2 tool uses from the primary session are shown above');
    expect(prompt).toContain('one or more <observation>');
  });
});

describe('buildObservationPrompt oversized field truncation (#2468)', () => {
  it('truncates an oversized outcome field with an elided marker, keeping head and tail', () => {
    const huge = 'HEAD_SENTINEL' + 'A'.repeat(60_000) + 'TAIL_SENTINEL';
    const prompt = buildObservationPrompt({
      id: 1,
      tool_name: 'Read',
      tool_input: JSON.stringify({ file: 'big.txt' }),
      tool_output: JSON.stringify({ content: huge }),
      created_at_epoch: Date.now(),
      cwd: '/repo',
    });

    expect(prompt).toContain('<elided');
    expect(prompt).toContain('reason="oversize"');
    // head and tail of the raw value are preserved
    expect(prompt).toContain('HEAD_SENTINEL');
    expect(prompt).toContain('TAIL_SENTINEL');
    // the oversized field is actually shrunk well below its raw 60k size
    expect(prompt.length).toBeLessThan(40_000);
  });

  it('leaves a small field untouched (no elided marker)', () => {
    const prompt = buildObservationPrompt({
      id: 2,
      tool_name: 'exec_command',
      tool_input: JSON.stringify({ cmd: 'pwd' }),
      tool_output: JSON.stringify({ output: '/repo' }),
      created_at_epoch: Date.now(),
      cwd: '/repo',
    });

    // The prompt always carries a static "<elided chars=... />" instruction line,
    // so assert on the actual truncation marker (reason="oversize") instead.
    expect(prompt).not.toContain('reason="oversize"');
  });
});
