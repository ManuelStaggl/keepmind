// SPDX-License-Identifier: Apache-2.0
//
// A search result has to say whether the entry it returns still applies.
//
// Measured against the running worker on the live corpus: a search returned
// `0137 — Ein Gedächtnis, und die Rollenteilung war eine Fehlannahme` and, one
// row below it, `0064 — Zwei Gedächtnisse mit geteilten Rollen` — the record
// 0137 had explicitly superseded. Same list, same spelling, nothing saying
// 0064 no longer applies. That is the stale-fact failure `supersession.ts`
// exists to prevent: it decides which of two records about one subject holds,
// from a declared relation and a date, and search never used the decision.

import { describe, it, expect } from 'bun:test';
import {
  curatedHitOf, curatedGroupLabel, curatedValidityOf, observationGroupLabel,
} from '../../src/services/curated/search-label.js';
import { SUPERSESSION_MARKER } from '../../src/services/curated/supersession.js';
import { REVISION_MARKER } from '../../src/services/curated/record-key.js';
import { CHECKPOINT_TYPE } from '../../src/shared/checkpoint.js';

const curated = (metadata: Record<string, unknown>, validTo: number | null = null) => ({
  source_kind: 'curated',
  metadata: JSON.stringify(metadata),
  valid_to: validTo,
});

describe('a search hit says whether the entry still applies', () => {
  it('says nothing extra about an entry that is in force', () => {
    const hit = curatedHitOf(curated({ record_id: '0137' }))!;
    expect(hit.validity).toBe('current');
    expect(curatedGroupLabel(hit)).toBe('Lasting entries · akte (decisions)');
  });

  it('marks a record another record superseded', () => {
    const hit = curatedHitOf(curated({ record_id: '0064', [SUPERSESSION_MARKER]: '0137' }, 1_700_000_000_000))!;
    expect(hit.validity).toBe('retired');
    const label = curatedGroupLabel(hit);
    expect(label).toContain('akte (decisions)');
    expect(label).toContain('RETIRED');
    expect(label).toContain('no longer in force');
  });

  it('tells an earlier wording apart from a retirement', () => {
    // Different statements to a reader: the entry still applies, this text is
    // simply not what it says now. Calling it retired would send them looking
    // for a successor that does not exist.
    const hit = curatedHitOf(curated({ record_id: '0064', [REVISION_MARKER]: 4711 }, 1_700_000_000_000))!;
    expect(hit.validity).toBe('revised');
    expect(curatedGroupLabel(hit)).toContain('EARLIER WORDING');
    expect(curatedGroupLabel(hit)).not.toContain('RETIRED');
  });

  it('calls a closed row retired when nothing says why', () => {
    // The conservative side: the reader's next move on "earlier wording" is to
    // look for a current wording, and there may be none.
    expect(curatedValidityOf(curated({ record_id: '0064' }, 1_700_000_000_000))).toBe('retired');
    expect(curatedValidityOf({ source_kind: 'curated', metadata: null, valid_to: 1 })).toBe('retired');
    expect(curatedValidityOf({ source_kind: 'curated', metadata: '{not json', valid_to: 1 })).toBe('retired');
  });

  it('treats a row with no validity column as current rather than closed', () => {
    // Every caller that predates the column passes rows without it, and
    // guessing "closed" there would mark the entire corpus retired.
    expect(curatedValidityOf({ source_kind: 'curated', metadata: '{}' })).toBe('current');
  });

  it('marks a retired work item and a retired checkpoint too, keeping what they are', () => {
    const vorgang = curatedHitOf(curated({ vorgang_id: 'V-0195', kind: 'vorgang', [SUPERSESSION_MARKER]: '0137' }, 1))!;
    expect(vorgang.kind).toBe('vorgang');
    expect(curatedGroupLabel(vorgang)).toContain('open work items');
    expect(curatedGroupLabel(vorgang)).toContain('RETIRED');

    const checkpoint = curatedHitOf({
      type: CHECKPOINT_TYPE, source_kind: 'curated',
      metadata: JSON.stringify({ checkpoint: true, [REVISION_MARKER]: 9 }), valid_to: 2,
    })!;
    expect(checkpoint.kind).toBe('checkpoint');
    expect(curatedGroupLabel(checkpoint)).toContain('session hand-off');
  });

  it('marks it the same way in search and in timeline', () => {
    // Both views take the heading from this one function, so a hit marked in
    // step 1 of the three-layer sequence cannot arrive unmarked in step 2.
    const row = curated({ record_id: '0064', [SUPERSESSION_MARKER]: '0137' }, 1);
    expect(observationGroupLabel(row)).toBe(curatedGroupLabel(curatedHitOf(row)!));
    expect(observationGroupLabel(row)).toContain('RETIRED');
  });

  it('says nothing about an observed row, closed or not', () => {
    expect(curatedHitOf({ source_kind: 'observed', metadata: null, valid_to: 1 })).toBeNull();
    expect(observationGroupLabel({ source_kind: null, metadata: null, valid_to: 1 })).toBeNull();
  });
});
