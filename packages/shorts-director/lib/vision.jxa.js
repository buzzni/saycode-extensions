// 장면 사진에서 얼굴과 눈에 띄는 대상(제품·음식 같은 주인공 사물)의 영역을 찾는다(macOS Vision).
// 사용: osascript -l JavaScript vision.jxa.js <image>... — 결과는 이미지마다 { faces, subjects } 이고 영역은 화면 비율,
// 아래에서 잰 값(Vision 좌표). 화면 문구가 얼굴·대상을 가리는지 재는 데 쓴다(textcheck.mjs).
ObjC.import('Foundation')
ObjC.import('Vision')

function run(argv) {
  return JSON.stringify(argv.map(detect))
}

function detect(path) {
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions($.NSURL.fileURLWithPath(path), $({}))
  const faces = $.VNDetectFaceRectanglesRequest.alloc.init
  const subjects = $.VNGenerateObjectnessBasedSaliencyImageRequest.alloc.init
  if (!handler.performRequestsError($([faces, subjects]), null)) return { faces: [], subjects: [] }
  return {
    faces: list(faces.results).map((face) => rect(face.boundingBox)),
    subjects: list(subjects.results).flatMap((result) => list(result.salientObjects).map((object) => rect(object.boundingBox))),
  }
}

function list(array) {
  const items = []
  for (let index = 0; index < array.count; index += 1) items.push(array.objectAtIndex(index))
  return items
}

function rect(box) {
  return { x: box.origin.x, y: box.origin.y, w: box.size.width, h: box.size.height }
}
