// S10 — an unknown observation type must not be silently relabelled.
//
// Measured 28./29.08.2026: `Invalid observation type: pattern, using "bugfix"`
// three times and the same for `gotcha` once. The observations survived and
// were findable in full text; only the classification was false — which is the
// worse half, because `search(type=…)` then answers with the wrong drawer and
// every count over `type` is wrong by exactly the rows nobody can identify.
//
// Both causes were ours:
//   - `pattern` and `gotcha` are CONCEPTS in this mode, so the model put a
//     value in the neighbouring slot, and the prompt forbade that mix-up in one
//     direction only;
//   - `type_guidance` said "EXACTLY one of these 6 options" while
//     `observation_types` held eight. `security_alert` — the one type wired to
//     an external consequence (the Telegram notifier) — was never shown to the
//     observer at all.

import { describe, it, expect } from '../bun-test-shim.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  resolveObservationType,
  UNKNOWN_OBSERVATION_TYPE,
} from '../../src/sdk/observation-type.js';

const TYPES = ['bugfix', 'feature', 'refactor', 'change', 'discovery', 'decision'];
const CONCEPTS = ['how-it-works', 'gotcha', 'pattern', 'trade-off'];

describe('S10 — observation type resolution', () => {
  it('accepts a valid type unchanged', () => {
    expect(resolveObservationType('decision', TYPES, CONCEPTS)).toEqual({ type: 'decision' });
    expect(resolveObservationType('  bugfix  ', TYPES, CONCEPTS)).toEqual({ type: 'bugfix' });
  });

  it('never substitutes the first entry of the list', () => {
    const resolved = resolveObservationType('pattern', TYPES, CONCEPTS);
    expect(resolved.type).toBe(UNKNOWN_OBSERVATION_TYPE);
    expect(resolved.type).not.toBe('bugfix');
  });

  it('names a concept in the type slot as exactly that', () => {
    expect(resolveObservationType('pattern', TYPES, CONCEPTS).reason).toBe('concept_in_type_slot');
    expect(resolveObservationType('gotcha', TYPES, CONCEPTS).reason).toBe('concept_in_type_slot');
  });

  it('keeps the offered value so the diagnosis is not lost', () => {
    expect(resolveObservationType('gotcha', TYPES, CONCEPTS).offered).toBe('gotcha');
    expect(resolveObservationType('nonsense', TYPES, CONCEPTS).offered).toBe('nonsense');
  });

  it('distinguishes a genuinely invented value from a misplaced concept', () => {
    expect(resolveObservationType('nonsense', TYPES, CONCEPTS).reason).toBe('unrecognised');
  });

  it('treats a missing or blank type as missing, not as invented', () => {
    expect(resolveObservationType(null, TYPES, CONCEPTS).reason).toBe('missing');
    expect(resolveObservationType('   ', TYPES, CONCEPTS).reason).toBe('missing');
    expect(resolveObservationType(undefined, TYPES, CONCEPTS).type).toBe(UNKNOWN_OBSERVATION_TYPE);
  });

  it('`unknown` is not itself offered to the model', () => {
    expect(TYPES).not.toContain(UNKNOWN_OBSERVATION_TYPE);
  });
});

// The prompt is the other half of the fix: a model cannot pick a type it was
// never shown, and it cannot avoid a mix-up it was never warned about.
describe('S10 — the code mode prompt matches its own schema', () => {
  const mode = JSON.parse(
    readFileSync(join(process.cwd(), 'plugin', 'modes', 'code.json'), 'utf-8'),
  ) as {
    observation_types: Array<{ id: string }>;
    observation_concepts: Array<{ id: string }>;
    prompts: { type_guidance: string; concept_guidance: string };
  };

  it('lists every type the schema accepts', () => {
    for (const t of mode.observation_types) {
      expect(mode.prompts.type_guidance).toContain(t.id);
    }
  });

  it('states the right count', () => {
    expect(mode.prompts.type_guidance).toContain(`these ${mode.observation_types.length} options`);
  });

  it('reaches the security types at all — they carry an external consequence', () => {
    expect(mode.observation_types.map(t => t.id)).toContain('security_alert');
    expect(mode.prompts.type_guidance).toContain('security_alert');
  });

  it('forbids the concept/type mix-up in BOTH directions', () => {
    expect(mode.prompts.type_guidance).toContain('concept keyword is NOT a type');
    expect(mode.prompts.concept_guidance).toContain('Do NOT include the observation type');
  });

  it('no concept id is also a type id — the two vocabularies stay disjoint', () => {
    const types = new Set(mode.observation_types.map(t => t.id));
    for (const c of mode.observation_concepts) {
      expect(types.has(c.id)).toBe(false);
    }
  });
});
