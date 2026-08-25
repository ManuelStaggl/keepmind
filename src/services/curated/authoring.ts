// SPDX-License-Identifier: Apache-2.0
//
// Direct authoring of curated records — a lasting entry created and CHANGED
// inside keepmind, with no .md source file anywhere.
//
// THE GUARANTEE THIS FILE EXISTS TO MAKE: a directly authored record is
// subject to EXACTLY the same deterministic rules as an imported one. Not
// "equivalent rules" — the same code. A second rule set that is only supposed
// to agree with the first is a rule set that will disagree, silently, at the
// moment it matters: the relation lexicon, the negation guard, the date/record
// disambiguation and the span rule were each paid for with a measured failure,
// and re-deriving them for a second entry point would re-introduce them one by
// one.
//
// So the entry point does NOT parse structured input into edges. It RENDERS
// the caller's fields into the canonical record shape, hands that text to the
// very same `parseAkte` + `extractEdges` the file importer uses, and then
// VERIFIES that what came back is what was declared. A record whose declared
// relations do not read back is refused, not stored — see `verifyRoundTrip`.
//
// THE MODEL IS NEVER INVOLVED. Like the file importer, this module talks to a
// deliberately narrow store interface: plain storage calls, no queue. The
// observation queue is the only thing in keepmind that reaches a provider, and
// nothing here can see it. `tests/curated/authoring.test.ts` enforces that with
// the same Proxy the importer test uses.

import { VORGANG_ID_PATTERN, authoredSourcePath } from './record-key.js';
import { parseAkte, type ParsedAkte } from './akten-parser.js';
import { extractEdges, type DecisionEdge } from './edge-reader.js';
import { matchRelation, type RelationName } from './relation-lexicon.js';
import { renderRecord, subtitleFor } from './akten-importer.js';
import { logger } from '../../utils/logger.js';

/**
 * Where a directly authored record "comes from".
 *
 * Every citation in keepmind is a path plus a line, and every edge is replaced
 * per source path (`replaceEdgesForSource`). A record with no file still needs
 * both, or it can neither be cited nor edited without leaving stale edges
 * behind. A `keepmind://` URI is the honest answer: it is stable across edits,
 * it is obviously not a file, and it keys the edge replacement exactly the way
 * a filename does for an imported record.
 *
 * Deliberately NOT project-qualified. The edge delete is already scoped by
 * project (`WHERE project = ? AND source_path = ?`), so adding the project
 * here would only make the identifier churn when a project is renamed.
 */
export { AUTHORED_SOURCE_SCHEME, authoredSourcePath, isAuthoredSourcePath } from './record-key.js';

/**
 * A relation the author declares, as a STATEMENT about this record.
 *
 * `targets` is a list because one clause can govern one (`betrifft 0042`) or —
 * for `resolves` — exactly two. The direction of the resulting edge is NOT
 * decided here: it is whatever the lexicon says the rendered sentence means.
 * `Grundlage: 0042` produces an edge pointing the other way than `löst 0042
 * ab` does, and that asymmetry belongs in one place only.
 */
export interface DeclaredRelation {
  relation: RelationName;
  targets: string[];
}

/**
 * Clause templates — the inverse of `relation-lexicon`.
 *
 * `{ref}` is replaced by the record number. What matters is the text BEFORE
 * the reference: that is what `matchRelation` reads, and it is why every
 * template is checked against the lexicon at module load (see
 * `assertTemplatesMatchLexicon`) rather than trusted. A template that stopped
 * matching after a lexicon edit would otherwise degrade every authored
 * relation from `sicher` to `vermutet` — which means supersession silently
 * stops applying, because only certain edges act.
 */
