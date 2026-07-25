<h1 align="center">keepmind</h1>

<h4 align="center">Persistent memory for <a href="https://claude.com/claude-code" target="_blank">Claude Code</a> — Windows-first, node-only, cloud-free.</h4>

<p align="center"><sub><strong>keepmind</strong> is a node-only, RAM-lean fork of <a href="https://github.com/thedotmack/claude-mem">thedotmack/claude-mem</a> (Apache-2.0). See <a href="NOTICE">NOTICE</a> for attribution.</sub></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/version-1.4.0-green.svg" alt="Version"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D22.5-brightgreen.svg" alt="Node"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#search-tools">Search Tools</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#migrating-from-claude-mem">Migration</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  keepmind preserves context across Claude Code sessions by automatically capturing tool-usage observations, compressing them into semantic summaries, and injecting the relevant ones into future sessions — so Claude keeps its knowledge of a project even after a session ends.
</p>

---

## What's different from claude-mem

This fork strips the cloud/SaaS layer and the Bun/Chroma runtime dependencies so it runs as a self-contained node process on Windows:

- **node-only** — the `bun:sqlite` dependency is shimmed to `node:sqlite`; the worker runs under Node ≥ 22.5.
- **In-process vector search** — the `chroma-mcp`/`uvx` subprocess is replaced by an in-process store: `@huggingface/transformers` (int8 MiniLM, 384-dim) + `sqlite-vec`. Hybrid RRF (vector + BM25), fully offline.
- **Cloud layer removed** — Postgres, BullMQ, Redis and better-auth are gone. All 23 MCP tools and observation generation stay intact.
- **Windows-hardened lifecycle** — ephemeral worker port (eliminates the fixed-port orphaned-socket deadlock), session-bound refcount, atomic BOM-free settings.
- **Secret-safe** — observations are scrubbed of secrets (`ghp_…`, `AKIA…`, high-entropy tokens) before storage; project-scoped by default.

Data lives under `~/.keepmind/` (SQLite `keepmind.db` + `vector-db/`).

---

## Quick Start

**Run the interactive installer — this is the one required step:**

```bash
npx keepmind@latest install
```

The installer does everything: registers the plugin with Claude Code, installs the runtime (worker, Bun, uv, native deps), lets you pick your AI provider/model, and starts the worker. If an existing **claude-mem** install is found, it offers to migrate your memories and remove it.

> ⚠️ **The `/plugin install` marketplace flow alone is NOT enough.** It only copies the plugin files — it does **not** install the runtime (worker, Bun/uv, dependencies) or configure a provider, so no memory is ever captured. Whether or not you added the marketplace, you must run `npx keepmind@latest install` to complete setup.

Then **restart Claude Code**. Memory injection begins on your **second** session in a project — the first seeds the store, subsequent sessions receive auto-injected context.

Check status any time with `npx keepmind@latest status` (or diagnose setup with `npx keepmind@latest doctor`).

**Requirements:** Node ≥ 22.5. Bun and uv are installed automatically at setup time.

---

## Key Features

- 🧠 **Persistent memory** — context survives across sessions, auto-injected where relevant.
- 🔍 **Hybrid search** — offline semantic (sqlite-vec) + keyword (SQLite FTS5/BM25), fused via RRF.
- 🖥️ **Web viewer** — real-time memory stream at `http://localhost:<worker-port>` (the port is shown at session start; ephemeral by design).
- 🔒 **Privacy** — `<private>` tags exclude sensitive content; secret-scrubbing and project-scoping are on by default.
- ⚙️ **Context configuration** — fine-grained control over what gets injected, tunable in the viewer's settings.
- 🤖 **Automatic** — no manual intervention; memory builds passively as you work.
- 🔗 **Citations** — reference past observations by ID via `http://localhost:<worker-port>/api/observation/{id}`.

---

## How It Works

**Core components:**

1. **Lifecycle hooks** — SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd capture activity and inject context.
2. **Worker service** — a Node HTTP API (ephemeral port) with the web viewer and search endpoints; started lazily and bound to the session.
3. **SQLite database** — `~/.keepmind/keepmind.db` stores sessions, observations, summaries and prompts (FTS5 for keyword search).
4. **In-process vector store** — `~/.keepmind/vector-db/vectors.db` (sqlite-vec) holds embeddings, backfilled incrementally on worker start.
5. **mem-search skill** — natural-language queries with progressive disclosure.

---

## Search Tools

keepmind exposes MCP search tools (`mcp__keepmind__*`) plus the `/mem-search` skill for querying past work in natural language — "did we already solve this?", "how did we do X last time?". Results are project-scoped and rank hybrid vector + keyword matches.

---

## Configuration

Settings live in `~/.keepmind/settings.json` (auto-created with defaults on first run): AI model, worker port/host, data directory, log level, and context-injection behavior.

Environment variables use the canonical `KEEPMIND_*` prefix; the legacy `KEEPMIND_*` names are still honored as a fallback. Examples:

```bash
KEEPMIND_DATA_DIR       # override the data directory (default ~/.keepmind)
KEEPMIND_WORKER_PORT    # pin the worker port (default: ephemeral)
KEEPMIND_LOG_LEVEL      # INFO | WARN | ERROR | DEBUG
KEEPMIND_CHROMA_ENABLED # 'false' → SQLite/BM25-only search (disables the vector store)
```

---

## Migrating from claude-mem

If you have an existing claude-mem install, adopt its database losslessly:

```bash
npx keepmind migrate            # auto-detects ~/.claude-mem/claude-mem.db
npx keepmind migrate --from <dir-or-file>   # explicit source
npx keepmind migrate --dry-run  # preview counts only
```

Adopt copies the source read-only (`VACUUM INTO`) and brings the schema up to date; Merge (`--from` into an existing store) inserts only missing rows. The source is never modified. An existing `~/.keepmind/claude-mem.db` is renamed to `keepmind.db` automatically on first worker start.

---

## Development

```bash
npm run build            # sync manifests, build hooks + viewer, gen plugin lockfile
npm run build-and-sync   # build, sync to the installed marketplace, restart the worker
npx tsc --noEmit         # typecheck
```

Source in `src/`, built plugin in `plugin/`, installed copy under `~/.claude/plugins/marketplaces/keepmind/`. See `HANDOFF.md` for the full fork architecture and status.

---

## License

Apache-2.0. keepmind is a derivative work of [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) (Copyright Alex Newman), used under the Apache License 2.0. Fork copyright © 2026 Manuel Staggl. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

- **Issues**: [github.com/ManuelStaggl/keepmind/issues](https://github.com/ManuelStaggl/keepmind/issues)
- **Repository**: [github.com/ManuelStaggl/keepmind](https://github.com/ManuelStaggl/keepmind)
