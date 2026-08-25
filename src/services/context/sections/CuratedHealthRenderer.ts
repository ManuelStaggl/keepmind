// SPDX-License-Identifier: Apache-2.0
//
// The curated corpus reports its own state at every session start.
//
// WHY IT IS HERE AND NOT IN A LOG. The last import outage lasted four days.
// Nothing was broken in a way anyone could see: sessions started normally,
// search returned results, and the results were simply out of date. The only
// place that failure could have been caught is the place the answers are used.
//
// One line when everything is in order — enough to know the memory is current,
// small enough to ignore. A block when it is not, above the hand-off, because
// a stale corpus changes what every later answer in the session is worth.

import { curatedHealth, describeCuratedHealth, type CuratedHealth } from '../../curated/health.js';
import { readCuratedRecordCounts } from '../../curated/stored-records.js';
import { logger } from '../../../utils/logger.js';

export function renderCuratedHealth(options: { now?: number; entries?: CuratedHealth[] } = {}): string[] {
  const now = options.now ?? Date.now();
  let entries: CuratedHealth[];
  try {
    entries = options.entries ?? curatedHealth(undefined, { storedRecords: readCuratedRecordCounts() });
  } catch (error) {
    // Never let a health check cost the user their session context.
    logger.debug('WORKER', 'Curated health could not be read', {}, error instanceof Error ? error : undefined);
    return [];
  }

  // No curated corpus on this machine: nothing to say, and a line saying so
  // would be noise in every session of every project that never uses one.
  if (entries.length === 0) return [];

  // A project this machine is configured for but holds nothing of is the same
  // silence. keepmind is developed on one machine and used on another; a
  // settings file that travels must not put a warning at the top of every
  // session on every machine the corpus did not travel to.
  entries = entries.filter(entry => entry.presence !== 'absent');
  if (entries.length === 0) return [];

  // Held here but cut off from its sources: worth one line, not the banner.
  // The banner ends in "fix it with `curated:import`", and that instruction is
  // useless advice on a machine where the files are not there to import.
  const detached = entries.filter(entry => entry.presence === 'detached');
  const attached = entries.filter(entry => entry.presence !== 'detached');
  const detachedLines = detached.map(entry => `Curated corpus [${entry.project}]: ${describeCuratedHealth(entry, now)}`);

  if (attached.length === 0) {
    return [...detachedLines, ''];
  }
  entries = attached;

  const broken = entries.filter(entry => !entry.ok);
  const output: string[] = [];

  if (broken.length === 0) {
    for (const entry of entries) {
      output.push(`Curated corpus [${entry.project}]: ${describeCuratedHealth(entry, now)}`);
    }
    output.push(...detachedLines);
    output.push('');
    return output;
  }

  output.push('# ⚠ CURATED CORPUS OUT OF STEP');
  output.push('The lasting entries below are not in step with their source files. Answers drawn from them may be out of date.');
  output.push('');
  for (const entry of broken) {
    output.push(`- **${entry.project}** — ${describeCuratedHealth(entry, now)}`);
  }
  const healthy = entries.filter(entry => entry.ok);
  for (const entry of healthy) {
    output.push(`- ${entry.project} — ${describeCuratedHealth(entry, now)}`);
  }
  for (const entry of detached) {
    output.push(`- ${entry.project} — ${describeCuratedHealth(entry, now)}`);
  }
  output.push('');
  output.push('Fix it with `npx keepmind curated:import` (add `--project <name>`), then `npx keepmind doctor`.');
  output.push('');
  output.push('---');
  output.push('');
  return output;
}
