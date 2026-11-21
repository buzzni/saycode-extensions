# 영상 프롬프트 (Gemini Omni Flash, 공식 API)

출처: Google 공식 문서 "Generate and edit videos with Gemini Omni Flash"(ai.google.dev/gemini-api/docs/omni).
Gemini 앱(웹)에서의 동작은 실측 전이라 이 문서는 **API 기준 잠정본**이다.

## 도구가 자동으로 하는 것 (`tools/lib/takes.mjs`)

`video_prompt` 뒤에 컷 시간표와 대사, 조용히 하라는 줄을 붙인다:

```
<video_prompt>

Shots (hard cuts between them, same place and moment):
[0-2s] wide: ...
[2-4s] close-up: ...

Spoken lines:
the woman says in Korean: "..."

No subtitles, no captions, no on-screen text. No background music.
```

첫 프레임 이미지가 있으면 맨 앞에 "Image 1 is the first frame of the video; start exactly from it." 가 붙는다.

## video_prompt 쓰는 법

- 촬영 방식 → 스타일 → 빛 → 장소 → 분위기 순서로 짧게. 예: "Handheld phone footage, realistic, cool streetlight, rainy Seoul subway exit at dusk."
- 이미지의 역할은 자연어로 쓴다. `<IMAGE_REF_0>`, `<FIRST_FRAME>` 같은 제어 태그는 폐기됐다(검증기가 막는다).
- 부정 지시는 평범한 문장으로 쓴다("Do not show any logos."). 별도 negative prompt 필드는 없다.
- 길이는 3~15초 정수. 첫·마지막 프레임을 둘 다 주면 10초 이하.
- 참조 이미지는 한 호출에 최대 6장.
- 가격·숫자·로고 글자는 그리게 하지 않는다 — 화면 글자로 얹는다.
- 실존 인물로 보이는 얼굴, 미성년자 이미지는 거부될 수 있다. 차단되면 인물 참조를 빼고 → 묘사를 줄이고 → 그래도
  안 되면 그 장면을 실사진·카드로 바꾼다(사용자 승인 후 다시 제출).

## 확인

받은 테이크가 컷 시간표대로 끊겼는지 `node tools/sd.mjs cuts takes/<id>.mp4` 로 장면 전환 시각을 본다.
