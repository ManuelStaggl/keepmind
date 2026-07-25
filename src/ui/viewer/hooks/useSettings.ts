import { useState, useEffect } from 'react';
import { Settings } from '../types';
import { DEFAULT_SETTINGS } from '../constants/settings';
import { API_ENDPOINTS } from '../constants/api';
import { TIMING } from '../constants/timing';
import { authFetch } from '../utils/api';

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    authFetch(API_ENDPOINTS.SETTINGS)
      .then(async res => {
        if (!res.ok) {
          throw new Error(`Failed to load settings (${res.status})`);
        }
        return res.json();
      })
      .then(data => {
        setSettings({
          KEEPMIND_MODEL: data.KEEPMIND_MODEL ?? DEFAULT_SETTINGS.KEEPMIND_MODEL,
          KEEPMIND_CONTEXT_OBSERVATIONS: data.KEEPMIND_CONTEXT_OBSERVATIONS ?? DEFAULT_SETTINGS.KEEPMIND_CONTEXT_OBSERVATIONS,
          KEEPMIND_WORKER_PORT: data.KEEPMIND_WORKER_PORT ?? DEFAULT_SETTINGS.KEEPMIND_WORKER_PORT,
          KEEPMIND_WORKER_HOST: data.KEEPMIND_WORKER_HOST ?? DEFAULT_SETTINGS.KEEPMIND_WORKER_HOST,

          KEEPMIND_PROVIDER: data.KEEPMIND_PROVIDER ?? DEFAULT_SETTINGS.KEEPMIND_PROVIDER,
          KEEPMIND_GEMINI_API_KEY: data.KEEPMIND_GEMINI_API_KEY ?? DEFAULT_SETTINGS.KEEPMIND_GEMINI_API_KEY,
          KEEPMIND_GEMINI_MODEL: data.KEEPMIND_GEMINI_MODEL ?? DEFAULT_SETTINGS.KEEPMIND_GEMINI_MODEL,
          KEEPMIND_GEMINI_RATE_LIMITING_ENABLED: data.KEEPMIND_GEMINI_RATE_LIMITING_ENABLED ?? DEFAULT_SETTINGS.KEEPMIND_GEMINI_RATE_LIMITING_ENABLED,

          KEEPMIND_OPENROUTER_API_KEY: data.KEEPMIND_OPENROUTER_API_KEY ?? DEFAULT_SETTINGS.KEEPMIND_OPENROUTER_API_KEY,
          KEEPMIND_OPENROUTER_MODEL: data.KEEPMIND_OPENROUTER_MODEL ?? DEFAULT_SETTINGS.KEEPMIND_OPENROUTER_MODEL,
          KEEPMIND_OPENROUTER_SITE_URL: data.KEEPMIND_OPENROUTER_SITE_URL ?? DEFAULT_SETTINGS.KEEPMIND_OPENROUTER_SITE_URL,
          KEEPMIND_OPENROUTER_APP_NAME: data.KEEPMIND_OPENROUTER_APP_NAME ?? DEFAULT_SETTINGS.KEEPMIND_OPENROUTER_APP_NAME,

          KEEPMIND_CONTEXT_SHOW_READ_TOKENS: data.KEEPMIND_CONTEXT_SHOW_READ_TOKENS ?? DEFAULT_SETTINGS.KEEPMIND_CONTEXT_SHOW_READ_TOKENS,
          KEEPMIND_CONTEXT_SHOW_WORK_TOKENS: data.KEEPMIND_CONTEXT_SHOW_WORK_TOKENS ?? DEFAULT_SETTINGS.KEEPMIND_CONTEXT_SHOW_WORK_TOKENS,
          KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT: data.KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT ?? DEFAULT_SETTINGS.KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT,
          KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT: data.KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT ?? DEFAULT_SETTINGS.KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT,

          KEEPMIND_CONTEXT_FULL_COUNT: data.KEEPMIND_CONTEXT_FULL_COUNT ?? DEFAULT_SETTINGS.KEEPMIND_CONTEXT_FULL_COUNT,
          KEEPMIND_CONTEXT_FULL_FIELD: data.KEEPMIND_CONTEXT_FULL_FIELD ?? DEFAULT_SETTINGS.KEEPMIND_CONTEXT_FULL_FIELD,
          KEEPMIND_CONTEXT_SESSION_COUNT: data.KEEPMIND_CONTEXT_SESSION_COUNT ?? DEFAULT_SETTINGS.KEEPMIND_CONTEXT_SESSION_COUNT,

          KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY: data.KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY ?? DEFAULT_SETTINGS.KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY,
          KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE: data.KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE ?? DEFAULT_SETTINGS.KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE,
        });
      })
      .catch(error => {
        console.error('Failed to load settings:', error);
      });
  }, []);

  const saveSettings = async (newSettings: Settings) => {
    setIsSaving(true);
    setSaveStatus('Saving...');

    try {
      const response = await authFetch(API_ENDPOINTS.SETTINGS, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });

      if (!response.ok) {
        setSaveStatus(`✗ Error: ${response.status === 401 ? 'Unauthorized' : response.statusText}`);
        setIsSaving(false);
        return;
      }

      const result = await response.json();

      if (result.success) {
        setSettings(newSettings);
        setSaveStatus('✓ Saved');
        setTimeout(() => setSaveStatus(''), TIMING.SAVE_STATUS_DISPLAY_DURATION_MS);
      } else {
        setSaveStatus(`✗ Error: ${result.error}`);
      }
    } catch (error) {
      setSaveStatus(`✗ Error: ${error instanceof Error ? error.message : 'Network error'}`);
    }

    setIsSaving(false);
  };

  return { settings, saveSettings, isSaving, saveStatus };
}
