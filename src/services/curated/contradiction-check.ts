// SPDX-License-Identifier: Apache-2.0
//
// Structural contradiction checks over the decision graph.
//
// THE DESIGN RULE, and the reason this file is short: check only where BOTH
// sides come from a calculation. A first attempt compared text with text and
// reported eleven findings for one real contradiction — it counted every range
// in an index as a relation. The quiet check compared two computed states and
// reported three for three. At a 9% hit rate a checker gets clicked away
// within a fortnight, and then it is worth exactly as much as the full review
// nobody was doing before it.
//
// So: no check in here reads prose. Each one compares a declared status
// against the graph, or the graph against itself.
//
// What is NOT here, deliberately: the substantive class. Whether "Pflichtdatum"
// and "ohne Frist und ohne Übergangszeitraum" contradict each other is a
// question about the subject matter, not about the structure, and a tool that
// answers it is inventing a relation — which is the one thing A2 forbids. The
// tool lays candidates out; a person decides.
//
// ALSO NOT HERE, AND MEASURED RATHER THAN ASSUMED: "a control file declares a
// relation that the record itself does not carry". It was requested with one
// named example — an index reading "0035 schränkt 0005 ein" where record 0035
// did not mention 0005. Two things killed it:
//
//   The example no longer exists. In the corpus delivered a day later, record
//   0035 carries that relation itself, at line 4. The check would have found
//   nothing it was asked to find.
//
//   Deciding which file "belongs to" a record needs a filename heuristic, and
//   that makes one side of the comparison a guess rather than a calculation —
//   the exact thing the design rule above forbids. Implemented anyway and run
//   over the real corpus, it produced 20 findings, of which the visible ones
//   were artefacts of that heuristic: `based_on` edges are declared by their
//   TARGET record, so every one of them looks unbacked.
//
// A control file naming a relation nothing else carries is also not an error.
// It is the reason control files are read at all.

export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
  certainty: string;
  sourcePath: string;
  sourceLine: number;
  rawText?: string | null;
}

export interface RecordState {
  /** Record number, e.g. "0011". */
  id: string;
  /** `Stand:` verbatim, or null when the record carries none. */
  status: string | null;
  sourcePath: string;
  sourceLine: number;
}

export type FindingKind =
  | 'direction_conflict'
  | 'superseded_but_valid'
  | 'edge_target_unknown';

export interface Finding {
  kind: FindingKind;
  /** One sentence stating the defect. */
  summary: string;
  /** Every place that took part, so the reader can go and look. */
  citations: Array<{ path: string; line: number; text: string }>;
  /**
   * 'sicher' only when every side of the contradiction is itself a stated
   * relation. A finding that rests on an inferred edge is reported as
   * 'vermutet' — it is still worth showing, and saying so is what keeps the
   * loud findings from discrediting the quiet ones.
   */
  certainty: 'sicher' | 'vermutet';
}

/** Words in a `Stand:` value that mean the record still applies. */
const VALID_STATUS = /\bgilt\b/i;
/** Words that mean it does not. Checked first — `gilt` occurs inside both. */
const INVALID_STATUS = /\b(abgel(?:ö|oe)st|ersetzt\s+durch|zur(?:ü|ue)ckgezogen|erloschen|nicht\s+mehr\s+g(?:ü|ue)ltig|(?:ü|ue)berholt)\b/i;

/**
 * Does this status say the record still applies?
 *
 * Returns null when the record carries no status at all — three records in the
 * measured corpus do not, and treating "absent" as "gilt" would make them
 * claim a validity nobody wrote down.
 */
export function statusSaysValid(status: string | null): boolean | null {
  if (!status) return null;
  if (INVALID_STATUS.test(status)) return false;
  if (VALID_STATUS.test(status)) return true;
  return null;
}

/** Relations whose presence means the target stopped applying. */
const SUPERSEDING = new Set(['supersedes']);

