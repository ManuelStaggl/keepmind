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

// The ASCII-only normalizer deleted non-ASCII letters and left the fragments
// behind, so German compounds shattered ("Zurückknopf" → "zur ckknopf") and the
// debris matched the debris of unrelated words. Scores stayed in range while
// measuring nothing, which is why it went unnoticed for so long.
describe('normalizeText is Unicode-aware', () => {
  it('keeps German compounds intact instead of splitting them at the umlaut', () => {
    const out = normalizeText('Der Zurückknopf in der Anwendungstitelleiste (größer)');
    expect(out).toBe('zurueckknopf anwendungstitelleiste groesser');
    expect(out).not.toContain('zur ck');
    expect(out).not.toMatch(/\bgr\b/);
  });

  it('folds umlaut and ae/oe/ue spellings of the same word together', () => {
    expect(normalizeText('Größenbudget')).toBe(normalizeText('Groessenbudget'));
    expect(similarity('Die Größe der Datei', 'Die Groesse der Datei')).toBeGreaterThan(0.9);
  });

  it('treats NFD-decomposed umlauts as identical to NFC', () => {
    // Same word twice: composed, then as u + combining diaeresis (U+0308) — the
    // form macOS filesystems and some clipboards hand over. Escaped rather than
    // literal so an editor cannot silently normalize the test away.
    const nfc = 'Prüfung';
    const nfd = 'Prüfung';
    expect(nfc).not.toBe(nfd);
    expect(normalizeText(nfd)).toBe(normalizeText(nfc));
    expect(normalizeText(nfd)).toBe('pruefung');
  });

  it('preserves non-Latin scripts instead of erasing them', () => {
    expect(normalizeText('Проверка порта')).toBe('проверка порта');
    expect(normalizeText('ポート設定')).toBe('ポート設定');
  });

  it('drops German function words', () => {
    expect(normalizeText('Der Port ist für die Anwendung')).toBe('port anwendung');
  });

  it('separates two unrelated German observations that the ASCII fold conflated', () => {
    // Both reduce to fragment soup under [^a-z0-9\s]: "gr", "er", "ss".
    const a = 'Die Schriftgröße der Schaltfläche wurde vergrößert';
    const b = 'Der Prüfschlüssel für die Größenmessung schlug fehl';
    expect(similarity(a, b)).toBeLessThan(0.5);
  });
});

// A stopword may remove noise, never meaning. Negations decide whether two
// statements agree or contradict, so folding them away would score a correction
// as a near-duplicate of the thing it corrects.
describe('negations survive normalization', () => {
  it('keeps English "not"', () => {
    expect(normalizeText('the port is not 3000')).toContain('not');
    expect(similarity('the port is 3000', 'the port is not 3000')).toBeLessThan(0.92);
  });

  it('keeps German "nicht" and "kein"', () => {
    expect(normalizeText('der Port ist nicht belegt')).toContain('nicht');
    expect(normalizeText('es gibt keinen Fehler')).toContain('keinen');
    expect(similarity('Die Grenze ist erzwingbar', 'Die Grenze ist nicht erzwingbar'))
      .toBeLessThan(0.92);
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

  // subject_key is what supersession matches on, so two spellings of one German
  // subject must land on one key — otherwise a correction opens a second subject
  // instead of closing the first. Schema 40 recomputes stored keys for this.
  it('is stable across German spelling variants of the same subject', () => {
    expect(subjectKey({ title: 'Größenbudget der Steuerdateien' }))
      .toBe(subjectKey({ title: 'Groessenbudget der Steuerdateien' }));
  });

  it('still separates two German subjects that differ only past the umlaut', () => {
    expect(subjectKey({ title: 'Die Schriftgröße der Schaltfläche' }))
      .not.toBe(subjectKey({ title: 'Die Schriftgröße der Titelleiste' }));
  });
});
