# Moai 2.0

This first-party extension uses only the SDK `machine.run` capability. Desktop installation keeps the extension disabled
until the user approves `machine.run`; updates retain the previous package for rollback. The extension then offers
run, status, and cancel commands for these 17 fixed profiles, each `moai --json -C <workspace> …` (see Profiles below).
The board adds no tasks (2.0.0 dropped the add field and the `add` profile). The optional skill installer and `init` write project files and declare a project write scope.

## Compatibility

The extension and `moai` keep independent version numbers. Extension 2.1.0 needs:

| Needs | Version | Notes |
|---|---|---|
| Saycode Desktop | engine 1.2.0 or later, Extension API 4 (Desktop 0.1.69 or later) | `engines.saycode` and `apiVersion` in `extension.json`. API 4 is current there, so the card shows no "previous extension API" notice; a host that stops at API 3 refuses the package |
| `moai` CLI | 0.17.0 or later | on Desktop the daemon runs its own managed `moai`, not the one on that machine's `PATH`: happy-cli 1.1.10-aplus.322 (Desktop 0.1.69) pins v0.8.0, which lacks later skill-install options and prints no `unread` or `statuses[]`, so NEW marks stay off there until the pin moves (upstream request 1.6). With the upstream read and JSON improvements, confirmed in 0.17.0: `unread`, `derived_milestone` and `shelved_by` in `show --json`, `archived` on the archive rows of `show --archived --json` and the configured status order (`statuses[]`) in `status --json` (se-0g4a). The milestone and epic tallies of `status --json` and `show --archived --after` paging are in 0.16 already. An older moai still loads; the compatibility banner asks to upgrade it only when a fallback the panel draws is in use (the milestone and epic counts) |
| Happy daemon catalog | 12 core profiles | `status`, `prime`, `show`, `show-all`, `backlog-all`, `show-archived`, `show-archived-after`, `wiki-ls`, `wiki-show`, `read`, `read-all`, `read-group` (exact list: se-0g4a.anz) |

