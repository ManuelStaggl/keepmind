import { describe, it, expect } from 'bun:test';
import {
  pinModelForSession,
  clampMaxContextTurns,
  shouldForceFreshSession,
} from '../../src/services/worker/ClaudeProvider.js';

// Pure unit tests for the L5 (model pinning) and L3 (context cap) decisions.
// These replace earlier SDK-driven tests that relied on process-global
// mock.module() calls — those leaked across files and made the full bun suite
// order-dependent. The decisions are pure, so no mocking is needed.

describe('pinModelForSession (L5)', () => {
  it('reuses the pinned model on resume and does not re-pin (cache stays warm despite a tier flip)', () => {
    const r = pinModelForSession(true, 'model-A', () => 'model-B-flipped');
    expect(r.modelId).toBe('model-A');
    expect(r.pinned).toBe(false);
  });

  it('resolves the fresh (tier-routed) model and signals a pin on a fresh session', () => {
    const r = pinModelForSession(false, undefined, () => 'model-A');
    expect(r.modelId).toBe('model-A');
    expect(r.pinned).toBe(true);
  });

  it('resolves fresh + pins when resuming but nothing is pinned yet (e.g. after worker restart)', () => {
    const r = pinModelForSession(true, undefined, () => 'model-A');
    expect(r.modelId).toBe('model-A');
    expect(r.pinned).toBe(true);
  });

  it('does not evaluate the fresh-model thunk when a pinned model is reused (preserves the settings short-circuit)', () => {
    let called = 0;
    pinModelForSession(true, 'model-A', () => { called++; return 'x'; });
    expect(called).toBe(0);
  });
});

describe('clampMaxContextTurns (L3)', () => {
  it('treats 0 and negatives as unbounded', () => {
    expect(clampMaxContextTurns(0)).toBe(0);
    expect(clampMaxContextTurns(-5)).toBe(0);
  });

  it('floors a finite positive value at 4 (anti-thrash)', () => {
    expect(clampMaxContextTurns(1)).toBe(4);
    expect(clampMaxContextTurns(3)).toBe(4);
    expect(clampMaxContextTurns(40)).toBe(40);
    expect(clampMaxContextTurns(200)).toBe(200);
  });

  it('falls back to the default (40) for non-finite input (e.g. NaN from a bad setting)', () => {
    expect(clampMaxContextTurns(NaN)).toBe(40);
  });
});

describe('shouldForceFreshSession (L3)', () => {
  it('forces a fresh session once the turn count reaches the cap', () => {
    expect(shouldForceFreshSession(4, 4)).toBe(true);
    expect(shouldForceFreshSession(5, 4)).toBe(true);
  });

  it('does not force below the cap', () => {
    expect(shouldForceFreshSession(3, 4)).toBe(false);
  });

  it('never forces when unbounded (cap = 0)', () => {
    expect(shouldForceFreshSession(999, 0)).toBe(false);
  });
});
