import { describe, it, expect } from 'bun:test';
import { questionsFrom, usable } from '../../src/cli/handlers/decision-check.js';

describe('reading the question', () => {
  it('reads the AskUserQuestion shape', () => {
    expect(questionsFrom({ questions: [{ question: 'Wer entscheidet über Farben?' }] }))
      .toEqual(['Wer entscheidet über Farben?']);
  });

  it('reads every question of a multi-question call', () => {
    const out = questionsFrom({ questions: [{ question: 'A?' }, { question: 'B?' }] });
    expect(out).toEqual(['A?', 'B?']);
  });

  it('stays silent on a shape it does not recognise', () => {
    // This hook must never become the reason a question cannot be asked.
    expect(questionsFrom(undefined)).toEqual([]);
    expect(questionsFrom({ questions: 'nope' })).toEqual([]);
    expect(questionsFrom({ questions: [{ notAQuestion: 1 }] })).toEqual([]);
  });
});

describe('what may be offered as an answer', () => {
  const base = { source_kind: 'curated', type: 'decision', valid_to: null };

  it('offers a curated decision that still applies', () => {
    expect(usable(base)).toBe(true);
  });

  it('never offers an observation', () => {
    // An observation records what happened, not what was resolved.
    expect(usable({ ...base, source_kind: undefined })).toBe(false);
  });

  it('never offers a work item', () => {
    // Measured in the first run: three of six candidates were work items, one
    // of them already closed. A work item is the thing a decision is carried
    // out in — offering it answers with the task instead of the ruling.
    expect(usable({ ...base, type: 'change' })).toBe(false);
  });

  it('never offers a retired decision', () => {
    // Worse than no answer: it answers a live question with a dead rule.
    expect(usable({ ...base, valid_to: 1234 })).toBe(false);
  });
});