const CLAUSE_TEMPLATES: Record<RelationName, { text: string; arity: 1 | 2 }> = {
  supersedes:   { text: 'löst {ref} ab', arity: 1 },
  restricts:    { text: 'schränkt {ref} ein', arity: 1 },
  sharpens:     { text: 'schärft {ref}', arity: 1 },
  continues:    { text: 'setzt {ref} fort', arity: 1 },
  corrects:     { text: 'berichtigt {ref}', arity: 1 },
  closes:       { text: 'schliesst {ref}', arity: 1 },
  extends:      { text: 'ergänzt {ref}', arity: 1 },
  applies:      { text: 'wendet {ref} an', arity: 1 },
  confirms:     { text: 'bestätigt {ref}', arity: 1 },
  concerns:     { text: 'betrifft {ref}', arity: 1 },
  reverses:     { text: 'kehrt {ref} um', arity: 1 },
  based_on:     { text: 'Grundlage: {ref}', arity: 1 },
  triggered_by: { text: 'ausgelöst von {ref}', arity: 1 },
  resolves:     { text: 'löst eine Kollision zwischen {ref} und {ref2}', arity: 2 },
};

/** The header label every relation clause is written under. */
const RELATION_LABEL = 'Vermerk';

export const RELATION_NAMES = Object.keys(CLAUSE_TEMPLATES) as RelationName[];

/**
 * Every template must still be recognised by the lexicon, and recognised as
 * the relation it claims to be.
 *
 * Run once, at import. A silent drift here does not throw at the call site; it
 * produces a record that stores a relation nobody asked for, or none at all.
 */
function assertTemplatesMatchLexicon(): void {
  for (const [name, template] of Object.entries(CLAUSE_TEMPLATES)) {
    const before = template.text.slice(0, template.text.indexOf('{ref}'));
    const matched = matchRelation(`${RELATION_LABEL}: ${before}`);
    if (!matched) {
      throw new Error(
        `curated authoring: clause template for "${name}" is no longer recognised by the relation lexicon ` +
        `("${template.text}"). Authored relations would degrade to 'vermutet' and supersession would stop applying.`,
      );
    }
    if (matched.relation !== name) {
      throw new Error(
        `curated authoring: clause template for "${name}" now reads as "${matched.relation}" ("${template.text}").`,
      );
    }
  }
}
assertTemplatesMatchLexicon();

/** A record number as the edge reader recognises it: `0001`…`0999`, or `V-1234`. */
export const RECORD_ID_RE = /^(?:V-\d{4}|0\d{3})$/;

export function isValidRecordId(id: string): boolean {
  return RECORD_ID_RE.test(id);
}

/** One free-form header field, written exactly as given. */
export interface HeaderField {
  name: string;
  value: string;
}

/**
 * What a caller hands in to create or change a lasting entry.
 *
 * Everything textual is stored verbatim. Nothing here is summarised, scored,
 * classified or rephrased — the fields exist so the caller can say what they
 * mean, not so keepmind can interpret it.
 */
export interface CuratedDraft {
  /** Assigned from the project's next free number when absent. */
  recordId?: string;
  title: string;
  /** `Stand:` — verbatim. 'gilt', 'abgelöst', 'zurückgezogen', anything. */
  status?: string;
  /** `Datum:` — verbatim, never parsed into a timestamp here. */
  date?: string;
  /** `Entschieden von:` */
  decidedBy?: string;
  /** `Kurz:` — the one-line gist. */
  summary?: string;
  /** Extra header labels, kept as written. */
  fields?: HeaderField[];
  /** Declared relations. Rendered into clauses, then read back and verified. */
  relations?: DeclaredRelation[];
  /** The record body, markdown, verbatim. */
  body?: string;
  /**
   * Author-declared validity window. `validFrom` defaults to the write time.
   * `validTo` is for a decision that is known in advance to lapse — it is NOT
   * how a revision closes its predecessor (that carries `$.revised_by`), and
   * NOT how a supersession retires a record (`$.superseded_by_record`).
   */
  validFrom?: number;
  validTo?: number;
  /** Epoch millis when the author last confirmed this against reality. */
  lastVerifiedAt?: number;
}

/** A stored revision of a record, as read back. */
export interface CuratedRecordRow {
  id: number;
  project: string;
  record_id: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  metadata: string | null;
  source_path: string | null;
  source_line: number | null;
  valid_from: number | null;
  valid_to: number | null;
  created_at_epoch: number;
}

