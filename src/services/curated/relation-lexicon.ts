// SPDX-License-Identifier: Apache-2.0
//
// The closed set of relations a curated record can declare.
//
// Field NAMES are open — records invent new labels, and a reader that assumes
// a fixed set loses edges silently. RELATIONS are closed: the same fifteen
// verbs recur, they only move between the field name and the field value.
// That asymmetry is the reason a deterministic graph is possible here at all,
// so this file is the one place allowed to enumerate anything.
//
// Every entry below was harvested from the measured corpus, not invented.

/** Canonical relation names. Stored in `decision_edges.relation`. */
export type RelationName =
  | 'supersedes'      // löst ab / ersetzt
  | 'restricts'       // schränkt ein / begrenzt
  | 'sharpens'        // schärft
  | 'continues'       // setzt fort
  | 'corrects'        // berichtigt
  | 'closes'          // schliesst / schliesst ab
  | 'extends'         // ergänzt
  | 'applies'         // wendet an
  | 'confirms'        // bestätigt
  | 'concerns'        // betrifft
  | 'based_on'        // Grundlage
  | 'triggered_by'    // ausgelöst von
  | 'reverses'        // kehrt um
  | 'resolves';       // löst eine Kollision zwischen

export interface RelationPattern {
  relation: RelationName;
  /**
   * Matches the phrase that introduces the reference. Anchored at the end,
   * because the reference follows the verb.
   */
  pattern: RegExp;
  /**
   * false when the phrase reverses the direction: `abgelöst durch 0110` says
   * THIS record is superseded BY 0110, while `löst 0093 ab` says the opposite.
   * Reading both as "from -> to" points half the supersession chain backwards,
   * and a backwards supersession makes a superseded record look current — the
   * exact failure the graph exists to prevent.
   */
  forward: boolean;
  /**
   * Does this phrase STATE the relation, or merely FILE the reference under a
   * heading?
   *
   * The distinction decides certainty when the phrase appears as a field LABEL
   * rather than inside a sentence. `**Löst ab:** 0093` and `**Vermerk:** löst
   * 0093 ab` are the same declaration written two ways — the record contains
   * the verb either way, and the difference is layout. `**Grundlage:** 0002`
   * is not: it names a category and lists a reference under it, and nobody
   * wrote down what 0002 has to do with anything.
   *
   * Treating both as `vermutet` cost real supersessions. `vermutet` edges are
   * never applied (supersession.ts), so a record declaring `**Löst ab:** 0093`
   * in the canonical header form retired nothing at all, silently, and the
   * superseded record kept answering as current. Measured on the delivered
   * corpus: 0110→0093, 0131→0054, 0137→0064, 0012→0011, 0074→0072.
   *
   * So: verb forms are declarations, noun forms are headings. That is the only
   * rule here, and it is a property of the phrase, not of the record.
   */
  declarative: boolean;
}

/**
 * Ordered: the FIRST match wins, so reversing phrases must precede their
 * forward counterparts. `abgelöst durch` contains `abgelöst`; if the plain
 * form were tested first every reversal would be read forwards.
 */
