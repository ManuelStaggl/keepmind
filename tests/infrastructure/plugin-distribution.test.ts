import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildShellCommand } from '../../src/build/hook-shell-template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');

function readJson(relativePath: string): any {
  return JSON.parse(readFileSync(path.join(projectRoot, relativePath), 'utf-8'));
}

function commandHooksFrom(relativePath: string): string[] {
  const parsed = readJson(relativePath);
  return Object.values(parsed.hooks ?? {}).flatMap((matchers: any) =>
    matchers.flatMap((matcher: any) =>
      (matcher.hooks ?? [])
        .filter((hook: any) => hook.type === 'command')
        .map((hook: any) => String(hook.command ?? ''))
    )
  );
}

function mcpStartupCommandFrom(relativePath: string): string {
  const parsed = readJson(relativePath);
  return parsed.mcpServers['mcp-search'].args[1];
}

describe('Plugin Distribution - Skills', () => {
  const skillPath = path.join(projectRoot, 'plugin/skills/mem-search/SKILL.md');

  it('should include plugin/skills/mem-search/SKILL.md', () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it('should have valid YAML frontmatter with name and description', () => {
    const content = readFileSync(skillPath, 'utf-8');

    expect(content.startsWith('---\n')).toBe(true);

    const frontmatterEnd = content.indexOf('\n---\n', 4);
    expect(frontmatterEnd).toBeGreaterThan(0);

    const frontmatter = content.slice(4, frontmatterEnd);
    expect(frontmatter).toContain('name:');
    expect(frontmatter).toContain('description:');
  });

  it('should reference the 3-layer search workflow', () => {
    const content = readFileSync(skillPath, 'utf-8');
    expect(content).toContain('search');
    expect(content).toContain('timeline');
    expect(content).toContain('get_observations');
  });
});

describe('Plugin Distribution - Required Files', () => {
  const requiredFiles = [
    'plugin/hooks/hooks.json',
    'plugin/hooks/codex-hooks.json',
    'plugin/.claude-plugin/plugin.json',
    'plugin/.codex-plugin/plugin.json',
    'plugin/.mcp.json',
    'plugin/skills/mem-search/SKILL.md',
    '.agents/plugins/marketplace.json',
  ];

  for (const filePath of requiredFiles) {
    it(`should include ${filePath}`, () => {
      const fullPath = path.join(projectRoot, filePath);
      expect(existsSync(fullPath)).toBe(true);
    });
  }
});

describe('Plugin Distribution - Codex Marketplace', () => {
  it('points Codex at the bundled plugin root', () => {
    const marketplacePath = path.join(projectRoot, '.agents/plugins/marketplace.json');
    const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf-8'));

    expect(marketplace.plugins[0].source.path).toBe('./plugin');
  });

  it('registers the plugin id this package actually ships', () => {
    // The installer enabled `claude-mem@claude-mem-local` for a while, which
    // matched neither the marketplace nor the plugin in marketplace.json — so
    // Codex was told to enable something that does not exist. Derive the
    // expected id from the shipped manifest rather than restating it.
    const marketplace = readJson('.agents/plugins/marketplace.json');
    const expectedId = `${marketplace.plugins[0].name}@${marketplace.name}`;

    const installerSource = readFileSync(
      path.join(projectRoot, 'src/services/integrations/CodexCliInstaller.ts'),
      'utf-8'
    );
    const marketplaceName = installerSource.match(/const MARKETPLACE_NAME = '([^']+)'/)?.[1];
    const pluginPrefix = installerSource.match(/const CODEX_PLUGIN_ID = `([^@]+)@/)?.[1];

    expect(`${pluginPrefix}@${marketplaceName}`).toBe(expectedId);
  });

  it('ships Codex hooks with only Codex-supported root keys', () => {
    const codexHooks = readJson('plugin/hooks/codex-hooks.json');
    expect(Object.keys(codexHooks).sort()).toEqual(['hooks']);
  });

  it('sets the Codex hook marker on every Codex command', () => {
    for (const command of commandHooksFrom('plugin/hooks/codex-hooks.json')) {
      expect(command).toContain('KEEPMIND_CODEX_HOOK=1');
    }
  });

  it('ships a single Claude Code SessionStart command (perf plan P3)', () => {
    const hooks = readJson('plugin/hooks/hooks.json');
    expect(hooks.hooks.SessionStart).toHaveLength(1);
    expect(hooks.hooks.SessionStart[0].hooks).toHaveLength(1);
  });

  it('ships a single Codex SessionStart command', () => {
    const codexHooks = readJson('plugin/hooks/codex-hooks.json');
    expect(codexHooks.hooks.SessionStart[0].hooks).toHaveLength(1);
  });

  it('MCP launcher can recover without plugin root environment variables', () => {
    const mcpPath = path.join(projectRoot, 'plugin/.mcp.json');
    const mcp = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    const command = mcp.mcpServers['mcp-search'].args.join(' ');

    expect(command).toContain('.codex/plugins/cache/keepmind-local/keepmind');
    expect(command).toContain('plugins/cache/keepmind/keepmind');
    expect(command).toContain('keepmind: mcp server not found');
  });
});

describe('Plugin Distribution - hooks.json Integrity', () => {
  it('should have valid JSON in hooks.json', () => {
    const hooksPath = path.join(projectRoot, 'plugin/hooks/hooks.json');
    const content = readFileSync(hooksPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.hooks).toBeDefined();
  });

  it('should reference CLAUDE_PLUGIN_ROOT in all hook commands', () => {
    for (const command of commandHooksFrom('plugin/hooks/hooks.json')) {
      expect(command).toContain('CLAUDE_PLUGIN_ROOT');
    }
  });

  it('should include CLAUDE_PLUGIN_ROOT fallback in all hook commands (#1215)', () => {
    const expectedFallbackPath = '$_C/plugins/marketplaces/keepmind/plugin';

    for (const command of commandHooksFrom('plugin/hooks/hooks.json')) {
      expect(command).toContain(expectedFallbackPath);
    }
  });

  it('should try cache path before marketplaces fallback in all hook commands (#1533)', () => {
    const cachePath = '$_C/plugins/cache/keepmind/keepmind';
    const marketplacesPath = '$_C/plugins/marketplaces/keepmind/plugin';

    for (const command of commandHooksFrom('plugin/hooks/hooks.json')) {
      expect(command).toContain(cachePath);
      expect(command.indexOf(cachePath)).toBeLessThan(command.indexOf(marketplacesPath));
    }
  });
});

describe('Plugin Distribution - Startup Root Resolution', () => {
  it('MCP startup command resolves the plugin root cross-platform (#2792)', () => {
    // The launcher is now a cross-platform `node -e` payload (no `sh`), so it
    // spawns on Windows without Git Bash. It must still resolve the plugin root
    // with config-dir + env fallbacks and try cache roots before marketplaces.
    const command = mcpStartupCommandFrom('plugin/.mcp.json');

    expect(command).toContain('CLAUDE_CONFIG_DIR');
    expect(command).toContain('.claude');
    expect(command).toContain('CLAUDE_PLUGIN_ROOT');
    expect(command).toContain('PLUGIN_ROOT');
    expect(command).toContain('plugins/marketplaces/keepmind/plugin');
    expect(command).toContain('plugins/cache/keepmind/keepmind');
    expect(command).toContain('mcp-server.cjs');
    // No bare absolute "/scripts/..." path leaks through.
    expect(command).not.toContain('"/scripts/mcp-server.cjs"');
    expect(command.indexOf('plugins/cache/keepmind/keepmind')).toBeLessThan(
      command.indexOf('plugins/marketplaces/keepmind/plugin')
    );
  });

  it('Codex hook commands should have config-dir based non-empty fallbacks', () => {
    for (const command of commandHooksFrom('plugin/hooks/codex-hooks.json')) {
      expect(command).toContain('${CLAUDE_CONFIG_DIR:-$HOME/.claude}');
      expect(command).toContain('export PATH=');
      expect(command).toContain('while IFS= read -r _R');
      expect(command).toContain('$_C/plugins/marketplaces/keepmind/plugin');
      expect(command).toContain('$_C/plugins/cache/keepmind/keepmind');
      expect(command).toContain('[ -f "$_Q/scripts/');
      expect(command).toContain('command -v cygpath');
      expect(command.indexOf('$_C/plugins/cache/keepmind/keepmind')).toBeLessThan(
        command.indexOf('$_C/plugins/marketplaces/keepmind/plugin')
      );
    }
  });

  it('Claude hook commands should have config-dir based non-empty fallbacks', () => {
    for (const command of commandHooksFrom('plugin/hooks/hooks.json')) {
      expect(command).toContain('${CLAUDE_CONFIG_DIR:-$HOME/.claude}');
      expect(command).toContain('while IFS= read -r _R');
      expect(command).toContain('$_C/plugins/marketplaces/keepmind/plugin');
      expect(command).toContain('$_C/plugins/cache/keepmind/keepmind');
      expect(command).toContain('[ -f "$_Q/scripts/');
      expect(command).not.toContain('$HOME/.claude/plugins/');
    }
  });
});

describe('Plugin Distribution - package.json Files Field', () => {
  it('should include bundled plugin entries in root package.json files field', () => {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    expect(packageJson.files).toBeDefined();
    expect(packageJson.files).toContain('plugin/.codex-plugin');
    expect(packageJson.files).toContain('plugin/.mcp.json');
    expect(packageJson.files).toContain('plugin/hooks');
    expect(packageJson.files).toContain('plugin/skills');
    expect(packageJson.files).toContain('plugin/scripts/*.cjs');
  });
});

describe('Plugin Distribution - Build Script Verification', () => {
  it('should verify distribution files in build-hooks.js', () => {
    const buildScriptPath = path.join(projectRoot, 'scripts/build-hooks.js');
    const content = readFileSync(buildScriptPath, 'utf-8');

    expect(content).toContain('plugin/skills/mem-search/SKILL.md');
    expect(content).toContain('plugin/hooks/hooks.json');
    expect(content).toContain('plugin/.claude-plugin/plugin.json');
  });
});

describe('Plugin Distribution - Setup Hook (#1547)', () => {
  it('should not reference removed setup.sh in Setup hook', () => {
    const hooksPath = path.join(projectRoot, 'plugin/hooks/hooks.json');
    const content = readFileSync(hooksPath, 'utf-8');
    expect(content).not.toContain('setup.sh');
  });

  it('should call version-check.js in the Setup hook', () => {
    const hooksPath = path.join(projectRoot, 'plugin/hooks/hooks.json');
    const parsed = JSON.parse(readFileSync(hooksPath, 'utf-8'));
    const setupHooks: any[] = parsed.hooks['Setup'] ?? [];

    const commandHooks = setupHooks.flatMap((matcher: any) =>
      (matcher.hooks ?? []).filter((h: any) => h.type === 'command')
    );

    expect(commandHooks.length).toBeGreaterThan(0);

    const versionCheckHooks = commandHooks.filter((h: any) =>
      h.command?.includes('version-check.js')
    );
    expect(versionCheckHooks.length).toBeGreaterThan(0);
  });

  it('version-check.js referenced by Setup hook should exist on disk', () => {
    const versionCheckPath = path.join(projectRoot, 'plugin/scripts/version-check.js');
    expect(existsSync(versionCheckPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spawn-contract templating (plans/02-spawn-contract-templating.md)
// ---------------------------------------------------------------------------

const ccTrailing = (...tail: string[]) => [
  'node', '"$_P/scripts/bun-runner.js"', '"$_P/scripts/worker-service.cjs"', ...tail,
];
const claudeHook = (tail: string[], extra: Record<string, unknown> = {}) => buildShellCommand({
  host: 'claude-code', requireFile: 'bun-runner.js', requireFileSecondary: 'worker-service.cjs',
  trailingCommand: ccTrailing(...tail), notFoundMessage: 'keepmind: plugin scripts not found', ...extra,
});
const codexHook = (tail: string[]) => buildShellCommand({
  host: 'codex-cli', requireFile: 'bun-runner.js', requireFileSecondary: 'worker-service.cjs',
  trailingCommand: ccTrailing(...tail), notFoundMessage: 'keepmind: plugin scripts not found',
  extraEnv: { KEEPMIND_CODEX_HOOK: '1' },
});
const codexStartupHook = () => buildShellCommand({
  host: 'codex-cli', requireFile: 'bun-runner.js', requireFileSecondary: 'worker-service.cjs',
  trailingCommand: [
    '_V=$(KEEPMIND_CODEX_HOOK=1 node "$_P/scripts/version-check.js" || true);',
    'if [ -n "$_V" ]; then printf \'%s\\n\' "$_V"; else',
    'KEEPMIND_CODEX_HOOK=1', ...ccTrailing('hook', 'codex', 'context'),
    '; fi',
  ],
  notFoundMessage: 'keepmind: plugin scripts not found',
});

const RULE_A_EXPECTATIONS: Record<string, Record<string, string>> = {
  'plugin/hooks/hooks.json': {
    'Setup.0.0': buildShellCommand({
      host: 'claude-code-setup', requireFile: 'version-check.js',
      trailingCommand: ['node', '"$_P/scripts/version-check.js"'],
      notFoundMessage: 'keepmind: version-check.js not found',
    }),
    // ONE SessionStart hook (perf plan P3). It was three: `start`, `context` and
    // `session-acquire`, i.e. three Node cold starts. `start` was redundant —
    // every hook already calls ensureWorkerStarted() — and the other two are
    // bundled by the `session-start` handler.
    'SessionStart.0.0': claudeHook(['hook', 'claude-code', 'session-start']),
    'UserPromptSubmit.0.0': claudeHook(['hook', 'claude-code', 'session-init']),
    'PostToolUse.0.0': claudeHook(['hook', 'claude-code', 'observation']),
    'PreToolUse.0.0': claudeHook(['hook', 'claude-code', 'file-context']),
    'Stop.0.0': claudeHook(['hook', 'claude-code', 'summarize']),
  },
  'plugin/hooks/codex-hooks.json': {
    'SessionStart.0.0': codexStartupHook(),
    'UserPromptSubmit.0.0': codexHook(['hook', 'codex', 'session-init']),
    'PreToolUse.0.0': codexHook(['hook', 'codex', 'file-context']),
    'PostToolUse.0.0': codexHook(['hook', 'codex', 'observation']),
    'Stop.0.0': codexHook(['hook', 'codex', 'summarize']),
  },
};

const MCP_EXPECTED = buildShellCommand({
  // The mcp Node launcher derives its spawn target from requireFile; it ignores
  // trailingCommand, so none is passed (see buildMcpNodeLauncher).
  host: 'mcp', requireFile: 'mcp-server.cjs',
  notFoundMessage: 'keepmind: mcp server not found',
  mcpExtraCandidates: ['$PWD/plugin', '$PWD'],
  mcpExtraCacheRoots: [
    '$HOME/.codex/plugins/cache/keepmind-local/keepmind',
    '$HOME/.codex/plugins/cache/keepmind/keepmind',
  ],
});

function hookCommandByPath(parsed: any, dottedPath: string): string | null {
  const [event, groupIdx, hookIdx] = dottedPath.split('.');
  return parsed.hooks?.[event]?.[Number(groupIdx)]?.hooks?.[Number(hookIdx)]?.command ?? null;
}

describe('Spawn-Contract Templating - Rule A generator parity', () => {
  for (const [filePath, commands] of Object.entries(RULE_A_EXPECTATIONS)) {
    for (const [dottedPath, expected] of Object.entries(commands)) {
      it(`${filePath} [${dottedPath}] equals buildShellCommand output`, () => {
        const parsed = readJson(filePath);
        const actual = hookCommandByPath(parsed, dottedPath);
        expect(actual).toBe(expected);
      });
    }
  }

  it('plugin/.mcp.json mcp-search command equals buildShellCommand output', () => {
    const parsed = readJson('plugin/.mcp.json');
    expect(parsed.mcpServers['mcp-search'].args[1]).toBe(MCP_EXPECTED);
  });

  it('never leaks a raw ${CLAUDE_PLUGIN_ROOT} into the resolved trailing command', () => {
    // The placeholder may appear only inside the _E="${CLAUDE_PLUGIN_ROOT:-...}"
    // expansion, never as a bare `${CLAUDE_PLUGIN_ROOT}` token that would reach
    // the binary unsubstituted.
    const shCommands = Object.values(RULE_A_EXPECTATIONS).flatMap((c) => Object.values(c));
    for (const command of shCommands) {
      expect(command).not.toMatch(/\$\{CLAUDE_PLUGIN_ROOT\}(?!:-)/);
      expect(command).toContain('_E="${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-}}"');
    }
    // The MCP node launcher reads env vars directly — it has no `${...}` shell
    // tokens at all, so a raw placeholder can never reach the binary.
    expect(MCP_EXPECTED).not.toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(MCP_EXPECTED).toContain('process.env.CLAUDE_PLUGIN_ROOT');
    expect(MCP_EXPECTED).toContain('process.env.PLUGIN_ROOT');
  });
});

describe('Spawn-Contract Templating - Rule A shell resolution matrix', () => {
  // Actually shell-evaluate the generated commands across resolution sources:
  // (a) CLAUDE_PLUGIN_ROOT injected, (b) cache fallback hit, (c) all miss.
  // Replace the trailing exec with `echo "_P=$_P"` so we observe the resolved
  // root without launching node.
  function instrument(command: string): string {
    // Strip everything from the resolved-root guard onward, keep the resolution
    // pipeline, then print _P. We cut at the cygpath clause / trailing command
    // by replacing the not-found guard's exit with a print of _P.
    const cut = command.indexOf('[ -n "$_P" ]');
    const resolution = cut >= 0 ? command.slice(0, cut) : command;
    return `${resolution} echo "RESOLVED=$_P"`;
  }

  // On Windows, `bash` on PATH is WSL's bash — a separate Linux filesystem that
  // never sees the Windows temp HOME these tests build, and on a machine with a
  // stale WSL it fails with an update notice before running anything. Claude Code
  // itself runs hooks through Git Bash (hence CLAUDE_CODE_GIT_BASH_PATH surviving
  // env sanitization), so resolve the same shell here. null = no POSIX bash.
  const POSIX_BASH: string | null = (() => {
    if (process.platform !== 'win32') return 'bash';
    const candidates = [
      process.env.CLAUDE_CODE_GIT_BASH_PATH,
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ].filter((p): p is string => Boolean(p));
    return candidates.find((p) => existsSync(p)) ?? null;
  })();

  function shellEval(command: string, env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(POSIX_BASH ?? 'bash', ['-c', command], {
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf-8',
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  }

  const claudeCommands = () => {
    const parsed = readJson('plugin/hooks/hooks.json');
    return Object.entries(RULE_A_EXPECTATIONS['plugin/hooks/hooks.json']).map(
      ([dottedPath]) => ({ dottedPath, command: hookCommandByPath(parsed, dottedPath)! })
    );
  };

  it('resolves _P from CLAUDE_PLUGIN_ROOT when the env var points at a valid root', () => {
    // reason: non-hermetic on Windows — the resolved root is a Node-native
    // Windows path (backslashes + an 8.3 short name like ADMINI~1). Feeding it
    // through MSYS `bash`'s `[ -f "$_Q/scripts/version-check.js" ]` test does
    // not stat reliably, so `_P` resolves empty. The generated command's
    // correctness is fully covered on Windows by the static Rule A/B
    // expectation tests above; this live-eval variant validates real
    // resolution on POSIX. Same class as the cache variant guarded below.
    if (process.platform === 'win32') return;
    const root = mkdtempSync(path.join(tmpdir(), 'cm-root-'));
    mkdirSync(path.join(root, 'scripts'), { recursive: true });
    writeFileSync(path.join(root, 'scripts', 'version-check.js'), '');
    writeFileSync(path.join(root, 'scripts', 'bun-runner.js'), '');
    writeFileSync(path.join(root, 'scripts', 'worker-service.cjs'), '');
    try {
      for (const { command } of claudeCommands()) {
        const { stdout } = shellEval(instrument(command), {
          CLAUDE_PLUGIN_ROOT: root,
          HOME: mkdtempSync(path.join(tmpdir(), 'cm-home-')),
        });
        expect(stdout).toContain(`RESOLVED=${root}`);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves _P from the cache directory when CLAUDE_PLUGIN_ROOT is unset', () => {
    // reason: non-hermetic on Windows — this variant flows the temp path through
    // MSYS `bash`'s `ls -dt`, which emits a POSIX path (/tmp/...) that can't be
    // string-matched against Node's native Windows path. The generated command
    // is verified correct by the env-var and fail-cleanly variants (which don't
    // depend on bash path translation). Runs normally on POSIX.
    if (process.platform === 'win32') return;
    const home = mkdtempSync(path.join(tmpdir(), 'cm-home-'));
    const cacheRoot = path.join(home, '.claude', 'plugins', 'cache', 'keepmind', 'keepmind', '99.0.0');
    mkdirSync(path.join(cacheRoot, 'scripts'), { recursive: true });
    writeFileSync(path.join(cacheRoot, 'scripts', 'version-check.js'), '');
    writeFileSync(path.join(cacheRoot, 'scripts', 'bun-runner.js'), '');
    writeFileSync(path.join(cacheRoot, 'scripts', 'worker-service.cjs'), '');
    try {
      for (const { command } of claudeCommands()) {
        const { stdout } = shellEval(instrument(command), { HOME: home });
        // ls -dt yields a trailing slash; the hook trims it via _R="${_R%/}".
        expect(stdout).toContain(`RESOLVED=${cacheRoot}`);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('fails cleanly with the canonical not-found message when no candidate exists', () => {
    // Unlike the two variants above this one needs no path translation — it only
    // asserts the guard's error — so it runs on Windows too, provided a POSIX
    // bash exists.
    if (!POSIX_BASH) return;
    const home = mkdtempSync(path.join(tmpdir(), 'cm-empty-'));
    try {
      const parsed = readJson('plugin/hooks/hooks.json');
      const command = hookCommandByPath(parsed, 'UserPromptSubmit.0.0')!;
      const result = spawnSync(POSIX_BASH, ['-c', command], {
        env: { PATH: process.env.PATH ?? '', HOME: home },
        encoding: 'utf-8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr ?? '').toMatch(/keepmind: .* not found/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('Spawn-Contract Templating - Rule B installers bake absolute paths', () => {
  const installerFiles = [
    'src/services/integrations/CursorHooksInstaller.ts',
    'src/services/integrations/WindsurfHooksInstaller.ts',
    'src/services/integrations/GeminiCliHooksInstaller.ts',
    'src/services/integrations/McpIntegrations.ts',
  ];

  for (const file of installerFiles) {
    it(`${file} emits no raw \${CLAUDE_PLUGIN_ROOT} placeholder`, () => {
      const content = readFileSync(path.join(projectRoot, file), 'utf-8');
      expect(content).not.toMatch(/\$\{CLAUDE_PLUGIN_ROOT\}/);
    });
  }

  it('install-paths.ts centralizes the Rule B helpers', () => {
    const content = readFileSync(
      path.join(projectRoot, 'src/services/integrations/install-paths.ts'),
      'utf-8',
    );
    for (const name of [
      'getMcpServerAbsolutePath',
      'getWorkerServiceAbsolutePath',
      'getBunAbsolutePath',
      'getNodeAbsolutePath',
      'getPluginRootAbsolutePath',
    ]) {
      expect(content).toContain(`export function ${name}`);
    }
  });
});
