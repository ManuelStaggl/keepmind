# keepmind: AI Development Instructions

keepmind is a Claude Code plugin providing persistent memory across sessions. It captures tool usage, compresses observations using the Claude Agent SDK, and injects relevant context into future sessions.

keepmind is a **local-only hard fork** of thedotmack/claude-mem (independent git history). Compared to upstream it removed Chroma and the cloud-sync layer — all vector search runs in-process. Do NOT reintroduce Chroma or assume a shared history with upstream.

"node-only" describes the **runtime**: the worker, hooks and MCP server run under Node, with no Bun or Python process in the loop. It does not describe the toolchain — see Requirements.

## Naming

The canonical configuration prefix is `KEEPMIND_*`, for environment variables and for the keys inside `~/.keepmind/settings.json`. The pre-2.0 `CLAUDE_MEM_*` spelling is still accepted on read (`src/shared/legacy-env.ts`) and settings files are migrated once on load — do not remove that fallback, and do not add new `CLAUDE_MEM_*` keys.

Markers written into files keepmind does not own (`CLAUDE.md`, `AGENTS.md`, IDE rules files) go through `src/shared/context-markers.ts`. Anything that writes such a file must also delete its pre-rename predecessor: rules files are `alwaysApply` and MCP servers are keyed by name, so a leftover keeps injecting stale context.

References to `claude-mem` are only correct where they name the **upstream** project: migration, purge, legacy cleanup, and attribution.

## Build

```bash
npm run build-and-sync        # Build, sync to marketplace, restart worker
```

Compilation is Node + esbuild (`build:cli-binary` bundles `--platform=node --external:node:sqlite`). The build additionally shells out to `bun install` in `scripts/gen-plugin-lockfile.cjs` and `scripts/sync-marketplace.cjs`, so **bun must be on PATH to build**.

`npm run build` verifies that the committed hook JSON still matches the canonical generator and fails on drift. After changing `src/build/hook-shell-template.ts` or anything that feeds it, regenerate with `REGEN_HOOKS=1 npm run build`.

## File Locations

- **Source**: `<project-root>/src/`
- **Built Plugin**: `<project-root>/plugin/`
- **Installed Plugin**: `~/.claude/plugins/marketplaces/keepmind/` — code only, **no `node_modules`**
- **Plugin dependencies**: `~/.claude/plugins/data/keepmind-keepmind/` (`${CLAUDE_PLUGIN_DATA}`)
- **Database**: `~/.keepmind/keepmind.db`
- **Vector search**: in-process `sqlite-vec` inside the SQLite DB (no separate Chroma service); embeddings via `@huggingface/transformers` (local multilingual-e5-small, int8, 384-dim)

The embedder is **multilingual by design**, not by accident: observations are
written in English while questions are often asked in another language, and an
English-only model cannot bridge that — German queries silently degraded to
keyword-only hits. e5 is asymmetric, so stored text must be embedded as
`passage` and searches as `query`; mixing the two is silent, it only retrieves
worse. `vec_meta.embedder_identity` stamps the store with the model that filled
it, and a mismatch triggers a full rebuild at worker start — without that stamp
a model change mixes two incomparable vector spaces and presents as "search
stopped finding things".

There is exactly ONE dependency tree, and it lives in the plugin data directory.
Never install into the marketplace or cache directories: `${CLAUDE_PLUGIN_ROOT}`
is documented as ephemeral, and the host restores it from git on update — which
deletes `node_modules` (observed twice on 2026-07-29, once with `autoUpdate:false`
already set). `${CLAUDE_PLUGIN_DATA}` survives updates.

The bundles resolve their native deps (sqlite-vec, onnxruntime-node via
`@huggingface/transformers`, the tree-sitter grammars) through
`src/shared/plugin-node-modules.ts` — a single ordered candidate chain, not a
bundle-relative `createRequire`. When adding a runtime dependency that cannot be
inlined, resolve it with `pluginRequire`/`pluginResolve`; a bare `createRequire`
anchored at the bundle re-pins the tree to the directory the host deletes.
Legacy locations stay in the chain so installs that predate the move keep
working until their next `npx keepmind install`.

## Requirements

- **Node.js >= 22.5.0** — the runtime floor, set by the built-in `node:sqlite` module.
- **Bun** — required to *install* and to *build*, never to run. `npx keepmind install` treats it as mandatory (`ensureBun` in `src/npx-cli/install/setup-runtime.ts`, installed automatically if missing) and uses `bun install --frozen-lockfile` for a deterministic plugin dependency closure.
- No uv, no Chroma, no Python — the uvx/Python toolchain went away with Chroma, and the installer no longer probes or installs uv. Do not reintroduce it.

## Documentation

**Source**: `docs/` — MDX/Markdown files in the repo

## Releases

```bash
# write the notes first — they are the release
$EDITOR RELEASE_NOTES.md
npm run release:patch -- --title="keepmind 3.3.2 — ..."   # or :minor / :major
```

`scripts/release.mjs` is the only supported path. It runs a preflight, bumps the
version, builds, tests, tags, pushes, **creates the GitHub Release** and
regenerates the changelog. `--dry-run` stops after the preflight.

npm publishing happens in CI: pushing a `v*` tag triggers
`.github/workflows/npm-publish.yml`, which authenticates over OIDC trusted
publishing. Nothing publishes from a developer machine — there is no token here.

Three rules the script enforces because each was violated in production:

- **A release without notes is not a release.** `CHANGELOG.md` is generated from
  GitHub Releases, so a tag without one is a permanent hole in the file (v3.3.0
  shipped to npm that way). The preflight refuses to run on an empty
  `RELEASE_NOTES.md`.
- **Never `git push --tags`.** The 322 pre-fork claude-mem tags live under
  `refs/tags/upstream/*` and must stay local. Push the one tag by name.
- **Tags outside `upstream/` that are unreachable from `main` are a bug.** They
  silently occupy future versions — the inherited set held `v3.3.8`, `v3.5.x` and
  43 others hostage. The preflight fails if any reappear.

## Important

No need to edit the changelog ever, it's generated automatically —
`npm run changelog:generate` merges GitHub Releases into `CHANGELOG.md` sorted by
version. Everything below the `<!-- inherited-history -->` marker is the pre-fork
claude-mem changelog (numbered up to 13.x, older than every keepmind release
despite the higher numbers) and is never rewritten.

## Daily Maintenance

Run a daily version check across all package manifests and upgrade every dependency to its latest version — including major version bumps. Staying on the latest is the goal; do not skip majors.

- Check `package.json` (root) and the nested manifests — `plugin/package.json` (generated by `scripts/build-hooks.js`, so change its source there) and `examples/sdk-node/package.json` — for outdated dependencies via `npm outdated`.
- Upgrade every package to `latest` (use `npm install <pkg>@latest` for each, or `npx npm-check-updates -u && npm install`). Bump majors too.
- Run `npm audit fix` to resolve advisories.
- After upgrades, run `npm run build-and-sync` and verify the worker starts and tests pass. Fix any breakage caused by major bumps in the same change.
- Commit the updated `package.json` files and the regenerated `plugin/bun.lock`. `package-lock.json` is gitignored — do not try to commit it.
