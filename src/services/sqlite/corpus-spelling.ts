// SPDX-License-Identifier: Apache-2.0
//
// Spell a query the way the corpus spells it, before it is embedded.
//
// WHY THIS EXISTS. The keyword channel already answers both German spellings:
// `fts-query.ts` ORs every variant of every term, so "Pruefung" and "Prüfung"
// produce the same MATCH expression. The semantic channel cannot do that —
// there is no OR in a vector. One query text becomes one vector, and
// multilingual-e5 tokenises "Prüfung" and "Pruefung" into different subword
// sequences, so the two land in different places. Measured on the live corpus
// (333 records, `evals/memory`, set D = the same term in both spellings):
//
//   channel   agreement between the two result lists
//   fts       89%
//   vector    13%
//   worker    27%   ← what a person actually gets
//
// The fused path sits between the two because it fuses them. So the gap is
// entirely in the semantic leg, and folding the STORED text is not the way to
// close it: that means re-embedding the whole corpus, and it would spell the
// corpus in a form the model was not trained on.
//
// WHAT IS DONE INSTEAD. The corpus itself is asked which spelling it uses, and
// the query is rewritten into that one. The evidence is `observations_fts`'s
// own vocabulary — the terms the index actually holds, with the number of
// documents each appears in:
//
//   prufung 65 · pruefung 20      ablosung 21 · abloesung 0
//   vollstandig 64 · vollstaendig 8   ausdrucklich 98 · ausdruecklich 32
//   maßstab 19 · massstab 9       wachter 18 · waechter 11
//
// Both spellings genuinely occur, and the umlaut form dominates every pair. So
// "Pruefung" is rewritten to "Prüfung", "Prüfung" is left alone, and the two
// queries become the SAME query — one vector, one result list, agreement by
// construction rather than by coincidence.
//
// A REWRITE IS NARROWER THAN AN OR, AND THAT IS THE COST. `Masse` and `Maße`
// are different German words; this corpus writes `maße` 36 times and `masse`
// 11, so a question about `Masse` is embedded as `Maße`. Nothing becomes
// unfindable — the keyword leg still carries the spelling as typed, and it is
// the leg that answers exact wording — but the semantic leg does move. The
// alternative, embedding both spellings and merging, was rejected: it is not
// symmetric (the canonical spelling produces one vector and the other produces
// two), so the two spellings would still return different lists, which is the
// whole thing being fixed.
//
// ONLY AN ATTESTED SPELLING WINS. A variant the corpus does not contain is
// never used, and that is not a refinement — it is what keeps the ambiguous
// direction safe. `ue → ü` turns "Steuerung" into the non-word "Steürung". In
// the keyword channel that costs nothing, because a term that does not occur
// matches nothing. In the semantic channel it costs everything: a nonsense
// vector still has a hundred nearest neighbours, and they are noise. Measured:
// `steuerung` 26 documents, `sterung` (the folded non-word) 0 — so the
// non-word loses to its own source term and the query is left alone.

import { Database } from '../../storage/db.js';
import { DB_PATH } from '../../shared/paths.js';
import { spellingVariants } from './fts-query.js';
import { logger } from '../../utils/logger.js';

/** How many documents a term appears in, keyed by its indexed form. */
export interface SpellingVocabulary {
  documentsWith(foldedTerm: string): number;
}

/**
 * A term as `observations_fts` stores it.
 *
 * This has to match the index's `unicode61` tokenizer, NOT `fold()` in the
 * reconciler — they disagree, and the disagreement is silent. `unicode61`
 * removes diacritics (`ü → u`) and leaves `ß` alone; `fold()` transliterates
 * (`ü → ue`, `ß → ss`) because it exists to compare wording, not to address an
 * index. Measured against the live vocabulary: the terms are `prufung` and
 * `maßstab`, so a lookup folded the reconciler's way finds neither and every
 * spelling reads as unattested.
 */
export function vocabFold(term: string): string {
  return term
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .normalize('NFC');
}

/** True for a spelling that carries a German letter the ASCII form does not. */
function isGermanForm(term: string): boolean {
  return /[äöüßÄÖÜ]/.test(term);
}

/**
 * Which of two equally attested spellings to prefer.
 *
 * A total order, and it has to be: the winner must not depend on the order the
 * variants were generated in, or the two spellings of one word would resolve
 * differently and the result lists would diverge again. The German form wins
 * first because that is what this corpus writes; the lexicographic fallback is
 * only there to make the order total.
 */
function preferred(candidate: string, incumbent: string): boolean {
  const candidateIsGerman = isGermanForm(candidate);
  const incumbentIsGerman = isGermanForm(incumbent);
  if (candidateIsGerman !== incumbentIsGerman) return candidateIsGerman;
  return candidate < incumbent;
}

