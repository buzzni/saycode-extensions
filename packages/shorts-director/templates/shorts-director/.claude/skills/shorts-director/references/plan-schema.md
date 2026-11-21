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
      "id": "m1", "kind": "take", "place": "Seoul subway exit at dusk", "seconds": 8, "subjects": ["hero"],
      "first_frame": { "prompt": "She stops at the top of the subway stairs, rain pouring outside, phone camera, eye level" },
      "video_prompt": "Handheld phone footage, rainy Seoul evening, cool streetlight, realistic.",
      "shots": [
        { "seconds": 2, "framing": "wide", "action": "she freezes at the exit as the rain gets heavier" },
        { "seconds": 2, "framing": "close-up", "action": "her face drops" },
        { "seconds": 2, "framing": "pov_hands", "action": "she digs through an empty tote bag" },
        { "seconds": 2, "framing": "over the shoulder", "action": "people with umbrellas pass her" }
      ],
      "dialogue": [{ "speaker": "the woman", "text": "아 진짜…" }],
      "caption": { "text": "우산 없이 나온 날", "role": "hook" }
    },
    { "id": "m2", "kind": "photo", "file": "materials/umbrella.jpg", "seconds": 3, "shots": [{ "seconds": 3, "framing": "photo", "action": "slow push in" }] },
    { "id": "m3", "kind": "card", "seconds": 2, "shots": [{ "seconds": 2, "framing": "card", "action": "text" }], "caption": { "text": "오늘 밤 비 90%", "role": "info" }, "background": "0x111111" }
  ],
  "narration": [
    { "text": "비 오는 날 퇴근길, 우산 없이 나와 본 적 있죠?", "style": "a little teasing, quick" }
  ],
  "subtitles": true
}
```

## 장면 종류

| kind | 무엇 | 필수 |
|---|---|---|
| `take` | 영상 생성 1회. 같은 순간·같은 장소의 컷 여러 개를 시간 구간으로 넣는다 | `place`, `seconds`(3~15 정수), `shots`(합 = seconds), `video_prompt`. 인물이 있으면 `first_frame` |
| `photo` | 사용자의 실물 사진 + 카메라 무브 | `file` 은 `materials/` 아래 |
| `card` | 글자 카드(단색 배경). 첫 장면으로 쓰지 않는다 | `caption` |

## 글자

- `moments[].caption` — 그 장면 내내 보이는 화면 문구. `role`: `hook`(첫 장면 큰 제목), `title`, `info`(가운데 큰 글자).
- `moments[].subtitles` — 장면 안 대사 자막 `{ text, at, seconds }` (`at` 은 장면 시작 기준 초).
- `narration[]` — 음성(TTS)으로 읽고, `subtitles: false` 가 아니면 자막으로도 깐다. 한 문장이 여러 컷에 걸쳐도 된다.
  시각은 `sd.mjs voice` 가 실제 음성 길이로 정한다.

## 파일 규칙

- `stills/<subject>-sheet.png` 캐릭터·제품 시트, `stills/<moment>.png` 첫 프레임 — `sd.mjs stills` 가 만든다.
- `takes/<moment>.mp4` — `sd.mjs takes poll` 이 받는다. `jobs/` 는 제출 기록(지우지 않는다).
- `out/draft.mp4`(애니매틱), `out/final.mp4`(완성본), `out/contact.png`(검수용 접촉 시트).
