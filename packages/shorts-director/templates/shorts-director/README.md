# 숏폼 총감독

요청 하나로 세로 숏폼(9:16)을 기획부터 검수 대기 완성본까지 만드는 프로젝트 템플릿입니다.
대화에서 "○○ 숏폼 만들어줘"라고 하면 에이전트가 `.claude/skills/shorts-director/SKILL.md` 의 단계대로 진행합니다.

## 준비물

| 무엇 | 확인 | 비고 |
|---|---|---|
| macOS | — | 화면 글자를 macOS 기본 기능(JXA)으로 그립니다 |
| Node.js 20 이상 | `node -v` | |
| ffmpeg | `ffmpeg -version` | `brew install ffmpeg` |
| Gemini API 키 | `.env` 에 `GEMINI_API_KEY=...` | 영상(Omni)·음성(TTS)·이미지에 씁니다. `.env` 는 커밋되지 않습니다 |
| Python 3 (선택) | `python3 --version` | 지식 원문 가져오기에만 씁니다 |

## 흐름

1. 의도·훅 질문 → 2. 조사 → 3. 기획(`plan.json`) → 4. 기획 점검 → 5. 제작 결정
→ 6. 애니매틱(`out/draft.mp4`, 영상 생성 0회) → 7. 테이크 생성 → 8. 조립(`out/final.mp4`) → 9. 화면 검수 → 10. 완료

진행 상황은 `status.md` 에 남습니다. 대화를 새로 열어도 거기서 이어 갑니다.

## 자율 모드

| 모드 | 어디까지 |
|---|---|
| `manual` | 단계마다 확인 |
| `plan` | 기획·제작 결정까지 (비용 0) |
| `draft` | 애니매틱까지 (영상 생성 0회) |
| `auto` — 끝까지 맡기기 | 검수 대기 완성본까지. 시작할 때 정한 편당 API 상한(`config/settings.json` 의 `video.api.capUsd`) 안에서만 비용을 씁니다 |

## 비용 (Gemini API, 2026-11 기준 참고값)

- 영상 출력 1초당: 360p $0.023 · 720p 약 $0.07 · 1080p $0.104 (+ 호출당 소액)
- 30초 숏폼(8초 테이크 3개, 720p) ≈ $1.7
- 같은 테이크는 다시 생성하지 않고 재사용합니다. 다시 만드는 것은 항상 확인 후에 합니다.

## 지식 원문 (사내, 선택)

shorts_maker(viskit) 저장소에 접근할 수 있으면 총감독 기획 원문을 로컬로 가져와 더 정교하게 기획합니다.

```bash
python3 tools/import-viskit-knowledge.py --from /path/to/shorts_maker
```

`knowledge/` 는 비공개 자료라 `.gitignore` 에 들어 있습니다. 커밋하거나 공유하지 마세요.
없으면 요약본(`.claude/skills/shorts-director/references/craft.md`)으로 진행합니다.

## 직접 쓰는 명령

```bash
node tools/sd.mjs check          # plan.json 규칙 검사 + 영상 백엔드·예상 비용
node tools/sd.mjs stills         # 캐릭터 시트·첫 프레임 그림
node tools/sd.mjs voice          # 내레이션 음성(TTS) + 길이 맞춤 확인
node tools/sd.mjs animatic       # 밑그림 영상 out/draft.mp4
node tools/sd.mjs takes submit   # 테이크 제출 (비용 승인이 필요하면 --approve)
node tools/sd.mjs takes poll     # 생성 확인·다운로드
node tools/sd.mjs render         # 완성본 out/final.mp4
node tools/sd.mjs sheet          # 검수용 접촉 시트 out/contact.png
node tools/sd.mjs status         # 진행판 status.md
node --test tools/test/          # 도구 테스트 (Google 호출 없음)
```

리허설은 `config/settings.json` 에 `"fake": true` 를 넣으면 Google을 부르지 않고 테스트 패턴으로 전체 흐름을 돌립니다.

## 알아 둘 것

- 생성 영상에는 AI 생성 표시(SynthID 등)가 들어갑니다. 지우지 않습니다.
- 본인 계정 Gemini 앱(웹)으로 만드는 경로는 실측 전이라 아직 연결돼 있지 않습니다.
