// 화면 글자를 투명 PNG 로 그린다(macOS JXA + AppKit). ffmpeg 빌드에 libass·drawtext 가 없어도 자막을 얹기 위해서다.
// 사용: osascript -l JavaScript caption.jxa.js <spec.json>
// spec: { width, height, font, items: [{ text, fontSize, x, y, w, h, out }] } — y 는 아래에서 잰 상자 밑변.
ObjC.import('AppKit')
ObjC.import('Foundation')

function run(argv) {
  const raw = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js
  const spec = JSON.parse(raw)
  for (const item of spec.items) draw(spec, item)
  return `rendered ${spec.items.length}`
}

function draw(spec, item) {
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
    null, spec.width, spec.height, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0,
  )
  $.NSGraphicsContext.saveGraphicsState
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))

  const font = $.NSFont.fontWithNameSize(spec.font, item.fontSize) || $.NSFont.boldSystemFontOfSize(item.fontSize)
  const paragraph = $.NSMutableParagraphStyle.alloc.init
  paragraph.alignment = 1 // macOS: 1 = center
  const fill = $.NSMutableDictionary.alloc.init
  fill.setObjectForKey(font, $.NSFontAttributeName)
  fill.setObjectForKey($.NSColor.whiteColor, $.NSForegroundColorAttributeName)
  fill.setObjectForKey(paragraph, $.NSParagraphStyleAttributeName)

  const shadow = $.NSShadow.alloc.init
  shadow.shadowColor = $.NSColor.colorWithCalibratedWhiteAlpha(0, 0.75)
  shadow.shadowBlurRadius = Math.max(4, item.fontSize / 14)
  shadow.shadowOffset = $.NSMakeSize(0, -Math.max(2, item.fontSize / 30))
  const outline = fill.mutableCopy
  outline.setObjectForKey($.NSColor.blackColor, $.NSStrokeColorAttributeName)
  outline.setObjectForKey(16, $.NSStrokeWidthAttributeName) // 양수 = 외곽선만. 채움은 다음 패스에서 덮는다.
  outline.setObjectForKey(shadow, $.NSShadowAttributeName)

  const text = $.NSString.alloc.initWithUTF8String(item.text)
  const rect = $.NSMakeRect(item.x, item.y, item.w, item.h)
  text.drawInRectWithAttributes(rect, outline)
  text.drawInRectWithAttributes(rect, fill)

  $.NSGraphicsContext.restoreGraphicsState
  const png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $())
  if (!png.writeToFileAtomically(item.out, true)) throw new Error(`could not write ${item.out}`)
}
