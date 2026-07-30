
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { logger } from "../../utils/logger.js";
import { resolveOnDemandGrammar, requestGrammarInstall } from "./grammar-installer.js";
import { resolveTreeSitterBin, requestTreeSitterCliInstall } from "./treesitter-cli.js";
// Grammars resolve through plugin-node-modules rather than a bundle-relative
// createRequire: the tree now lives in the plugin data directory, which survives
// the host restoring the plugin root from git. The separate on-demand chain via
// grammar-installer (~/.keepmind/grammars) is untouched — it is its own concern
// and already lives outside the plugin root.
import { pluginResolve } from "../../shared/plugin-node-modules.js";

export interface CodeSymbol {
  name: string;
  kind: "function" | "class" | "method" | "interface" | "type" | "const" | "variable" | "export" | "struct" | "enum" | "trait" | "impl" | "property" | "getter" | "setter" | "mixin" | "section" | "code" | "metadata" | "reference";
  signature: string;
  jsdoc?: string;
  lineStart: number;
  lineEnd: number;
  parent?: string;
  exported: boolean;
  children?: CodeSymbol[];
}

/**
 * Why a file yielded no symbols. Absent means the parse actually ran: zero
 * symbols then means the file genuinely has none.
 *
 * This distinction is the point. Before it, a missing parser, a missing grammar
 * and an unreadable file were all reported as "unsupported language or empty",
 * which is why structural search could be completely inert for a day without
 * being distinguishable from a file that simply has nothing to fold.
 */
export type FoldFailure =
  /** The extension maps to no known language, and no user grammar covers it. */
  | "unknown-language"
  /** Language known, grammar not on disk. A fetch was requested for next time. */
  | "no-grammar"
  /** The tree-sitter CLI executable is missing — affects EVERY language. */
  | "no-parser"
  /** The parser ran and failed on this input. */
  | "query-failed";

export interface FoldedFile {
  filePath: string;
  language: string;
  symbols: CodeSymbol[];
  imports: string[];
  totalLines: number;
  foldedTokenEstimate: number;
  /** Set only when folding could not be performed; see FoldFailure. */
  unavailable?: FoldFailure;
}

const LANG_MAP: Record<string, string> = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "tsx",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
  ".pyw": "python",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".cs": "c_sharp",
  ".csx": "c_sharp",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".psd1": "powershell",
  // XAML is XML. Without this, a WPF/Avalonia project's entire view layer is
  // structurally unreadable — .xaml was the third-largest source extension in
  // the install that surfaced this.
  ".xml": "xml",
  ".xaml": "xml",
  ".axaml": "xml",
  ".csproj": "xml",
  ".props": "xml",
  ".targets": "xml",
  ".resx": "xml",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".php": "php",
  ".ex": "elixir",
  ".exs": "elixir",
  ".lua": "lua",
  ".scala": "scala",
  ".sc": "scala",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".hs": "haskell",
  ".zig": "zig",
  ".css": "css",
  ".scss": "scss",
  ".toml": "toml",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".sql": "sql",
  ".md": "markdown",
  ".mdx": "markdown",
};

function detectLanguageWithUserGrammars(filePath: string, userConfig: UserGrammarConfig): string {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  if (LANG_MAP[ext]) return LANG_MAP[ext];
  if (userConfig.extensionToLanguage[ext]) return userConfig.extensionToLanguage[ext];
  return "unknown";
}

function getUserAwareQueryKey(language: string, userConfig: UserGrammarConfig): string {
  if (userConfig.languageToQueryKey[language]) {
    return userConfig.languageToQueryKey[language];
  }
  return getQueryKey(language);
}

export interface UserGrammarEntry {
  package: string;
  extensions: string[];
  query?: string;
}

export interface UserGrammarConfig {
  grammars: Record<string, UserGrammarEntry>;
  extensionToLanguage: Record<string, string>;
  languageToQueryKey: Record<string, string>;
}

const userGrammarCache = new Map<string, UserGrammarConfig>();

const EMPTY_USER_GRAMMAR_CONFIG: UserGrammarConfig = {
  grammars: {},
  extensionToLanguage: {},
  languageToQueryKey: {},
};

// Per-project config filenames, canonical first. `.claude-mem.json` is honored
// as a fallback so existing per-project grammar configs keep working post-rename.
const PROJECT_CONFIG_NAMES = [".keepmind.json", ".claude-mem.json"] as const;

