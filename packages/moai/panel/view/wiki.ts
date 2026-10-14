// Wiki tab: the page list on the left, the rendered page on the right (design.md 4.10, tui-analysis.md 10).
// Standalone: pages come in through setPages(), page bodies through props.loadPage(), and the view keeps its
// own state (current page, trail, search, selected link, raw toggle) — design.md 1.2. state()/restore() let the
// shell carry that state across tab switches. Keys go through handleKey(); a keydown listener on the root
// calls it too unless props.standaloneKeys is false. All text goes in through textContent.

import { banner, button, chip, el, emptyState, listRow, searchBox, type ChipTone } from "./components.ts"
import { githubAnchor, renderMarkdown, type LinkTarget } from "./markdown.ts"
import { FORCE_BOTTOM_BELOW } from "./responsive.ts"
import { createSplit, normalizeRatio } from "./split.ts"

// ---- Data shapes (`moai wiki ls --json` / `moai wiki show <slug> --json`) ----

export interface WikiIssueRef {
  id: string
  exists?: boolean
}

export interface WikiLink {
  text: string
  to: string
  resolved?: boolean
  anchor?: string
}

export interface WikiProblem {
  kind: string
  said: string
}

export interface WikiPage {
  slug: string
  title: string
  path: string
  bytes?: number
  issues: WikiIssueRef[]
  links: WikiLink[]
  linked_from: string[]
  /** `show` only: true when some page could not be read, so linked_from may be short. */
  linked_from_partial?: boolean
  conflict: boolean
  /** Set when the body could not be read (too_large, refused, failed). */
  error?: WikiProblem
  headings?: unknown[]
  /** `show` only. */
  body?: string
}

export interface WikiSkipped {
  path: string
  kind: string
  said: string
}

