/**
 * Compatibility shim for the pre-rename `CLAUDE_MEM_*` configuration prefix.
 *
 * keepmind's canonical prefix is `KEEPMIND_`, for both environment variables and
 * the keys inside `~/.keepmind/settings.json`. Installs that predate the rename
 * still carry `CLAUDE_MEM_*` names in their shell profiles and settings files,
 * and silently ignoring those would reset a configured install to defaults —
 * a wrong worker port or a re-enabled vector store, with nothing in the log to
 * explain it.
 *
 * So every read accepts both spellings, canonical first. Settings files are
 * rewritten to canonical keys once (see SettingsDefaultsManager.loadFromFile);
 * environment variables are never rewritten, since the shell profile that sets
 * them is the user's file to edit.
 *
 * Deliberately dependency-free: this is imported from `paths.ts`, which runs
 * before the logger and the settings layer exist.
 */

export const ENV_PREFIX = 'KEEPMIND_';
export const LEGACY_ENV_PREFIX = 'CLAUDE_MEM_';

/**
 * The pre-rename spelling of a canonical key, or null if the key does not carry
 * the keepmind prefix at all (`CLAUDE_CODE_PATH`, for instance, is a Claude Code
 * setting that keepmind reads but does not own, and must not be rewritten).
 */
export function legacyKeyFor(key: string): string | null {
  if (!key.startsWith(ENV_PREFIX)) return null;
  return LEGACY_ENV_PREFIX + key.slice(ENV_PREFIX.length);
}

/** Read a canonical key from an environment-like record, falling back to the legacy spelling. */
export function envValue(
  key: string,
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const direct = env[key];
  if (direct !== undefined) return direct;
  const legacy = legacyKeyFor(key);
  return legacy ? env[legacy] : undefined;
}

/** Same lookup against a plain settings object (values may be non-strings from a hand-edited JSON file). */
export function settingValue<T = unknown>(
  key: string,
  settings: Record<string, T | undefined>
): T | undefined {
  const direct = settings[key];
  if (direct !== undefined) return direct;
  const legacy = legacyKeyFor(key);
  return legacy ? settings[legacy] : undefined;
}

/** True when a settings object still carries at least one pre-rename key — the trigger for a one-time rewrite. */
export function hasLegacyKeys(settings: Record<string, unknown>): boolean {
  return Object.keys(settings).some((k) => k.startsWith(LEGACY_ENV_PREFIX));
}
