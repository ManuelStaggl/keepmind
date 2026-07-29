// Perf plan P3: SessionStart is ONE hook instead of three. This pins the
// contract of the bundling handler: acquire runs first (for its refcount side
// effect), context supplies the model-visible result, and a failing acquire must
// never cost the user their session context.
import { beforeEach, describe, expect, it, mock } from 'bun:test';

import type { NormalizedHookInput } from '../../../src/cli/types.js';

const callOrder: string[] = [];
let acquireMode: 'ok' | 'throw' = 'ok';

mock.module('../../../src/cli/handlers/session-acquire.js', () => ({
  sessionAcquireHandler: {
    async execute() {
      callOrder.push('acquire');
      if (acquireMode === 'throw') {
        throw new Error('worker refused the acquire');
      }
      return { continue: true, suppressOutput: true };
    },
  },
}));

mock.module('../../../src/cli/handlers/context.js', () => ({
  contextHandler: {
    async execute() {
      callOrder.push('context');
      return {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: 'recent context',
        },
      };
    },
  },
}));

const { sessionStartHandler } = await import('../../../src/cli/handlers/session-start.js');

const input = { sessionId: 'sess-1', cwd: process.cwd(), platform: 'claude-code' } as NormalizedHookInput;

beforeEach(() => {
  callOrder.length = 0;
  acquireMode = 'ok';
});

describe('sessionStartHandler — bundles acquire + context (perf plan P3)', () => {
  it('acquires the session BEFORE injecting context', async () => {
    await sessionStartHandler.execute(input);
    expect(callOrder).toEqual(['acquire', 'context']);
  });

  it('returns the context handler result verbatim', async () => {
    const result = await sessionStartHandler.execute(input);
    expect(result.hookSpecificOutput).toEqual({
      hookEventName: 'SessionStart',
      additionalContext: 'recent context',
    });
  });

  it('still injects context when acquire throws', async () => {
    acquireMode = 'throw';
    const result = await sessionStartHandler.execute(input);
    expect(callOrder).toEqual(['acquire', 'context']);
    expect(result.hookSpecificOutput?.additionalContext).toBe('recent context');
  });
});

describe('handler registry', () => {
  it('registers session-start while keeping the sub-events dispatchable', async () => {
    const { getEventHandler } = await import('../../../src/cli/handlers/index.js');
    // The sub-events must stay reachable: other hosts (Codex, Cursor, Gemini)
    // and already-installed hook configs still call them individually.
    for (const event of ['session-start', 'session-acquire', 'context']) {
      expect(typeof getEventHandler(event).execute).toBe('function');
    }
  });
});
