// SVG 디자인 애셋(틀·스티커)을 PNG 로 그린다. macOS AppKit 이 SVG 를 읽으므로 따로 설치할 것이 없다.
// 사용: osascript -l JavaScript svg.jxa.js <spec.json> — spec: { items: [{ svg, out, width, height }] }
ObjC.import('AppKit')
ObjC.import('Foundation')

function run(argv) {
  const spec = JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(argv[0]), $.NSUTF8StringEncoding, null)))
  const results = []
  for (const item of spec.items) {
    const image = $.NSImage.alloc.initWithContentsOfFile($(item.svg))
    if (!image || image.isNil()) throw new Error(`SVG 를 읽지 못했다: ${item.svg}`)
    const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, item.width, item.height, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0)
    $.NSGraphicsContext.saveGraphicsState
    $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep))
    image.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, item.width, item.height), $.NSZeroRect, $.NSCompositingOperationSourceOver, 1)
    $.NSGraphicsContext.restoreGraphicsState
    const data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $())
    if (!data.writeToFileAtomically($(item.out), true)) throw new Error(`PNG 를 쓰지 못했다: ${item.out}`)
    results.push(item.out)
  }
  return JSON.stringify(results)
}