export function checkContradictions(
  edges: GraphEdge[],
  records: RecordState[],
): Finding[] {
  const findings: Finding[] = [];
  const byId = new Map(records.map(r => [r.id, r]));


  // --- 1. the same relation asserted in both directions -------------------
  //
  // Both sides come from the graph, so this is a calculation against a
  // calculation. In the measured corpus it fires once and correctly: records
  // 0011 and 0012 both state that 0012 replaced 0011, while the index states
  // the reverse. A supersession pointing the wrong way makes a dead record
  // look current, which is the failure the graph exists to prevent.
  const seenPairs = new Set<string>();
  for (const edge of edges) {
    if (!SUPERSEDING.has(edge.relation)) continue;
    const key = [edge.from, edge.to].sort().join('|') + '|' + edge.relation;
    if (seenPairs.has(key)) continue;

    const forward = edges.filter(e => e.relation === edge.relation && e.from === edge.from && e.to === edge.to);
    const backward = edges.filter(e => e.relation === edge.relation && e.from === edge.to && e.to === edge.from);
    if (backward.length === 0) continue;
    seenPairs.add(key);

    const all = [...forward, ...backward];
    findings.push({
      kind: 'direction_conflict',
      summary: `${edge.from} and ${edge.to} are declared to supersede each other. At most one direction can hold.`,
      citations: all.map(e => ({
        path: e.sourcePath,
        line: e.sourceLine,
        text: `${e.from} → ${e.to}: ${e.rawText ?? e.relation}`,
      })),
      // Where the two sides differ in strength, the finding is only as strong
      // as its weakest leg — but a stated edge against an inferred one is
      // exactly the case worth showing, so it is reported either way.
      certainty: all.every(e => e.certainty === 'sicher') ? 'sicher' : 'vermutet',
    });
  }

  // --- 2. superseded, yet still declaring itself valid --------------------
  //
  // The graph says the record was replaced; the record's own status says it
  // applies. Both sides are computed — one from the edge table, one from a
  // parsed field — and neither is prose. This is the shape of the contradiction
  // a control file creates when it retires records that never heard about it:
  // the records keep reading `Stand: gilt`, and anyone opening one believes it.
  //
  // One contradiction is one finding, however many sources declare it. Three
  // files saying the same thing is corroboration, not three problems — and a
  // checker that reports it three times is padding its own output, which is
  // the first step towards being ignored. The sources all become citations of
  // the single finding, and the strongest of them sets its certainty.
  const supersededPairs = new Map<string, { edge: GraphEdge; target: RecordState; sources: GraphEdge[] }>();
  for (const edge of edges) {
    if (!SUPERSEDING.has(edge.relation)) continue;
    const target = byId.get(edge.to);
    if (!target) continue;
    if (statusSaysValid(target.status) !== true) continue;

    const key = `${edge.from}|${edge.to}`;
    const existing = supersededPairs.get(key);
    if (existing) {
      existing.sources.push(edge);
      if (edge.certainty === 'sicher') existing.edge = edge;
    } else {
      supersededPairs.set(key, { edge, target, sources: [edge] });
    }
  }

  for (const { edge, target, sources } of supersededPairs.values()) {
    findings.push({
      kind: 'superseded_but_valid',
      summary: `${edge.to} still reads "${target.status}" although ${edge.from} supersedes it.`,
      citations: [
        { path: target.sourcePath, line: target.sourceLine, text: `${edge.to}: Stand: ${target.status}` },
        ...sources.map(source => ({
          path: source.sourcePath,
          line: source.sourceLine,
          text: `${source.from} → ${source.to}: ${source.rawText ?? source.relation}`,
        })),
      ],
      certainty: sources.some(s => s.certainty === 'sicher') ? 'sicher' : 'vermutet',
    });
  }

  // --- 3. an edge pointing at a record that does not exist ----------------
  //
  // Restricted to the record namespace on purpose. `V-` references are
  // processes, which live in a stream this checker does not read; reporting
  // them as missing would be reporting on something it cannot see, and a
  // checker that does that teaches people to ignore it.
  for (const edge of edges) {
    if (edge.to.startsWith('V-') || byId.has(edge.to)) continue;
    findings.push({
      kind: 'edge_target_unknown',
      summary: `${edge.from} names ${edge.to}, but no record ${edge.to} was imported.`,
      citations: [{
        path: edge.sourcePath,
        line: edge.sourceLine,
        text: edge.rawText ?? `${edge.from} → ${edge.to}`,
      }],
      certainty: edge.certainty === 'sicher' ? 'sicher' : 'vermutet',
    });
  }

  return findings;
}

/**
 * Which records still apply, after the graph is taken into account.
 *
 * "What holds today" is the question the whole corpus exists to answer, and it
 * is not the same as reading the newest record: a record is out of force when
 * something supersedes it, whatever its own status field claims. Where the two
 * disagree, check 2 above reports it — this function simply reports the graph's
 * answer, and never edits a record to match.
 */
export function currentRecords(edges: GraphEdge[], records: RecordState[]): string[] {
  const superseded = new Set(
    edges.filter(e => SUPERSEDING.has(e.relation) && e.certainty === 'sicher').map(e => e.to),
  );
  return records
    .filter(r => !superseded.has(r.id))
    .filter(r => statusSaysValid(r.status) !== false)
    .map(r => r.id);
}
