// SPDX-License-Identifier: Apache-2.0
//
// Set E — does a record come back when you quote it?
//
// EVERY OTHER SET IS A PARAPHRASE, AND THAT IS STILL RIGHT. `run.ts` says why:
// a question quoting a record's own TITLE measures string equality and reports
// it as retrieval quality. Measured, and the warning holds — five title quotes
// all returned their record at rank 1 before anything was changed, because
// `title` carries bm25 weight 10.
//
// The body does not. A sentence lifted verbatim out of a record's PROSE is
// still a quotation, but it competes at weight 1 against a semantic score
// carrying three quarters of the fused ranking, and FTS5's bm25 does not reward
// adjacency — it cannot tell a record that contains your sentence from one that
// uses the same words apart. Measured against the running worker over 25
// records, before the exact-wording promotion existed:
//
//   @1 56%   @10 88%   MRR 0.656
//
// So this set CAN fail, which is what makes it worth running. It measures one
// thing only: whether a known-present exact match is ranked first. It says
// nothing about retrieval quality, and it must not be read as though it did.
//
// THE CASES ARE READ OUT OF THE CORPUS, not written by hand. A hand-written
// quotation is a transcription, and a transcription that drifts by one word
// stops measuring exact wording without saying so.

/** One quotation and the record it was taken from. */
export interface VerbatimCase {
  id: number;
  title: string;
  sentence: string;
}

interface CorpusRow {
  id: number;
  title: string | null;
  narrative: string | null;
}

/** Shortest and longest quotation worth asking. */
const MIN_WORDS = 8;
const MAX_WORDS = 22;

/**
 * A sentence out of the record's own prose, or null when it has none.
 *
 * Headings, tables, list markers and the header line are skipped: they are
 * structure, not wording. So are the `titel:` front-matter line and any line
 * carrying the ` · ` metadata separator — both restate the title, which would
 * quietly turn this back into the title-quote measurement the set exists to
 * avoid.
 */
export function bodySentence(narrative: string, title: string | null): string | null {
  for (const line of narrative.split('\n')) {
    const text = line.trim();
    if (!text) continue;
    if (/^[#|\-*]/.test(text)) continue;
    if (/^titel:/i.test(text) || text.includes(' · ')) continue;
    if (title && text.includes(title.slice(0, 20))) continue;

    for (const raw of text.split(/(?<=[.!?])\s+/)) {
      const sentence = raw.replace(/[*_`]/g, '').trim();
      if (/^Stand:/.test(sentence)) continue;
      const words = sentence.split(/\s+/);
      if (words.length >= MIN_WORDS && words.length <= MAX_WORDS) {
        return sentence.replace(/[.!?]+$/, '');
      }
    }
  }
  return null;
}

/**
 * Quotations spread across the corpus, in a fixed order.
 *
 * Every `stride`-th record rather than the first N: the corpus is ordered by
 * import, so the first N are one directory in one sitting. Deterministic
 * rather than random, so two runs are comparable — which is the whole reason
 * the harness exists.
 */
export function buildVerbatimCases(rows: CorpusRow[], max: number, stride = 7): VerbatimCase[] {
  const cases: VerbatimCase[] = [];
  for (let i = 0; i < rows.length && cases.length < max; i += stride) {
    const row = rows[i];
    if (!row.narrative) continue;
    const sentence = bodySentence(row.narrative, row.title);
    if (sentence) cases.push({ id: row.id, title: row.title ?? String(row.id), sentence });
  }
  return cases;
}

/**
 * Where the quoted record landed, 0 when it is not in the list at all.
 *
 * By ROW ID, not by record number: half the corpus is work items (`V-0148`),
 * and `recordNumber` in `run.ts` reads decision numbers only. Scoring this set
 * by number would silently drop every work item and report the result as a
 * complete run.
 */
export function rankOf(caseId: number, ids: number[]): number {
  return ids.indexOf(caseId) + 1;
}

export interface VerbatimSummary {
  n: number;
  hit1: number;
  hit10: number;
  mrr: number;
}

export function summariseVerbatim(ranks: number[]): VerbatimSummary {
  const n = ranks.length;
  if (n === 0) return { n: 0, hit1: 0, hit10: 0, mrr: 0 };
  const hit1 = ranks.filter(r => r === 1).length / n;
  const hit10 = ranks.filter(r => r >= 1).length / n;
  const mrr = ranks.reduce((sum, r) => sum + (r >= 1 ? 1 / r : 0), 0) / n;
  return { n, hit1, hit10, mrr };
}
