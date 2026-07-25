
import type {
  ContextConfig,
  Observation,
  SessionSummary,
  TokenEconomics,
  PriorMessages,
} from '../types.js';
import { ModeManager } from '../../domain/ModeManager.js';
import { formatObservationTokenDisplay } from '../TokenCalculator.js';

function formatHeaderDateTime(): string {
  const now = new Date();
  const date = now.toLocaleDateString('en-CA'); 
  const time = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).toLowerCase().replace(' ', '');
  const tz = now.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop();
  return `${date} ${time} ${tz}`;
}

export function renderAgentHeader(project: string): string[] {
  return [
    `# [${project}] recent context, ${formatHeaderDateTime()}`,
    ''
  ];
}

export function renderAgentLegend(): string[] {
  const mode = ModeManager.getInstance().getActiveMode();
  const typeLegendItems = mode.observation_types.map(t => `${t.emoji}${t.id}`).join(' ');

  return [
    `Legend: 🎯session ${typeLegendItems}`,
    `Format: ID TIME TYPE TITLE`,
    `Fetch details: get_observations([IDs]) | Search: mem-search skill`,
    ''
  ];
}

export function renderAgentContextEconomics(
  economics: TokenEconomics,
  config: ContextConfig
): string[] {
  const output: string[] = [];

  // "Nt read" used to print totalReadTokens — the size of the FULL stored records
  // of every listed observation. But this block lists headlines only, so the
  // number overstated the injection cost by ~4x (measured: "3,997t read" on a
  // ~900-token block) and was read as a budget figure by both humans and models.
  // Label it for what it is: how much stored detail those headlines index.
  const parts: string[] = [
    `${economics.totalObservations} obs (${economics.totalReadTokens.toLocaleString('en-US')}t indexed)`,
    `${economics.totalDiscoveryTokens.toLocaleString('en-US')}t work`
  ];

  if (economics.totalDiscoveryTokens > 0 && (config.showSavingsAmount || config.showSavingsPercent)) {
    if (config.showSavingsPercent) {
      parts.push(`${economics.savingsPercent}% savings`);
    } else if (config.showSavingsAmount) {
      parts.push(`${economics.savings.toLocaleString('en-US')}t saved`);
    }
  }

  output.push(`Stats: ${parts.join(' | ')}`);
  output.push('');

  return output;
}

/**
 * Human-scale age of a calendar day ("today", "yesterday", "12 days ago").
 * Returns null when the day cannot be parsed.
 *
 * Absolute dates alone make stale memory read as current: a block headed
 * "Jul 18, 2026" looks equally authoritative whether that was yesterday or six
 * weeks ago. The age is what tells a reader (and the model) how much to trust
 * the entry, so it belongs in the header rather than being left to arithmetic.
 */
export function relativeDayLabel(day: string, now: Date = new Date()): string | null {
  const parsed = new Date(day);
  if (Number.isNaN(parsed.getTime())) return null;

  const startOfDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOfDay(now) - startOfDay(parsed)) / 86_400_000);

  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 60) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `~${months} months ago`;
}

export function renderAgentDayHeader(day: string): string[] {
  const age = relativeDayLabel(day);
  return [
    age ? `### ${day} (${age})` : `### ${day}`,
  ];
}

function compactTime(time: string): string {
  return time.toLowerCase().replace(' am', 'a').replace(' pm', 'p');
}

export function renderAgentTableRow(
  obs: Observation,
  timeDisplay: string,
  _config: ContextConfig
): string {
  const title = obs.title || 'Untitled';
  const icon = ModeManager.getInstance().getTypeIcon(obs.type);
  const time = timeDisplay ? compactTime(timeDisplay) : '"';

  return `${obs.id} ${time} ${icon} ${title}`;
}

export function renderAgentFullObservation(
  obs: Observation,
  timeDisplay: string,
  detailField: string | null,
  config: ContextConfig
): string[] {
  const output: string[] = [];
  const title = obs.title || 'Untitled';
  const icon = ModeManager.getInstance().getTypeIcon(obs.type);
  const time = timeDisplay ? compactTime(timeDisplay) : '"';
  const { readTokens, discoveryDisplay } = formatObservationTokenDisplay(obs, config);

  output.push(`**${obs.id}** ${time} ${icon} **${title}**`);
  if (detailField) {
    output.push(detailField);
  }

  const tokenParts: string[] = [];
  if (config.showReadTokens) {
    tokenParts.push(`~${readTokens}t`);
  }
  if (config.showWorkTokens) {
    tokenParts.push(discoveryDisplay);
  }
  if (tokenParts.length > 0) {
    output.push(tokenParts.join(' '));
  }
  output.push('');

  return output;
}

export function renderAgentSummaryItem(
  summary: { id: number; request: string | null },
  formattedTime: string
): string[] {
  return [
    `S${summary.id} ${summary.request || 'Session started'} (${formattedTime})`,
  ];
}

// Cap the per-field length of the newest summary's Investigated/Learned/
// Completed/Next block injected at SessionStart. Untruncated it can add ~500+
// tokens with diminishing returns — the head carries the gist and full detail
// is one get_observations away (perf plan T4).
const SUMMARY_FIELD_MAX_CHARS = 200;

export function renderAgentSummaryField(label: string, value: string | null): string[] {
  if (!value) return [];
  const trimmed = value.length > SUMMARY_FIELD_MAX_CHARS
    ? `${value.slice(0, SUMMARY_FIELD_MAX_CHARS).trimEnd()}…`
    : value;
  return [`**${label}**: ${trimmed}`, ''];
}

export function renderAgentPreviouslySection(priorMessages: PriorMessages): string[] {
  if (!priorMessages.assistantMessage) return [];

  return [
    '',
    '---',
    '',
    `**Previously**`,
    '',
    `A: ${priorMessages.assistantMessage}`,
    ''
  ];
}

export function renderAgentFooter(totalDiscoveryTokens: number, totalReadTokens: number): string[] {
  const workTokensK = Math.round(totalDiscoveryTokens / 1000);
  return [
    '',
    `Access ${workTokensK}k tokens of past work via get_observations([IDs]) or mem-search skill.`
  ];
}

export function renderAgentEmptyState(project: string): string {
  return `# [${project}] recent context, ${formatHeaderDateTime()}\n\nNo previous sessions found.`;
}