export function loadUserGrammars(projectRoot: string): UserGrammarConfig {
  if (userGrammarCache.has(projectRoot)) return userGrammarCache.get(projectRoot)!;

  let content: string | undefined;
  for (const name of PROJECT_CONFIG_NAMES) {
    try {
      content = readFileSync(join(projectRoot, name), "utf-8");
      break;
    } catch {
      // try next candidate
    }
  }

  let rawConfig: Record<string, unknown>;
  try {
    if (content === undefined) throw new Error("no project config");
    rawConfig = JSON.parse(content);
  } catch {
    userGrammarCache.set(projectRoot, EMPTY_USER_GRAMMAR_CONFIG);
    return EMPTY_USER_GRAMMAR_CONFIG;
  }

  const grammarsRaw = rawConfig.grammars;
  if (!grammarsRaw || typeof grammarsRaw !== "object" || Array.isArray(grammarsRaw)) {
    userGrammarCache.set(projectRoot, EMPTY_USER_GRAMMAR_CONFIG);
    return EMPTY_USER_GRAMMAR_CONFIG;
  }

  const config: UserGrammarConfig = {
    grammars: {},
    extensionToLanguage: {},
    languageToQueryKey: {},
  };

  for (const [language, entry] of Object.entries(grammarsRaw as Record<string, unknown>)) {
    if (GRAMMAR_PACKAGES[language]) continue;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typedEntry = entry as Record<string, unknown>;

    const pkg = typedEntry.package;
    const extensions = typedEntry.extensions;
    const queryPath = typedEntry.query;

    if (typeof pkg !== "string" || !Array.isArray(extensions)) continue;
    if (!extensions.every((e: unknown) => typeof e === "string")) continue;

    config.grammars[language] = {
      package: pkg,
      extensions: extensions as string[],
      query: typeof queryPath === "string" ? queryPath : undefined,
    };

    for (const ext of extensions as string[]) {
      if (!LANG_MAP[ext]) {
        config.extensionToLanguage[ext] = language;
      }
    }

    if (typeof queryPath === "string") {
      const fullQueryPath = join(projectRoot, queryPath);
      try {
        const queryContent = readFileSync(fullQueryPath, "utf-8");
        const queryKey = `user_${language}`;
        QUERIES[queryKey] = queryContent;
        config.languageToQueryKey[language] = queryKey;
      } catch {
        logger.warn('PARSER', 'Custom query file not found, falling back to generic', { fullQueryPath });
        config.languageToQueryKey[language] = "generic";
      }
    } else {
      config.languageToQueryKey[language] = "generic";
    }
  }

  userGrammarCache.set(projectRoot, config);
  return config;
}

const GRAMMAR_PACKAGES: Record<string, string> = {
  c_sharp: "tree-sitter-c-sharp",
  powershell: "tree-sitter-powershell",
  xml: "@tree-sitter-grammars/tree-sitter-xml",
  javascript: "tree-sitter-javascript",
  typescript: "tree-sitter-typescript/typescript",
  tsx: "tree-sitter-typescript/tsx",
  python: "tree-sitter-python",
  go: "tree-sitter-go",
  rust: "tree-sitter-rust",
  ruby: "tree-sitter-ruby",
  java: "tree-sitter-java",
  c: "tree-sitter-c",
  cpp: "tree-sitter-cpp",
  kotlin: "tree-sitter-kotlin",
  swift: "tree-sitter-swift",
  php: "tree-sitter-php/php",
  elixir: "tree-sitter-elixir",
  lua: "@tree-sitter-grammars/tree-sitter-lua",
  scala: "tree-sitter-scala",
  bash: "tree-sitter-bash",
  haskell: "tree-sitter-haskell",
  zig: "@tree-sitter-grammars/tree-sitter-zig",
  css: "tree-sitter-css",
  scss: "tree-sitter-scss",
  toml: "@tree-sitter-grammars/tree-sitter-toml",
  yaml: "@tree-sitter-grammars/tree-sitter-yaml",
  sql: "@derekstride/tree-sitter-sql",
  markdown: "@tree-sitter-grammars/tree-sitter-markdown",
};

// Packages that ship several grammars side by side; the language lives in a
// subdirectory rather than at the package root.
const GRAMMAR_SUBDIR: Record<string, string> = {
  markdown: "tree-sitter-markdown",
  xml: "xml",   // the package also ships a `dtd` grammar
};

/**
 * Grammars that ship with the plugin. Everything else in GRAMMAR_PACKAGES is
 * fetched on first use (see grammar-installer.ts).
 *
 * The split is by how likely a given machine is to contain the language at all,
 * not by popularity in the abstract: a repo that has zero Swift files pays 73 MB
 * for the Swift grammar regardless of how popular Swift is. Core is the set that
 * shows up across almost any project — build config, docs, scripts, web — plus
 * the languages we cannot fold without.
 */
const CORE_LANGUAGES = new Set([
  "javascript", "typescript", "tsx",
  "python",
  "c_sharp", "powershell", "xml",
  "markdown", "yaml", "toml",
  "css",
  "bash",
]);

export function isCoreLanguage(language: string): boolean {
  return CORE_LANGUAGES.has(language);
}

/** Resolve from the plugin's own node_modules (the shipped core). */
function resolveGrammarPath(language: string): string | null {
  const pkg = GRAMMAR_PACKAGES[language];
  if (!pkg) return null;

  const subdir = GRAMMAR_SUBDIR[language];
  if (subdir) {
    try {
      const rootPkgPath = pluginResolve(pkg + "/package.json");
      const resolved = join(dirname(rootPkgPath), subdir);
      if (existsSync(join(resolved, "src"))) return resolved;
    } catch {
      // [ANTI-PATTERN IGNORED]: grammar package not installed is expected for unsupported languages
    }
    return null;
  }

  try {
    const packageJsonPath = pluginResolve(pkg + "/package.json");
    return dirname(packageJsonPath);
  } catch {
    return null;
  }
}

export function resolveGrammarPathWithFallback(language: string, projectRoot?: string): string | null {
  const bundled = resolveGrammarPath(language);
  if (bundled) return bundled;

  // Previously fetched on demand?
  const pkg = GRAMMAR_PACKAGES[language];
  if (pkg) {
    const onDemand = resolveOnDemandGrammar(pkg, GRAMMAR_SUBDIR[language]);
    if (onDemand) return onDemand;

    // A known language with no grammar on disk: fetch it for next time. This
    // returns immediately — the current file is folded without symbols rather
    // than blocking a hook on a package install.
    requestGrammarInstall(language, pkg);
    return null;
  }

  if (!projectRoot) return null;

  const userConfig = loadUserGrammars(projectRoot);
  const entry = userConfig.grammars[language];
  if (!entry) return null;

  try {
    const packageJsonPath = join(projectRoot, "node_modules", entry.package, "package.json");
    if (existsSync(packageJsonPath)) {
      const grammarDir = dirname(packageJsonPath);
      if (existsSync(join(grammarDir, "src"))) return grammarDir;
    }
  } catch {
    // Grammar package not installed
  }

  logger.warn('PARSER', 'Grammar package not found', { language, package: entry.package });
  return null;
}

