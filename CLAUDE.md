# keepmind: AI Development Instructions

keepmind is a Claude Code plugin providing persistent memory across sessions. It captures tool usage, compresses observations using the Claude Agent SDK, and injects relevant context into future sessions.

keepmind is a **node-only, local-only hard fork** of thedotmack/claude-mem (independent git history). Compared to upstream it removed Bun, the uv/Python/Chroma stack, and the cloud-sync layer — all vector search runs in-process. Do NOT reintroduce Bun/uv/Chroma or assume a shared history with upstream.

## Build

```bash
npm run build-and-sync        # Build, sync to marketplace, restart worker
```

Build is pure Node + esbuild (`build:cli-binary` bundles `--platform=node --external:node:sqlite`). No Bun.

## File Locations

- **Source**: `<project-root>/src/`
- **Built Plugin**: `<project-root>/plugin/`
- **Installed Plugin**: `~/.claude/plugins/marketplaces/keepmind/`
- **Database**: `~/.keepmind/keepmind.db`
- **Vector search**: in-process `sqlite-vec` inside the SQLite DB (no separate Chroma service); embeddings via `@huggingface/transformers` (local MiniLM, int8)

## Requirements

- **Node.js >= 22.5.0** (uses the built-in `node:sqlite` module — the only hard requirement)
- No Bun, no uv, no Python, no Chroma

## Documentation

**Source**: `docs/` — MDX/Markdown files in the repo

## Important

No need to edit the changelog ever, it's generated automatically.

## Daily Maintenance

Run a daily version check across all package manifests and upgrade every dependency to its latest version — including major version bumps. Staying on the latest is the goal; do not skip majors.

- Check `package.json` (root) and all nested `package.json` files (e.g. `plugin/`, `openclaw/`) for outdated dependencies via `npm outdated`.
- Upgrade every package to `latest` (use `npm install <pkg>@latest` for each, or `npx npm-check-updates -u && npm install`). Bump majors too.
- Run `npm audit fix` to resolve advisories.
- After upgrades, run `npm run build-and-sync` and verify the worker starts and tests pass. Fix any breakage caused by major bumps in the same change.
- Commit the updated `package.json` and `package-lock.json` files.
