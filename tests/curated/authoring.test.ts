import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import {
  authorCuratedRecord,
  renderCuratedMarkdown,
  verifyRoundTrip,
  draftFromRecordText,
  setField,
  setRelations,
  authoredSourcePath,
  isValidRecordId,
  RELATION_NAMES,
  type AuthoringStore,
  type CuratedDraft,
} from '../../src/services/curated/authoring.js';
import { applySupersessions } from '../../src/services/curated/supersession.js';
import { ageReport } from '../../src/services/curated/aging.js';
import { queryObservations } from '../../src/services/context/ObservationCompiler.js';

const PROJECT = 'testprojekt';

let store: SessionStore;

beforeEach(() => {
  store = new SessionStore(':memory:');
});

afterEach(() => {
  store.close();
});

function author(draft: CuratedDraft, expectMode?: 'new' | 'existing') {
  return authorCuratedRecord(store as unknown as AuthoringStore, draft, { project: PROJECT, expect: expectMode });
}

describe('direct authoring — the model-free guarantee', () => {
  it('NEVER reaches for anything but plain storage', () => {
    // Same argument as the file importer's test, extended to the new entry
    // point: the observation queue is the only thing in keepmind that calls a
    // model, and this path cannot see it. The allowed set is written out in
    // full on purpose — adding a name here is the moment to check that
    // property again.
    const forbidden: string[] = [];
    const calls: string[] = [];
    const allowed = {
      getOrCreateManualSession: () => { calls.push('getOrCreateManualSession'); return 'session-1'; },
      nextCuratedRecordId: () => { calls.push('nextCuratedRecordId'); return '0001'; },
      getCuratedRecord: () => { calls.push('getCuratedRecord'); return null; },
      storeCuratedRecord: () => { calls.push('storeCuratedRecord'); return { id: 7, createdAtEpoch: 1, revisionsClosed: 0 }; },
      replaceEdgesForSource: () => { calls.push('replaceEdgesForSource'); return { inserted: 1, removed: 0 }; },
    } as unknown as AuthoringStore;

    const strict = new Proxy(allowed as unknown as Record<string, unknown>, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        forbidden.push(prop);
        return () => { throw new Error(`authoring reached for ${prop}`); };
      },
    }) as unknown as AuthoringStore;

    const result = authorCuratedRecord(strict, {
      title: 'Kein Modell auf diesem Weg',
      status: 'gilt',
      relations: [{ relation: 'supersedes', targets: ['0042'] }],
      body: '## Entscheidung\n\nDer Eintrag entsteht direkt in keepmind.',
    }, { project: PROJECT });

    expect(forbidden).toEqual([]);
    expect(result.id).toBe(7);
    expect(calls).toContain('storeCuratedRecord');
    expect(calls).not.toContain('storeObservation');
  });
});

