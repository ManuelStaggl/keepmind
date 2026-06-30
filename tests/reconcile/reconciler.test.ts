import { describe, it, expect } from 'bun:test';
import { reconcile, similarity, jaccardTrigram, normalizeText } from '../../src/services/reconcile/reconciler.js';
import { subjectKey } from '../../src/services/reconcile/subject-key.js';

describe('text similarity', () => {
  it('near-verbatim text scores very high', () => {
    expect(similarity('The default port is 3000', 'the default port is 3000')).toBeGreaterThan(0.92);
  });
  it('unrelated text scores low', () => {
    expect(similarity('The default port is 3000', 'We migrated the auth layer to bcrypt')).toBeLessThan(0.5);
  });
  it('normalizeText drops punctuation and stopwords', () => {
    expect(normalizeText('The, default!! PORT is 3000')).toBe('default port 3000');
  });
  it('jaccardTrigram of identical strings is 1', () => {
    expect(jaccardTrigram('abcdef', 'abcdef')).toBe(1);
  });
});

describe('reconcile decision bands', () => {
  const cands = [{ id: 7, title: 'Default port', narrative: 'the default dev server port is 3000' }];
  const opts = { noopThreshold: 0.92, updateBand: 0.75, supersessionEnabled: false };

  it('near-identical → NOOP', () => {
    const d = reconcile({ title: 'Default port', narrative: 'the default dev server port is 3000' }, cands, opts);
    expect(d.action).toBe('NOOP');
    expect(d.candidateId).toBe(7);
  });
  it('novel → ADD', () => {
    const d = reconcile({ title: 'Auth', narrative: 'switched password hashing to argon2id everywhere' }, cands, opts);
    expect(d.action).toBe('ADD');
  });
  it('mid-band stays ADD when supersession is OFF (never silently supersede)', () => {
    const mid = reconcile({ title: 'Default port', narrative: 'the default dev server port is now 8080 instead' }, cands, opts);
    expect(mid.action).toBe('ADD');
  });
  it('mid-band → UPDATE only when supersession is ON', () => {
    const mid = reconcile(
      { title: 'Default port', narrative: 'the default dev server port is now 8080 instead' },
      cands,
      { ...opts, supersessionEnabled: true }
    );
    expect(['UPDATE', 'NOOP']).toContain(mid.action);
  });
});

describe('subjectKey', () => {
  it('is stable across phrasing of the same subject title', () => {
    expect(subjectKey({ title: 'The default Port' })).toBe(subjectKey({ title: 'default port' }));
  });
  it('differs for different subjects', () => {
    expect(subjectKey({ title: 'default port' })).not.toBe(subjectKey({ title: 'build tool' }));
  });
});
