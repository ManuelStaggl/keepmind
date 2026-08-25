// SPDX-License-Identifier: Apache-2.0
//
// The record of what the curated import last did — the one place that can
// answer "is what keepmind holds still what the files say?".
//
// WHY THIS EXISTS. The import used to leave no trace beyond its own stdout.
// That is enough to see a failure while you are watching, and nothing at all
// afterwards: the last outage went unnoticed for four days because a failed
// run and a run that never happened look exactly the same from the outside —
// both are silence. A durable stamp turns both into an answerable question.
//
// It records the ATTEMPT as well as the success. A state file that only ever
// held successes would make a repeatedly failing import indistinguishable from
// one nobody triggered, which is the distinction the health signal rests on.
//
// The source fingerprint is (file count, newest mtime) per directory, not a
// content hash. Hashing a corpus of several hundred files on every session
// start costs more than it can ever save here: mtime already moves on every
// edit, and the failure mode of a false "stale" is one extra import, while the
// failure mode of a false "fresh" is a memory that quietly stopped tracking
// its sources.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import type { CuratedKind, CuratedSource } from './sources.js';

export const IMPORT_STATE_FILE = 'curated-import-state.json';

/** Bumped when a field changes meaning; older records are ignored, never mixed. */
export const IMPORT_STATE_VERSION = 1;

export interface CuratedSourceStamp {
  path: string;
  kind: CuratedKind;
  /** Files seen below `path`. A deletion moves this even when no mtime does. */
  files: number;
  /** Newest mtime below `path`, including the directory itself. 0 when absent. */
  newestMtimeEpoch: number;
  /** False when the directory was not there at stamping time. */
  present: boolean;
}

export interface CuratedImportState {
  project: string;
  /** Every run, successful or not. */
  lastAttemptEpoch: number;
  /** Last run that both imported and indexed without a failure. */
  lastSuccessEpoch: number | null;
  /** Counts as of the last success. */
  records: number;
  edges: number;
  /** Whether the last run left the rows it wrote actually searchable. */
  indexed: boolean;
  /** Why the last run was not a success, verbatim. Null after a success. */
  failure: string | null;
  /** The sources as they stood at the last SUCCESS — what freshness compares against. */
  sources: CuratedSourceStamp[];
}

interface StateFile {
  version: number;
  projects: Record<string, CuratedImportState>;
}

function statePath(dataDir: string): string {
  return join(dataDir, IMPORT_STATE_FILE);
}

function readFile(dataDir: string): StateFile {
  const path = statePath(dataDir);
  if (!existsSync(path)) return { version: IMPORT_STATE_VERSION, projects: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StateFile;
    // A file from an older schema is dropped rather than merged: a field that
    // changed meaning is worse than a field that is missing, because the first
    // one is believed.
    if (parsed?.version !== IMPORT_STATE_VERSION) return { version: IMPORT_STATE_VERSION, projects: {} };
    return { version: IMPORT_STATE_VERSION, projects: parsed.projects ?? {} };
  } catch (error) {
    logger.warn('DB', 'Curated import state unreadable — treating as absent', { path },
      error instanceof Error ? error : undefined);
    return { version: IMPORT_STATE_VERSION, projects: {} };
  }
}

/** The recorded state for one project, or null when it has never been imported. */
export function readImportState(project: string, dataDir: string = DATA_DIR): CuratedImportState | null {
  return readFile(dataDir).projects[project] ?? null;
}

/** Every project the state file knows about. */
export function readAllImportStates(dataDir: string = DATA_DIR): CuratedImportState[] {
  return Object.values(readFile(dataDir).projects);
}

/**
 * Write one project's state, leaving the others alone.
 *
 * Written through a temp file and a rename: a session start, a file watcher and
 * a hand-run import can all reach this at once, and a half-written state file
 * reads as "never imported", which would trigger a full re-import on every
 * session until someone noticed.
 */
export function writeImportState(state: CuratedImportState, dataDir: string = DATA_DIR): void {
  const file = readFile(dataDir);
  file.projects[state.project] = state;
  mkdirSync(dataDir, { recursive: true });
  const dest = statePath(dataDir);
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
    renameSync(tmp, dest);
  } catch (error) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* the temp file is not worth a second failure */ }
    // Never fatal: the import itself succeeded, and losing the stamp costs a
    // redundant re-import, not data.
    logger.warn('DB', 'Could not write curated import state', { dest },
      error instanceof Error ? error : undefined);
  }
}

/** Newest mtime and file count below `dir`, counting the directory's own mtime. */
function walk(dir: string): { files: number; newest: number } {
  let files = 0;
  let newest = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
      // A rename inside a directory moves the DIRECTORY's mtime and nothing
      // else, so a corpus where a file was only renamed still reads as changed.
      newest = Math.max(newest, statSync(current).mtimeMs);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (!entry.isFile()) continue;
      files += 1;
      try { newest = Math.max(newest, statSync(full).mtimeMs); } catch { /* vanished mid-walk */ }
    }
  }
  return { files, newest };
}

/** Fingerprint the configured sources as they are right now. */
export function stampSources(sources: CuratedSource[]): CuratedSourceStamp[] {
  return sources.map(source => {
    let present = false;
    try { present = statSync(source.path).isDirectory(); } catch { present = false; }
    if (!present) return { path: source.path, kind: source.kind, files: 0, newestMtimeEpoch: 0, present: false };
    const { files, newest } = walk(source.path);
    return { path: source.path, kind: source.kind, files, newestMtimeEpoch: Math.round(newest), present: true };
  });
}

export interface StalenessVerdict {
  stale: boolean;
  /** Plain-language reason, always set when `stale` — this is what the operator reads. */
  reason: string | null;
}

/**
 * Is the store behind the files?
 *
 * Deliberately generous about what counts as stale. Every branch here answers
 * the same question — "could a source say something the store does not?" — and
 * when that cannot be ruled out, the answer is yes. Re-importing costs a few
 * seconds; not re-importing costs correctness.
 */
export function importIsStale(
  state: CuratedImportState | null,
  current: CuratedSourceStamp[]
): StalenessVerdict {
  if (!state || state.lastSuccessEpoch === null) {
    return { stale: true, reason: 'never imported successfully' };
  }
  if (!state.indexed) {
    return { stale: true, reason: 'the last import was not indexed — its records are not searchable' };
  }

  const previous = new Map(state.sources.map(source => [source.path, source]));
  for (const stamp of current) {
    const before = previous.get(stamp.path);
    if (!before) return { stale: true, reason: `a source was added: ${stamp.path}` };
    if (!stamp.present) return { stale: true, reason: `a source is missing: ${stamp.path}` };
    if (stamp.files !== before.files) {
      return { stale: true, reason: `${stamp.path} holds ${stamp.files} file(s), ${before.files} at the last import` };
    }
    if (stamp.newestMtimeEpoch > before.newestMtimeEpoch) {
      return { stale: true, reason: `${stamp.path} was changed after the last import` };
    }
  }
  for (const before of state.sources) {
    if (!current.some(stamp => stamp.path === before.path)) {
      return { stale: true, reason: `a source was removed from the configuration: ${before.path}` };
    }
  }
  return { stale: false, reason: null };
}