/**
 * The minimum of SessionStore this module touches.
 *
 * Narrow on purpose, exactly like `CuratedStore`: every name in here is a
 * plain storage call. There is no queue and no provider to reach, and the
 * Proxy test turns any other call into a named failure.
 */
export interface AuthoringStore {
  getOrCreateManualSession(project: string): string;
  nextCuratedRecordId(project: string): string;
  getCuratedRecord(project: string, recordId: string, opts?: { includeClosed?: boolean }): CuratedRecordRow | null;
  storeCuratedRecord(
    memorySessionId: string,
    project: string,
    record: {
      recordId: string;
      title: string;
      subtitle: string;
      narrative: string;
      metadata: string;
      sourcePath: string;
      sourceLine: number;
      subject: string;
      validFrom: number;
      validTo: number | null;
      lastVerifiedAt: number | null;
    },
    nowEpoch: number,
  ): { id: number; createdAtEpoch: number; revisionsClosed: number };
  replaceEdgesForSource(
    project: string,
    sourcePath: string,
    edges: Array<{ from: string; to: string; relation: string; certainty: string; sourceLine: number; rawText?: string | null }>,
    nowEpoch?: number,
  ): { inserted: number; removed: number };
}

/** Refuse rather than mangle: a header field is one line by construction. */
function assertSingleLine(label: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(
      `curated authoring: header field "${label}" contains a line break. ` +
      `Header fields are one line each; put multi-line text in the body.`,
    );
  }
}

/**
 * Render the canonical record text.
 *
 * ONE relation per line, under its own `**Vermerk:**` label. Not decoration:
 * the edge reader keeps a per-LINE set of already-seen references, so two
 * clauses naming the SAME record on one line would silently drop the second.
 * One line per clause makes that impossible instead of unlikely.
 */
export function renderCuratedMarkdown(draft: CuratedDraft, recordId: string): string {
  const header: string[] = [];
  const push = (label: string, value: string | undefined) => {
    if (value === undefined || value.trim() === '') return;
    assertSingleLine(label, value);
    header.push(`**${label}:** ${value.trim()}`);
  };

  push('Stand', draft.status);
  push('Datum', draft.date);
  push('Entschieden von', draft.decidedBy);
  push('Kurz', draft.summary);
  for (const field of draft.fields ?? []) {
    if (!field.name.trim()) continue;
    push(field.name.trim(), field.value);
  }
  for (const clause of relationClauses(draft.relations ?? [])) {
    header.push(`**${RELATION_LABEL}:** ${clause}`);
  }

  const body = (draft.body ?? '').replace(/\r\n/g, '\n').trim();
  const parts = [`# ${recordId} — ${draft.title.trim()}`];
  if (header.length > 0) parts.push(header.join('\n'));
  if (body.length > 0) parts.push(body);
  return `${parts.join('\n\n')}\n`;
}

/** Turn declared relations into the clauses that state them. */
function relationClauses(relations: DeclaredRelation[]): string[] {
  const clauses: string[] = [];
  for (const declared of relations) {
    const template = CLAUSE_TEMPLATES[declared.relation];
    if (!template) {
      throw new Error(
        `curated authoring: unknown relation "${declared.relation}". ` +
        `Known: ${RELATION_NAMES.join(', ')}.`,
      );
    }
    const targets = declared.targets.map(t => t.trim()).filter(t => t.length > 0);
    for (const target of targets) {
      if (!isValidRecordId(target)) {
        throw new Error(
          `curated authoring: "${target}" is not a record number the edge reader recognises. ` +
          `Use a zero-padded four-digit number (0001…0999) or a V- reference (V-0187).`,
        );
      }
    }
    if (template.arity === 2) {
      if (targets.length !== 2) {
        throw new Error(`curated authoring: relation "${declared.relation}" needs exactly two targets, got ${targets.length}.`);
      }
      clauses.push(template.text.replace('{ref}', targets[0]).replace('{ref2}', targets[1]));
      continue;
    }
    if (targets.length === 0) {
      throw new Error(`curated authoring: relation "${declared.relation}" was declared with no target.`);
    }
    for (const target of targets) clauses.push(template.text.replace('{ref}', target));
  }
  return clauses;
}

