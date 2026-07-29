
import { readFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { HOOK_TIMEOUTS, getTimeout } from './hook-constants.js';
// Atomic, BOM-free, lock-guarded JSON writer (writeSync-loop + fsync + atomic
// rename). Used for settings.json so concurrent hook processes can't truncate
// it to a partial/empty file.
import { writeJsonFileAtomic } from '../npx-cli/utils/paths.js';
import { envValue, settingValue, hasLegacyKeys } from './legacy-env.js';

export interface SettingsDefaults {
  KEEPMIND_MODEL: string;
  KEEPMIND_CONTEXT_OBSERVATIONS: string;
  KEEPMIND_WORKER_PORT: string;
  KEEPMIND_WORKER_HOST: string;
  KEEPMIND_API_TIMEOUT_MS: string;
  KEEPMIND_SKIP_TOOLS: string;
  KEEPMIND_PROVIDER: string;  
  KEEPMIND_CLAUDE_AUTH_METHOD: string;  
  KEEPMIND_GEMINI_API_KEY: string;
  KEEPMIND_GEMINI_MODEL: string;  
  KEEPMIND_GEMINI_RATE_LIMITING_ENABLED: string;  
  KEEPMIND_GEMINI_MAX_CONTEXT_MESSAGES: string;  
  KEEPMIND_GEMINI_MAX_TOKENS: string;  
  KEEPMIND_OPENROUTER_API_KEY: string;
  KEEPMIND_OPENROUTER_MODEL: string;
  KEEPMIND_OPENROUTER_BASE_URL: string;
  KEEPMIND_OPENROUTER_SITE_URL: string;
  KEEPMIND_OPENROUTER_APP_NAME: string;
  KEEPMIND_OPENROUTER_MAX_CONTEXT_MESSAGES: string;
  KEEPMIND_OPENROUTER_MAX_TOKENS: string;
  KEEPMIND_DATA_DIR: string;
  KEEPMIND_LOG_LEVEL: string;
  CLAUDE_CODE_PATH: string;
  KEEPMIND_MODE: string;
  KEEPMIND_CONTEXT_SHOW_READ_TOKENS: string;
  KEEPMIND_CONTEXT_SHOW_WORK_TOKENS: string;
  KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT: string;
  KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT: string;
  KEEPMIND_CONTEXT_FULL_COUNT: string;
  KEEPMIND_CONTEXT_FULL_FIELD: string;
  KEEPMIND_CONTEXT_SESSION_COUNT: string;
  /** Max observations coalesced into ONE compression turn (perf plan L1). Default '3': batching only engages UNDER BACKLOG (a trickle of tool-uses still compresses one-at-a-time), so it cuts turn count / LLM cost exactly when a burst piles up while leaving light sessions unchanged. '1' restores strict one-turn-per-tool-use; clamped to [1,12]. */
  KEEPMIND_OBSERVATION_BATCH_MAX: string;
  KEEPMIND_OBSERVATION_COALESCE_MS: string;
  /** Max compression turns in ONE resumed Claude SDK conversation before a fresh session is forced (perf plan L3). Bounds the resume/context-window growth (quadratic cost + eventual "prompt is too long"). '0' = unbounded (legacy behavior). */
  KEEPMIND_MAX_CONTEXT_MESSAGES: string;
  KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY: string;
  KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE: string;
  KEEPMIND_CONTEXT_SHOW_TERMINAL_OUTPUT: string;
  KEEPMIND_WELCOME_HINT_ENABLED: string;
  /** Proactive in-session notice when a newer keepmind is published to npm. 'true' (default) shows a one-line SessionStart hint; 'false' disables both the notice and the background npm check. */
  KEEPMIND_UPDATE_CHECK_ENABLED: string;
  KEEPMIND_FOLDER_CLAUDEMD_ENABLED: string;
  KEEPMIND_FOLDER_USE_LOCAL_MD: string;  
  KEEPMIND_TRANSCRIPTS_ENABLED: string;  
  KEEPMIND_TRANSCRIPTS_CONFIG_PATH: string;  
  KEEPMIND_CODEX_TRANSCRIPT_INGESTION: string;
  KEEPMIND_MAX_CONCURRENT_AGENTS: string;  
  KEEPMIND_HOOK_FAIL_LOUD_THRESHOLD: string;  
  KEEPMIND_EXCLUDED_PROJECTS: string;  
  KEEPMIND_FOLDER_MD_EXCLUDE: string;
  KEEPMIND_FOLDER_MD_SKELETON_DENYLIST: string;
  KEEPMIND_SEMANTIC_INJECT: string;        
  KEEPMIND_SEMANTIC_INJECT_LIMIT: string;  
  KEEPMIND_TIER_ROUTING_ENABLED: string;
  KEEPMIND_TIER_SIMPLE_MODEL: string;
  KEEPMIND_TIER_SUMMARY_MODEL: string;
  KEEPMIND_TIER_FAST_MODEL: string;        // #2289 — resolved by $TIER:fast in KEEPMIND_MODEL
  KEEPMIND_TIER_SMART_MODEL: string;       // #2289 — resolved by $TIER:smart in KEEPMIND_MODEL
  KEEPMIND_CHROMA_ENABLED: string;   // Feature toggle: 'false' = SQLite/BM25-only search (no in-process vector store)
  KEEPMIND_TELEGRAM_ENABLED: string;
  KEEPMIND_TELEGRAM_BOT_TOKEN: string;
  KEEPMIND_TELEGRAM_CHAT_ID: string;
  KEEPMIND_TELEGRAM_TRIGGER_TYPES: string;
  KEEPMIND_TELEGRAM_TRIGGER_CONCEPTS: string;
  KEEPMIND_QUEUE_ENGINE: string;
  KEEPMIND_REDIS_URL: string;
  KEEPMIND_REDIS_HOST: string;
  KEEPMIND_REDIS_PORT: string;
  KEEPMIND_REDIS_MODE: string;
  KEEPMIND_QUEUE_REDIS_PREFIX: string;
  KEEPMIND_AUTH_MODE: string;
  KEEPMIND_RUNTIME: string;
  // Phase 1a (cmem-sdk rename): canonical server settings keys. Hooks read
  // these first and fall back to the legacy `*_BETA_*` keys below.
  KEEPMIND_SERVER_URL: string;
  KEEPMIND_SERVER_API_KEY: string;
  KEEPMIND_SERVER_PROJECT_ID: string;
  // Legacy keys retained for back-compat with existing settings.json files.
  KEEPMIND_SERVER_BETA_URL: string;
  KEEPMIND_SERVER_BETA_API_KEY: string;
  KEEPMIND_SERVER_BETA_PROJECT_ID: string;
}

export class SettingsDefaultsManager {
  private static readonly DEFAULTS: SettingsDefaults = {
    KEEPMIND_MODEL: 'claude-haiku-4-5-20251001',
    KEEPMIND_CONTEXT_OBSERVATIONS: '50',
    KEEPMIND_WORKER_PORT: String(37700 + ((process.getuid?.() ?? 77) % 100)),
    KEEPMIND_WORKER_HOST: '127.0.0.1',
    KEEPMIND_API_TIMEOUT_MS: String(getTimeout(HOOK_TIMEOUTS.API_REQUEST)),
    // Tools whose use carries no recallable content: harness bookkeeping, mode
    // toggles, schema loading, and shell polling. Skipping them at ingest means
    // the event never reaches the compression LLM at all — cheaper than letting
    // the model decide "not worth recording" one paid turn at a time.
    // This list is the SECOND line of defense. On Claude Code the PostToolUse
    // matcher in plugin/hooks/hooks.json now allow-lists tool names, so a skipped
    // tool never even spawns the hook. Hosts whose matcher granularity is coarser
    // (codex-hooks.json, cursor-hooks/hooks.json still match broadly) rely on this
    // list instead — there the hook runs and the skip happens here, at ingest.
    KEEPMIND_SKIP_TOOLS: [
      'ListMcpResourcesTool', 'SlashCommand', 'Skill', 'TodoWrite', 'AskUserQuestion',
      'ToolSearch',                                   // loads tool schemas; no work happened
      'BashOutput', 'KillShell',                      // polling/teardown of a shell already observed
      'EnterPlanMode', 'ExitPlanMode',                // mode toggle; the plan itself is observed elsewhere
      'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet',  // task-list bookkeeping, like TodoWrite
      'Glob', 'Grep',                                 // navigation; the files they lead to are observed via Read/Edit
    ].join(','),
    KEEPMIND_PROVIDER: 'claude',  // Default to Claude
    KEEPMIND_CLAUDE_AUTH_METHOD: 'subscription',  // Default to logged-in Claude SDK auth (not API key)
    KEEPMIND_GEMINI_API_KEY: '',  // Empty by default, can be set via UI or env
    KEEPMIND_GEMINI_MODEL: 'gemini-2.5-flash-lite',  // Default Gemini model (highest free tier RPM)
    KEEPMIND_GEMINI_RATE_LIMITING_ENABLED: 'true',  // Rate limiting ON by default for free tier users
    KEEPMIND_GEMINI_MAX_CONTEXT_MESSAGES: '20',  // Max messages in Gemini context window
    KEEPMIND_GEMINI_MAX_TOKENS: '100000',  // Max estimated tokens (~100k safety limit)
    KEEPMIND_OPENROUTER_API_KEY: '',  // Empty by default, can be set via UI or env
    KEEPMIND_OPENROUTER_MODEL: 'xiaomi/mimo-v2-flash:free',  // Default OpenRouter model (free tier)
    KEEPMIND_OPENROUTER_BASE_URL: '',  // #2382/#2590/#2622/#2393 — optional OpenAI-compatible base URL (e.g. https://api.deepseek.com, http://localhost:1234/v1). Empty = default OpenRouter endpoint.
    KEEPMIND_OPENROUTER_SITE_URL: '',  // Optional: for OpenRouter analytics
    KEEPMIND_OPENROUTER_APP_NAME: 'keepmind',  // App name for OpenRouter analytics
    KEEPMIND_OPENROUTER_MAX_CONTEXT_MESSAGES: '20',  // Max messages in context window
    KEEPMIND_OPENROUTER_MAX_TOKENS: '100000',  // Max estimated tokens (~100k safety limit)
    KEEPMIND_DATA_DIR: join(homedir(), '.keepmind'),
    KEEPMIND_LOG_LEVEL: 'INFO',
    CLAUDE_CODE_PATH: '', // Empty means auto-detect via 'which claude'
    KEEPMIND_MODE: 'code', // Default mode profile
    KEEPMIND_CONTEXT_SHOW_READ_TOKENS: 'false',
    KEEPMIND_CONTEXT_SHOW_WORK_TOKENS: 'false',
    KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT: 'false',
    KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT: 'true',
    KEEPMIND_CONTEXT_FULL_COUNT: '0',
    KEEPMIND_CONTEXT_FULL_FIELD: 'narrative',
    KEEPMIND_CONTEXT_SESSION_COUNT: '5',
    KEEPMIND_OBSERVATION_BATCH_MAX: '8',  // perf plan L1: coalesce up to N observations per compression turn. Raised 3→8 now that the coalesce window below actually fills a batch; ≥65% of turns previously produced nothing while paying the full conversation prefix. Set '1' for strict one-turn-per-tool-use.
    KEEPMIND_OBSERVATION_COALESCE_MS: '2500',  // perf plan L1b: wait up to this long for sibling observations before compressing. 0 = off (batch only what happens to be buffered — L1 then rarely engages). Compression is background work, so the added latency is not user-visible.
    KEEPMIND_MAX_CONTEXT_MESSAGES: '40',  // Claude path: force a fresh SDK session after N compression turns (perf plan L3). 0 = unbounded.
    KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY: 'true',
    KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE: 'false',
    KEEPMIND_CONTEXT_SHOW_TERMINAL_OUTPUT: 'true',
    KEEPMIND_WELCOME_HINT_ENABLED: 'true',
    KEEPMIND_UPDATE_CHECK_ENABLED: 'true',  // proactive in-session "update available" notice (+ background npm check). 'false' disables both.
    KEEPMIND_FOLDER_CLAUDEMD_ENABLED: 'false',
    KEEPMIND_FOLDER_USE_LOCAL_MD: 'false',  // When true, writes to CLAUDE.local.md instead of CLAUDE.md
    KEEPMIND_TRANSCRIPTS_ENABLED: 'true',
    KEEPMIND_TRANSCRIPTS_CONFIG_PATH: join(homedir(), '.keepmind', 'transcript-watch.json'),
    KEEPMIND_CODEX_TRANSCRIPT_INGESTION: 'false',
    KEEPMIND_MAX_CONCURRENT_AGENTS: '2',  // Max concurrent Claude SDK agent subprocesses
    KEEPMIND_HOOK_FAIL_LOUD_THRESHOLD: '3',  // Plan 05 Phase 8 — escalate to exit code 2 after N consecutive worker-unreachable hook invocations
    KEEPMIND_EXCLUDED_PROJECTS: '',  // Comma-separated glob patterns for excluded project paths
    KEEPMIND_FOLDER_MD_EXCLUDE: '[]',  // JSON array of folder paths to exclude from CLAUDE.md generation
    KEEPMIND_FOLDER_MD_SKELETON_DENYLIST: '[]',  // #2400 — JSON array of glob patterns; when a folder matches AND its generated CLAUDE.md would be empty/skeleton, skip injection (avoids polluting non-content dirs with empty skeletons). Default [] preserves existing behavior.
    KEEPMIND_SEMANTIC_INJECT: 'false',             // Inject relevant past observations on every UserPromptSubmit (experimental, disabled by default)
    KEEPMIND_SEMANTIC_INJECT_LIMIT: '5',           // Top-N most relevant observations to inject per prompt
    // OFF by default: the default model is already Haiku and the only tier that
    // overrides it (TIER_SIMPLE_MODEL) is *also* Haiku, while TIER_SUMMARY_MODEL is
    // empty. Routing therefore cannot save anything — it can only swap the model
    // string mid-conversation and invalidate the (model-scoped) prompt cache.
    // Set 'true' only after pointing a tier at a genuinely different model.
    KEEPMIND_TIER_ROUTING_ENABLED: 'false',
    KEEPMIND_TIER_SIMPLE_MODEL: 'haiku', // Portable tier alias — works across Direct API, Bedrock, Vertex, Azure (see #1463)
    KEEPMIND_TIER_SUMMARY_MODEL: '',                // Empty = use default model for summaries
    KEEPMIND_TIER_FAST_MODEL: 'haiku',              // #2289 — $TIER:fast resolves here (portable alias)
    KEEPMIND_TIER_SMART_MODEL: 'sonnet',            // #2289 — $TIER:smart resolves here (portable alias)
    KEEPMIND_CHROMA_ENABLED: 'true',         // Set to 'false' for SQLite/BM25-only search (disables the in-process sqlite-vec vector store)
    KEEPMIND_TELEGRAM_ENABLED: 'true',
    KEEPMIND_TELEGRAM_BOT_TOKEN: '',
    KEEPMIND_TELEGRAM_CHAT_ID: '',
    KEEPMIND_TELEGRAM_TRIGGER_TYPES: 'security_alert',
    KEEPMIND_TELEGRAM_TRIGGER_CONCEPTS: '',
    KEEPMIND_QUEUE_ENGINE: 'sqlite',
    KEEPMIND_REDIS_URL: '',
    KEEPMIND_REDIS_HOST: '127.0.0.1',
    KEEPMIND_REDIS_PORT: '6379',
    KEEPMIND_REDIS_MODE: 'external',
    KEEPMIND_QUEUE_REDIS_PREFIX: `keepmind_${envValue('KEEPMIND_WORKER_PORT') ?? String(37700 + ((process.getuid?.() ?? 77) % 100))}`,
    KEEPMIND_AUTH_MODE: 'api-key',
    KEEPMIND_RUNTIME: 'worker',
    // Phase 1a (cmem-sdk rename): canonical server settings keys. Hooks read
    // these first; the legacy `*_BETA_*` defaults below remain so existing
    // settings.json files still resolve correctly.
    KEEPMIND_SERVER_URL: `http://127.0.0.1:${envValue('KEEPMIND_SERVER_PORT') ?? String(37877 + ((process.getuid?.() ?? 77) % 100))}`,  // Default server runtime URL — UID-derived for multi-account isolation
    KEEPMIND_SERVER_API_KEY: '',                          // Local hook API key, populated by installer when runtime=server
    KEEPMIND_SERVER_PROJECT_ID: '',                       // Default Postgres project_id used by hooks when runtime=server
    KEEPMIND_SERVER_BETA_URL: `http://127.0.0.1:${envValue('KEEPMIND_SERVER_PORT') ?? String(37877 + ((process.getuid?.() ?? 77) % 100))}`,  // Legacy server-beta runtime URL — UID-derived for multi-account isolation
    KEEPMIND_SERVER_BETA_API_KEY: '',                     // Legacy local hook API key (read as fallback when KEEPMIND_SERVER_API_KEY unset)
    KEEPMIND_SERVER_BETA_PROJECT_ID: '',                  // Legacy Postgres project_id (read as fallback when KEEPMIND_SERVER_PROJECT_ID unset)
  };

  static getAllDefaults(): SettingsDefaults {
    return { ...this.DEFAULTS };
  }

  // Canonical env prefix is KEEPMIND_*; the pre-rename CLAUDE_MEM_* names are
  // honored as a fallback so shell profiles written before the rename keep
  // working (see legacy-env.ts).
  private static envOverride(key: keyof SettingsDefaults): string | undefined {
    return envValue(key as string);
  }

  static get(key: keyof SettingsDefaults): string {
    return this.envOverride(key) ?? this.DEFAULTS[key];
  }

  static getInt(key: keyof SettingsDefaults): number {
    const value = this.get(key);
    return parseInt(value, 10);
  }

  static getBool(key: keyof SettingsDefaults): boolean {
    const value: unknown = this.get(key);
    return value === 'true' || value === true;
  }

  private static applyEnvOverrides(settings: SettingsDefaults): SettingsDefaults {
    const result = { ...settings };
    for (const key of Object.keys(this.DEFAULTS) as Array<keyof SettingsDefaults>) {
      const override = this.envOverride(key);
      if (override !== undefined) {
        result[key] = override;
      }
    }
    return result;
  }

  /**
   * Rewrites pre-rename CLAUDE_MEM_* keys to KEEPMIND_*, preserving everything
   * else verbatim — a settings file may legitimately hold keys this version
   * does not model (CLAUDE_CODE_PATH, or a key from a newer build), and the
   * migration must not drop them. Where both spellings are present the
   * canonical one wins, so a rewrite can never undo a deliberate new value.
   */
  private static toCanonicalKeys(settings: Record<string, unknown>): Record<string, unknown> {
    const canonical: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings)) {
      if (!key.startsWith('CLAUDE_MEM_')) {
        canonical[key] = value;
        continue;
      }
      const renamed = 'KEEPMIND_' + key.slice('CLAUDE_MEM_'.length);
      if (settings[renamed] === undefined) {
        canonical[renamed] = value;
      }
    }
    return canonical;
  }

  static loadFromFile(settingsPath: string, applyEnvOverrides = true): SettingsDefaults {
    try {
      if (!existsSync(settingsPath)) {
        const defaults = this.getAllDefaults();
        try {
          const dir = dirname(settingsPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeJsonFileAtomic(settingsPath, defaults);
          // stderr, never stdout: this fires on the first boot in a fresh data
          // dir, and CLI commands like `start` promise machine-readable JSON
          // on stdout to the hook framework.
          console.warn('[SETTINGS] Created settings file with defaults:', settingsPath);
        } catch (error: unknown) {
          console.warn('[SETTINGS] Failed to create settings file, using in-memory defaults:', settingsPath, error instanceof Error ? error.message : String(error));
        }
        return applyEnvOverrides ? this.applyEnvOverrides(defaults) : defaults;
      }

      const settingsData = readFileSync(settingsPath, 'utf-8');
      // Strip UTF-8 BOM if present — Windows tools (editors, formatters, CLI
      // hooks) may prepend U+FEFF which Bun's JSON.parse rejects silently,
      // causing a full fallback to defaults and breaking server-beta routing.
      const settings = JSON.parse(settingsData.replace(/^\uFEFF/, ''));

      let flatSettings = settings;
      if (settings.env && typeof settings.env === 'object') {
        flatSettings = settings.env;

        try {
          writeJsonFileAtomic(settingsPath, flatSettings);
          // stderr, never stdout — same JSON-on-stdout contract as above.
          console.warn('[SETTINGS] Migrated settings file from nested to flat schema:', settingsPath);
        } catch (error: unknown) {
          console.warn('[SETTINGS] Failed to auto-migrate settings file:', settingsPath, error instanceof Error ? error.message : String(error));
          // Continue with in-memory migration even if write fails
        }
      }

      const result: SettingsDefaults = { ...this.DEFAULTS };
      for (const key of Object.keys(this.DEFAULTS) as Array<keyof SettingsDefaults>) {
        // Accepts both spellings, canonical first — a file written before the
        // KEEPMIND_* rename must not silently fall back to defaults.
        const value = settingValue<string>(key as string, flatSettings);
        if (value !== undefined) {
          result[key] = value;
        }
      }

      // One-time rewrite to canonical keys. Done after the values are read, and
      // best-effort: a failed write costs nothing because the legacy keys are
      // still honored on the next load.
      if (hasLegacyKeys(flatSettings)) {
        try {
          writeJsonFileAtomic(settingsPath, this.toCanonicalKeys(flatSettings));
          // stderr, never stdout — same JSON-on-stdout contract as above.
          console.warn('[SETTINGS] Migrated settings file to the KEEPMIND_* key prefix:', settingsPath);
        } catch (error: unknown) {
          console.warn('[SETTINGS] Failed to migrate settings keys (legacy names still honored):', settingsPath, error instanceof Error ? error.message : String(error));
        }
      }

      return applyEnvOverrides ? this.applyEnvOverrides(result) : result;
    } catch (error: unknown) {
      console.warn('[SETTINGS] Failed to load settings, using defaults:', settingsPath, error instanceof Error ? error.message : String(error));
      const defaults = this.getAllDefaults();
      // A corrupt/partially-written settings file must not pin the install to
      // in-memory defaults forever. Back it up (never silently truncate user
      // data) and atomically rewrite fresh defaults so the next load succeeds.
      try {
        if (existsSync(settingsPath)) {
          const backupPath = `${settingsPath}.corrupt-${Date.now()}`;
          renameSync(settingsPath, backupPath);
          console.warn('[SETTINGS] Backed up corrupt settings file to:', backupPath);
        }
        writeJsonFileAtomic(settingsPath, defaults);
        console.warn('[SETTINGS] Recovered settings file with defaults:', settingsPath);
      } catch (recoverError: unknown) {
        console.warn('[SETTINGS] Failed to recover corrupt settings file:', settingsPath, recoverError instanceof Error ? recoverError.message : String(recoverError));
      }
      return applyEnvOverrides ? this.applyEnvOverrides(defaults) : defaults;
    }
  }
}