const QUERIES: Record<string, string> = {
  jsts: `
(function_declaration name: (identifier) @name) @func
(lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @const_func
(class_declaration name: (type_identifier) @name) @cls
(method_definition name: (property_identifier) @name) @method
(interface_declaration name: (type_identifier) @name) @iface
(type_alias_declaration name: (type_identifier) @name) @tdef
(enum_declaration name: (identifier) @name) @enm
(import_statement) @imp
(export_statement) @exp
`,

  // Plain JavaScript: the tree-sitter-javascript grammar has no type_identifier,
  // interface_declaration, type_alias_declaration or enum_declaration nodes, so it
  // cannot share the jsts query — tree-sitter aborts query compilation on the first
  // unknown node type. Class names are (identifier) here, not (type_identifier).
  js: `
(function_declaration name: (identifier) @name) @func
(lexical_declaration (variable_declarator name: (identifier) @name value: [(arrow_function) (function_expression)])) @const_func
(class_declaration name: (identifier) @name) @cls
(method_definition name: (property_identifier) @name) @method
(import_statement) @imp
(export_statement) @exp
`,

  c_sharp: `
(class_declaration name: (identifier) @name) @cls
(record_declaration name: (identifier) @name) @cls
(struct_declaration name: (identifier) @name) @struct_def
(interface_declaration name: (identifier) @name) @iface
(enum_declaration name: (identifier) @name) @enm
(method_declaration name: (identifier) @name) @method
(constructor_declaration name: (identifier) @name) @method
(property_declaration name: (identifier) @name) @prop
(delegate_declaration name: (identifier) @name) @tdef
(using_directive) @imp
`,

  powershell: `
(function_statement (function_name) @name) @func
(class_statement (simple_name) @name) @cls
(enum_statement (simple_name) @name) @enm
(class_method_definition (simple_name) @name) @method
`,

  // XML/XAML has no functions to fold — the element tree IS the structure, so
  // elements map to container kinds and nest the same way classes do.
  xml: `
(element (STag (Name) @name)) @cls
(element (EmptyElemTag (Name) @name)) @cls
`,

  python: `
(function_definition name: (identifier) @name) @func
(class_definition name: (identifier) @name) @cls
(import_statement) @imp
(import_from_statement) @imp
`,

  go: `
(function_declaration name: (identifier) @name) @func
(method_declaration name: (field_identifier) @name) @method
(type_declaration (type_spec name: (type_identifier) @name)) @tdef
(import_declaration) @imp
`,

  rust: `
(function_item name: (identifier) @name) @func
(struct_item name: (type_identifier) @name) @struct_def
(enum_item name: (type_identifier) @name) @enm
(trait_item name: (type_identifier) @name) @trait_def
(impl_item type: (type_identifier) @name) @impl_def
(use_declaration) @imp
`,

  ruby: `
(method name: (identifier) @name) @func
(class name: (constant) @name) @cls
(module name: (constant) @name) @cls
(call method: (identifier) @name) @imp
`,

  java: `
(method_declaration name: (identifier) @name) @method
(class_declaration name: (identifier) @name) @cls
(interface_declaration name: (identifier) @name) @iface
(enum_declaration name: (identifier) @name) @enm
(import_declaration) @imp
`,

  kotlin: `
(function_declaration (simple_identifier) @name) @func
(class_declaration (type_identifier) @name) @cls
(object_declaration (type_identifier) @name) @cls
(import_header) @imp
`,

  swift: `
(function_declaration name: (simple_identifier) @name) @func
(class_declaration name: (type_identifier) @name) @cls
(protocol_declaration name: (type_identifier) @name) @iface
(import_declaration) @imp
`,

  php: `
(function_definition name: (name) @name) @func
(class_declaration name: (name) @name) @cls
(interface_declaration name: (name) @name) @iface
(trait_declaration name: (name) @name) @trait_def
(method_declaration name: (name) @name) @method
(namespace_use_declaration) @imp
`,

  lua: `
(function_declaration name: (identifier) @name) @func
(function_declaration name: (dot_index_expression) @name) @func
(function_declaration name: (method_index_expression) @name) @func
`,

  scala: `
(function_definition name: (identifier) @name) @func
(class_definition name: (identifier) @name) @cls
(object_definition name: (identifier) @name) @cls
(trait_definition name: (identifier) @name) @trait_def
(import_declaration) @imp
`,

  bash: `
(function_definition name: (word) @name) @func
`,

  haskell: `
(function name: (variable) @name) @func
(type_synomym name: (name) @name) @tdef
(newtype name: (name) @name) @tdef
(data_type name: (name) @name) @tdef
(class name: (name) @name) @cls
(import) @imp
`,

  zig: `
(function_declaration name: (identifier) @name) @func
(test_declaration) @func
`,

  css: `
(rule_set (selectors) @name) @func
(media_statement) @cls
(keyframes_statement (keyframes_name) @name) @cls
(import_statement) @imp
`,

  scss: `
(rule_set (selectors) @name) @func
(media_statement) @cls
(keyframes_statement (keyframes_name) @name) @cls
(import_statement) @imp
(mixin_statement name: (identifier) @name) @mixin_def
(function_statement name: (identifier) @name) @func
(include_statement) @imp
`,

  toml: `
(table (bare_key) @name) @cls
(table (dotted_key) @name) @cls
(table_array_element (bare_key) @name) @cls
(table_array_element (dotted_key) @name) @cls
`,

  yaml: `
(block_mapping_pair key: (flow_node) @name) @func
`,

  sql: `
(create_table (object_reference) @name) @cls
(create_function (object_reference) @name) @func
(create_view (object_reference) @name) @cls
`,

  markdown: `
(atx_heading heading_content: (inline) @name) @heading
(setext_heading heading_content: (paragraph) @name) @heading
(fenced_code_block (info_string (language) @name)) @code_block
(fenced_code_block) @code_block
(minus_metadata) @frontmatter
(link_reference_definition (link_label) @name) @ref
`,

  generic: `
(function_declaration name: (identifier) @name) @func
(function_definition name: (identifier) @name) @func
(class_declaration name: (identifier) @name) @cls
(class_definition name: (identifier) @name) @cls
(import_statement) @imp
(import_declaration) @imp
`,
};