/** What the round trip found, so a caller can report it rather than assert it. */
export interface RoundTrip {
  parsed: ParsedAkte;
  markdown: string;
  edges: DecisionEdge[];
}

/**
 * Read the rendered record back with the file importer's own reader, and
 * refuse anything that does not come back as declared.
 *
 * This is the whole safety argument for direct authoring. The renderer above
 * is new code; the reader is the code the corpus was measured against. If the
 * two disagree, the reader wins and the write does not happen — a stored
 * record whose relations read differently than they were declared is exactly
 * the "silently wrong graph" the curated path exists to prevent.
 */
export function verifyRoundTrip(draft: CuratedDraft, recordId: string): RoundTrip {
  const markdown = renderCuratedMarkdown(draft, recordId);
  const parsed = parseAkte(markdown);

  if (parsed.id !== recordId) {
    throw new Error(`curated authoring: rendered record reads back as id "${parsed.id}", expected "${recordId}".`);
  }
  if (parsed.title !== draft.title.trim()) {
    throw new Error(`curated authoring: rendered title reads back as "${parsed.title}", expected "${draft.title.trim()}".`);
  }
  // `Stand:` may arrive either as its own field on the draft or, when a draft
  // was rebuilt from a stored record, as one of the carried-through header
  // fields. Both are the same statement; checking only the first would fail
  // every edit of a record that has a status.
  const declaredStatus = draft.status?.trim()
    || (draft.fields ?? []).find(f => f.name.trim().toLowerCase() === 'stand')?.value.trim()
    || null;
  if ((parsed.status ?? null) !== declaredStatus) {
    throw new Error(`curated authoring: rendered status reads back as "${parsed.status}", expected "${declaredStatus}".`);
  }

  // THE BODY MUST COME BACK AS BODY.
  //
  // A record's header block is the contiguous run of non-empty lines under the
  // heading — so a record with NO header fields whose body opens with prose has
  // that prose read as its header, and every record number in it becomes a
  // declared relation. Measured on exactly that shape: "Dieser Absatz löst 0042
  // ab, behauptet der Text." produced a certain supersession that no one
  // declared. The general check is cheap and catches the whole class: whatever
  // the reader calls the body must be what was handed in as the body.
  const wantBody = (draft.body ?? '').replace(/\r\n/g, '\n').trim();
  if (parsed.body.trim() !== wantBody) {
    throw new Error(
      `curated authoring: the record body would not be read back as the body.\n` +
      `A record's header is the block of lines directly under its heading, so a record with no header ` +
      `field turns its first paragraph into header — and every record number in that paragraph into a ` +
      `declared relation.\n` +
      `Give the record at least one header field (--status/--summary/--field), or start the body with a ` +
      `section heading ("## …"). Nothing was stored.`,
    );
  }

  const sourcePath = authoredSourcePath(recordId);
  const { edges } = extractEdges(parsed, sourcePath);

  // What the record MUST declare has two halves, and they are checked
  // differently on purpose.
  //
  //   carried — relation clauses that were already in the record's header and
  //             came through an edit untouched. Their expectation is read from
  //             the record WITHOUT the newly declared relations, so the test is
  //             "an edit did not change what the author had already written".
  //             Checking these against a hand-built expectation instead would
  //             mean re-deriving what an arbitrary existing clause means, which
  //             is the second rule set this module exists to avoid.
  //   declared — the relations this call passes in. Their expectation comes
  //             from the lexicon, independently of the reader.
  //
  // Summing only the second half was a bug: an edit that ADDED a supersession
  // to a record already carrying `schränkt 0001 ein` read back two edges
  // against an expectation of one, and was refused although both were correct.
  const carried = (draft.relations ?? []).length > 0
    ? extractEdges(parseAkte(renderCuratedMarkdown({ ...draft, relations: [] }, recordId)), sourcePath).edges
    : [];
  const expected = [...carried, ...expectedEdges(draft.relations ?? [], recordId)];
  const got = edges.map(edgeKey).sort();
  const want = expected.map(edgeKey).sort();
  if (got.length !== want.length || got.some((key, i) => key !== want[i])) {
    throw new Error(
      `curated authoring: declared relations do not read back as declared.\n` +
      `  declared:  ${want.join(', ') || '(none)'}\n` +
      `  read back: ${got.join(', ') || '(none)'}\n` +
      `Nothing was stored.`,
    );
  }

  return { parsed, markdown, edges };
}

