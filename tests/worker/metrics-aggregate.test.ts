import { describe, it, expect } from 'bun:test';
import { aggregateSessionMetrics, readMetricsDay } from '../../src/services/worker/metrics-aggregate.js';
import { METRICS_SCHEMA_VERSION } from '../../src/services/worker/session-metrics.js';

/**
 * 3.4.1 documented reading the metrics file with
 * `Measure-Object -Property tokensPerTurn -Average`. Both halves of that are
 * wrong, and both were reached independently in the field within a day. These
 * tests pin the difference between the three possible answers.
 */

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: METRICS_SCHEMA_VERSION,
    endedAt: 1_754_700_000_000,
    sessionDbId: 1,
    contentSessionId: 'session-a',
    project: 'proj',
    compressionTurns: 4,
    gatedBatches: 6,
    skippedBatches: 1,
    observationsProduced: 3,
    inputTokens: 40_000,
    cacheReadInputTokens: 0,
    outputTokens: 2_000,
    durationMs: 60_000,
    ...overrides,
  };
}

// Chosen so all three readings differ: one session dispatched nothing, and the
// two that did are far apart in turn count.
const day = [
  record({ contentSessionId: 's1', compressionTurns: 1, inputTokens: 11_000, cacheReadInputTokens: 0, outputTokens: 1_000 }),
  record({ contentSessionId: 's2', compressionTurns: 0, gatedBatches: 5, inputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0 }),
  record({ contentSessionId: 's3', compressionTurns: 9, inputTokens: 60_000, cacheReadInputTokens: 25_000, outputTokens: 5_000 }),
];

describe('aggregating a day of records', () => {
  it('divides sums by sums instead of averaging per-session values', () => {
    // Per-session values are 12000, null and 10000.
    //   Measure-Object -Average (nulls as 0): 7333  — the documented snippet
    //   mean of the non-null values:         11000
    //   Σ billed / Σ turns:                  10200  — the only one that is a
    //                                                 cost per unit of work
    expect(aggregateSessionMetrics(day).tokensPerTurn).toBe(10_200);
  });

  it('never lets a session that dispatched nothing count as zero cost', () => {
    const withoutIdle = day.filter((r) => (r.compressionTurns as number) > 0);
    expect(aggregateSessionMetrics(withoutIdle).tokensPerTurn).toBe(
      aggregateSessionMetrics(day).tokensPerTurn,
    );
  });

  it('counts cache reads towards the billed total', () => {
    expect(aggregateSessionMetrics(day).billedTokens).toBe(102_000);
    expect(aggregateSessionMetrics(day).cacheReadInputTokens).toBe(25_000);
  });

  it('computes the gated share from summed counters, not from summed shares', () => {
    const agg = aggregateSessionMetrics(day);
    expect(agg.gatedBatches).toBe(17);
    expect(agg.compressionTurns).toBe(10);
    expect(agg.gatedShare).toBeCloseTo(17 / 27, 5);
  });

  it('leaves out records written before the token count included cache reads', () => {
    // Schema 1 reported an inputTokens that excluded cache reads under the same
    // name; mixing it in would silently understate the bill.
    const mixed = [...day, { ...record({ compressionTurns: 5, inputTokens: 1_000 }), schema: 1 }];
    const agg = aggregateSessionMetrics(mixed);
    expect(agg.skippedOldSchema).toBe(1);
    expect(agg.compressionTurns).toBe(10);
    expect(agg.tokensPerTurn).toBe(10_200);
  });

  it('reports host sessions separately from records, because they are not the same', () => {
    // A generator that pauses for quota and resumes, or a host restart, writes
    // more than one record for one stretch of work. Reading "per record" as
    // "per session" understates what a working session costs.
    const twoRecordsOneSession = [
      record({ contentSessionId: 's1', compressionTurns: 2 }),
      record({ contentSessionId: 's1', compressionTurns: 3 }),
    ];
    const agg = aggregateSessionMetrics(twoRecordsOneSession);
    expect(agg.records).toBe(2);
    expect(agg.sessions).toBe(1);
  });

  it('returns a null rate rather than 0 for a day with no dispatched turns', () => {
    expect(aggregateSessionMetrics([record({ compressionTurns: 0 })]).tokensPerTurn).toBeNull();
  });

  it('survives a garbage field without throwing', () => {
    const agg = aggregateSessionMetrics([record({ compressionTurns: 'lots' })]);
    expect(agg.compressionTurns).toBe(0);
    expect(agg.tokensPerTurn).toBeNull();
  });

  it('reports an empty balance for an empty day', () => {
    const agg = aggregateSessionMetrics([]);
    expect(agg.records).toBe(0);
    expect(agg.tokensPerTurn).toBeNull();
    expect(agg.gatedShare).toBe(0);
  });
});

describe('reading a metrics file', () => {
  it('reports a missing day as empty rather than throwing', () => {
    const day = readMetricsDay('1999-01-01');
    expect(day.records).toEqual([]);
    expect(day.unreadableLines).toBe(0);
  });
});
