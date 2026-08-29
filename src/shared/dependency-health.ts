export type DependencyStatusKind =
  | 'ok'
  // S12: a present-but-logged-out CLI. Kept apart from 'setup_required'
  // because the two have opposite remediations, and the wrong one sent the
  // reader off to reinstall a binary that was never broken.
  | 'auth_expired'
  | 'setup_required';

export type DependencyName = 'claude_cli' | 'vector_search';

export interface DependencyStatus {
  dependency: DependencyName;
  kind: DependencyStatusKind;
  message: string;
  remediation?: string;
  recordedAtMs: number;
}

export const CLAUDE_CLI_SETUP_RECHECK_COOLDOWN_MS = 30_000;

export const CLAUDE_CLI_SETUP_REMEDIATION =
  'Install or update Claude Code CLI, then restart keepmind. Try `claude update`, ' +
  '`npm install -g @anthropic-ai/claude-code@latest`, or set CLAUDE_CODE_PATH in ~/.keepmind/settings.json.';

export const CLAUDE_CLI_AUTH_REMEDIATION =
  'Claude Code is installed but not logged in. Run `claude auth login` (or re-login via Claude Desktop); ' +
  'keepmind resumes capturing on its own afterwards.';

const statuses = new Map<DependencyName, DependencyStatus>();

export interface DependencyHealthSnapshot {
  degraded: boolean;
  statuses: DependencyStatus[];
}

export function recordDependencyStatus(
  dependency: DependencyName,
  kind: Exclude<DependencyStatusKind, 'ok'>,
  message: string,
  remediation?: string,
): DependencyStatus {
  const status: DependencyStatus = {
    dependency,
    kind,
    message,
    ...(remediation ? { remediation } : {}),
    recordedAtMs: Date.now(),
  };
  statuses.set(dependency, status);
  return status;
}

export const VECTOR_SEARCH_SETUP_REMEDIATION =
  'Run `npx keepmind install` to restore the native vector dependencies. ' +
  'Bun is required for that install — install it first if it is missing (winget install Oven-sh.Bun).';

export function recordClaudeCliSetupRequired(message: string): DependencyStatus {
  return recordDependencyStatus('claude_cli', 'setup_required', message, CLAUDE_CLI_SETUP_REMEDIATION);
}

export function recordClaudeCliAuthExpired(message: string): DependencyStatus {
  return recordDependencyStatus('claude_cli', 'auth_expired', message, CLAUDE_CLI_AUTH_REMEDIATION);
}

export function recordVectorSearchSetupRequired(message: string): DependencyStatus {
  return recordDependencyStatus('vector_search', 'setup_required', message, VECTOR_SEARCH_SETUP_REMEDIATION);
}

export function clearDependencyStatus(dependency: DependencyName): void {
  statuses.delete(dependency);
}

export function getDependencyStatus(dependency: DependencyName): DependencyStatus | null {
  return statuses.get(dependency) ?? null;
}

export function isDependencyBlocked(
  dependency: DependencyName,
  kind?: Exclude<DependencyStatusKind, 'ok'>,
): boolean {
  const status = getDependencyStatus(dependency);
  if (!status) return false;
  return kind ? status.kind === kind : status.kind !== 'ok';
}

export function isDependencyStatusInCooldown(
  status: DependencyStatus,
  cooldownMs: number,
  nowMs: number = Date.now(),
): boolean {
  return nowMs - status.recordedAtMs < cooldownMs;
}

export function snapshotDependencyHealth(): DependencyHealthSnapshot {
  const currentStatuses = Array.from(statuses.values())
    .map(status => ({ ...status }))
    .sort((a, b) => a.dependency.localeCompare(b.dependency));
  return {
    degraded: currentStatuses.some(status => status.kind !== 'ok'),
    statuses: currentStatuses,
  };
}

export function resetDependencyStatusesForTesting(): void {
  statuses.clear();
}
