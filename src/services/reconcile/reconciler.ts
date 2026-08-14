// SPDX-License-Identifier: Apache-2.0
//
// Phase 4 / Step 4 — heuristic-first near-duplicate reconciliation (mem0-style
// ADD / NOOP / UPDATE). Pure, dependency-free text similarity (normalized
// trigram Jaccard + token cosine). No embeddings required; an optional Chroma/
// vector cosine refinement can break ties in the ambiguous band but must never
// block a write and is applied by the caller, not here.
//
// CRITICAL CONSERVATISM: the write path may only ADD / NOOP / soft-supersede.
// Heuristics NEVER delete. Hard delete is gated elsewhere behind flag + low
// importance + age.

export type ReconcileAction = 'ADD' | 'NOOP' | 'UPDATE';

export interface ReconcileCandidate {
  id: number;
  title: string | null;
  narrative: string | null;
  importance?: number | null;
}

export interface ReconcileDecision {
  action: ReconcileAction;
  candidateId?: number;
  score?: number;
}

/**
 * Case- and diacritic-folding applied to BOTH the text and the stopword list,
 * so the two are always compared in the same form.
 *
 * The umlaut transliteration is deliberate, not cosmetic: German corpora
 * routinely carry both spellings of the same word, because filenames, slugs and
 * ASCII-only tools force the `ae`/`oe`/`ue` form while the prose keeps the
 * umlaut. "Größenbudget" and "Groessenbudget" are the same subject and have to
 * fold together, or the reconciler treats a document and its own filename as
 * unrelated.
 */
function fold(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

// English + German function words. German is here for the same reason the
// embedder is multilingual and the observation gate's text matcher is bilingual
// (see CLAUDE.md): observations are written in one language while the work they
// describe is often discussed in another. An English-only list left every German
// function word standing, where it inflated trigram overlap between two
// unrelated German observations.
//
// NEGATIONS ARE DELIBERATELY ABSENT from both halves — no "not", no "no", no
// "nicht", no "kein". Dropping a negation folds "the port is 3000" and "the port
// is not 3000" onto the same string, and that is precisely the pair this module
// exists to keep apart: a near-duplicate score of 1.0 on a contradiction would
// let a correction be swallowed by the thing it corrects. Anything added here
// later must pass the same test — a stopword may remove noise, never meaning.
const STOPWORDS = new Set([
  // English
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'we', 'i',
  'as', 'at', 'by', 'from', 'into', 'over', 'so', 'then', 'than', 'will',
  // German
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem',
  'einer', 'eines', 'und', 'oder', 'aber', 'ist', 'sind', 'war', 'waren',
  'wird', 'werden', 'wurde', 'wurden', 'hat', 'haben', 'hatte', 'hatten',
  'für', 'mit', 'von', 'vom', 'zu', 'zum', 'zur', 'im', 'auf', 'am', 'an',
  'aus', 'bei', 'nach', 'über', 'unter', 'durch', 'gegen', 'ohne', 'um',
  'als', 'wie', 'dass', 'sich', 'es', 'wir', 'man', 'auch', 'noch', 'nur',
  'schon', 'dann', 'wenn', 'weil', 'damit', 'sowie', 'bereits',
].map(fold));

/**
 * Fold to a comparison form: NFC, lower case, umlaut transliteration,
 * punctuation stripped, whitespace collapsed, stopwords dropped.
 *
 * The character class is Unicode-aware (`\p{L}\p{N}`) rather than `[a-z0-9]`.
 * The ASCII-only version did not merely ignore non-ASCII letters, it DELETED
 * them and left the surrounding fragments behind:
 *
 *     "Der Zurückknopf in der Anwendungstitelleiste (größer)"
 *       →  "der zur ckknopf in der anwendungstitelleiste gr er"
 *
 * German compounds shattered at every umlaut, and the debris ("gr", "er")
 * then matched the debris of unrelated words, so similarity scores stayed
 * plausibly in range while measuring nothing. Every non-Latin script failed the
 * same way, only more completely. Verified against a 126-file German corpus.
 */
export function normalizeText(s: string | null | undefined): string {
  if (!s) return '';
  return fold(s)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !STOPWORDS.has(w))
    .join(' ')
    .trim();
}

function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  const t = s.replace(/\s+/g, ' ');
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function jaccardTrigram(a: string, b: string): number {
  const A = trigrams(a);
  const B = trigrams(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function tokenCosine(a: string, b: string): number {
  const av = new Map<string, number>();
  const bv = new Map<string, number>();
  for (const w of a.split(' ')) if (w) av.set(w, (av.get(w) ?? 0) + 1);
  for (const w of b.split(' ')) if (w) bv.set(w, (bv.get(w) ?? 0) + 1);
  if (av.size === 0 || bv.size === 0) return 0;
  let dot = 0;
  for (const [w, n] of av) dot += n * (bv.get(w) ?? 0);
  let na = 0;
  for (const n of av.values()) na += n * n;
  let nb = 0;
  for (const n of bv.values()) nb += n * n;
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Max of normalized trigram-Jaccard and token-cosine of the two texts. */
export function similarity(textA: string | null | undefined, textB: string | null | undefined): number {
  const a = normalizeText(`${textA ?? ''}`);
  const b = normalizeText(`${textB ?? ''}`);
  return Math.max(jaccardTrigram(a, b), tokenCosine(a, b));
}

export interface ReconcileOptions {
  noopThreshold: number; // >= this → NOOP (near-verbatim dup)
  updateBand: number;    // [updateBand, noopThreshold) → UPDATE (only if supersession on)
  supersessionEnabled: boolean;
}

/**
 * Decide ADD / NOOP / UPDATE for a new observation against same-project
 * candidates. Pure: caller supplies the candidate set (top-k recent, compatible
 * type) and applies the action. The combined text is title + narrative.
 */
export function reconcile(
  incoming: { title: string | null; narrative: string | null },
  candidates: ReconcileCandidate[],
  opts: ReconcileOptions
): ReconcileDecision {
  const inText = `${incoming.title ?? ''} ${incoming.narrative ?? ''}`;
  let best: ReconcileDecision = { action: 'ADD' };
  let bestScore = -1;

  for (const c of candidates) {
    const score = similarity(inText, `${c.title ?? ''} ${c.narrative ?? ''}`);
    if (score <= bestScore) continue;
    bestScore = score;
    if (score >= opts.noopThreshold) {
      best = { action: 'NOOP', candidateId: c.id, score };
    } else if (score >= opts.updateBand && opts.supersessionEnabled) {
      best = { action: 'UPDATE', candidateId: c.id, score };
    } else {
      best = { action: 'ADD', score };
    }
  }
  return best;
}
