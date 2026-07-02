import { describe, it, expect, beforeEach, mock } from 'bun:test';
import type { ActiveSession } from '../../src/services/worker-types.js';

// L5: within one resumed conversation the model must stay pinned so tier routing
// can't flip it on a generator restart and invalidate the model-scoped prompt
// cache. We drive ClaudeProvider.startSession with the SDK + environment helpers
// mocked, capturing the model each query() is issued with.

let capturedModels: string[] = [];

// The SDK query(): capture options.model, then hand back a stream that ends
// immediately (a lone result message) so startSession completes without needing
// the message generator to be consumed.
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: any) => {
    capturedModels.push(args.options.model);
    return (async function* () {
      yield { type: 'result', usage: {}, total_cost_usd: 0 };
    })();
  },
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

// Spread the real module (other modules, e.g. supervisor/shutdown.ts, import
// isPidAlive/waitForExit from it) and override only the spawn/slot surface.
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
    sessionDbId: 7,
    contentSessionId: 'content-7',
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

describe('ClaudeProvider model pinning (L5)', () => {
  beforeEach(() => {
    capturedModels = [];
  });

  it('pins the fresh-session model and reuses it on resume despite a tier-routing flip', async () => {
    const provider = new ClaudeProvider({} as any, {} as any);
    const session = makeSession({ modelOverride: 'model-A', lastPromptNumber: 1 });

    // Fresh session (no resume): resolves + pins the tier-routed model.
    await provider.startSession(session);
    expect(session.pinnedModel).toBe('model-A');

    // Now the conversation resumes and tier routing flips modelOverride.
    session.memorySessionId = 'mem-1';
    session.lastPromptNumber = 2;
    session.modelOverride = 'model-B';

    await provider.startSession(session);

    // The resumed turn must reuse the pinned model, not the flipped override.
    expect(capturedModels).toEqual(['model-A', 'model-A']);
    expect(session.pinnedModel).toBe('model-A');
  });

  it('re-resolves and re-pins on forceInit (a genuinely fresh session)', async () => {
    const provider = new ClaudeProvider({} as any, {} as any);
    const session = makeSession({ modelOverride: 'model-A', lastPromptNumber: 1 });

    await provider.startSession(session);
    expect(session.pinnedModel).toBe('model-A');

    // A forced fresh start (e.g. L3 context reset) starts a NEW SDK session, so
    // the model is re-resolved and re-pinned — a new cache anyway.
    session.memorySessionId = 'mem-1';
    session.lastPromptNumber = 5;
    session.forceInit = true;
    session.modelOverride = 'model-C';

    await provider.startSession(session);

    expect(capturedModels).toEqual(['model-A', 'model-C']);
    expect(session.pinnedModel).toBe('model-C');
  });
});
