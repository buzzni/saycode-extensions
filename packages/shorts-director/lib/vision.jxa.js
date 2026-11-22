// 장면 사진에서 얼굴, 눈에 띄는 대상(제품·음식 같은 주인공 사물), 사람 영역을 찾는다(macOS Vision).
// 사용: osascript -l JavaScript vision.jxa.js <image>... — 결과는 이미지마다 { faces, subjects, person, hands } 이다. faces·subjects·hands 는
// 화면 비율이고 아래에서 잰 값(Vision 좌표), person 은 사람 영역을 위에서부터 줄마다 '#'(사람)·'.' 로 적은 27×48 격자다
// — 위로 잘린 얼굴을 찾는 데 쓴다. 화면 문구가 얼굴·대상을 가리는지 재는 데 쓴다(textcheck.mjs).
ObjC.import('AppKit')
ObjC.import('CoreImage')
ObjC.import('Foundation')
ObjC.import('Vision')

const GRID = { cols: 27, rows: 48 }

function run(argv) {
  return JSON.stringify(argv.map(detect))
}

function detect(path) {
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(path), $({}))
  const faces = $.VNDetectFaceRectanglesRequest.alloc.init
  const subjects = $.VNGenerateObjectnessBasedSaliencyImageRequest.alloc.init
  const person = $.VNGeneratePersonSegmentationRequest.alloc.init
  person.qualityLevel = 1 // balanced
  const hands = $.VNDetectHumanHandPoseRequest.alloc.init
  hands.maximumHandCount = 4
  if (!handler.performRequestsError($([faces, subjects, person, hands]), null)) return { faces: [], subjects: [] }
  return {
    faces: list(faces.results).map((face) => rect(face.boundingBox)),
    subjects: list(subjects.results).flatMap((result) => list(result.salientObjects).map((object) => rect(object.boundingBox))),
    person: personGrid(person),
    hands: list(hands.results).map(handBox).filter(Boolean),
  }
}

// 손 관절들을 감싸는 상자 — 화면 윗변·옆으로 들어 올린 손을 잘린 머리로 착각하지 않게 거른다.
function handBox(observation) {
  const xs = []
  const ys = []
  for (const name of list(observation.availableJointNames)) {
    const point = observation.recognizedPointForJointNameError(name, null)
    if (point && point.confidence > 0.2) {
      xs.push(point.location.x)
      ys.push(point.location.y)
    }
  }
  if (xs.length === 0) return undefined
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
}

// 사람 영역 마스크를 거친 격자로 줄인다. 마스크 그림은 위가 0번 줄이다.
function personGrid(request) {
  if (!request.results || request.results.count === 0) return undefined
  const mask = $.NSBitmapImageRep.alloc.initWithCIImage($.CIImage.imageWithCVPixelBuffer(request.results.objectAtIndex(0).pixelBuffer))
  const width = mask.pixelsWide
  const height = mask.pixelsHigh
  const lines = []
  for (let row = 0; row < GRID.rows; row += 1) {
    let line = ''
    for (let col = 0; col < GRID.cols; col += 1) {
      const value = mask.colorAtXY(Math.floor(((col + 0.5) * width) / GRID.cols), Math.floor(((row + 0.5) * height) / GRID.rows))
      line += value.redComponent > 0.5 ? '#' : '.'
    }
    lines.push(line)
  }
  return { ...GRID, lines }
}

function list(array) {
  const items = []
  for (let index = 0; index < array.count; index += 1) items.push(array.objectAtIndex(index))
  return items
}

function rect(box) {
  return { x: box.origin.x, y: box.origin.y, w: box.size.width, h: box.size.height }
}