export const RELATION_PATTERNS: RelationPattern[] = [
  // --- reversing forms first ---
  { relation: 'supersedes', pattern: /\babgel(?:ö|oe)st\s+durch\s*:?\s*$/i, forward: false, declarative: true },
  { relation: 'supersedes', pattern: /\bersetzt\s+durch\s*:?\s*$/i, forward: false, declarative: true },
  // `0140 hebt 0135 auf` in the reverse voice. Kept next to its counterpart so
  // the pair is read as one decision — a reversing form added on its own is
  // how half a supersession chain ends up pointing backwards.
  { relation: 'supersedes', pattern: /\baufgehoben\s+durch\s*:?\s*$/i, forward: false, declarative: true },
  { relation: 'triggered_by', pattern: /\bausgel(?:ö|oe)st\s+von\s*:?\s*$/i, forward: false, declarative: true },
  { relation: 'based_on', pattern: /\bgrundlagen?\s*:?\s*(?:akten?\s*)?$/i, forward: false, declarative: false },
  { relation: 'corrects', pattern: /\bberichtigt\s+(?:die\s+)?erwartung\s+aus\s*:?\s*$/i, forward: true, declarative: true },

  // --- forward forms ---
  // `Löst ab: 0093` — the label spelling of the separable verb, with both
  // halves in front of the reference. Missing until 4.3.1: `löst 0093 ab`
  // matched and `Löst ab: 0093` matched NOTHING, so the canonical header form
  // of the most consequential relation in the corpus produced no edge at all.
  { relation: 'supersedes', pattern: /\bl(?:ö|oe)st\s+ab\s*:?\s*$/i, forward: true, declarative: true },
  { relation: 'supersedes', pattern: /\bl(?:ö|oe)st\s*$/i, forward: true, declarative: true },
  { relation: 'supersedes', pattern: /\bersetzt\s*:?\s*(?:akten?\s*)?$/i, forward: true, declarative: true },
  // `hebt 0135 auf` — a separable verb, so only its first half stands in front
  // of the reference. The label spelling `Hebt auf: 0135` puts both halves
  // there, hence two patterns for one verb. Missing entirely until 4.3.0: the
  // whole phrase read as no relation at all, and 0135 stayed in force with
  // 0140 plainly saying otherwise.
  { relation: 'supersedes', pattern: /\bhebt\s+auf\s*:?\s*$/i, forward: true, declarative: true },
  { relation: 'supersedes', pattern: /\bhebt\s*$/i, forward: true, declarative: true },
  { relation: 'supersedes', pattern: /\baufhebung\s+(?:von|der\s+akte)\s*:?\s*$/i, forward: true, declarative: false },
  { relation: 'resolves', pattern: /\bl(?:ö|oe)st\s+eine\s+kollision\s+zwischen\s*$/i, forward: true, declarative: true },
  { relation: 'restricts', pattern: /\bschr(?:ä|ae)nkt\s*(?:ein)?\s*:?\s*(?:akten?\s*)?$/i, forward: true, declarative: true },
  { relation: 'restricts', pattern: /\bbegrenzt\s*:?\s*$/i, forward: true, declarative: true },
  { relation: 'sharpens', pattern: /\bsch(?:ä|ae)rft\s*:?\s*(?:akten?\s*)?$/i, forward: true, declarative: true },
  { relation: 'continues', pattern: /\bsetzt\s+fort\s*:?\s*$/i, forward: true, declarative: true },
  { relation: 'continues', pattern: /\bsetzt\s*$/i, forward: true, declarative: true },
  { relation: 'corrects', pattern: /\bberichtigt\s*:?\s*(?:akten?\s*)?$/i, forward: true, declarative: true },
  { relation: 'closes', pattern: /\bschliesst\s+ab\s*:?\s*$/i, forward: true, declarative: true },
  { relation: 'closes', pattern: /\bschl(?:ie|ei)sst\s*:?\s*$/i, forward: true, declarative: true },
  { relation: 'extends', pattern: /\berg(?:ä|ae)nzt\s*:?\s*(?:akten?\s*)?$/i, forward: true, declarative: true },
  { relation: 'applies', pattern: /\bwendet\s*$/i, forward: true, declarative: true },
  { relation: 'applies', pattern: /\banwendung\s+von\s*$/i, forward: true, declarative: false },
  { relation: 'confirms', pattern: /\bbest(?:ä|ae)tigt\s*:?\s*$/i, forward: true, declarative: true },
  { relation: 'concerns', pattern: /\bbetrifft\s*:?\s*$/i, forward: true, declarative: true },
  { relation: 'reverses', pattern: /\bkehrt\s*$/i, forward: true, declarative: true },
];

/**
 * Words that cancel a relation.
 *
 * Deliberately NOT folded away the way stopwords are: `berührt 0110 nicht`
 * states the absence of a relation, and a reader that drops the negation
 * creates the edge the sentence exists to deny. The corpus contains exactly
 * that record, and the warning about it was the client's own — it is their
 * "a wrongly placed supersession hides a rule that still applies", present as
 * data rather than as a worry.
 */
const NEGATIONS = /\b(nicht|kein|keine|keinen|keiner|ohne)\b/i;

/**
 * Does a clause negate its relation?
 *
 * `text` is the span from the relation verb to just past the reference. The
 * subtlety: a negation inside parentheses belongs to the TARGET, not to the
 * relation — `0010 (Pilot bezieht die Bausteine nicht), 0050` is three valid
 * edges, and treating the parenthetical as a cancel drops all three. So
 * parentheses are removed before the test, not searched.
 */
export function negatesRelation(text: string): boolean {
  const withoutParentheticals = text.replace(/\([^)]*\)/g, ' ');
  return NEGATIONS.test(withoutParentheticals);
}

/**
 * A qualifier that narrows a relation's SCOPE without weakening it.
 *
 * `Löst 0054 in diesem Umfang ab` is a supersession. It is a partial one, and
 * the wording says so — but partial is a statement about how far the relation
 * reaches, not about whether it was declared. Every pattern above is anchored
 * at the end of the text in front of the reference, so a qualifier sitting
 * between the verb and the record number pushed the verb out of reach and the
 * phrase matched nothing: the edge fell back to whatever the field LABEL said,
 * or vanished. The corpus writes it both ways round (`ersetzt 0093 und 0094 in
 * diesem Punkt`, `löst in diesem Umfang 0054 ab`), and only the second word
 * order was affected — which is why it looked like an occasional fault rather
 * than a missing rule.
 *
 * Stripped once and only when nothing matched, so this can widen what is
 * recognised and can never change what already was.
 */
const SCOPE_QUALIFIER = /\s+(?:teilweise|nur|insoweit|soweit|in\s+diesem\s+(?:umfang|punkt|teil)|im\s+(?:umfang|wesentlichen)|in\s+diesen\s+punkten)\s*$/i;

/** Match the relation phrase ending at `text`, or null. */
export function matchRelation(text: string): RelationPattern | null {
  for (const candidate of RELATION_PATTERNS) {
    if (candidate.pattern.test(text)) return candidate;
  }

  const withoutQualifier = text.replace(SCOPE_QUALIFIER, ' ');
  if (withoutQualifier === text) return null;
  for (const candidate of RELATION_PATTERNS) {
    if (candidate.pattern.test(withoutQualifier)) return candidate;
  }
  return null;
}
