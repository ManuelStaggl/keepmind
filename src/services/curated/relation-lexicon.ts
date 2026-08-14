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
}

/**
 * Ordered: the FIRST match wins, so reversing phrases must precede their
 * forward counterparts. `abgelöst durch` contains `abgelöst`; if the plain
 * form were tested first every reversal would be read forwards.
 */
export const RELATION_PATTERNS: RelationPattern[] = [
  // --- reversing forms first ---
  { relation: 'supersedes', pattern: /\babgel(?:ö|oe)st\s+durch\s*:?\s*$/i, forward: false },
  { relation: 'supersedes', pattern: /\bersetzt\s+durch\s*:?\s*$/i, forward: false },
  { relation: 'triggered_by', pattern: /\bausgel(?:ö|oe)st\s+von\s*:?\s*$/i, forward: false },
  { relation: 'based_on', pattern: /\bgrundlagen?\s*:?\s*(?:akten?\s*)?$/i, forward: false },
  { relation: 'corrects', pattern: /\bberichtigt\s+(?:die\s+)?erwartung\s+aus\s*:?\s*$/i, forward: true },

  // --- forward forms ---
  { relation: 'supersedes', pattern: /\bl(?:ö|oe)st\s*$/i, forward: true },
  { relation: 'supersedes', pattern: /\bersetzt\s*:?\s*(?:akten?\s*)?$/i, forward: true },
  { relation: 'resolves', pattern: /\bl(?:ö|oe)st\s+eine\s+kollision\s+zwischen\s*$/i, forward: true },
  { relation: 'restricts', pattern: /\bschr(?:ä|ae)nkt\s*(?:ein)?\s*:?\s*(?:akten?\s*)?$/i, forward: true },
  { relation: 'restricts', pattern: /\bbegrenzt\s*:?\s*$/i, forward: true },
  { relation: 'sharpens', pattern: /\bsch(?:ä|ae)rft\s*:?\s*(?:akten?\s*)?$/i, forward: true },
  { relation: 'continues', pattern: /\bsetzt\s+fort\s*:?\s*$/i, forward: true },
  { relation: 'continues', pattern: /\bsetzt\s*$/i, forward: true },
  { relation: 'corrects', pattern: /\bberichtigt\s*:?\s*(?:akten?\s*)?$/i, forward: true },
  { relation: 'closes', pattern: /\bschliesst\s+ab\s*:?\s*$/i, forward: true },
  { relation: 'closes', pattern: /\bschl(?:ie|ei)sst\s*:?\s*$/i, forward: true },
  { relation: 'extends', pattern: /\berg(?:ä|ae)nzt\s*:?\s*(?:akten?\s*)?$/i, forward: true },
  { relation: 'applies', pattern: /\bwendet\s*$/i, forward: true },
  { relation: 'applies', pattern: /\banwendung\s+von\s*$/i, forward: true },
  { relation: 'confirms', pattern: /\bbest(?:ä|ae)tigt\s*:?\s*$/i, forward: true },
  { relation: 'concerns', pattern: /\bbetrifft\s*:?\s*$/i, forward: true },
  { relation: 'reverses', pattern: /\bkehrt\s*$/i, forward: true },
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

/** Match the relation phrase ending at `text`, or null. */
export function matchRelation(text: string): RelationPattern | null {
  for (const candidate of RELATION_PATTERNS) {
    if (candidate.pattern.test(text)) return candidate;
  }
  return null;
}