export interface WikiListing {
  dir: string
  pages: WikiPage[]
  skipped: WikiSkipped[]
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

/** Pages over this many bytes are listed but not read (moai `wiki::TOO_LARGE`). */
export const TOO_LARGE = 1024 * 1024

const HOMES = ["readme", "index"]

// ---- Parsers ----

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const str = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

function decodeJson(input: unknown): Parsed<unknown> {
  if (typeof input !== "string") return { ok: true, value: input }
  try {
    return { ok: true, value: JSON.parse(input) }
  } catch (error) {
    return { ok: false, error: `위키 응답을 읽지 못했습니다: ${(error as Error).message}` }
  }
}

function problem(value: unknown): WikiProblem | undefined {
  if (typeof value === "string") return value ? { kind: "failed", said: value } : undefined
  if (!isObject(value)) return undefined
  const kind = str(value.kind) ?? "failed"
  return { kind, said: str(value.said) ?? str(value.message) ?? kind }
}

/** One page object to a WikiPage, or null when it has no slug. Everything beyond the slug is optional. */
export function normalizePage(value: unknown): WikiPage | null {
  if (!isObject(value)) return null
  const slug = str(value.slug)
  if (!slug) return null
  const issues: WikiIssueRef[] = []
  if (Array.isArray(value.issues)) {
    for (const item of value.issues) {
      if (typeof item === "string") issues.push({ id: item })
      else if (isObject(item) && str(item.id)) issues.push({ id: item.id as string, exists: typeof item.exists === "boolean" ? item.exists : undefined })
    }
  }
  const links: WikiLink[] = []
  if (Array.isArray(value.links)) {
    for (const item of value.links) {
      if (!isObject(item) || !str(item.to)) continue
      links.push({ text: str(item.text) ?? "", to: item.to as string, resolved: typeof item.resolved === "boolean" ? item.resolved : undefined, anchor: str(item.anchor) })
    }
  }
  const page: WikiPage = {
    slug,
    title: str(value.title) || slug,
    path: str(value.path) ?? "",
    issues,
    links,
    linked_from: Array.isArray(value.linked_from) ? value.linked_from.filter((s): s is string => typeof s === "string") : [],
    conflict: value.conflict === true,
  }
  if (typeof value.bytes === "number" && Number.isFinite(value.bytes)) page.bytes = value.bytes
  if (value.linked_from_partial === true) page.linked_from_partial = true
  const error = problem(value.error)
  if (error) page.error = error
  if (Array.isArray(value.headings)) page.headings = value.headings
  if (typeof value.body === "string") page.body = value.body
  return page
}

/** `moai wiki ls --json` (text or parsed): `{dir, pages, skipped?}`, or `{dir, error}` when the folder cannot be used. */
export function parseWikiLs(input: unknown): Parsed<WikiListing> {
  const decoded = decodeJson(input)
  if (!decoded.ok) return decoded
  const json = decoded.value
  if (!isObject(json)) return { ok: false, error: "위키 목록 응답의 꼴이 맞지 않습니다." }
  const dir = str(json.dir) ?? ""
  if (json.error !== undefined && !Array.isArray(json.pages)) {
    return { ok: false, error: problem(json.error)?.said ?? "위키 폴더를 읽지 못했습니다." }
  }
  if (!Array.isArray(json.pages)) return { ok: false, error: "위키 목록 응답에 pages가 없습니다." }
  const pages = json.pages.map(normalizePage).filter((p): p is WikiPage => p !== null)
  const skipped: WikiSkipped[] = Array.isArray(json.skipped)
    ? json.skipped.filter(isObject).map((s) => ({ path: str(s.path) ?? "", kind: str(s.kind) ?? "", said: str(s.said) ?? "" }))
    : []
  return { ok: true, value: { dir, pages, skipped } }
}

/** `moai wiki show <slug> --json` (text or parsed): the page fields plus `body`. */
export function parseWikiShow(input: unknown): Parsed<WikiPage> {
  const decoded = decodeJson(input)
  if (!decoded.ok) return decoded
  const json = decoded.value
  if (isObject(json) && json.error !== undefined && !str(json.slug)) {
    return { ok: false, error: problem(json.error)?.said ?? "위키 페이지를 읽지 못했습니다." }
  }
  const page = normalizePage(json)
  return page ? { ok: true, value: page } : { ok: false, error: "위키 페이지 응답의 꼴이 맞지 않습니다." }
}

// ---- Ordering, warnings, search ----

const basename = (slug: string): string => slug.slice(slug.lastIndexOf("/") + 1)

/** README and index first (the wiki root's before a folder's), then by lowercased title, then by slug. Stable. */
export function homeRank(slug: string): number {
  const home = HOMES.indexOf(basename(slug).toLowerCase())
  if (home < 0) return HOMES.length * 2
  return slug.includes("/") ? HOMES.length + home : home
}

export function sortPages<T extends { slug: string; title?: string }>(pages: ReadonlyArray<T>): T[] {
  return pages
    .map((page, index) => ({ page, index }))
    .sort((a, b) => {
      const rank = homeRank(a.page.slug) - homeRank(b.page.slug)
      if (rank) return rank
      // Code-point order of the lowercased titles, as moai sorts (not localeCompare, which follows the host locale).
      const ta = (a.page.title || a.page.slug).toLowerCase()
      const tb = (b.page.title || b.page.slug).toLowerCase()
      if (ta !== tb) return ta < tb ? -1 : 1
      if (a.page.slug !== b.page.slug) return a.page.slug < b.page.slug ? -1 : 1
      return a.index - b.index
    })
    .map((entry) => entry.page)
}

export interface PageWarning {
  kind: "conflict" | "error" | "large"
  label: string
  tone: ChipTone
  /** The longer explanation, for the chip's title. */
  detail: string
}

/** Warning chips for a page: git conflict markers, an unreadable body, more than 1 MB. */
export function pageWarnings(page: Pick<WikiPage, "conflict" | "error" | "bytes">): PageWarning[] {
  const out: PageWarning[] = []
  if (page.conflict) out.push({ kind: "conflict", label: "충돌", tone: "danger", detail: "git 충돌 표시가 남아 있습니다." })
  const large = (page.bytes ?? 0) > TOO_LARGE || page.error?.kind === "too_large"
  if (page.error && page.error.kind !== "too_large") out.push({ kind: "error", label: "못 읽음", tone: "danger", detail: page.error.said })
  if (large) out.push({ kind: "large", label: "1MB 초과", tone: "warn", detail: page.error?.kind === "too_large" ? page.error.said : "1MB가 넘어 본문을 읽지 않습니다." })
  return out
}

export type BodySource = ReadonlyMap<string, string> | Readonly<Record<string, string>>

function bodyOf(bodies: BodySource | undefined, page: { slug: string; body?: string }): string | undefined {
  if (typeof page.body === "string") return page.body
  if (!bodies) return undefined
  if (typeof (bodies as ReadonlyMap<string, string>).get === "function") return (bodies as ReadonlyMap<string, string>).get(page.slug)
  const value = (bodies as Record<string, string>)[page.slug]
  return typeof value === "string" ? value : undefined
}

/** Case-insensitive substring over the title, and over the body when it is known (loaded or passed in). */
export function filterPages<T extends { slug: string; title: string; body?: string }>(pages: ReadonlyArray<T>, query: string, bodies?: BodySource): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return pages.slice()
  return pages.filter((page) => {
    if (page.title.toLowerCase().includes(q)) return true
    const body = bodyOf(bodies, page)
    return body !== undefined && body.toLowerCase().includes(q)
  })
}

