// SPDX-License-Identifier: Apache-2.0
//
// Turn a user's question into an FTS5 MATCH expression.
//
// WHY THIS EXISTS. Both search paths used to wrap the entire query in one pair
// of quotes — `"` + query + `"` — which is FTS5 syntax for an exact PHRASE.
// A question therefore only matched when its full word sequence appeared
// verbatim in a record. Measured against the real corpus before this module
// existed: `Regelwerk` returned 10 rows, `Gestaltung Regelwerk` returned 0,
// and all 34 multi-word questions in `evals/memory` scored 0% — the keyword
// channel retrieved nothing at all, for anyone, and had been doing so
// silently. The vector channel covered for it, which is exactly why nobody
// noticed.
//
// WHY OR AND NOT AND. Real questions carry words the record does not use
// ("Wo sitzt der Knopf, mit dem man zurückgeht?"). Requiring every term is
// nearly as empty as requiring the phrase. OR plus bm25 ranking is the
// ordinary information-retrieval answer: a record matching four terms outranks
// one matching a single term, without any term being mandatory.
//
// A quoted phrase the user typed themselves is preserved. Someone who writes
// quotes means them, and taking that away would remove the only way to ask an
// exact question.

import { STOPWORDS, fold } from '../reconcile/reconciler.js';
import { logger } from '../../utils/logger.js';

/**
 * Escape one term for use inside an FTS5 string literal.
 *
 * Every term is quoted, always. Unquoted, a bare word that happens to be `AND`,
 * `NOT`, `NEAR` or carries `*`/`^`/`:` is parsed as an operator, and a query
 * containing one throws instead of searching.
 */
function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/**
 * Both German spellings of a term, so either one finds the other.
 *
 * German corpora carry the same word twice over: prose keeps the umlaut while
 * filenames, slugs and ASCII-only tools force `ae`/`oe`/`ue`/`ss`. FTS5's
 * default `unicode61` tokenizer strips diacritics but does NOT transliterate,
 * so it files "Prüfung" under `prufung` and "Pruefung" under `pruefung` — two
 * unrelated terms. Measured on the real corpus: one word, three disjoint
 * result sets (Grösse 10, Größe 6, Groesse 2).
 *
 * The transliteration is applied in BOTH directions and every produced form is
 * OR'd in. The `ue → ü` direction is genuinely ambiguous ("Steuerung" yields
 * the non-word "Steürung"), and that is exactly why OR is the right connector:
 * a spelling that does not occur matches nothing, costs nothing, and cannot
 * displace a real hit. Requiring the terms instead would turn every wrong
 * guess into an empty result.
 *
 * The alternative — folding the stored text into the index — ranks better in
 * theory, because IDF would then be computed over folded terms. It also means
 * a schema migration, an FTS rebuild over every row, and new triggers on a
 * live database. If the ranking ever proves to matter, that is the upgrade
 * path; it is not needed to make both spellings findable.
 */
export function spellingVariants(term: string): string[] {
  const out = new Set<string>([term]);

  const toAscii = term
    .replace(/ä/g, 'ae').replace(/Ä/g, 'Ae')
    .replace(/ö/g, 'oe').replace(/Ö/g, 'Oe')
    .replace(/ü/g, 'ue').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss');
  out.add(toAscii);

  const toUmlaut = term
    .replace(/ae/g, 'ä').replace(/Ae/g, 'Ä')
    .replace(/oe/g, 'ö').replace(/Oe/g, 'Ö')
    .replace(/ue/g, 'ü').replace(/Ue/g, 'Ü')
    .replace(/ss/g, 'ß');
  out.add(toUmlaut);

  return [...out];
}

/**
 * Words to match on, in query order, stopwords dropped.
 *
 * THE HYPHEN IS PART OF A TOKEN, and this must stay in step with the
 * `tokenize="unicode61 tokenchars '-'"` on `observations_fts`. The two halves
 * are one decision: with the index changed and this left splitting on hyphens,
 * every identifier query returned NOTHING — measured 0% where it had been 100%
 * at rank 10, with no error anywhere. Keeping `V-0169` whole took a bare
 * identifier from 29% to 100% at rank 1.
 */
export function queryTerms(raw: string): string[] {
  const tokens = (raw.match(/[\p{L}\p{N}-]+/gu) ?? [])
    // A lone dash or a trailing one is punctuation, not a term.
    .map(token => token.replace(/^-+|-+$/g, ''))
    .filter(token => token.length > 0);
  const kept = tokens.filter(t => !STOPWORDS.has(fold(t)));
  // A query made entirely of stopwords ("was ist das?") still has to search
  // for something. Dropping every term would return the whole table.
  return kept.length > 0 ? kept : tokens;
}

/**
 * Identifiers named in a query: `V-0076`, or a bare four-digit record number.
 *
 * WHY THIS IS WORTH DETECTING. An embedding model cannot place an identifier
 * in a meaning space — there is no meaning in `V-0076` to embed. Measured over
 * the identifier question sets, the semantic channel answers 7% of them at
 * rank 10, which is indistinguishable from guessing, while the keyword channel
 * answers 100%. Fusing a perfect channel with a blind one at the default
 * weights loses: the fused path scores 64% where keyword alone scores 100%.
 *
 * The bare-number form only counts when it IS the whole query. A four-digit
 * number inside a sentence is as likely to be a year or a version as a record,
 * and treating "was 2026 entschieden?" as an identifier lookup would suppress
 * the semantic channel on an ordinary question.
 */
export function identifierTerms(raw: string): string[] {
  const out = new Set<string>();

  for (const match of raw.matchAll(/\bV-\d{3,}\b/gi)) out.add(match[0].toUpperCase());

  const trimmed = raw.trim();
  if (/^\d{4}$/.test(trimmed)) out.add(trimmed);

  return [...out];
}

/**
 * Build the MATCH expression, or null when there is nothing to search for.
 *
 * Null rather than an empty string: an empty MATCH is a syntax error, and the
 * caller has to decide whether "no usable terms" means an empty result or a
 * filter-only search.
 */
export function buildFtsMatchExpression(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A search that returns nothing because the query held no searchable word is
  // indistinguishable from one that found nothing — unless it says so here.
  const unsearchable = (): null => {
    logger.debug('DB', 'Query held no searchable term', { length: trimmed.length });
    return null;
  };

  // The user quoted something: honour it as a phrase, verbatim.
  const quoted = trimmed.match(/"([^"]+)"/g);
  if (quoted) {
    const phrases = quoted.map(q => quote(q.slice(1, -1).trim())).filter(p => p !== '""');
    if (phrases.length > 0) return phrases.join(' AND ');
  }

  const terms = queryTerms(trimmed);
  if (terms.length === 0) return unsearchable();

  const expanded = new Set<string>();
  for (const term of terms) {
    for (const variant of spellingVariants(term)) expanded.add(quote(variant));
  }
  return [...expanded].join(' OR ');
}
