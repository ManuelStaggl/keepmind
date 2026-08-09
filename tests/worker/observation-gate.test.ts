import { describe, it, expect } from 'bun:test';
import { shouldCompressBatch, readCaptureProfile } from '../../src/services/worker/observation-gate.js';

const read = (path: string, output = 'x'.repeat(500)) => ({
  tool_name: 'Read', tool_input: { file_path: path }, tool_response: output,
});
const edit = (path: string) => ({
  tool_name: 'Edit', tool_input: { file_path: path }, tool_response: 'ok',
});
const bash = (command: string, output = 'ok') => ({
  tool_name: 'Bash', tool_input: { command }, tool_response: output,
});

/**
 * ACCEPTANCE TEST 5 — an idle stretch costs a fraction of a full run.
 *
 * "A fraction" means ZERO model calls here: the decision is made from the hook
 * payload before any prompt is built. Previously the observer was asked to judge
 * this, and answered "nothing worth recording" on at least 65% of turns while
 * paying the full conversation prefix for each.
 */
describe('observation gate (acceptance test 5)', () => {
  it('skips a batch with no signal at all, in every profile', () => {
    const batch = [{ tool_name: 'Read', tool_input: { file_path: 'a.ts' }, tool_response: 'ok' }];
    for (const profile of ['full', 'balanced', 'governance'] as const) {
      expect(shouldCompressBatch(batch, { profile }).compress).toBe(false);
    }
  });

  it('skips pure navigation and status checks', () => {
    expect(shouldCompressBatch([bash('git status')], { profile: 'balanced' }).compress).toBe(false);
    expect(shouldCompressBatch([read('README.md')], { profile: 'balanced' }).compress).toBe(false);
  });

  it('reports WHY it skipped, so the ratio stays auditable', () => {
    expect(shouldCompressBatch([read('a.ts')], { profile: 'balanced' }).reason).toBe('read_only');
    expect(shouldCompressBatch([], { profile: 'balanced' }).reason).toBe('empty_batch');
  });

  it('balanced records any change or failure', () => {
    expect(shouldCompressBatch([edit('src/a.ts')], { profile: 'balanced' }).compress).toBe(true);
    expect(shouldCompressBatch([bash('npm test', 'FAILED: 3 tests failed')], { profile: 'balanced' }).compress).toBe(true);
  });

  it('governance keeps decisions, migrations and releases', () => {
    expect(shouldCompressBatch([bash('git commit -m "feat: x"')], { profile: 'governance' }).compress).toBe(true);
    expect(shouldCompressBatch([bash('prisma migrate deploy')], { profile: 'governance' }).compress).toBe(true);
    expect(shouldCompressBatch([edit('CLAUDE.md')], { profile: 'governance' }).compress).toBe(true);
    expect(shouldCompressBatch([edit('.github/workflows/ci.yml')], { profile: 'governance' }).compress).toBe(true);
  });

  it('governance drops an ordinary source edit that decides nothing', () => {
    const decision = shouldCompressBatch([edit('src/utils/format.ts')], { profile: 'governance' });
    expect(decision.compress).toBe(false);
    expect(decision.reason).toBe('not_portfolio_relevant');
  });

  it('governance keeps an ordinary edit when the REQUEST is a decision', () => {
    const decision = shouldCompressBatch([edit('src/utils/format.ts')], {
      profile: 'governance',
      userPrompt: 'decide whether we standardise on the new date library across all tools',
    });
    expect(decision.compress).toBe(true);
    expect(decision.reason).toBe('governance_request');
  });

  it('recognises a decision request in German too', () => {
    // An English-only matcher would classify every German request as
    // "not portfolio relevant" and silently drop the decisions this profile
    // exists to keep.
    for (const prompt of [
      'entscheide, ob wir auf die neue Bibliothek umstellen',
      'begründe die Architekturentscheidung im Changelog',
      'die Migration der Datenbank abschließen',
      'das ist ein wiederkehrendes Problem, bitte dauerhaft lösen',
      'Sicherheitsbefund beheben',
    ]) {
      const decision = shouldCompressBatch([edit('src/utils/format.ts')], {
        profile: 'governance',
        userPrompt: prompt,
      });
      expect(decision.compress).toBe(true);
    }
  });

  it('still ignores an ordinary German request', () => {
    const decision = shouldCompressBatch([edit('src/utils/format.ts')], {
      profile: 'governance',
      userPrompt: 'formatiere die Datei neu und sortiere die Importe',
    });
    expect(decision.compress).toBe(false);
  });

  it('honours an explicit profile from the environment', () => {
    const previous = process.env.KEEPMIND_CAPTURE_PROFILE;
    try {
      process.env.KEEPMIND_CAPTURE_PROFILE = 'full';
      expect(readCaptureProfile()).toBe('full');
      process.env.KEEPMIND_CAPTURE_PROFILE = 'balanced';
      expect(readCaptureProfile()).toBe('balanced');
      // An unrecognised value must not silently mean "record everything".
      process.env.KEEPMIND_CAPTURE_PROFILE = 'nonsense';
      expect(['governance', 'balanced']).toContain(readCaptureProfile());
    } finally {
      if (previous === undefined) delete process.env.KEEPMIND_CAPTURE_PROFILE;
      else process.env.KEEPMIND_CAPTURE_PROFILE = previous;
    }
  });

  it('is cheap: no model call is implied by a skip', () => {
    // 100 idle batches produce 100 decisions and zero prompts. The assertion is
    // structural — shouldCompressBatch is pure and takes no provider.
    const idle = Array.from({ length: 100 }, (_, i) => [read(`file${i}.ts`, 'ok')]);
    const compressed = idle.filter(b => shouldCompressBatch(b, { profile: 'governance' }).compress);
    expect(compressed.length).toBe(0);
  });
});
