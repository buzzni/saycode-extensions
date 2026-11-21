// 화면 글자를 투명 PNG 로 그린다(macOS JXA + AppKit). ffmpeg 빌드에 libass·drawtext 가 없어도 자막을 얹기 위해서다.
// 사용: osascript -l JavaScript caption.jxa.js <spec.json>
// spec: { width, height, font, fontFiles, items: [{ text, fontSize, x, y, w, h, style, emphasis?, label?, frames, out }] }
// — y 는 아래에서 잰 상자 밑변. frames 는 등장 동작의 장면별 { scale, alpha } 이고 <out>-00.png, -01.png … 로 쓴다.
// style: box(흰 둥근 상자·남색 글자·강조어 파랑, label 이 있으면 위에 파란 알약), chip(파란 칩·흰 글자·강조어 노랑),
//        subtitle(흰 글자·얇은 남색 외곽선), plain(흰 글자·검은 외곽선·그림자 — 콘티 카드).
ObjC.import('AppKit')
ObjC.import('CoreText')
ObjC.import('Foundation')

const NAVY = [14, 22, 36]
const BLUE = [30, 134, 197]
const YELLOW = [255, 214, 0]
const WHITE = [255, 255, 255]

function run(argv) {
  const raw = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js
  const spec = JSON.parse(raw)
  // 글꼴 파일은 이 프로세스에서만 쓰게 등록한다(설치하지 않는다). 1 = kCTFontManagerScopeProcess
  for (const file of spec.fontFiles ?? []) $.CTFontManagerRegisterFontsForURL($.NSURL.fileURLWithPath(file), 1, null)
  for (const item of spec.items) draw(spec, item)
  return `rendered ${spec.items.length}`
}

function color([r, g, b], alpha = 1) {
  return $.NSColor.colorWithSRGBRedGreenBlueAlpha(r / 255, g / 255, b / 255, alpha)
}

function font(name, size, fallback) {
  const found = $.NSFont.fontWithNameSize(name, size)
  if (!found.isNil()) return found
  const system = $.NSFont.fontWithNameSize(fallback, size)
  return system.isNil() ? $.NSFont.boldSystemFontOfSize(size) : system
}

function attributed(text, attributes, emphasis, emphasisColor) {
  // 이 브리지에서는 initWithString 이 보이지 않아 빈 문자열을 만든 뒤 채운다.
  const value = $.NSMutableAttributedString.alloc.init
  value.mutableString.setString($(text))
  const all = $.NSMakeRange(0, text.length)
  for (const [key, attribute] of attributes) value.addAttributeValueRange(key, attribute, all)
  const at = emphasis ? text.indexOf(emphasis) : -1
  if (at >= 0) value.addAttributeValueRange($.NSForegroundColorAttributeName, emphasisColor, $.NSMakeRange(at, emphasis.length))
  return value
}

function centered(lineHeight = 1.1) {
  const paragraph = $.NSMutableParagraphStyle.alloc.init
  paragraph.alignment = 1 // macOS: 1 = center
  paragraph.lineHeightMultiple = lineHeight
  return paragraph
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
  const center = (STYLES[item.style] ?? STYLES.plain)(spec, item)
  $.NSGraphicsContext.restoreGraphicsState
  const image = $.NSImage.alloc.initWithSize($.NSMakeSize(spec.width, spec.height))
  image.addRepresentation(base)
  item.frames.forEach((frame, index) => {
    const rep = newCanvas(spec)
    const w = spec.width * frame.scale
    const h = spec.height * frame.scale
    const rect = $.NSMakeRect(center.x - center.x * frame.scale, center.y - center.y * frame.scale, w, h)
    image.drawInRectFromRectOperationFraction(rect, $.NSMakeRect(0, 0, 0, 0), 2, frame.alpha) // 2 = source over
    save(rep, `${item.out}-${String(index).padStart(2, '0')}.png`)
  })
}

function roundedBox(x, y, w, h, radius, fill, shadow) {
  $.NSGraphicsContext.saveGraphicsState
  if (shadow) {
    const softShadow = $.NSShadow.alloc.init
    softShadow.shadowColor = color([0, 0, 0], 0.28)
    softShadow.shadowBlurRadius = 24
    softShadow.shadowOffset = $.NSMakeSize(0, -6)
    softShadow.set
  }
  fill.setFill
  $.NSBezierPath.bezierPathWithRoundedRectXRadiusYRadius($.NSMakeRect(x, y, w, h), radius, radius).fill
  $.NSGraphicsContext.restoreGraphicsState
}

