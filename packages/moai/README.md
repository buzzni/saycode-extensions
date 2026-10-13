# Moai 0.8.0 managed execution sample

This first-party sample uses only the SDK `machine.run` capability. Desktop installation keeps the extension disabled
until the user approves `machine.run`; updates retain the previous package for rollback. The extension then offers
run, status, and cancel commands for four fixed profiles:

- `buzzni.moai.status` runs `moai --json -C <workspace> status` (managed read).
- `buzzni.moai.prime` runs `moai --json -C <workspace> prime` (managed read): the held and ready tasks the board lists.
- `buzzni.moai.show` runs `moai --json -C <workspace> show <id>` (managed read): one task's body, subtasks and history.
- `buzzni.moai.add` runs `moai --json -C <workspace> add <title>`, declared to change only `.moai/` (managed project
  write; Desktop asks for a one-operation approval).

All four declarations copy the Happy daemon's Moai v0.8.0 catalog verbatim, so their digests match what the daemon runs.
They start from the workspace root, pass through only `HOME` (Moai user config and the git identity a write needs),
may launch only `git`, and disable stdin.
The sample deliberately has no init, tui, wake, hooks, editor, or shell entry points.

## Board panel

The extension contributes a project tool (Desktop engine 1.2.0): in a project conversation, the work area More menu lists
**Moai** under the built-in tools, and choosing it opens the board as a work area tab (the host draws the single "Moai"
title; `surfaceSize: "compact"` applies only where a host opens it as a modal). Settings → Machines no longer shows a
Moai button. Opening the board loads the project's tasks with `prime`, grouped as In progress, Review and To do
(held tasks of other people included; done tasks are not listed, and a truncated list says how many more there are).
Choosing a task shows its details with `show` in the same tab — status, priority, assignee, creation time, body,
subtasks and history (notes, status moves) — and **Back to list** returns to the list with focus on that task.
**Refresh** reloads the list, and adding a task refreshes it. A read is approved once per profile, machine and folder
for the session, so the list and the details each ask once; every add asks again. The panel also runs the profiles
through the extension's own commands: **Add task**
(the primary button, or Enter in the title field) creates a task from the typed title, and **Show status** shows the
task counts as four small chips. Runs target the project of the conversation; Desktop's confirmation shows the machine
and folder. The hint at the top says so, and until a run is accepted the status reads "Starting… approve the
confirmation if it is showing" rather than claiming it already runs on the machine (1.1.1). **Cancel** appears only once the run has an operation id (not while the
confirmation is open); a small spinner shows while the run is in progress and the panel polls its status. After a
cancel it is ready again at once and notes when the machine says processes may still be running (the daemon's
workspace write lock refuses an overlapping write until they settle).

The panel follows Desktop's panel theme v1 variables (`--saycode-*`, `data-theme`) and falls back to the OS light/dark
scheme on older Desktop builds.

The board needs a Moai repository: run `moai init` once in the project folder on that machine. The extension cannot
run `init` itself, so when Moai reports there is no `.moai/` (an add on stderr, or a status that lists projects
instead of counts) the panel shows an information banner with that command and points to the Moai path shown under
Machine tools in Settings → Extensions, for when `moai` is not on that machine's `PATH`. Moai failures are shown as
errors.

When Core refuses a run with a `machine.run` error code, `buzzni.moai.run` returns
`{ action: 'start', state: 'refused', code }` instead of throwing (the panel bridge carries only an error message).
The panel explains `declined`, `approval-timeout` and `workspace-busy` (another change is still running in that folder
on that machine) as information, and `tool-missing` (install Moai for that machine under Machine tools),
`unsupported-platform` and `unsupported-daemon` (the machine's runtime is too old) as errors, in English, Korean,
Japanese and Chinese. Other codes, and failures from older Desktop builds that carry no code, keep the generic
"did not start" message.

Version 1.0.4 sets `panels[].surfaceSize`, which Desktop builds without panel size v1 reject; install it on a Desktop
that supports it.
