import { describe, it, expect } from 'bun:test';
// @ts-expect-error — plain ESM script, no type declarations by design.
import { splitChangelog, dedupeEntries, compareVersionsDesc } from '../../scripts/generate-changelog.js';

/**
 * The changelog generator had no test, and both bugs below reached production
 * because of it. Neither failed loudly: one printed "CHANGELOG.md is already up
 * to date" over a missing release, the other quietly duplicated 22 entries.
 *
 * CHANGELOG.md is generated from GitHub Releases and is the public record of
 * what shipped, so a silent hole in it cannot be repaired later — which is why
 * these two decisions are now pinned.
 */

const MARKER = '<!-- inherited-history -->';

function changelog(own: string, inherited: string): string {
  return `# Changelog\n\n${own}\n${MARKER}\n${inherited}`;
}

describe('which versions count as already documented', () => {
  it('ignores the inherited pre-fork history', () => {
    // The inherited claude-mem changelog numbers up to 13.x and therefore
    // collides with nearly every number this fork will ever use. Counting its
    // headings as known filed keepmind's own v4.3.0 as already present, and the
    // release never entered the file.
    const content = changelog(
      '## [4.2.0] - 2026-08-21\n\nkeepmind.\n',
      '## [4.3.0] - 2025-10-25\n\nclaude-mem, a different project.\n',
    );
    const { knownVersions } = splitChangelog(content);
    expect(knownVersions.has('4.2.0')).toBe(true);
    expect(knownVersions.has('4.3.0')).toBe(false);
  });
});

describe('where keepmind territory ends', () => {
  it('cuts at the LAST marker, not the first', () => {
    // A release note that TALKS about the marker puts a second copy of it into
    // the generated file. Cutting at the first match froze every entry after
    // that release into the inherited block, where it was preserved verbatim
    // and never recognised again.
    const content = changelog(
      `## [4.3.0] - 2026-08-25\n\nThe ${MARKER} marker separates the two schemes.\n\n## [4.2.0] - 2026-08-21\n\nkeepmind.\n`,
      '## [13.0.0] - 2025-01-01\n\nclaude-mem.\n',
    );
    const { knownVersions, inherited } = splitChangelog(content);

    expect(knownVersions.has('4.3.0')).toBe(true);
    expect(knownVersions.has('4.2.0')).toBe(true);
    expect(knownVersions.has('13.0.0')).toBe(false);
    expect(inherited).toContain('13.0.0');
    expect(inherited).not.toContain('4.2.0');
  });

  it('treats a file with no marker as entirely its own', () => {
    const { knownVersions, inherited } = splitChangelog('# Changelog\n\n## [1.0.0] - 2026-01-01\n\nx\n');
    expect(knownVersions.has('1.0.0')).toBe(true);
    expect(inherited).toBe('');
  });
});

describe('one block per version', () => {
  it('keeps the freshly rendered entry and drops the stale copy', () => {
    // Order matters: existing entries are listed before newly fetched ones, so
    // the later (fresh, from the GitHub Release) wins.
    const merged = dedupeEntries([
      { version: '4.3.0', text: 'stale copy frozen in the file' },
      { version: '4.2.0', text: 'unaffected' },
      { version: '4.3.0', text: 'fresh from the release' },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((e: { version: string }) => e.version === '4.3.0').text).toBe('fresh from the release');
  });
});

describe('version ordering', () => {
  it('sorts by version, not by publish date', () => {
    expect(['3.3.0', '4.10.0', '4.2.0', '4.3.0'].sort(compareVersionsDesc))
      .toEqual(['4.10.0', '4.3.0', '4.2.0', '3.3.0']);
  });

  it('puts a release above its own prereleases', () => {
    expect(['3.3.0-rc.1', '3.3.0'].sort(compareVersionsDesc)).toEqual(['3.3.0', '3.3.0-rc.1']);
  });
});
