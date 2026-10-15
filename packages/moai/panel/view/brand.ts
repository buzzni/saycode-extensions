/**
 * The header above the tab bar, drawn as the TUI draws its own (moai src/tui/draw.rs `header`, se-qkga): the logo's
 * five lines and its tagline, dim, then a line down, then `User` and `Version`, their labels dim and padded to one
 * column. The TUI's labels are English in every language, and so are these. A short panel leaves the header out and a
 * narrow one the logo (shell.css), as the TUI does on a short or narrow screen. What it says comes from `status`
 * (data/about.ts).
 */
import { versionLine, type About, type VersionCopy } from '../data/about.ts'
import { el } from './components.ts'

/** The TUI's `LOGO`, letter for letter: the art, then the tagline. */
export const LOGO = [
  '• ▌ ▄ ·.        ▄▄▄· ▪',
  '·██ ▐███▪ ▄█▀▄ ▐█ ▀█ ██',
  '▐█ ▌▐▌▐█·▐█▌.▐▌▄█▀▀█ ▐█·',
  '██ ██▌▐█▌▐█▌.▐▌▐█▪ ▐▌▐█▌',
  '▀▀  █▪▀▀▀ ▀█▄▀▪ ▀  ▀ ▀▀▀',
  'Issue tracker for AI agent',
] as const

/** The label column (`HEADER_LABEL`): `User`, `Version` and the colon after them stand in one column. */
const LABEL = 7
const pad = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - [...text].length))

/** The logo's lines as the TUI lays them: the art pushed as one block to the middle of the tagline's width. */
export function logoLines(): string[] {
  const art = LOGO.slice(0, -1)
  const width = Math.max(...LOGO.map((line) => [...line].length))
  const indent = Math.floor((width - Math.max(...art.map((line) => [...line].length))) / 2)
  return LOGO.map((line, n) => pad(n < art.length ? ' '.repeat(indent) + line : line, width))
}

const SVG = 'http://www.w3.org/2000/svg'

/**
 * The art as a terminal draws it: each block letter fills its cell (one wide, two tall) to the edge, so a row meets the
 * next. A font's glyphs do not (the field test saw a seam under every row, whatever the line height), so the letters
 * become the cells they stand for, in one path: neighbouring blocks are filled together and no hairline shows
 * between them. The dots keep the size they have in a terminal font.
 */
export function artPath(lines: readonly string[]): string {
  const parts: string[] = []
  const rect = (x: number, y: number, w: number, h: number) => parts.push(`M${x} ${y}h${w}v${h}h${-w}z`)
  const dot = (cx: number, cy: number, r: number) => parts.push(`M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`)
  lines.forEach((line, row) => {
    ;[...line].forEach((letter, x) => {
      const y = row * 2
      switch (letter) {
        case '█': return rect(x, y, 1, 2)
        case '▀': return rect(x, y, 1, 1)
        case '▄': return rect(x, y + 1, 1, 1)
        case '▌': return rect(x, y, 0.5, 2)
        case '▐': return rect(x + 0.5, y, 0.5, 2)
        case '▪': return rect(x + 0.25, y + 0.75, 0.5, 0.5)
        case '•': return dot(x + 0.5, y + 1, 0.28)
        case '·': return dot(x + 0.5, y + 1, 0.14)
        case '.': return dot(x + 0.5, y + 1.6, 0.14)
      }
    })
  })
  return parts.join('')
}

/** The letters {@link artPath} draws; the art holds no other but the space. */
export const ART_LETTERS = '█▀▄▌▐▪•·.'

/** The info lines: label and what it says; a line with no label goes on from the one above (the TUI's tail). */
export function infoLines(about: About | null, copy: VersionCopy, now = Date.now()): Array<[string, string]> {
  const version = versionLine(about, copy, now)
  const lines: Array<[string, string]> = [['User', about?.user ?? '—'], ['Version', version.said]]
  if (version.tail) lines.push(['', version.tail])
  return lines
}

export interface Brand {
  el: HTMLElement
  render(about: About | null): void
}

export function mountBrand(doc: Document, copy: VersionCopy): Brand {
  const lines = logoLines()
  const art = lines.slice(0, -1)
  const svg = doc.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'm-brand-art')
  svg.setAttribute('viewBox', `0 0 ${[...lines[0]!].length} ${art.length * 2}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  const path = doc.createElementNS(SVG, 'path')
  path.setAttribute('d', artPath(art))
  svg.append(path)
  const logo = el(doc, 'div', { class: 'm-brand-logo', 'aria-hidden': 'true' }, svg, el(doc, 'div', { class: 'm-brand-tagline' }, lines.at(-1)!))
  const info = el(doc, 'div', { class: 'm-brand-info' })
  const node = el(doc, 'header', { class: 'm-brand', 'aria-label': 'moai' }, logo, info)
  let drawn = ''
  return {
    el: node,
    render(about) {
      const lines = infoLines(about, copy)
      const key = JSON.stringify(lines)
      if (key === drawn) return
      drawn = key
      info.replaceChildren(...lines.map(([label, said]) =>
        el(doc, 'div', { class: 'm-brand-line' }, el(doc, 'span', { class: 'm-brand-label' }, `${pad(label, LABEL)}${label ? ' : ' : '   '}`), said)))
    },
  }
}