// ---- Link targets (port of moai `wiki::target`) ----

/** `%XX` to bytes, read as UTF-8; anything malformed or not UTF-8 comes back as given. */
export function unpercent(text: string): string {
  if (!text.includes("%")) return text
  const bytes: number[] = []
  const raw = new TextEncoder().encode(text)
  const hex = (c: number | undefined): number => {
    if (c === undefined) return -1
    if (c >= 48 && c <= 57) return c - 48
    if (c >= 65 && c <= 70) return c - 55
    if (c >= 97 && c <= 102) return c - 87
    return -1
  }
  for (let i = 0; i < raw.length; i++) {
    const h = raw[i] === 37 ? hex(raw[i + 1]) : -1
    const l = h >= 0 ? hex(raw[i + 2]) : -1
    if (h >= 0 && l >= 0) {
      bytes.push(h * 16 + l)
      i += 2
    } else bytes.push(raw[i]!)
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes))
  } catch {
    return text
  }
}

/**
 * What an href written in page `fromSlug` points at. Only relative `.md` paths landing inside the wiki are
 * wiki links, resolved against the folder of the page they are written in; `?query` is dropped, `%XX` decoded,
 * and `#anchor` split off (decoded, GitHub-slugged). `#x` alone is a heading on this page. Absolute paths,
 * `scheme:` addresses, other files and paths climbing out of the wiki root are external. With `knownSlugs`, a
 * wiki link to a page that is not there is external too, so it is shown and never followed.
 */
export function resolveWikiTarget(fromSlug: string, href: string, knownSlugs?: Iterable<string>): LinkTarget {
  const external: LinkTarget = { kind: "external", href }
  const hash = href.indexOf("#")
  const head = hash < 0 ? href : href.slice(0, hash)
  const fragment = hash < 0 ? "" : unpercent(href.slice(hash + 1))
  const anchor = fragment ? githubAnchor(fragment) : ""
  if (!head) return anchor ? { kind: "anchor", anchor } : external
  if (head.startsWith("/") || head.startsWith("\\")) return external
  if (head.split("/")[0]!.includes(":")) return external
  const path = unpercent(head.split("?")[0]!)
  if (!path.endsWith(".md")) return external
  const segs = path.slice(0, -3).split("/")
  const last = segs[segs.length - 1]
  if (last === undefined || last === "" || last === "." || last === "..") return external
  const parts = fromSlug.split("/")
  parts.pop()
  for (const seg of segs) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") {
      if (!parts.length) return external
      parts.pop()
    } else parts.push(seg)
  }
  const slug = parts.join("/")
  if (knownSlugs) {
    const known = knownSlugs instanceof Set ? (knownSlugs as Set<string>) : new Set(knownSlugs)
    if (!known.has(slug)) return external
  }
  return anchor ? { kind: "wiki", slug, anchor } : { kind: "wiki", slug }
}

// ---- Trail ----

export interface TrailEntry {
  slug: string
  scrollTop: number
}

export const TRAIL_LIMIT = 100

/** The trail with `entry` on top; the oldest entries fall off past `limit`. */
export function pushTrail(trail: ReadonlyArray<TrailEntry>, entry: TrailEntry, limit = TRAIL_LIMIT): TrailEntry[] {
  const next = [...trail, { slug: entry.slug, scrollTop: Math.max(0, entry.scrollTop || 0) }]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/** The top entry and the trail without it, or null when the trail is empty. */
export function popTrail(trail: ReadonlyArray<TrailEntry>): { entry: TrailEntry; trail: TrailEntry[] } | null {
  if (!trail.length) return null
  return { entry: trail[trail.length - 1]!, trail: trail.slice(0, -1) }
}

/** The next selected link for Tab (+1) or Shift-Tab (-1) among `count` links; wraps. -1 means none. */
export function cycleIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1
  if (current < 0 || current >= count) return delta > 0 ? 0 : count - 1
  return (current + delta + count) % count
}

// ---- View ----

export type WikiPane = "list" | "body"

export interface WikiState {
  /** The page shown on the right. */
  current: string | null
  /** The list cursor. */
  cursor: string | null
  trail: TrailEntry[]
  query: string
  raw: boolean
  scrollTop: number
  selectedLink: number
  pane: WikiPane
}

