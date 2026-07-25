export interface Observation {
  id: number;
  memory_session_id: string;
  project: string;
  merged_into_project?: string | null;
  platform_source: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  text: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  prompt_number: number | null;
  created_at: string;
  created_at_epoch: number;
}

export interface Summary {
  id: number;
  session_id: string;
  project: string;
  platform_source: string;
  request?: string;
  investigated?: string;
  learned?: string;
  completed?: string;
  next_steps?: string;
  created_at_epoch: number;
}

export interface UserPrompt {
  id: number;
  content_session_id: string;
  project: string;
  platform_source: string;
  prompt_number: number;
  prompt_text: string;
  created_at_epoch: number;
}

export type FeedItem =
  | (Observation & { itemType: 'observation' })
  | (Summary & { itemType: 'summary' })
  | (UserPrompt & { itemType: 'prompt' });

export interface StreamEvent {
  type: 'initial_load' | 'new_observation' | 'new_summary' | 'new_prompt' | 'processing_status';
  observations?: Observation[];
  summaries?: Summary[];
  prompts?: UserPrompt[];
  projects?: string[];
  observation?: Observation;
  summary?: Summary;
  prompt?: UserPrompt;
  isProcessing?: boolean;
  queueDepth?: number;
}

export interface ProjectCatalog {
  projects: string[];
  sources: string[];
  projectsBySource: Record<string, string[]>;
}

export interface Settings {
  KEEPMIND_MODEL: string;
  KEEPMIND_CONTEXT_OBSERVATIONS: string;
  KEEPMIND_WORKER_PORT: string;
  KEEPMIND_WORKER_HOST: string;

  KEEPMIND_PROVIDER?: string;  
  KEEPMIND_GEMINI_API_KEY?: string;
  KEEPMIND_GEMINI_MODEL?: string;  
  KEEPMIND_GEMINI_RATE_LIMITING_ENABLED?: string;  
  KEEPMIND_OPENROUTER_API_KEY?: string;
  KEEPMIND_OPENROUTER_MODEL?: string;
  KEEPMIND_OPENROUTER_SITE_URL?: string;
  KEEPMIND_OPENROUTER_APP_NAME?: string;

  KEEPMIND_CONTEXT_SHOW_READ_TOKENS?: string;
  KEEPMIND_CONTEXT_SHOW_WORK_TOKENS?: string;
  KEEPMIND_CONTEXT_SHOW_SAVINGS_AMOUNT?: string;
  KEEPMIND_CONTEXT_SHOW_SAVINGS_PERCENT?: string;

  KEEPMIND_CONTEXT_FULL_COUNT?: string;
  KEEPMIND_CONTEXT_FULL_FIELD?: string;
  KEEPMIND_CONTEXT_SESSION_COUNT?: string;

  KEEPMIND_CONTEXT_SHOW_LAST_SUMMARY?: string;
  KEEPMIND_CONTEXT_SHOW_LAST_MESSAGE?: string;
}