Five additional declarations cover `skill-status`, `skill-install-saycode`, `init`, `show-all-worktree` and `show-worktree`.
The daemon candidate in [happy PR #826](https://github.com/buzzni/happy/pull/826) pins public moai 0.17.0 and supports
15 of the 16 declarations it was checked against (`init` came later, se-s1e8). It deliberately omits `skill-install-saycode`: that release does not accept `--hook-exe moai`
and its skill status has no `optional` field, so the panel shows terminal instructions instead of an install button.
The remaining 15 profiles were executed successfully through the daemon's managed-tool handler on macOS.
This is validation of the candidate, not evidence that the daemon has been published.

Release order: the `moai` upstream release is out (0.17.0); the daemon catalog update (with `init`, upstream request
1.9) still ships before extension 2.1.0. Without `init` in the catalog the panel's init button is refused and says
so, beside the command to run by hand.

## Profiles

| Profile | Runs | For | Writes |
|---|---|---|---|
| `buzzni.moai.status` | `status` | counts, warnings, the column names | no |
| `buzzni.moai.prime` | `prime` | held and ready tasks; the index rows' fallback when `show --all` is cut | no |
| `buzzni.moai.show` | `show <id>` | one row's body, children, journal, commits | no |
| `buzzni.moai.show-all` | `show --all` | every active row, done and deferred included, archive left out | no |
| `buzzni.moai.backlog-all` | `backlog show --all` | the backlog rows, done and deferred included | no |
| `buzzni.moai.show-archived` | `show --archived -n 200 --sort id` | the first archive page | no |
| `buzzni.moai.show-archived-after` | `show --archived -n 200 --sort id --after <id>` | each next archive page | no |
| `buzzni.moai.wiki-ls` | `wiki ls` | the wiki pages, their links and backlinks | no |
| `buzzni.moai.wiki-show` | `wiki show <slug>` | one wiki page's body | no |
| `buzzni.moai.read` | `read <id>` | mark one row read | your own `~/.config/moai/read` only |
| `buzzni.moai.read-all` | `read --all` | mark everything unread that came to you read | your own `~/.config/moai/read` only |
| `buzzni.moai.read-group` | `read -e <group>` | mark an epic or milestone and its rows read | your own `~/.config/moai/read` only |
| `buzzni.moai.skill-status` | `skill status` | check installed skills | no |
| `buzzni.moai.skill-install-saycode` | `skill install --with moai-saycode --hook-exe moai` | optional skill setup; requires a newer CLI | project configuration (`writeScope: project`) |
| `buzzni.moai.init` | `init --no-skill --no-register` | put a `.moai/` into a project that has none, from the panel's not-initialized screen | project files: `.moai/`, `.gitattributes`, `.gitignore`, `AGENTS.md`, the merge driver in `.git/config` (`writeScope: project`) |
| `buzzni.moai.show-all-worktree` | `show --all --worktree` | overlay worktree rows | no |
| `buzzni.moai.show-worktree` | `show <id> --worktree` | one overlaid row | no |

The board reads do not write the tracker and declare no `writeScope`. The optional skill installer and `init` declare
`writeScope: project` and require approval for each write when a compatible CLI and daemon support them. `init` plants
no skills (`--no-skill`): the skills banner offers them once the board is up, with `--hook-exe moai`. Run from the
daemon, `init` writes the managed `moai`'s absolute path into the merge driver; when that path goes stale, merges fall
back to `git merge-file`, and running `moai init` again puts in a live path.
The `read*` profiles change nothing under `.moai/`: Moai keeps what you have read in your own user config, so they
carry no `writeScope` and are approved like reads.

The archive can pass the 1 MiB output limit in one read (2.35 MB for 2,289 archived rows in a measured repository), so
it is read 200 rows a page sorted by id: the first page with `show-archived`, then `show-archived-after` with the last
id of the page before, until a page comes back with fewer than 200 rows. Moai refuses `--after ''`, which is why the
first page has its own profile. When `show --all` itself is cut at the limit (the daemon flags `truncated`), the rows
can fall back to `prime` and the board can say the list is partial.

The run command accepts a value only where the profile takes one (`show`, `show-worktree`, `wiki-show`, `read`, `read-group`,
`show-archived-after`: one non-empty string that does not start with `-`, so `read <id>` can never become
`read --all`) and refuses one everywhere else. It refuses `add` and every other profile it does not declare.

These declarations are meant to match the Happy daemon's Moai catalog verbatim, so their digests match what the daemon
runs. `status`, `prime`, `show`, `wiki-ls` and `wiki-show` match the catalog the daemon ships (happy-cli
1.1.10-aplus.322, checked live with Desktop 0.1.69 on 2026-10-15); the catalog entries for the others are assumed to be
added to match (se-0g4a.anz). The daemon catalog must carry the new profiles (`show-all`, `backlog-all`,
`show-archived`, `show-archived-after`, `read`, `read-all`, `read-group`) before the board can load every row, the
archive or read marks on that machine; a daemon that does not carry one refuses that run. They reach a catalog
together, so once `show-all` is refused as missing the panel takes the others as missing too and does not run them:
Desktop puts its confirmation up before it asks the daemon, and each would ask you to approve a command the daemon
then refuses (se-24ey.dcj). `show-all` itself is still asked on each read, so an updated catalog is found. The catalog's own `buzzni.moai.backlog` is `backlog add <title>`, so the
backlog read is `backlog-all`. They start from the workspace root, pass through only `HOME` (Moai user config and the git identity a write needs), may launch only
`git`, and disable stdin.
The extension deliberately has no init, tui, wake, hooks, editor, or shell entry points.

## Board panel

The extension contributes a project tool (Desktop engine 1.2.0): in a project conversation, the work area More menu lists
**Moai** under the built-in tools, and choosing it opens the board as a work area tab (the host draws the single "Moai"
title; `surfaceSize: "compact"` applies only where a host opens it as a modal). Settings → Machines no longer shows a
Moai button.

Version 2.0 is a keyboard-first explorer modelled on `moai tui`. It has three tabs — **Board** (the kanban), **List**
and **Wiki** (click the tab bar, or `SPC g b` / `SPC g l` / `SPC g w`) — and a detail pane that sits below the list or,
on a panel at least 640 px wide, on its left; a small button in the tab bar (or `SPC o d`) switches the position. The
toolbar and the keys cover search (`/`), filter (`SPC f`) and sort (`SPC s`); the `SPC` menu, whose items can be
clicked too, covers view toggles for deferred, backlog, archived and status columns (`SPC v`), list columns (`SPC c`)
and the unread mark: **NEW** rows are marked read with `r`, `SPC m g` (group) and `SPC m a` (all). `?` shows the
shortcut overlay. See [PANEL.md](PANEL.md) for how the panel is used and the full shortcut table.

The panel reads the project's whole list (`show --all`, the backlog and `status`) and filters, sorts and groups it in
the panel, so keys respond at once. It reads the list again every 10 seconds while it is on screen, after a read mark,
and from the refresh time in the tab bar; details (`show`), the archive (`SPC v o`) and wiki pages are read when
opened. A read is approved once per profile, machine and folder for the session, and so is each read-mark profile (they
write only your own read state, see Profiles). A list read declined at its confirmation, or left unanswered, holds the
automatic refresh (a line says so) until a list read goes through — click the refresh time — so the confirmation does
not come back by itself. Each automatic read runs `show-all`, `backlog-all` and `status` on the machine (three short
moai runs every 10 s while the panel is on screen, none while it is hidden); reads take no write lock there. Runs
target the project of the conversation; Desktop's confirmation shows the machine and folder. While a run you asked for
goes, a toast at the foot of the panel says so without moving anything (clicks pass through it to the rows, except
Cancel); the clock's own reads run quietly. Until a run is accepted the toast reads "Starting… approve the confirmation
if it is showing" rather than claiming it already runs on the machine. After a cancelled run the panel is
ready again at once and notes when the machine says processes may still be running (the daemon's workspace write lock
refuses an overlapping write until they settle).

Keyboard input reaches the panel only once it has focus: click the panel after opening the tab.

The panel follows Desktop's panel theme v1 variables (`--saycode-*`, `data-theme`) and falls back to the OS light/dark
scheme on older Desktop builds.

The board needs a Moai repository: run `moai init` once in the project folder on that machine. The extension cannot
run `init` itself, so when Moai reports there is no `.moai/` (a read on stderr, or a status that lists projects
instead of counts) the panel shows an information banner with that command and points to the Moai path shown under
Machine tools in Settings → Extensions, for when `moai` is not on that machine's `PATH`. Moai failures are shown as
errors.

When Core refuses a run with a `machine.run` error code, `buzzni.moai.run` returns
`{ action: 'start', state: 'refused', code }` instead of throwing (the panel bridge carries only an error message).
The panel explains `declined`, `approval-timeout` and `workspace-busy` (another change is still running in that folder
on that machine) as information, and `tool-missing` (install Moai for that machine under Machine tools),
`unsupported-platform` and `unsupported-daemon` (the machine's runtime is too old) as errors, in English, Korean,
Japanese and Chinese. `binding-mismatch` (Desktop could not match the panel to its machine and project folder: open the
conversation again or restart Desktop) and `invalid-request` have their own words too; failures that carry no code
say that Desktop gave no reason (Desktop forwards a code, never its own error text).

Version 1.0.4 sets `panels[].surfaceSize`, which Desktop builds without panel size v1 reject; install it on a Desktop
that supports it.
