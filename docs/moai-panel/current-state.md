# Moai 확장과 SDK 현황

2026-10-14, Moai 확장 1.1.1과 SDK 0.7.0 기준으로 개편 전 상태를 정리한다. 개편 방향은 [개편 계획](overview.md)과 [설계](design.md)에 있다.

> **읽는 법.** 아래 2.0 절은 마일스톤 브랜치 `milestone/se-9inv`에 **머지된 것**(`216ecb3` 기준)을 적는다. 1~7절은 개편 **전** 상태(1.1.1)의 기록이고, 바뀐 부분은 2.0 절이 우선한다. 아직 머지되지 않은 작업은 "진행 중"이라고 따로 표시한다.

## 2.0 구현 결과

### 2.0.1 어디까지 왔나

- 브랜치는 `milestone/se-9inv`(`.worktrees/milestone-se-9inv`)다. `main`에는 아직 들어가지 않았고 릴리스는 사람이 한다.
- `packages/moai/extension.json`의 버전은 여전히 **1.1.1**이다. 2.0.0 올림과 릴리스 파일명 갱신은 E8(`se-bz5y`) 몫이라 아직 하지 않았다.
- 에픽별 상태(2026-10-14 기준):

  | 에픽 | 머지된 것 | 남은 것 |
  |---|---|---|
  | E1 `se-89fu` 기반 | 단일 HTML 빌드, 상태 스토어, 이슈 인덱스, 요청 큐, 자동 갱신(`191dcbe`), 새 프로필·전체 행·아카이브·위키 로더(`593d497`), 보드 셈과 아카이브 NEW(`216ecb3`) | `main.ts`를 새 데이터 계층으로 바꾸는 일(`se-bco3`, `se-poaz`) — **진행 중** |
  | E2 `se-qwkz` 룩앤필·셸 | 토큰, 공용 컴포넌트, 탭 셸, 상세 위치, 좁은 폭, 셸 조립과 기억 | 없음 (완료) |
  | E3 `se-c10x` 뷰 | 목록, 칸반, 상세, 열, 뷰 토글, 가상 스크롤(`0fb9e6a`) | 없음 (완료) |
  | E4 `se-cv7w` 검색·필터·정렬 | `query.ts`, `toolbar.ts` 순수 로직과 뷰(`84741b6`) | 스토어·목록에 잇기(`se-cv7w.0qk`) **진행 중**, 설정 영속화(`se-cv7w.lca`) 대기 |
  | E5 `se-pbqz` 단축키 | 키 표, 키 라우터, SPC 메뉴, 도움말(`4d8ae65`) | 패널에 잇기(`se-jwl3`), 한글 입력 소스(`se-pbqz.k84`) — **진행 중** |
  | E6 `se-ehdi` 읽음 | `data/read.ts` 판정과 쓰기(`593d497`), 아카이브 행 NEW 끔(`216ecb3`) | NEW 뱃지와 읽음 키(`se-ehdi.zcx`) |
  | E7 `se-rhu3` 위키 | 마크다운 렌더러, 위키 뷰, 검색·역링크·링크 따라가기, 라이브 프로필 로더(`4cae158`, `51bb880`, `593d497`) | 위키 탭을 셸에 잇기(`se-jj42`) — **진행 중** |
  | E8 `se-bz5y` 출시 | 사용자 문서 `packages/moai/PANEL.md`와 `README.md` 패널 절(`c5d1b58`) | 버전 2.0.0, 릴리스, i18n 정리, 이 위키 갱신 |

- **지금 머지된 패널이 실제로 하는 일.** 탭 바(칸반·목록·위키), 경로줄, 칸반·목록·상세 뷰, 분할과 리사이저, 상세 위치 토글, 마지막 탭·상세 설정 기억까지는 마일스톤 브랜치에서 돈다. 그러나 `panel/main.ts`는 아직 **`prime`만 읽는** `loadRows`를 쓰고, 키 라우터·툴바·위키 본문·읽음 키는 `main.ts`에 이어져 있지 않다. 위키 탭은 `PANES`에 등록되지 않아 자리표시자를 보여 준다(`panel/view/panes.ts`).
- **진행 중인 배선 묶음.** 위 "남은 것" 중 `se-jwl3`, `se-pbqz.k84`, `se-cv7w.0qk`, `se-jj42`, `se-bco3`, `se-poaz`는 한 워크트리(`.worktrees/se-pbqz`, 브랜치 `worktree-se-pbqz`, 세션 `saycode-extensions-08`)에서 함께 작업 중이다. 커밋은 `ab59484`, `a8329a3`, `269e516`, `919d132`, `d446082`까지 쌓였고, 묶음 전체의 epic-end 리뷰 `se-pbqz.y8z`(max)가 돌고 있다. **리뷰와 머지가 끝나기 전에는 이 묶음이 마일스톤에 없다.** 이 절의 이후 내용 중 "묶음"이라고 적은 것은 이 브랜치의 동작이다.