function edgeKey(edge: { from: string; to: string; relation: string; certainty: string }): string {
  return `${edge.from}-[${edge.relation}/${edge.certainty}]->${edge.to}`;
}

/**
 * What the declared relations MUST produce, derived from the lexicon rather
 * than hardcoded — the direction of `Grundlage:` is the lexicon's business,
 * and a second copy of that decision here would be a second thing to keep in
 * step.
 */
function expectedEdges(
  relations: DeclaredRelation[],
  self: string,
): Array<{ from: string; to: string; relation: string; certainty: string }> {
  const out: Array<{ from: string; to: string; relation: string; certainty: string }> = [];
  for (const declared of relations) {
    const template = CLAUSE_TEMPLATES[declared.relation];
    const before = `${RELATION_LABEL}: ${template.text.slice(0, template.text.indexOf('{ref}'))}`;
    const matched = matchRelation(before);
    if (!matched) continue; // unreachable: asserted at module load
    for (const target of declared.targets.map(t => t.trim()).filter(Boolean)) {
      if (target === self) continue; // the reader drops self-edges; so do we
      out.push({
        from: matched.forward ? self : target,
        to: matched.forward ? target : self,
        relation: matched.relation,
        certainty: 'sicher',
      });
    }
  }
  return out;
}

/**
 * Rebuild the draft behind a stored record, so an edit can change ONE field
 * and leave everything else exactly as written.
 *
 * The stored narrative is `header + '\n\n' + body` (see `renderRecord`) — the
 * heading line is not part of it, because the record number and title live in
 * their own columns. Putting the heading back is therefore lossless, and the
 * result is parsed with the same reader as everything else rather than
 * re-derived from metadata: metadata carries a HARVEST of the header, and a
 * harvest is a copy that can fall behind.
 *
 * Every header field comes back as a plain field in its original ORDER,
 * including the relation clauses. That is what makes an edit non-destructive:
 * a field this code has no name for is still carried through untouched.
 */
export function draftFromRecordText(recordId: string, title: string, narrative: string): CuratedDraft {
  const parsed = parseAkte(`# ${recordId} — ${title}\n\n${narrative}`);
  return {
    recordId,
    title: parsed.title,
    fields: parsed.fields.map(f => ({ name: f.name, value: f.value })),
    body: parsed.body,
  };
}

/** Set or replace a header field, keeping its position when it exists. */
export function setField(draft: CuratedDraft, name: string, value: string | null): void {
  const fields = draft.fields ?? (draft.fields = []);
  const index = fields.findIndex(f => f.name.toLowerCase() === name.toLowerCase());
  if (value === null) {
    if (index >= 0) fields.splice(index, 1);
    return;
  }
  if (index >= 0) fields[index] = { name: fields[index].name, value };
  else fields.push({ name, value });
}

/**
 * Replace the record's declared relations wholesale.
 *
 * Wholesale rather than additive on purpose: `replaceEdgesForSource` already
 * works that way, so an edit that drops a relation drops its edge. An additive
 * API would make the two disagree — the record would stop claiming a relation
 * that the graph still asserted, and nothing would report the difference.
 */
export function setRelations(draft: CuratedDraft, relations: DeclaredRelation[]): void {
  draft.fields = (draft.fields ?? []).filter(f => f.name.toLowerCase() !== RELATION_LABEL.toLowerCase());
  draft.relations = relations;
}

