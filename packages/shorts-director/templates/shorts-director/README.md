# 숏폼 총감독

요청 하나로 세로 숏폼(9:16)을 기획부터 검수 대기 완성본까지 만드는 프로젝트 템플릿입니다.
대화에서 "○○ 숏폼 만들어줘"라고 하면 에이전트가 `.claude/skills/shorts-director/SKILL.md` 의 단계대로 진행합니다.

## 준비물

| 무엇 | 확인 | 비고 |
|---|---|---|
| macOS | — | 화면 글자를 macOS 기본 기능(JXA)으로 그립니다 |
| Node.js 20 이상 | `node -v` | |
| ffmpeg | `ffmpeg -version` | `brew install ffmpeg` |
| 영상 서버(LTX-2.5) | `.env` 에 `LTX_URL=http://…:8010` | 글로 영상과 소리를 만듭니다. 한 번에 최대 5초 |
| 음성 서버(Qwen3-TTS) | `.env` 에 `QWEN_TTS_URL=http://…:8765`, `QWEN_TTS_TOKEN=…` | 토큰은 `~/.config/shorts-director/tts-token` 에 둬도 됩니다 |
| Python 3 (선택) | `python3 --version` | 지식 원문 가져오기에만 씁니다 |

## 흐름

1. 의도·훅 질문 → 2. 조사 → 3. 기획(`plan.json`) → 4. 기획 점검 → 5. 제작 결정
→ 6. 애니매틱(`out/draft.mp4`, 영상 생성 없음) → 7. 테이크 생성 → 8. 조립(`out/final.mp4`) → 9. 화면 검수 → 10. 완료

진행 상황은 `status.md` 에 남습니다. 대화를 새로 열어도 거기서 이어 갑니다.

## 자율 모드

| 모드 | 어디까지 |
|---|---|
| `manual` | 단계마다 확인 |
| `plan` | 기획·제작 결정까지 |
| `draft` | 애니매틱까지 (영상 생성 없음) |
| `auto` — 끝까지 맡기기 | 검수 대기 완성본까지 |

## 시간 (2026-11-21 실측)

- 영상: 576×1024, 5초 테이크 한 개에 약 1분 30초. 서버가 순서대로 처리하므로 테이크 5개면 약 8분.
- 음성: 한 줄에 약 10~17초.
- 조립: 30초 영상에 약 10초.
- 같은 테이크는 다시 생성하지 않고 재사용합니다.

## 지식 원문 (사내, 선택)

shorts_maker(viskit) 저장소에 접근할 수 있으면 총감독 기획 원문을 로컬로 가져와 더 정교하게 기획합니다.

```bash
python3 tools/import-viskit-knowledge.py --from /path/to/shorts_maker
```

`knowledge/` 는 비공개 자료라 `.gitignore` 에 들어 있습니다. 커밋하거나 공유하지 마세요.
없으면 요약본(`.claude/skills/shorts-director/references/craft.md`)으로 진행합니다.

## 직접 쓰는 명령

```bash
node tools/sd.mjs doctor         # ffmpeg·영상 서버·음성 서버 확인
node tools/sd.mjs check          # plan.json 규칙 검사
node tools/sd.mjs voice          # 내레이션 음성(TTS) + 길이 맞춤 확인
node tools/sd.mjs animatic       # 콘티 카드 밑그림 영상 out/draft.mp4
node tools/sd.mjs takes submit   # 테이크 제출
node tools/sd.mjs takes wait     # 끝날 때까지 확인·다운로드 (takes poll 은 한 번만)
node tools/sd.mjs render         # 완성본 out/final.mp4
node tools/sd.mjs sheet          # 검수용 접촉 시트 out/contact.png
node tools/sd.mjs status         # 진행판 status.md
node --test tools/test/          # 도구 테스트 (서버 호출 없음)
```

리허설은 `config/settings.json` 에 `"fake": true` 를 넣으면 서버를 부르지 않고 테스트 패턴으로 전체 흐름을 돌립니다.

## 알아 둘 것

- LTX는 이미지를 받지 않아 테이크마다 인물 얼굴이 조금씩 달라질 수 있습니다. 같은 외형 묘사를 매번 넣어 줄입니다.
- 영상 프롬프트에 "자막 넣지 마" 같은 말을 쓰면 오히려 가짜 글자가 생깁니다. 검사기가 막습니다.
- 완성본은 AI 생성 영상입니다. 게시 전에 사람이 검수합니다.