### 2.0.2 파일과 모듈

`packages/moai/`가 `panel.html` 한 파일(530줄)에서 TS 모듈 약 40개로 바뀌었다. 패널 소스는 `panel/` 아래 약 9,600줄이고, 테스트는 `tests/moai-*.test.mjs` 20여 개다.

| 경로 | 역할 |
|---|---|
| `build.mjs` | esbuild로 `panel/main.ts`를 묶고 `panel/style/*.css`(토큰 → 컴포넌트 → 뷰별)와 함께 단일 `dist/panel.html`로 인라인한다. 512 KiB 이하와 인라인 전용을 검사한다. `extension.json`의 `entrypoint`가 `dist/panel.html`이고 옛 `panel.html`은 지웠다 |
| `src/index.ts` | `machine.run` 중계. 값 없는 프로필 집합과 "문자열 하나를 받는" 프로필 표(`id`·`slug`·`group`·`after`)로 화이트리스트를 가린다. `-`로 시작하는 값은 플래그로 읽히므로 거절한다 |
| `panel/store.ts` | 단일 상태와 순수 리듀서. 다시 읽어도 커서는 id에 남는다 |
| `panel/data/client.ts` | 요청 큐(동시 실행·우선순위·공유·취소·`workspace-busy` 재시도·`truncated`) |
| `panel/data/source.ts` | 프로필별 읽기 함수: `loadAllRows`, `loadStatuses`, `loadTallies`, `loadArchived`, `loadWikiListing`, `loadWikiPage`, `loadDetail`, `addTask` |
| `panel/data/index.ts` | 이슈 인덱스 — `nav.rs` 이식(계층, 에픽이 마일스톤을 이김, 상속된 미룸, 바구니, n/n) |
| `panel/data/query.ts` | 검색·필터 파서와 매처, 정렬 비교기(`query.rs` 이식) |
| `panel/data/read.ts` | 읽음 판정과 쓰기 (설계의 `unread.ts`를 이 이름으로 만들었다) |
| `panel/data/refresh.ts` | 60초 자동 갱신, 수동 갱신, 갱신 시각 |
| `panel/data/memory.ts` | 마지막 탭·상세 표시·위치·위치별 비율 기억 |
| `panel/keys/table.ts`, `router.ts` | 키 표(데이터)와 keydown → 시퀀스 → 액션 라우터 |
| `panel/view/` | `shell`, `tabs`, `crumbs`, `split`, `responsive`, `list`(+`list-model`), `board`(+`board-groups`), `detail`(+`detail-format`), `toolbar`, `menu`, `help`, `wiki`, `markdown`, `components`, `icons` |
| `panel/i18n/` | en·ko·ja·zh 표 |

### 2.0.3 프로필 13개

선언은 `packages/moai/extension.json`에 있고 모두 `moai --json -C {{workspaceRoot}} …` 꼴이다. 개편 전 4개에서 9개가 늘었다. 공통 설정(`timeoutMs 120000`, `outputLimitBytes 1048576`, `stdin: none`, `descendantAllowlist: [git]`)은 그대로다.

| 프로필 | argv(`…` 뒤) | 매개변수 | 용도 |
|---|---|---|---|
| `status` | `status` | | 칸 이름·셈 |
| `prime` | `prime` | | 잡은 것과 준비된 것 (`show --all`이 잘렸을 때의 대체) |
| `show` | `show {{id}}` | `id` ≤128 | 상세 |
| `add` | `add {{title}}` | `title` ≤512 | 추가. `writeScope: "moai"`, 매번 승인 |
| `show-all` | `show --all` | | 활성 행 전체(done·미룸 포함, 아카이브 제외) |
| `backlog-all` | `backlog show --all` | | backlog 행 |
| `show-archived` | `show --archived -n 200 --sort id` | | 아카이브 첫 쪽 |
| `show-archived-after` | 위와 같고 `--after {{after}}` | `after` ≤128 | 아카이브 다음 쪽 |
| `wiki-ls` | `wiki ls` | | 위키 목록·링크·역링크 |
| `wiki-show` | `wiki show {{slug}}` | `slug` **≤128** | 위키 본문 |
| `read` | `read {{id}}` | `id` ≤128 | 한 행 읽음 |
| `read-all` | `read --all` | | 모두 읽음 |
| `read-group` | `read -e {{group}}` | `group` ≤128 | 그룹 읽음 |

설계(3.1절)에서 달라진 점:

- **`backlog`가 아니라 `backlog-all`이다.** 설치된 데몬 카탈로그(happy-cli `1.1.10-aplus.320`)의 `buzzni.moai.backlog`는 이미 `backlog add {{title}}`(쓰기)라서, 읽기용은 `backlog show --all`을 가리키는 **다른 id**로 선언했다. 데몬에도 이 id로 추가돼야 한다.
- 설계에는 `show-archived -n {{limit}} --after {{after}}` 하나였지만, 매개변수 값이 비어 있을 수 없으므로 **첫 쪽(`show-archived`)과 다음 쪽(`show-archived-after`) 두 개**로 나눴다. 쪽 크기 200은 프로필에 박혀 있다(`ARCHIVE_PAGE`).
- `wiki-show`의 `slug` 상한은 데몬의 선언과 같은 **128자**다. 처음 설계는 더 길게 잡았다.
- 개편 전부터 있던 `status`·`prime`·`show`·`add`·`wiki-ls`·`wiki-show`만 데몬 카탈로그와 일치함을 확인했다. 나머지 일곱 개는 **데몬에 추가될 것으로 가정**한 선언이다(`se-0g4a.anz`, 실기 확인 전).
- 쓰기 프로필은 여전히 `add` 하나다. `read*`는 트래커가 아니라 `~/.config/moai/read/`에만 쓰므로 `writeScope`를 붙이지 않았다.

### 2.0.4 요청 큐: 동시 3, `workspace-busy` 재시도

- `PANEL_CLIENT_OPTIONS = { concurrency: 3, busyAttempts: 3, busyBackoffMs: 1000 }`이다(`panel/data/client.ts`). 기본값(옵션을 주지 않은 클라이언트)은 개편 전과 같은 **한 번에 하나, 재시도 없음**이다.
- **동시 3**은 실측으로 정한 값이 아니라 `se-0g4a.fjl`의 제안이다. SDK·Desktop 코드상 읽기 전용 프로필의 병렬을 막는 규정이 없다는 근거뿐이고, 실제로 겹쳐 도는지는 라이브 확인이 남았다.
- 데몬의 락은 **쓰기 범위(WRITE-scope) 락**이고, 겹치는 쓰기는 기다리지 않고 즉시 `workspace-busy`로 거절한다. 읽기 요청이 이 코드를 받으면 큐로 되돌려 최대 3번, 1초·2초 간격으로 다시 시도한다(공유 읽기만. 쓰기와 취소된 요청은 재시도하지 않는다). 그래도 실패하면 정보성 거부로 보여 준다.
- 우선순위: 상세 > 위키 > 목록 갱신. 같은 `profileId+params` 요청은 공유한다.
- 출력 한도: 데몬이 stdout을 1 MiB에서 자르고 `truncated: true`를 단다(오류 코드가 아니다). 잘린 JSON은 파싱되지 않으므로 결과는 `unreadable` + `truncated`다. 목록은 이때 **`prime`으로 물러나** 일부만 보여 주고 배너로 알린다(`loadAllRows`).
- 실측(`se-0g4a.fjl`, 2026-10-14): 이 저장소 64행은 `show --all` 35 KB, 가장 큰 moa-issue의 활성 24행은 44 KB로 한도의 4%다. moa-issue 아카이브 2,289행은 2.35 MB로 한도의 2.2배라 쪽 나누기가 필수이고, `-n 500`은 쪽당 최대 532 KB(여유 2배), `-n 200`은 약 200 KB(20%)다. 쪽 정렬은 `--sort id`로 고정해야 `--after`가 흔들리지 않는다.
- 취소: 한 번에 하나만 보이던 Cancel 대신, 실행 중인 요청 중 첫 번째를 취소한다(묶음에서는 진행 중인 모두를 취소하도록 바꾸는 중).

### 2.0.5 기억(memory): 프레임 localStorage, 전역

- 기억하는 것은 **마지막 탭, 상세 표시 여부, 상세 위치, 위치별 비율(`ratio.left`, `ratio.bottom`)** 네 가지뿐이다(`panel/data/memory.ts`).
- 저장소는 **패널 프레임의 `localStorage`**를 쓴다. 키는 `buzzni.moai.panel` **하나**이고 버전 필드(`MEMORY_VERSION = 1`)를 함께 쓴다. 프로젝트 이름이 키에 들어가지 않으므로 기억은 **전역**이다 — 작업 영역마다 따로 두지 않는다. 설계 5절은 탭을 "프로젝트 범위"로 적었지만 구현은 전역이다.
- sandbox에 `allow-same-origin`이 없으면 프레임 origin이 opaque라서 `localStorage` 접근이 `SecurityError`를 낸다. 그래서 백엔드는 getter로 받고, 읽기·쓰기가 하나라도 던지면 **그 세션 동안만 메모리에 둔다**. 저장 실패는 패널을 멈추지 않고 기본값으로 돌아갈 뿐이다.
- `storage.read`/`storage.write` 권한은 쓰지 않는다. 액션 시그니처가 이 저장소에 없기 때문이다. 순서(localStorage → `storage.*` → 세션)는 설계와 같지만 가운데 단계는 비어 있다.
- 읽은 값은 `normalizeMemory`가 모두 정리한다. 모르는 탭이나 범위를 벗어난 비율은 기본값으로 떨어지고, 값이 하나도 없어도 기본(탭 칸반, 상세 표시, 아래, 비율 기본값)으로 뜬다.
- 검색·필터·정렬·열·보기 설정은 **아직 기억하지 않는다.** `se-cv7w.lca`가 실기 스파이크 `se-0g4a.y91`을 기다린다.

