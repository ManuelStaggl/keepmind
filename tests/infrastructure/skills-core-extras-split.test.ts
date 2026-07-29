// Perf plan P5: the 17 skill frontmatter descriptions sat resident in EVERY
// session (~4.5k characters, ~1.1k tokens), and the skill list is budgeted at
// roughly 1% of the context window. The optional workflow skills moved into a
// separate opt-in plugin, `keepmind-extras`.
//
// This pins the boundary in both directions, because both failure modes are
// silent: a core skill drifting into extras breaks code that resolves it by
// path, and an extras skill drifting back into core quietly re-adds the token
// cost this split exists to remove.
import { describe, it, expect } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'fs';
import path from 'path';

const projectRoot = path.join(import.meta.dirname, '..', '..');
const CORE_SKILLS_DIR = path.join(projectRoot, 'plugin', 'skills');
const EXTRAS_SKILLS_DIR = path.join(projectRoot, 'plugin-extras', 'skills');

const CORE_SKILLS = ['how-it-works', 'learn-codebase', 'mem-search', 'smart-explore', 'what-the'];
const EXTRAS_SKILLS = [
  'babysit', 'design-is', 'do', 'knowledge-agent', 'make-plan', 'oh-my-issues',
  'pathfinder', 'standup', 'timeline-report', 'version-bump', 'weekly-digests', 'wowerpoint',
];

const dirsIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();

describe('core/extras skill split (perf plan P5)', () => {
  it('core ships exactly the memory skills', () => {
    expect(dirsIn(CORE_SKILLS_DIR)).toEqual([...CORE_SKILLS].sort());
  });

  it('extras ships exactly the optional workflow skills', () => {
    expect(dirsIn(EXTRAS_SKILLS_DIR)).toEqual([...EXTRAS_SKILLS].sort());
  });

  it('every moved skill kept a readable SKILL.md', () => {
    for (const skill of EXTRAS_SKILLS) {
      const file = path.join(EXTRAS_SKILLS_DIR, skill, 'SKILL.md');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, 'utf-8').startsWith('---\n')).toBe(true);
    }
  });

  it('keeps the skills that source code resolves by path in core', () => {
    // src/services/server/Server.ts          -> ../skills/mem-search
    // src/services/worker/http/routes/SearchRoutes.ts -> ../skills/how-it-works/...
    // scripts/build-hooks.js copies mem-search / smart-explore / how-it-works
    for (const skill of ['mem-search', 'how-it-works', 'smart-explore']) {
      expect(existsSync(path.join(CORE_SKILLS_DIR, skill, 'SKILL.md'))).toBe(true);
    }
    expect(existsSync(path.join(CORE_SKILLS_DIR, 'how-it-works', 'onboarding-explainer.md'))).toBe(true);
  });

  it('keeps skills that hand off to each other together in extras', () => {
    // design-is / pathfinder / oh-my-issues emit a /make-plan prompt, and `do`
    // executes what make-plan produced. Splitting any of them apart would leave a
    // skill pointing at one the user does not have.
    for (const skill of ['make-plan', 'do', 'design-is', 'pathfinder', 'oh-my-issues']) {
      expect(existsSync(path.join(EXTRAS_SKILLS_DIR, skill, 'SKILL.md'))).toBe(true);
    }
  });
});

describe('keepmind-extras packaging', () => {
  const extrasManifest = JSON.parse(
    readFileSync(path.join(projectRoot, 'plugin-extras', '.claude-plugin', 'plugin.json'), 'utf-8'),
  );
  const marketplace = JSON.parse(
    readFileSync(path.join(projectRoot, '.claude-plugin', 'marketplace.json'), 'utf-8'),
  );
  const pkg = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));

  it('is named keepmind-extras, NOT the package name', () => {
    // A plugin is keyed by name; letting sync-plugin-manifests.js overwrite this
    // with pkg.name would orphan every existing install.
    expect(extrasManifest.name).toBe('keepmind-extras');
  });

  it('tracks the core version', () => {
    expect(extrasManifest.version).toBe(pkg.version);
  });

  it('is registered in the marketplace pointing at ./plugin-extras', () => {
    const entry = marketplace.plugins.find((p: { name: string }) => p.name === 'keepmind-extras');
    expect(entry).toBeDefined();
    expect(entry.source).toBe('./plugin-extras');
    expect(entry.version).toBe(pkg.version);
  });

  it('ships in the npm package', () => {
    expect(pkg.files).toContain('plugin-extras');
  });

  it('is NOT auto-enabled by the installer', () => {
    // Opt-in is the whole point: enabling it would put the descriptions back into
    // every session and defeat the split.
    const install = readFileSync(path.join(projectRoot, 'src/npx-cli/commands/install.ts'), 'utf-8');
    expect(install).not.toMatch(/enabledPlugins\[['"]keepmind-extras@keepmind['"]\]\s*=\s*true/);
  });
});