describe('rendering and the round trip', () => {
  it('produces a record the file reader parses back identically', () => {
    const draft: CuratedDraft = {
      title: 'Weg B ohne Dateiablage',
      status: 'gilt',
      date: '25.08.2026',
      decidedBy: 'die Betreiberin',
      summary: 'Bleibendes lebt in keepmind, offene Arbeit im Issue-Tracker.',
      relations: [
        { relation: 'supersedes', targets: ['0042'] },
        { relation: 'restricts', targets: ['0043'] },
      ],
      body: '## Begründung\n\nEine Ablage, die nur per Datei änderbar ist, wächst an der Oberfläche.',
    };
    const round = verifyRoundTrip(draft, '0100');

    expect(round.parsed.id).toBe('0100');
    expect(round.parsed.title).toBe('Weg B ohne Dateiablage');
    expect(round.parsed.status).toBe('gilt');
    expect(round.parsed.date).toBe('25.08.2026');
    expect(round.parsed.summary).toBe('Bleibendes lebt in keepmind, offene Arbeit im Issue-Tracker.');

    // Both relations come back CERTAIN. That is the whole reason the clauses
    // carry a verb rather than sitting under a relation-bearing label: only
    // certain edges are ever applied, so a 'vermutet' here would mean an
    // authored supersession silently never retires anything.
    expect(round.edges).toHaveLength(2);
    for (const edge of round.edges) expect(edge.certainty).toBe('sicher');
    expect(round.edges.find(e => e.relation === 'supersedes')).toMatchObject({ from: '0100', to: '0042' });
    expect(round.edges.find(e => e.relation === 'restricts')).toMatchObject({ from: '0100', to: '0043' });
  });

  it('renders a usable clause for every relation the lexicon knows', () => {
    for (const relation of RELATION_NAMES) {
      const targets = relation === 'resolves' ? ['0042', '0043'] : ['0042'];
      const round = verifyRoundTrip(
        { title: `Relation ${relation}`, relations: [{ relation, targets }] },
        '0100',
      );
      expect(round.edges.length).toBe(targets.length);
      for (const edge of round.edges) {
        expect(edge.relation).toBe(relation);
        expect(edge.certainty).toBe('sicher');
      }
    }
  });

  it('refuses a header-less record whose prose would be read as header', () => {
    // Without a header field the first paragraph IS the header block, and every
    // record number in it becomes a declared relation. Refused, not silently
    // stored: this produced a certain supersession nobody wrote down.
    expect(() => verifyRoundTrip(
      { title: 'Nur Fliesstext', body: 'Dieser Absatz löst 0042 ab, behauptet der Text.' },
      '0100',
    )).toThrow(/would not be read back as the body/);
  });

  it('keeps prose out of the graph once the record has a header', () => {
    const round = verifyRoundTrip(
      { title: 'Mit Kopf', status: 'gilt', body: 'Dieser Absatz löst 0042 ab, behauptet der Text.' },
      '0100',
    );
    expect(round.edges).toEqual([]);
    expect(round.parsed.body).toBe('Dieser Absatz löst 0042 ab, behauptet der Text.');
  });

  it('rejects a record number the edge reader would not recognise', () => {
    expect(isValidRecordId('0042')).toBe(true);
    expect(isValidRecordId('V-0187')).toBe(true);
    expect(isValidRecordId('1042')).toBe(false);
    expect(() => renderCuratedMarkdown(
      { title: 'x', relations: [{ relation: 'supersedes', targets: ['1042'] }] }, '0100',
    )).toThrow(/not a record number/);
  });

  it('refuses a header field that spans lines rather than mangling it', () => {
    expect(() => renderCuratedMarkdown({ title: 'x', summary: 'eine\nzweite Zeile' }, '0100'))
      .toThrow(/one line each/);
  });
});

