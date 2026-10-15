# Moai panel guide

The Moai panel (2.0) is a keyboard-first board for the project's Moai tasks: three tabs, a detail pane, search, filter,
sort, column and view controls, and unread marks. This page describes it as you use it; the shortcut table at the end
lists every key.

## Open it

In a project conversation, open the work area More menu and choose **Moai**. The host opens the board as a tab. Keys
reach the panel only once it has focus, so click it once; until then it shows a "Click to use the keyboard" hint.
Press `?` any time outside an input for the shortcut overlay.

## Tabs

| Tab | Shows | Switch |
|---|---|---|
| **Board** | The kanban: one column per status, with Backlog and Deferred columns and a lane per milestone | `SPC g b` |
| **List** | The task tree: milestones, epics and tasks you can step into and fold | `SPC g l` |
| **Wiki** | The repository's wiki pages: page list on one side, the page on the other | `SPC g w` |

Click a tab, or focus the tab bar and use `←` / `→`. Switching tabs keeps the list's cursor, filter and sort. The
shortcut `Tab` folds and unfolds a whole group in the list; it does not switch tabs.

## Detail pane

Choosing a task shows its detail: status, priority, assignee, labels, blocked-by, body, subtasks and history. The
detail sits **below** the list by default and can sit **on the left** when the panel is at least 640 px wide (a
narrower panel keeps it below). The small position button in the tab bar, or `SPC o d`, toggles left ↔ below.
The eye button beside it, or `SPC v d`, hides and shows the detail; `SPC v r` switches the body between rendered
markdown and the raw text. `Enter` on a task moves focus to the detail; `SPC w w` (or a click) moves focus between
panes.

## Search, filter, sort, view, column

Search, filter and sort have a toolbar control and a key. View and column are in the `SPC` menu, whose items can be
clicked as well as pressed.

- **Search** (`/`) — searches as you type, in the scope the select beside it shows: all, id, title, tag or body.
  `Tab` cycles the scope. The select's last line says notes are not searched: no scope reads `moai note` texts.
  `Enter` keeps the search and goes back to the list; `Esc` closes it and puts the cursor back where `/` found it.
- **Filter** (`SPC f`) — the same filter syntax as `moai tui`; `Tab` completes, `↑`/`↓` pick a value, `Enter` applies.
  `Esc` in the list clears an applied search or filter.
- **Sort** (`SPC s`) — `p c u s a t` sorts by priority, created, updated, status, assignee, title; press again to flip
  the direction. The capital letter appends the field to the current order (or flips it when it is in the order
  already). `SPC s e`, or the sort button in the toolbar, opens the sort editor.
- **View** (`SPC v`) — show or hide Deferred (`l`), Backlog (`b`) and Archived (`o`); `a` shows all but the archive
  (deferred, backlog and every status column); `1`~`9` toggle the nth status column; `d` the detail; `r` raw/rendered
  body.
- **Column** (`SPC c`) — list columns: `i` id, `p` priority, `a` assignee, `c` created, `u` updated, `n` counts,
  `t` tags, `e` epic, `h` names.

The panel remembers its tab and where the detail sits, whether it shows and how large it is between openings, where
the panel's frame can keep local storage. The search scope, filter, sort, view and column choices, and the default
order `D` saves in the sort editor, last only while the panel stays open: Desktop gives extensions no settings
storage yet, and the sort editor says so.

## Read and unread

Tasks near you (yours, their subtasks and the members of your epics) that changed since you last read them carry a
**NEW** mark, and the Board and List tabs show how many there are. `r` marks the task under the cursor read, `SPC m g`
marks the group under the cursor (or the milestone or epic you are in) read, and `SPC m a` marks everything unread
read. Marking read writes only your own read state in your Moai user config (`moai read`), nothing in the project, so
Desktop approves each of the three like a read: once per machine and folder for the session.

## Loading

