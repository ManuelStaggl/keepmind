// SPDX-License-Identifier: Apache-2.0
//
// `keepmind curated:alter` — which decisions have the most happened around?
//
// This command claims nothing. It counts days, later records and declared
// citations, and sorts by them. That is the whole point: everything else on
// the curated path has to be careful not to invent a relation, and this has
// nothing to invent — it can only be uninteresting, never wrong.
//
// What it produces is a reading order for a backlog that otherwise has none.

export interface AlterOptions {
  project?: string;
  limit: number;
  json: boolean;
  /** Show retired records too. Off by default — they no longer apply. */
  includeRetired: boolean;
}

export function parseAlterOptions(args: string[]): AlterOptions {
  let project: string | undefined;
  let limit = 20;
  let json = false;
  let includeRetired = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') { json = true; continue; }
    if (arg === '--all') { includeRetired = true; continue; }
    if (arg === '--project') { project = args[++i]; continue; }
    if (arg.startsWith('--project=')) { project = arg.slice('--project='.length); continue; }
    if (arg === '--limit') { limit = parseInt(args[++i], 10) || 20; continue; }
    if (arg.startsWith('--limit=')) { limit = parseInt(arg.slice('--limit='.length), 10) || 20; continue; }
  }

  return { project, limit, json, includeRetired };
}

export async function runAlterCommand(options: AlterOptions): Promise<void> {
  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  const { ageReport } = await import('../../services/curated/aging.js');
  const { getProjectName } = await import('../../utils/project-name.js');

  const project = options.project ?? getProjectName(process.cwd());
  const store = new SessionStore();
  const db = (store as unknown as { db: Parameters<typeof ageReport>[0] }).db;

  const all = ageReport(db, project);
  const entries = options.includeRetired ? all : all.filter(e => !e.retired);

  if (options.json) {
    console.log(JSON.stringify({ project, total: all.length, shown: Math.min(entries.length, options.limit), entries: entries.slice(0, options.limit) }, null, 2));
    return;
  }

  if (all.length === 0) {
    console.log(`No curated records in project "${project}". Run \`keepmind curated:import\` first.`);
    process.exitCode = 1;
    return;
  }

  const retiredCount = all.filter(e => e.retired).length;
  console.log(`\n${all.length} curated record(s) in "${project}", ${retiredCount} retired.\n`);
  console.log('  Sorted by how many LATER records cite them — a record thirty later');
  console.log('  decisions point at is load-bearing; an old one nobody cites is just old.\n');

  for (const entry of entries.slice(0, options.limit)) {
    const flag = entry.retired ? ' [retired]' : '';
    console.log(`  ${entry.recordId}${flag}  ${entry.title.slice(0, 64)}`);
    const age = entry.ageDays === null ? 'age unknown' : `written ${entry.ageDays} day(s) ago`;
    console.log(`      ${age} · ${entry.decisionsSince} decision(s) since · ${entry.citingSince} of them name it`);
    if (entry.status) console.log(`      Stand: ${entry.status}`);
    console.log(`      ${entry.sourcePath}:${entry.sourceLine}`);
    console.log('');
  }

  if (entries.length > options.limit) {
    // Say what was cut. A truncated list that does not admit it reads as the
    // whole list.
    console.log(`  … ${entries.length - options.limit} more (--limit ${entries.length} to see all).`);
  }
  if (!options.includeRetired && retiredCount > 0) {
    console.log(`  ${retiredCount} retired record(s) hidden (--all to include).`);
  }
  console.log('');
}