describe('edit in place', () => {
  it('changes the same entry instead of stacking a second one', () => {
    const created = author({
      title: 'Erste Fassung',
      status: 'gilt',
      body: '## Entscheidung\n\nSo war es zuerst gemeint.',
    });
    expect(created.recordId).toBe('0001');
    expect(created.edited).toBe(false);

    const edited = author({
      recordId: '0001',
      title: 'Erste Fassung',
      status: 'gilt',
      body: '## Entscheidung\n\nSo ist es jetzt gemeint.',
    }, 'existing');

    expect(edited.recordId).toBe('0001');
    expect(edited.edited).toBe(true);
    expect(edited.revisionsClosed).toBe(1);

    // The surface holds exactly one entry for the record…
    const active = store.db.prepare(
      `SELECT COUNT(*) AS c FROM observations
        WHERE project = ? AND source_kind = 'curated'
          AND json_extract(metadata, '$.record_id') = '0001' AND valid_to IS NULL`,
    ).get(PROJECT) as { c: number };
    expect(active.c).toBe(1);

    // …and it says the new thing.
    const current = store.getCuratedRecord(PROJECT, '0001');
    expect(current?.narrative).toContain('So ist es jetzt gemeint.');
    expect(current?.narrative).not.toContain('So war es zuerst gemeint.');

    // The history is still there, closed rather than deleted.
    const revisions = store.getCuratedRevisions(PROJECT, '0001');
    expect(revisions).toHaveLength(2);
    const closed = revisions.find(r => r.valid_to !== null);
    expect(closed?.narrative).toContain('So war es zuerst gemeint.');
    expect(JSON.parse(closed?.metadata ?? '{}').revised_by).toBe(edited.id);
  });

  it('carries through header labels the CLI has no flag for', () => {
    author({
      title: 'Mit eigenem Feld',
      status: 'gilt',
      fields: [{ name: 'Wirkung', value: 'ab sofort' }],
      body: 'Text.',
    });

    const current = store.getCuratedRecord(PROJECT, '0001');
    const draft = draftFromRecordText('0001', 'Mit eigenem Feld', current?.narrative ?? '');
    setField(draft, 'Stand', 'abgelöst');

    const edited = author({ ...draft, recordId: '0001' }, 'existing');
    expect(edited.edited).toBe(true);

    const after = store.getCuratedRecord(PROJECT, '0001');
    expect(after?.narrative).toContain('**Wirkung:** ab sofort');
    expect(after?.narrative).toContain('**Stand:** abgelöst');
  });

  it('drops an edge when the edit drops its relation', () => {
    author({ title: 'Mit Bezug', relations: [{ relation: 'concerns', targets: ['0042'] }] });
    expect(store.getEdges(PROJECT)).toHaveLength(1);

    const draft: CuratedDraft = { recordId: '0001', title: 'Mit Bezug' };
    setRelations(draft, []);
    author(draft, 'existing');

    // A relation that survives only because nobody re-read the record is an
    // assertion nobody can check.
    expect(store.getEdges(PROJECT)).toHaveLength(0);
  });

  it('re-authoring identical text stays idempotent and leaves one active row', () => {
    const draft: CuratedDraft = { recordId: '0001', title: 'Unverändert', status: 'gilt', body: 'Gleich.' };
    author(draft);
    author({ ...draft }, 'existing');
    author({ ...draft }, 'existing');

    const rows = store.getCuratedRevisions(PROJECT, '0001');
    expect(rows.filter(r => r.valid_to === null)).toHaveLength(1);
  });

  it('refuses to invent a record under an edit, and to overwrite one under an add', () => {
    author({ recordId: '0001', title: 'Da' });
    expect(() => author({ recordId: '0002', title: 'Nicht da' }, 'existing')).toThrow(/does not exist/);
    expect(() => author({ recordId: '0001', title: 'Schon da' }, 'new')).toThrow(/already exists/);
  });

  it('never re-uses a record number, not even a retired one', () => {
    author({ title: 'Eins' });
    author({ title: 'Zwei' });
    store.closeCuratedRecord(PROJECT, '0002', { reason: 'gilt nicht mehr' });
    const third = author({ title: 'Drei' });
    expect(third.recordId).toBe('0003');
  });
});