function getQueryKey(language: string): string {
  switch (language) {
    case "javascript":
      return "js";
    case "typescript":
    case "tsx":
      return "jsts";
    case "c_sharp": return "c_sharp";
    case "powershell": return "powershell";
    case "xml": return "xml";
    case "python": return "python";
    case "go": return "go";
    case "rust": return "rust";
    case "ruby": return "ruby";
    case "java": return "java";
    case "kotlin": return "kotlin";
    case "swift": return "swift";
    case "php": return "php";
    case "elixir": return "generic";
    case "lua": return "lua";
    case "scala": return "scala";
    case "bash": return "bash";
    case "haskell": return "haskell";
    case "zig": return "zig";
    case "css": return "css";
    case "scss": return "scss";
    case "toml": return "toml";
    case "yaml": return "yaml";
    case "sql": return "sql";
    case "markdown": return "markdown";
    default: return "generic";
  }
}

let queryTmpDir: string | null = null;
const queryFileCache = new Map<string, string>();

function getQueryFile(queryKey: string): string {
  if (queryFileCache.has(queryKey)) return queryFileCache.get(queryKey)!;

  if (!queryTmpDir) {
    queryTmpDir = mkdtempSync(join(tmpdir(), "smart-read-queries-"));
  }

  const filePath = join(queryTmpDir, `${queryKey}.scm`);
  writeFileSync(filePath, QUERIES[queryKey]);
  queryFileCache.set(queryKey, filePath);
  return filePath;
}

// Resolution moved to treesitter-cli.ts. Two defects lived in the version that
// stood here: it probed `join(dir, "tree-sitter")` without the .exe suffix, so on
// Windows it could not see a binary that was present; and when nothing was found
// it returned the bare string "tree-sitter", turning "no parser installed" into
// an ENOENT from execFileSync that runBatchQuery swallowed at debug level.
/** True once the missing-parser condition has been reported to the session. */
let parserWarningEmitted = false;
/** True once the missing-parser condition has been written to the log. */
let missingParserLogged = false;

/**
 * A one-line, user-facing note about the parser being unavailable — returned for
 * the FIRST affected call in the session only, so the condition is visible where
 * the user actually looks instead of only in the log.
 */
export function consumeParserWarning(): string | null {
  if (parserWarningEmitted) return null;
  const bin = resolveTreeSitterBin();
  if (bin.status === "ok") return null;
  parserWarningEmitted = true;
  return bin.status === "no-package"
    ? "[keepmind] Structural search is UNAVAILABLE for every language: the tree-sitter-cli package is missing from the plugin dependency tree. Run `npx keepmind install` to repair it."
    : "[keepmind] Structural search is UNAVAILABLE for every language: the tree-sitter CLI executable was never downloaded. keepmind is fetching it now in the background — retry in a moment. Set KEEPMIND_PARSER_AUTOINSTALL=0 to suppress the fetch.";
}

/** Test hook: allow the once-per-session warning to fire again. */
export function resetParserWarningForTesting(): void {
  parserWarningEmitted = false;
  missingParserLogged = false;
}

/**
 * A distinct, actionable message per failure mode. The old single message
 * ("File may use an unsupported language or be empty") covered four different
 * causes, three of which are keepmind's own fault and fixable.
 */
export function describeFoldFailure(failure: FoldFailure, filePath: string, language?: string): string {
  switch (failure) {
    case "no-parser":
      return `Cannot fold ${filePath}: keepmind's tree-sitter CLI executable is missing, so NO language can be parsed on this machine. This is not a problem with the file. keepmind has started fetching the executable in the background — retry shortly. If it does not resolve, run \`npx keepmind install\` to repair the plugin dependency tree.`;
    case "no-grammar":
      return `Cannot fold ${filePath}: the tree-sitter grammar for '${language ?? "this language"}' is not installed. This is not a problem with the file. keepmind has requested the grammar in the background — retry shortly.`;
    case "unknown-language":
      return `Cannot fold ${filePath}: its extension maps to no supported language. Add a \`grammars\` entry to .keepmind.json to teach keepmind this file type.`;
    case "query-failed":
      return `Cannot fold ${filePath}: the parser ran but failed on this input — the file may be malformed or truncated.`;
  }
}

