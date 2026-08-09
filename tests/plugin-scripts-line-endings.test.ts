import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const SCRIPTS_DIR = join(import.meta.dirname, '..', 'plugin', 'scripts');

// worker-cli.js was removed in 3.4.1: it was a checked-in build artefact from
// before the claude-mem fork that nothing rebuilt and nothing referenced. It
// still pointed at ~/.claude-mem, claude-mem.db and
// marketplaces/thedotmack/, so `worker-cli.js restart` failed with a path that
// has not existed since the rename. `npx keepmind restart` is the supported
// route. This test was the only thing keeping the file alive.
const SHEBANG_SCRIPTS = [
  'mcp-server.cjs',
  'worker-service.cjs',
  'context-generator.cjs',
  'bun-runner.js',
];

describe('plugin/scripts line endings (#1342)', () => {
  for (const filename of SHEBANG_SCRIPTS) {
    const filePath = join(SCRIPTS_DIR, filename);

    it(`${filename} shebang line must not contain CRLF`, () => {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'binary');
      const firstLine = content.split('\n')[0];
      expect(firstLine.endsWith('\r')).toBe(false);
    });

    it(`${filename} must not contain any CRLF sequences`, () => {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'binary');
      expect(content.includes('\r\n')).toBe(false);
    });
  }
});
