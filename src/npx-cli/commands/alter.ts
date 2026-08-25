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
  /**
   * Report the OPEN WORK ITEMS instead of the decisions.
   *
   * A separate mode rather than a second section, because the two orderings
   * are computed differently — decisions by record number, open items by date
   * — and printing them together invites reading one number as the other.
   */
  openItems: boolean;
}

export function parseAlterOptions(args: string[]): AlterOptions {
  let project: string | undefined;
  let limit = 20;
  let json = false;
  let includeRetired = false;
  let openItems = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') { json = true; continue; }
    if (arg === '--all') { includeRetired = true; continue; }
    if (arg === '--vorgaenge' || arg === '--open') { openItems = true; continue; }
    if (arg === '--project') { project = args[++i]; continue; }
    if (arg.startsWith('--project=')) { project = arg.slice('--project='.length); continue; }
    if (arg === '--limit') { limit = parseInt(args[++i], 10) || 20; continue; }
    if (arg.startsWith('--limit=')) { limit = parseInt(arg.slice('--limit='.length), 10) || 20; continue; }
  }

  return { project, limit, json, includeRetired, openItems };
}

export async function runAlterCommand(options: AlterOptions): Promise<void> {
  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  const { ageReport, openItemsReport } = await import('../../services/curated/aging.js');
  const { getProjectName } = await import('../../utils/project-name.js');

  const project = options.project ?? getProjectName(process.cwd());
  const store = new SessionStore();
  const db = (store as unknown as { db: Parameters<typeof ageReport>[0] }).db;

  if (options.openItems) {
    renderOpenItems(project, openItemsReport(db, project), options);
    return;
  }

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

/**
 * The open claims, oldest and most-cited first.
 *
 * An open item is the one kind of entry that goes stale by the WORLD moving
 * rather than by anyone touching it: nothing writes to `V-0187` when the thing
 * it waits for is settled elsewhere. So this is the list to read down when
 * asking "is this still open?", and it is measured, never judged — the reader
 * decides what is obsolete.
 */
function renderOpenItems(
  project: string,
  entries: Array<import('../../services/curated/aging.js').OpenItemEntry>,
  options: AlterOptions,
): void {
  if (options.json) {
    console.log(JSON.stringify({
      project, total: entries.length,
      shown: Math.min(entries.length, options.limit),
      entries: entries.slice(0, options.limit),
    }, null, 2));
    return;
  }

  if (entries.length === 0) {
    console.log(`No open work items in project "${project}".`);
    return;
  }

  console.log(`\n${entries.length} open work item(s) in "${project}".\n`);
  console.log('  Each one CLAIMS something is still unresolved, and is read as current');
  console.log('  for as long as it stands. Nothing writes to an item when the thing it');
  console.log('  waits for is settled elsewhere — so these numbers are the only sign.\n');

  for (const entry of entries.slice(0, options.limit)) {
    console.log(`  ${entry.itemId}  [${entry.state ?? 'unbekannt'}]  ${entry.title.slice(0, 60)}`);
    // Which date the age came from is printed, not assumed: "unchanged since
    // it was created" and "unchanged since it last moved" are different
    // claims, and only the second one means the item has been looked at.
    const age = entry.ageDays === null
      ? 'age unknown'
      : `${entry.ageDays} day(s) ${entry.ageFrom === 'state' ? 'in this state' : 'since it was written'}`;
    console.log(`      ${age} · ${entry.decisionsSince} decision(s) since · ${entry.citingSince} of them name it`);
    console.log(`      ${entry.sourcePath}:${entry.sourceLine}`);
    console.log('');
  }

  if (entries.length > options.limit) {
    console.log(`  … ${entries.length - options.limit} more (--limit ${entries.length} to see all).`);
  }
  console.log('');
}
