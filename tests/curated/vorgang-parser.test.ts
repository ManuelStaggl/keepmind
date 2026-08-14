import { describe, it, expect } from 'bun:test';
import { parseVorgang, stripBom } from '../../src/services/curated/vorgang-parser.js';
import { parseEreignisLog, deriveStates } from '../../src/services/curated/ereignis-log.js';

const VORGANG = [
  '---',
  'id: V-0001',
  'titel: "Der Zurueck-Knopf loest die eigenen Knoepfe ab"',
  'entscheidet: steuerstand',
  'erstellt: 2026-08-11',
  'herkunft: ARBEITSLISTE.md',
  '---',
  '',
  'Entschieden ist 0047, gebaut ist der Knopf im Paket.',
].join('\n');

describe('frontmatter', () => {
  it('reads the five mandatory fields', () => {
    const v = parseVorgang(VORGANG);
    expect(v.id).toBe('V-0001');
    expect(v.titel).toBe('Der Zurueck-Knopf loest die eigenen Knoepfe ab');
    expect(v.entscheidet).toBe('steuerstand');
    expect(v.erstellt).toBe('2026-08-11');
    expect(v.herkunft).toBe('ARBEITSLISTE.md');
  });

  it('keeps the body verbatim and reports where it starts', () => {
    const v = parseVorgang(VORGANG);
    expect(v.body).toBe('Entschieden ist 0047, gebaut ist der Knopf im Paket.');
    expect(v.bodyLine).toBe(8);
  });

  it('survives a byte order mark', () => {
    // V-0172 in the real corpus starts with one. Invisible everywhere, and it
    // makes `^---` fail, so the file parses as having no frontmatter at all —
    // no id, no title, no relations. One file in 196, silently.
    const v = parseVorgang('﻿' + VORGANG);
    expect(v.id).toBe('V-0001');
  });

  it('strips a BOM and leaves other text alone', () => {
    expect(stripBom('﻿abc')).toBe('abc');
    expect(stripBom('abc')).toBe('abc');
  });

  it('reads the rare relation fields', () => {
    // Two files in 196 carry one. The mandatory set is closed; the key set is
    // not, which is why fields are harvested rather than assumed.
    const withRelation = VORGANG.replace('herkunft: ARBEITSLISTE.md', 'herkunft: x\nhaengt_an: V-0187');
    expect(parseVorgang(withRelation).haengtAn).toBe('V-0187');

    const closing = VORGANG.replace('herkunft: ARBEITSLISTE.md', 'herkunft: x\nschliesst: V-0178');
    expect(parseVorgang(closing).schliesst).toBe('V-0178');
  });

  it('treats an unterminated block as no frontmatter, not as one huge field', () => {
    const broken = '---\nid: V-0009\ntitel: "kein Ende"\n\nFließtext hier.';
    const v = parseVorgang(broken);
    expect(v.id).toBeNull();
    expect(v.body).toContain('Fließtext hier.');
  });

  it('never exposes a status field', () => {
    // The corpus has none and its guard rejects one: state is computed from
    // the event log. A parser offering one would create a second source of
    // truth for the one thing that deliberately has a single source.
    const v = parseVorgang(VORGANG.replace('herkunft: ARBEITSLISTE.md', 'herkunft: x\nstatus: offen'));
    expect((v as unknown as Record<string, unknown>).status).toBeUndefined();
    // It is still harvested, so nothing is lost and nothing is acted on.
    expect(v.fields.some(f => f.name === 'status')).toBe(true);
  });
});

describe('event log', () => {
  const LOG = [
    '# Ereignisprotokoll -- nur anhaengen',
    '2026-08-11 | eroeffnet | V-0001 | entscheidet=steuerstand | aus=ARBEITSLISTE.md',
    '2026-08-12 | vermerk | V-0001 | durch=manuel',
    '2026-08-13 | geschlossen | V-0001 | durch=manuel',
    '2026-08-11 | eroeffnet | V-0002 | entscheidet=steuerstand',
  ].join('\n');

  it('skips comments and parses the pipe form', () => {
    const log = parseEreignisLog(LOG);
    expect(log.events).toHaveLength(4);
    expect(log.malformed).toHaveLength(0);
    expect(log.events[0].felder.aus).toBe('ARBEITSLISTE.md');
  });

  it('derives state from the state-changing events only', () => {
    const states = deriveStates(parseEreignisLog(LOG).events);
    expect(states.get('V-0001')?.state).toBe('erledigt');
    expect(states.get('V-0002')?.state).toBe('offen');
  });

  it('lets the latest DATE win, not the last line', () => {
    // Upstream got this wrong until 2026-08-14: an entry appended later about
    // something older would reopen a closed item. Append-only usually makes
    // the two orders agree; when they disagree, file order is the wrong one.
    const outOfOrder = LOG + '\n2026-08-12 | wieder-eroeffnet | V-0001 | durch=manuel';
    const states = deriveStates(parseEreignisLog(outOfOrder).events);
    expect(states.get('V-0001')?.state).toBe('erledigt');
    expect(states.get('V-0001')?.since).toBe('2026-08-13');
  });

  it('breaks ties on the same date by file order', () => {
    const sameDay = [
      '2026-08-11 | eroeffnet | V-0003 |',
      '2026-08-11 | geschlossen | V-0003 |',
    ].join('\n');
    expect(deriveStates(parseEreignisLog(sameDay).events).get('V-0003')?.state).toBe('erledigt');
  });

  it('treats the legacy `ereignis` kind as neutral', () => {
    // Four hand-entered lines from 2026-08-13. Treating it as state-changing
    // would move items it was never meant to move.
    const withLegacy = [
      '2026-08-11 | eroeffnet | V-0004 |',
      '2026-08-12 | geschlossen | V-0004 |',
      '2026-08-13 | ereignis | V-0004 | durch=manuel',
    ].join('\n');
    const log = parseEreignisLog(withLegacy);
    expect(log.unknownKinds).toHaveLength(0);
    expect(deriveStates(log.events).get('V-0004')?.state).toBe('erledigt');
  });

  it('reports an unknown kind instead of guessing at it', () => {
    const log = parseEreignisLog('2026-08-11 | umbenannt | V-0005 |');
    expect(log.unknownKinds).toHaveLength(1);
    expect(log.unknownKinds[0].art).toBe('umbenannt');
    // It is still an event, and it changes no state.
    expect(deriveStates(log.events).get('V-0005')?.state).toBe('unbekannt');
  });

  it('reports a malformed line instead of dropping it', () => {
    const log = parseEreignisLog('nicht mal ein datum | eroeffnet | V-0006');
    expect(log.events).toHaveLength(0);
    expect(log.malformed).toHaveLength(1);
    expect(log.malformed[0].reason).toContain('not a date');
  });

  it('reports `unbekannt` for an item with only neutral events', () => {
    const log = parseEreignisLog('2026-08-11 | vermerk | V-0007 |');
    expect(deriveStates(log.events).get('V-0007')?.state).toBe('unbekannt');
  });
});
