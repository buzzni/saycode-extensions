// Shortcut help overlay (opened by the 'help' action: ? and SPC ?) and the small kbd hints used next to toolbar
// controls and in the 보기 menu shortcut column.

import { helpSections, keyLabel, type KeyContext, type Mode, type Platform } from "../keys/table.ts"
import { el, iconButton, kbd } from "./components.ts"

/** A <kbd> chip per key notation ('/' next to search, 'C-d' → 'Ctrl-d'); several notations sit side by side. */
export function kbdHint(doc: Document, notation: string | ReadonlyArray<string>): HTMLElement {
  const list = typeof notation === "string" ? [notation] : notation
  const wrap = el(doc, "span", { class: "m-kbd-hint" })
  for (const n of list) wrap.append(kbd(doc, keyLabel(n)))
  return wrap
}

/** "클릭하면 키보드를 쓸 수 있습니다" (keybindings.md 1): shown while the panel has no keyboard focus. */
export function focusHint(doc: Document): HTMLElement {
  return el(doc, "div", { class: "m-focus-hint", role: "status" }, "클릭하면 키보드를 쓸 수 있습니다")
}

export interface HelpProps {
  platform: Platform
  /** Called after the overlay closed itself (Esc or the close button). */
  onClose?: () => void
}

export interface HelpView {
  el: HTMLElement
  /** Draw the sections for the mode and context, show the overlay and take focus. */
  open: (mode: Mode, ctx: KeyContext) => void
  close: () => void
  isOpen: () => boolean
}

export function createHelp(doc: Document, props: HelpProps): HelpView {
  const root = el(doc, "div", {
    class: "m-menu m-help",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "단축키 도움말",
    tabindex: -1,
    hidden: true,
  })
  const close = (): void => {
    if (root.hidden) return
    root.hidden = true
    root.replaceChildren()
    props.onClose?.()
  }
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  })
  const open = (mode: Mode, ctx: KeyContext): void => {
    const head = el(doc, "div", { class: "m-help-head" }, el(doc, "strong", {}, "단축키"))
    head.append(iconButton(doc, { icon: "x", label: "닫기", onClick: close }))
    const body = el(doc, "div", { class: "m-help-body" })
    for (const section of helpSections(mode, ctx, props.platform)) {
      const list = el(doc, "div", { class: "m-help-section", role: "group", "aria-label": section.title })
      list.append(el(doc, "h3", { class: "m-help-title" }, section.title))
      for (const row of section.rows) {
        const keys = el(doc, "span", { class: "m-help-keys" })
        for (const k of row.keys) keys.append(kbd(doc, keyLabel(k)))
        list.append(
          el(doc, "div", { class: "m-help-row", "data-action": row.action, "data-available": String(row.available) },
            el(doc, "span", { class: "m-help-label" }, row.label), keys),
        )
      }
      body.append(list)
    }
    root.replaceChildren(head, body)
    root.hidden = false
    root.focus?.()
  }
  return { el: root, open, close, isOpen: () => !root.hidden }
}
