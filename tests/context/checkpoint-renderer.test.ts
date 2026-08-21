import { describe, it, expect } from 'bun:test';
import { renderCheckpoints } from '../../src/services/context/sections/CheckpointRenderer.js';
import type { CheckpointRecord } from '../../src/shared/checkpoint.js';

function cp(overrides: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return {
    id: 1,
    project: 'keepmind',
    title: 'Resume here',
    narrative: 'Active task: wire the thing\nNext: run tests',
    metadata: JSON.stringify({ checkpoint: true }),
    created_at: '2026-08-21T15:33:00.000Z',
    created_at_epoch: 1_755_790_380_000,
    ...overrides,
  };
}

describe('renderCheckpoints', () => {
  it('renders nothing for an empty list', () => {
    expect(renderCheckpoints([])).toEqual([]);
  });

  it('renders a prominent, verbatim block with a resume instruction and a separator', () => {
    const block = renderCheckpoints([cp()]).join('\n');

    expect(block).toContain('# ⏳ CHECKPOINT — keepmind');
    expect(block).toContain('Resume from here before anything else.');
    // Verbatim body, unaltered.
    expect(block).toContain('Active task: wire the thing\nNext: run tests');
    // Set off from what follows.
    expect(block).toContain('\n---\n');
  });

  it('surfaces the focus from metadata when present', () => {
    const block = renderCheckpoints([cp({ metadata: JSON.stringify({ focus: 'ship the release' }) })]).join('\n');
    expect(block).toContain('_Focus: ship the release_');
  });

  it('never throws on malformed metadata', () => {
    const block = renderCheckpoints([cp({ metadata: '{not json' })]).join('\n');
    expect(block).toContain('# ⏳ CHECKPOINT — keepmind');
    expect(block).not.toContain('_Focus:');
  });

  it('preserves input order (newest project first) for multiple checkpoints', () => {
    const block = renderCheckpoints([
      cp({ id: 2, project: 'newer', narrative: 'newer body' }),
      cp({ id: 1, project: 'older', narrative: 'older body' }),
    ]).join('\n');
    expect(block.indexOf('newer')).toBeLessThan(block.indexOf('older'));
  });
});
