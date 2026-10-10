# Moai 0.8.0 managed execution sample

This first-party sample uses only the SDK `machine.run` capability. Desktop installation keeps the extension disabled
until the user approves `machine.run`; updates retain the previous package for rollback. The extension then offers
run, status, and cancel commands for two fixed profiles:

- `buzzni.moai.status` runs `moai --json -C <workspace> status` (managed read).
- `buzzni.moai.add` runs `moai --json -C <workspace> add <title>`, declared to change only `.moai/` (managed project
  write; Desktop asks for a one-operation approval).

Both declarations copy the Happy daemon's Moai v0.8.0 catalog verbatim, so their digests match what the daemon runs.
They start from the workspace root, pass through only `HOME` (Moai user config and the git identity a write needs),
may launch only `git`, and disable stdin.
The sample deliberately has no init, tui, wake, hooks, editor, or shell entry points.

## Board panel

Settings → Machines shows a **Moai** button on online machines. It opens an isolated panel (`surfaceSize: "compact"`;
the host draws the single "Moai" title) that runs the two profiles through the extension's own commands: **Add task**
(the primary button, or Enter in the title field) creates a task from the typed title, and **Show status** shows the
task counts as four small chips. Runs target the project currently selected in the app; each one first shows Desktop's
confirmation with the machine and folder. **Cancel** appears only once the run has an operation id (not while the
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
