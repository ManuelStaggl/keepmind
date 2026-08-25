// SPDX-License-Identifier: Apache-2.0
//
// "Is the curated corpus still current?" — one answer, computed once, read by
// everything that needs to say something about it.
//
// WHY ONE PLACE. The same question is asked at a session start, by
// `keepmind doctor`, and by whatever comes next. Three implementations of a
// health check drift, and a health check that drifts is worse than none: the
// two that stay quiet get believed. Same argument as the cost balance — written
// in one place, read in one place.
//
// It answers from the STATE FILE plus the sources as they are right now, and
// optionally a count of what the store holds. It does not open the database
// itself — a session start pays this on every launch — so a caller that already
// has one supplies the counts; without them the verdict says "cannot tell"
// rather than guessing.

import { importIsStale, readAllImportStates, stampSources, type CuratedImportState } from './import-state.js';
import { loadCuratedProject, loadCuratedSources, missingSources, sourcesByProject, type CuratedSource } from './sources.js';
import { DATA_DIR } from '../../shared/paths.js';

/**
 * What this machine's relationship to a corpus is.
 *
 * keepmind is developed on one machine and used on another, and the corpus does
 * not necessarily follow. Everything downstream — whether the doctor fails,
 * whether a session start says anything at all — hangs on this and not on the
 * import state, because an import state only ever describes the last RUN.
 *
 *   'present'  — the sources are readable here. The strict rules apply: an
 *                import that stopped running is the four-day outage this whole
 *                path exists to catch.
 *   'detached' — the store holds records but their sources are not reachable
 *                from here. Nothing can refresh them; nothing is broken
 *                either. The records stay searchable and stay true as of the
 *                last import, and that is exactly what has to be said.
 *   'absent'   — sources are configured, none are reachable, and this machine
 *                holds no records for the project. It is configured for a
 *                corpus it does not have. Silence is the correct output: a
 *                machine that never touches the corpus must not be told about
 *                it at every session start.
 *   'unknown'  — sources are missing and the store could not be counted. The
 *                strict reading applies, because the outage cannot be ruled
 *                out.
 */
export type CuratedPresence = 'present' | 'detached' | 'absent' | 'unknown';

export interface CuratedHealth {
  project: string;
  /** When the last fully successful import finished, or null if there was none. */
  lastSuccessEpoch: number | null;
  lastAttemptEpoch: number;
  records: number;
  edges: number;
  /** Whether the corpus is in the semantic index. */
  indexed: boolean;
  /** Why the last run was not a success. */
  failure: string | null;
  /** True when a source has moved since the last success. */
  stale: boolean;
  staleReason: string | null;
  /** Nothing to report: imported, indexed, and in step with the files. */
  ok: boolean;
  /** Configured source directories for this project. */
  sources: CuratedSource[];
  /** Those of them that are not reachable from this machine. */
  absentSources: CuratedSource[];
  /** Curated rows this machine holds for the project; null when uncounted. */
  storedRecords: number | null;
  /** What this machine's relationship to the corpus is. */
  presence: CuratedPresence;
}

export interface CuratedHealthOptions {
  /**
   * Curated row counts by project — see `stored-records.ts`.
   *
   * Injected rather than read here so this stays a stamp-and-stat question,
   * and so a test can describe a machine without building one.
   */
  storedRecords?: Map<string, number> | null;
}

/**
 * The state of every curated project this machine knows about.
 *
 * A project appears here when it has ever been imported OR when sources are
 * configured for it — the second case is what makes "configured but never
 * imported" visible instead of silent.
 */
