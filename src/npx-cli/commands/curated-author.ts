// SPDX-License-Identifier: Apache-2.0
//
// `keepmind curated:add|edit|supersede|close|show` — lasting entries created
// and changed INSIDE keepmind, with no source file anywhere.
//
// These commands are the file-free counterpart to `curated:import`, and they
// take the identical write path: straight to SessionStore, nothing enqueued.
// The observation queue is the only thing in keepmind that reaches a model, so
// "no model is involved" is a property of the code path rather than a promise
// in a doc comment — `tests/curated/authoring.test.ts` fails the moment this
// path reaches for anything but plain storage.
//
// Text arrives verbatim: `--body-file`, `--body-stdin` or `--json-stdin`. It is
// never summarised, classified or rephrased on the way in.

import { readFileSync } from 'node:fs';
import type { CuratedDraft, DeclaredRelation } from '../../services/curated/authoring.js';
import type { RelationName } from '../../services/curated/relation-lexicon.js';

export type CuratedAuthorAction = 'add' | 'edit' | 'supersede' | 'close' | 'reopen' | 'show' | 'history';

export interface CuratedAuthorOptions {
  action: CuratedAuthorAction;
  /** Positional arguments, action-specific. */
  positional: string[];
  project?: string;
  title?: string;
  status?: string;
  date?: string;
  decidedBy?: string;
  summary?: string;
  /** `--field Name=Value`, repeatable. */
  fields: Array<{ name: string; value: string }>;
  /** `--rel supersedes:0042`, repeatable. Replaces the whole relation set. */
  relations: DeclaredRelation[];
  /** True when --rel was given at all — an empty set must be distinguishable. */
  relationsGiven: boolean;
  body?: string;
  reason?: string;
  validFrom?: number;
  validTo?: number;
  /** Read a complete draft as JSON from stdin. */
  jsonStdin: boolean;
  dryRun: boolean;
  json: boolean;
  all: boolean;
}

function parseRelation(spec: string): DeclaredRelation {
  const colon = spec.indexOf(':');
  if (colon < 0) {
    throw new Error(`--rel expects RELATION:TARGET[,TARGET], got "${spec}"`);
  }
  const relation = spec.slice(0, colon).trim() as RelationName;
  const targets = spec.slice(colon + 1).split(',').map(t => t.trim()).filter(Boolean);
  return { relation, targets };
}

export function parseCuratedAuthorOptions(action: CuratedAuthorAction, args: string[]): CuratedAuthorOptions {
  const options: CuratedAuthorOptions = {
    action, positional: [], fields: [], relations: [], relationsGiven: false,
    jsonStdin: false, dryRun: false, json: false, all: false,
  };

  const value = (i: number, arg: string): [string, number] => {
    const eq = arg.indexOf('=');
    if (eq > 0) return [arg.slice(eq + 1), i];
    return [args[i + 1], i + 1];
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const name = arg.startsWith('--') ? arg.split('=')[0] : arg;
    switch (name) {
      case '--json': options.json = true; continue;
      case '--dry-run': options.dryRun = true; continue;
      case '--all': options.all = true; continue;
      case '--json-stdin': options.jsonStdin = true; continue;
      case '--project': { const [v, j] = value(i, arg); options.project = v; i = j; continue; }
      case '--title': { const [v, j] = value(i, arg); options.title = v; i = j; continue; }
      case '--status': { const [v, j] = value(i, arg); options.status = v; i = j; continue; }
      case '--date': { const [v, j] = value(i, arg); options.date = v; i = j; continue; }
      case '--by': { const [v, j] = value(i, arg); options.decidedBy = v; i = j; continue; }
      case '--summary': { const [v, j] = value(i, arg); options.summary = v; i = j; continue; }
      case '--reason': { const [v, j] = value(i, arg); options.reason = v; i = j; continue; }
      case '--body': { const [v, j] = value(i, arg); options.body = v; i = j; continue; }
      case '--body-file': { const [v, j] = value(i, arg); options.body = readFileSync(v, 'utf8'); i = j; continue; }
      case '--body-stdin': { options.body = readFileSync(0, 'utf8'); continue; }
      case '--valid-from': { const [v, j] = value(i, arg); options.validFrom = Date.parse(v); i = j; continue; }
      case '--valid-to': { const [v, j] = value(i, arg); options.validTo = Date.parse(v); i = j; continue; }
      case '--field': {
        const [v, j] = value(i, arg); i = j;
        const eq = v.indexOf('=');
        if (eq < 0) throw new Error(`--field expects Name=Value, got "${v}"`);
        options.fields.push({ name: v.slice(0, eq).trim(), value: v.slice(eq + 1) });
        continue;
      }
      case '--rel': {
        const [v, j] = value(i, arg); i = j;
        options.relationsGiven = true;
        if (v.trim() !== '' && v.trim() !== 'none') options.relations.push(parseRelation(v));
        continue;
      }
      default:
        if (arg.startsWith('--')) continue;
        options.positional.push(arg);
    }
  }

  for (const key of ['validFrom', 'validTo'] as const) {
    const parsed = options[key];
    if (parsed !== undefined && !Number.isFinite(parsed)) {
      throw new Error(`--${key === 'validFrom' ? 'valid-from' : 'valid-to'} is not a date keepmind can read (try 2026-08-25).`);
    }
  }

  return options;
}

