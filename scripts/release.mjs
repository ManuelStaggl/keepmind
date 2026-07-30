#!/usr/bin/env node

/**
 * The one supported way to cut a keepmind release.
 *
 * Publishing happens in CI: pushing a `v*` tag triggers .github/workflows/
 * npm-publish.yml, which authenticates to npm over OIDC. Nothing here publishes
 * to npm directly — there is no token on this machine and there should not be.
 *
 * What this script does own is everything around that tag, because every step
 * of it has gone wrong at least once:
 *
 *   - `scripts/publish.js` (removed) bumped 2 of the 8 version manifests, wrote
 *     a `chore: Release vX` commit that the changelog generator filters out, and
 *     ran `git push --tags` — which would have pushed 322 inherited claude-mem
 *     tags to the remote.
 *   - v3.3.0 shipped to npm with no GitHub Release. CHANGELOG.md is generated
 *     from GitHub Releases, so a missing one is a permanent hole in the file.
 *     Release notes are therefore mandatory input here, not a later chore.
 *   - The pre-fork tags occupied v3.3.8, v3.5.x and 43 other future versions
 *     until they were moved under `upstream/`. The preflight refuses to run if
 *     unreachable tags reappear outside that namespace.
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const PKG = 'package.json';
const REMOTE = 'origin';
const RELEASE_BRANCH = 'main';

function git(args, options = {}) {
  return execFileSync('git', args, { encoding: 'utf-8', ...options }).trim();
}

function run(command) {
  execSync(command, { stdio: 'inherit' });
}

function fail(message, hint) {
  console.error(`\n❌ ${message}`);
  if (hint) console.error(`   ${hint}`);
  process.exit(1);
}

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function publishedVersions(pkgName) {
  try {
    return new Set(JSON.parse(execSync(`npm view ${pkgName} versions --json`, { encoding: 'utf-8' })));
  } catch {
    // An unpublished package is a legitimate state for a first release.
    return new Set();
  }
}

function preflight(nextVersion, tag, notesFile) {
  console.log('🔍 Preflight\n');

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== RELEASE_BRANCH) {
    fail(`On branch "${branch}", releases are cut from "${RELEASE_BRANCH}".`);
  }
  console.log(`   ✓ on ${RELEASE_BRANCH}`);

  if (git(['status', '--porcelain'])) {
    fail('Working tree is dirty.', 'Commit the changes first — atomic conventional commits make the release notes.');
  }
  console.log('   ✓ working tree clean');

  git(['fetch', REMOTE, '--tags', '--quiet']);
  const ahead = git(['rev-list', '--count', `${REMOTE}/${RELEASE_BRANCH}..HEAD`]);
  const behind = git(['rev-list', '--count', `HEAD..${REMOTE}/${RELEASE_BRANCH}`]);
  if (behind !== '0') {
    fail(`HEAD is ${behind} commit(s) behind ${REMOTE}/${RELEASE_BRANCH}.`, 'Pull first.');
  }
  console.log(`   ✓ in sync with ${REMOTE} (${ahead} local commit(s) to push)`);

  // The inherited claude-mem tags live under upstream/. Anything else that is
  // unreachable from main is a foreign tag that can silently occupy a version.
  const strays = git(['tag', '--no-merged', RELEASE_BRANCH])
    .split('\n')
    .filter((t) => t && !t.startsWith('upstream/'));
  if (strays.length) {
    fail(
      `${strays.length} tag(s) unreachable from ${RELEASE_BRANCH} outside the upstream/ namespace.`,
      `First few: ${strays.slice(0, 5).join(', ')}`,
    );
  }
  console.log('   ✓ no stray tags occupying the version namespace');

  if (git(['tag', '-l', tag])) {
    fail(`Tag ${tag} already exists locally.`);
  }
  if (git(['ls-remote', '--tags', REMOTE, tag])) {
    fail(`Tag ${tag} already exists on ${REMOTE}.`);
  }
  console.log(`   ✓ ${tag} is free locally and on ${REMOTE}`);

  const pkg = JSON.parse(readFileSync(PKG, 'utf-8'));
  if (publishedVersions(pkg.name).has(nextVersion)) {
    fail(`${pkg.name}@${nextVersion} is already on npm.`, 'npm versions cannot be reused — pick the next one.');
  }
  console.log(`   ✓ ${nextVersion} not yet on npm`);

  if (!existsSync(notesFile) || !readFileSync(notesFile, 'utf-8').trim()) {
    fail(
      `Release notes missing or empty: ${notesFile}`,
      'CHANGELOG.md is generated from GitHub Releases — a release without notes is a hole in the changelog.',
    );
  }
  console.log(`   ✓ release notes present (${notesFile})`);

  try {
    execSync('gh auth status', { stdio: 'ignore' });
  } catch {
    fail('gh is not authenticated.', 'Run: gh auth login');
  }
  console.log('   ✓ gh authenticated');
}

function main() {
  const args = process.argv.slice(2);
  const bumpType = args.find((a) => ['patch', 'minor', 'major'].includes(a)) ?? 'patch';
  const notesFile = args.find((a) => a.startsWith('--notes='))?.slice('--notes='.length) ?? 'RELEASE_NOTES.md';
  const titleArg = args.find((a) => a.startsWith('--title='))?.slice('--title='.length);

  const pkg = JSON.parse(readFileSync(PKG, 'utf-8'));
  const nextVersion = bumpVersion(pkg.version, bumpType);
  const tag = `v${nextVersion}`;

  console.log(`\n📦 keepmind release: ${pkg.version} → ${nextVersion} (${bumpType})\n`);

  preflight(nextVersion, tag, notesFile);

  if (args.includes('--dry-run')) {
    console.log(`\n✅ Preflight passed. ${tag} would be cut from HEAD.`);
    return;
  }

  console.log('\n📝 Bumping version across all manifests...');
  pkg.version = nextVersion;
  writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
  // build runs sync-plugin-manifests, which is what propagates the version into
  // the other seven manifests and the bundled plugin scripts.
  run('npm run build');

  console.log('\n🧪 Running tests...');
  run('npm test');

  console.log('\n📌 Committing and tagging...');
  run('git add -A');
  execFileSync('git', ['commit', '-m', `chore: bump version to ${nextVersion}`], { stdio: 'inherit' });
  execFileSync('git', ['tag', '-a', tag, '-m', tag], { stdio: 'inherit' });

  console.log('\n⬆️  Pushing...');
  // Never `git push --tags`: it would push every local tag, including the
  // inherited upstream/* namespace.
  run(`git push ${REMOTE} ${RELEASE_BRANCH}`);
  run(`git push ${REMOTE} ${tag}`);

  console.log('\n🏷️  Creating the GitHub Release...');
  const title = titleArg ?? `keepmind ${nextVersion}`;
  execFileSync('gh', ['release', 'create', tag, '--title', title, '--notes-file', notesFile, '--latest'], {
    stdio: 'inherit',
  });

  console.log('\n📰 Regenerating CHANGELOG.md from the releases...');
  run('npm run changelog:generate');
  if (git(['status', '--porcelain', 'CHANGELOG.md'])) {
    execFileSync('git', ['add', 'CHANGELOG.md'], { stdio: 'inherit' });
    execFileSync('git', ['commit', '-m', `docs: add ${nextVersion} to the changelog`], { stdio: 'inherit' });
    run(`git push ${REMOTE} ${RELEASE_BRANCH}`);
  }

  console.log(`\n✅ ${tag} released.`);
  console.log(`   npm publish runs in CI: gh run watch --workflow=npm-publish.yml`);
  console.log(`   https://github.com/ManuelStaggl/keepmind/releases/tag/${tag}`);
}

main();
