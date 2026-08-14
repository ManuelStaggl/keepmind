// SPDX-License-Identifier: Apache-2.0
//
// Reader for curated decision records ("Akten").
//
// This module only ever READS. It does not decide, score, embed, or call a
// provider — that separation is the whole point of the curated path: a record
// the user wrote by hand must reach storage byte-for-byte, and the only way to
// guarantee that is for nothing on this path to be capable of rewriting it.
//
// THE RULE THAT SHAPES EVERYTHING HERE: field names are HARVESTED, not
// assumed. A first attempt that searched for a fixed `Vermerk:` label
// recovered 61% of the known relation chains; the corpus also uses `Wirkung:`,
// puts the verb in the field NAME (`**Schränkt ein:** 0042, 0043`), and hides
// one edge inside a `Stand:` value. Twelve of the header labels in a 130-file
// corpus can carry a relation, and the set is open — new records invent new
// labels. What is closed is the set of RELATIONS, which is why A2 can work at
// all. So: read every label the file offers, judge none of them here.

/** One harvested `Label: value` pair from the header block. */
export interface AkteField {
  /** Label exactly as written, minus markup and trailing colon. */
  name: string;
  /** Everything after the colon, markup preserved. Never trimmed of meaning. */
  value: string;
  /** 1-based line in the source file where this field's label appears. */
  line: number;
}

export interface ParsedAkte {
  /** Leading record number from the heading, e.g. "0068". Null if absent. */
  id: string | null;
  /** Heading text after the number and dash. Falls back to the whole heading. */
  title: string;
  /** 1-based line of the `# ` heading — the citation anchor for A4. */
  headingLine: number;
  /** Every harvested header field, in document order. */
  fields: AkteField[];
  /**
   * Header values that carried no label of their own. Kept rather than guessed
   * into `date`/`decidedBy`: the guess would be right most of the time, and
   * "right most of the time" is the failure mode this path exists to avoid.
   */
  unlabelled: string[];
  /** Raw header block, verbatim. A2 re-scans this for edges. */
  headerText: string;
  /** 1-based line where the header block starts. */
  headerStartLine: number;
  /** Everything from the first `## ` section onward, verbatim. */
  body: string;
  /** Convenience lookups. Null when the record does not carry the field. */
  status: string | null;
  date: string | null;
  decidedBy: string | null;
  summary: string | null;
}

/**
 * Reduce `[0024](./0024-verbrauch-wird-nicht-geschaetzt.md)` to `0024`.
 *
 * Not cosmetic. The link TARGET is a filename built from the record's title,
 * so it routinely contains words that change meaning — a slug carrying "nicht"
 * made a negation check reject a valid edge. Any rule that reads a sentence
 * must see the link's text, never its href.
 */
export function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/**
 * Soft hyphens are invisible and survive copy-paste out of a word processor;
 * the corpus has them inside words like `Sitzungs­aufzeichnungen`. Left in
 * place they split a term for every downstream comparison, silently.
 */
export function stripSoftHyphens(text: string): string {
  return text.replace(/­/g, '');
}

/** Remove bold/italic markers without touching the words between them. */
function stripEmphasis(text: string): string {
  return text.replace(/\*\*/g, '').replace(/(^|[^*])\*([^*]+)\*/g, '$1$2');
}

const HEADING_RE = /^#\s+(.*)$/;
const SECTION_RE = /^#{2,}\s/;
/** A bold label with its colon INSIDE the bold: `**Datum:**`. */
const BOLD_LABEL_RE = /\*\*\s*([^*:]{1,60}?)\s*:\s*\*\*/g;
/**
 * A whole header line wrapped in one bold span that itself contains
 * `Label: value` pairs: `**Stand: gilt · 12.08.2026 · Schliesst: —**`.
 * Distinct shape, same information — one corpus record in 130 uses it, and
 * dropping it loses that record's status entirely.
 */
const WRAPPED_HEADER_RE = /^\*\*(.+)\*\*$/;

function looksLikeWrappedHeader(inner: string): boolean {
  // Must open with `Label:` and carry at least one separator or second label,
  // otherwise an ordinary bold sentence ending in a colon would qualify.
  if (!/^\s*[^:*]{1,60}:/.test(inner)) return false;
  return inner.includes('·') || (inner.match(/[^:*]{1,60}:/g) ?? []).length > 1;
}

/**
 * Split the wrapped shape `Label: value · bare · Label2: value2`.
 *
 * Here `·` genuinely IS the field separator — that is the convention of this
 * shape, and the two shapes disagree on this point. In the ordinary shape
 * (`**Vermerk:** **begrenzt 0089** · wendet 0092 an`) a `·` sits INSIDE a
 * value and splitting on it would invent a second field; there, bold labels do
 * the delimiting. Getting this backwards costs a record its status: reading
 * `Stand: gilt · 12.08.2026 · von Manuel entschieden` as one value yields the
 * status "gilt · 12.08.2026 · von Manuel entschieden", which no query matches.
 *
 * Parts without a label are NOT folded into the preceding field. `12.08.2026`
 * plainly is the date and `von Manuel entschieden` plainly is the author, but
 * plainly-is is the reasoning this whole path exists to avoid. They are
 * returned as `unlabelled` so nothing is lost and nothing is claimed.
 */
function splitWrappedPairs(
  inner: string,
  line: number,
): { fields: AkteField[]; unlabelled: string[] } {
  const fields: AkteField[] = [];
  const unlabelled: string[] = [];
  for (const part of inner.split('·')) {
    const m = part.match(/^\s*([^:]{1,60}?)\s*:\s*([\s\S]*)$/);
    if (m) {
      fields.push({ name: stripEmphasis(m[1]).trim(), value: m[2].trim(), line });
    } else {
      const bare = stripEmphasis(part).trim();
      if (bare.length > 0) unlabelled.push(bare);
    }
  }
  return { fields, unlabelled };
}

