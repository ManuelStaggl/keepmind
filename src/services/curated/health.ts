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
// It answers from the STATE FILE plus the sources as they are right now. It
// deliberately does not open the database: a session start pays this on every
// launch, and the question "did the last import cover what is on disk" is
// answerable from a stamp and a stat.

import { importIsStale, readAllImportStates, stampSources, type CuratedImportState } from './import-state.js';
import { loadCuratedProject, loadCuratedSources, sourcesByProject, type CuratedSource } from './sources.js';
import { DATA_DIR } from '../../shared/paths.js';

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
}

/**
 * The state of every curated project this machine knows about.
 *
 * A project appears here when it has ever been imported OR when sources are
 * configured for it — the second case is what makes "configured but never
 * imported" visible instead of silent.
 */
export function curatedHealth(dataDir: string = DATA_DIR): CuratedHealth[] {
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
    });
  }

  return out.sort((a, b) => a.project.localeCompare(b.project));
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
  const problems = new Set<string>();
  if (health.lastSuccessEpoch === null) problems.add('never imported successfully');
  if (health.failure) problems.add(health.failure);
  if (!health.indexed) problems.add('NOT in the semantic index — semantic search cannot see these records');
  // The stale reason often restates one of the above; a reader who is told the
  // same thing three times stops reading the line at all.
  if (health.stale && health.staleReason) problems.add(health.staleReason);
  return `last imported ${when} — ${[...problems].join('; ')}`;
}
