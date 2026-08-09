---
name: how-it-works
description: Explain how keepmind captures observations, when memory injection kicks in, and where data lives. Use when the user asks "how does keepmind work?" or "what is this thing doing?".
---

# How keepmind works

## What it does

Reads, Edits and Bash commands are watched, and the ones that produced something
durable turn into a compressed observation. Observations get summarized at
session end. Relevant ones get auto-injected into future prompts so the next
session starts with context from the last one — no re-explaining the codebase,
no re-discovering decisions.

Not every tool use becomes a record. A capture profile decides — from the hook
data, before any model is called — whether a batch is worth compressing. The
default for code projects is `governance`: decisions and their rationale,
migrations, releases, conventions, security findings, recurring problems. That
is the knowledge a per-project memory cannot give you. Set
`KEEPMIND_CAPTURE_PROFILE=balanced` in `~/.keepmind/settings.json` to also keep
ordinary changes and failures, or `full` to record anything with a signal.

Each compression is an independent request — nothing accumulates between them,
so cost stays flat no matter how long a session runs.

## When it kicks in

Memory injection starts on your second session in a project.

The first session in a fresh project seeds memory; subsequent sessions receive auto-injected context for relevant past work. Run `/learn-codebase` if you want to front-load the entire repo into memory in a single pass (~5 minutes, optional).

## Where data lives

Everything stays in ~/.keepmind on this machine.

Nothing leaves your machine except calls to whichever AI provider you configured for compression (Claude / OpenRouter / Gemini). The SQLite database, vector index, logs, and settings all live under that directory and are removed cleanly on `npx keepmind uninstall`.

What *does* go to that provider is redacted first: recognised credentials are
masked before the prompt is built, and files that are credentials in their
entirety (`.env`, `id_rsa`, `*.pem`, `.ssh/`, `.aws/`) have their content
withheld — only the fact that they were opened is reported. `KEEPMIND_ENABLED=false`
stops capture, injection and the per-Read timeline altogether. See SECURITY.md
for the rule set and its limits.
