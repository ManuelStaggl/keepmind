import { describe, it, expect } from 'bun:test';
import { fileURLToPath } from 'node:url';

// `.pathname` yields `/C:/...` on Windows, which readFileSync then resolves to
// `C:\C:\...` (doubled drive). fileURLToPath produces a native path.
const mcpServerPath = fileURLToPath(new URL('../../src/servers/mcp-server.ts', import.meta.url));
const skillPath = fileURLToPath(new URL('../../plugin/skills/smart-explore/SKILL.md', import.meta.url));
const settingsPath = fileURLToPath(new URL('../../src/shared/SettingsDefaultsManager.ts', import.meta.url));

// Importing mcp-server.ts would run main() and attach a stdio transport, so
// these assert against the source text — the same approach as
// mcp-tool-schemas.test.ts, for the same reason.
async function toolsArraySource(): Promise<string> {
  const src = await Bun.file(mcpServerPath).text();
  const start = src.indexOf('const tools: ToolDefinition[] = [');
  const end = src.indexOf('const server = new Server(');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

/** Value of `field` declared by the descriptor for `name`, or null. */
function declared(arraySrc: string, name: string, field: string): string | null {
  const at = arraySrc.indexOf(`name: '${name}',`);
  if (at < 0) return null;
  const nextName = arraySrc.slice(at + 1).search(/^ {4}name: '/m);
  const body = nextName < 0 ? arraySrc.slice(at) : arraySrc.slice(at, at + 1 + nextName);
  const m = body.match(new RegExp(`^ {4}${field}: '([a-z]+)',`, 'm'));
  return m ? m[1] : null;
}

const SERVER_TOOLS = [
  'observation_add',
  'observation_record_event',
  'observation_search',
  'observation_context',
  'observation_generation_status',
  'memory_add',
  'memory_search',
  'memory_context',
];

const WORKER_CORE_TOOLS = [
  'search',
  'timeline',
  'get_observations',
  'session_start_context',
  'delete_observations_by_project',
  'save_checkpoint',
  'clear_checkpoint',
  // Lasting entries authored in-session. Worker-backed like every other write
  // to the local store, and deliberately NOT server-backed: the server path
  // enqueues generation, which is the one thing a curated entry must never
  // touch.
  'curated_add',
  'curated_edit',
  'curated_supersede',
  'curated_close',
  'curated_get',
];

const SMART_TOOLS = ['smart_search', 'smart_unfold', 'smart_outline'];

const CORPUS_TOOLS = [
  'build_corpus',
  'list_corpora',
  'prime_corpus',
  'query_corpus',
  'rebuild_corpus',
  'reprime_corpus',
];

describe('MCP tool runtime binding', () => {
  it('every tool declares exactly one runtime and one group', async () => {
    const arraySrc = await toolsArraySource();
    const names = arraySrc.match(/^ {4}name: '/gm) ?? [];
    const runtimes = arraySrc.match(/^ {4}runtime: '/gm) ?? [];
    const groups = arraySrc.match(/^ {4}group: '/gm) ?? [];
    expect(names.length).toBeGreaterThan(0);
    expect(runtimes.length).toBe(names.length);
    expect(groups.length).toBe(names.length);
  });

  it("server-backed tools are bound to runtime 'server'", async () => {
    const arraySrc = await toolsArraySource();
    for (const name of SERVER_TOOLS) {
      expect(declared(arraySrc, name, 'runtime')).toBe('server');
    }
  });

  it("worker-backed tools are bound to runtime 'worker'", async () => {
    const arraySrc = await toolsArraySource();
    for (const name of [...WORKER_CORE_TOOLS, ...CORPUS_TOOLS]) {
      expect(declared(arraySrc, name, 'runtime')).toBe('worker');
    }
  });

  it("tree-sitter tools need no backend ('any')", async () => {
    const arraySrc = await toolsArraySource();
    for (const name of SMART_TOOLS) {
      expect(declared(arraySrc, name, 'runtime')).toBe('any');
    }
  });

  it('the split covers every tool — no third bucket appears unnoticed', async () => {
    const arraySrc = await toolsArraySource();
    const declaredNames = [...arraySrc.matchAll(/^ {4}name: '([a-z_]+)',/gm)].map(m => m[1]);
    const classified = new Set([
      ...SERVER_TOOLS, ...WORKER_CORE_TOOLS, ...SMART_TOOLS, ...CORPUS_TOOLS,
    ]);
    expect(declaredNames.filter(n => !classified.has(n))).toEqual([]);
    expect(declaredNames.length).toBe(classified.size);
  });

  it('tools/list is filtered by runtime AND group', async () => {
    const src = await Bun.file(mcpServerPath).text();
    const handler = src.slice(
      src.indexOf('server.setRequestHandler(ListToolsRequestSchema'),
      src.indexOf('server.setRequestHandler(CallToolRequestSchema'),
    );
    expect(handler).toContain('selectRuntime()');
    expect(handler).toContain('enabledGroups()');
    expect(handler).toContain('toolsForRuntime(runtime, groups)');
    expect(handler).not.toContain('tools.map(');
  });

  it('CallTool dispatch is NOT filtered, so a stale client keeps the diagnostic error', async () => {
    const src = await Bun.file(mcpServerPath).text();
    const handler = src.slice(src.indexOf('server.setRequestHandler(CallToolRequestSchema'));
    expect(handler).toContain('tools.find(t => t.name === request.params.name)');
    expect(handler).not.toContain('toolsForRuntime');
    expect(handler).not.toContain('enabledGroups');
  });

  it("'any' survives the runtime filter in both modes; 'core' always survives the group filter", async () => {
    const src = await Bun.file(mcpServerPath).text();
    const fn = src.slice(
      src.indexOf('function enabledGroups('),
      src.indexOf('server.setRequestHandler(ListToolsRequestSchema'),
    );
    expect(fn).toContain("new Set<ToolGroup>(['core'])");
    expect(fn).toContain("tool.runtime === 'any'");
    expect(fn).toContain('groups.has(tool.group)');
  });
});

describe('MCP optional tool groups', () => {
  it('smart_* are grouped as smart, corpus tools as corpus', async () => {
    const arraySrc = await toolsArraySource();
    for (const name of SMART_TOOLS) expect(declared(arraySrc, name, 'group')).toBe('smart');
    for (const name of CORPUS_TOOLS) expect(declared(arraySrc, name, 'group')).toBe('corpus');
  });

  it('the memory core is never gated behind an optional group', async () => {
    const arraySrc = await toolsArraySource();
    for (const name of [...WORKER_CORE_TOOLS, ...SERVER_TOOLS]) {
      expect(declared(arraySrc, name, 'group')).toBe('core');
    }
  });

  it('both optional groups ship OFF by default', async () => {
    const src = await Bun.file(settingsPath).text();
    expect(src).toContain("KEEPMIND_MCP_SMART_TOOLS: 'false'");
    expect(src).toContain("KEEPMIND_MCP_CORPUS_TOOLS: 'false'");
  });

  it('only the literal string "true" switches a group on', async () => {
    const src = await Bun.file(mcpServerPath).text();
    const fn = src.slice(src.indexOf('function enabledGroups('), src.indexOf('function toolsForRuntime('));
    // Guards against '1'/'yes'/'on' quietly enabling a group, and against a
    // stray space or capital in settings.json silently doing nothing.
    expect(fn).toContain("=== 'true'");
    expect(fn).toContain('.trim().toLowerCase()');
  });
});

describe('smart-explore skill is coupled to its tools', () => {
  it('states the precondition before any instruction to call the tools', async () => {
    const skill = await Bun.file(skillPath).text();
    const precondition = skill.indexOf('If `smart_search` is not among your available tools');
    const firstInstruction = skill.indexOf('use smart_search/smart_outline/smart_unfold as your primary tools');
    expect(precondition).toBeGreaterThan(-1);
    // The skill must disqualify itself BEFORE it tells the reader to call
    // anything — otherwise it dangles exactly as it would with no check.
    expect(precondition).toBeLessThan(firstInstruction);
  });

  it('names the setting that registers the tools', async () => {
    const skill = await Bun.file(skillPath).text();
    expect(skill).toContain('KEEPMIND_MCP_SMART_TOOLS');
    // The frontmatter description is what a host shows when listing skills,
    // so the requirement has to be visible without opening the body.
    const frontmatter = skill.slice(0, skill.indexOf('---', 3));
    expect(frontmatter).toContain('KEEPMIND_MCP_SMART_TOOLS');
  });
});

describe('important_workflow was folded into search', () => {
  it('no longer exists as its own tool', async () => {
    const arraySrc = await toolsArraySource();
    expect(arraySrc).not.toContain("name: 'important_workflow'");
  });

  it('search carries the three-layer sequence it used to document', async () => {
    const arraySrc = await toolsArraySource();
    const at = arraySrc.indexOf("name: 'search',");
    const section = arraySrc.slice(at, arraySrc.indexOf("name: 'timeline',"));
    expect(section).toContain('timeline(anchor=ID)');
    expect(section).toContain('get_observations([IDs])');
    // The point of the sequence is the ordering rule, not the tool names.
    expect(section.toLowerCase()).toContain('never call get_observations without narrowing');
  });
});
