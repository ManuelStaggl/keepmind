#!/usr/bin/env node

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const CHANGELOG_PATH = 'CHANGELOG.md';
// Everything from this marker down is the pre-fork claude-mem changelog, which
// numbers up to 13.x. Sorting it together with keepmind's own 1.x–3.x releases
// would file the whole inherited history above the current release, so the
// generator treats the marker as the end of its territory and copies the rest
// through untouched.
const INHERITED_MARKER = '<!-- inherited-history -->';
const HEADER_LINES = [
  '# Changelog',
  '',
  'All notable changes to this project will be documented in this file.',
  '',
  'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).',
  '',
];

function exec(command) {
  try {
    return execSync(command, { encoding: 'utf-8' });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error.message);
    process.exit(1);
  }
}

function listReleases() {
  const releasesJson = exec('gh release list --limit 1000 --json tagName,publishedAt,name');
  return JSON.parse(releasesJson);
}

function fetchReleaseBody(tagName) {
  // Parse the JSON in Node rather than piping through `--jq '.body'`: execSync
  // runs via cmd.exe on Windows, which does not strip single quotes, so jq
  // received a literal '.body' and failed. --json alone is shell-quote-free.
  const json = exec(`gh release view ${tagName} --json body`);
  return (JSON.parse(json).body ?? '').trim();
}

function formatDate(isoDate) {
  return new Date(isoDate).toISOString().split('T')[0];
}

function cleanReleaseBody(body) {
  return body
    .replace(/🤖 Generated with \[Claude Code\].*$/s, '')
    .replace(/---\n*$/s, '')
    .trim();
}

function extractVersion(tagName) {
  return tagName.replace(/^v/, '');
}

/**
 * Order two versions newest-first. Sorting by publish date instead looks right
 * until a release is published out of order — backfilling a missing 3.3.0 after
 * 3.3.1 already shipped filed it above 3.3.1, because it was the more recently
 * published of the two. Version order is the only order a changelog can mean.
 */
export function compareVersionsDesc(a, b) {
  const split = (v) => {
    const [core, prerelease = ''] = v.split('-');
    return { parts: core.split('.').map(Number), prerelease };
  };
  const x = split(a);
  const y = split(b);
  const len = Math.max(x.parts.length, y.parts.length);
  for (let i = 0; i < len; i++) {
    const diff = (y.parts[i] ?? 0) - (x.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // A release outranks its own prereleases: 3.3.0 sorts above 3.3.0-rc.1.
  if (x.prerelease === y.prerelease) return 0;
  if (!x.prerelease) return -1;
  if (!y.prerelease) return 1;
  return y.prerelease.localeCompare(x.prerelease);
}

/** Split an existing CHANGELOG body into its per-version blocks, verbatim. */
function parseExistingEntries(body) {
  const entries = [];
  const headerRe = /^## \[([^\]]+)\]/gm;
  const starts = [];
  let match;
  while ((match = headerRe.exec(body)) !== null) {
    starts.push({ version: match[1], index: match.index });
  }
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].index : body.length;
    entries.push({ version: starts[i].version, text: body.slice(starts[i].index, end) });
  }
  return entries;
}

