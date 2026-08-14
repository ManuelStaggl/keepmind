
export interface ContextInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  source?: "startup" | "resume" | "clear" | "compact";
  projects?: string[];
  platformSource?: string;
  full?: boolean;
  [key: string]: any;
}

export interface ContextConfig {
  totalObservationCount: number;
  fullObservationCount: number;
  sessionCount: number;

  showReadTokens: boolean;
  showWorkTokens: boolean;
  showSavingsAmount: boolean;
  showSavingsPercent: boolean;

  observationTypes: Set<string>;
  observationConcepts: Set<string>;

  fullObservationField: 'narrative' | 'facts';
  showLastSummary: boolean;
  showLastMessage: boolean;

  /**
   * Which source kind may be injected.
   *
   *   'all'      — both (default, and what every install did before this)
   *   'curated'  — only records imported verbatim from files the user owns
   *   'observed' — only what the observer produced
   *
   * This is the whole of the origin filter: once curated content is its own
   * source kind, separating the two is a WHERE clause. The expensive version
   * of this idea — asking, per observation, whether a curated equivalent
   * exists — needs a similarity comparison at injection time, which is
   * precisely the fuzzy matching the decision graph exists to avoid.
   */
  injectSourceKind: 'all' | 'curated' | 'observed';
}

export interface Observation {
  id: number;
  memory_session_id: string;
  platform_source?: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  discovery_tokens: number | null;
  created_at: string;
  created_at_epoch: number;
  project?: string;
  importance?: number | null;
}

export interface SessionSummary {
  id: number;
  memory_session_id: string;
  platform_source?: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  created_at: string;
  created_at_epoch: number;
  project?: string;
}

export interface SummaryTimelineItem extends SessionSummary {
  displayEpoch: number;
  displayTime: string;
  shouldShowLink: boolean;
}

export type TimelineItem =
  | { type: 'observation'; data: Observation }
  | { type: 'summary'; data: SummaryTimelineItem };

export interface TokenEconomics {
  totalObservations: number;
  totalReadTokens: number;
  totalDiscoveryTokens: number;
  savings: number;
  savingsPercent: number;
}

export interface PriorMessages {
  assistantMessage: string;
}

export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
};

export const CHARS_PER_TOKEN_ESTIMATE = 4;
export const SUMMARY_LOOKAHEAD = 1;