export interface WikiViewProps {
  /** Fetch one page (`moai wiki show <slug> --json`, parsed or not). */
  loadPage: (slug: string) => Promise<unknown>
  /** An issue id link was followed: the shell jumps to that row on the list tab. */
  onIssue?: (id: string) => void
  /** The list's share of the width (the `wiki_width` setting) after a drag or key press. */
  onRatio?: (ratio: number) => void
  ratio?: number
  width?: number
  pages?: WikiPage[]
  state?: Partial<WikiState>
  /** Attach a keydown listener on the root that calls handleKey (default true). */
  standaloneKeys?: boolean
  /** How long a heading reached by an anchor stays highlighted, in ms. */
  flashMs?: number
}

export interface WikiView {
  el: HTMLDivElement
  setPages(pages: ReadonlyArray<WikiPage>, dir?: string): void
  setError(text: string | null): void
  setLoading(loading: boolean): void
  /** Seed a body for search (e.g. from a prefetch). */
  setBody(slug: string, body: string): void
  /** Show a page. push=true records the current page and scroll on the trail first. */
  open(slug: string, options?: { anchor?: string; push?: boolean; scrollTop?: number }): Promise<void>
  back(): Promise<boolean>
  selectLink(delta: 1 | -1): void
  clearLinkSelection(): boolean
  followSelected(): Promise<void>
  follow(target: LinkTarget | { kind: "issue"; id: string }): Promise<void>
  scrollToAnchor(anchor: string): boolean
  toggleRaw(): void
  setQuery(query: string): void
  focusSearch(): void
  focusPane(pane: WikiPane): void
  handleKey(event: KeyboardEvent): boolean
  setWidth(width: number): void
  setRatio(ratio: number): void
  state(): WikiState
  restore(state: Partial<WikiState>): Promise<void>
  /** Links in the body, in Tab order (rendered links, then backlinks). */
  links(): HTMLAnchorElement[]
  destroy(): void
}

const DEFAULT_LIST_SHARE = 0.3
const DEFAULT_FLASH_MS = 1500
const LINE_PX = 40

function isTextInput(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).tagName !== "string") return false
  const node = target as HTMLElement
  const tag = node.tagName.toLowerCase()
  return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable === true || node.getAttribute?.("contenteditable") === "true"
}

const folderOf = (slug: string): string => (slug.includes("/") ? slug.slice(0, slug.lastIndexOf("/") + 1) : "")

