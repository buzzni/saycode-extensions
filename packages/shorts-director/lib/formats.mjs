// 화면 형식(format). 모든 숏폼이 "전체 화면 영상 + 위 제목 + 아래 자막" 한 구조로 나오면 주제가 달라도 같아 보인다.
// 그래서 영상의 뜻을 무엇이 싣는지로 구조를 고른다:
//  - full(기본): 그림이 뜻을 싣는다(장면·인물·장소). 영상이 화면을 꽉 채운다.
//  - band: 글자가 뜻을 싣는다(단계·목록·정보·앱 화면). 영상은 가운데 창에 들어가고, 위 띠에는 영상 내내 남는 제목,
//    아래 띠에는 자막이 들어간다. 창 둘레와 띠의 디자인은 장르별 틀(frames/<id>.svg)이 정한다.
// 틀 SVG 에는 글자가 없다 — 제목·자막·번호는 글자 렌더러가 틀의 색으로 그린다.
//
// 자리는 1080×1920 기준 px 로 정하고(틀 디자인의 좌표 계약), 렌더할 때 화면 크기 비율로 바꾼다.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FRAMES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'frames')
export const LAYOUTS = ['full', 'band']

const BASE = { width: 1080, height: 1920 }
export const SLOTS = {
  headline: { x: 60, y: 200, w: 960, h: 205 },
  content: {
    square: { x: 48, y: 430, w: 984, h: 984 },
    portrait: { x: 140, y: 420, w: 800, h: 1000 },
  },
  subtitle: { center: 1500 },
  badge: { offset: 76 },
}

let catalog
export function frames() {
  catalog ??= JSON.parse(readFileSync(join(FRAMES_DIR, 'frames.json'), 'utf8'))
  return catalog
}

export function frameById(id, list) {
  return (list ?? frames()).find((frame) => frame.id === id)
}

/** 띠형이면 틀과 그 화면 크기에서의 자리(px)를, 아니면 null. */
export function bandLayout(plan, { width, height } = BASE, list) {
  if (plan.format?.layout !== 'band') return null
  const frame = frameById(plan.format.frame, list)
  if (!frame) return null
  const sx = width / BASE.width
  const sy = height / BASE.height
  const slot = SLOTS.content[frame.content] ?? SLOTS.content.square
  // 영상 크기는 짝수여야 인코딩된다.
  const even = (value) => Math.round(value / 2) * 2
  return {
    frame,
    svg: join(FRAMES_DIR, `${frame.id}.svg`),
    content: { x: Math.round(slot.x * sx), y: Math.round(slot.y * sy), w: even(slot.w * sx), h: even(slot.h * sy), radius: Math.round((frame.radius ?? 0) * sx) },
  }
}

/**
 * 글자 자리(화면 위에서부터의 비율). 띠형에서만 쓴다.
 * headline: 위 띠 가운데 · subtitle: 아래 띠 · title: 창 아래쪽 안 · badge: 창 왼쪽 위 원.
 */
export function bandSlots(frame) {
  const content = SLOTS.content[frame.content] ?? SLOTS.content.square
  const top = (px) => px / BASE.height
  return {
    headline: { center: top(SLOTS.headline.y + SLOTS.headline.h / 2) },
    subtitle: { center: top(SLOTS.subtitle.center) },
    // 두 줄 제목(판 높이 약 230px)도 창 아래 테두리를 넘지 않게.
    title: { center: top(content.y + content.h - 150) },
    badge: { center: top(content.y + SLOTS.badge.offset), cx: (content.x + SLOTS.badge.offset) / BASE.width },
  }
}

/**
 * 띠형에서 문구를 얼굴·주인공에서 비킬 때 문구 가운데가 올 수 있는 높이(위에서의 비율). 창 안쪽으로만 옮긴다 —
 * 창 밖으로 나가면 위 띠의 제목이나 아래 띠의 자막을 덮는다(실측).
 */
export function bandRange(frame) {
  const content = SLOTS.content[frame.content] ?? SLOTS.content.square
  return [(content.y + 60) / BASE.height, (content.y + content.h - 60) / BASE.height]
}

/** 틀의 색으로 정한 역할별 글자 디자인(묶음 디자인을 덮어쓰는 값). */
export function frameDesigns(frame) {
  // 묶음 디자인의 판·외곽선·형광펜이 틀 색과 섞이지 않게, 틀이 정하지 않은 것은 지운다.
  const headline = {
    ink: frame.headline.ink,
    fill: frame.headline.fill,
    shape: 'rounded',
    outline: undefined,
    emphasis: frame.headline.emphasis,
    emphasisFill: undefined,
    shadow: false,
    entrance: 'none',
  }
  const subtitle = {
    ink: frame.subtitle.ink,
    fill: frame.subtitle.fill,
    shape: 'rounded',
    outline: frame.subtitle.outline,
    outlineWidth: frame.subtitle.outline ? 14 : undefined,
    shadow: false,
  }
  const badge = { ink: frame.badge.ink, fill: frame.badge.fill, shape: 'pill', entrance: 'pop' }
  return { headline, subtitle, badge }
}
