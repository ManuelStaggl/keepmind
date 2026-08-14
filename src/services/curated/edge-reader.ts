// SPDX-License-Identifier: Apache-2.0
//
// Reads declared relations out of curated records.
//
// The one rule: an edge is only ever created from a relation someone WROTE
// DOWN. Nothing here infers, scores or compares. That is the whole difference
// between this and the near-dup reconciler, which decides supersession from
// similarity and would happily fold a correction onto the thing it corrects.
//
// Everything below that looks like fussiness is a measured failure:
//   61% -> 85% recovery came from ONE fix (values carry their own emphasis),
//   four valid edges were lost to a negation inside parentheses,
//   one invalid edge was created from a filename containing the word "nicht",
//   and a numeric range in an index was read as four relations that no
//   sentence claims.

import { stripMarkdownLinks, stripSoftHyphens, type ParsedAkte } from './akten-parser.js';
import { matchRelation, negatesRelation, type RelationName } from './relation-lexicon.js';

export type EdgeCertainty = 'sicher' | 'vermutet';

export interface DecisionEdge {
  /** Record that declares the edge, e.g. "0068". */
  from: string;
  /** Record it points at, e.g. "0042". Same namespace as `from`. */
  to: string;
  relation: RelationName;
  /**
   * 'sicher' — the relation verb and the reference sit in the same clause.
   * 'vermutet' — the reference was found under a relation-bearing FIELD NAME
   * with no verb of its own next to it. Kept apart because A2 forbids
   * inventing edges, and "the label said so" is weaker evidence than "the
   * sentence said so" without being worthless.
   */
  certainty: EdgeCertainty;
  sourcePath: string;
  /** 1-based line the edge was read from. */
  sourceLine: number;
  /** The clause the edge came from, for display and for disputes. */
  rawText: string;
}

export interface EdgeExtraction {
  edges: DecisionEdge[];
  /**
   * References that carried a relation verb but were rejected, with the
   * reason. Reported rather than dropped: a reader that silently declines is
   * indistinguishable from one that did not look.
   */
  rejected: Array<{ to: string; reason: string; line: number; rawText: string }>;
}

/** `0068`, `V-0168`. The `V-` namespace is processes, not decisions. */
const REFERENCE = /\b(V-)?(\d{4})\b/g;

/**
 * Is the four-digit number at `index` the year of a date?
 *
 * `abgelöst durch 0110 am 11.08.2026` contains TWO four-digit numbers, and
 * only one of them is a record. The year inherits whatever relation is active
 * and produces a second, entirely fictional edge — here a supersession by
 * record "2026". Dates appear in almost every header, so this is not an edge
 * case; it is the common case.
 */
function isDatePart(line: string, index: number): boolean {
  // Preceded by a date separator that is itself preceded by a digit:
  // `08.2026`, `08-2026`.
  if (index >= 2 && /[.\-/]/.test(line[index - 1]) && /\d/.test(line[index - 2])) return true;
  // Followed by a separator and more digits: `2026-08-13`, `2026.08.13`.
  if (/^[.\-/]\d/.test(line.slice(index + 4))) return true;
  return false;
}

/**
 * Is a bare four-digit number a record number at all?
 *
 * Every record in the measured corpus is zero-padded (`0001`…`0130`), and
 * every four-digit number that is NOT zero-padded turned out to be a year.
 * Requiring the leading zero removes the whole phantom class in one rule
 * instead of chasing date formats one separator at a time — `2026-08-13` and
 * a bare "seit 2026" both stop being records.
 *
 * `V-` prefixed references are exempt: they carry their namespace and are
 * unambiguous whatever their digits.
 */
function isRecordNumber(prefix: string | undefined, digits: string): boolean {
  if (prefix) return true;
  return digits.startsWith('0');
}
/**
 * `0050–0053` and `0050-0053` enumerate the records between the endpoints.
 * `Setzt fort: 0050–0053` genuinely means four records. But a wide span in an
 * index (`0001–0049`) is a table of contents, not four hundred and ninety
 * relations, so a span is only expanded when a relation verb introduces it AND
 * it stays small.
 */
const SPAN = /\b(V-)?(\d{4})\s*[–—-]\s*(V-)?(\d{4})\b/g;
const MAX_SPAN = 12;

