/**
 * The tags keepmind writes into files it does not own — a project's `CLAUDE.md`,
 * Codex's `AGENTS.md`. Everything between them is regenerated; everything
 * outside is the user's.
 *
 * These were `<claude-mem-context>` before the rename. Readers accept both
 * spellings and writers always emit the canonical one, so a file picked up from
 * an older install is converted the next time its block is regenerated rather
 * than accumulating a second, orphaned block.
 */

export const CONTEXT_START_TAG = '<keepmind-context>';
export const CONTEXT_END_TAG = '</keepmind-context>';

export const LEGACY_CONTEXT_START_TAG = '<claude-mem-context>';
export const LEGACY_CONTEXT_END_TAG = '</claude-mem-context>';

/** Canonical first: a file carrying both is normalised to one canonical block. */
const TAG_PAIRS: ReadonlyArray<readonly [string, string]> = [
  [CONTEXT_START_TAG, CONTEXT_END_TAG],
  [LEGACY_CONTEXT_START_TAG, LEGACY_CONTEXT_END_TAG],
];

function findBlock(content: string): { start: number; end: number; endTag: string } | null {
  for (const [startTag, endTag] of TAG_PAIRS) {
    const start = content.indexOf(startTag);
    if (start === -1) continue;
    const end = content.indexOf(endTag, start);
    if (end === -1) continue;
    return { start, end, endTag };
  }
  return null;
}

/** True when the content carries a keepmind block under either spelling. */
export function hasContextBlock(content: string): boolean {
  return findBlock(content) !== null;
}

/**
 * Replace the existing block with `body`, or append one if there is none.
 * Always writes canonical tags, which is what migrates a legacy block.
 */
export function upsertContextBlock(existingContent: string, body: string): string {
  const block = `${CONTEXT_START_TAG}\n${body}\n${CONTEXT_END_TAG}`;
  if (!existingContent) return block;

  const found = findBlock(existingContent);
  if (!found) return `${existingContent}\n\n${block}`;

  return existingContent.substring(0, found.start)
    + block
    + existingContent.substring(found.end + found.endTag.length);
}

/**
 * Basename (without extension) of the rules file keepmind writes into
 * `.cursor/rules`, `.windsurf/rules`, `.agents/rules` and `.roo/rules`.
 * Renaming it is not enough on its own — see `legacyRulesFileFor`.
 */
export const RULES_FILE_BASENAME = 'keepmind-context';
export const LEGACY_RULES_FILE_BASENAME = 'claude-mem-context';

/**
 * The pre-rename path a rules file would have had. Callers delete it after
 * writing the canonical one: both files are `alwaysApply`, so leaving the old
 * one behind would inject the same context twice, once permanently stale.
 */
export function legacyRulesFileFor(rulesFilePath: string): string {
  return rulesFilePath.replace(
    new RegExp(`${RULES_FILE_BASENAME}(\\.[^.\\\\/]+)$`),
    `${LEGACY_RULES_FILE_BASENAME}$1`
  );
}

/** Remove the block (either spelling) and return the rest, trimmed. */
export function stripContextBlock(content: string): string {
  const found = findBlock(content);
  if (!found) return content.trim();

  const before = content.substring(0, found.start).replace(/\n+$/, '');
  const after = content.substring(found.end + found.endTag.length).replace(/^\n+/, '');
  return (before + (after ? '\n\n' + after : '')).trim();
}