function boxed(spec, item, { fill, ink, emphasisInk, pillShape }) {
  const size = item.fontSize
  const text = attributed(item.text, [
    [$.NSFontAttributeName, font('Pretendard-ExtraBold', size, spec.font)],
    [$.NSForegroundColorAttributeName, color(ink)],
    [$.NSParagraphStyleAttributeName, centered()],
  ], item.emphasis, color(emphasisInk))
  const measured = text.size
  const padX = Math.round(size * 0.6)
  const padY = Math.round(size * 0.38)
  const boxW = Math.ceil(measured.width) + padX * 2
  const boxH = Math.ceil(measured.height) + padY * 2
  const boxX = Math.round((spec.width - boxW) / 2)
  const top = item.y + item.h
  const boxY = item.style === 'chip' ? Math.round(item.y + item.h / 2 - boxH / 2) : top - boxH
  const radius = pillShape && boxH < size * 2.2 ? boxH / 2 : size * 0.42
  roundedBox(boxX, boxY, boxW, boxH, radius, color(fill), item.style === 'box')
  text.drawInRect($.NSMakeRect(boxX + padX, boxY + padY, boxW - padX * 2, boxH - padY * 2))
  if (item.label) {
    const pillSize = Math.round(size * 0.55)
    const label = attributed(item.label, [
      [$.NSFontAttributeName, font('Pretendard-Bold', pillSize, spec.font)],
      [$.NSForegroundColorAttributeName, color(WHITE)],
    ])
    const labelSize = label.size
    const pillW = Math.ceil(labelSize.width) + pillSize * 1.4
    const pillH = Math.ceil(labelSize.height) + pillSize * 0.5
    const pillX = Math.round((spec.width - pillW) / 2)
    const pillY = boxY + boxH - pillH * 0.35
    roundedBox(pillX, pillY, pillW, pillH, pillH / 2, color(BLUE), false)
    label.drawAtPoint($.NSMakePoint(pillX + pillSize * 0.7, pillY + pillSize * 0.25))
    return { x: spec.width / 2, y: (boxY + pillY + pillH) / 2 }
  }
  return { x: spec.width / 2, y: boxY + boxH / 2 }
}

const STYLES = {
  box: (spec, item) => boxed(spec, item, { fill: WHITE, ink: NAVY, emphasisInk: BLUE }),
  chip: (spec, item) => boxed(spec, item, { fill: BLUE, ink: WHITE, emphasisInk: YELLOW, pillShape: true }),
  subtitle(spec, item) {
    const base = [
      [$.NSFontAttributeName, font('Pretendard-SemiBold', item.fontSize, spec.font)],
      [$.NSParagraphStyleAttributeName, centered(1)],
    ]
    const rect = $.NSMakeRect(item.x, item.y, item.w, item.h)
    // 외곽선 패스(양수 = 선만) 뒤에 채움 패스. 선 두께는 글자 크기의 14%, 진한 남색.
    attributed(item.text, [...base, [$.NSStrokeColorAttributeName, color([16, 22, 34])], [$.NSStrokeWidthAttributeName, 14]]).drawInRect(rect)
    attributed(item.text, [...base, [$.NSForegroundColorAttributeName, color(WHITE)]]).drawInRect(rect)
    return { x: item.x + item.w / 2, y: item.y + item.h / 2 }
  },
  plain(spec, item) {
    const shadow = $.NSShadow.alloc.init
    shadow.shadowColor = $.NSColor.colorWithCalibratedWhiteAlpha(0, 0.75)
    shadow.shadowBlurRadius = Math.max(4, item.fontSize / 14)
    shadow.shadowOffset = $.NSMakeSize(0, -Math.max(2, item.fontSize / 30))
    const base = [
      [$.NSFontAttributeName, font(spec.font, item.fontSize, spec.font)],
      [$.NSParagraphStyleAttributeName, centered(1)],
    ]
    const rect = $.NSMakeRect(item.x, item.y, item.w, item.h)
    attributed(item.text, [...base, [$.NSStrokeColorAttributeName, $.NSColor.blackColor], [$.NSStrokeWidthAttributeName, 16], [$.NSShadowAttributeName, shadow]]).drawInRect(rect)
    attributed(item.text, [...base, [$.NSForegroundColorAttributeName, $.NSColor.whiteColor]]).drawInRect(rect)
    return { x: item.x + item.w / 2, y: item.y + item.h / 2 }
  },
}
