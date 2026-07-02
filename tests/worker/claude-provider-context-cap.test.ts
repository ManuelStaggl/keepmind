import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import type { ActiveSession } from '../../src/services/worker-types.js';

// L3: a resumed Claude conversation must be bounded — after
// CLAUDE_MEM_MAX_CONTEXT_MESSAGES compression turns the generator forces a fresh
// SDK session and stops, so the context window / resume payload stays bounded.
// We drive startSession with the SDK consuming the prompt generator and a
// message iterator that would otherwise feed observations forever.

const yieldedContents: string[] = [];

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => (async function* () {
    // Consume the prompt (message) generator so createMessageGenerator actually
    // runs its loop; record each user turn's content.
    for await (const p of args.prompt) {
      const c = p?.message?.content;
      yieldedContents.push(typeof c === 'string' ? c : '');
    }
    yield { type: 'result', usage: {}, total_cost_usd: 0 };
  })(),
}));

mock.module('../../src/shared/find-claude-executable.js', () => ({
  findClaudeExecutable: () => '/mock/claude',
}));
mock.module('../../src/shared/EnvManager.js', () => ({
  buildIsolatedEnvWithFreshOAuth: async () => ({}),
  getAuthMethodDescription: () => 'subscription',
}));
mock.module('../../src/supervisor/env-sanitizer.js', () => ({
  sanitizeEnv: (e: any) => e,
}));
const realRegistry = await import('../../src/supervisor/process-registry.js');
mock.module('../../src/supervisor/process-registry.js', () => ({
  ...realRegistry,
  createSdkSpawnFactory: () => undefined,
  getSdkProcessForSession: () => undefined,
  ensureSdkProcessExit: async () => {},
  waitForSlot: async () => {},
}));

const { ClaudeProvider } = await import('../../src/services/worker/ClaudeProvider.js');

function makeSession(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    sessionDbId: 9,
    contentSessionId: 'content-9',
    memorySessionId: null,
    project: 'project',
    userPrompt: 'prompt',
    pendingMessages: [],
    abortController: new AbortController(),
    generatorPromise: null,
    lastPromptNumber: 1,
    startTime: Date.now(),
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    earliestPendingTimestamp: null,
    claimedMessageIds: [],
    conversationHistory: [],
    currentProvider: null,
    consecutiveRestarts: 0,
    consecutiveInvalidOutputs: 0,
    lastGeneratorActivity: Date.now(),
    ...overrides,
  } as ActiveSession;
}

// A sessionManager whose message iterator would feed observations indefinitely,
// so only the L3 cap can stop the generator.
function makeSessionManager(observationCount: number) {
  return {
    getMessageIterator: async function* () {
      for (let i = 0; i < observationCount; i++) {
        yield {
          type: 'observation',
          tool_name: 'Read',
          tool_input: { file: `f${i}.ts` },
          tool_response: { ok: true },
          prompt_number: 2 + i,
        };
      }
    },
    drainAdditionalObservations: () => [],
    getMessageBuffer: () => ({ peekTypes: () => [] }),
  } as any;
}

describe('ClaudeProvider L3 context cap', () => {
  const prev = process.env.CLAUDE_MEM_MAX_CONTEXT_MESSAGES;

  beforeEach(() => {
    yieldedContents.length = 0;
    process.env.CLAUDE_MEM_MAX_CONTEXT_MESSAGES = '4';
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_MEM_MAX_CONTEXT_MESSAGES;
    else process.env.CLAUDE_MEM_MAX_CONTEXT_MESSAGES = prev;
  });

  it('forces a fresh session after N ingest turns and stops the generator', async () => {
    const provider = new ClaudeProvider({ } as any, makeSessionManager(20));
    const session = makeSession();

    await provider.startSession(session);

    // 1 init turn + exactly 4 ingest turns (the cap), then the generator returned.
    expect(session.contextTurnCount).toBe(4);
    expect(session.forceInit).toBe(true);
    const ingestTurns = yieldedContents.length - 1; // minus the init turn
    expect(ingestTurns).toBe(4);
    // conversationHistory was trimmed to bound the in-memory array.
    expect(session.conversationHistory.length).toBeLessThanOrEqual(2);
  });

  it('does not cap when CLAUDE_MEM_MAX_CONTEXT_MESSAGES=0 (unbounded)', async () => {
    process.env.CLAUDE_MEM_MAX_CONTEXT_MESSAGES = '0';
    const provider = new ClaudeProvider({ } as any, makeSessionManager(6));
    const session = makeSession();

    await provider.startSession(session);

    // All 6 observations processed, no forced fresh session.
    expect(session.forceInit).toBeFalsy();
    const ingestTurns = yieldedContents.length - 1;
    expect(ingestTurns).toBe(6);
  });
});
