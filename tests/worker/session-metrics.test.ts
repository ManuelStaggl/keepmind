import { describe, it, expect } from 'bun:test';
import { gatedShare, tokensPerTurn, type SessionMetrics } from '../../src/services/worker/session-metrics.js';

/**
 * The end-of-session balance used to exist only as a `logger.success` line,
 * which delegates to `info`. At KEEPMIND_LOG_LEVEL=WARN it was dropped, so the
 * documented measurement ("grep the log for 'Stateless observer session ended'")
 * returned zero matches on a machine that was working fine.
 *
 * Zero matches is indistinguishable from "the observer did nothing" — the same
 * trap as the search counters reading 0 while merely uninstrumented. The record
 * now goes to metrics-<date>.jsonl, which no log level can suppress.
 */

function metrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    endedAt: 1_754_700_000_000,
    sessionDbId: 1,
    project: 'proj',
    compressionTurns: 4,
    gatedBatches: 6,
    skippedBatches: 1,
    observationsProduced: 3,
    inputTokens: 40_000,
    outputTokens: 2_000,
    durationMs: 60_000,
    ...overrides,
  };
}

describe('session metrics', () => {
  it('computes the gated share against everything the gate saw', () => {
    expect(gatedShare(metrics())).toBeCloseTo(0.6, 5);
  });

  it('reports a zero share rather than dividing by zero on an idle session', () => {
    expect(gatedShare(metrics({ compressionTurns: 0, gatedBatches: 0 }))).toBe(0);
  });

  it('reports a full share when every batch was gated', () => {
    expect(gatedShare(metrics({ compressionTurns: 0, gatedBatches: 7 }))).toBe(1);
  });

  it('gives tokens per dispatched turn — the figure that compares to pre-3.4.0', () => {
    expect(tokensPerTurn(metrics())).toBe(10_500);
  });

  it('distinguishes "nothing was dispatched" from "zero tokens"', () => {
    // null, not 0: a session that made no model call has no per-turn cost, and
    // reporting 0 would drag any average toward a number nobody paid.
    expect(tokensPerTurn(metrics({ compressionTurns: 0, gatedBatches: 5 }))).toBeNull();
  });
});