/**
 * The spelling of one token that the corpus attests most often.
 *
 * Returns the token unchanged when no spelling of it occurs at all. That case
 * is deliberately left asymmetric: with neither spelling in the corpus there is
 * nothing to agree about, and rewriting on no evidence is how "Feuerwerk"
 * becomes "Feürwerk".
 */
export function attestedSpelling(token: string, vocabulary: SpellingVocabulary): string {
  const variants = spellingVariants(token);
  if (variants.length < 2) return token;

  let best: string | null = null;
  let bestCount = 0;
  for (const variant of variants) {
    const count = vocabulary.documentsWith(vocabFold(variant));
    if (count === 0) continue;
    if (count > bestCount || (count === bestCount && best !== null && preferred(variant, best))) {
      best = variant;
      bestCount = count;
    }
  }
  return best ?? token;
}

/**
 * The query, with every word spelled the way the corpus spells it.
 *
 * Rewrites in place so punctuation, word order and everything the model reads
 * as structure survive — this text goes to an embedder, not to a parser. The
 * token shape is the same one `queryTerms` uses, hyphen included, so a query
 * and its keyword expression agree on where a word starts and ends.
 */
export function canonicalSpelling(raw: string, vocabulary: SpellingVocabulary): string {
  return raw.replace(/[\p{L}\p{N}-]+/gu, token => attestedSpelling(token, vocabulary));
}

/**
 * The vocabulary of `observations_fts`, read through an `fts5vocab` view.
 *
 * Counts are cached per term and the whole cache expires, rather than being
 * invalidated: a fresh install has an empty index, and a spelling cached as
 * unattested at boot would stay unattested for the life of the process.
 */
class FtsVocabulary implements SpellingVocabulary {
  private static readonly CACHE_TTL_MS = 5 * 60_000;
  private static readonly VIEW = 'temp.keepmind_spelling_vocab';

  private counts = new Map<string, number>();
  private cachedAt = Date.now();
  private readonly lookup;

  constructor(private readonly db: Database) {
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS ${FtsVocabulary.VIEW} USING fts5vocab(main, observations_fts, 'row')`);
    this.lookup = db.prepare(`SELECT doc FROM ${FtsVocabulary.VIEW} WHERE term = ?`);
  }

  documentsWith(foldedTerm: string): number {
    if (Date.now() - this.cachedAt > FtsVocabulary.CACHE_TTL_MS) {
      this.counts.clear();
      this.cachedAt = Date.now();
    }
    const cached = this.counts.get(foldedTerm);
    if (cached !== undefined) return cached;

    let count = 0;
    try {
      const row = this.lookup.get(foldedTerm) as { doc?: number } | undefined;
      count = Number(row?.doc ?? 0) || 0;
    } catch (error) {
      logger.debug('DB', 'Spelling vocabulary lookup failed', { term: foldedTerm }, error instanceof Error ? error : undefined);
    }
    this.counts.set(foldedTerm, count);
    return count;
  }

  close(): void {
    try { this.db.close(); } catch { /* closing a spent connection is not a failure */ }
  }
}

let vocabulary: FtsVocabulary | null = null;
let openFailed = false;

/**
 * The process-wide vocabulary, or null when the corpus cannot be read.
 *
 * Its own read-only connection, for the same reason `SqliteVecManager` has one:
 * this runs inside the vector path, which does not otherwise hold the main
 * database, and threading a handle through every caller is how one funnel
 * becomes several. A failure is sticky and reported once — the cause cannot
 * change without a restart, and a query that pays a failed open and logs a
 * stack on every search is how one broken install produces thousands of error
 * lines (see `SqliteVecManager.loadFailure`).
 */
export function corpusSpellingVocabulary(): SpellingVocabulary | null {
  if (vocabulary) return vocabulary;
  if (openFailed) return null;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const hasFts = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'")
      .get() as { name?: string } | undefined;
    if (!hasFts?.name) {
      db.close();
      throw new Error('observations_fts is not present');
    }
    vocabulary = new FtsVocabulary(db);
    return vocabulary;
  } catch (error) {
    openFailed = true;
    logger.debug('DB', 'Corpus spelling unavailable — queries are embedded as typed', {}, error instanceof Error ? error : undefined);
    return null;
  }
}

/**
 * The query as the corpus spells it, or unchanged when the corpus cannot say.
 *
 * Degrading to the raw query is the only safe failure: an unreadable
 * vocabulary must cost nothing more than the spelling agreement it was there
 * to buy.
 */
export function canonicaliseQuerySpelling(raw: string): string {
  if (!raw) return raw;
  const vocab = corpusSpellingVocabulary();
  if (!vocab) return raw;
  try {
    return canonicalSpelling(raw, vocab);
  } catch (error) {
    logger.debug('DB', 'Spelling canonicalisation failed — embedding the query as typed', {}, error instanceof Error ? error : undefined);
    return raw;
  }
}

/** Drop the cached connection. Tests only. */
export function resetCorpusSpelling(): void {
  vocabulary?.close();
  vocabulary = null;
  openFailed = false;
}
