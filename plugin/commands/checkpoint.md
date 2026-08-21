---
description: Write a curated session checkpoint into keepmind — the hand-off injected at the top of your next session
argument-hint: [focus]
---

# /checkpoint

Persist a **curated hand-off** for this project into keepmind. The next session
(after `/clear` or a fresh start) injects it **at the very top** of its context —
so you can resume without re-reading anything. This is the deliberate
alternative to `/compact`: you decide *when* to capture state and *what* goes in.

`$ARGUMENTS` (optional) narrows the checkpoint to a focus, exactly like a
scoped hand-off. If empty, capture the whole active state.

## What to do

1. **Only checkpoint if work is actually open.** If the task is finished with
   nothing left to hand off, do **not** write a checkpoint. If a previous
   checkpoint's last open point is now done, retire it instead — call the
   keepmind **`clear_checkpoint`** tool for this project (no baton without an
   open point) — and stop.

2. **Determine the project name** the way keepmind does: the basename of the git
   repository root (`git rev-parse --show-toplevel`), or the basename of the
   current working directory if this is not a git repo. You will pass this as
   `project` — the worker cannot infer it and would otherwise misfile the
   checkpoint under its default project.

3. **Compose the hand-off** as concise, prioritized markdown. Include only what
   a fresh session needs to continue, and keep it tight (aim for well under
   ~400 lines-worth; the top of the block is what survives the injection cap).
   Use these sections, omitting any that are empty:

   - **Active task + status** — what is being done right now and how far it got.
   - **Done** — what is already finished this session (so it is not redone).
   - **Next steps** — in execution order, the first one actionable immediately.
   - **Key files** — paths (with line anchors where useful) being worked on.
   - **Decisions + rationale** — every decision *with the reason behind it*, and
     any explicit user directives in their own words. The rationale is the point;
     a decision without its "why" gets re-litigated.
   - **Open bugs / risks** — known-open problems and verified pitfalls (with
     cause), so the next session does not rediscover them the hard way.

4. **Save it.** Call the keepmind **`save_checkpoint`** tool with:
   - `text`: the full markdown hand-off from step 3,
   - `project`: the name from step 2,
   - `focus`: `$ARGUMENTS` if a focus was given.

   Saving replaces any previous active checkpoint for this project — there is
   always exactly one active baton.

5. **Confirm** to the user: one line stating the checkpoint was saved for
   `<project>` (and the focus, if any), then remind them they can start a fresh
   session — the checkpoint will be waiting at the top of it.

Do not `/compact`. The checkpoint plus a fresh session is the hand-off.
