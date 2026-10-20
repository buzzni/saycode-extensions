# Moai 확장과 SDK 현황

2026-10-14, Moai 확장 1.1.1과 SDK 0.7.0 기준으로 개편 전 상태를 정리한다. 개편 방향은 [개편 계획](overview.md)과 [설계](design.md)에 있다.

> **읽는 법.** 아래 2.0 절은 마일스톤 브랜치 `milestone/se-9inv`에 **머지된 것**(배선 묶음 `a7fe3df` 기준)을 적는다. 1~7절은 개편 **전** 상태(1.1.1)의 기록이고, 바뀐 부분은 2.0 절이 우선한다. 아직 머지되지 않은 작업은 2.0.8절에 모았다.

## 2.0 구현 결과

### 2.0.1 어디까지 왔나

- 브랜치는 `milestone/se-9inv`(`.worktrees/milestone-se-9inv`)다. `main`에는 아직 들어가지 않았고 릴리스는 사람이 한다.
- `packages/moai/extension.json`의 버전은 **2.0.0**이다(`4c290b3`). 릴리스 파일명과 README(호환 표·출시 순서)도 맞춰졌다. 확장과 moai 버전은 따로 간다(사람 결정).
- 배선 묶음(`a7fe3df`, 리뷰 `se-pbqz.y8z` max, 15건 반영)이 머지되어 패널은 처음으로 **끝까지 이어져** 돈다. 패널 빌드 크기는 **270,357 B**(512 KiB 한도의 약 51%)다.
- 에픽별 상태(2026-10-14 기준):

  | 에픽 | 머지된 것 | 남은 것 |
  |---|---|---|
  | E1 `se-89fu` 기반 | 단일 HTML 빌드, 스토어, 이슈 인덱스, 요청 큐, 자동 갱신, 숨은 탭 갱신 멈춤(`02777e8`), 새 프로필 로더, 보드 셈, `main.ts` 전환(`se-bco3`, `se-poaz`), 보드 읽기 잔여(`se-lv9n`), 활동 줄 안내(`se-mht7`), 호환 안내 배너(`se-93p3`), 호환 판정 정리(`se-hd7v`: 바인딩 불일치는 카탈로그 증거가 아니다, 낡은 moai 줄은 쓰는 기능에만, 거부는 배너가 맡는다), 배너 타이밍(`se-q1l4`), 잘린 목록의 `r`·`SPC m g`(`se-4f4s`, `321ccf5`: 아카이브에서만 온 행은 읽음 표시를 받지 않는다), 도움말 키 가드(`se-1fy7`: Cmd/Meta와 macOS 밖의 Ctrl은 통과하고, Ctrl+Alt와 뒤의 컨트롤이 받는 키는 막는다. 최종형 `6a1d7ff`) | |
  | E2 `se-qwkz` 룩앤필·셸 | 토큰, 공용 컴포넌트, 탭 셸, 상세 위치, 좁은 폭 | 없음 (완료) |
  | E3 `se-c10x` 뷰 | 목록, 칸반, 상세, 열, 뷰 토글, 가상 스크롤 | 없음 (완료) |
  | E4 `se-cv7w` 검색·필터·정렬 | `query.ts`, `toolbar.ts`, 스토어·목록·칸반 연결(`se-cv7w.0qk`) | 없음 (완료, `997aed0`). 설정은 세션 동안만 기억하고 영속은 `se-c9mu`(SDK API 대기) |
  | E5 `se-pbqz` 단축키 | 키 표·라우터·SPC 메뉴·도움말, 패널 연결(`se-jwl3`), 한글 입력 소스(`se-pbqz.k84`), 키 소유 잔여(`se-h5c7`), 포커스 힌트 위치(`se-gq4i`) | 없음 (완료). 칸반·상세 제자리 갱신 `se-mzlx` |
  | E6 `se-ehdi` 읽음 | 판정·쓰기, 읽음 키 `r` / `SPC m a` / `SPC m g`, 아카이브 행 NEW 끔, NEW 칩(목록 행·칸반 카드·상세 머리), 탭 뱃지(프로젝트 전체 안 읽음 수, `se-ehdi.zcx`), 읽음 표시 뒤 열린 상세 다시 읽기 | 없음 (완료) |
  | E7 `se-rhu3` 위키 | 렌더러, 위키 뷰, 검색·역링크·링크 따라가기, 라이브 프로필, 셸의 위키 탭(`se-jj42`) | 없음 (완료). 위키 문구 번역은 `se-ti70`에서 끝남 |
  | E8 `se-bz5y` 출시 | 사용자 문서 `PANEL.md`, 2.0.0, README 호환 표, 크기·pack 점검, 호환 점검 데이터 쪽(`se-93p3`), i18n 4개 언어(`se-bz5y.m35`, `se-ti70`, `19c43c5`), 에픽 끝 리뷰(`se-bz5y.v5b`), 이 위키 | 열린 이슈 `se-1t2r`, `se-5y3p`, `se-kd3u`, `se-s3vv`(2.0.8절) |

