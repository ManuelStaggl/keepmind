import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { CHECKPOINT_TYPE } from '../../src/shared/checkpoint.js';

describe('SessionStore checkpoints', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  it('stores a curated checkpoint and reads it back as active', () => {
    const { id } = store.storeCheckpoint('proj', 'Active task: build the thing', { focus: 'ship it' });
    expect(id).toBeGreaterThan(0);

    const row: any = store.getObservationById(id);
    expect(row?.type).toBe(CHECKPOINT_TYPE);
    expect(row?.source_kind).toBe('curated');
    expect(row?.valid_to ?? null).toBeNull();

    const active = store.getActiveCheckpoints(['proj']);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(id);
    expect(active[0].narrative).toBe('Active task: build the thing');
    expect(JSON.parse(active[0].metadata as string).focus).toBe('ship it');
  });

  it('derives a title from the first line when none is given', () => {
    const { id } = store.storeCheckpoint('proj', '# Resume here\nmore body');
    const row: any = store.getObservationById(id);
    expect(row?.title).toBe('Resume here');
  });

  it('keeps exactly ONE active checkpoint per project — a new one supersedes the old', () => {
    const first = store.storeCheckpoint('proj', 'first checkpoint');
    const second = store.storeCheckpoint('proj', 'second checkpoint');

    const active = store.getActiveCheckpoints(['proj']);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(second.id);

    // The old one is soft-closed (bi-temporal), not deleted, and points at its replacement.
    const oldRow: any = store.getObservationById(first.id);
    expect(oldRow?.valid_to ?? null).not.toBeNull();
    expect(JSON.parse(oldRow?.metadata as string).superseded_by_checkpoint).toBe(second.id);
  });

  it('scopes checkpoints per project — one project never supersedes another', () => {
    const a = store.storeCheckpoint('proj-a', 'A baton');
    const b = store.storeCheckpoint('proj-b', 'B baton');

    expect(store.getActiveCheckpoints(['proj-a'])[0].id).toBe(a.id);
    expect(store.getActiveCheckpoints(['proj-b'])[0].id).toBe(b.id);

    const both = store.getActiveCheckpoints(['proj-a', 'proj-b']);
    expect(both.map(c => c.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('clearCheckpoint retires the active checkpoint ("erledigt → weg")', () => {
    store.storeCheckpoint('proj', 'done soon');
    expect(store.getActiveCheckpoints(['proj'])).toHaveLength(1);

    const { cleared } = store.clearCheckpoint('proj');
    expect(cleared).toBe(1);
    expect(store.getActiveCheckpoints(['proj'])).toHaveLength(0);

    // Clearing again is a no-op, not an error.
    expect(store.clearCheckpoint('proj').cleared).toBe(0);
  });

  it('is idempotent: identical text re-activates rather than leaving two batons', () => {
    const first = store.storeCheckpoint('proj', 'same text');
    store.clearCheckpoint('proj');
    expect(store.getActiveCheckpoints(['proj'])).toHaveLength(0);

    const again = store.storeCheckpoint('proj', 'same text');
    expect(again.id).toBe(first.id); // content-hash dedup reused the row
    const active = store.getActiveCheckpoints(['proj']);
    expect(active).toHaveLength(1);
    expect(active[0].id).toBe(first.id);
  });

  it('redacts secrets in the stored checkpoint body', () => {
    const secret = 'ghp_0123456789abcdefghij0123456789abcdef';
    const { id } = store.storeCheckpoint('proj', `token is ${secret} keep going`);
    const row: any = store.getObservationById(id);
    expect(row?.narrative).not.toContain(secret);
  });
});