interface RawCapture {
  tag: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  text?: string;
}

interface RawMatch {
  pattern: number;
  captures: RawCapture[];
}

interface BatchQueryResult {
  matches: Map<string, RawMatch[]>;
  /** Set when no query ran at all; distinguishes "no parser" from "no symbols". */
  failure?: FoldFailure;
}

function runQuery(queryFile: string, sourceFile: string, grammarPath: string): { matches: RawMatch[]; failure?: FoldFailure } {
  const result = runBatchQuery(queryFile, [sourceFile], grammarPath);
  return { matches: result.matches.get(sourceFile) || [], failure: result.failure };
}

function runBatchQuery(queryFile: string, sourceFiles: string[], grammarPath: string): BatchQueryResult {
  if (sourceFiles.length === 0) return { matches: new Map() };

  // Check the executable BEFORE spawning. A missing parser is a configuration
  // fault affecting every file, not a per-file parse error, and it must be
  // reported as such rather than as an empty match set.
  const bin = resolveTreeSitterBin();
  if (bin.status !== "ok") {
    // Log once per process, not once per language group: a single 1805-file scan
    // fans out into a dozen groups, and this condition is a property of the
    // install, not of the batch.
    if (!missingParserLogged) {
      missingParserLogged = true;
      logger.warn('WORKER', 'tree-sitter CLI executable unavailable — structural search yields no symbols for ANY language', {
        status: bin.status,
      });
    }
    // Fire-and-forget; the current batch stays unfolded, the next one parses.
    requestTreeSitterCliInstall();
    return { matches: new Map(), failure: "no-parser" };
  }

  const execArgs = ["query", "-p", grammarPath, queryFile, ...sourceFiles];

  let output: string;
  try {
    output = execFileSync(bin.path, execArgs, { encoding: "utf-8", timeout: 30000, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  } catch (error) {
    logger.debug('WORKER', `tree-sitter query failed for ${sourceFiles.length} file(s)`, undefined, error instanceof Error ? error : undefined);
    return { matches: new Map(), failure: "query-failed" };
  }

  return { matches: parseMultiFileQueryOutput(output) };
}

function parseMultiFileQueryOutput(output: string): Map<string, RawMatch[]> {
  const fileMatches = new Map<string, RawMatch[]>();
  let currentFile: string | null = null;
  let currentMatch: RawMatch | null = null;

  for (const line of output.split("\n")) {
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      currentFile = line.trim();
      if (!fileMatches.has(currentFile)) {
        fileMatches.set(currentFile, []);
      }
      currentMatch = null;
      continue;
    }

    if (!currentFile) continue;

    const patternMatch = line.match(/^\s+pattern:\s+(\d+)/);
    if (patternMatch) {
      currentMatch = { pattern: parseInt(patternMatch[1]), captures: [] };
      fileMatches.get(currentFile)!.push(currentMatch);
      continue;
    }

    const captureMatch = line.match(
      /^\s+capture:\s+(?:\d+\s*-\s*)?(\w+),\s*start:\s*\((\d+),\s*(\d+)\),\s*end:\s*\((\d+),\s*(\d+)\)(?:,\s*text:\s*`([^`]*)`)?/
    );
    if (captureMatch && currentMatch) {
      currentMatch.captures.push({
        tag: captureMatch[1],
        startRow: parseInt(captureMatch[2]),
        startCol: parseInt(captureMatch[3]),
        endRow: parseInt(captureMatch[4]),
        endCol: parseInt(captureMatch[5]),
        text: captureMatch[6],
      });
    }
  }

  return fileMatches;
}

const KIND_MAP: Record<string, CodeSymbol["kind"]> = {
  func: "function",
  const_func: "function",
  cls: "class",
  method: "method",
  iface: "interface",
  tdef: "type",
  enm: "enum",
  struct_def: "struct",
  trait_def: "trait",
  impl_def: "impl",
  mixin_def: "mixin",
  prop: "property",
  heading: "section",
  code_block: "code",
  frontmatter: "metadata",
  ref: "reference",
};

// Interfaces hold members too — a C# or Java interface rendered flat puts its
// methods at file level, next to the interface rather than inside it.
const CONTAINER_KINDS = new Set(["class", "struct", "impl", "trait", "interface"]);

function extractSignatureFromLines(lines: string[], startRow: number, endRow: number, maxLen: number = 200): string {
  const firstLine = lines[startRow] || "";
  let sig = firstLine;

  if (!sig.trimEnd().endsWith("{") && !sig.trimEnd().endsWith(":")) {
    const chunk = lines.slice(startRow, Math.min(startRow + 10, endRow + 1)).join("\n");
    const braceIdx = chunk.indexOf("{");
    if (braceIdx !== -1 && braceIdx < 500) {
      sig = chunk.slice(0, braceIdx).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    }
  }

  sig = sig.replace(/\s*[{:]\s*$/, "").trim();
  if (sig.length > maxLen) sig = sig.slice(0, maxLen - 3) + "...";
  return sig;
}

function findCommentAbove(lines: string[], startRow: number): string | undefined {
  const commentLines: string[] = [];
  let foundComment = false;

  for (let i = startRow - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      if (foundComment) break;
      continue;
    }
    if (trimmed.startsWith("/**") || trimmed.startsWith("*") || trimmed.startsWith("*/") ||
        trimmed.startsWith("//") || trimmed.startsWith("///") || trimmed.startsWith("//!") ||
        trimmed.startsWith("#") || trimmed.startsWith("@")) {
      commentLines.unshift(lines[i]);
      foundComment = true;
    } else {
      break;
    }
  }

  return commentLines.length > 0 ? commentLines.join("\n").trim() : undefined;
}

function findPythonDocstringFromLines(lines: string[], startRow: number, endRow: number): string | undefined {
  for (let i = startRow + 1; i <= Math.min(startRow + 3, endRow); i++) {
    const trimmed = lines[i]?.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) return trimmed;
    break;
  }
  return undefined;
}

function isExported(
  name: string, startRow: number, endRow: number,
  exportRanges: Array<{ startRow: number; endRow: number }>,
  lines: string[], language: string
): boolean {
  switch (language) {
    case "javascript":
    case "typescript":
    case "tsx":
      return exportRanges.some(r => startRow >= r.startRow && endRow <= r.endRow);
    case "python":
      return !name.startsWith("_");
    case "go":
      return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
    case "rust":
      return lines[startRow]?.trimStart().startsWith("pub") ?? false;
    default:
      return true;
  }
}

function buildSymbols(matches: RawMatch[], lines: string[], language: string): { symbols: CodeSymbol[]; imports: string[] } {
  const symbols: CodeSymbol[] = [];
  const imports: string[] = [];
  const exportRanges: Array<{ startRow: number; endRow: number }> = [];
  const containers: Array<{ sym: CodeSymbol; startRow: number; endRow: number }> = [];

  for (const match of matches) {
    for (const cap of match.captures) {
      if (cap.tag === "exp") {
        exportRanges.push({ startRow: cap.startRow, endRow: cap.endRow });
      }
      if (cap.tag === "imp") {
        imports.push(cap.text || lines[cap.startRow]?.trim() || "");
      }
    }
  }

  for (const match of matches) {
    const kindCapture = match.captures.find(c => KIND_MAP[c.tag]);
    const nameCapture = match.captures.find(c => c.tag === "name");
    if (!kindCapture) continue;

    const startRow = kindCapture.startRow;
    const endRow = kindCapture.endRow;
    const kind = KIND_MAP[kindCapture.tag];
    const name = nameCapture?.text || "anonymous";

    let signature: string;
    if (language === "markdown" && kind === "section") {
      const headingLine = lines[startRow] || "";
      const hashMatch = headingLine.match(/^(#{1,6})\s/);
      const level = hashMatch ? hashMatch[1].length : 1;
      signature = `${"#".repeat(level)} ${name}`;
    } else if (language === "markdown" && kind === "code") {
      const langTag = name !== "anonymous" ? name : "";
      signature = langTag ? "```" + langTag : "```";
    } else if (language === "markdown" && kind === "metadata") {
      signature = "---frontmatter---";
    } else if (language === "markdown" && kind === "reference") {
      signature = lines[startRow]?.trim() || name;
    } else {
      signature = extractSignatureFromLines(lines, startRow, endRow);
    }

    const comment = language === "markdown" ? undefined : findCommentAbove(lines, startRow);
    const docstring = language === "python" ? findPythonDocstringFromLines(lines, startRow, endRow) : undefined;

    const sym: CodeSymbol = {
      name,
      kind,
      signature,
      jsdoc: comment || docstring,
      lineStart: startRow,
      lineEnd: endRow,
      exported: isExported(name, startRow, endRow, exportRanges, lines, language),
    };

    if (CONTAINER_KINDS.has(kind)) {
      sym.children = [];
      containers.push({ sym, startRow, endRow });
    }

    symbols.push(sym);
  }

  if (language === "markdown") {
    const codeBlocksByRange = new Map<string, CodeSymbol>();
    const duplicateCodeBlocks = new Set<CodeSymbol>();
    for (const sym of symbols) {
      if (sym.kind !== "code") continue;
      const rangeKey = `${sym.lineStart}:${sym.lineEnd}`;
      const existing = codeBlocksByRange.get(rangeKey);
      if (existing) {
        if (sym.name !== "anonymous") {
          duplicateCodeBlocks.add(existing);
          codeBlocksByRange.set(rangeKey, sym);
        } else {
          duplicateCodeBlocks.add(sym);
        }
      } else {
        codeBlocksByRange.set(rangeKey, sym);
      }
    }
    if (duplicateCodeBlocks.size > 0) {
      const filtered = symbols.filter(s => !duplicateCodeBlocks.has(s));
      symbols.length = 0;
      symbols.push(...filtered);
    }
  }

  // Attach each symbol to its INNERMOST enclosing container. Claiming it from
  // every enclosing container instead duplicated it at each level: an XML tree
  // three deep rendered the leaf under its parent AND under its grandparent.
  // Class-in-class is rare enough that this stayed invisible until XAML.
  const nested = new Set<CodeSymbol>();
  for (const sym of symbols) {
    let innermost: typeof containers[number] | null = null;
    for (const container of containers) {
      if (sym === container.sym) continue;
      if (sym.lineStart <= container.startRow || sym.lineEnd > container.endRow) continue;
      if (!innermost || container.startRow > innermost.startRow) {
        innermost = container;
      }
    }
    if (innermost) {
      if (sym.kind === "function") sym.kind = "method";
      innermost.sym.children!.push(sym);
      nested.add(sym);
    }
  }

  return { symbols: symbols.filter(s => !nested.has(s)), imports };
}

export function findProjectRoot(filePath: string): string | undefined {
  let dir = dirname(filePath);
  while (true) {
    if (PROJECT_CONFIG_NAMES.some(name => existsSync(join(dir, name)))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function parseFile(content: string, filePath: string, projectRoot?: string): FoldedFile {
  const userConfig = projectRoot ? loadUserGrammars(projectRoot) : EMPTY_USER_GRAMMAR_CONFIG;
  const language = detectLanguageWithUserGrammars(filePath, userConfig);
  const lines = content.split("\n");

  const grammarPath = resolveGrammarPathWithFallback(language, projectRoot);
  if (!grammarPath) {
    return {
      filePath, language, symbols: [], imports: [],
      totalLines: lines.length, foldedTokenEstimate: 50,
      unavailable: language === "unknown" ? "unknown-language" : "no-grammar",
    };
  }

  const queryKey = getUserAwareQueryKey(language, userConfig);
  const queryFile = getQueryFile(queryKey);

  const ext = filePath.slice(filePath.lastIndexOf(".")) || ".txt";
  const tmpDir = mkdtempSync(join(tmpdir(), "smart-src-"));
  const tmpFile = join(tmpDir, `source${ext}`);
  writeFileSync(tmpFile, content);

  try {
    const { matches, failure } = runQuery(queryFile, tmpFile, grammarPath);
    const result = buildSymbols(matches, lines, language);

    const folded = formatFoldedView({
      filePath, language,
      symbols: result.symbols, imports: result.imports,
      totalLines: lines.length, foldedTokenEstimate: 0,
    });

    return {
      filePath, language,
      symbols: result.symbols, imports: result.imports,
      totalLines: lines.length,
      foldedTokenEstimate: Math.ceil(folded.length / 4),
      ...(failure ? { unavailable: failure } : {}),
    };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function parseFilesBatch(
  files: Array<{ absolutePath: string; relativePath: string; content: string }>,
  projectRoot?: string
): Map<string, FoldedFile> {
  const results = new Map<string, FoldedFile>();
  const userConfig = projectRoot ? loadUserGrammars(projectRoot) : EMPTY_USER_GRAMMAR_CONFIG;

  const languageGroups = new Map<string, typeof files>();
  for (const file of files) {
    const language = detectLanguageWithUserGrammars(file.relativePath, userConfig);
    if (!languageGroups.has(language)) languageGroups.set(language, []);
    languageGroups.get(language)!.push(file);
  }

  for (const [language, groupFiles] of languageGroups) {
    const grammarPath = resolveGrammarPathWithFallback(language, projectRoot);
    if (!grammarPath) {
      for (const file of groupFiles) {
        const lines = file.content.split("\n");
        results.set(file.relativePath, {
          filePath: file.relativePath, language, symbols: [], imports: [],
          totalLines: lines.length, foldedTokenEstimate: 50,
          unavailable: language === "unknown" ? "unknown-language" : "no-grammar",
        });
      }
      continue;
    }

    const queryKey = getUserAwareQueryKey(language, userConfig);
    const queryFile = getQueryFile(queryKey);

    const absolutePaths = groupFiles.map(f => f.absolutePath);
    const { matches: batchResults, failure } = runBatchQuery(queryFile, absolutePaths, grammarPath);

    for (const file of groupFiles) {
      const lines = file.content.split("\n");
      const matches = batchResults.get(file.absolutePath) || [];
      const symbolResult = buildSymbols(matches, lines, language);

      const folded = formatFoldedView({
        filePath: file.relativePath, language,
        symbols: symbolResult.symbols, imports: symbolResult.imports,
        totalLines: lines.length, foldedTokenEstimate: 0,
      });

      results.set(file.relativePath, {
        filePath: file.relativePath, language,
        symbols: symbolResult.symbols, imports: symbolResult.imports,
        totalLines: lines.length,
        foldedTokenEstimate: Math.ceil(folded.length / 4),
        ...(failure ? { unavailable: failure } : {}),
      });
    }
  }

  return results;
}

export function formatFoldedView(file: FoldedFile): string {
  if (file.language === "markdown") {
    return formatMarkdownFoldedView(file);
  }

  const parts: string[] = [];

  parts.push(`📁 ${file.filePath} (${file.language}, ${file.totalLines} lines)`);
  parts.push("");

  if (file.imports.length > 0) {
    parts.push(`  📦 Imports: ${file.imports.length} statements`);
    for (const imp of file.imports.slice(0, 10)) {
      parts.push(`    ${imp}`);
    }
    if (file.imports.length > 10) {
      parts.push(`    ... +${file.imports.length - 10} more`);
    }
    parts.push("");
  }

  for (const sym of file.symbols) {
    parts.push(formatSymbol(sym, "  "));
  }

  return parts.join("\n");
}

function formatMarkdownFoldedView(file: FoldedFile): string {
  const parts: string[] = [];
  const COL_WIDTH = 56;

  parts.push(`📄 ${file.filePath} (${file.language}, ${file.totalLines} lines)`);

  for (const sym of file.symbols) {
    if (sym.kind === "section") {
      const hashMatch = sym.signature.match(/^(#{1,6})\s/);
      const level = hashMatch ? hashMatch[1].length : 1;
      const indent = "  ".repeat(level);
      const lineRange = `L${sym.lineStart + 1}`;
      const content = `${indent}${sym.signature}`;
      parts.push(`${content.padEnd(COL_WIDTH)}${lineRange}`);
    } else if (sym.kind === "code") {
      const containingLevel = findContainingHeadingLevel(file.symbols, sym.lineStart);
      const indent = "  ".repeat(containingLevel + 1);
      const lineRange = sym.lineStart === sym.lineEnd
        ? `L${sym.lineStart + 1}`
        : `L${sym.lineStart + 1}-${sym.lineEnd + 1}`;
      const content = `${indent}${sym.signature}`;
      parts.push(`${content.padEnd(COL_WIDTH)}${lineRange}`);
    } else if (sym.kind === "metadata") {
      const lineRange = sym.lineStart === sym.lineEnd
        ? `L${sym.lineStart + 1}`
        : `L${sym.lineStart + 1}-${sym.lineEnd + 1}`;
      const content = `  ${sym.signature}`;
      parts.push(`${content.padEnd(COL_WIDTH)}${lineRange}`);
    } else if (sym.kind === "reference") {
      const containingLevel = findContainingHeadingLevel(file.symbols, sym.lineStart);
      const indent = "  ".repeat(containingLevel + 1);
      const lineRange = `L${sym.lineStart + 1}`;
      const content = `${indent}↗ ${sym.name}`;
      parts.push(`${content.padEnd(COL_WIDTH)}${lineRange}`);
    }
  }

  return parts.join("\n");
}

function findContainingHeadingLevel(symbols: CodeSymbol[], lineStart: number): number {
  let bestLevel = 0;
  for (const sym of symbols) {
    if (sym.kind === "section" && sym.lineStart < lineStart) {
      const hashMatch = sym.signature.match(/^(#{1,6})\s/);
      bestLevel = hashMatch ? hashMatch[1].length : 1;
    }
  }
  return bestLevel;
}

function formatSymbol(sym: CodeSymbol, indent: string): string {
  const parts: string[] = [];

  const icon = getSymbolIcon(sym.kind);
  const exportTag = sym.exported ? " [exported]" : "";
  const lineRange = sym.lineStart === sym.lineEnd
    ? `L${sym.lineStart + 1}`
    : `L${sym.lineStart + 1}-${sym.lineEnd + 1}`;

  parts.push(`${indent}${icon} ${sym.name}${exportTag} (${lineRange})`);
  parts.push(`${indent}  ${sym.signature}`);

  if (sym.jsdoc) {
    const jsdocLines = sym.jsdoc.split("\n");
    const firstLine = jsdocLines.find(l => {
      const t = l.replace(/^[\s*/]+/, "").replace(/^['"`]{3}/, "").trim();
      return t.length > 0 && !t.startsWith("/**");
    });
    if (firstLine) {
      const cleaned = firstLine.replace(/^[\s*/]+/, "").replace(/^['"`]{3}/, "").replace(/['"`]{3}$/, "").trim();
      if (cleaned) {
        parts.push(`${indent}  💬 ${cleaned}`);
      }
    }
  }

  if (sym.children && sym.children.length > 0) {
    for (const child of sym.children) {
      parts.push(formatSymbol(child, indent + "  "));
    }
  }

  return parts.join("\n");
}

