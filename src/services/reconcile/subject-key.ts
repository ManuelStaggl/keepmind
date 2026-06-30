// SPDX-License-Identifier: Apache-2.0
//
// Phase 4 / Step 5 — stable "what fact is this about" key for bi-temporal
// supersession. A contradicting fact with the same subject_key closes the old
// validity window instead of deleting. Deterministic + cheap; same normalization
// as the reconciler.

import { createHash } from 'crypto';
import { normalizeText } from './reconciler.js';

/**
 * Derive a stable subject key from an observation. Uses the normalized title
 * (falling back to the first fact / narrative head) — the "subject + predicate"
 * the fact asserts. Returns a short sha1 slice.
 */
export function subjectKey(o: { title?: string | null; facts?: string[] | string | null; narrative?: string | null }): string {
  let basis = o.title ?? '';
  if (!basis) {
    if (Array.isArray(o.facts) && o.facts.length > 0) basis = o.facts[0];
    else if (typeof o.facts === 'string') {
      try {
        const arr = JSON.parse(o.facts);
        if (Array.isArray(arr) && arr.length > 0) basis = String(arr[0]);
      } catch { /* ignore */ }
    }
  }
  if (!basis) basis = (o.narrative ?? '').slice(0, 80);
  const norm = normalizeText(basis);
  return createHash('sha1').update(norm).digest('hex').slice(0, 16);
}
