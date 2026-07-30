// SPDX-License-Identifier: Apache-2.0
//
// Regression guard for the 3.2.0 structural-search outage.
//
// 3.2.0 shipped a dependency tree with tree-sitter-cli's cli.js but no Rust
// executable (--ignore-scripts suppressed the download that provides it). Every
// language folded to zero symbols, and the report was indistinguishable from an
// unsupported or empty file. Nothing in the suite noticed, because nothing
// asserted that a real file in a shipped language actually produces symbols.
//
// So this test does exactly that: one fixture per core language, end to end
// through the real tree-sitter CLI and the real grammars, asserting symbols > 0.
// It would have been red for the whole of 3.2.0.

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { parseFile, isCoreLanguage, parseFilesBatch } from '../src/services/smart-file-read/parser.js';
import { resolveTreeSitterBin } from '../src/services/smart-file-read/treesitter-cli.js';

/** One minimal but realistic fixture per language keepmind ships a grammar for. */
const FIXTURES: Array<{ language: string; file: string; content: string; expect: string }> = [
  {
    language: 'javascript', file: 'sample.js', expect: 'greet',
    content: 'export function greet(name) {\n  return `hi ${name}`;\n}\n\nclass Greeter {\n  send() {}\n}\n',
  },
  {
    language: 'typescript', file: 'sample.ts', expect: 'AuditLogger',
    content: 'export interface AuditLogger {\n  write(line: string): void;\n}\n\nexport function createLogger(): AuditLogger {\n  return { write() {} };\n}\n',
  },
  {
    language: 'tsx', file: 'sample.tsx', expect: 'Panel',
    content: 'interface Props { title: string }\n\nexport function Panel(props: Props) {\n  return <div>{props.title}</div>;\n}\n',
  },
  {
    language: 'python', file: 'sample.py', expect: 'AuditLogger',
    content: 'class AuditLogger:\n    """Writes audit lines."""\n\n    def write(self, line):\n        pass\n\n\ndef build_logger():\n    return AuditLogger()\n',
  },
  {
    // The two languages the pre-3.2.0 report listed as missing.
    language: 'c_sharp', file: 'Sample.cs', expect: 'AuditLogger',
    content: 'namespace Demo;\n\npublic class AuditLogger\n{\n    public void Write(string line)\n    {\n    }\n}\n',
  },
  {
    language: 'powershell', file: 'sample.ps1', expect: 'Get-AuditLog',
    content: 'function Get-AuditLog {\n    param([string] $Path)\n    Get-Content $Path\n}\n',
  },
  {
    // XAML is XML; a WPF view layer is structurally unreadable without it.
    language: 'xml', file: 'Sample.xaml', expect: 'Window',
    content: '<Window x:Class="Demo.MainWindow">\n  <Grid>\n    <Button Content="Go" />\n  </Grid>\n</Window>\n',
  },
  {
    language: 'markdown', file: 'sample.md', expect: 'Overview',
    content: '# Overview\n\nSome prose.\n\n## Details\n\nMore prose.\n',
  },
  {
    language: 'yaml', file: 'sample.yml', expect: 'services',
    content: 'services:\n  web:\n    image: nginx\n',
  },
  {
    language: 'toml', file: 'sample.toml', expect: 'package',
    content: '[package]\nname = "demo"\n\n[dependencies]\nserde = "1"\n',
  },
  {
    language: 'css', file: 'sample.css', expect: '.panel',
    content: '.panel {\n  color: red;\n}\n\n.panel-title {\n  font-weight: bold;\n}\n',
  },
  {
    language: 'bash', file: 'sample.sh', expect: 'run_audit',
    content: '#!/usr/bin/env bash\n\nrun_audit() {\n  echo "auditing"\n}\n',
  },
];

let workDir: string;

/**
 * Distinguish "this checkout was never built" from "the shipped tree is broken".
 * A missing tree-sitter-cli PACKAGE means no dependency tree exists yet, which is
 * not what this test is about. A package WITHOUT its executable is precisely the
 * 3.2.0 regression and must fail loudly.
 */
const bin = resolveTreeSitterBin();
const treeUnbuilt = bin.status === 'no-package';

describe('core-language folding (end to end)', () => {
  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), 'keepmind-core-lang-'));
    for (const fixture of FIXTURES) {
      writeFileSync(join(workDir, fixture.file), fixture.content);
    }
  });

  afterAll(() => {
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('has a tree-sitter executable available', () => {
    if (treeUnbuilt) {
      console.warn('SKIP: no tree-sitter-cli package — run `npm run build-and-sync` first.');
      return;
    }
    // The 3.2.0 failure state lands here: package present, executable absent.
    expect(bin.status).toBe('ok');
  });

  // Deliberately separate from the check above, and deliberately NOT going
  // through resolveTreeSitterBin: that function also accepts a tree-sitter on
  // PATH, which is correct at runtime but useless as a regression guard. `npx`
  // puts node_modules/.bin on PATH, so a dev-tree binary would have kept this
  // suite green through the entire 3.2.0 outage — the exact way the regression
  // escaped. This asserts the SHIPPED tree carries its own executable.
  it('ships the tree-sitter executable inside the installed dependency tree', () => {
    const depsRoot = process.env.KEEPMIND_NODE_MODULES
      ?? join(homedir(), '.claude', 'plugins', 'data', 'keepmind-keepmind');
    const packageDir = join(depsRoot, 'node_modules', 'tree-sitter-cli');

    if (!existsSync(packageDir)) {
      console.warn(`SKIP: no installed dependency tree at ${packageDir}.`);
      return;
    }

    const executable = join(packageDir, process.platform === 'win32' ? 'tree-sitter.exe' : 'tree-sitter');
    // Red for all of 3.2.0: --ignore-scripts suppressed the download that
    // provides this file, and nothing else put it there.
    expect({ executable, present: existsSync(executable) })
      .toEqual({ executable, present: true });
  });

  it('covers every language declared as core', () => {
    const covered = new Set(FIXTURES.map((f) => f.language));
    const uncovered = [...covered].filter((lang) => !isCoreLanguage(lang));
    // Guards the inverse mistake: a fixture for a language no longer shipped.
    expect(uncovered).toEqual([]);
  });

  for (const fixture of FIXTURES) {
    it(`folds ${fixture.language} into symbols`, () => {
      if (treeUnbuilt) return;

      const parsed = parseFile(fixture.content, join(workDir, fixture.file), workDir);

      // A failure reason means folding never happened — report which, because
      // "0 symbols" alone is what made the outage invisible for a full day.
      expect(parsed.unavailable).toBeUndefined();
      expect(parsed.language).toBe(fixture.language);
      expect(parsed.symbols.length).toBeGreaterThan(0);

      const names = JSON.stringify(parsed.symbols);
      expect(names).toContain(fixture.expect);
    });
  }

  it('folds every core language through the batch path too', () => {
    if (treeUnbuilt) return;

    // smart_search and learn-codebase use parseFilesBatch, not parseFile — the
    // path that reported "Scanned 1805 files, found 0 symbols".
    const results = parseFilesBatch(
      FIXTURES.map((f) => ({
        absolutePath: join(workDir, f.file),
        relativePath: f.file,
        content: f.content,
      })),
      workDir,
    );

    const empty = FIXTURES
      .filter((f) => (results.get(f.file)?.symbols.length ?? 0) === 0)
      .map((f) => `${f.language} (${results.get(f.file)?.unavailable ?? 'no symbols'})`);
    expect(empty).toEqual([]);
  });
});
