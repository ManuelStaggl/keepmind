import { describe, expect, it } from 'bun:test';

import {
  buildObservationPrompt,
  buildBatchedObservationPrompt,
  buildObserverSystemPrompt,
  buildInitPrompt,
  buildContinuationPrompt,
} from '../../src/sdk/prompts.js';

// Minimal ModeConfig fixture carrying the distinctive marker strings the prompt
// builders splice in, so we can assert WHERE each piece lands after the L4 split
// (scaffold → systemPrompt, per-turn signal → user turn).
const MODE: any = {
  name: 'code',
  observation_types: [{ id: 'discovery' }, { id: 'bugfix' }],
  prompts: {
    system_identity: 'IDENTITY_MARKER you do not have access to tools',
    observer_role: 'ROLE_MARKER',
    spatial_awareness: 'SPATIAL_MARKER',
    recording_focus: 'FOCUS_MARKER',
    skip_guidance: 'SKIP_MARKER',
    output_format_header: 'FORMAT_HEADER_MARKER',
    type_guidance: 'TYPE_GUIDANCE_MARKER',
    field_guidance: 'FIELD_GUIDANCE_MARKER',
    concept_guidance: 'CONCEPT_GUIDANCE_MARKER',
    format_examples: 'FORMAT_EXAMPLES_MARKER',
    footer: 'FOOTER_MARKER',
    continuation_greeting: 'GREETING_MARKER',
    continuation_instruction: 'CONTINUE_MARKER',
    header_memory_start: 'MEMORY_START_MARKER',
    header_memory_continued: 'MEMORY_CONTINUED_MARKER',
    xml_title_placeholder: 't',
    xml_subtitle_placeholder: 's',
    xml_fact_placeholder: 'f',
    xml_narrative_placeholder: 'n',
    xml_concept_placeholder: 'c',
    xml_file_placeholder: 'file',
  },
};

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

describe('L4: identity/format scaffold lives in the system prompt, not the user turn', () => {
  it('buildObserverSystemPrompt carries the identity + full format scaffold', () => {
    const sys = buildObserverSystemPrompt(MODE);
    expect(sys).toContain('IDENTITY_MARKER you do not have access to tools');
    expect(sys).toContain('ROLE_MARKER');
    expect(sys).toContain('FORMAT_HEADER_MARKER');
    expect(sys).toContain('<observation>');
    expect(sys).toContain('FORMAT_EXAMPLES_MARKER');
    expect(sys).toContain('FOOTER_MARKER');
    // The observation type enumeration is part of the stable format contract.
    expect(sys).toContain('[ discovery | bugfix ]');
  });

  it('buildInitPrompt is slim: per-turn signal only, no re-injected identity/scaffold', () => {
    const init = buildInitPrompt('proj', 'sess', 'DO_THE_THING', MODE);
    expect(init).toContain('<user_request>DO_THE_THING</user_request>');
    expect(init).toContain('MEMORY_START_MARKER');
    // Identity + format scaffold must NOT be duplicated into the user turn.
    expect(init).not.toContain('IDENTITY_MARKER');
    expect(init).not.toContain('FORMAT_EXAMPLES_MARKER');
    expect(init).not.toContain('<observation>');
  });

  it('buildContinuationPrompt is slim: greeting + request + continue cue, no identity/scaffold', () => {
    const cont = buildContinuationPrompt('DO_MORE', 3, 'sess', MODE);
    expect(cont).toContain('GREETING_MARKER');
    expect(cont).toContain('<user_request>DO_MORE</user_request>');
    expect(cont).toContain('CONTINUE_MARKER');
    expect(cont).toContain('MEMORY_CONTINUED_MARKER');
    // The whole point of L4: no identity/scaffold re-injection per continuation.
    expect(cont).not.toContain('IDENTITY_MARKER');
    expect(cont).not.toContain('FORMAT_EXAMPLES_MARKER');
    expect(cont).not.toContain('<observation>');
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
