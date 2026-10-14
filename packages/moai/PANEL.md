# Moai panel guide

The Moai panel (2.0) is a keyboard-first board for the project's Moai tasks: three tabs, a detail pane, search, filter,
sort, column and view controls, and unread marks. This page describes it as you use it; the shortcut table at the end
lists every key.

## Open it

In a project conversation, open the work area More menu and choose **Moai**. The host opens the board as a tab. Keys
reach the panel only once it has focus, so click it once; until then it shows a "click to use the keyboard" hint.
Press `?` any time for the shortcut overlay.

## Tabs

| Tab | Shows | Switch |
|---|---|---|
| **Kanban** | One column per status, with Backlog and Deferred columns and milestone/epic grouping | `SPC g b` |
| **List** | The task tree: milestones, epics and tasks you can step into and fold | `SPC g l` |
| **Wiki** | The repository's wiki pages: page list on one side, the page on the other | `SPC g w` |

Click a tab, or focus the tab bar and use `←` / `→`. Switching tabs keeps the list's cursor, filter and sort. The
shortcut `Tab` folds and unfolds a whole group in the list; it does not switch tabs.

## Detail pane

Choosing a task shows its detail: status, priority, assignee, labels, blocked-by, body, subtasks and history. The
detail sits **below** the list by default and can sit **on the left** when the panel is at least 640 px wide (a
narrower panel keeps it below). The small position button in the toolbar, or `SPC o d`, toggles left ↔ below.
`SPC v d` hides and shows the detail; `SPC v r` switches the body between rendered markdown and the raw text.
`Enter` on a task moves focus to the detail; `SPC w w` (or a click) moves focus between panes.

## Search, filter, sort, view, column

All of these have a toolbar control and a key.

- **Search** (`/`) — title and body search; `Tab` cycles the search scope, `Enter` applies, `Esc` cancels.
- **Filter** (`SPC f`) — the same filter syntax as `moai tui`; `Tab` completes, `↑`/`↓` pick a value, `Enter` applies.
  `Esc` in the list clears an applied search or filter.
- **Sort** (`SPC s`) — `p c u s a t` sorts by priority, created, updated, status, assignee, title; press again to flip
  the direction. The capital letter appends the field to the current order. `SPC s e` opens the sort editor.
- **View** (`SPC v`) — show or hide Deferred (`l`), Backlog (`b`) and Archived (`o`); `a` shows everything; `1`~`9`
  toggle the nth status column; `d` the detail; `r` raw/rendered body.
- **Column** (`SPC c`) — list columns: `i` id, `p` priority, `a` assignee, `c` created, `u` updated, `n` counts,
  `t` tags, `e` epic, `h` names.

Your sort, view and column choices are remembered between sessions where the host allows panel storage, and kept for
the session otherwise.

## Read and unread

Tasks that changed since you last looked carry a **NEW** mark. `r` marks the task under the cursor read, `SPC m g`
marks the whole group read, and `SPC m a` marks everything read. Marking read writes your personal Moai read state
(`moai read`); Desktop asks for approval of that write.

## Keyboard

- Typing in an input (search, filter, add) turns the single-key shortcuts off, and nothing is handled during IME
  composition there. Outside an input the letter keys work with a Korean (or other non-Latin) input source too:
  the key's position counts, so `ㅓ` is `j`.
- `Enter` and `Space` on a focused button, link or checkbox press that control instead of running a shortcut.
- Sequences work as in vim: `gg`, and `SPC` followed by letters. `SPC` opens a menu showing what each next key does;
  `Esc` or `SPC` closes it, `Backspace` goes up one level, and clicking an item is the same as pressing its key.
- `Ctrl-w` window moves are taken by the Desktop (tab close) on Linux and Windows, so use `SPC w …` there; macOS
  accepts both.

### Shortcut table

**Move** (list, kanban, detail, wiki)

| Key | Does |
|---|---|
| `j` `↓` / `k` `↑` | One line down / up (kanban: within the column) |
| `gg` `Home` / `G` `End` | Top / bottom (kanban: of the column) |
| `Ctrl-d` / `Ctrl-u` | Half page down / up; the cursor stays |
| `Ctrl-f` `PageDown` / `Ctrl-b` `PageUp` | Page down / up |
| mouse wheel | Scrolls the pane under the pointer; the next `j`/`k` brings the view back to the cursor |

**Step in and fold**

| Key | Does |
|---|---|
| `Enter` | Step into a group; on a task, focus the detail |
| `Backspace` | Step out one level |
| `l` `→` / `h` `←` | Unfold / fold (kanban: column to the right / left) |
| `Tab` | Unfold / fold everything under the group (list) |

**Panes and tabs**

| Key | Does |
|---|---|
| `SPC w w` / `SPC w W` | Next / previous pane (`Ctrl-w w` / `Ctrl-w W` on macOS) |
| `SPC w h` `j` `k` `l` | Pane to the left / below / above / right (those valid for the detail position) |
| `SPC g l` `b` `w` | List / kanban / wiki tab |
| `SPC o d` | Detail position: left ↔ below |

**Search, filter, add**

| Key | Does |
|---|---|
| `/` or `SPC /` | Search |
| `SPC f` | Filter |
| `Esc` | Clear the applied search / filter |
| `SPC n` | Add a task (opens the add field) |
| `?` or `SPC ?` | Shortcut overlay |

**Read**

| Key | Does |
|---|---|
| `r` | Mark the cursor task read |
| `SPC m g` | Mark the group read |
| `SPC m a` | Mark all read |

**View, sort, column** (`SPC v`, `SPC s`, `SPC c`) — as listed above.

**Inside the search / filter input**

| Key | Does |
|---|---|
| `Enter` / `Esc` | Apply / cancel and return to the previous cursor |
| `Tab` / `Shift-Tab` | Cycle search scope · complete a filter |
| `↑` / `↓` | Pick a filter value |
| `Ctrl-u` | Clear the input |
| `Alt-Backspace` (`Ctrl-w` on macOS) | Delete a word |

**Sort editor** (`SPC s e`)

| Key | Does |
|---|---|
| `j` `k` | Move in the list |
| `J` `K` | Move the field later / earlier in the order |
| `SPC` | Add / remove the field |
| `d` | Flip direction |
| `Enter` / `D` / `Esc` | Apply / save as default / cancel |

**Wiki tab**

| Key | Does |
|---|---|
| move keys | Move in the focused side (page list or page) |
| `Enter` | Open the page (list); choose / follow a link (page) |
| `Tab` / `Shift-Tab` | Next / previous link in the page |
| `Backspace` `h` `←` | Back along the path you came by |
| `/` | Search titles and bodies |
| `Esc` | Clear the selected link, then the search |
| `SPC v r` | Raw / rendered page |

Not in the panel: switching between projects (`0`~`9`), registering projects, the stats screen, time zone and mouse
options, and the worktree overlap column. The panel is tied to the conversation's one project.
