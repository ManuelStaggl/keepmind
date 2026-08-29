import { describe, it, expect } from 'bun:test';
import { shouldCompressBatch } from '../../src/services/worker/observation-gate.js';

/**
 * The gate is handed `tool_input` as JSON TEXT in production — the ingest route
 * queues `JSON.stringify(payload.toolInput)` (`http/shared.ts`) — while every
 * test before this one passed an object. Reading only the object shape made
 * `commandOf` and `pathsOf` return '' for every live tool use, so
 * `decisiveCommand` and `governancePath` never fired at all. Measured live on
 * the running worker: `git tag --list` was dropped as `read_only`.
 *
 * The rule these tests hold is therefore "both shapes decide alike", not "a
 * string parses" — the second is an implementation detail, the first is what
 * went wrong.
 */
const LONG = 'x'.repeat(400);

function decide(toolInput: unknown, profile: 'balanced' | 'governance', tool = 'Bash') {
  return shouldCompressBatch(
    [{ tool_name: tool, tool_input: toolInput, tool_response: LONG }],
    { profile }
  );
}

function bothShapes(input: Record<string, unknown>, profile: 'balanced' | 'governance', tool = 'Bash') {
  return {
    asObject: decide(input, profile, tool),
    asJsonText: decide(JSON.stringify(input), profile, tool),
  };
}

describe('gate: tool_input arrives as JSON text, not as an object', () => {
  it('sees a decisive command through the JSON string (governance)', () => {
    const { asObject, asJsonText } = bothShapes({ command: 'git commit -m "x"' }, 'governance');
    expect(asObject.reason).toBe('decisive_command');
    expect(asJsonText).toEqual(asObject);
  });

  it('sees a decisive command through the JSON string (balanced)', () => {
    const { asObject, asJsonText } = bothShapes({ command: 'git tag --list' }, 'balanced');
    expect(asObject.compress).toBe(true);
    expect(asJsonText).toEqual(asObject);
  });

  it('sees a governance path through the JSON string', () => {
    const { asObject, asJsonText } = bothShapes({ file_path: 'C:/repo/CLAUDE.md' }, 'governance', 'Edit');
    expect(asObject.reason).toBe('governance_path_changed');
    expect(asJsonText).toEqual(asObject);
  });

  it('still drops a read-only command in both shapes', () => {
    const { asObject, asJsonText } = bothShapes({ command: 'git status --short' }, 'balanced');
    expect(asObject.compress).toBe(false);
    expect(asJsonText).toEqual(asObject);
  });

  it('treats unparsable text as no command rather than throwing', () => {
    const d = decide('{not json', 'governance');
    expect(d.compress).toBe(false);
  });
});