### 2.0.6 읽음, 아카이브, 보드 셈

- **안 읽음 판정은 패널이 계산하지 않는다.** CLI가 `show --json` 행과 `show <id> --json`에 `"unread": true`를 찍어 준다. 안 읽음이 아니면 키 자체가 없고 `false`는 나오지 않는다. 패널은 `row.unread === true`만 본다. 사람을 모르거나 읽음 표를 못 읽으면 어느 행에도 키가 없고 NEW는 꺼진다. 이는 상류 `moai-cqwy`가 구현된 것으로 **가정**한 동작이다.
- **아카이브 행은 NEW가 되지 않는다.** `isUnread`는 `archived: true`가 붙은 행을 건너뛴다. `moai read`가 활성 행만 풀기 때문에, 아카이브에서만 온 행의 NEW는 지울 방법이 없기 때문이다(`se-fvou`). `loadArchived({ active })`는 활성 행에 없는 id만 `archived: true`로 표시한다. 그래서 상류에는 "아카이브 읽음" 요청을 하지 않았다.
- **읽음 쓰기**는 `read <id>`, `read --all`, `read -e <group>`이다. 결과 JSON은 `{read, missing, held, problems, at}`이고, 없는 id나 그룹이 있어도 나머지를 쓰고 0이 아닌 코드로 끝나지만 그 답은 그대로 넘긴다. 쓰기 후에는 늘 다시 읽는다.
- **설계와 다른 점.** 설계 4.9절은 "화면에 그린 행의 `updated_at`을 적는다"고 했지만, CLI는 값을 받지 않고 행의 **현재** `updated_at`을 적는다. 그린 뒤 바뀐 행도 새 버전으로 읽음 처리된다. 결과에 id별 `updated_at`이 없어 낡은 그림을 쓰기 결과로는 알 수 없다. 패널은 쓰기 뒤 다시 읽은 행과 그린 행을 비교(`staleAgainst`)할 수 있을 뿐이다. 상류에 값 지정을 요청하는 일은 backlog(`se-a5wl`)에 있다.
- **보드 셈(n/n)은 `status --json`의 `milestones[]`·`epics[]`의 `done`·`total`을 쓴다.** 시간으로 아카이브된 행은 `show --all`에 없으므로, 행에서 세면 완료된 그룹이 줄어 보인다. `IssueIndex(rows, tallies)`가 셈을 받으면 `moai status`와 같은 값을 보여 준다(`se-tcd4`). 셈을 못 읽으면 행에서 센다. 같은 `status` 요청은 `loadStatuses`와 공유한다.
- **칸 이름과 순서.** `status --json`에 `statuses` 배열이 있다고 **가정**하고 읽는다. 없으면 `counts`의 키(빈 칸 포함)를 쓰되 알파벳순이라 설정 순서를 잃으므로, 기본 순서 `todo, in_progress, review, done` 뒤에 모르는 칸을 붙인다.

### 2.0.7 위키 탭

- 렌더러(`view/markdown.ts`)는 제목·문단·중첩 목록·코드·인용·표·가로줄·강조·링크에 더해 HTML 엔티티, 참조 링크, 취소선, 작업 목록을 지원한다. raw HTML은 모두 이스케이프하고 `href` 없는 링크는 남기지 않는다. 강조 파싱은 선형 시간이다(리뷰에서 지수 시간 백트래킹을 고쳤다).
- 위키 뷰(`view/wiki.ts`)는 목록·본문 2단, 검색(제목·본문), 역링크, 링크 순환(Tab), 되감기 trail, GitHub 앵커, 이슈 id 점프를 한다. 본문 이슈 id는 `wiki ls`의 `issues[]`로 링크가 된다.
- 라이브 프로필 로더(`loadWikiListing`, `loadWikiPage`)는 Moai가 낸 JSON을 가공하지 않고 넘기고, 뷰가 해석한다.
- **진행 중:** 위 모두가 셸의 위키 탭에 아직 안 붙어 있다. 상태 저장·복원(탭을 바꿔도 trail 유지), 키 라우터에서 `wiki.handleKey` 호출(`standaloneKeys: false`), 위키 안 Tab에서 빠져나오는 길, `SPC v r` 연결이 묶음(`se-jj42`)의 일이다.

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