function renderEntry(release) {
  const version = extractVersion(release.tagName);
  const date = formatDate(release.publishedAt);
  const body = cleanReleaseBody(release.body);
  const lines = [`## [${version}] - ${date}`, ''];
  if (body) {
    const bodyWithoutHeader = body.replace(/^##?\s+v?[\d.]+.*?\n\n?/m, '');
    lines.push(bodyWithoutHeader);
    lines.push('');
  }
  return lines.join('\n');
}

function readExistingChangelog() {
  if (!existsSync(CHANGELOG_PATH)) {
    return { knownVersions: new Set(), body: '', inherited: '' };
  }
  return splitChangelog(readFileSync(CHANGELOG_PATH, 'utf-8'));
}

/**
 * Split a changelog into keepmind's own territory and the inherited history.
 *
 * Takes the text rather than reading the file, so the two decisions below —
 * which marker ends our territory, and which versions count as documented —
 * can be tested. Both were wrong in production, and neither failed loudly.
 */
export function splitChangelog(content) {
  // LAST occurrence, not the first.
  //
  // A release note that TALKS about the marker puts a second copy of it into
  // the generated file — and the first-match cut then treats every entry after
  // that release as inherited history. Observed: 22 keepmind entries frozen
  // below a quoted marker, preserved verbatim on every later run, so the
  // generator never saw them as known and appended a second copy of each at the
  // top. The real marker is the last one by construction: everything below it
  // is pre-fork history and contains no release bodies of ours.
  const markerIndex = content.lastIndexOf(INHERITED_MARKER);
  const own = markerIndex === -1 ? content : content.slice(0, markerIndex);
  const inherited = markerIndex === -1 ? '' : content.slice(markerIndex);

  // Only keepmind's OWN section counts as "already documented".
  //
  // Scanning the whole file swept up the inherited claude-mem history below the
  // marker, whose version numbers run up to 13.x and therefore collide with
  // nearly every number this fork will ever use. A keepmind release whose
  // number the pre-fork changelog happened to use was then filed as already
  // known and silently never added — the generator printed "CHANGELOG.md is
  // already up to date" and left a permanent hole. Observed on v4.3.0, where
  // the only `## [4.3.0]` in the file was claude-mem's from 2025-10-25.
  const knownVersions = new Set();
  const versionHeaderRe = /^## \[([^\]]+)\]/gm;
  let match;
  while ((match = versionHeaderRe.exec(own)) !== null) {
    knownVersions.add(match[1]);
  }
  const firstEntryIndex = own.search(/^## \[/m);
  const body = firstEntryIndex === -1 ? '' : own.slice(firstEntryIndex);
  return { knownVersions, body, inherited };
}

/** One entry per version, freshly rendered blocks winning. Exported for the test. */
export function dedupeEntries(entries) {
  const byVersion = new Map();
  for (const entry of entries) byVersion.set(entry.version, entry);
  return [...byVersion.values()];
}

function main() {
  const fullRegen = process.argv.includes('--full');

  console.log('🔧 Generating CHANGELOG.md from GitHub releases...\n');

  // --full rebuilds keepmind's own entries from GitHub, but the inherited
  // section has no releases behind it — dropping it would delete it for good.
  const existing = readExistingChangelog();
  const { knownVersions, body: existingBody } = fullRegen
    ? { knownVersions: new Set(), body: '' }
    : existing;
  const inherited = existing.inherited;

  console.log('📋 Fetching release list from GitHub...');
  const allReleases = listReleases();

  if (allReleases.length === 0) {
    console.log('⚠️  No releases found');
    return;
  }

  const newReleases = allReleases.filter(
    (release) => !knownVersions.has(extractVersion(release.tagName)),
  );

  if (newReleases.length === 0) {
    console.log('✅ CHANGELOG.md is already up to date.');
    return;
  }

  console.log(
    `📥 Fetching bodies for ${newReleases.length} new release(s)` +
      (fullRegen ? '' : ` (${knownVersions.size} already in CHANGELOG)`) +
      '...',
  );
  for (const release of newReleases) {
    release.body = fetchReleaseBody(release.tagName);
  }

  // Merge rather than prepend: a backfilled release belongs at its version's
  // place in the file, not at the top just because it was fetched this run.
  const entries = [
    ...parseExistingEntries(existingBody),
    ...newReleases.map((release) => ({
      version: extractVersion(release.tagName),
      text: renderEntry(release),
    })),
  ];
  // One entry per version. A duplicate here is not cosmetic: the file is the
  // public record of what shipped, and two blocks for one version leave the
  // reader to guess which is current. The freshly rendered one wins — it came
  // from the GitHub Release, which is the source of truth.
  const deduped = dedupeEntries(entries);
  if (deduped.length !== entries.length) {
    console.log(`   ⚠  dropped ${entries.length - deduped.length} duplicate version block(s)`);
  }
  entries.length = 0;
  entries.push(...deduped);
  entries.sort((a, b) => compareVersionsDesc(a.version, b.version));

  const finalBody =
    entries.map((entry) => entry.text.trimEnd()).join('\n\n').trimEnd() + '\n';

  const changelog =
    HEADER_LINES.join('\n') + '\n' + finalBody + (inherited ? '\n' + inherited : '');
  writeFileSync(CHANGELOG_PATH, changelog, 'utf-8');

  console.log('\n✅ CHANGELOG.md generated successfully!');
  console.log(`   ${newReleases.length} new release(s) merged, ${entries.length} total`);
}

// Only when run as a script: the test imports this module for its pure helpers,
// and a bare `main()` would fire `gh` calls on import.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main();
}
