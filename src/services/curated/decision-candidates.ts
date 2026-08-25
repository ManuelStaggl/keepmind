// SPDX-License-Identifier: Apache-2.0
//
// "Has this already been decided?" — what the candidate records actually SAY,
// and a measured account of why they cannot be filtered by similarity.
//
// THE FAILURE THIS ADDRESSES. The check offered its top three candidates for
// every question ever asked, showing each one's title and SUBTITLE — and a
// record's subtitle is its header line, `Stand: gilt · 11.08.2026 · Manuel`.
// That is metadata about the decision, not the decision. Measured live on a
// question about whether to push two git commits, the offer was `0110 — Die
// Grenze ist das Firmennetz`, `0115 — Ohne offizielle Regeln und
// Ansprechpartner ruhen die externen Punkte` and `0029 — Die Form wird am
// Entwurf geprüft`: three false hits, and nothing on screen with which to tell
// them from real ones.
//
// ── WHY THERE IS NO RELEVANCE THRESHOLD HERE ────────────────────────────────
//
// Not an oversight, and not a thing left for later. Three measurements say a
// number cannot do this job with the embedder this store runs on. Read them
// before adding one.
//
// 1. THERE IS NO SCORE TO THRESHOLD. `rrfFuse` ranks by RECIPROCAL RANK: rank
//    1 scores the same whether the match is perfect or absurd. Nothing in a
//    search result carries how close the match was.
//
// 2. THE RAW DISTANCE DOES NOT SEPARATE. multilingual-e5-small packs the
//    neighbourhood into a ~0.03 band — already measured, independently, in
//    `SqliteVecManager`, where a global top-32 held zero rows of the requested
//    project. Measured again here against the live corpus of 333 entries:
//
//        "Wo werden Entscheidungen abgelegt?"   0.1345   (answered by 0002)
//        "Zwei Commits liegen lokal. Pushen?"   0.1467   (nothing answers it)
//        "Wie wird der Geltungsbereich …?"      0.1642   (answered by 0003)
//
//    The noise question sits BETWEEN two real ones. No cut admits the real
//    ones without admitting it.
//
// 3. NEITHER DOES THE GAP TO THE NEXT NEIGHBOUR — and this one nearly shipped.
//    A first run over 30 "real" questions showed a clean separation from 15
//    noise questions (real min 0.0128, noise max 0.0086) and a cut at 0.009
//    was drafted on it. The 30 questions were WORK-ITEM TITLES, i.e. text
//    already stored in the corpus: every one of them retrieved ITSELF at
//    distance ≈ 0 and the gap was an artefact of that. Re-measured with
//    twelve independently phrased questions, against decision rows only so a
//    question cannot find itself:
//
//        real    n=12   min 0.0017   median 0.0063   max 0.0328
//        noise   n=15   min 0        median 0.0024   max 0.0094
//
//    Heavy overlap. A cut at 0.003 still lets 5 of 15 noise questions through
//    while already swallowing a real one; a cut at 0.009 keeps only 5 of 12
//    real ones. And swallowing a real candidate is the EXPENSIVE error — it
//    means a thing gets decided twice, by a person, possibly differently.
//
// So the reader is the filter, and the system's job is to give them enough to
// filter with in one glance. That is what `findingOf` is for. Making this
// check selective needs a different retrieval stage — a re-ranker, or an
// embedder whose distances spread — not a constant.
//
// WHAT THIS STILL MAY NOT SAY. It offers candidates. It never says "this was
// already decided", and it never says "there is no decision on this" — the
// second sentence may only come from the relation graph, never from a distance
// measure.

import { curatedIdOfRow } from './record-key.js';

export interface CandidateRow {
  title?: string | null;
  subtitle?: string | null;
  narrative?: string | null;
  type?: string | null;
  source_path?: string | null;
  source_line?: number | null;
  source_kind?: string | null;
  metadata?: string | null;
  valid_to?: number | null;
}

export interface DecisionCandidate {
  recordId: string | null;
  title: string;
  /** The record's own statement, in its own words. Empty when it has none. */
  finding: string;
  sourcePath: string | null;
  sourceLine: number | null;
}

/**
 * Curated DECISIONS only, and only the ones that still apply.
 *
 * Three exclusions, each for its own reason:
 *
 * Observed rows, though they are the bulk of the store: the question is "did we
 * already DECIDE this", and an observation records what happened, not what was
 * resolved. Mixing them buries the one kind of row that can answer.
 *
 * Work items, though they are curated too. A work item is the thing a decision
 * is carried out in — offering one as an answer to "has this been decided" is
 * answering with the task instead of the ruling. Observed in the first run:
 * three of six candidates were work items, one of them already closed.
 *
 * Retired records, because a superseded decision answering a live question is
 * worse than no answer at all.
 */
export function usable(row: CandidateRow): boolean {
  return row.source_kind === 'curated'
    && row.type === 'decision'
    && (row.valid_to === null || row.valid_to === undefined);
}