/**
 * Harvest every `Label: value` pair from the header block.
 *
 * Values run from the end of their own label to the start of the NEXT label,
 * so a value keeps its own emphasis, its own `·` separators and its own
 * parentheses. Nothing in here decides whether a value means anything.
 */
function harvestFields(
  headerLines: Array<{ text: string; line: number }>,
): { fields: AkteField[]; unlabelled: string[] } {
  const fields: AkteField[] = [];
  const unlabelled: string[] = [];

  // Shape B first: a fully wrapped header line yields its pairs directly.
  const unwrapped: Array<{ text: string; line: number }> = [];
  for (const entry of headerLines) {
    const wrapped = entry.text.trim().match(WRAPPED_HEADER_RE);
    if (wrapped && looksLikeWrappedHeader(wrapped[1]) && !BOLD_LABEL_RE.test(entry.text)) {
      BOLD_LABEL_RE.lastIndex = 0;
      const split = splitWrappedPairs(wrapped[1], entry.line);
      fields.push(...split.fields);
      unlabelled.push(...split.unlabelled);
      continue;
    }
    BOLD_LABEL_RE.lastIndex = 0;
    unwrapped.push(entry);
  }

  // Shape A: join the remaining lines so a field wrapping onto the next line
  // (`**Schränkt ein:** 0042, 0043,\n0044, 0045`) stays one value.
  if (unwrapped.length > 0) {
    let joined = '';
    const lineAt: number[] = [];
    for (const entry of unwrapped) {
      const piece = (joined ? ' ' : '') + entry.text.trim();
      for (let i = 0; i < piece.length; i++) lineAt.push(entry.line);
      joined += piece;
    }

    const marks: Array<{ name: string; start: number; end: number }> = [];
    BOLD_LABEL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BOLD_LABEL_RE.exec(joined)) !== null) {
      marks.push({ name: m[1].trim(), start: m.index, end: m.index + m[0].length });
    }

    for (let i = 0; i < marks.length; i++) {
      const valueEnd = i + 1 < marks.length ? marks[i + 1].start : joined.length;
      let value = joined.slice(marks[i].end, valueEnd).trim();
      value = value.replace(/[·,;]\s*$/, '').trim();
      fields.push({
        name: marks[i].name,
        value,
        line: lineAt[marks[i].start] ?? headerLines[0]?.line ?? 1,
      });
    }
  }

  return { fields, unlabelled };
}

/** Case- and umlaut-tolerant lookup over harvested labels. */
function pick(fields: AkteField[], ...names: string[]): string | null {
  const want = names.map(n => n.toLowerCase());
  for (const field of fields) {
    if (want.includes(field.name.toLowerCase())) {
      const value = stripEmphasis(stripMarkdownLinks(field.value)).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

/**
 * Parse one curated record.
 *
 * `content` is the file verbatim; `line` numbers are 1-based so they can be
 * handed straight to an editor and to the A4 citation columns.
 */
export function parseAkte(content: string): ParsedAkte {
  const raw = stripSoftHyphens(content.replace(/\r\n/g, '\n'));
  const lines = raw.split('\n');

  let headingIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) { headingIndex = i; break; }
  }

  const headingText = headingIndex >= 0
    ? (lines[headingIndex].match(HEADING_RE)?.[1] ?? '').trim()
    : '';

  // `0068 — Beurteilt wird in echten Anwendungen`. Em dash, en dash or hyphen.
  const idMatch = headingText.match(/^(\d{3,})\s*[—–-]\s*(.*)$/);
  const id = idMatch ? idMatch[1] : null;
  const title = idMatch ? idMatch[2].trim() : headingText;

  // Header block: the CONTIGUOUS run of non-empty lines directly under the
  // heading. It ends at the first blank line, not at the first `## ` section.
  //
  // Running to the section heading instead looks equivalent and is not: record
  // 0001 puts a block quote between the header and `## Ausgangslage`, and the
  // wider rule swallowed three lines of prose into the value of the last field
  // — its status became "gilt > Nachträglich abgelegt am 06.08.2026. …". The
  // field was still found, so nothing failed; the status was simply wrong in a
  // way that no query would ever match. Only reading the real corpus surfaced
  // it. Every header shape in that corpus is one unbroken run, so the narrow
  // rule loses nothing.
  const headerLines: Array<{ text: string; line: number }> = [];
  let cursor = headingIndex + 1;
  while (cursor < lines.length && lines[cursor].trim().length === 0) cursor++;
  while (
    cursor < lines.length &&
    lines[cursor].trim().length > 0 &&
    !SECTION_RE.test(lines[cursor])
  ) {
    headerLines.push({ text: lines[cursor], line: cursor + 1 });
    cursor++;
  }
  const bodyStart = cursor;

  const { fields, unlabelled } = harvestFields(headerLines);

  return {
    id,
    title,
    headingLine: headingIndex >= 0 ? headingIndex + 1 : 1,
    fields,
    unlabelled,
    headerText: headerLines.map(l => l.text).join('\n'),
    headerStartLine: headerLines[0]?.line ?? (headingIndex + 2),
    body: lines.slice(bodyStart).join('\n').trim(),
    status: pick(fields, 'Stand'),
    date: pick(fields, 'Datum'),
    decidedBy: pick(fields, 'Entschieden von', 'Festgestellt von'),
    summary: pick(fields, 'Kurz'),
  };
}