describe('authored records and the deterministic machinery around them', () => {
  it('supersession retires the record an authored relation names', () => {
    author({ title: 'Alte Regel', status: 'gilt' });
    author({ title: 'Neue Regel', status: 'gilt', relations: [{ relation: 'supersedes', targets: ['0001'] }] });

    const report = applySupersessions(store.db as never, PROJECT);
    expect(report.closed).toEqual([expect.objectContaining({ record: '0001', supersededBy: '0002' })]);
    expect(store.getCuratedRecord(PROJECT, '0001')).toBeNull();
    expect(store.getCuratedRecord(PROJECT, '0002')).not.toBeNull();
  });

  it('supersession closes the CURRENT revision, not one an edit already replaced', () => {
    author({ title: 'Alte Regel', status: 'gilt' });
    author({ recordId: '0001', title: 'Alte Regel', status: 'gilt', body: 'Zweite Fassung.' }, 'existing');
    author({ title: 'Neue Regel', relations: [{ relation: 'supersedes', targets: ['0001'] }] });

    applySupersessions(store.db as never, PROJECT);

    // Nothing for 0001 is current any more. Before the ordering fix in
    // supersession.ts the retired row was whichever revision the scan happened
    // to see last, so the record kept applying while the report said it had
    // been retired.
    expect(store.getCuratedRecord(PROJECT, '0001')).toBeNull();
  });

  it('editing a retired record corrects its text without putting it back in force', () => {
    author({ title: 'Alte Regel', status: 'gilt' });
    author({ title: 'Neue Regel', status: 'gilt', relations: [{ relation: 'supersedes', targets: ['0001'] }] });
    applySupersessions(store.db as never, PROJECT);
    expect(store.getCuratedRecord(PROJECT, '0001')).toBeNull();

    // Fixing a typo in history must stay possible…
    author({ recordId: '0001', title: 'Alte Regel', status: 'gilt', body: '## Nachtrag\n\nTippfehler berichtigt.' }, 'existing');

    // …and must not resurrect the record. Nothing would report that: the
    // retired rule would simply start applying beside the one that replaced it.
    expect(store.getCuratedRecord(PROJECT, '0001')).toBeNull();
    const newest = store.getCuratedRevisions(PROJECT, '0001')[0];
    expect(newest.narrative).toContain('Tippfehler berichtigt.');
    expect(JSON.parse(newest.metadata ?? '{}').superseded_by_record).toBe('0002');

    // A later recompute agrees, rather than reopening it.
    applySupersessions(store.db as never, PROJECT);
    expect(store.getCuratedRecord(PROJECT, '0001')).toBeNull();
  });

  it('lists one entry per record in the aging report, not one per revision', () => {
    author({ title: 'Eins', status: 'gilt' });
    author({ recordId: '0001', title: 'Eins', status: 'gilt', body: 'zweite Fassung' }, 'existing');
    author({ recordId: '0001', title: 'Eins', status: 'gilt', body: 'dritte Fassung' }, 'existing');

    const report = ageReport(store.db as never, PROJECT);
    expect(report).toHaveLength(1);
    expect(report[0].recordId).toBe('0001');
    expect(report[0].retired).toBe(false);
  });

  it('does not grow the injected session-start block with every edit', () => {
    // THE token-budget property of edit-in-place. Injection selects
    // `valid_to IS NULL` (ObservationCompiler), and a revision that an edit
    // replaced is closed — so five edits of one entry inject one entry, not
    // five. Asserted through the compiler's own query rather than a copy of
    // its WHERE clause, so a change there fails here.
    const config = {
      totalObservationCount: 100,
      fullObservationCount: 100,
      sessionCount: 5,
      showReadTokens: false, showWorkTokens: false,
      showSavingsAmount: false, showSavingsPercent: false,
      observationTypes: new Set(['decision']),
      observationConcepts: new Set<string>(),
      fullObservationField: 'narrative' as const,
      showLastSummary: false, showLastMessage: false,
      injectSourceKind: 'all' as const,
    };

    author({ title: 'Ein Eintrag', status: 'gilt', body: 'Fassung 1' });
    const afterFirst = queryObservations(store, PROJECT, config as never).length;

    for (let i = 2; i <= 6; i++) {
      author({ recordId: '0001', title: 'Ein Eintrag', status: 'gilt', body: `Fassung ${i}` }, 'existing');
    }
    expect(store.getCuratedRevisions(PROJECT, '0001')).toHaveLength(6);
    expect(queryObservations(store, PROJECT, config as never).length).toBe(afterFirst);
  });

  it('cites a stable, obviously-not-a-file source path', () => {
    const result = author({ title: 'Zitierbar' });
    expect(result.sourcePath).toBe(authoredSourcePath('0001'));
    const row = store.getCuratedRecord(PROJECT, '0001');
    expect(row?.source_path).toBe('keepmind://curated/0001');
    expect(row?.source_line).toBe(1);
  });

  it('honours an author-declared validity window', () => {
    const from = Date.UTC(2026, 0, 1);
    const to = Date.UTC(2027, 0, 1);
    author({ title: 'Befristet', validFrom: from, validTo: to });
    const row = store.getCuratedRevisions(PROJECT, '0001')[0];
    expect(row.valid_from).toBe(from);
    expect(row.valid_to).toBe(to);
  });

  it('closes and reopens a record by hand without touching its text', () => {
    author({ title: 'Wird zurückgezogen', status: 'gilt', body: 'Der Text bleibt.' });
    expect(store.closeCuratedRecord(PROJECT, '0001', { reason: 'überholt' }).closed).toBe(1);
    expect(store.getCuratedRecord(PROJECT, '0001')).toBeNull();

    const closed = store.getCuratedRevisions(PROJECT, '0001')[0];
    expect(closed.narrative).toContain('Der Text bleibt.');
    expect(JSON.parse(closed.metadata ?? '{}').closed_reason).toBe('überholt');

    expect(store.reopenCuratedRecord(PROJECT, '0001').reopened).toBe(1);
    expect(store.getCuratedRecord(PROJECT, '0001')).not.toBeNull();
  });

  it('does not let supersession undo a close the author made by hand', () => {
    author({ title: 'Von Hand geschlossen' });
    store.closeCuratedRecord(PROJECT, '0001', { reason: 'erledigt' });
    applySupersessions(store.db as never, PROJECT);
    expect(store.getCuratedRecord(PROJECT, '0001')).toBeNull();
  });
});
