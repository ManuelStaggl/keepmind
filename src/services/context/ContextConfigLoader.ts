
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { paths } from '../../shared/paths.js';
import { ModeManager } from '../domain/ModeManager.js';
import type { ContextConfig } from './types.js';

export function loadContextConfig(): ContextConfig {
  const settingsPath = paths.settings();
  const settings = SettingsDefaultsManager.loadFromFile(settingsPath);

  const mode = ModeManager.getInstance().getActiveMode();
  const observationTypes = new Set(mode.observation_types.map(t => t.id));
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

/**
 * Unknown values fall back to 'all'.
 *
 * A typo here would otherwise empty the injection block completely, and an
 * empty block looks exactly like "there was nothing to say" — the failure mode
 * is silence, which is the one this project keeps paying for.
 */
function normalizeSourceKind(raw: string | undefined): 'all' | 'curated' | 'observed' {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'curated' || value === 'observed' ? value : 'all';
}
