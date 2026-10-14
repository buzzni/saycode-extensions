# Moai 확장과 SDK 현황

2026-10-14, Moai 확장 1.1.1과 SDK 0.7.0 기준으로 개편 전 상태를 정리한다. 개편 방향은 [개편 계획](overview.md)과 [설계](design.md)에 있다.

## 1. 파일 구성

| 파일 | 규모 | 역할 |
|---|---|---|
| `packages/moai/extension.json` | 86줄 | 매니페스트: id `buzzni.moai`, version 1.1.1, apiVersion 3, `engines.saycode ^1.2.0` |
| `packages/moai/src/index.ts` | 47줄 | `machine.run` 중계만 한다 |
| `packages/moai/panel.html` | 530줄, 약 34 KiB | 패널 전체: CSS 약 100줄, 마크업 약 30줄, JS 약 400줄 |
| `packages/moai/README.md` | 56줄 | 기능 설명 |
| `tests/moai.test.mjs` | 562줄, 약 35개 테스트 | pack, 매니페스트, jsdom 패널 테스트 |
| `tests/fixtures/moai/` | | 실제 Moai v0.8.0 출력 JSON |

## 2. 매니페스트

- 권한은 `machine.run` 하나다.
- 명령은 네 개다: `open`, `run`, `status`, `cancel`. 프로젝트 도구 `buzzni.moai.board`가 `open`을 부른다.
- `panels[].surfaceSize: "compact"`는 모달로 열릴 때만 의미가 있다. 도구 탭에서는 패널이 탭을 가득 채운다.
- `machineCommands` 프로필은 네 개다. 모두 `moai --json -C {{workspaceRoot}} …` 꼴이다.

  | 프로필 | 명령 | 비고 |
  |---|---|---|
  | `status` | `status` | |
  | `prime` | `prime` | |
  | `show` | `show {{id}}` | 128자 |
  | `add` | `add {{title}}` | 512자. `writeScope: "moai"`이고 매번 승인을 받는다 |

- 공통 설정은 `timeoutMs 120000`, `outputLimitBytes 1048576`, `stdin: none`, `descendantAllowlist: [git]`이다.
- **이 선언은 Happy 데몬의 Moai v0.8.0 카탈로그를 글자 그대로 복사한 것이다.** 데몬은 선언 해시가 카탈로그 다이제스트와 같을 때만 실행한다(`packages/moai/README.md:13`). 새 서브커맨드를 쓰려면 데몬 카탈로그도 바꿔야 한다.
- 테스트는 `init|tui|wake|hooks|editor|shell` 프로필을 금지한다(`tests/moai.test.mjs:51-66`).

## 3. 데이터 흐름

```
panel.html ── saycodePanel.invokeCommand('buzzni.moai.run', ['buzzni.moai.prime'])
  → 확장 run → machineRun(start) → Core 확인 창 → 데몬에서 moai 실행 → {state:'accepted', operationId}
panel: 500ms마다 invokeCommand('buzzni.moai.status', [opId])
  → {state: running|passed|failed|cancelled, stdout, stderr, truncated, …}
panel: stdout을 JSON.parse해서 렌더 (실패하면 stderr JSON의 .error)
```

- 스트리밍은 없다. 실행이 끝난 뒤 stdout 전체(최대 1 MiB)를 한 번에 받는다.
- 갱신은 Refresh 버튼과 add 직후 재로드뿐이다.
- 전역 `busy` 플래그 때문에 **한 번에 한 실행**만 하고, 그동안 모든 버튼이 잠긴다.
- 승인은 읽기는 세션에 한 번, add는 매번 받는다.
- `start()`는 `MachineRunError`의 거부 코드를 `{state:'refused', code}` 결과로 바꾼다. 패널 브리지가 에러 메시지만 넘기기 때문이다(`src/index.ts:9-19`).

## 4. 지금 패널 UI

- 상단 안내, 할 일 추가 입력, Refresh / Show status 버튼, 스피너, Cancel이 있다.
- status 결과는 칩 네 개(todo, in_progress, review, done)로 보인다.
- 보드는 In progress / Review / To do **세로 그룹 목록**이다. `prime`의 `picked`, `others`, `ready`를 합치고 done은 뺀다. 각 항목에는 `{id, title, status, priority}`만 있다.
- 상세는 보드를 숨기고 같은 자리에 뜬다. status, priority, assignee, created, id, 본문, 하위 항목, 이력(journal)을 보여 준다.
- 없는 것:
  - 탭, 위키
  - 검색, 필터, 정렬, 보기, 열
  - 읽음 표시
  - 단축키(Enter로 add만 됨)
  - 칸반, 트리, 상태 이동
