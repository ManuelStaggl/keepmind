
import { describe, it, expect } from 'bun:test';
import {
  CONTEXT_START_TAG,
  CONTEXT_END_TAG,
  LEGACY_CONTEXT_START_TAG,
  LEGACY_CONTEXT_END_TAG,
  RULES_FILE_BASENAME,
  hasContextBlock,
  upsertContextBlock,
  stripContextBlock,
  legacyRulesFileFor,
} from '../../src/shared/context-markers.js';

// keepmind writes these tags into files it does not own. The pre-rename
// spelling must stay readable, and — more importantly — a file carrying it must
// be CONVERTED on the next write rather than gaining a second block: both would
// then be injected, one of them permanently stale.
describe('context markers', () => {
  const legacyBlock = `${LEGACY_CONTEXT_START_TAG}\nold\n${LEGACY_CONTEXT_END_TAG}`;

  describe('detection', () => {
    it('recognises a canonical block', () => {
      expect(hasContextBlock(`${CONTEXT_START_TAG}\nx\n${CONTEXT_END_TAG}`)).toBe(true);
    });

    it('recognises a pre-rename block', () => {
      expect(hasContextBlock(legacyBlock)).toBe(true);
    });

    it('does not treat an unterminated tag as a block', () => {
      expect(hasContextBlock(`${CONTEXT_START_TAG}\nno closing tag`)).toBe(false);
    });

    it('reports nothing for unrelated content', () => {
      expect(hasContextBlock('# My notes')).toBe(false);
    });
  });

  describe('upsert', () => {
    it('wraps content when the file is empty', () => {
      expect(upsertContextBlock('', 'fresh')).toBe(`${CONTEXT_START_TAG}\nfresh\n${CONTEXT_END_TAG}`);
    });

    it('replaces a pre-rename block in place, converting the tags', () => {
      const existing = `Before\n${legacyBlock}\nAfter`;

      const result = upsertContextBlock(existing, 'new');

      expect(result).toBe(`Before\n${CONTEXT_START_TAG}\nnew\n${CONTEXT_END_TAG}\nAfter`);
      // The crucial part: exactly one block, and none of the old spelling.
      expect(result).not.toContain(LEGACY_CONTEXT_START_TAG);
      expect(result.match(new RegExp(CONTEXT_START_TAG, 'g'))).toHaveLength(1);
    });

    it('preserves user content around the block', () => {
      const existing = `# My notes\n${CONTEXT_START_TAG}\nold\n${CONTEXT_END_TAG}\nMore notes`;
      expect(upsertContextBlock(existing, 'new')).toContain('# My notes');
      expect(upsertContextBlock(existing, 'new')).toContain('More notes');
    });

    it('appends when the file has no block yet', () => {
      expect(upsertContextBlock('# Notes', 'x'))
        .toBe(`# Notes\n\n${CONTEXT_START_TAG}\nx\n${CONTEXT_END_TAG}`);
    });
  });

  describe('strip', () => {
    it('removes a canonical block', () => {
      const content = `Keep\n${CONTEXT_START_TAG}\ndrop\n${CONTEXT_END_TAG}\nKeep too`;
      expect(stripContextBlock(content)).toBe('Keep\n\nKeep too');
    });

    it('removes a pre-rename block', () => {
      expect(stripContextBlock(`Keep\n${legacyBlock}`)).toBe('Keep');
    });

    it('returns an empty string when the file was only a block', () => {
      expect(stripContextBlock(legacyBlock)).toBe('');
    });
  });

  describe('rules files', () => {
    it('derives the pre-rename path for a .mdc rules file', () => {
      expect(legacyRulesFileFor(`/w/.cursor/rules/${RULES_FILE_BASENAME}.mdc`))
        .toBe('/w/.cursor/rules/claude-mem-context.mdc');
    });

    it('derives the pre-rename path for a .md rules file', () => {
      expect(legacyRulesFileFor(`/w/.windsurf/rules/${RULES_FILE_BASENAME}.md`))
        .toBe('/w/.windsurf/rules/claude-mem-context.md');
    });

    it('leaves an unrelated path unchanged, so nothing else can be deleted', () => {
      expect(legacyRulesFileFor('/w/.cursor/rules/my-own-rule.mdc'))
        .toBe('/w/.cursor/rules/my-own-rule.mdc');
    });
  });
});
