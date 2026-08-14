import { describe, it, expect } from 'bun:test';
import {
  checkContradictions,
  currentRecords,
  statusSaysValid,
  type GraphEdge,
  type RecordState,
} from '../../src/services/curated/contradiction-check.js';

const record = (id: string, status: string | null): RecordState => ({
  id, status, sourcePath: `C:/akten/${id}.md`, sourceLine: 1,
});

const edge = (from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({
  from, to, relation: 'supersedes', certainty: 'sicher',
  sourcePath: `C:/akten/${from}.md`, sourceLine: 4, rawText: `löst ${to} ab`,
  ...over,
});

describe('statusSaysValid', () => {
  it('reads the words that retire a record', () => {
    expect(statusSaysValid('abgelöst durch 0110 am 11.08.2026')).toBe(false);
    expect(statusSaysValid('ersetzt durch 0012')).toBe(false);
    expect(statusSaysValid('zurückgezogen am 11.08.2026')).toBe(false);
    expect(statusSaysValid('erloschen mit dem Durchlauf vom 08.08.2026')).toBe(false);
  });

  it('reads the words that keep it in force', () => {
    expect(statusSaysValid('gilt')).toBe(true);
    expect(statusSaysValid('gilt · Leitentscheidung')).toBe(true);
  });

  it('checks the retiring words FIRST — both spellings contain "gilt"', () => {
    // `nicht mehr gültig` and `ersetzt durch …` can sit beside a `gilt`.
    // Testing the positive first reports a dead record as live.
    expect(statusSaysValid('gilt, ersetzt durch 0012')).toBe(false);
  });

  it('returns null for a record that carries no status', () => {
    // Three records in the measured corpus have none. Treating absent as
    // "gilt" makes them claim a validity nobody wrote down.
    expect(statusSaysValid(null)).toBeNull();
    expect(statusSaysValid('(Rahmenfrage), Teil 2 offen')).toBeNull();
  });
});

describe('direction conflicts', () => {
  it('reports two records declared to supersede each other', () => {
    // The corpus case: both records say 0012 replaced 0011, while the index
    // says the reverse. A supersession pointing the wrong way makes a dead
    // record look current.
    const edges = [
      edge('0012', '0011'),
      edge('0011', '0012', { certainty: 'vermutet', sourcePath: 'C:/akten/LIESMICH.md', sourceLine: 26 }),
    ];
    const findings = checkContradictions(edges, [record('0011', 'ersetzt durch 0012'), record('0012', 'gilt')]);
    const conflict = findings.filter(f => f.kind === 'direction_conflict');
    expect(conflict).toHaveLength(1);
    expect(conflict[0].citations).toHaveLength(2);
    // One leg is only inferred, so the finding is too — saying so is what
    // keeps the weak findings from discrediting the strong ones.
    expect(conflict[0].certainty).toBe('vermutet');
  });

  it('reports the pair once, not once per direction', () => {
    const findings = checkContradictions(
      [edge('0012', '0011'), edge('0011', '0012')],
      [record('0011', null), record('0012', null)],
    );
    expect(findings.filter(f => f.kind === 'direction_conflict')).toHaveLength(1);
  });

  it('stays silent when the graph agrees with itself', () => {
    const findings = checkContradictions(
      [edge('0012', '0011'), edge('0012', '0011', { sourcePath: 'C:/akten/LIESMICH.md' })],
      [record('0011', 'ersetzt durch 0012'), record('0012', 'gilt')],
    );
    expect(findings.filter(f => f.kind === 'direction_conflict')).toHaveLength(0);
  });
});

describe('superseded but still valid', () => {
  it('reports a record whose own status contradicts the graph', () => {
    const findings = checkContradictions([edge('0124', '0062')], [record('0062', 'gilt'), record('0124', 'gilt')]);
    const hit = findings.filter(f => f.kind === 'superseded_but_valid');
    expect(hit).toHaveLength(1);
    expect(hit[0].summary).toContain('0062');
    expect(hit[0].certainty).toBe('sicher');
  });

  it('collapses several sources into ONE finding with several citations', () => {
    // Three files saying the same thing is corroboration, not three problems.
    // A checker that reports it three times is padding its own output.
    const findings = checkContradictions(
      [
        edge('0124', '0062', { certainty: 'vermutet', sourcePath: 'C:/akten/LIESMICH.md', sourceLine: 53 }),
        edge('0124', '0062'),
      ],
      [record('0062', 'gilt'), record('0124', 'gilt')],
    );
    const hit = findings.filter(f => f.kind === 'superseded_but_valid');
    expect(hit).toHaveLength(1);
    // The record's own line plus both declaring sources.
    expect(hit[0].citations).toHaveLength(3);
    // The strongest source sets the strength.
    expect(hit[0].certainty).toBe('sicher');
  });

  it('says nothing when the record already admits it was replaced', () => {
    const findings = checkContradictions([edge('0012', '0011')], [record('0011', 'ersetzt durch 0012'), record('0012', 'gilt')]);
    expect(findings.filter(f => f.kind === 'superseded_but_valid')).toHaveLength(0);
  });

  it('says nothing when the record carries no status at all', () => {
    const findings = checkContradictions([edge('0012', '0011')], [record('0011', null), record('0012', 'gilt')]);
    expect(findings.filter(f => f.kind === 'superseded_but_valid')).toHaveLength(0);
  });
});

describe('unknown targets', () => {
  it('reports an edge pointing at a record that was never imported', () => {
    const findings = checkContradictions([edge('0035', '0005')], [record('0035', 'gilt')]);
    expect(findings.filter(f => f.kind === 'edge_target_unknown')).toHaveLength(1);
  });

  it('never reports a V- reference as missing', () => {
    // Processes live in a stream this checker does not read. Reporting them
    // as missing is reporting on something it cannot see, and a checker that
    // does that teaches people to ignore it.
    const findings = checkContradictions(
      [edge('0113', 'V-0008', { relation: 'closes' })],
      [record('0113', 'gilt')],
    );
    expect(findings.filter(f => f.kind === 'edge_target_unknown')).toHaveLength(0);
  });
});

describe('what holds today', () => {
  it('drops a record the graph supersedes, whatever its status says', () => {
    const current = currentRecords([edge('0124', '0062')], [record('0062', 'gilt'), record('0124', 'gilt')]);
    expect(current).toEqual(['0124']);
  });

  it('drops a record whose own status retires it, with no edge at all', () => {
    expect(currentRecords([], [record('0011', 'zurückgezogen am 11.08.2026'), record('0012', 'gilt')]))
      .toEqual(['0012']);
  });

  it('keeps a record that only an INFERRED edge supersedes', () => {
    // "What holds today" must not turn on a guess. The contradiction check
    // reports the inferred edge separately, where a person can judge it.
    const current = currentRecords(
      [edge('0011', '0012', { certainty: 'vermutet' })],
      [record('0011', 'gilt'), record('0012', 'gilt')],
    );
    expect(current.sort()).toEqual(['0011', '0012']);
  });

  it('keeps a record with no status and no incoming supersession', () => {
    expect(currentRecords([], [record('0113', null)])).toEqual(['0113']);
  });
});
