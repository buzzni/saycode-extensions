// 화면 글자를 투명 PNG 로 그린다(macOS JXA + AppKit). ffmpeg 빌드에 libass·drawtext 가 없어도 자막을 얹기 위해서다.
// 사용: osascript -l JavaScript caption.jxa.js <spec.json>
// spec: { width, height, font, fontFiles, items: [{ text, fontSize, x, y, w, h, anchor, style, design?, emphasis?, label?,
//         labelDesign?, frames, out }] } — y 는 아래에서 잰 상자 밑변. frames 는 등장 동작의 장면별 { scale, alpha } 이고
// <out>-00.png, -01.png … 로 쓴다. design 은 looks.mjs 의 한 역할(서체·글자색·판·외곽선·그림자·강조). style 이 plain 이면
// 콘티 카드용 흰 글자.
ObjC.import('AppKit')
ObjC.import('CoreText')
ObjC.import('Foundation')

function run(argv) {
  const raw = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js
  const spec = JSON.parse(raw)
  // 글꼴 파일은 이 프로세스에서만 쓰게 등록한다(설치하지 않는다). 1 = kCTFontManagerScopeProcess
  for (const file of spec.fontFiles ?? []) $.CTFontManagerRegisterFontsForURL($.NSURL.fileURLWithPath(file), 1, null)
  // 실제로 그린 영역(아래에서 잰 픽셀)을 돌려준다 — 렌더가 얼굴·대상 가림을 잰다.
  return JSON.stringify(spec.items.map((item) => draw(spec, item)))
}

// '#RRGGBB' 또는 '#RRGGBBAA'
function color(hex) {
  const value = (at) => parseInt(hex.slice(at, at + 2), 16) / 255
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(value(1), value(3), value(5), hex.length === 9 ? value(7) : 1)
}

function font(name, size, fallback) {
  const found = $.NSFont.fontWithNameSize(name, size)
  if (!found.isNil()) return found
  const system = $.NSFont.fontWithNameSize(fallback, size)
  return system.isNil() ? $.NSFont.boldSystemFontOfSize(size) : system
}

function attributed(text, attributes, emphasis) {
  // 이 브리지에서는 initWithString 이 보이지 않아 빈 문자열을 만든 뒤 채운다.
  const value = $.NSMutableAttributedString.alloc.init
  value.mutableString.setString($(text))
  const all = $.NSMakeRange(0, text.length)
  for (const [key, attribute] of attributes) value.addAttributeValueRange(key, attribute, all)
  const at = emphasis?.text ? text.indexOf(emphasis.text) : -1
  if (at >= 0) {
    const range = $.NSMakeRange(at, emphasis.text.length)
    for (const [key, attribute] of emphasis.attributes) value.addAttributeValueRange(key, attribute, range)
  }
  return value
}

function centered(lineHeight) {
  const paragraph = $.NSMutableParagraphStyle.alloc.init
  paragraph.alignment = 1 // macOS: 1 = center
  paragraph.lineHeightMultiple = lineHeight
  return paragraph
}

function softShadow(size) {
  const shadow = $.NSShadow.alloc.init
  shadow.shadowColor = $.NSColor.colorWithCalibratedWhiteAlpha(0, 0.55)
  shadow.shadowBlurRadius = Math.max(6, size / 5)
  shadow.shadowOffset = $.NSMakeSize(0, -Math.max(2, size / 18))
  return shadow
}

function newCanvas(spec) {
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, spec.width, spec.height, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0,
  )
  $.NSGraphicsContext.saveGraphicsState
  const context = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep)
  context.imageInterpolation = 3 // high
  $.NSGraphicsContext.setCurrentContext(context)
  return rep
}

function save(rep, path) {
  $.NSGraphicsContext.restoreGraphicsState
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $())
  if (!png.writeToFileAtomically(path, true)) throw new Error(`could not write ${path}`)
}

// 글자를 한 번 그리고, 등장 동작은 그 그림을 중심 기준으로 키우거나 흐리게 다시 찍어 만든다.
function draw(spec, item) {
  const base = newCanvas(spec)
  const bounds = item.style === 'plain' ? plain(spec, item) : styled(spec, item)
  const center = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }
  $.NSGraphicsContext.restoreGraphicsState
  const image = $.NSImage.alloc.initWithSize($.NSMakeSize(spec.width, spec.height))
  image.addRepresentation(base)
  item.frames.forEach((frame, index) => {
    const rep = newCanvas(spec)
    const rect = $.NSMakeRect(center.x - center.x * frame.scale, center.y - center.y * frame.scale, spec.width * frame.scale, spec.height * frame.scale)
    image.drawInRectFromRectOperationFraction(rect, $.NSMakeRect(0, 0, 0, 0), 2, frame.alpha) // 2 = source over
    save(rep, `${item.out}-${String(index).padStart(2, '0')}.png`)
  })
  return bounds
}

function box(x, y, w, h, radius, fill, shadow) {
  $.NSGraphicsContext.saveGraphicsState
  if (shadow) shadow.set
  fill.setFill
  $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(x, y, w, h), radius, radius).fill
  $.NSGraphicsContext.restoreGraphicsState
}