function getSymbolIcon(kind: CodeSymbol["kind"]): string {
  const icons: Record<string, string> = {
    function: "ƒ", method: "ƒ", class: "◆", interface: "◇",
    type: "◇", const: "●", variable: "○", export: "→",
    struct: "◆", enum: "▣", trait: "◇", impl: "◈",
    property: "○", getter: "⇢", setter: "⇠", mixin: "◈",
    section: "§", code: "⌘", metadata: "◊", reference: "↗",
  };
  return icons[kind] || "·";
}

export function unfoldSymbol(content: string, filePath: string, symbolName: string, projectRoot?: string): string | null {
  const file = parseFile(content, filePath, projectRoot);

  const findSymbol = (symbols: CodeSymbol[]): CodeSymbol | null => {
    for (const sym of symbols) {
      if (sym.name === symbolName) return sym;
      if (sym.children) {
        const found = findSymbol(sym.children);
        if (found) return found;
      }
    }
    return null;
  };

  const symbol = findSymbol(file.symbols);
  if (!symbol) return null;

  const lines = content.split("\n");

  if (file.language === "markdown" && symbol.kind === "section") {
    const hashMatch = symbol.signature.match(/^(#{1,6})\s/);
    const level = hashMatch ? hashMatch[1].length : 1;
    const start = symbol.lineStart;

    let end = lines.length - 1;
    for (const sym of file.symbols) {
      if (sym.kind === "section" && sym.lineStart > start) {
        const otherHashMatch = sym.signature.match(/^(#{1,6})\s/);
        const otherLevel = otherHashMatch ? otherHashMatch[1].length : 1;
        if (otherLevel <= level) {
          end = sym.lineStart - 1;
          while (end > start && lines[end].trim() === "") end--;
          break;
        }
      }
    }

    const extracted = lines.slice(start, end + 1).join("\n");
    return `<!-- 📍 ${filePath} L${start + 1}-${end + 1} -->\n${extracted}`;
  }

  let start = symbol.lineStart;
  for (let i = symbol.lineStart - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "" || trimmed.startsWith("*") || trimmed.startsWith("/**") ||
        trimmed.startsWith("///") || trimmed.startsWith("//") ||
        trimmed.startsWith("#") || trimmed.startsWith("@") ||
        trimmed === "*/") {
      start = i;
    } else {
      break;
    }
  }

  const extracted = lines.slice(start, symbol.lineEnd + 1).join("\n");
  return `// 📍 ${filePath} L${start + 1}-${symbol.lineEnd + 1}\n${extracted}`;
}
