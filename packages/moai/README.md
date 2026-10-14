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
Moai button.

Version 2.0 is a keyboard-first explorer modelled on `moai tui`. It has three tabs — **Kanban**, **List** and **Wiki**
(click the tab bar, or `SPC g b` / `SPC g l` / `SPC g w`) — and a detail pane that sits below the list or, on a panel at least
640 px wide, on its left; a small button in the toolbar (or `SPC o d`) switches the position. The toolbar and the keys
cover search (`/`), filter (`SPC f`), sort (`SPC s`), view toggles for deferred, backlog, archived and status columns
(`SPC v`), list columns (`SPC c`) and the unread mark: **NEW** rows are marked read with `r`, `SPC m g` (group) and
`SPC m a` (all). `?` shows the shortcut overlay. See [PANEL.md](PANEL.md) for how the panel is used and the full
shortcut table.

The panel loads the project's tasks once and filters, sorts and groups them in the panel, so keys respond at once;
details (`show`) and wiki pages are read when opened. A read is approved once per profile, machine and folder for the
session; every add and every read-mark write asks again. Runs target the project of the conversation; Desktop's
confirmation shows the machine and folder, and until a run is accepted the panel reads "Starting… approve the
confirmation if it is showing" rather than claiming it already runs on the machine. After a cancelled run the panel is
ready again at once and notes when the machine says processes may still be running (the daemon's workspace write lock
refuses an overlapping write until they settle).

Keyboard input reaches the panel only once it has focus: click the panel after opening the tab.

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
