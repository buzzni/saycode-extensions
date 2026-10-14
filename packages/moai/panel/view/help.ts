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

/** "클릭하면 키보드를 쓸 수 있습니다" (keybindings.md 1): shown while the panel has no keyboard focus. `text` is the
 *  i18n catalogue's (copy.keys.focusHint). */
export function focusHint(doc: Document, text = "클릭하면 키보드를 쓸 수 있습니다"): HTMLElement {
  return el(doc, "div", { class: "m-focus-hint", role: "status" }, text)
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

/**
 * Keys a focused control behind the help acts on with a modifier held too: Enter and Space press a button, the
 * arrows, Home and End move the tab strip and the split resizer, Backspace and Delete edit an input, Esc leaves the
 * search.
 */
const ACTS_BEHIND: ReadonlySet<string> = new Set([
  "Enter", " ", "Escape", "Esc", "Backspace", "Delete",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
])

export function createHelp(doc: Document, props: HelpProps): HelpView {
  const root = el(doc, "div", {
    class: "m-menu m-help",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": "단축키 도움말",
    tabindex: -1,
    hidden: true,
  })
  /** Where focus was before the overlay took it; it goes back there on close. */
  let returnTo: Element | null = null
  const close = (): void => {
    if (root.hidden) return
    doc.removeEventListener("keydown", guard, true)
    root.hidden = true
    root.replaceChildren()
    const back = returnTo as HTMLElement | null
    returnTo = null
    if (back && back !== doc.body && back.isConnected) back.focus?.()
    props.onClose?.()
  }
  /**
   * While the overlay is open nothing behind it takes a key: a key pressed with the focus outside it (a click behind
   * it moved the focus) neither clicks a focused button nor types into an input — the focus comes back to the
   * overlay, and Esc closes it. Tab inside it stays inside it. On the document in the capture phase, so it runs
   * before any control's own keydown listener. The host's combinations (copy, find, a tab switch: Cmd/Meta, and Ctrl
   * off macOS) go on untouched, the focus stays where it is, and the key router (wiring.ts intercept) keeps the
   * panel's own shortcuts from running on them. Stopped all the same: a key a control behind acts on whatever the
   * modifier ({@link ACTS_BEHIND}), Ctrl+Alt (AltGr on Windows, which types a character), and Ctrl on macOS (Ctrl+H,
   * Ctrl+K edit text there).
   */
  function guard(event: KeyboardEvent): void {
    const host = event.metaKey || (event.ctrlKey && !event.altKey && props.platform !== "mac")
    if (root.hidden || (host && !ACTS_BEHIND.has(event.key))) return
    const target = event.target as Node | null
    const inside = target !== null && root.contains(target)
    if (inside && event.key !== "Tab") return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === "Escape" || event.key === "Esc") return close()
    if (!inside) return root.focus?.()
    // Tab: between the overlay itself and its close button, its only control.
    const closeButton = root.querySelector<HTMLElement>(".m-help-head button")
    ;(doc.activeElement === closeButton || !closeButton ? root : closeButton).focus?.()
  }
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  })
  const open = (mode: Mode, ctx: KeyContext): void => {
    if (root.hidden) {
      returnTo = doc.activeElement
      doc.addEventListener("keydown", guard, true)
    }
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