/** The relation clauses currently written into a draft's header fields. */
export function relationFieldValues(draft: CuratedDraft): string[] {
  return (draft.fields ?? [])
    .filter(f => f.name.toLowerCase() === RELATION_LABEL.toLowerCase())
    .map(f => f.value);
}

/**
 * The markers that say WHY a record is retired, carried from the revision an
 * edit replaces. Only the markers — never the revision bookkeeping, which
 * belongs to the row it was written on.
 */
const CLOSURE_KEYS = [
  'superseded_by_record',
  'superseded_source_path',
  'superseded_source_line',
  'closed_by_author',
  'closed_reason',
] as const;

function closureOf(previous: CuratedRecordRow | null): Record<string, unknown> {
  if (!previous || previous.valid_to === null || !previous.metadata) return {};
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(previous.metadata) as Record<string, unknown>; } catch { return {}; }
  const out: Record<string, unknown> = {};
  for (const key of CLOSURE_KEYS) {
    if (parsed[key] !== undefined && parsed[key] !== null) out[key] = parsed[key];
  }
  return out;
}

export interface AuthorResult {
  id: number;
  recordId: string;
  title: string;
  sourcePath: string;
  /** True when this replaced an existing revision of the same record. */
  edited: boolean;
  /** Previous revisions whose validity window this write closed. */
  revisionsClosed: number;
  edges: number;
  markdown: string;
}

export interface AuthorOptions {
  project: string;
  nowEpoch?: number;
  /** Render and verify, write nothing. */
  dryRun?: boolean;
  /**
   * Refuse to create a record that does not exist yet (`curated:edit`), or to
   * overwrite one that does (`curated:add`). Without this, a typo in a record
   * number turns an edit into a new record — and the old one keeps applying.
   */
  expect?: 'new' | 'existing';
}

/**
 * Create or change a lasting entry.
 *
 * EDIT-IN-PLACE means the RECORD is stable, not the row. The record number is
 * the identity; a change writes a new revision and closes the window of the
 * previous one. Two reasons it is not an UPDATE of the row:
 *
 *   - "NOTHING IS EVER DELETED" is the invariant the whole curated path rests
 *     on (see supersession.ts). Overwriting a row's text deletes what it used
 *     to say, and the bi-temporal columns would then carry no history at all —
 *     which is the opposite of what they are for.
 *   - The surface does not grow: exactly one revision per record has
 *     `valid_to IS NULL`, so search, injection and `curated:show` see one
 *     entry, the current one. The history is there when asked for, and only
 *     then.
 *
 * The write path is the plain store call the file importer uses. No queue, no
 * model, no socket.
 */