- 상태는 모듈 수준 `let` 몇 개(`busy`, `operationId`, `openedFrom`)뿐이고 데이터는 DOM에만 있다.
- 테마 v1은 정식으로 쓴다: `--fb-*` 폴백과 `--saycode-*` 해석(`panel.html:2-32`).
- i18n은 en, ko, ja, zh를 인라인 표로 둔다.

## 5. SDK가 허용하는 것과 막는 것

| 항목 | 상태 |
|---|---|
| 패널 → 확장 | `window.saycodePanel.invokeCommand(id, args)`만 있다. 인자와 결과는 JSON 값이다 |
| 확장 → 패널 푸시 | **없다.** 폴링으로 대신한다 |
| 명령 실행 | 매니페스트에 선언한 프로필만 쓸 수 있다. 파라미터는 `string`/`integer`이고 길이·범위 제한이 있다. 쓰기 프로필에는 `writeScope`와 `descendantAllowlist`가 필요하다 |
| 파일 읽기 | 일반 API는 없다. `filePreviews.read`(API 4)는 사용자가 고른 미디어 파일만 다룬다. 위키는 `moai wiki` 프로필로 읽어야 한다 |
| 저장소 | `storage.read/write` 권한 이름만 있고 액션 시그니처는 이 저장소에 없다. localStorage는 opaque origin이라 쓸 수 있을지 불확실하다 |
| 키보드 | SDK API는 없다. 패널 안에서 `keydown`으로 받아야 한다 |
| 테마 | v1: `data-theme`과 `--saycode-*` 10개. 재로드 없이 갱신된다 |
| 크기 | `surfaceSize`(compact, standard, wide)는 모달에만 적용된다 |
| 제약 | 네트워크, Node, 파일시스템, 폼 제출, `crypto.subtle`이 없다. 패널은 인라인 스크립트만 허용하고 512 KiB 이하, UTF-8이어야 한다(`packages/sdk/src/cli.ts:133-170`) |
| 거부 코드 | `unsupported-daemon`, `invalid-request`, `binding-mismatch`, `declined`, `approval-timeout`, `workspace-busy`, `tool-missing`, `unsupported-platform` |

## 6. 빌드·테스트·버전 관례

- **pack**: `npm run package:moai`가 `src/index.ts`를 esbuild로 번들하고, `extension.json`과 `panel.html`을 넣어 결정적 zip을 만든다.
  - 패널을 여러 파일로 나누려면 `build.mjs`로 `dist/panel.html`을 만들고 entrypoint를 바꾼다. media-preview가 선례다.
- **테스트**: `npm test`는 빌드 후 `node --test tests/*.test.mjs`를 돌린다.
  - `packages/test-host`가 Desktop 없이 확장을 활성화한다.
  - `tests/moai.test.mjs`는 실제로 pack한 zip에서 패널을 꺼내 jsdom에 올린다. 패널 DOM id(`PANEL_IDS`)에 의존하므로 재작성하면 대부분 다시 써야 한다.
- **CI·릴리스**: `.github/workflows/ci.yml:37-39`에 테스트 목록이 있다. `.github/workflows/release.yml:62,86-87`에는 `buzzni.moai-1.1.1.saycode-extension` 파일명이 하드코딩되어 있어 버전을 올릴 때 함께 바꿔야 한다.
- **버전**:
  - 확장은 `extension.json`과 `package.json`을 함께 올린다. 기능 추가는 minor, 문구·UX 수정은 patch다. 이번 개편은 2.0.0이다.
  - SDK를 바꾸면 `packages/sdk/package.json`, 모든 워크스페이스의 정확한 핀, `package-lock.json`을 같이 올린다.
- **커밋**: `[behavioral]` / `[structural]` 접두어를 붙인다.

## 7. 재작성 판단

재작성한다. 근거는 다음과 같다.

- 칸반, 목록, 위키 탭, 상시 상세, 검색·필터·정렬, 읽음, 단축키를 넣으려면 데이터 모델, 파생 뷰, 선택·포커스 상태, 키 라우터가 있어야 한다.
- 지금 구조는 DOM이 곧 상태이고 전역 락으로 직렬 실행한다. 이 기능들과 맞지 않는다.
- 예상 규모가 2,000줄을 넘어서 파일 하나에 손으로 쓰기에는 유지보수가 어렵다.

옮겨 쓸 것:

- 테마 변수 블록
- i18n 표
- `run()`, `poll()`, 거부 코드 처리
- `NOT_A_REPOSITORY`와 `moai init` 안내
- IME 안전 Enter
- 날짜 헬퍼와 `journalText`