export function curatedAuthorUsage(): string {
  return [
    'Lasting entries that live in keepmind — no source file at any point.',
    '',
    '  keepmind curated:add        --title "…" [--status gilt] [--rel supersedes:0042] [--body-stdin]',
    '  keepmind curated:edit  0068 [--title "…"] [--status abgelöst] [--body-file note.md]',
    '  keepmind curated:supersede 0069 0042    # 0069 supersedes 0042, then applies it',
    '  keepmind curated:close 0042 --reason "…"',
    '  keepmind curated:reopen 0042',
    '  keepmind curated:show 0068 [--all]      # --all lists every revision',
    '',
    'Options:',
    '  --project <name>     Project the record belongs to (default: cwd project)',
    '  --title/--status/--date/--by/--summary   Header fields, stored verbatim',
    '  --field Name=Value   Any other header label, repeatable',
    '  --rel REL:TARGET     Declared relation, repeatable. Giving --rel at all',
    '                       REPLACES the record\'s whole relation set; `--rel none`',
    '                       clears it. Relations: supersedes, restricts, sharpens,',
    '                       continues, corrects, closes, extends, applies, confirms,',
    '                       concerns, reverses, based_on, triggered_by, resolves',
    '  --body <text> | --body-file <path> | --body-stdin   The record body, verbatim',
    '  --valid-from / --valid-to <date>   Author-declared validity window',
    '  --json-stdin         Read a complete draft as JSON from stdin',
    '  --dry-run            Render and verify, write nothing (prints the record)',
    '  --json               Machine-readable output',
    '',
    'EDIT-IN-PLACE: `curated:edit` changes the SAME entry. The record number is the',
    'identity; the previous revision keeps its text and gets its validity window',
    'closed, so exactly one revision per record is ever current. Nothing is deleted,',
    'and nothing piles up on the surface.',
    '',
    'No model is involved at any point.',
  ].join('\n');
}

/** Fields that have their own flag and must not be duplicated as `--field`. */
const NAMED_FIELDS: Record<string, keyof CuratedAuthorOptions> = {
  'stand': 'status',
  'datum': 'date',
  'entschieden von': 'decidedBy',
  'kurz': 'summary',
};

