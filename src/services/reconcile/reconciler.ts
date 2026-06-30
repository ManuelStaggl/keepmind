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

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'this', 'that', 'we', 'i',
  'as', 'at', 'by', 'from', 'into', 'over', 'so', 'then', 'than', 'will',
]);

/** lower-case, strip punctuation, collapse whitespace, drop stopwords. */
export function normalizeText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
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
