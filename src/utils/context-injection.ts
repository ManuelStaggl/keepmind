
import path from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { toBmpSafe } from './bmp-safe.js';
import {
  CONTEXT_START_TAG,
  CONTEXT_END_TAG,
  upsertContextBlock,
  legacyRulesFileFor,
} from '../shared/context-markers.js';

// Single source of truth lives in shared/context-markers.ts, which also knows
// the pre-rename spelling. Re-exported here because these names are the
// established import site across the integrations.
export const CONTEXT_TAG_OPEN = CONTEXT_START_TAG;
export const CONTEXT_TAG_CLOSE = CONTEXT_END_TAG;

/**
 * Delete the pre-rename sibling of a rules file, if it is still there.
 *
 * Call after writing the canonical file. Cursor/Windsurf/Roo rules are
 * `alwaysApply`, so an install upgraded across the rename would otherwise keep
 * injecting the old file's frozen contents alongside the live one — duplicated
 * context that only ever gets staler, with no UI hinting at why.
 */
export function removeLegacyRulesFile(canonicalPath: string): void {
  const legacyPath = legacyRulesFileFor(canonicalPath);
  if (legacyPath === canonicalPath || !existsSync(legacyPath)) return;
  try {
    unlinkSync(legacyPath);
  } catch {
    // Best-effort: a locked or read-only leftover must not fail the write that
    // already succeeded.
  }
}

export function injectContextIntoMarkdownFile(
  filePath: string,
  contextContent: string,
  headerLine?: string,
): void {
  const parentDirectory = path.dirname(filePath);
  mkdirSync(parentDirectory, { recursive: true });

  // #2787: strip astral (surrogate-pair) code points so a Claude Code context
  // truncation can't split a pair into a lone surrogate and brick the session.
  const safeContent = toBmpSafe(contextContent);
  const wrappedContent = `${CONTEXT_TAG_OPEN}\n${safeContent}\n${CONTEXT_TAG_CLOSE}`;

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, 'utf-8');
    // Replaces a pre-rename block in place rather than appending a second one.
    const updated = upsertContextBlock(existing.trimEnd(), safeContent);
    writeFileSync(filePath, updated + '\n', 'utf-8');
  } else {
    if (headerLine) {
      writeFileSync(filePath, `${headerLine}\n\n${wrappedContent}\n`, 'utf-8');
    } else {
      writeFileSync(filePath, wrappedContent + '\n', 'utf-8');
    }
  }
}
