# Third-Party Notices

keepmind bundles and depends on third-party open-source software. All bundled
dependencies are distributed under permissive licenses (MIT, ISC, BSD, Apache-2.0,
or permissively dual-licensable). No copyleft (GPL/AGPL) code is included.

This file lists the directly shipped and esbuild-inlined dependencies. Each
package's full license text is available in its `node_modules/<pkg>/` directory
and in its upstream repository. keepmind itself is licensed under Apache-2.0
(see LICENSE) and is a fork of thedotmack/claude-mem (see NOTICE).

## Runtime dependencies (resolved at runtime, not inlined)

| Package | Version | License | Repository |
|---|---|---|---|
| @huggingface/transformers | 4.2.0 | Apache-2.0 | https://github.com/huggingface/transformers.js |
| @modelcontextprotocol/sdk | 1.29.0 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |
| sqlite-vec | 0.1.9 | MIT OR Apache | https://github.com/asg017/sqlite-vec |
| zod | 4.4.3 | MIT | https://github.com/colinhacks/zod |

## Inlined into the worker/CLI bundles (build-time devDependencies, shipped in the bundle)

| Package | Version | License | Repository |
|---|---|---|---|
| express | 5.2.1 | MIT | expressjs/express |
| react | 19.2.7 | MIT | https://github.com/facebook/react |
| react-dom | 19.2.7 | MIT | https://github.com/facebook/react |
| cors | 2.8.6 | MIT | expressjs/cors |
| dompurify | 3.4.11 | (MPL-2.0 OR Apache-2.0) | git://github.com/cure53/DOMPurify |
| handlebars | 4.7.9 | MIT | https://github.com/handlebars-lang/handlebars.js |
| @clack/prompts | 1.6.0 | MIT | https://github.com/bombshell-dev/clack |
| ansi-to-html | 0.7.2 | MIT | https://github.com/rburns/ansi-to-html |
| glob | 13.0.6 | BlueOak-1.0.0 | git@github.com:isaacs/node-glob |
| picocolors | 1.1.1 | ISC | alexeyraspopov/picocolors |
| shell-quote | 1.9.0 | MIT | http://github.com/ljharb/shell-quote |
| yaml | 2.9.0 | ISC | github:eemeli/yaml |
| zod-to-json-schema | 3.25.2 | ISC | https://github.com/StefanTerdell/zod-to-json-schema |
| @anthropic-ai/claude-agent-sdk | 0.3.196 | SEE LICENSE IN README.md | https://github.com/anthropics/claude-agent-sdk-typescript |

## Tree-sitter grammars (bundled for smart code parsing)

| Package | Version | License | Repository |
|---|---|---|---|
| @derekstride/tree-sitter-sql | 0.3.11 | MIT | https://github.com/derekstride/tree-sitter-sql |
| @tree-sitter-grammars/tree-sitter-lua | 0.4.1 | MIT | https://github.com/tree-sitter-grammars/tree-sitter-lua |
| @tree-sitter-grammars/tree-sitter-markdown | 0.3.2 | MIT | github:tree-sitter-grammars/tree-sitter-markdown |
| @tree-sitter-grammars/tree-sitter-toml | 0.7.0 | MIT | https://github.com/tree-sitter-grammars/tree-sitter-toml |
| @tree-sitter-grammars/tree-sitter-yaml | 0.7.1 | MIT | https://github.com/tree-sitter-grammars/tree-sitter-yaml |
| @tree-sitter-grammars/tree-sitter-zig | 1.1.2 | MIT | https://github.com/tree-sitter-grammars/tree-sitter-zig |
| tree-sitter-bash | 0.25.1 | MIT | https://github.com/tree-sitter/tree-sitter-bash |
| tree-sitter-c | 0.24.1 | MIT | https://github.com/tree-sitter/tree-sitter-c |
| tree-sitter-cli | 0.26.10 | MIT | https://github.com/tree-sitter/tree-sitter |
| tree-sitter-cpp | 0.23.4 | MIT | https://github.com/tree-sitter/tree-sitter-cpp |
| tree-sitter-css | 0.25.0 | MIT | https://github.com/tree-sitter/tree-sitter-css |
| tree-sitter-elixir | 0.3.5 | Apache-2.0 | https://github.com/elixir-lang/tree-sitter-elixir |
| tree-sitter-go | 0.25.0 | MIT | https://github.com/tree-sitter/tree-sitter-go |
| tree-sitter-haskell | 0.23.1 | MIT | https://github.com/tree-sitter/tree-sitter-haskell |
| tree-sitter-java | 0.23.5 | MIT | https://github.com/tree-sitter/tree-sitter-java |
| tree-sitter-javascript | 0.25.0 | MIT | https://github.com/tree-sitter/tree-sitter-javascript |
| tree-sitter-kotlin | 0.3.8 | MIT | https://github.com/fwcd/tree-sitter-kotlin |
| tree-sitter-php | 0.24.2 | MIT | https://github.com/tree-sitter/tree-sitter-php |
| tree-sitter-python | 0.25.0 | MIT | https://github.com/tree-sitter/tree-sitter-python |
| tree-sitter-ruby | 0.23.1 | MIT | https://github.com/tree-sitter/tree-sitter-ruby |
| tree-sitter-rust | 0.24.0 | MIT | https://github.com/tree-sitter/tree-sitter-rust |
| tree-sitter-scala | 0.24.0 | MIT | https://github.com/tree-sitter/tree-sitter-scala |
| tree-sitter-scss | 1.0.0 | MIT | github:tree-sitter-grammars/tree-sitter-scss |
| tree-sitter-swift | 0.7.1 | MIT | https://github.com/alex-pinkus/tree-sitter-swift |
| tree-sitter-typescript | 0.23.2 | MIT | https://github.com/tree-sitter/tree-sitter-typescript |

---

_Generated for the keepmind distribution. Transitive dependencies (all permissively
licensed) are omitted for brevity; a full transitive report can be produced with
`npx license-checker-rseidelsohn`._
