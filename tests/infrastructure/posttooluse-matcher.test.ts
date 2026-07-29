// Perf plan P2: PostToolUse used to run with matcher "*" — a Node cold start
// behind EVERY tool call, including ones that carry nothing recallable (Glob,
// Grep, ToolSearch, task bookkeeping). The matcher now allow-lists tool names.
//
// The matcher semantics are load-bearing here, per the Claude Code hooks docs:
//   - a matcher of only [A-Za-z0-9_- ,|] is an EXACT string list, not a regex
//   - any other character switches it to a JavaScript regex, tested with
//     RegExp.prototype.test — i.e. UNANCHORED, so `Edit` would match `NotebookEdit`
// Our matcher contains `mcp__.*`, so it takes the regex path and MUST carry its
// own ^…$ anchors. These tests pin exactly that.
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const HOOKS_PATH = join(import.meta.dirname, '..', '..', 'plugin', 'hooks', 'hooks.json');
const hooks = JSON.parse(readFileSync(HOOKS_PATH, 'utf-8'));

const postToolUseMatcher: string = hooks.hooks.PostToolUse[0].matcher;
const matches = (toolName: string): boolean => new RegExp(postToolUseMatcher).test(toolName);

describe('PostToolUse matcher (perf plan P2)', () => {
  it('is no longer a match-all', () => {
    expect(postToolUseMatcher).not.toBe('*');
    expect(postToolUseMatcher).not.toBe('');
  });

  it('is anchored, because it takes the unanchored regex path', () => {
    // Sanity-check the premise: it does contain a regex-only character.
    expect(/[^A-Za-z0-9_\-, |]/.test(postToolUseMatcher)).toBe(true);
    expect(postToolUseMatcher.startsWith('^')).toBe(true);
    expect(postToolUseMatcher.endsWith('$')).toBe(true);
  });

  it.each([
    'Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit',
    'Bash', 'PowerShell',
    'Task', 'Agent',
    'WebFetch', 'WebSearch',
  ])('observes %s — it produces an observation', (tool) => {
    expect(matches(tool)).toBe(true);
  });

  it.each([
    'mcp__hass__GetLiveContext',
    'mcp__context7__query-docs',
    'mcp__claude-in-chrome__get_page_text',
  ])('observes %s — MCP calls carry real content and stay in memory', (tool) => {
    expect(matches(tool)).toBe(true);
  });

  it.each([
    'Glob', 'Grep',                                     // navigation only
    'ToolSearch',                                       // loads schemas; no work happened
    'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',   // bookkeeping
    'TodoWrite', 'AskUserQuestion', 'Skill', 'SlashCommand',
    'EnterPlanMode', 'ExitPlanMode',
    'BashOutput', 'KillShell',
  ])('skips %s — no hook process is spawned for it at all', (tool) => {
    expect(matches(tool)).toBe(false);
  });

  it('does not leak partial matches in either direction', () => {
    // The regex path is unanchored by default; these would all pass without ^$.
    expect(matches('ReadMcpResourceTool')).toBe(false);
    expect(matches('EditPlanMode')).toBe(false);
    expect(matches('NotBash')).toBe(false);
    expect(matches('WebSearchHistory')).toBe(false);
    // ...while the legitimate long-tail of MCP names still matches.
    expect(matches('mcp__a__b__c')).toBe(true);
  });

  it('keeps PreToolUse scoped to Read', () => {
    expect(hooks.hooks.PreToolUse[0].matcher).toBe('Read');
  });
});