export function authorCuratedRecord(
  store: AuthoringStore,
  draft: CuratedDraft,
  options: AuthorOptions,
): AuthorResult {
  const nowEpoch = options.nowEpoch ?? Date.now();

  if (!draft.title || !draft.title.trim()) {
    throw new Error('curated authoring: a record needs a title.');
  }

  if (draft.recordId !== undefined && !isValidRecordId(draft.recordId.trim())) {
    throw new Error(
      `curated authoring: "${draft.recordId}" is not a record number the edge reader recognises. ` +
      `Use a zero-padded four-digit number (0001…0999) or a V- reference (V-0187).`,
    );
  }

  // A V- number is a valid REFERENCE — a record may declare a relation to a
  // work item — but it cannot be authored here, and the refusal is explicit
  // rather than emergent. The canonical record heading the renderer produces
  // (`# V-0001 — …`) does not read back as an id: the decision-record reader
  // recognises digits only, and widening it is not a small change. Which
  // headings carry a number decides which files count as CONTROL files, and
  // "a file without a row of its own cannot retire a record" rests on that.
  // Until work items can be authored properly, say so here instead of failing
  // three layers down with `reads back as id "null"`.
  if (draft.recordId !== undefined && VORGANG_ID_PATTERN.test(draft.recordId.trim())) {
    throw new Error(
      `curated authoring: ${draft.recordId.trim()} is a work item, and work items are not authored here yet — ` +
      `they come from their own importer (\`curated:import\` over a "vorgaenge" source). ` +
      `Its number is still usable as a relation target from a decision record.`,
    );
  }

  const explicitId = draft.recordId?.trim();
  // Closed revisions count as existing. See `getCuratedRecord`.
  const existing = explicitId ? store.getCuratedRecord(options.project, explicitId, { includeClosed: true }) : null;

  if (options.expect === 'existing' && !existing) {
    throw new Error(
      `curated authoring: record ${explicitId ?? '(none given)'} does not exist in project "${options.project}". ` +
      `Refusing to create it under an edit — a typo in a record number would otherwise leave the real record untouched and still in force.`,
    );
  }
  if (options.expect === 'new' && existing) {
    throw new Error(
      `curated authoring: record ${explicitId} already exists in project "${options.project}" ` +
      `("${existing.title}"). Use the edit path to change it in place.`,
    );
  }

  const recordId = explicitId ?? store.nextCuratedRecordId(options.project);
  const round = verifyRoundTrip(draft, recordId);

  const sourcePath = authoredSourcePath(recordId);

  if (options.dryRun) {
    return {
      id: -1,
      recordId,
      title: round.parsed.title,
      sourcePath,
      edited: existing !== null,
      revisionsClosed: 0,
      edges: round.edges.length,
      markdown: round.markdown,
    };
  }

  const memorySessionId = store.getOrCreateManualSession(options.project);
  const narrative = renderRecord(round.parsed);

  const metadata = {
    record_id: recordId,
    status: round.parsed.status,
    date: round.parsed.date,
    decided_by: round.parsed.decidedBy,
    summary: round.parsed.summary,
    // Same harvest the importer keeps: the record of what the text actually
    // offered, and the only defence against a parser that quietly stops
    // recognising a label.
    fields: round.parsed.fields.map(f => ({ name: f.name, value: f.value, line: f.line })),
    unlabelled: round.parsed.unlabelled,
    // Marks the row as authored rather than imported. Export/import and
    // `curated:show` need to tell them apart, and `source_path` alone would
    // make that a string-prefix test in five places.
    authored: true,
    // AN EDIT OF A RETIRED RECORD STAYS RETIRED.
    //
    // Correcting the text of a record that a supersession or an author closed
    // must not put it back in force. Nothing would report that: the record
    // would simply start applying again, and the decision that replaced it
    // would go on applying too. So the closure travels with the new revision,
    // marker and all, and a later `applySupersessions` recomputes from exactly
    // the state it would have seen before.
    ...closureOf(existing),
  };

  const stored = store.storeCuratedRecord(
    memorySessionId,
    options.project,
    {
      recordId,
      title: `${recordId} — ${round.parsed.title}`,
      subtitle: subtitleFor(round.parsed),
      narrative,
      metadata: JSON.stringify(metadata),
      sourcePath,
      sourceLine: round.parsed.headingLine,
      subject: round.parsed.title,
      validFrom: draft.validFrom ?? nowEpoch,
      validTo: draft.validTo ?? (existing?.valid_to ?? null),
      lastVerifiedAt: draft.lastVerifiedAt ?? null,
    },
    nowEpoch,
  );

  // Edges are replaced per source path, so an edit that drops a relation drops
  // its edge — the same property the file importer has when a line is deleted
  // from a record. A relation that survives only because nobody re-read the
  // file is an assertion nobody can check.
  const { inserted } = store.replaceEdgesForSource(
    options.project,
    sourcePath,
    round.edges.map(edge => ({
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      certainty: edge.certainty,
      sourceLine: edge.sourceLine,
      rawText: edge.rawText,
    })),
    nowEpoch,
  );

  logger.info('DB', 'Curated record authored', {
    project: options.project,
    recordId,
    id: stored.id,
    edited: existing !== null,
    revisionsClosed: stored.revisionsClosed,
    edges: inserted,
  });

  return {
    id: stored.id,
    recordId,
    title: round.parsed.title,
    sourcePath,
    edited: existing !== null,
    revisionsClosed: stored.revisionsClosed,
    edges: inserted,
    markdown: round.markdown,
  };
}