/** Expand `0050–0053` to the four records it names. */
function expandSpan(prefix: string, first: string, last: string): string[] | null {
  const from = parseInt(first, 10);
  const to = parseInt(last, 10);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null;
  if (to - from + 1 > MAX_SPAN) return null;
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${prefix}${String(n).padStart(4, '0')}`);
  return out;
}

/** Normalise one line before any rule looks at it. */
function prepare(line: string): string {
  // Link text first: the href is a slug built from the target's title and
  // routinely contains words that flip a later negation test.
  return stripSoftHyphens(stripMarkdownLinks(line)).replace(/\*\*/g, '').replace(/\*/g, '');
}

/**
 * Read every declared edge out of one record's header.
 *
 * `selfId` is the record declaring them. Header only: a relation stated in the
 * prose of a body section is an argument, not a declaration, and treating the
 * two alike is how a reader starts inventing.
 */
export function extractEdges(
  parsed: ParsedAkte,
  sourcePath: string,
  selfId?: string,
): EdgeExtraction {
  const from = selfId ?? parsed.id;
  const edges: DecisionEdge[] = [];
  const rejected: EdgeExtraction['rejected'] = [];
  if (!from) return { edges, rejected };

  const startLine = parsed.headerStartLine;
  const lines = parsed.headerText.split('\n');

  /**
   * Scan ONE `·`-delimited statement.
   *
   * The split matters: a header line carries several independent statements,
   * and a negation belongs to the statement that wrote it. Scanning whole
   * lines rejected `betrifft V-0187` because `Schliesst: keinen Vorgang` sat
   * in front of it on the same line — five valid edges lost to a "keinen"
   * that was never about them.
   */
  const scanClause = (
    rawClause: string,
    lineNumber: number,
    labelRelation: ReturnType<typeof matchRelation>,
    seen: Set<string>,
  ): void => {
    if (!from) return;

    // When the label IS the relation (`Grundlage: 0002, 0003`), the label text
    // sits in front of every reference and would match as a verb, promoting
    // every such edge to 'sicher'. Blank it out so only a verb the sentence
    // actually contains can do that. Blanked rather than removed, to keep the
    // offsets that the rawText excerpt is cut from.
    const line = labelRelation
      ? rawClause.replace(/^(\s*[^:]{1,60}?\s*:)/, (m) => ' '.repeat(m.length))
      : rawClause;

    // --- spans first, so their endpoints are not also read as singletons ---
    SPAN.lastIndex = 0;
    let span: RegExpExecArray | null;
    while ((span = SPAN.exec(line)) !== null) {
      const before = line.slice(0, span.index);
      const relation = matchRelation(before) ?? labelRelation;
      if (!relation) continue;
      const expanded = expandSpan(span[1] ?? '', span[2], span[4]);
      const clause = line.slice(Math.max(0, span.index - 60), span.index + span[0].length + 40);
      if (!expanded) {
        // Mark the endpoints as handled. Otherwise the single-reference scan
        // below reads `0001–0049` as two ordinary references and creates the
        // two edges the span rule just refused — a rejection that rejects
        // nothing is worse than no rule.
        seen.add(`${span[1] ?? ''}${span[2]}`);
        seen.add(`${span[3] ?? ''}${span[4]}`);
        rejected.push({ to: span[0], reason: 'span too wide to be an enumeration', line: lineNumber, rawText: clause.trim() });
        continue;
      }
      if (negatesRelation(clause)) {
        rejected.push({ to: span[0], reason: 'relation negated', line: lineNumber, rawText: clause.trim() });
        continue;
      }
      for (const target of expanded) {
        if (target === from) continue;
        seen.add(target);
        edges.push({
          from: relation.forward ? from : target,
          to: relation.forward ? target : from,
          relation: relation.relation,
          certainty: matchRelation(before) ? 'sicher' : 'vermutet',
          sourcePath,
          sourceLine: lineNumber,
          rawText: clause.trim(),
        });
      }
    }

    // --- single references ---
    //
    // A verb governs the whole list that follows it: `betrifft V-0187, V-0190`
    // is two edges, not one. Testing each reference against only the text
    // immediately in front of it finds the verb for the first item and nothing
    // for the rest — an enumeration silently collapses to its first element.
    // So the relation stays active until another verb replaces it.
    let activeRelation = labelRelation;
    let activeIsVerb = false;
    /** End of the last accepted reference, or -1 when no list is open. */
    let listAnchor = -1;

    REFERENCE.lastIndex = 0;
    let ref: RegExpExecArray | null;
    while ((ref = REFERENCE.exec(line)) !== null) {
      const target = `${ref[1] ?? ''}${ref[2]}`;
      // A bare year is not a record. Checked before the relation is updated,
      // so a date cannot even reset what the clause is talking about.
      if (!isRecordNumber(ref[1], ref[2]) || (!ref[1] && isDatePart(line, ref.index))) continue;

      const before = line.slice(0, ref.index);
      const verbRelation = matchRelation(before);
      if (verbRelation) {
        activeRelation = verbRelation;
        activeIsVerb = true;
        listAnchor = ref.index + target.length;
      } else if (listAnchor >= 0) {
        // The verb governs the LIST it introduced, and nothing beyond it.
        // Between two items of a list stands a separator and nothing else;
        // once real words appear, the enumeration is over. Without this the
        // relation leaked across a whole header line and produced edges no
        // sentence claims — 168 edges where 118 are written down.
        const between = line.slice(listAnchor, ref.index);
        if (/^[\s,;]*(?:und|sowie|bzw\.?)?[\s,;]*$/i.test(between)) {
          listAnchor = ref.index + target.length;
        } else {
          activeRelation = null;
          activeIsVerb = false;
          listAnchor = -1;
        }
      }

      if (target === from || seen.has(target)) continue;

      const relation = activeRelation;
      if (!relation) continue;

      const clause = line.slice(Math.max(0, ref.index - 60), ref.index + target.length + 40);
      if (negatesRelation(clause)) {
        rejected.push({ to: target, reason: 'relation negated', line: lineNumber, rawText: clause.trim() });
        continue;
      }

      edges.push({
        from: relation.forward ? from : target,
        to: relation.forward ? target : from,
        relation: relation.relation,
        // The whole enumeration inherits the strength of the verb that
        // introduced it — the second item in `betrifft A, B` is stated just as
        // plainly as the first.
        certainty: activeIsVerb ? 'sicher' : 'vermutet',
        sourcePath,
        sourceLine: lineNumber,
        rawText: clause.trim(),
      });
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const rawLine = prepare(lines[index]);
    const lineNumber = startLine + index;
    if (rawLine.trim().length === 0) continue;

    // The label a reference sits under, when it carries a relation itself
    // (`**Schränkt ein:** 0042, 0043`). Harvested, never assumed. It governs
    // only the statement it introduces — later statements on the same line
    // bring their own verb or contribute nothing.
    const labelMatch = rawLine.match(/^\s*([^:]{1,60}?)\s*:/);
    const labelRelation = labelMatch ? matchRelation(`${labelMatch[1]} `) : null;

    const seen = new Set<string>();
    const clauses = rawLine.split('·');
    for (let clauseIndex = 0; clauseIndex < clauses.length; clauseIndex++) {
      scanClause(clauses[clauseIndex], lineNumber, clauseIndex === 0 ? labelRelation : null, seen);
    }
  }

  return { edges, rejected };
}

/**
 * Read edges out of a file that is NOT a record — an index, a control file, a
 * status report.
 *
 * These carry edges that no record knows about: in the measured corpus a
 * control file declares two records obsolete while both still read `Stand:
 * gilt`, and that discrepancy is one of the contradictions the check is
 * supposed to find. An importer that only reads the records folder builds a
 * graph that provably misses them.
 *
 * The declaring side is the FILE, not a record, so `from` is the target and
 * the edge is marked `vermutet`: a third party asserting a relation between
 * two records is weaker than a record asserting it about itself.
 */
export function extractEdgesFromControlFile(
  content: string,
  sourcePath: string,
): EdgeExtraction {
  const edges: DecisionEdge[] = [];
  const rejected: EdgeExtraction['rejected'] = [];
  const lines = stripSoftHyphens(content.replace(/\r\n/g, '\n')).split('\n');

  // A fenced code block is quoted material, never an assertion. Documents that
  // discuss the corpus put SAMPLE header lines in fences, and reading them as
  // claims turns a description into data: the delivered set contains a brief
  // whose fenced examples produced two edges, one of them the very statement
  // the surrounding prose identifies as WRONG ("0035 schränkt 0005 ein" — a
  // relation that record 0035 does not carry). A file explaining edges must
  // not thereby create them.
  let inFence = false;

  for (let index = 0; index < lines.length; index++) {
    const rawLine = prepare(lines[index]);
    const lineNumber = index + 1;

    if (/^\s*(```|~~~)/.test(lines[index])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    // In a table the context ends at the cell boundary — but a row still has
    // a structure, and throwing it away costs real edges.
    //
    //   | 0124 | Der Sperrsatz aus 0076 fällt … | … 0062 … |
    //   | 0011 | Regelwerk bekommt Ebenen      | ersetzt 0012 |
    //
    // Reading a row as one clause manufactured a supersession between 0076 and
    // 0062, which the row never relates. Reading the cells as unrelated
    // fragments then lost the second row entirely — and that one is a genuine
    // contradiction, the index claiming the reverse of what both records say.
    //
    // The row's first cell names the subject; later cells state things about
    // it. So the subject is carried across the row while the sentence context
    // stops at each boundary, which keeps the real edge and drops the invented
    // one. Cell-splitting alone took 32 spurious edges out and one true
    // finding with them.
    if (rawLine.includes('|')) {
      const cells = rawLine.split('|').filter(c => c.trim().length > 0);
      if (cells.length === 0) continue;
      const subject = soleReference(cells[0]);
      for (let cellIndex = subject ? 1 : 0; cellIndex < cells.length; cellIndex++) {
        // `·` separates statements inside a cell exactly as it does inside a
        // header. `ersetzt 0072 · Prüfstand 0075` is one relation and one
        // mention; letting the verb reach across the separator declared 0075
        // superseded by a cell that only names it.
        for (const clause of cells[cellIndex].split('·')) {
          scanControlLine(clause, lineNumber, subject);
        }
      }
      continue;
    }
    for (const clause of rawLine.split('·')) {
      scanControlLine(clause, lineNumber, null);
    }
  }

  /** The single record number in a cell, or null when it holds none or many. */
  function soleReference(cell: string): string | null {
    REFERENCE.lastIndex = 0;
    const found: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = REFERENCE.exec(cell)) !== null) {
      if (!isRecordNumber(match[1], match[2]) || (!match[1] && isDatePart(cell, match.index))) continue;
      found.push(`${match[1] ?? ''}${match[2]}`);
    }
    return found.length === 1 ? found[0] : null;
  }

  function scanControlLine(line: string, lineNumber: number, rowSubject: string | null): void {
    REFERENCE.lastIndex = 0;
    let ref: RegExpExecArray | null;
    const refs: Array<{ id: string; at: number }> = [];
    while ((ref = REFERENCE.exec(line)) !== null) {
      if (!isRecordNumber(ref[1], ref[2]) || (!ref[1] && isDatePart(line, ref.index))) continue;
      refs.push({ id: `${ref[1] ?? ''}${ref[2]}`, at: ref.index });
    }

    // A table row supplies its subject from the first cell, so one reference
    // in a later cell is enough: `| 0011 | … | ersetzt 0012 |`.
    if (rowSubject && refs.length >= 1) {
      const relation = matchRelation(line.slice(0, refs[0].at));
      if (!relation) return;
      const clause = line.trim();
      if (negatesRelation(clause)) {
        rejected.push({ to: refs.map(r => r.id).join(','), reason: 'relation negated', line: lineNumber, rawText: clause });
        return;
      }
      for (const target of refs) {
        if (target.id === rowSubject) continue;
        edges.push({
          from: relation.forward ? rowSubject : target.id,
          to: relation.forward ? target.id : rowSubject,
          relation: relation.relation,
          certainty: 'vermutet',
          sourcePath,
          sourceLine: lineNumber,
          rawText: clause,
        });
      }
      return;
    }

    // Outside a table there is no implicit subject, so an edge needs both
    // sides written out in the same clause.
    if (refs.length < 2) return;

    // A record states its relations with itself as the implicit subject
    // ("löst 0093 ab"), so the verb comes first. A control file writes the
    // subject out — "Die Akte 0110 ersetzt 0093 und 0094" — and the verb sits
    // BETWEEN the two sides. Looking only in front of the first reference
    // finds nothing here, which is how a whole class of third-party edges
    // goes missing without any rule reporting it.
    let split = -1;
    let relation: ReturnType<typeof matchRelation> = null;
    for (const candidate of refs) {
      const found = matchRelation(line.slice(0, candidate.at));
      if (found) { relation = found; split = candidate.at; break; }
    }
    if (!relation || split < 0) return;

    const subjects = refs.filter(r => r.at < split);
    const targets = refs.filter(r => r.at >= split);
    if (subjects.length === 0 || targets.length === 0) return;

    const clause = line.trim();
    if (negatesRelation(clause)) {
      rejected.push({ to: targets.map(r => r.id).join(','), reason: 'relation negated', line: lineNumber, rawText: clause });
      return;
    }

    // The last subject before the verb is the one it belongs to.
    const subject = subjects[subjects.length - 1].id;
    for (const target of targets) {
      if (target.id === subject) continue;
      edges.push({
        from: relation.forward ? subject : target.id,
        to: relation.forward ? target.id : subject,
        relation: relation.relation,
        certainty: 'vermutet',
        sourcePath,
        sourceLine: lineNumber,
        rawText: clause,
      });
    }
  }

  return { edges, rejected };
}
