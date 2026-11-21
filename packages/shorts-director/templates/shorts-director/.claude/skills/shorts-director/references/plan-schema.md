# plan.json

`node tools/sd.mjs check` 가 이 형식을 검증한다. 아래 예시는 형식을 보이려고 장면 일부만 적었다(전체 길이가 목표에 못 미쳐 그대로는 검증을 통과하지 않는다). 숫자로 잴 수 있는 규칙(훅 후보, 컷 수, 컷 길이, 테이크 길이,
첫 프레임, 실물 사진, 제어 태그)은 오류로, 판단이 필요한 것(프롬프트 속 숫자, 꼬리 엔딩, 내레이션 분량)은 경고로 낸다.

```json
{
  "version": 1,
  "title": "퇴근길 우산",
  "language": "ko",
  "aspect": "9:16",
  "target_seconds": 30,
  "viewer": "비 예보를 안 보고 출근하는 30대 직장인",
  "hook": { "options": ["후보 1", "후보 2", "후보 3"], "chosen": 1 },
  "subjects": [
    { "id": "hero", "kind": "person", "look": "Korean woman in her early 30s, shoulder-length black hair, beige trench coat, black tote bag" },
    { "id": "umbrella", "kind": "product", "look": "compact navy folding umbrella with a wooden handle" }
  ],
  "moments": [
    {
      "id": "m1", "kind": "take", "place": "Seoul subway exit at night", "seconds": 5, "subjects": ["hero"],
      "video_prompt": "Handheld phone video, rainy night at a Seoul subway exit, cool streetlight reflections, realistic.",
      "shots": [
        { "seconds": 2, "framing": "wide shot", "action": "she stops at the top of the stairs as heavy rain pours down" },
        { "seconds": 1.5, "framing": "close-up", "action": "her face falls" },
        { "seconds": 1.5, "framing": "close-up", "action": "her hands dig through the empty tote bag" }
      ],
      "dialogue": [{ "speaker": "She", "text": "아 진짜…" }],
      "sound": "Heavy rain and distant traffic.",
      "caption": { "text": "우산 없이 나온 날", "role": "hook" }
    },
    { "id": "m2", "kind": "photo", "file": "materials/umbrella.jpg", "seconds": 3, "shots": [{ "seconds": 3, "framing": "photo", "action": "slow push in" }] },
    { "id": "m3", "kind": "card", "seconds": 2, "shots": [{ "seconds": 2, "framing": "card", "action": "text" }], "caption": { "text": "오늘 밤 비 90%", "role": "info" }, "background": "0x111111" }
  ],
  "narration": [
    { "text": "퇴근 십 분 전, 하필 비가 쏟아졌어요.", "moment": "m1" }
  ],
  "subtitles": true
}
```

## 장면 종류

| kind | 무엇 | 필수 |
|---|---|---|
| `take` | LTX 생성 1회. 컷 2~3개 | `place`, `seconds`(1~5), `shots`(합 = seconds), `video_prompt`. 선택: `sound`, `dialogue`, `seed`, `from` |
| `photo` | 사용자의 실물 사진 + 카메라 무브 | `file` 은 `materials/` 아래 |
| `card` | 글자 카드(단색 배경). 첫 장면으로 쓰지 않는다 | `caption` |

## 이어 찍기 (`from`)

- `"from": { "take": "m1" }` — m1 의 마지막 프레임에서 시작한다(`"at": 2.5` 로 다른 시각도 가능). 같은 인물을 잇는 유일하게
  확실한 방법이다. 앞 테이크보다 뒤에만 쓸 수 있다.
- `"from": { "file": "materials/me.jpg" }` — 사용자의 실물 사진에서 시작한다.
- `from` 이 있으면 샷은 기본으로 카메라 이동(`"transition": "move"`)으로 바뀐다. `"transition": "cut"` 을 쓰면 경고가 난다
  (하드 컷 뒤에는 새 얼굴이 나온다).

## 글자

- `moments[].caption` — 그 장면 내내 보이는 화면 문구. `role`: `hook`(첫 장면 큰 제목), `title`, `info`(가운데 큰 글자).
- `moments[].subtitles` — 장면 안 대사 자막 `{ text, at, seconds }` (`at` 은 장면 시작 기준 초).
- `narration[]` — 음성(TTS)으로 읽고, `subtitles: false` 가 아니면 자막으로도 깐다. 한 문장이 여러 컷에 걸쳐도 된다.
  `moment` 를 적으면 그 장면이 시작할 때 읽고, 없으면 앞 줄에 이어 읽는다. 길이는 `sd.mjs voice` 가 실제 음성으로 잰다.

## 파일 규칙

- `takes/<moment>.mp4` — `sd.mjs takes wait`(또는 `takes poll`)가 받는다. `jobs/` 는 제출 기록(지우지 않는다).
- `audio/narration/*.wav` — 침묵을 잘라 낸 내레이션, `audio/narration.json` — 실측 길이와 시각.
- `out/draft.mp4`(애니매틱), `out/final.mp4`(완성본), `out/contact.png`(검수용 접촉 시트).
