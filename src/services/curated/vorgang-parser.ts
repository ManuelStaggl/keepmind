// SPDX-License-Identifier: Apache-2.0
//
// Reader for curated work items ("Vorgänge").
//
// The counterpart to akten-parser.ts, and a much stricter corpus: YAML
// frontmatter, five mandatory fields, one guard, a single writer. Where the
// decision records invent a new header label every few files, these have had
// the same five since the first one.
//
// That strictness is why this reader can be simple. It is NOT a reason to
// assume the shape: measured over the 196 delivered items, 195 carry exactly
// the five mandatory fields and two carry a sixth that declares a relation
// (`schliesst`, `haengt_an`, once each). So fields are harvested here too —
// the closed part is the meaning of the known keys, not the set of keys.
//
// THE STATE IS NEVER READ FROM THE FILE. There is no `status` field and the
// upstream guard rejects one; state is computed from the event log
// (ereignis-log.ts). A reader that invented a status field here would create a
// second, silently diverging source of truth for something the corpus
// deliberately keeps in one place.

/** One harvested `key: value` pair from the frontmatter block. */
export interface VorgangField {
  name: string;
  /** Value with surrounding quotes removed, otherwise verbatim. */
  value: string;
  /** 1-based line in the source file. */
  line: number;
}

export interface ParsedVorgang {
  /** `V-0001`, or null when the file carries no id. */
  id: string | null;
  titel: string;
  entscheidet: string | null;
  erstellt: string | null;
  herkunft: string | null;
  /** Declares that this item closes another. Rare, and a relation. */
  schliesst: string | null;
  /** Declares a dependency on another item. Rare, and a relation. */
  haengtAn: string | null;
  /** Every harvested field, in document order. */
  fields: VorgangField[];
  /** 1-based line of the opening `---`. */
  frontmatterLine: number;
  /** Everything after the closing `---`, verbatim. */
  body: string;
  /** 1-based line where the body starts. */
  bodyLine: number;
}

/**
 * Strip a UTF-8 byte order mark.
 *
 * Not defensive coding — V-0172 in the delivered corpus starts with one. It is
 * invisible in every editor and survives copy-paste, and it makes the opening
 * `---` fail a `^---` match, so the file parses as having no frontmatter at
 * all: no id, no title, no relations. One file in 196, silently.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Remove one layer of matching quotes: `titel: "…"` is the corpus norm. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function pick(fields: VorgangField[], name: string): string | null {
  const found = fields.find(f => f.name.toLowerCase() === name.toLowerCase());
  return found && found.value.length > 0 ? found.value : null;
}

const FRONTMATTER_KEY_RE = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*([\s\S]*)$/;

/**
 * Parse one work item.
 *
 * `content` is the file verbatim; line numbers are 1-based so they can be
 * handed straight to an editor and to the citation columns.
 */
export function parseVorgang(content: string): ParsedVorgang {
  const raw = stripBom(content.replace(/\r\n/g, '\n'));
  const lines = raw.split('\n');

  const empty: ParsedVorgang = {
    id: null, titel: '', entscheidet: null, erstellt: null, herkunft: null,
    schliesst: null, haengtAn: null, fields: [], frontmatterLine: 0,
    body: raw.trim(), bodyLine: 1,
  };

  if (lines[0]?.trim() !== '---') return empty;

  let closing = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') { closing = i; break; }
  }
  // An unterminated frontmatter block is not frontmatter. Reading to end of
  // file instead would turn the whole document into field values.
  if (closing === -1) return empty;

  const fields: VorgangField[] = [];
  for (let i = 1; i < closing; i++) {
    const match = lines[i].match(FRONTMATTER_KEY_RE);
    if (!match) continue;
    fields.push({ name: match[1], value: unquote(match[2]), line: i + 1 });
  }

  const body = lines.slice(closing + 1).join('\n').trim();

  return {
    id: pick(fields, 'id'),
    titel: pick(fields, 'titel') ?? '',
    entscheidet: pick(fields, 'entscheidet'),
    erstellt: pick(fields, 'erstellt'),
    herkunft: pick(fields, 'herkunft'),
    schliesst: pick(fields, 'schliesst'),
    haengtAn: pick(fields, 'haengt_an'),
    fields,
    frontmatterLine: 1,
    body,
    bodyLine: closing + 2,
  };
}
