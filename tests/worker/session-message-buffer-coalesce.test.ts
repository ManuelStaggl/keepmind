import { describe, it, expect } from 'bun:test';
import { SessionMessageBuffer } from '../../src/services/worker/SessionMessageBuffer.js';
import type { PendingMessage } from '../../src/services/worker-types.js';

const SESSION = 1;

function observation(tool: string): PendingMessage {
  return {
    type: 'observation',
    tool_name: tool,
    tool_input: '{}',
    tool_response: '{}',
    prompt_number: 1,
    cwd: '/tmp',
  } as unknown as PendingMessage;
}

function summarize(): PendingMessage {
  return { type: 'summarize' } as unknown as PendingMessage;
}

describe('SessionMessageBuffer coalesce window', () => {
  it('returns immediately once the target is already buffered', async () => {
    const buffer = new SessionMessageBuffer();
    await buffer.enqueue(SESSION, observation('Edit'));
    await buffer.enqueue(SESSION, observation('Write'));

    const started = Date.now();
    const waiting = await buffer.waitForCoalesceWindow({
      sessionDbId: SESSION,
      target: 2,
      windowMs: 5000,
      signal: new AbortController().signal,
    });

    expect(waiting).toBe(2);
    // Must not burn the window when the batch can already be filled.
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('picks up a sibling that arrives during the window', async () => {
    const buffer = new SessionMessageBuffer();
    await buffer.enqueue(SESSION, observation('Edit'));

    setTimeout(() => void buffer.enqueue(SESSION, observation('Write')), 20);

    const waiting = await buffer.waitForCoalesceWindow({
      sessionDbId: SESSION,
      target: 2,
      windowMs: 2000,
      signal: new AbortController().signal,
    });

    // This is the whole point: without the window the second tool use would have
    // paid its own compression turn.
    expect(waiting).toBe(2);
  });

  it('gives up when the window elapses and returns what it has', async () => {
    const buffer = new SessionMessageBuffer();
    await buffer.enqueue(SESSION, observation('Edit'));

    const started = Date.now();
    const waiting = await buffer.waitForCoalesceWindow({
      sessionDbId: SESSION,
      target: 4,
      windowMs: 60,
      signal: new AbortController().signal,
    });

    expect(waiting).toBe(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(50);
  });

  it('returns as soon as the generator aborts', async () => {
    const buffer = new SessionMessageBuffer();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);

    const started = Date.now();
    await buffer.waitForCoalesceWindow({
      sessionDbId: SESSION,
      target: 3,
      windowMs: 10_000,
      signal: controller.signal,
    });

    // An aborting generator must not be held open for the full window.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('does not count past a queued summarize', async () => {
    const buffer = new SessionMessageBuffer();
    await buffer.enqueue(SESSION, observation('Edit'));
    await buffer.enqueue(SESSION, summarize());
    await buffer.enqueue(SESSION, observation('Write'));

    // Mirrors claimAdditionalObservations: ordering around the summarize turn is
    // preserved, so the observation behind it is not batchable yet.
    expect(buffer.getUnclaimedObservationCount(SESSION)).toBe(1);
  });
});