/** Longest finding shown. Past this a reader skims instead of reading. */
export const FINDING_LIMIT = 240;

/**
 * What the record actually says, in its own words.
 *
 * Preference order, and the reason for it: the author's own `summary` field is
 * the one-line version they wrote themselves; failing that, the prose under the
 * record's `## Entscheidung` heading is the statement; failing that, the first
 * prose paragraph.
 *
 * Header lines are skipped rather than trimmed. They are recognisable — bold
 * labels, or a blockquote note — and dropping them is precisely what leaves the
 * statement behind. Showing them instead is the bug this replaces.
 */
export function findingOf(row: CandidateRow): string {
  const summary = summaryFromMetadata(row.metadata);
  if (summary) return clip(summary);

  const narrative = row.narrative ?? '';
  if (!narrative.trim()) return '';

  const lines = narrative.split('\n');
  const heading = lines.findIndex(line => /^#{1,4}\s*(Entscheidung|Decision)\b/i.test(line.trim()));
  const start = heading >= 0 ? heading + 1 : 0;

  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim();
    // A blank line ends the paragraph — UNLESS what has been collected so far
    // ends in a colon, in which case the paragraph only introduced the
    // statement and the statement is what follows. Measured on record 0002,
    // whose finding read "Je Datenart eine eigene Behandlung, und ein
    // maschinischer Rückhalt für den Moment der Entscheidung:" — a heading for
    // the list below it, and nothing a reader can judge.
    //
    // The test is on the JOINED text, not on the last line: the corpus wraps
    // its prose, so the colon that ends a lead-in usually sits on a different
    // line from the words that make it one. Testing the line alone stopped
    // collection after the first wrapped line and cut the finding mid-sentence.
    if (!line) {
      if (out.length > 0 && !leadsOn(out, lines, i)) break;
      continue;
    }
    if (line.startsWith('#')) { if (out.length > 0 && !leadsOn(out, lines, i)) break; continue; }
    if (out.length === 0 && /^\*\*[^*]+:\*\*/.test(line)) continue;
    if (out.length === 0 && line.startsWith('>')) continue;
    out.push(line);
    if (out.join(' ').length >= FINDING_LIMIT) break;
  }
  return clip(out.join(' ').trim());
}

/**
 * Should collection continue past this break?
 *
 * Yes when what has been collected only LEADS UP to the statement — a
 * paragraph ending in a colon — and what follows is prose that can finish the
 * sentence.
 *
 * The colon is tested on the text with its markdown removed. The corpus writes
 * its lead-ins in bold, so the raw line ends `Entscheidung:**` and a test on
 * the raw text answers "no" about the clearest lead-in in the corpus.
 *
 * Not continued into a TABLE, and this is the common case: record 0002's
 * lead-in introduces a five-row table, and half a table row spliced onto a
 * sentence is less readable than the lead-in alone. A lead-in that introduces
 * something unreadable IS the best one-line version of the record there is.
 */
function leadsOn(collected: string[], lines: string[], from: number): boolean {
  if (!plain(collected.join(' ')).trimEnd().endsWith(':')) return false;
  for (let i = from; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    return !line.startsWith('|');
  }
  return false;
}

/**
 * Markdown emphasis, list bullets and link syntax, removed.
 *
 * The finding is read as prose in a terminal, not rendered: `**Stand:**` shows
 * its asterisks, and a `- ` bullet at the front of a sentence reads as a typo.
 * The words are untouched — only the marks around them go.
 */
function plain(text: string): string {
  return text
    .replace(/^[-*+]\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_]($|[\s.,;:!?])/g, '$1$2$3')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

function clip(text: string): string {
  const flat = plain(text).replace(/\s+/g, ' ').trim();
  if (flat.length <= FINDING_LIMIT) return flat;
  // Cut at a word boundary: a finding severed mid-word reads as corrupted
  // rather than as shortened.
  const cut = flat.slice(0, FINDING_LIMIT);
  const space = cut.lastIndexOf(' ');
  return `${(space > FINDING_LIMIT * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function summaryFromMetadata(metadata: string | null | undefined): string {
  if (!metadata) return '';
  try {
    const parsed = JSON.parse(metadata) as { summary?: unknown };
    return typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  } catch {
    // A malformed blob is not a reason to show nothing; the narrative is still
    // there to read the statement out of.
    return '';
  }
}

/** The usable rows, as candidates a reader can judge. */
export function toCandidates(rows: CandidateRow[], maxRows: number): DecisionCandidate[] {
  return rows.filter(usable).slice(0, maxRows).map(row => ({
    recordId: curatedIdOfRow(row.metadata ?? null),
    title: (row.title ?? '(untitled)').trim(),
    finding: findingOf(row),
    sourcePath: row.source_path ?? null,
    sourceLine: row.source_line ?? null,
  }));
}
