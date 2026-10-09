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

Settings → Machines shows a **Moai** button on online machines. It opens an isolated panel that runs the two profiles
through the extension's own commands: **Show status** prints the task counts and **Add task** creates a task from the
typed title. Runs target the project currently selected in the app; each one first shows Desktop's confirmation with
the machine and folder. While a run is in progress the panel polls its status and offers **Cancel**.