The panel reads the project's whole list (`moai show --all`, the backlog and `moai status`) and filters, sorts and
groups it itself, so keys answer at once. It reads the list again every 10 seconds while it is on screen, after you
mark something read, and when you click the refresh time in the tab bar. If you decline a list read at its
confirmation, or leave it unanswered, automatic refresh pauses so the confirmation does not come back by itself, and a
line says so; the next list read that goes through (click the refresh time) starts it again. While something you asked
for runs, a toast at the foot of the panel says so (with Cancel once it runs) without moving the list; clicks pass
through it to the rows. The automatic reads run quietly. A task's detail, the archive (`SPC v o`) and wiki pages are read when
you open them. When the machine's `moai` is missing or older than the panel expects, or the Happy daemon's catalog
lacks some of the panel's runs, a banner says what to install, upgrade or update there; what can still be read keeps
showing. Without the whole list the board stands on the tasks you hold and the ones ready to pick up, and a second
banner says so: done, deferred and the other to-do tasks are not on it then, so an empty Done column does not mean
nothing is done. The panel then does not run the archive or read marks either (they reach a catalog together with the
whole list), so no confirmation asks for a command that machine would refuse; the banner names them when you use them.

## Confirmations

The panel only reads. Desktop asks once per kind of read (the list, the backlog, the counts, a detail, the wiki, the
archive, a read mark), per machine and project folder, while Desktop stays open; it asks again after Desktop restarts
or the extension is updated.

## Keyboard

- Typing in an input (search, filter) turns the single-key shortcuts off, and nothing is handled during IME
  composition there. Outside an input the letter keys work with a Korean (or other non-Latin) input source too:
  the key's position counts, so `ㅓ` is `j`.
- `Enter` and `Space` on a focused button, link or checkbox press that control instead of running a shortcut.
- Sequences work as in vim: `gg`, and `SPC` followed by letters. `SPC` opens a menu showing what each next key does;
  `Esc` or `SPC` closes it, `Backspace` goes up one level, and clicking an item is the same as pressing its key.
- `Ctrl-w` window moves are taken by the Desktop (tab close) on Linux and Windows, so use `SPC w …` there; macOS
  accepts both.

### Shortcut table

**Move** (list, board, detail, wiki)

| Key | Does |
|---|---|
| `j` `↓` / `k` `↑` | One line down / up (board: within the column) |
| `gg` `Home` / `G` `End` | Top / bottom (board: of the column) |
| `Ctrl-d` / `Ctrl-u` | Half page down / up; the cursor stays (the wiki's page list moves its cursor) |
| `Ctrl-f` `PageDown` / `Ctrl-b` `PageUp` | Page down / up |
| mouse wheel | Scrolls the pane under the pointer; the next `j`/`k` brings the view back to the cursor |

**Step in and fold**

| Key | Does |
|---|---|
| `Enter` | Step into a group; on a task, focus the detail |
| `Backspace` | Step out one level |
| `l` `→` / `h` `←` | Unfold / fold (board: column to the right / left) |
| `Tab` | Unfold / fold everything under the group (list) |

**Panes and tabs**

| Key | Does |
|---|---|
| `SPC w w` / `SPC w W` | Next / previous pane (`Ctrl-w w` / `Ctrl-w W` on macOS) |
| `SPC w h` `j` `k` `l` | Pane to the left / below / above / right (those valid for the detail position) |
| `SPC g l` `b` `w` | List / board / wiki tab |
| `SPC o d` | Detail position: left ↔ below |

**Search, filter**

| Key | Does |
|---|---|
| `/` or `SPC /` | Search |
| `SPC f` | Filter |
| `Esc` | Clear the applied search / filter |
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
| `Enter` / `D` / `Esc` | Apply / apply and save as the default (for while the panel is open) / cancel |

**Wiki tab**

| Key | Does |
|---|---|
| move keys | Move in the focused side (page list or page) |
| `l` `→` | From the page list to the page |
| `SPC w w` / `SPC w h` `l` | Between the page list and the page (`Ctrl-w …` on macOS) |
| `Enter` | Open the page (list); choose / follow a link (page) |
| `Tab` / `Shift-Tab` | Next / previous link in the page |
| `Backspace` `h` `←` | Back along the path you came by |
| `/` | Search titles and bodies |
| `Esc` | Clear the selected link, then the search |
| `SPC v r` | Raw / rendered page |

Not in the panel: switching between projects (`0`~`9`), registering projects, the stats screen, time zone and mouse
options, and the worktree overlap column. The panel is tied to the conversation's one project.
