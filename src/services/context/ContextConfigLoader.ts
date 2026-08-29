
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { paths } from '../../shared/paths.js';
import { ModeManager } from '../domain/ModeManager.js';
import type { ContextConfig } from './types.js';
import { normalizeSourceKind } from '../sqlite/source-kind.js';
import { UNKNOWN_OBSERVATION_TYPE } from '../../sdk/observation-type.js';

export function loadContextConfig(): ContextConfig {
  const settingsPath = paths.settings();
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);

  const mode = ModeManager.getInstance().getActiveMode();
  // S10: `unknown` is not a choice offered to the model, but a row that carries
  // it is still a real observation — filtering the injection to the mode's
  // vocabulary alone would make the honest fallback cost more than the
  // dishonest one it replaced.
  const observationTypes = new Set([
    ...mode.observation_types.map(t => t.id),
    UNKNOWN_OBSERVATION_TYPE,
  ]);
  const observationConcepts = new Set(mode.observation_concepts.map(c => c.id));

  return {
    totalObservationCount: parseInt(settings.KEEPMIND_CONTEXT_OBSERVATIONS, 10),
    fullObservationCount: parseInt(settings.KEEPMIND_CONTEXT_FULL_COUNT, 10),
    sessionCount: parseInt(settings.KEEPMIND_CONTEXT_SESSION_COUNT, 10),
    showReadTokens: settings.KEEPMIND_CONTEXT_SHOW_READ_TOKENS === 'true',
    showWorkTokens: settings.KEEPMIND_CONTEXT_SHOW_WORK_TOKENS === 'true',
    showSavingsAmount: settings.KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT === 'true',
    showSavingsPercent: settings.KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT === 'true',
    observationTypes,
    observationConcepts,
    fullObservationField: settings.KEEPMIND_CONTEXT_FULL_FIELD as 'narrative' | 'facts',
    showLastSummary: settings.KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY === 'true',
    showLastMessage: settings.KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE === 'true',
    injectSourceKind: normalizeSourceKind(settings.KEEPMIND_INJECT_SOURCE_KIND),
  };
}

