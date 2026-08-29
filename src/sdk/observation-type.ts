// SPDX-License-Identifier: Apache-2.0
//
// S10 — what happens when the model names a type the schema does not have.
//
// The old answer was `bugfix`: the FIRST entry of the mode's type list, chosen
// for no reason other than being first, logged at ERROR and then stored as if
// the model had said it. Measured 28./29.08.2026 — `pattern` three times,
// `gotcha` once, all four filed as bugfixes. The observations themselves were
// fine and findable in full text; only the classification was false, which is
// the worse half: `search(type=…)` answers with the wrong drawer, and every
// count over `type` is off by exactly the rows nobody can identify.
//
// A substitute that LOOKS like a valid classification is worse than an admitted
// "unknown", because nothing downstream can tell it from a real one.
//
// Two of the three causes turned out to be ours, not the model's:
//
//   1. `pattern` and `gotcha` are not invented words. They are `concepts` in
//      this very mode — the model put a value in the neighbouring slot. The
//      prompt warns against the mix-up in ONE direction only ("Do NOT include
//      the observation type as a concept"); the reverse was unguarded.
//   2. The prompt and the schema had drifted. `type_guidance` said "EXACTLY one
//      of these 6 options" and listed six, while `observation_types` holds
//      eight — `security_alert` and `security_note` were never shown to the
//      observer at all. `security_alert` is the type wired to the Telegram
//      notifier, so the one classification with an external consequence was
//      unreachable by construction.
//
// So the fix is in three places, and this file is the third: the prompt lists
// every type, the guidance forbids the mix-up in both directions, and an
// unrecognised value lands here instead of being quietly renamed.

/**
 * The classification an observation gets when the model did not supply a valid
 * one. Deliberately NOT a member of any mode's `observation_types`: it is not a
 * choice offered to the model, it is a record of the model not having made one.
 */
export const UNKNOWN_OBSERVATION_TYPE = 'unknown';

export interface TypeResolution {
  type: string;
  /** The value the model actually offered, when it was not usable. */
  offered?: string;
  /** Why it was not usable — for the log line, not for storage. */
  reason?: 'missing' | 'concept_in_type_slot' | 'unrecognised';
}

/**
 * Resolve the `<type>` a model emitted against the mode's vocabulary.
 *
 * Never guesses. The one piece of interpretation it does make is naming the
 * concept/type mix-up, because that is a diagnosis about OUR prompt rather than
 * about the observation — and knowing which of the two failures happened is the
 * difference between fixing the prompt and shrugging at the model.
 */
export function resolveObservationType(
  offered: string | null | undefined,
  validTypes: readonly string[],
  validConcepts: readonly string[] = [],
): TypeResolution {
  const trimmed = typeof offered === 'string' ? offered.trim() : '';
  if (!trimmed) {
    return { type: UNKNOWN_OBSERVATION_TYPE, reason: 'missing' };
  }
  if (validTypes.includes(trimmed)) {
    return { type: trimmed };
  }
  return {
    type: UNKNOWN_OBSERVATION_TYPE,
    offered: trimmed,
    reason: validConcepts.includes(trimmed) ? 'concept_in_type_slot' : 'unrecognised',
  };
}
