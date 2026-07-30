#!/usr/bin/env node

import { execSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';

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
function compareVersionsDesc(a, b) {
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
    return { knownVersions: new Set(), body: '' };
  }
  const content = readFileSync(CHANGELOG_PATH, 'utf-8');
  const markerIndex = content.indexOf(INHERITED_MARKER);
  const own = markerIndex === -1 ? content : content.slice(0, markerIndex);
  const inherited = markerIndex === -1 ? '' : content.slice(markerIndex);

  const knownVersions = new Set();
  const versionHeaderRe = /^## \[([^\]]+)\]/gm;
  let match;
  while ((match = versionHeaderRe.exec(content)) !== null) {
    knownVersions.add(match[1]);
  }
  const firstEntryIndex = own.search(/^## \[/m);
  const body = firstEntryIndex === -1 ? '' : own.slice(firstEntryIndex);
  return { knownVersions, body, inherited };
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
  entries.sort((a, b) => compareVersionsDesc(a.version, b.version));

  const finalBody =
    entries.map((entry) => entry.text.trimEnd()).join('\n\n').trimEnd() + '\n';

  const changelog =
    HEADER_LINES.join('\n') + '\n' + finalBody + (inherited ? '\n' + inherited : '');
  writeFileSync(CHANGELOG_PATH, changelog, 'utf-8');

  console.log('\n✅ CHANGELOG.md generated successfully!');
  console.log(`   ${newReleases.length} new release(s) merged, ${entries.length} total`);
}

main();
