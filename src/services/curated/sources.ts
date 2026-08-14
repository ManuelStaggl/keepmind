// SPDX-License-Identifier: Apache-2.0
//
// The curated source set — one list, in one place, and that place is the truth.
//
// WHY THIS EXISTS. The boundary of the curated corpus used to live nowhere
// machine-readable: partly in `.ignore` files, partly in the exception lists of
// four separate scripts, partly in whatever directories someone typed after
// `akten:import`. Four copies of a rule is four rules, and they had already
// drifted. A source set that is passed by hand also cannot be re-run
// identically, which is the one thing an idempotent importer needs.
//
// The kind is DECLARED, never sniffed. A directory of work items and a
// directory of decision records both hold markdown with a frontmatter-ish
// block, and guessing between them by content would be right most of the time
// — which is the failure mode this whole path exists to avoid. Getting it
// wrong stores work items as decisions, and then "what did we decide" answers
// with open tasks.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { DATA_DIR } from '../../shared/paths.js';
import { join } from 'node:path';
import { logger } from '../../utils/logger.js';

/**
 * What a directory holds.
 *
 * `akten` also covers control files: the record importer already reads a file
 * without a record number for its declared relations and stores no row for it,
 * which is exactly the right treatment for `LEGALISIERUNG.md` and its kin.
 * They are not decisions, and they demonstrably carry edges nothing else does.
 */
export type CuratedKind = 'akten' | 'vorgaenge';

export interface CuratedSource {
  path: string;
  kind: CuratedKind;
}

export interface CuratedSourceSet {
  sources: CuratedSource[];
  /** Where the list was read from, for the operator to check. */
  origin: string;
  /** Entries that were rejected, with the reason. Never silently dropped. */
  rejected: Array<{ entry: unknown; reason: string }>;
}

const SETTINGS_FILE = 'settings.json';
const SETTINGS_KEY = 'curatedSources';
const ENV_KEY = 'KEEPMIND_CURATED_SOURCES';

function validate(raw: unknown, rejected: CuratedSourceSet['rejected']): CuratedSource[] {
  if (!Array.isArray(raw)) {
    rejected.push({ entry: raw, reason: `expected an array, got ${typeof raw}` });
    return [];
  }

  const out: CuratedSource[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      rejected.push({ entry, reason: 'not an object' });
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const path = candidate.path;
    const kind = candidate.kind;

    if (typeof path !== 'string' || path.trim().length === 0) {
      rejected.push({ entry, reason: 'missing `path`' });
      continue;
    }
    if (kind !== 'akten' && kind !== 'vorgaenge') {
      // Not defaulted to 'akten'. A wrong kind is worse than a missing one:
      // it imports silently and mislabels every row it touches.
      rejected.push({ entry, reason: `\`kind\` must be "akten" or "vorgaenge", got ${JSON.stringify(kind)}` });
      continue;
    }
    if (!isAbsolute(path)) {
      // Relative paths would resolve against whatever directory the importer
      // happens to run in, so the same list would mean different things.
      rejected.push({ entry, reason: `\`path\` must be absolute: ${path}` });
      continue;
    }

    out.push({ path: resolve(path), kind });
  }
  return out;
}

/**
 * Read the configured source set.
 *
 * `KEEPMIND_CURATED_SOURCES` wins when set — it holds either inline JSON or a
 * path to a JSON file — otherwise `curatedSources` in `~/.keepmind/settings.json`.
 * An absent list is not an error: it means nothing is configured, and the
 * caller can still pass directories explicitly.
 */
export function loadCuratedSources(settingsDir: string = DATA_DIR): CuratedSourceSet {
  const rejected: CuratedSourceSet['rejected'] = [];

  const fromEnv = process.env[ENV_KEY];
  if (fromEnv && fromEnv.trim().length > 0) {
    const trimmed = fromEnv.trim();
    try {
      if (trimmed.startsWith('[')) {
        return { sources: validate(JSON.parse(trimmed), rejected), origin: `${ENV_KEY} (inline)`, rejected };
      }
      if (existsSync(trimmed)) {
        return { sources: validate(JSON.parse(readFileSync(trimmed, 'utf8')), rejected), origin: trimmed, rejected };
      }
      rejected.push({ entry: trimmed, reason: `${ENV_KEY} is neither JSON nor an existing file` });
      return { sources: [], origin: ENV_KEY, rejected };
    } catch (error) {
      rejected.push({ entry: trimmed, reason: `unreadable: ${error instanceof Error ? error.message : error}` });
      return { sources: [], origin: ENV_KEY, rejected };
    }
  }

  const settingsPath = join(settingsDir, SETTINGS_FILE);
  if (!existsSync(settingsPath)) {
    return { sources: [], origin: settingsPath, rejected };
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    if (!(SETTINGS_KEY in parsed)) {
      return { sources: [], origin: settingsPath, rejected };
    }
    return { sources: validate(parsed[SETTINGS_KEY], rejected), origin: settingsPath, rejected };
  } catch (error) {
    // A broken settings file must not look like an empty one.
    logger.warn('DB', 'Could not read curated source set', { settingsPath }, error instanceof Error ? error : undefined);
    rejected.push({ entry: settingsPath, reason: `unreadable: ${error instanceof Error ? error.message : error}` });
    return { sources: [], origin: settingsPath, rejected };
  }
}

/** Sources whose directory is missing right now. Reported, not skipped quietly. */
export function missingSources(sources: CuratedSource[]): CuratedSource[] {
  return sources.filter(source => {
    try {
      return !statSync(source.path).isDirectory();
    } catch {
      return true;
    }
  });
}