export function createWikiView(doc: Document, props: WikiViewProps): WikiView {
  const flashMs = props.flashMs ?? DEFAULT_FLASH_MS
  let pages: WikiPage[] = []
  let dir = ""
  let listError: string | null = null
  let listLoading = false
  const bodies = new Map<string, string>()

  let current: string | null = null
  let page: WikiPage | null = null
  let pageLoading = false
  let pageError: string | null = null
  let cursor: string | null = null
  let trail: TrailEntry[] = []
  let query = ""
  let raw = false
  let selected = -1
  let pane: WikiPane = "list"
  let links: HTMLAnchorElement[] = []
  let headingNodes = new Map<string, HTMLElement>()
  let request = 0
  let flashTimer: ReturnType<typeof setTimeout> | null = null

  // -- skeleton --
  const search = searchBox(doc, { placeholder: "위키 검색", label: "위키 제목과 본문 검색", hint: "/" })
  search.el.classList.add("m-wiki-search")
  const toolbar = el(doc, "div", { class: "m-toolbar m-wiki-toolbar" }, search.el)

  const listBox = el(doc, "div", { class: "m-wiki-list", role: "listbox", "aria-label": "위키 페이지" })
  const listNote = el(doc, "div", { class: "m-wiki-list-note" })
  const listPane = el(doc, "div", { class: "m-wiki-pages" }, listNote, listBox)

  const titleEl = el(doc, "h2", { class: "m-wiki-title" })
  const pathEl = el(doc, "div", { class: "m-wiki-path" })
  const backButton = button(doc, { label: "되감기", icon: "corner-left-up", variant: "ghost", small: true, onClick: () => void back() })
  const rawButton = button(doc, { label: "원문", variant: "ghost", small: true, onClick: () => toggleRaw() })
  rawButton.setAttribute("aria-pressed", "false")
  rawButton.title = "원문·렌더링 (SPC v r)"
  const head = el(doc, "div", { class: "m-wiki-head" }, el(doc, "div", { class: "m-wiki-heading" }, titleEl, pathEl), el(doc, "div", { class: "m-wiki-actions" }, backButton, rawButton))
  const status = el(doc, "div", { class: "m-wiki-status", role: "status", "aria-live": "polite" })
  const scroller = el(doc, "div", { class: "m-wiki-scroll", tabindex: 0, "aria-label": "위키 본문" })
  const bodyPane = el(doc, "div", { class: "m-wiki-body" }, head, status, scroller)

  const split = createSplit(doc, {
    position: "left",
    ratios: { left: props.ratio === undefined ? DEFAULT_LIST_SHARE : normalizeRatio(props.ratio, "left") },
    labels: { resizer: "위키 목록 폭 조절" },
    onRatio: (position, ratio) => {
      if (position === "left") props.onRatio?.(ratio)
    },
  })
  // The split's "detail" pane is the one drawn first (left), so it holds the page list; its ratio is wiki_width.
  split.detail.append(listPane)
  split.list.append(bodyPane)
  const root = el(doc, "div", { class: "m-wiki", "data-pane": pane }, toolbar, split.el)

  // -- list --
  const visiblePages = (): WikiPage[] => filterPages(pages, query, bodies)
  const titleOf = (slug: string): string => pages.find((p) => p.slug === slug)?.title ?? slug

  function paintList(): void {
    listNote.replaceChildren()
    listBox.replaceChildren()
    if (listError) {
      listNote.append(banner(doc, "danger", listError))
      return
    }
    if (listLoading && !pages.length) {
      listNote.append(emptyState(doc, { icon: "book-open", title: "위키를 불러오는 중입니다" }))
      return
    }
    if (!pages.length) {
      listNote.append(emptyState(doc, { icon: "book-open", title: "위키 페이지가 없습니다", hint: dir ? `${dir} 폴더에 .md 파일을 두면 여기에 섭니다.` : undefined }))
      return
    }
    const shown = visiblePages()
    if (!shown.length) {
      listNote.append(emptyState(doc, { icon: "search", title: "찾는 페이지가 없습니다", hint: "Esc로 검색을 지웁니다." }))
      return
    }
    if (!cursor || !shown.some((p) => p.slug === cursor)) cursor = shown.some((p) => p.slug === current) ? current : shown[0]!.slug
    for (const entry of shown) {
      const cells: Node[] = [el(doc, "span", { class: "m-row-title", title: entry.title }, entry.title)]
      for (const warning of pageWarnings(entry)) {
        const node = chip(doc, { label: warning.label, tone: warning.tone })
        node.title = warning.detail
        cells.push(node)
      }
      const folder = folderOf(entry.slug)
      if (folder) cells.push(el(doc, "span", { class: "m-row-meta m-wiki-folder" }, folder))
      const row = listRow(doc, { selected: entry.slug === cursor }, ...cells)
      row.dataset.slug = entry.slug
      if (entry.slug === current) row.setAttribute("aria-current", "page")
      row.addEventListener("click", () => {
        cursor = entry.slug
        pane = "list"
        void open(entry.slug)
      })
      listBox.append(row)
    }
  }

  function moveCursor(delta: number): void {
    const shown = visiblePages()
    if (!shown.length) return
    const index = shown.findIndex((p) => p.slug === cursor)
    const next = Math.max(0, Math.min(shown.length - 1, (index < 0 ? 0 : index + delta)))
    cursor = shown[next]!.slug
    paintList()
    focusCursorRow()
  }

  function focusCursorRow(): void {
    const row = listBox.querySelector<HTMLElement>('[aria-selected="true"]')
    row?.focus({ preventScroll: true })
    row?.scrollIntoView?.({ block: "nearest" })
  }

  // -- body --
  function setStatus(text: string): void {
    status.textContent = text
  }

  function backlinksSection(source: WikiPage): HTMLElement {
    const section = el(doc, "section", { class: "m-wiki-backlinks", "aria-label": "역링크" })
    section.append(el(doc, "div", { class: "m-wiki-backlinks-title" }, `역링크 ${source.linked_from.length}`))
    if (!source.linked_from.length) {
      section.append(el(doc, "div", { class: "m-wiki-backlinks-none" }, "이 페이지를 가리키는 문서가 없습니다."))
    } else {
      const list = el(doc, "ul", { class: "m-wiki-backlinks-list" })
      for (const slug of source.linked_from) {
        const link = el(doc, "a", { class: "m-md-link m-wiki-backlink", tabindex: -1, "data-kind": "wiki", "data-slug": slug }, titleOf(slug))
        list.append(el(doc, "li", {}, link, el(doc, "span", { class: "m-wiki-backlink-slug" }, slug)))
      }
      section.append(list)
    }
    if (source.linked_from_partial) section.append(el(doc, "div", { class: "m-wiki-backlinks-none" }, "읽지 못한 페이지가 있어 덜 셌을 수 있습니다."))
    return section
  }

  function paintBody(): void {
    selected = -1
    links = []
    headingNodes = new Map()
    scroller.replaceChildren()
    const listed = current ? pages.find((p) => p.slug === current) : undefined
    const shown = page ?? listed ?? null
    titleEl.textContent = shown?.title ?? (current ?? "")
    pathEl.textContent = shown?.path ?? ""
    backButton.disabled = trail.length === 0
    rawButton.setAttribute("aria-pressed", String(raw))
    if (!current) {
      scroller.append(emptyState(doc, { icon: "book-open", title: "페이지를 고르세요", hint: "목록에서 Enter로 엽니다." }))
      return
    }
    if (pageLoading) {
      scroller.append(emptyState(doc, { icon: "book-open", title: "페이지를 불러오는 중입니다" }))
      return
    }
    if (pageError) {
      scroller.append(banner(doc, "danger", pageError))
      return
    }
    if (!page) return
    if (page.conflict) scroller.append(banner(doc, "warn", "이 페이지에 git 충돌 표시가 남아 있습니다."))
    if (typeof page.body !== "string") {
      scroller.append(banner(doc, page.error?.kind === "too_large" ? "warn" : "danger", page.error?.said ?? "본문을 읽지 못했습니다."))
    } else if (raw) {
      scroller.append(el(doc, "pre", { class: "m-wiki-raw" }, page.body))
    } else {
      const from = page.slug
      const known = pages.length ? new Set(pages.map((p) => p.slug)) : undefined
      try {
        const rendered = renderMarkdown(doc, page.body, {
          resolveLink: (href) => resolveWikiTarget(from, href, known),
          issueIds: page.issues.map((issue) => issue.id),
        })
        rendered.root.classList.add("m-wiki-article")
        scroller.append(rendered.root)
        links.push(...rendered.links)
        for (const heading of rendered.headings) {
          const node = rendered.root.querySelector<HTMLElement>(`#${cssEscape("m-md-" + heading.anchor)}`)
          if (node && !headingNodes.has(heading.anchor)) headingNodes.set(heading.anchor, node)
        }
      } catch (error) {
        scroller.append(banner(doc, "warn", `렌더링하지 못해 원문을 보여 줍니다: ${(error as Error).message}`))
        scroller.append(el(doc, "pre", { class: "m-wiki-raw" }, page.body))
      }
    }
    const backlinks = backlinksSection(page)
    scroller.append(backlinks)
    links.push(...backlinks.querySelectorAll<HTMLAnchorElement>("a.m-md-link"))
  }

  function cssEscape(value: string): string {
    const css = (doc.defaultView as (Window & { CSS?: { escape?: (s: string) => string } }) | null)?.CSS
    if (css?.escape) return css.escape(value)
    return value.replace(/[^a-zA-Z0-9_ -￿-]/g, (c) => `\\${c}`)
  }

  function headingFor(anchor: string): HTMLElement | null {
    const known = headingNodes.get(anchor)
    if (known) return known
    for (const node of scroller.querySelectorAll<HTMLElement>("[data-anchor]")) {
      if (node.dataset.anchor === anchor && !node.classList.contains("m-md-link")) return node
    }
    return null
  }

  function scrollToAnchor(anchor: string): boolean {
    const heading = headingFor(anchor)
    if (!heading) {
      setStatus(`이 페이지에 '${anchor}' 제목이 없습니다.`)
      return false
    }
    const top = heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTop = Math.max(0, scroller.scrollTop + top)
    for (const node of scroller.querySelectorAll(".m-wiki-flash")) node.classList.remove("m-wiki-flash")
    heading.classList.add("m-wiki-flash")
    if (flashTimer) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      heading.classList.remove("m-wiki-flash")
      flashTimer = null
    }, flashMs)
    return true
  }

  function paintSelection(): void {
    links.forEach((link, index) => {
      const on = index === selected
      link.tabIndex = on ? 0 : -1
      link.classList.toggle("m-wiki-link-selected", on)
      if (on) link.setAttribute("aria-current", "true")
      else link.removeAttribute("aria-current")
    })
    const link = links[selected]
    if (link) {
      link.focus({ preventScroll: true })
      link.scrollIntoView?.({ block: "nearest" })
    }
  }

  function selectLink(delta: 1 | -1): void {
    selected = cycleIndex(selected, delta, links.length)
    pane = "body"
    root.dataset.pane = pane
    paintSelection()
    if (!links.length) setStatus("이 페이지에는 링크가 없습니다.")
  }

  function clearLinkSelection(): boolean {
    if (selected < 0) return false
    selected = -1
    paintSelection()
    scroller.focus({ preventScroll: true })
    return true
  }

  function targetOf(link: HTMLAnchorElement): LinkTarget | { kind: "issue"; id: string } {
    const data = link.dataset
    if (data.kind === "issue") return { kind: "issue", id: data.issue ?? link.textContent ?? "" }
    if (data.kind === "wiki" && data.slug) return data.anchor ? { kind: "wiki", slug: data.slug, anchor: data.anchor } : { kind: "wiki", slug: data.slug }
    if (data.kind === "anchor" && data.anchor) return { kind: "anchor", anchor: data.anchor }
    return { kind: "external", href: data.href ?? link.title ?? "" }
  }

  async function follow(target: LinkTarget | { kind: "issue"; id: string }): Promise<void> {
    switch (target.kind) {
      case "issue":
        if (target.id) props.onIssue?.(target.id)
        return
      case "anchor":
        scrollToAnchor(target.anchor)
        return
      case "external":
        // Shown, never opened: the panel CSP blocks navigation and the renderer gives links no href.
        setStatus(`위키 밖 주소는 열지 않습니다: ${target.href}`)
        return
      case "wiki":
        if (target.slug === current && page) {
          if (target.anchor) scrollToAnchor(target.anchor)
          else scroller.scrollTop = 0
          return
        }
        await open(target.slug, { anchor: target.anchor, push: true })
    }
  }

  async function followSelected(): Promise<void> {
    const link = links[selected]
    if (link) await follow(targetOf(link))
  }

  // -- navigation --
  async function open(slug: string, options: { anchor?: string; push?: boolean; scrollTop?: number } = {}): Promise<void> {
    if (options.push && current && current !== slug) trail = pushTrail(trail, { slug: current, scrollTop: scroller.scrollTop })
    const token = ++request
    current = slug
    cursor = slug
    page = null
    pageError = null
    pageLoading = true
    setStatus("")
    paintList()
    paintBody()
    let next: WikiPage | null = null
    let error: string | null = null
    try {
      const parsed = parseWikiShow(await props.loadPage(slug))
      if (parsed.ok) next = parsed.value
      else error = parsed.error
    } catch (reason) {
      error = `페이지를 불러오지 못했습니다: ${reason instanceof Error ? reason.message : String(reason)}`
    }
    if (token !== request) return // a later open won; this answer is stale
    pageLoading = false
    page = next
    pageError = error
    if (next && typeof next.body === "string") bodies.set(next.slug, next.body)
    paintList()
    paintBody()
    scroller.scrollTop = options.scrollTop ?? 0
    if (options.anchor && next) scrollToAnchor(options.anchor)
  }

  async function back(): Promise<boolean> {
    const popped = popTrail(trail)
    if (!popped) {
      setStatus("되감을 페이지가 없습니다.")
      return false
    }
    trail = popped.trail
    await open(popped.entry.slug, { scrollTop: popped.entry.scrollTop })
    return true
  }

  function toggleRaw(): void {
    const top = scroller.scrollTop
    raw = !raw
    paintBody()
    scroller.scrollTop = top
  }

  function setQuery(next: string): void {
    query = next
    if (search.input.value !== next) search.input.value = next
    root.dataset.searching = next.trim() ? "true" : "false"
    paintList()
  }

  function focusSearch(): void {
    search.input.focus()
    search.input.select?.()
  }

  function focusPane(next: WikiPane): void {
    pane = next
    root.dataset.pane = pane
    if (pane === "list") focusCursorRow()
    else if (links[selected]) links[selected]!.focus({ preventScroll: true })
    else scroller.focus({ preventScroll: true })
  }

  // -- keys --
  function handleKey(event: KeyboardEvent): boolean {
    if (event.isComposing || event.defaultPrevented) return false
    const done = (): boolean => {
      event.preventDefault()
      return true
    }
    if (event.target === search.input) {
      if (event.key === "Escape") {
        if (query) setQuery("")
        focusPane("list")
        return done()
      }
      if (event.key === "Enter" || event.key === "ArrowDown") {
        focusPane("list")
        return done()
      }
      return false
    }
    if (isTextInput(event.target)) return false
    if (event.ctrlKey || event.metaKey || event.altKey) return false
    switch (event.key) {
      case "/":
        focusSearch()
        return done()
      case "Escape":
        if (clearLinkSelection()) return done()
        if (query) {
          setQuery("")
          return done()
        }
        return false
      case "Tab":
        selectLink(event.shiftKey ? -1 : 1)
        return done()
      case "Backspace":
        void back()
        return done()
    }
    if (pane === "list") {
      switch (event.key) {
        case "j":
        case "ArrowDown":
          moveCursor(1)
          return done()
        case "k":
        case "ArrowUp":
          moveCursor(-1)
          return done()
        case "Home":
          moveCursor(-Infinity)
          return done()
        case "End":
          moveCursor(Infinity)
          return done()
        case "Enter":
          if (cursor) void open(cursor)
          return done()
        case "l":
        case "ArrowRight":
          focusPane("body")
          return done()
      }
      return false
    }
    switch (event.key) {
      case "Enter":
        if (selected >= 0) void followSelected()
        else selectLink(1) // the TUI opens a link picker here; the panel selects the first link instead
        return done()
      case "h":
      case "ArrowLeft":
        void back()
        return done()
      case "j":
      case "ArrowDown":
        scroller.scrollTop += LINE_PX
        return done()
      case "k":
      case "ArrowUp":
        scroller.scrollTop = Math.max(0, scroller.scrollTop - LINE_PX)
        return done()
    }
    return false
  }

  // -- events --
  const onKeyDown = (event: KeyboardEvent): void => {
    handleKey(event)
  }
  const onInput = (): void => setQuery(search.input.value)
  const onFocusIn = (event: FocusEvent): void => {
    const target = event.target as Node
    if (listPane.contains(target)) pane = "list"
    else if (bodyPane.contains(target)) pane = "body"
    root.dataset.pane = pane
  }
  const onBodyClick = (event: MouseEvent): void => {
    const link = (event.target as Element | null)?.closest?.("a.m-md-link") as HTMLAnchorElement | null
    if (!link || !scroller.contains(link)) return
    event.preventDefault()
    const index = links.indexOf(link)
    if (index >= 0) {
      selected = index
      paintSelection()
    }
    void follow(targetOf(link))
  }
  if (props.standaloneKeys !== false) root.addEventListener("keydown", onKeyDown)
  search.input.addEventListener("input", onInput)
  root.addEventListener("focusin", onFocusIn)
  scroller.addEventListener("click", onBodyClick)

  // -- public --
  function setPages(next: ReadonlyArray<WikiPage>, nextDir?: string): void {
    pages = sortPages(next)
    if (nextDir !== undefined) dir = nextDir
    listError = null
    listLoading = false
    for (const entry of pages) if (typeof entry.body === "string") bodies.set(entry.slug, entry.body)
    paintList()
    if (!current && pages.length) void open(pages[0]!.slug)
    else paintBody()
  }

  function setWidth(width: number): void {
    split.setWidth(width)
    root.dataset.narrow = width < FORCE_BOTTOM_BELOW ? "true" : "false"
  }

  function state(): WikiState {
    return { current, cursor, trail: trail.map((e) => ({ ...e })), query, raw, scrollTop: scroller.scrollTop, selectedLink: selected, pane }
  }

  async function restore(saved: Partial<WikiState>): Promise<void> {
    if (Array.isArray(saved.trail)) trail = saved.trail.filter((e) => e && typeof e.slug === "string").map((e) => ({ slug: e.slug, scrollTop: Number(e.scrollTop) || 0 }))
    if (typeof saved.raw === "boolean") raw = saved.raw
    if (saved.pane === "list" || saved.pane === "body") pane = saved.pane
    root.dataset.pane = pane
    if (typeof saved.query === "string") setQuery(saved.query)
    if (typeof saved.cursor === "string") cursor = saved.cursor
    const top = Number(saved.scrollTop) || 0
    if (typeof saved.current === "string" && saved.current) {
      if (saved.current !== current || !page) await open(saved.current, { scrollTop: top })
      else {
        paintBody()
        scroller.scrollTop = top
      }
      if (typeof saved.cursor === "string") cursor = saved.cursor
      paintList()
    } else paintBody()
    if (typeof saved.selectedLink === "number" && saved.selectedLink >= 0 && saved.selectedLink < links.length) {
      selected = saved.selectedLink
      paintSelection()
    }
  }

  if (props.width !== undefined) setWidth(props.width)
  paintList()
  paintBody()
  if (props.pages) setPages(props.pages)
  if (props.state) void restore(props.state)

  return {
    el: root,
    setPages,
    setError(text) {
      listError = text
      listLoading = false
      paintList()
    },
    setLoading(loading) {
      listLoading = loading
      paintList()
    },
    setBody(slug, body) {
      bodies.set(slug, body)
      if (query) paintList()
    },
    open,
    back,
    selectLink,
    clearLinkSelection,
    followSelected,
    follow,
    scrollToAnchor,
    toggleRaw,
    setQuery,
    focusSearch,
    focusPane,
    handleKey,
    setWidth,
    setRatio(ratio) {
      split.setRatio("left", ratio)
    },
    state,
    restore,
    links: () => links.slice(),
    destroy() {
      root.removeEventListener("keydown", onKeyDown)
      search.input.removeEventListener("input", onInput)
      root.removeEventListener("focusin", onFocusIn)
      scroller.removeEventListener("click", onBodyClick)
      if (flashTimer) clearTimeout(flashTimer)
      split.destroy()
    },
  }
}