- **지금 머지된 패널이 하는 일.** 탭 바(칸반·목록·위키), 경로줄, 툴바(검색·필터·정렬·보기·열), 칸반·목록·상세 뷰, 분할과 리사이저, SPC 메뉴·`?` 도움말·kbd 힌트, 위키 탭, 읽음 키가 모두 `main.ts`에 이어져 있다. 시작 때 `PANEL_CLIENT_OPTIONS`(동시 3·`workspace-busy` 재시도)로 `loadAllRows`가 `show-all`과 `backlog-all`을 읽고, 잘리면 `prime`으로 물러나 **잘림 배너**를 단다. 보드 셈은 `loadTallies`, 아카이브는 `loadArchived`다(활성 표시는 `data/source.ts`의 `withArchive`/`activeIds`가 붙인다). 행은 도착하는 대로 보드에 나오고, `status` 셈은 늦게 같은 보드에만 적용된다. 새로 고침은 자기 셈이 올 때까지 이전 셈을 둔다. `loadBoard`는 `status` 읽기를 기다리지 않는다. 아카이브 읽기 실패는 보드 실패가 아니라 배너의 `archiveProblem` 줄로 따로 보인다. 잘린 목록(`show --all` 잘림)에서는 완료 칸에 서지 않은 아카이브 행(묶음은 구성원의 칸 기준)을 활성으로 본다. 활동 줄은 한 실행이 돌고 다른 실행이 확인을 기다리면 "실행 중"과 "확인 창에서 승인"을 함께 보여 준다. 호환 안내 배너(moai 올리기·데몬 카탈로그 업데이트·moai 설치)는 `main.ts`의 `CompatProbe` 하나에서 나온다. 숨은 탭에서도 갱신기가 다시 확인하고, 실행이 시작되면 `tool-missing`이 지워진다.
- **키 소유는 라우터 한 곳이다.** 목록·칸반·위키·툴바가 따로 keydown을 처리하던 것을 정리해 `keys/router.ts`가 단일 키 주인이 되었다(`keys/wiring.ts`가 액션을 각 뷰에 나눠 준다). 입력창·IME 중에는 라우터가 물러나고, 포커스된 버튼·체크박스에서는 `Enter`/`Space`가 컨트롤의 것이다. 도움말이 열린 동안 라우터는 조용하다.
- **문구는 모두 i18n에서 나온다**(`se-ti70`, `se-bz5y.m35`). 패널의 모든 라벨이 en·ko·ja·zh 표에서 풀린다. 키 표 id의 라벨은 `copy.table`, 위키는 `copy.wiki`, 영어는 moai TUI의 `tui.*` 문구를 따른다. 영어 패널에 한국어가 남지 않는다. `SPC v a`는 메뉴에서 짧은 라벨이고 전체 문구는 도움말에 있다. 검색 범위 select의 마지막 줄은 노트를 검색하지 않는다고 말한다.
- **호환 배너 문구**(`se-xee6`, `se-ka0w`, `se-93p3`). 사람 결정에 따라 `unread`는 compat `ORDER`에서 빠졌다. 0.16도 `unread`를 찍고 키는 안 읽음 0이면 없어서 부재를 "기능 없음"으로 읽을 수 없다. 0.16은 마일스톤·에픽 셈과 아카이브 쪽 나누기를 이미 갖고 있어(README 호환 절) **배너가 아예 없다**. 보드를 대체로 읽은 이유는 배너가 따로 말한다: `shell.backlogFailed`(backlog 읽기가 거부·실패해 빠졌을 때)와 `shell.primeOnly`(카탈로그에 `show --all`이 없어 잡은 것과 준비된 것만 남았을 때).
- **한글 입력 소스.** 글자 키가 `ㅓ`나 `Process`로 오면 `event.code`(`KeyA`~`KeyZ`, `Digit0`~`Digit9`)의 US 배열 글자로 읽는다(`router.ts` `codeKey`). **실기 확인은 아직 남았다**(`se-0g4a.zrf`).
- **툴바는 한 번만 만든다.** 데이터가 바뀔 때 다시 그리지 않고 값만 갱신하므로 입력 중인 IME 조합이 끊기지 않는다(`view/toolbar.ts`).
- **스토어 어휘.** 칸 이름은 `status`(`statuses`), 사람 이름은 `names`, 아카이브 표시는 `showArchived`다. `showArchived`는 **참이면 아카이브 행을 보인다**(기본 거짓). 위키 탭 상태(trail·검색·선택)는 탭을 바꿔도 저장·복원된다.
- **취소.** Cancel은 읽기와 이미 실행 중인 쓰기만 취소한다. 아직 시작 안 한 쓰기는 건드리지 않는다(리뷰 #7).

### 2.0.2 파일과 모듈

`packages/moai/`가 `panel.html` 한 파일(530줄)에서 TS 모듈 약 40개로 바뀌었다. 패널 소스는 `panel/` 아래 약 11,400줄이고, 테스트는 `tests/moai-*.test.mjs` 20여 개다.

| 경로 | 역할 |
|---|---|
| `build.mjs` | esbuild로 `panel/main.ts`를 묶고 `panel/style/*.css`(토큰 → 컴포넌트 → 뷰별)와 함께 단일 `dist/panel.html`로 인라인한다. 512 KiB 이하와 인라인 전용을 검사한다. `extension.json`의 `entrypoint`가 `dist/panel.html`이고 옛 `panel.html`은 지웠다 |
| `src/index.ts` | `machine.run` 중계. 값 없는 프로필 집합과 "문자열 하나를 받는" 프로필 표(`id`·`slug`·`group`·`after`)로 화이트리스트를 가린다. `-`로 시작하는 값은 플래그로 읽히므로 거절한다 |
| `panel/store.ts` | 단일 상태와 순수 리듀서. 다시 읽어도 커서는 id에 남는다 |
| `panel/data/client.ts` | 요청 큐(동시 실행·우선순위·공유·취소·`workspace-busy` 재시도·`truncated`) |
| `panel/data/source.ts` | 프로필별 읽기 함수: `loadAllRows`, `loadStatuses`, `loadTallies`, `loadArchived`, `loadWikiListing`, `loadWikiPage`, `loadDetail` |
| `panel/data/index.ts` | 이슈 인덱스 — `nav.rs` 이식(계층, 에픽이 마일스톤을 이김, 상속된 미룸, 바구니, n/n) |
| `panel/data/query.ts` | 검색·필터 파서와 매처, 정렬 비교기(`query.rs` 이식) |
| `panel/data/read.ts` | 읽음 판정과 쓰기 (설계의 `unread.ts`를 이 이름으로 만들었다) |
| `panel/data/refresh.ts` | 10초 자동 갱신(실기 뒤 60초에서 줄임, 목록 읽기가 거절되면 멈춤), 수동 갱신, 갱신 시각 |
| `panel/data/memory.ts` | 마지막 탭·상세 표시·위치·위치별 비율 기억 |
| `panel/keys/table.ts`, `router.ts`, `wiring.ts` | 키 표(데이터), keydown → 시퀀스 → 액션 라우터(단일 키 주인), 라우터 액션을 뷰·스토어에 잇는 배선 |
| `panel/view/` | `shell`, `tabs`, `crumbs`, `split`, `responsive`, `list`(+`list-model`), `board`(+`board-groups`), `detail`(+`detail-format`), `toolbar`, `menu`, `help`, `wiki`, `markdown`, `components`, `icons` |
| `panel/i18n/` | en·ko·ja·zh 표 |

### 2.0.3 프로필 12개

선언은 `packages/moai/extension.json`에 있고 모두 `moai --json -C {{workspaceRoot}} …` 꼴이다. 개편 전 4개에서 9개가 늘었고, 실기 뒤 `add`가 빠져 12개다(`se-24ey.oxd`). 공통 설정(`timeoutMs 120000`, `outputLimitBytes 1048576`, `stdin: none`, `descendantAllowlist: [git]`)은 그대로다.

| 프로필 | argv(`…` 뒤) | 매개변수 | 용도 |
|---|---|---|---|
| `status` | `status` | | 칸 이름·셈 |
| `prime` | `prime` | | 잡은 것과 준비된 것 (`show --all`이 잘렸을 때의 대체) |
| `show` | `show {{id}}` | `id` ≤128 | 상세 |
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
- 개편 전부터 있던 `status`·`prime`·`show`·`wiki-ls`·`wiki-show`만 데몬 카탈로그와 일치한다(2026-10-15 실기에서 happy-cli `1.1.10-aplus.322` 카탈로그와 대조). 나머지 일곱 개는 **데몬에 추가될 것으로 가정**한 선언이다(`se-0g4a.anz`).
- 트래커에 쓰는 프로필은 없다. 실기 뒤 사람 결정으로 할 일 추가(입력창·`SPC n`·`add` 프로필)를 뺐다(`se-24ey.oxd`). `read*`는 트래커가 아니라 `~/.config/moai/read/`에만 쓰므로 `writeScope`를 붙이지 않았다.

### 2.0.4 요청 큐: 동시 3, `workspace-busy` 재시도

- `PANEL_CLIENT_OPTIONS = { concurrency: 3, busyAttempts: 3, busyBackoffMs: 1000 }`이다(`panel/data/client.ts`). 기본값(옵션을 주지 않은 클라이언트)은 개편 전과 같은 **한 번에 하나, 재시도 없음**이다.
- **동시 3**은 실측으로 정한 값이 아니라 `se-0g4a.fjl`의 제안이다. SDK·Desktop 코드상 읽기 전용 프로필의 병렬을 막는 규정이 없다는 근거뿐이고, 실제로 겹쳐 도는지는 라이브 확인이 남았다.
- 데몬의 락은 **쓰기 범위(WRITE-scope) 락**이고, 겹치는 쓰기는 기다리지 않고 즉시 `workspace-busy`로 거절한다. 읽기 요청이 이 코드를 받으면 큐로 되돌려 최대 3번, 1초·2초 간격으로 다시 시도한다(공유 읽기만. 쓰기와 취소된 요청은 재시도하지 않는다). 그래도 실패하면 정보성 거부로 보여 준다.
- 우선순위: 상세 > 위키 > 목록 갱신. 같은 `profileId+params` 요청은 공유한다.
- 출력 한도: 데몬이 stdout을 1 MiB에서 자르고 `truncated: true`를 단다(오류 코드가 아니다). 잘린 JSON은 파싱되지 않으므로 결과는 `unreadable` + `truncated`다. 목록은 이때 **`prime`으로 물러나** 일부만 보여 주고 배너로 알린다(`loadAllRows`).
- 실측(`se-0g4a.fjl`, 2026-10-14): 이 저장소 64행은 `show --all` 35 KB, 가장 큰 moa-issue의 활성 24행은 44 KB로 한도의 4%다. moa-issue 아카이브 2,289행은 2.35 MB로 한도의 2.2배라 쪽 나누기가 필수이고, `-n 500`은 쪽당 최대 532 KB(여유 2배), `-n 200`은 약 200 KB(20%)다. 쪽 정렬은 `--sort id`로 고정해야 `--after`가 흔들리지 않는다.
- 취소: 한 번에 하나만 취소하던 Cancel이 이제 **읽기와 실행 중인 쓰기 전부**(최대 3개)를 취소한다. 아직 시작하지 않은 쓰기는 취소하지 않는다(`se-pbqz.y8z` #7).

### 2.0.5 기억(memory): 프레임 localStorage, 전역

- 기억하는 것은 **마지막 탭, 상세 표시 여부, 상세 위치, 위치별 비율(`ratio.left`, `ratio.bottom`)** 네 가지뿐이다(`panel/data/memory.ts`).
- 저장소는 **패널 프레임의 `localStorage`**를 쓴다. 키는 `buzzni.moai.panel` **하나**이고 버전 필드(`MEMORY_VERSION = 1`)를 함께 쓴다. 프로젝트 이름이 키에 들어가지 않으므로 기억은 **전역**이다 — 작업 영역마다 따로 두지 않는다. 설계 5절은 탭을 "프로젝트 범위"로 적었지만 구현은 전역이다.
- sandbox에 `allow-same-origin`이 없으면 프레임 origin이 opaque라서 `localStorage` 접근이 `SecurityError`를 낸다. 그래서 백엔드는 getter로 받고, 읽기·쓰기가 하나라도 던지면 **그 세션 동안만 메모리에 둔다**. 저장 실패는 패널을 멈추지 않고 기본값으로 돌아갈 뿐이다.
- `storage.read`/`storage.write` 권한은 쓰지 않는다. 액션 시그니처가 이 저장소에 없기 때문이다. 순서(localStorage → `storage.*` → 세션)는 설계와 같지만 가운데 단계는 비어 있다.
- 읽은 값은 `normalizeMemory`가 모두 정리한다. 모르는 탭이나 범위를 벗어난 비율은 기본값으로 떨어지고, 값이 하나도 없어도 기본(탭 칸반, 상세 표시, 아래, 비율 기본값)으로 뜬다.
- 기본 정렬은 `State.defaultSort`다(내장 순서에서 시작해 `D`와 `remember()`가 저장한 값으로 바뀐다). 정렬을 비우면 이 값으로 돌아가고 경로줄의 "sort …"도 이 값과 견준다(`se-ka0w`가 store·툴바·경로줄 `crumbs.ts`의 정렬 설정을 맞췄다).
- 검색·필터·정렬·열·보기 설정과 기본 정렬(`D`)은 `memory.ts`의 `SettingsStorage` 이음새로 **세션 수준**에서 기억한다(`se-cv7w.lca`, `se-5air`). 정렬이 기본값이면 질의에는 `sort: null`로 남겨, 사용자가 고른 정렬만 기억한다. 저장소가 던지면 값을 잊을 뿐 패널은 멈추지 않는다. Desktop 조사(2.0.9절) 결과 프레임 origin이 opaque라 `localStorage`가 던질 것으로 보이므로 위 기억은 **세션 동안만** 유지된다. 영속은 SDK 설정 저장 API가 오면 같은 키로 잇는다(`se-c9mu`, 상류 요청서 4절).

### 2.0.6 읽음, 아카이브, 보드 셈

- **안 읽음 판정은 패널이 계산하지 않는다.** CLI가 `show --json` 행과 `show <id> --json`에 `"unread": true`를 찍어 준다. 안 읽음이 아니면 키 자체가 없고 `false`는 나오지 않는다. 패널은 `row.unread === true`만 본다. 사람을 모르거나 읽음 표를 못 읽으면 어느 행에도 키가 없고 NEW는 꺼진다. 상류 `moai-cqwy`의 동작이고 moai 0.17.0에서 **확인됐다**.
- **아카이브 행은 NEW가 되지 않는다.** `isUnread`는 `archived: true`가 붙은 행을 건너뛴다. `moai read`가 활성 행만 풀기 때문에, 아카이브에서만 온 행의 NEW는 지울 방법이 없기 때문이다(`se-fvou`). `withArchive`(`loadArchived({ active })`도 같은 규칙)는 지금 가진 활성 행에 없는 id만 `archived: true`로 표시한다. moai 0.17.0은 `show --archived` 행 가운데 `show --all`이 아카이브로 숨기는 행에 같은 뜻의 `archived: true`를 스스로 찍는다. 패널은 moai가 찍은 행은 그대로 두고, 안 찍힌 행은 예전처럼 활성 행에 없으면 붙인다 — 아카이브를 읽은 뒤 시계가 아카이브해 다시 읽은 활성 목록에서 빠진 행(아카이브를 읽을 때는 활성이라 안 찍혔다)과 옛 moai 때문이다(`se-ydco`). 그래서 상류에는 "아카이브 읽음" 요청을 하지 않았다.
- **읽음 키.** `r`(커서의 행), `SPC m a`(모두), `SPC m g`(커서 그룹)가 각각 `read`, `read-all`, `read-group`을 부르고, 쓰고 나면 다시 읽는다. 그룹이 없는 자리("마일스톤 없음")에서는 `SPC m g`가 안내 문구만 보인다. 쓰고 나면 열린 상세도 다시 읽어 NEW가 목록·칸반·뱃지와 함께 풀린다. 목록이 잘려(prime) 아카이브 행을 보이는 중이면 아카이브 답도 다시 읽는다.
- **NEW 칩과 탭 뱃지**(`se-ehdi.zcx`). 목록 행·칸반 카드·상세 머리에 `NEW` 칩이 붙고, 칸반·목록 탭에는 안 읽은 수 뱃지가 붙는다. 뱃지 수는 **프로젝트 전체** 합이라 두 탭이 같은 수를 보이고 `SPC m a`가 쓰는 수와 같다. 보기 토글·다른 장소·에픽(칸반)·쌍둥이 id로 가려진 행도 센다. 탭이 좁아 라벨이 숨으면 `aria-label`이 `<라벨> <수>`가 된다. `unread` 키가 없는 것은 안 읽음 0과 구별되지 않으므로(0.16도 `unread`를 찍는다) 호환 배너는 NEW 표시를 말하지 않는다(`se-xee6`).
- **읽음 쓰기**는 `read <id>`, `read --all`, `read -e <group>`이다. 결과 JSON은 `{read, missing, held, problems, at}`이고, 없는 id나 그룹이 있어도 나머지를 쓰고 0이 아닌 코드로 끝나지만 그 답은 그대로 넘긴다. 쓰기 후에는 늘 다시 읽는다.
- **설계와 다른 점.** 설계 4.9절은 "화면에 그린 행의 `updated_at`을 적는다"고 했지만, CLI는 값을 받지 않고 행의 **현재** `updated_at`을 적는다. 그린 뒤 바뀐 행도 새 버전으로 읽음 처리된다. 결과에 id별 `updated_at`이 없어 낡은 그림을 쓰기 결과로는 알 수 없다. 패널은 쓰기 뒤 다시 읽은 행과 그린 행을 비교(`staleAgainst`)할 수 있을 뿐이다. 상류에 값 지정(`read --seen`)을 요청하는 일은 moai 0.17.0에도 들어오지 않았고 backlog(`se-a5wl`)에 그대로 있다.
- **미룸·마일스톤·아카이브 파생값.** moai 0.17.0은 행에 `derived_milestone`, `shelved_by`(행을 계획에서 뺀 가장 가까운 행의 id, 스스로 미뤘으면 자기 id), `archived`를 해당할 때만 찍는다. 인덱스(`index.ts` 선반·`archiveCandidate`)와 질의 렌즈(`query.ts`)는 키가 있으면 그 값을 쓰고, 없으면 `nav.rs` 규칙대로 직접 계산한다. 키가 없는 것은 "아님"이 아니라 "모름"으로 읽는다(옛 moai에는 키가 아예 없다). 실제 0.17 출력에서 두 길의 답이 같은지는 `tests/fixtures/moai/*-v017.json`으로 시험한다(`se-ydco`).
- **보드 셈(n/n)은 `status --json`의 `milestones[]`·`epics[]`의 `done`·`total`을 쓴다.** 시간으로 아카이브된 행은 `show --all`에 없으므로, 행에서 세면 완료된 그룹이 줄어 보인다. `IssueIndex(rows, tallies)`가 셈을 받으면 `moai status`와 같은 값을 보여 준다(`se-tcd4`). 셈을 못 읽으면 행에서 센다. 같은 `status` 요청은 `loadStatuses`와 공유한다.
- **칸 이름과 순서.** `status --json`의 `statuses` 배열(moai 0.17.0에서 확인됨)을 읽는다. 옛 moai처럼 없으면 `counts`의 키(빈 칸 포함)를 쓰되 알파벳순이라 설정 순서를 잃으므로, 기본 순서 `todo, in_progress, review, done` 뒤에 모르는 칸을 붙인다.

### 2.0.7 위키 탭

- 렌더러(`view/markdown.ts`)는 제목·문단·중첩 목록·코드·인용·표·가로줄·강조·링크에 더해 HTML 엔티티, 참조 링크, 취소선, 작업 목록을 지원한다. raw HTML은 모두 이스케이프하고 `href` 없는 링크는 남기지 않는다. 강조 파싱은 선형 시간이다(리뷰에서 지수 시간 백트래킹을 고쳤다).
- 위키 뷰(`view/wiki.ts`)는 목록·본문 2단, 검색(제목·본문), 역링크, 링크 순환(Tab), 되감기 trail, GitHub 앵커, 이슈 id 점프를 한다. 본문 이슈 id는 `wiki ls`의 `issues[]`로 링크가 된다.
- 라이브 프로필 로더(`loadWikiListing`, `loadWikiPage`)는 Moai가 낸 JSON을 가공하지 않고 넘기고, 뷰가 해석한다.
- **셸에 붙었다**(`se-jj42`). 위키 탭은 `PANES`에 등록되어 `loadWikiListing`/`loadWikiPage`로 라이브 페이지를 읽는다. 탭을 바꿔도 trail·검색·선택이 저장·복원되고, 처음 목록 읽기가 실패하면 탭을 다시 보일 때 다시 읽는다. 키는 라우터가 `wiki.handleKey`를 `standaloneKeys: false`로 불러 처리한다. 위키 문구는 `copy.wiki`에서 en·ko·ja·zh로 나온다(`se-ti70`).

### 2.0.8 아직 열려 있는 것 (2026-10-14)

개발 에픽은 모두 끝났다. `se-h5c7`·`se-gq4i`(`d30fd6c`), i18n(`se-bz5y.m35`, `se-ti70`)과 E8 리뷰 `se-bz5y.v5b`(`19c43c5`)에 이어 `se-5y3p`(unread 호환 잔여, `observeRows` 제거 `5bbff76`)와 `se-kd3u`·`se-s3vv`(`6b70a0f`)도 끝났다. `se-1t2r`(경로줄 정렬 표시)은 `se-ka0w`(`2ebaa10`) 뒤로 경로줄이 `state.defaultSort`와 견주므로 이미 고쳐진 것으로 닫았다.

남은 것:

| 이슈 | 내용 |
|---|---|
| `se-0g4a.fjl`, `se-0g4a.zrf`, `se-0g4a.y91` | E0 실기 확인(동시 실행·출력 한도 실측 리뷰, iframe 키 도달·포커스, Desktop `localStorage`) |
| `se-0g4a.anz` | 데몬 카탈로그에 새 프로필 7개 추가(happy-cli 쪽) |
| `se-vpav` | Desktop 카탈로그·테스트 후속 |
| `se-dnas` → `se-c9mu` | SDK 설정 저장 API 요청(상류 요청서 4절). 오면 `memory.ts` 백엔드를 이어 설정을 영속(workspace·global) |
| `se-qxeh` | note 검색 범위 되살리기. 사람 결정(2026-10-14)으로 2.0 뒤로 **미뤘다**(deferred). 2.0은 노트를 검색하지 않고 낸다 |

**E0의 남은 실기 확인**(에픽 `se-0g4a` 3/7): 데몬 카탈로그에 새 프로필 7개를 더하는 일(`se-0g4a.anz`, happy-cli 쪽), Desktop `localStorage`(`se-0g4a.y91`)와 iframe 키 도달·포커스(`se-0g4a.zrf`) 스파이크, 동시 실행과 출력 한도 실측의 리뷰(`se-0g4a.fjl`)다. 데몬 카탈로그가 갱신되기 전에는 호환 배너가 해당 기능이 꺼졌다고 말한다.

끝난 것: E4 `se-cv7w`(`997aed0`, `se-5air` 정렬 편집기 `D` 저장·`se-cv7w.lca` 세션 수준 영속·epic-end 리뷰 `se-cv7w.4xy`), `se-mzlx`(칸반 j/k·검색 시 제자리 갱신), `se-ehdi.zcx`(NEW 칩·탭 뱃지), `se-q0u4`(`SPC v a`는 "모두 보이기 (아카이브 제외)"로 두고 아카이브는 `SPC v o`), `se-4fci`(창 포커스를 잃어도 필터 제안이 닫히지 않고, `prompt.up/down`은 위키 밖에서 키를 쓴 것으로 보고하지 않음), `se-p314`(상세가 compat 배너가 이미 말한 거부를 되풀이하지 않음), `se-mt96`·`se-haiw`(보드 읽기 degrade, not fail: `show-all`이 없으면 `prime`(+backlog), `backlog-all`이 없으면 backlog 없이 목록, 둘 다 없으면 `prime`. 카탈로그 줄이 없는 것을 이름으로 말한다).

실기 확인이 남은 것은 [개편 계획 3.1절](overview.md#31-구현-시점의-가정과-남은-실기-확인-2026-10-14)에 있다.

### 2.0.9 Desktop 조사 결과 (`se-vpav`, 읽기 전용, 2026-10-14)

`aplus-dev-studio-desktop`을 읽기만 한 결과다. 이 저장소에 바꿀 곳은 없다.

- **`catalog.v1.json` 고정.** `build/official-extensions/catalog.v1.json`이 `buzzni.moai` 1.1.1, 릴리스 태그(이 저장소의 `v0.11.8`), 번들된 `buzzni.moai-1.1.1.saycode-extension.base64`, sha256을 박아 둔다. 태그는 확장 버전에서 나오지 않고 이 저장소의 릴리스 태그다. 번들은 부트스트랩용이고 서명된 원격 카탈로그에 같은 id가 있으면 그쪽이 이긴다.
- **설치기 테스트.** `tests/officialExtensionInstaller.test.ts`가 버전·태그·sha와 프로필 4개(`status`·`prime`·`show`·`add`)의 다이제스트 `toEqual` 표를 가진다. 2.0.0에는 12개 전부로 바꿔야 한다(`add`는 빠진다). 업데이트는 숫자 `x.y.z` 비교이고 실행 중에는 거부되며, 1.1.1 → 2.0.0은 사용자가 누르는 업데이트다(`apiVersion`이 최소 2 미만일 때만 자동 교체).
- **apiVersion.** 2.0.0 매니페스트(`apiVersion 3`, `engines ^1.2.0`)는 Desktop이 그대로 받는다. 다만 `apiVersion < 4`는 UI에서 "deprecated" 뱃지가 붙는다. 2026-10-20 실기에서 카드의 "이전 확장 API(3)로 동작 중이며, 다음 업데이트에서 지원이 끝납니다."를 고치기로 해 다음 판부터 `apiVersion 4`다(`se-ya5e`). API 4는 Desktop 0.1.69(2026-10-13 `f94655ecf`)부터 현재 판이고 엔진은 그대로 1.2.0이라, Moai 2.x를 돌리는 Desktop은 모두 받는다.
- **불투명 origin → `localStorage`는 세션 한정.** 패널 iframe은 `sandbox="allow-scripts"`만 가져 origin이 opaque다. Chromium 규칙상 `localStorage` 접근이 `SecurityError`를 낼 것으로 보인다(코드와 sandbox 플래그에서 추정, 실행은 안 함). 패널 기억은 이미 메모리 폴백이라 **마지막 탭·상세 위치는 세션 동안만** 남는다. 스파이크 `se-0g4a.y91`은 "localStorage 불가, 세션 한정"으로 닫을 수 있다(Desktop이 `allow-same-origin`이나 저장 API를 주지 않는 한).
- **가시성 신호 없음.** 열린 도구 탭은 모두 마운트된 채 `display:none`으로만 숨겨진다. 호스트→패널 포트는 테마만 나르고 가시성·포커스 신호가 없다. `visibilityState`는 창을 따른다. 그래서 `panelVisibility()`가 0×0 뷰포트를 숨김으로 본다. iframe이 실제로 0×0이 되는지는 라이브 확인이 남았다. 언어 변경은 iframe을 다시 읽지만 테마 변경은 아니다.

### 2.0.10 실기 테스트 (PR #52, 2026-10-15, 에픽 `se-24ey`)

Desktop에서 2.0.0을 처음 돌려 본 결과다. 데몬 카탈로그가 아직 갱신되지 않은 **출시 조건 그대로**에서 했다.

- **환경.** Saycode Desktop 0.1.69, 동봉 데몬 happy-cli `1.1.10-aplus.322`(기기 `~/.happy`, "이 컴퓨터" 머신), 관리 moai **v0.8.0**(데몬이 받아 sha256을 확인해 `~/.happy/managed-tools`에 둔 것), 샌드박스 저장소 `~/Works/Tests/moai-panel-sandbox`(마일스톤 2·에픽 4·작업 40·backlog 4·미룸 2·위키 3쪽, moai 0.8.0으로 만듦). 2.0.0은 확장 설정의 **사용 중지 → 업데이트(로컬 파일) → 사용**으로 깔았다.
- **데몬은 PATH의 moai를 쓰지 않는다.** 카탈로그 상수 `MOAI_V080_MANAGED_TOOL`이 moai를 v0.8.0으로 고정하고, 실행할 때 그 실행 파일 하나만 든 제한 PATH를 만든다. 기기의 moai 0.17.0은 패널과 상관이 없다. 0.8.0은 패널이 부르는 명령(`show --all`, `backlog show --all`, `--archived -n --sort --after`, `read --all/-e`, `wiki ls/show`)은 다 갖지만 `unread`·`statuses[]`·`derived_milestone`·`shelved_by`를 찍지 않는다. 그래서 고정이 오르기 전에는 **NEW 칩이 꺼진다**([상류 요청서 1.6절](upstream-requests.md#16-관리-moai-고정을-올리기)).
- **카탈로그.** 선언 13개(당시) 중 `status`·`prime`·`show`·`add`·`wiki-ls`·`wiki-show` 6개가 데몬 선언과 글자 그대로 같았고, 새 7개는 카탈로그에 없었다.

| 확인 | 결과 |
|---|---|
| 설치·moai 미설치 배너 | 통과. 관리 moai가 없을 때 `MACHINE_RUN_TOOL_NOT_INSTALLED` → `tool-missing`, 머신 도구에서 설치 뒤 해소 |
| 카탈로그 배너 | 통과. "프로필 2개(전체 목록, 백로그) 없음", `r`을 누르자 읽음 표시가 더해짐 |
| 보드·상세·목록·탭·위키(링크·`<script>` 글자 그대로) | 통과 |
| 한글 입력 상태의 `ㅓ`/`ㅏ`, `?`, `SPC` 메뉴 | 통과(`se-0g4a.zrf`의 키 대체 부분) |
| 숨은 도구 탭에서 갱신 멈춤, 돌아오면 바로 읽기 | 통과. iframe이 0×0이 되는 것을 실기로 확인(`se-0g4a.zrf`) |
| `SPC v o` | 배너에 아카이브가 더해지지 않음. jsdom 재현은 통과 — Desktop이 데몬 광고 확인 **전에** 확인 창을 띄우므로 창을 거절·놓치면 `declined`라 배너가 아니다(`se-24ey.zgw`) |
| prime 폴백 보드 | Done 칸이 비어 "done 0"처럼 보이고, 미룸 보이기를 켜도 미룬 행이 없음(prime에 없음) |

고친 것(이 절의 변경은 PR #52에 더했다):

| 이슈 | 변경 |
|---|---|
| `se-24ey.14i` | 실행 중 표시를 셸 흐름에서 빼 **하단 토스트**로(레이아웃을 밀지 않음, 0.3초 뒤 나타나 빠른 실행은 깜빡이지 않음, 취소 버튼 말고는 클릭이 아래 행으로 통과). 자동 갱신 **60초 → 10초**이고 자동 읽기는 토스트를 띄우지 않는다. 목록 읽기가 거절·시간 초과면 자동 갱신을 멈추고 전용 줄(`moai-held`)에 알린다(Desktop은 거절 30초 뒤 다시 묻는다). 다음 목록 읽기가 거절 없이 통과하면(갱신 시각 클릭, 읽음 표시 뒤 읽기) 다시 켠다. 멈춤·재개는 가장 최근 로드의 응답만 정한다. `setInterval(0)`인데도 다시 보일 때 읽던 갱신기 버그를 고쳤다 |
| `se-24ey.oxd` | 할 일 추가(입력창·버튼·`SPC n`·`add` 프로필) 제거. 패널은 읽기만 한다. 매번 뜨던 쓰기 확인 창이 사라진다 |
| `se-24ey.s6v` | prime 폴백이면 카탈로그 배너 옆에 "완료·미룬 일과 나머지 할 일은 보이지 않는다"는 안내(`shell.primeOnly`)를 함께 보인다 |
| `se-24ey.dcj` | `binding-mismatch`·`invalid-request`의 문구, 코드 없는 실패는 "Desktop이 이유를 알려 주지 않았다". show-all이 `unsupported-daemon`으로 거부되면 2.0의 다른 추가 프로필(backlog·아카이브·읽음)은 **부르지 않고** `unsupported-daemon`으로 본다(`CompatProbe.lacks`, 그 머신에서 이미 돈 프로필은 빼고) — 확인 창 없이 배너에 오른다. 이렇게 막힌 동안 backlog는 show-all 응답을 기다렸다가 부르므로, 카탈로그가 갱신되면 같은 로드에서 진짜로 읽힌다. 세션의 첫 로드는 아직 모르므로 backlog도 함께 묻는다(확인 창 한 번이 남는다). `se-24ey.zgw`도 이것으로 닫는다 |
| `se-24ey.1z5` | `moai-query` 실제 바이너리 비교가 패널처럼 기기 시간대(`readerClock`)로 읽는다. KST에서 깨지던 테스트 |
| `se-24ey.a80` | 위 변경의 코드 리뷰(`/code-review` medium). 지적 9개 중 8개를 반영했다: 멈춘 자동 갱신의 재개 경로, 멈춤 안내를 결과 줄에서 떼기, 늦게 온 status 응답이 재개를 되돌리는 경합, 카탈로그 갱신 시 backlog가 막힌 채로 남는 문제, 토스트가 10초마다 마지막 행을 가리는 문제, 정리 2건. 10초 주기의 부하는 사람 결정대로 두고 README에 적었다(읽기는 데몬의 쓰기 잠금을 잡지 않아 다른 도구의 `workspace-busy`를 부르지 않는다). 첫 로드의 backlog 확인 창 한 번은 남긴다(위 `dcj`) |
| `se-24ey.fdg` | 상류 요청서에 관리 moai 고정(1.6절), Desktop 확인 창(5절), moai 보드 단일 명령(2절 9번)을 더했다 |

그 밖에 본 것:

- 확인 창이 많다. 설치 때 받은 `machine.run` 권한과 별개로 Desktop Core는 **프로필마다**(확장 버전·프로필 해시·머신·폴더 단위) 묻고, 읽기는 앱이 켜진 동안, 쓰기는 매번이다. 승인은 메모리에만 있어 재시작·업데이트·다른 프로젝트에서 다시 묻는다. 출시 조건에서 처음 열면 7번(status·prime·show-all·backlog-all·show·wiki-ls·wiki-show) 묻던 것이, 위 변경 뒤로는 읽음·아카이브 몫이 빠진다. 나머지는 Desktop 쪽 요청이다([상류 요청서 5절](upstream-requests.md#5-desktop-확인-창)).
- 데몬을 바꾼 직후 Desktop을 다시 시작하기 전까지는 모든 실행이 데몬에 닿지 않고 `binding-mismatch`로 보였다(패널은 그때 일반 문구만 보였다). 재시작 뒤 재현되지 않았다. Desktop 쪽 일시 상태로 기록만 한다.
- 패키지 Desktop은 DevTools가 꺼져 있다(`shouldEnableDevTools` → `!isPackaged`). 실기 진단은 `Saycode --enable-logging=stderr --v=0`으로 렌더러 콘솔(`[machine.run] daemon refused …`)을 받아서 했다.

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
