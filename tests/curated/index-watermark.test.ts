import { describe, it, expect } from 'bun:test';
import { rewindWatermarkTo } from '../../src/services/sync/VectorSync.js';

// The backfill is watermark-driven, and a watermark that has overtaken rows
// which were never embedded turns a slow index into a permanent hole. The hole
// is invisible: the query simply returns nothing, and reports no error.
describe('watermark rewind', () => {
  it('does nothing when nothing is missing', () => {
    expect(rewindWatermarkTo([], 500)).toBeNull();
  });

  it('rewinds to just below the lowest missing id', () => {
    expect(rewindWatermarkTo([412, 480, 499], 500)).toBe(411);
  });

  it('leaves the watermark alone when the rows are already in view', () => {
    // The mark sits below the missing rows, so an ordinary backfill would pick
    // them up. Something else is failing, and re-embedding the corpus would not
    // fix it.
    expect(rewindWatermarkTo([600, 700], 500)).toBeNull();
  });

  it('rewinds to 0 when the very first row is missing', () => {
    expect(rewindWatermarkTo([1], 900)).toBe(0);
  });

  it('is driven by the lowest id, not the order they were reported in', () => {
    expect(rewindWatermarkTo([900, 3, 400], 900)).toBe(2);
  });
});
