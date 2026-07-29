---
name: claude-code-plugin-release
description: Automated semantic versioning and release workflow for Claude Code plugins. Handles version increments across package.json, marketplace.json, plugin.json manifests, build verification, git tagging, GitHub releases, and changelog generation. Pushing the tag publishes to npm automatically via OIDC trusted publishing in CI - no local publish, no human step.
---

# Version Bump & Release Workflow

**IMPORTANT:** Plan and write detailed release notes before starting.

**CRITICAL:** Commit EVERYTHING (including build artifacts). At the end of this workflow, NOTHING should be left uncommitted or unpushed. Run `git status` at the end to verify.

## Preparation

1.  **Analyze**: Determine if the change is **PATCH** (bug fixes), **MINOR** (features), or **MAJOR** (breaking).
2.  **Environment**: Identify repository owner/name from `git remote -v`.
3.  **Paths — every file that carries the version string**:
    - `package.json` — **the npm/npx-published version** (`npx keepmind@X.Y.Z` resolves from this)
    - `plugin/package.json` — bundled plugin runtime deps
    - `.claude-plugin/marketplace.json` — a version inside **every** entry of `plugins[]`: `keepmind` AND `keepmind-extras`
    - `.claude-plugin/plugin.json` — top-level Claude-plugin manifest
    - `plugin/.claude-plugin/plugin.json` — bundled Claude-plugin manifest
    - `plugin-extras/.claude-plugin/plugin.json` — the optional-skills plugin. Its `name` is `keepmind-extras` and MUST stay that way; a plugin is keyed by name, so renaming it orphans every install.
    - `.codex-plugin/plugin.json` — Codex-plugin manifest
    - `plugin/.codex-plugin/plugin.json` — bundled Codex-plugin manifest

    Verify coverage before editing: `git grep -l "\"version\": \"<OLD>\""` should list all eight. If a new manifest has been added since this doc was last updated, update this list.

## Workflow

1.  **Update**: Bump `package.json` and `plugin/package.json`, then run `node scripts/sync-plugin-manifests.js` — it propagates the version into every plugin manifest and every marketplace entry, and preserves `keepmind-extras`'s own name/description. Do NOT touch `CHANGELOG.md` — it's regenerated.
2.  **Verify**: `git grep -n "\"version\": \"<NEW>\""` — confirm every file above matches, including both marketplace entries. `git grep -n "\"version\": \"<OLD>\""` — should return zero hits.
3.  **Build and sync**: `npm run build-and-sync` to regenerate artifacts, sync the local marketplace copy, restart the worker, and clear the queue. Do not use plain `npm run build` for release validation because it can leave the local marketplace/worker out of sync.
4.  **Commit**: `git add -A && git commit -m "chore: bump version to X.Y.Z"`.
5.  **Tag**: `git tag -a vX.Y.Z -m "Version X.Y.Z"`.
6.  **Push**: `git push origin main && git push origin vX.Y.Z`.
7.  **npm publish — AUTOMATIC, do nothing.** Pushing the `vX.Y.Z` tag in step 6
    triggers `.github/workflows/npm-publish.yml`, which publishes via **OIDC
    trusted publishing**: the runner mints a short-lived id-token that npm
    verifies against the package's configured trusted publisher. There is no
    stored `NPM_TOKEN` and no 2FA prompt, so no human step is involved.

    Do NOT run `npm publish` (or `np` / `npm run release:*`) locally. This machine
    has no npm credentials at all (`npm whoami` → E401) and a local publish would
    only duplicate what CI already did.

    Just verify it landed (the workflow takes ~90s):
    ```bash
    gh run list --workflow=npm-publish.yml --limit 1
    npm view keepmind@X.Y.Z version   # should print X.Y.Z
    ```
8.  **GitHub release**: `gh release create vX.Y.Z --title "vX.Y.Z" --notes "RELEASE_NOTES"`.
9.  **Changelog**: Regenerate via the project's changelog script:
    ```bash
    npm run changelog:generate
    ```
    (Runs `node scripts/generate-changelog.js`, which pulls releases from the GitHub API and rewrites `CHANGELOG.md`.)
10. **Sync changelog**: Commit and push the updated `CHANGELOG.md`.
11. **Finalize**: `git status` — working tree must be clean.

## Checklist

- [ ] All eight config files have matching versions
- [ ] `git grep` for old version returns zero hits
- [ ] `npm run build-and-sync` succeeded
- [ ] Git tag created and pushed
- [ ] `npm-publish.yml` run succeeded and `npm view keepmind@X.Y.Z version` prints X.Y.Z (so `npx keepmind@X.Y.Z` resolves) — published by CI, not locally
- [ ] GitHub release created with notes
- [ ] `CHANGELOG.md` updated and pushed
- [ ] `git status` shows clean tree