export function curatedHealth(
  dataDir: string = DATA_DIR,
  options: CuratedHealthOptions = {},
): CuratedHealth[] {
  const states = new Map<string, CuratedImportState>();
  for (const state of readAllImportStates(dataDir)) states.set(state.project, state);

  const configured = loadCuratedSources(dataDir);
  const byProject = new Map<string, CuratedSource[]>();
  if (configured.sources.length > 0) {
    // A source may name its own project; the rest are attributed below.
    const named = configured.sources.filter(source => source.project);
    for (const [project, list] of sourcesByProject(named, '(unattributed)')) {
      if (project !== '(unattributed)') byProject.set(project, list);
    }
    const unattributed = configured.sources.filter(source => !source.project);
    if (unattributed.length > 0) {
      // The declared answer first — the same setting the unattended import
      // obeys — then whatever has actually been imported. Without this a
      // machine that is correctly configured but has never run an import
      // reported its corpus under a placeholder name.
      const declared = loadCuratedProject(dataDir);
      const targets = declared ? [declared] : states.size > 0 ? [...states.keys()] : [];
      for (const project of targets) {
        byProject.set(project, [...(byProject.get(project) ?? []), ...unattributed]);
      }
      if (targets.length === 0) byProject.set('(no project configured)', unattributed);
    }
  }

  const projects = new Set<string>([...states.keys(), ...byProject.keys()]);
  const out: CuratedHealth[] = [];

  for (const project of projects) {
    const state = states.get(project) ?? null;
    const sources = byProject.get(project) ?? [];
    const verdict = sources.length > 0
      ? importIsStale(state, stampSources(sources))
      // No configured source for this project: nothing can have moved behind
      // its back, so the last import still stands for what it covered.
      : { stale: state === null || state.lastSuccessEpoch === null, reason: state ? null : 'never imported' };

    const absentSources = missingSources(sources);
    const storedRecords = options.storedRecords ? options.storedRecords.get(project) ?? 0 : null;
    const presence = resolvePresence(sources, absentSources, storedRecords);

    out.push({
      project,
      lastSuccessEpoch: state?.lastSuccessEpoch ?? null,
      lastAttemptEpoch: state?.lastAttemptEpoch ?? 0,
      records: state?.records ?? 0,
      edges: state?.edges ?? 0,
      indexed: state?.indexed ?? false,
      failure: state?.failure ?? null,
      stale: verdict.stale,
      staleReason: verdict.reason,
      ok: state !== null && state.lastSuccessEpoch !== null && state.indexed && !state.failure && !verdict.stale,
      sources,
      absentSources,
      storedRecords,
      presence,
    });
  }

  return out.sort((a, b) => a.project.localeCompare(b.project));
}

/**
 * Which of the three machines this is, for one project.
 *
 * Note that a corpus counts as reachable as soon as EVERY configured source is
 * — a partially reachable set is treated as present and therefore strictly,
 * because the import refuses to run on it and the records the missing directory
 * holds really would go stale without anyone noticing. That is the outage case,
 * not the portability case.
 */
function resolvePresence(
  sources: CuratedSource[],
  absentSources: CuratedSource[],
  storedRecords: number | null,
): CuratedPresence {
  if (sources.length === 0 || absentSources.length === 0) return 'present';
  // Some reachable, some not: this machine plainly HAS the corpus, and one of
  // its directories has gone. The import refuses to run on a partial set, so
  // the records that directory holds go stale with nobody told — the outage,
  // not the portability question.
  if (absentSources.length < sources.length) return 'present';
  if (storedRecords === null) return 'unknown';
  return storedRecords > 0 ? 'detached' : 'absent';
}

/** `2026-08-25 · 3 days ago`, or `never` — the same phrasing everywhere. */
export function describeLastSuccess(health: CuratedHealth, now: number = Date.now()): string {
  if (health.lastSuccessEpoch === null) return 'never';
  const day = new Date(health.lastSuccessEpoch).toISOString().slice(0, 10);
  const days = Math.floor((now - health.lastSuccessEpoch) / 86_400_000);
  if (days <= 0) return `${day} · today`;
  if (days === 1) return `${day} · yesterday`;
  return `${day} · ${days} days ago`;
}

/**
 * One line per project, in the words a reader needs.
 *
 * Deliberately unpleasant to skim past when something is wrong: the last outage
 * survived four days because the only evidence was an absence.
 */
export function describeCuratedHealth(health: CuratedHealth, now: number = Date.now()): string {
  const when = describeLastSuccess(health, now);
  if (health.ok) {
    return `last imported ${when} · ${health.records} record(s), ${health.edges} relation(s) · index in sync`;
  }

  // A machine that holds the records but not the files is not a machine with a
  // broken import, and describing it as one is how a warning stops being read.
  // Everything the strict wording would say here — "never imported", "not
  // indexed" — is a statement about a run that could not start on THIS machine,
  // and says nothing about records that arrived on another one.
  if (health.presence === 'detached') {
    const held = health.storedRecords ?? 0;
    return `${held} record(s) held here, searchable · sources not reachable from this machine `
      + `(${health.absentSources.map(source => source.path).join(', ')}) — nothing refreshes them here`;
  }
  if (health.presence === 'absent') {
    return 'configured for a corpus this machine does not have';
  }

  const problems = new Set<string>();
  if (health.lastSuccessEpoch === null) problems.add('never imported successfully');
  if (health.failure) problems.add(health.failure);
  // What the stamp knows is what the last RUN did, which is a different claim
  // from what the index contains. It was phrased as the second — "NOT in the
  // semantic index — semantic search cannot see these records" — and stated
  // that about 333 records the index held in full, because a run that aborted
  // before it reached the indexing step had left the flag false. A genuinely
  // incomplete index still reports itself, through `failure`, in the words
  // `ensureObservationsIndexed` used: "N of M curated row(s) have no vector".
  if (!health.indexed) problems.add('the last import did not get as far as verifying the semantic index');
  // The stale reason often restates one of the above; a reader who is told the
  // same thing three times stops reading the line at all.
  if (health.stale && health.staleReason) problems.add(health.staleReason);
  return `last imported ${when} — ${[...problems].join('; ')}`;
}
