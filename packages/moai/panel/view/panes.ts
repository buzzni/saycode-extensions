// Which view fills each pane of the shell (contract: view/types.ts). One import and one entry per pane, on
// lines of their own, so the stage that replaces a pane's view edits only its own two lines.
import type { Panes } from "./types.ts"
import { mountList } from "./list.ts"
import { mountBoard } from "./board.ts"
import { mountDetail } from "./detail.ts"

export const PANES: Panes = {
  list: mountList,
  board: mountBoard,
  detail: mountDetail,
  // wiki: the wiki tab (E7 se-rhu3) — until it is named here the tab shows a placeholder.
}