function radius(shape, size, height) {
  if (shape === 'pill' && height < size * 2.2) return height / 2
  if (shape === 'square') return Math.max(2, size * 0.06)
  return size * 0.42
}

// 묶음(design)대로: 판이 있으면 판을 깔고, 없으면 외곽선·그림자로 그림 위에 세운다. 강조어는 글자색·형광펜으로.
function styled(spec, item) {
  const design = item.design
  const size = item.fontSize
  const emphasis = item.emphasis ? {
    text: item.emphasis,
    attributes: [
      ...(design.emphasis ? [[$.NSForegroundColorAttributeName, color(design.emphasis)]] : []),
      ...(design.emphasisFill ? [[$.NSBackgroundColorAttributeName, color(design.emphasisFill)]] : []),
    ],
  } : undefined
  const base = [
    [$.NSFontAttributeName, font(design.font, size, spec.font)],
    [$.NSParagraphStyleAttributeName, centered(item.text.includes('\n') ? 1.1 : 1)],
  ]
  const fillText = attributed(item.text, [...base, [$.NSForegroundColorAttributeName, color(design.ink)]], emphasis)
  const outlineText = design.outline
    ? attributed(item.text, [...base, [$.NSStrokeColorAttributeName, color(design.outline)], [$.NSStrokeWidthAttributeName, design.outlineWidth ?? 14],
      ...(design.shadow ? [[$.NSShadowAttributeName, softShadow(size)]] : [])])
    : undefined
  const measured = fillText.size
  const subtitleLike = item.anchor === 'subtitle' || item.anchor === 'aside'
  const padX = Math.round(size * (subtitleLike ? 0.45 : 0.6))
  const padY = Math.round(size * (subtitleLike ? 0.2 : 0.38))
  const w = Math.ceil(measured.width) + (design.fill ? padX * 2 : 0)
  const h = Math.ceil(measured.height) + (design.fill ? padY * 2 : 0)
  // 정렬: 가운데, 또는 좌우 여백(6%)에 붙인다.
  const margin = Math.round(spec.width * 0.06)
  const x = item.align === 'left' ? margin : item.align === 'right' ? spec.width - margin - w : Math.round((spec.width - w) / 2)
  const y = item.anchor === 'top' ? item.y + item.h - h : Math.round(item.y + item.h / 2 - h / 2)
  if (design.fill) box(x, y, w, h, radius(design.shape, size, h), color(design.fill), design.shadow ? softShadow(size) : undefined)
  const inner = design.fill ? $.NSMakeRect(x + padX, y + padY, w - padX * 2, h - padY * 2) : $.NSMakeRect(x - size, y, w + size * 2, h)
  if (outlineText) outlineText.drawInRect(inner)
  if (!design.fill && !outlineText && design.shadow) {
    attributed(item.text, [...base, [$.NSForegroundColorAttributeName, color(design.ink)], [$.NSShadowAttributeName, softShadow(size)]], emphasis).drawInRect(inner)
  }
  fillText.drawInRect(inner)
  if (item.label && item.labelDesign) {
    // 판 위에서는 라벨이 판 윗변에 걸치고, 판이 없으면 글자에 닿지 않게 위로 띄운다.
    const pill = labelPill(spec, item.label, item.labelDesign, Math.round(size * 0.55), y + h, Boolean(design.fill), x + w / 2)
    const left = Math.min(x, pill.x)
    const right = Math.max(x + w, pill.x + pill.w)
    return { x: left, y, w: right - left, h: pill.y + pill.h - y }
  }
  return { x, y, w, h }
}

// 제목 위에 걸치는 알약 라벨. 돌려주는 값은 라벨이 차지한 영역.
function labelPill(spec, text, design, size, bottom, overlap, centerX) {
  const label = attributed(text, [
    [$.NSFontAttributeName, font(design.font, size, spec.font)],
    [$.NSForegroundColorAttributeName, color(design.ink)],
  ])
  const measured = label.size
  const w = Math.ceil(measured.width) + size * 1.4
  const h = Math.ceil(measured.height) + size * 0.5
  const x = Math.round(centerX - w / 2)
  const y = overlap ? bottom - h * 0.35 : bottom + size * 0.3
  box(x, y, w, h, radius(design.shape, size, h), color(design.fill))
  label.drawAtPoint($.NSMakePoint(x + size * 0.7, y + size * 0.25))
  return { x, y, w, h }
}

// 콘티 카드(애니매틱) — 흰 글자·검은 외곽선·그림자.
function plain(spec, item) {
  const base = [
    [$.NSFontAttributeName, font(spec.font, item.fontSize, spec.font)],
    [$.NSParagraphStyleAttributeName, centered(1)],
  ]
  const rect = $.NSMakeRect(item.x, item.y, item.w, item.h)
  attributed(item.text, [...base, [$.NSStrokeColorAttributeName, $.NSColor.blackColor], [$.NSStrokeWidthAttributeName, 16], [$.NSShadowAttributeName, softShadow(item.fontSize)]]).drawInRect(rect)
  attributed(item.text, [...base, [$.NSForegroundColorAttributeName, $.NSColor.whiteColor]]).drawInRect(rect)
  return { x: item.x, y: item.y, w: item.w, h: item.h }
}
