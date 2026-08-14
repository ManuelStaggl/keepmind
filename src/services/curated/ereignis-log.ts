// SPDX-License-Identifier: Apache-2.0
//
// Reader for the append-only work-item event log (`EREIGNISSE.log`).
//
// THE STATE IS COMPUTED, NEVER STORED. The corpus has no `status` field and
// its guard rejects one; the state of a work item is a function of its events.
// This module is that function. Writing the result back into a file would
// create a second source of truth that drifts — which is the whole reason the
// upstream convention forbids it.
//
// Line form: `JJJJ-MM-TT | art | V-0000 | feld=wert | feld=wert`

/** Event kinds that move an item to a new state. */
const STATE_BY_KIND: Record<string, VorgangState> = {
  eroeffnet: 'offen',
  'wieder-eroeffnet': 'offen',
  wartet: 'wartet',
  geschlossen: 'erledigt',
  verworfen: 'verworfen',
};

/**
 * Kinds that record a fact without moving the item.
 *
 * `ereignis` is here because it exists, not because it should: four lines were
 * hand-entered on 2026-08-13 and it behaves like `vermerk`. It is documented
 * upstream as legacy and must not be written again. A reader that does not
 * know it would either crash on it or, worse, treat it as state-changing and
 * reopen four closed items.
 */
const NEUTRAL_KINDS = new Set(['vermerk', 'ereignis']);

export type VorgangState = 'offen' | 'wartet' | 'erledigt' | 'verworfen' | 'unbekannt';

export interface Ereignis {
  /** ISO date as written, `2026-08-11`. */
  datum: string;
  art: string;
  /** Work item id, `V-0001`. */
  vorgang: string;
  /** Trailing `feld=wert` pairs. */
  felder: Record<string, string>;
  /** 1-based line in the log. */
  line: number;
}

export interface EreignisLog {
  events: Ereignis[];
  /** Lines that are neither blank, comment, nor a well-formed event. */
  malformed: Array<{ line: number; text: string; reason: string }>;
  /** Event kinds the reader does not know. Reported, never guessed. */
  unknownKinds: Array<{ line: number; art: string; vorgang: string }>;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseEreignisLog(content: string): EreignisLog {
  const events: Ereignis[] = [];
  const malformed: EreignisLog['malformed'] = [];
  const unknownKinds: EreignisLog['unknownKinds'] = [];

  const lines = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');

  lines.forEach((raw, index) => {
    const line = index + 1;
    const text = raw.trim();
    if (!text || text.startsWith('#')) return;

    const parts = text.split('|').map(p => p.trim());
    if (parts.length < 3) {
      malformed.push({ line, text, reason: 'fewer than three fields' });
      return;
    }
    if (!DATE_RE.test(parts[0])) {
      malformed.push({ line, text, reason: `leading field is not a date: ${parts[0]}` });
      return;
    }

    const felder: Record<string, string> = {};
    for (const pair of parts.slice(3)) {
      const eq = pair.indexOf('=');
      if (eq > 0) felder[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }

    const art = parts[1];
    const vorgang = parts[2];
    if (!(art in STATE_BY_KIND) && !NEUTRAL_KINDS.has(art)) {
      unknownKinds.push({ line, art, vorgang });
    }

    events.push({ datum: parts[0], art, vorgang, felder, line });
  });

  return { events, malformed, unknownKinds };
}

export interface DerivedState {
  state: VorgangState;
  /** Date of the event that set the current state. */
  since: string | null;
  /** Log line of that event, for citation. */
  line: number | null;
  /** Total events seen for this item, including neutral ones. */
  eventCount: number;
}

/**
 * Derive each work item's current state from its events.
 *
 * THE LAST EVENT WINS BY DATE, NOT BY POSITION IN THE FILE. The log is
 * append-only, so the two orders usually agree — and when they disagree the
 * file order is wrong: an entry appended today about something that happened
 * last week would otherwise decide the state. Upstream got this wrong until
 * 2026-08-14, where it would have reported a closed item as open; the fault
 * never became visible in the delivered log, but the trap is real and cheap
 * to avoid.
 *
 * Position breaks ties within the same date, which is the only thing it can
 * honestly do: two events on one day carry no finer ordering than the order
 * they were written in.
 *
 * An item whose events are all neutral has no derived state and is reported
 * as `unbekannt` rather than assumed open.
 */
export function deriveStates(events: Ereignis[]): Map<string, DerivedState> {
  const byItem = new Map<string, Ereignis[]>();
  for (const event of events) {
    const list = byItem.get(event.vorgang);
    if (list) list.push(event);
    else byItem.set(event.vorgang, [event]);
  }

  const out = new Map<string, DerivedState>();
  for (const [vorgang, list] of byItem) {
    let winner: Ereignis | null = null;
    for (const event of list) {
      if (!(event.art in STATE_BY_KIND)) continue;
      if (
        winner === null ||
        event.datum > winner.datum ||
        (event.datum === winner.datum && event.line > winner.line)
      ) {
        winner = event;
      }
    }

    out.set(vorgang, winner
      ? { state: STATE_BY_KIND[winner.art], since: winner.datum, line: winner.line, eventCount: list.length }
      : { state: 'unbekannt', since: null, line: null, eventCount: list.length });
  }

  return out;
}