export async function runCuratedAuthorCommand(options: CuratedAuthorOptions): Promise<void> {
  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  const authoring = await import('../../services/curated/authoring.js');
  const { getProjectName } = await import('../../utils/project-name.js');

  const project = options.project ?? getProjectName(process.cwd());
  const store = new SessionStore();

  try {
    switch (options.action) {
      case 'show':
      case 'history':
        return showRecord(store, authoring, project, options);
      case 'close':
        return closeRecord(store, project, options);
      case 'reopen':
        return reopenRecord(store, project, options);
      case 'supersede':
        return await supersedeRecord(store, authoring, project, options);
      case 'add':
      case 'edit':
        return await writeRecord(store, authoring, project, options);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    else console.error(message);
    process.exitCode = 1;
  }
}

type Authoring = typeof import('../../services/curated/authoring.js');

/** Build the draft this invocation should store. */
function buildDraft(
  store: InstanceType<typeof import('../../services/sqlite/SessionStore.js').SessionStore>,
  authoring: Authoring,
  project: string,
  options: CuratedAuthorOptions,
): CuratedDraft {
  if (options.jsonStdin) {
    const raw = readFileSync(0, 'utf8');
    const draft = JSON.parse(raw) as CuratedDraft;
    if (options.positional[0]) draft.recordId = options.positional[0];
    return draft;
  }

  let draft: CuratedDraft;

  if (options.action === 'edit') {
    const recordId = options.positional[0];
    if (!recordId) throw new Error('curated:edit needs a record number, e.g. `keepmind curated:edit 0068`.');
    const existing = store.getCuratedRecord(project, recordId);
    if (!existing) {
      throw new Error(
        `No active record ${recordId} in project "${project}". ` +
        `\`keepmind curated:show ${recordId} --all\` lists its revisions if it was closed.`,
      );
    }
    // Rebuild from the stored TEXT, so every header label survives an edit —
    // including labels this CLI has no flag for.
    draft = authoring.draftFromRecordText(recordId, stripRecordPrefix(existing.title, recordId), existing.narrative ?? '');
  } else {
    draft = { recordId: options.positional[0], title: options.title ?? '' };
    if (!draft.title.trim()) throw new Error('curated:add needs --title.');
  }

  if (options.title !== undefined) draft.title = options.title;
  if (options.status !== undefined) authoring.setField(draft, 'Stand', options.status);
  if (options.date !== undefined) authoring.setField(draft, 'Datum', options.date);
  if (options.decidedBy !== undefined) authoring.setField(draft, 'Entschieden von', options.decidedBy);
  if (options.summary !== undefined) authoring.setField(draft, 'Kurz', options.summary);
  for (const field of options.fields) {
    if (NAMED_FIELDS[field.name.toLowerCase()]) {
      throw new Error(`Use --${NAMED_FIELDS[field.name.toLowerCase()] === 'decidedBy' ? 'by' : String(NAMED_FIELDS[field.name.toLowerCase()])} for "${field.name}" rather than --field, so it lands in the canonical position.`);
    }
    authoring.setField(draft, field.name, field.value);
  }
  if (options.relationsGiven) authoring.setRelations(draft, options.relations);
  if (options.body !== undefined) draft.body = options.body;
  if (options.validFrom !== undefined) draft.validFrom = options.validFrom;
  if (options.validTo !== undefined) draft.validTo = options.validTo;

  return draft;
}

/** Stored titles are `0068 — Title`; the draft carries the title alone. */
function stripRecordPrefix(title: string | null, recordId: string): string {
  const text = title ?? '';
  const prefix = new RegExp(`^${recordId}\\s*[—–-]\\s*`);
  return text.replace(prefix, '');
}

async function writeRecord(
  store: InstanceType<typeof import('../../services/sqlite/SessionStore.js').SessionStore>,
  authoring: Authoring,
  project: string,
  options: CuratedAuthorOptions,
): Promise<void> {
  const draft = buildDraft(store, authoring, project, options);
  const result = authoring.authorCuratedRecord(store as never, draft, {
    project,
    dryRun: options.dryRun,
    expect: options.action === 'edit' ? 'existing' : (draft.recordId ? 'new' : undefined),
  });

  const indexed = options.dryRun ? null : await requestIndex(project);

  if (options.json) {
    console.log(JSON.stringify({ ok: true, project, dryRun: options.dryRun, ...result, indexed }, null, 2));
    return;
  }

  if (options.dryRun) {
    console.log(`Would ${result.edited ? 'edit' : 'create'} ${result.recordId} in "${project}" (${result.edges} declared relation(s)).\n`);
    console.log(result.markdown);
    console.log('Nothing was written.');
    return;
  }

  console.log(`${result.edited ? 'Edited' : 'Created'} ${result.recordId} — ${result.title}`);
  console.log(`  project ${project} · observation #${result.id} · ${result.edges} declared relation(s)`);
  console.log(`  ${result.sourcePath}:1`);
  if (result.revisionsClosed > 0) {
    // Said out loud: this is the difference between an edit and a second entry.
    console.log(`  ${result.revisionsClosed} previous revision(s) closed — the record still has exactly one current text.`);
  }
  reportIndex(indexed);
}

async function supersedeRecord(
  store: InstanceType<typeof import('../../services/sqlite/SessionStore.js').SessionStore>,
  authoring: Authoring,
  project: string,
  options: CuratedAuthorOptions,
): Promise<void> {
  const [newId, oldId] = options.positional;
  if (!newId || !oldId) {
    throw new Error('curated:supersede needs two record numbers: the one that takes over, then the one it replaces.');
  }
  const successor = store.getCuratedRecord(project, newId);
  if (!successor) throw new Error(`No active record ${newId} in project "${project}".`);
  if (!store.getCuratedRecord(project, oldId)) {
    // Refused rather than recorded: a supersession pointing at nothing retires
    // nothing, and the report would say a record had been replaced when the
    // record it names does not exist.
    throw new Error(`No active record ${oldId} in project "${project}" — refusing to declare a supersession of a record that is not there.`);
  }

  const draft = authoring.draftFromRecordText(newId, stripRecordPrefix(successor.title, newId), successor.narrative ?? '');

  // Keep the relations the record already declares and add this one, expressed
  // in the same clause form — read back out of the existing header rather than
  // reconstructed from the edge table, so an edit never quietly rewrites what
  // the author wrote.
  // Only an existing SUPERSESSION blocks this — not any relation that happens
  // to name the record. `schränkt 0001 ein` and `löst 0001 ab` are two
  // different statements about the same pair, and the graph is built to hold
  // both; refusing the second because the first mentions the number would make
  // the command unusable exactly where it is most useful.
  if (store.getEdges(project).some(e => e.from_record === newId && e.to_record === oldId && e.relation === 'supersedes')) {
    throw new Error(
      `${newId} already declares that it supersedes ${oldId}. ` +
      `Declaring it twice would put two citations in the graph for one statement.`,
    );
  }
  // The existing clauses stay put as ordinary header fields; the new one is
  // appended as a declared relation. Both end up in the header, and both are
  // read back through the edge reader before anything is written.
  draft.relations = [{ relation: 'supersedes', targets: [oldId] }];

  const result = authoring.authorCuratedRecord(store as never, draft, { project, dryRun: options.dryRun, expect: 'existing' });

  if (options.dryRun) {
    console.log(result.markdown);
    console.log('Nothing was written.');
    return;
  }

  const { applySupersessions } = await import('../../services/curated/supersession.js');
  const report = applySupersessions(store.db as never, project);
  const indexed = await requestIndex(project);

  if (options.json) {
    console.log(JSON.stringify({ ok: true, project, ...result, supersession: report, indexed }, null, 2));
    return;
  }

  console.log(`${newId} now declares that it supersedes ${oldId}.`);
  console.log(`  ${report.closed.length} record(s) retired by ${report.edgesApplied} edge(s), ${report.reopened} window(s) reopened.`);
  if (report.uncertain.length > 0) {
    console.log(`  ${report.uncertain.length} uncertain supersession(s) NOT applied — decide by hand.`);
  }
  if (report.unknownTargets.length > 0) {
    console.log(`  ${report.unknownTargets.length} edge(s) name a record with no row.`);
  }
  reportIndex(indexed);
}

function closeRecord(
  store: InstanceType<typeof import('../../services/sqlite/SessionStore.js').SessionStore>,
  project: string,
  options: CuratedAuthorOptions,
): void {
  const recordId = options.positional[0];
  if (!recordId) throw new Error('curated:close needs a record number.');
  const { closed } = store.closeCuratedRecord(project, recordId, { reason: options.reason ?? null });
  if (options.json) { console.log(JSON.stringify({ ok: closed > 0, project, recordId, closed }, null, 2)); return; }
  if (closed === 0) {
    console.log(`No active record ${recordId} in project "${project}" — nothing to close.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Closed ${recordId}. Its text stays readable and searchable; it just stops counting as current.`);
}

function reopenRecord(
  store: InstanceType<typeof import('../../services/sqlite/SessionStore.js').SessionStore>,
  project: string,
  options: CuratedAuthorOptions,
): void {
  const recordId = options.positional[0];
  if (!recordId) throw new Error('curated:reopen needs a record number.');
  const { reopened } = store.reopenCuratedRecord(project, recordId);
  if (options.json) { console.log(JSON.stringify({ ok: reopened > 0, project, recordId, reopened }, null, 2)); return; }
  console.log(reopened > 0
    ? `Reopened ${recordId}.`
    : `${recordId} was not closed by hand in project "${project}" — nothing to reopen.`);
}

function showRecord(
  store: InstanceType<typeof import('../../services/sqlite/SessionStore.js').SessionStore>,
  authoring: Authoring,
  project: string,
  options: CuratedAuthorOptions,
): void {
  const recordId = options.positional[0];
  if (!recordId) throw new Error('curated:show needs a record number.');

  const showAll = options.all || options.action === 'history';
  const revisions = store.getCuratedRevisions(project, recordId);
  if (revisions.length === 0) {
    console.log(`No record ${recordId} in project "${project}".`);
    process.exitCode = 1;
    return;
  }

  const current = revisions.find(r => r.valid_to === null) ?? null;

  if (options.json) {
    console.log(JSON.stringify({ project, recordId, current, revisions: showAll ? revisions : undefined }, null, 2));
    return;
  }

  const render = (row: typeof revisions[number], label: string) => {
    console.log(`\n── ${label} · observation #${row.id} · written ${new Date(row.created_at_epoch).toISOString().slice(0, 10)}`);
    if (row.valid_to !== null) {
      const meta = safeJson(row.metadata);
      const why = meta.revised_by ? `revised by #${meta.revised_by}`
        : meta.superseded_by_record ? `superseded by ${meta.superseded_by_record}`
        : meta.closed_by_author ? `closed by the author${meta.closed_reason ? ` — ${meta.closed_reason}` : ''}`
        : 'closed';
      console.log(`   valid until ${new Date(row.valid_to).toISOString().slice(0, 10)} · ${why}`);
    }
    console.log(`\n# ${row.title}\n`);
    console.log(row.narrative ?? '');
  };

  if (current) render(current, 'current');
  else console.log(`Record ${recordId} has no current revision — it was closed.`);

  if (showAll) {
    for (const row of revisions) {
      if (current && row.id === current.id) continue;
      render(row, 'earlier revision');
    }
    console.log(`\n${revisions.length} revision(s) total. Nothing here was ever deleted.`);
  } else {
    // Counted against what was actually printed. With no current revision
    // nothing above was shown, so subtracting one would under-report the
    // history of exactly the record whose history is the only thing left.
    const unread = current ? revisions.length - 1 : revisions.length;
    if (unread > 0) console.log(`\n${unread} earlier revision(s) — \`--all\` to read them.`);
  }
}

function safeJson(text: string | null): Record<string, unknown> {
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return {}; }
}

/**
 * Ask the worker to index what was just written.
 *
 * Same reason as in `curated:import`: this process writes rows directly and
 * enqueues nothing — that is what keeps a curated record away from a model — so
 * nothing else tells the worker the rows exist, and their embeddings would
 * otherwise appear only at the next periodic pass. Measured there: semantic
 * search returned nothing for the new rows and reported no error.
 */
async function requestIndex(project: string): Promise<{ indexed: boolean; reason?: string }> {
  const { requestBackfill } = await import('./curated.js');
  return requestBackfill(project);
}

function reportIndex(indexed: { indexed: boolean; reason?: string } | null): void {
  if (!indexed) return;
  if (indexed.indexed) { console.log('  Semantic index updated.'); return; }
  console.log(`  ⚠ Semantic index NOT updated: ${indexed.reason}`);
  console.log('    Keyword search works now; semantic search follows at the worker\'s next pass.');
}
