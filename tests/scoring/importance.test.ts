import { describe, it, expect } from 'bun:test';
import { defaultImportance, scoreObservation } from '../../src/services/scoring/importance.js';
import { selectWithinBudget } from '../../src/services/context/budget.js';
import type { Observation } from '../../src/services/context/types.js';

describe('defaultImportance', () => {
  it('ranks decision/bugfix high and trivial low', () => {
    expect(defaultImportance({ type: 'decision', narrative: 'chose postgres over mysql for the queue backend' }))
      .toBeGreaterThan(defaultImportance({ type: 'trivial', narrative: 'noted a thing' }));
    expect(defaultImportance({ type: 'bugfix', narrative: 'fixed the off-by-one error in the token budget selection loop that dropped rows' })).toBeGreaterThanOrEqual(8);
    expect(defaultImportance({ type: 'trivial', narrative: 'x' })).toBe(1);
  });
  it('bumps when files modified, dings TODO/WIP', () => {
    const withFiles = defaultImportance({ type: 'refactor', narrative: 'renamed the module across the tree', files_modified: ['a', 'b'] });
    const without = defaultImportance({ type: 'refactor', narrative: 'renamed the module across the tree' });
    expect(withFiles).toBeGreaterThan(without);
    expect(defaultImportance({ type: 'discovery', narrative: 'TODO investigate this later when there is time' }))
      .toBeLessThan(defaultImportance({ type: 'discovery', narrative: 'confirmed the cache invalidation path works as designed' }));
  });
  it('clamps to 1..10', () => {
    for (const t of ['decision', 'bugfix', 'trivial', 'other', 'global']) {
      const v = defaultImportance({ type: t, narrative: 'some reasonably long narrative text here for scoring' });
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
    }
  });
});

describe('scoreObservation', () => {
  it('a high-importance OLD obs can outrank a low-importance NEW obs across the half-life', () => {
    const now = Date.now();
    const day = 86_400_000;
    const oldImportant = { type: 'decision', importance: 10, created_at_epoch: now - 7 * day };
    const newTrivial = { type: 'trivial', importance: 1, created_at_epoch: now };
    expect(scoreObservation(oldImportant, { now, halfLifeDays: 14 }))
      .toBeGreaterThan(scoreObservation(newTrivial, { now, halfLifeDays: 14 }));
  });
});

describe('selectWithinBudget', () => {
  const mk = (id: number, narrative: string): Observation => ({
    id, memory_session_id: 'm', type: 'decision', title: 't', subtitle: null,
    narrative, facts: '[]', concepts: '[]', files_read: '[]', files_modified: '[]',
    discovery_tokens: 0, created_at: '', created_at_epoch: id,
  });
  it('respects the cap and drops rows that overflow', () => {
    const big = mk(1, 'x'.repeat(4000));   // ~1000 tokens
    const small = mk(2, 'y'.repeat(40));   // ~10 tokens
    const out = selectWithinBudget([big, small], 100);
    expect(out.map(o => o.id)).toEqual([2]); // big skipped, small fits
  });
});
