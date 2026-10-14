# Moai 패널 2.0 개편 계획

세이코드 Moai 확장(`packages/moai`, 2.0.0 마일스톤 브랜치, 릴리스된 것은 1.1.1)의 패널을 moai TUI(`moai tui`, 저장소 `moa-issue`) 수준의 탐색기로 다시 만든다. 이 페이지는 계획의 요약과 결정 사항을 담고, 세부 내용은 아래 페이지로 나눈다.

| 페이지 | 내용 |
|---|---|
| [설계](design.md) | 아키텍처, 데이터 계층, 레이아웃, 기능별 명세 |
| [단축키 매핑](keybindings.md) | TUI 단축키를 패널에서 그대로 지원할 수 있는지 판정 표 |
| [세이코드 룩앤필 가이드](look-and-feel.md) | 디자인 토큰, 컴포넌트 규격, 테마 전달 방식 |
| [moai TUI 분석](tui-analysis.md) | 원본 TUI의 화면·키·검색·필터·정렬·열·읽음·위키 명세 |
| [Moai 확장과 SDK 현황](current-state.md) | 지금 패널의 구조, SDK가 허용하는 것과 막는 것 |
| [상류 요청서](upstream-requests.md) | Happy 데몬 카탈로그에 더할 프로필 7개, moai CLI 상류 개선(0.17.0에서 확인, `read --seen` 제외), 릴리스 순서, SDK·Desktop 설정 저장 API 요청서([4절](upstream-requests.md#4-sdkdesktop-설정-저장-api-se-dnas), `se-dnas`) |

- 작성일: 2026-10-14
- 분석 근거: `/home/coder/workspace/moa-issue`(moai Rust 소스), `/home/coder/workspace/aplus-dev-studio-desktop`(세이코드 데스크톱), 이 저장소의 `packages/moai`, `packages/sdk`

## 1. 목표

반드시 들어갈 기능은 아래와 같다.

1. **세이코드 필 앤 룩**: 데스크톱 앱의 토큰과 컴포넌트 규격을 따른다. 그림자 없이 보더로 구분하는 평면 디자인이고 아이콘은 lucide다.
2. **칸반 · 목록 · 위키를 탭으로 제공한다.** TUI는 `SPC g l/b/w`로 화면을 고르지만, 패널은 상단 탭으로 보여 주고 같은 키도 받는다.
3. **상세(detail)는 왼쪽과 아래 두 위치만 지원한다.** 위치는 툴바의 작은 아이콘 버튼 하나로 바꾼다. TUI의 right/top은 지원하지 않는다.
4. **단축키를 TUI와 같게 지원한다.** 지원 여부를 키마다 판정한 결과는 [단축키 매핑](keybindings.md)에 있다. 요약하면 단일 키는 모두 지원하고, `Ctrl-w` 계열만 플랫폼에 따라 막혀 `SPC w` 대체 키를 둔다.
5. **search, filter, sort, view, column**: TUI와 같은 의미로 지원하고, 툴바 UI도 함께 둔다.
6. **read(읽음 표시)**: `[NEW]` 표시와 `r`, `SPC m a`, `SPC m g`를 지원한다.

TUI에서 뺄 것:

- 여러 프로젝트 한눈 보기(`0`~`9`)와 프로젝트 등록(`SPC p a/d`). 패널은 작업 영역 하나에 묶여 있다.
- 시간대 창(`SPC o t`)과 마우스 on/off(`SPC o m`). 시간대는 Desktop 로캘을 따르고, 웹에서는 마우스가 늘 켜져 있다.
- 워크트리 겹침(`⎇`, `SPC v w`). 2.0 이후 backlog로 둔다.
- 통계 화면(`SPC g s`). 탭 세 개에 들지 않아 2.0 범위 밖이다. 데이터는 `moai stats --json` 하나면 되므로 나중에 탭으로 더하기 쉽다.

## 2. 핵심 결정

| 주제 | 결정 | 근거 |
|---|---|---|
| 재작성 여부 | **재작성한다.** 테마 블록, i18n 표, `run`/`poll`/거부 코드 처리, IME 처리만 옮긴다 | 지금 패널은 DOM이 곧 상태이고, 전역 `busy` 락이 화면 전체를 잠근다. 필터·정렬·칸반·상세 상시 표시와 구조가 맞지 않는다 ([현황](current-state.md)) |
| 빌드 | `build.mjs` + esbuild로 소스를 모듈로 나누고, 결과를 단일 `dist/panel.html`로 인라인한다 | 패널은 인라인 스크립트만 허용하고 512 KiB 한도가 있다. media-preview가 같은 방식을 쓴다 |
| 프레임워크 | 쓰지 않는다. vanilla TS + 작은 렌더 헬퍼 | 512 KiB 한도. 상태 → 렌더가 단방향이면 충분하다 |
| 데이터 | 전체 행을 한 번에 받아 클라이언트에서 트리·필터·정렬을 계산한다. 상세(`show <id>`)와 위키 본문만 따로 읽는다 | TUI도 같은 방식으로 동작한다(`nav::Index`). 키를 칠 때마다 CLI를 부르면 한 번에 0.1~0.3초가 걸린다 |
| 필터 의미 | 클라이언트 파서로 TUI와 같은 문법을 구현한다. CLI와 결과가 같은지는 픽스처 테스트로 맞춘다 | 치는 대로 반영해야 하고, 승인 창도 피해야 한다 |
| 상세 위치 | 기본은 **아래**다. 폭이 640px 이상일 때만 왼쪽을 쓸 수 있고, 그보다 좁으면 아래로 강제한다 | 작업 영역 도구 영역은 최소 280px이고 보통 500px 안팎이다 |
| 읽음 | 판정은 클라이언트가 하고, 쓰기는 `moai read` 프로필로 한다. 판정에 필요한 `seen` 값은 moai CLI가 JSON으로 내 주도록 상류에 제안한다 | 패널은 `~/.config/moai/read/*.toml`을 읽을 수 없다 |
| 쓰기 범위 | 2.0은 읽기 중심이다. 쓰기는 `read`(개인 설정)와 기존 `add`만 한다. `mv`·`note`는 2.1에서 검토한다 | TUI 철학이 "읽는 도구 + 메모 하나"다. 쓰기 프로필마다 승인 창이 뜨고 데몬 카탈로그도 맞춰야 한다 |
| 설정 영속화 | 스파이크 결과로 정한다. localStorage가 되면 그것을, 안 되면 `storage.*` 권한을, 둘 다 안 되면 세션 동안만 유지한다 | sandbox에 `allow-same-origin`이 없어 localStorage 접근이 SecurityError를 낼 가능성이 높다 |

## 3. 외부 의존성 (이 저장소 밖)

다음은 개편을 막는 일이라 E0에서 먼저 처리한다.

1. **Happy 데몬 카탈로그에 프로필 추가** (`se-0g4a.anz`)
   - 확장의 `machineCommands` 선언은 데몬 카탈로그의 다이제스트와 글자 그대로 일치해야 실행된다(`packages/moai/README.md:13`).
   - 필요한 프로필: `show --all --json`, `backlog show --json`, `show --archived` 페이징(`-n`, `--after`), `wiki ls --json`, `wiki show <slug> --json`, `read <id>`·`read --all`·`read -e <group>`, 그리고 `statuses`를 얻을 방법.
2. **moai CLI에 읽음 정보 JSON 추가** (`se-0g4a.l89`)
   - 지금은 안 읽은 목록을 JSON으로 주는 명령이 없다. `moai read`는 쓰기만 한다.
   - 제안: `show --json`의 각 행에 `unread: bool`을 넣거나, `moai read --list --json`으로 `{id: seen_at}`을 낸다. 앞쪽이 판정 규칙(내게 온 것, 마일스톤 제외)을 CLI 한 곳에 두므로 더 낫다.
3. **Desktop 실기 확인** (`se-0g4a.zrf`, `se-0g4a.y91`, `se-0g4a.fjl`)
   - iframe 포커스와 키 도달, Electron 메뉴 가속기가 가로채는 조합을 확인한다.
   - localStorage를 쓸 수 있는지, `storage.*` 권한의 액션 시그니처가 무엇인지 확인한다.
   - `machine.run`을 동시에 여러 개 돌릴 수 있는지, 출력 한도 1 MiB에 걸리는지 확인한다. moa-issue 저장소의 `show --archived --json`은 2.35 MB라서 한도를 넘는다.

### 3.1 구현 시점의 가정과 남은 실기 확인 (2026-10-14)

구현은 아래 상류 개선이 **이미 들어간 것으로 가정하고** 진행했다(`se-0g4a`의 노트, 사람 결정). 같은 날 moai **0.17.0**이 설치되어 감독이 실측했고(`se-0g4a` 노트), moai 쪽 가정은 데몬 카탈로그를 빼고 모두 **확인됨**이다. 두 파생값은 이름이 달라서 패널이 실제 이름을 읽도록 고쳤다(`se-ydco`). 픽스처는 임시 트래커에서 뜬 0.17 실제 출력이다(`tests/fixtures/moai/*-v017.json`).

| 상류 개선 | 0.17.0 실측 | 패널이 읽는 모양 | 없을 때(옛 moai) |
|---|---|---|---|
| `show --json`에 `unread` (moa-issue `moai-cqwy`) | **확인됨** | 행과 `show <id>`에 `"unread": true`. 안 읽음이 아니면 키가 없다. 사람을 모르면 어디에도 없다 | NEW가 꺼진다 (오류는 아님) |
| `status --json`에 `statuses` 배열(설정 순서)과 `milestones[]`·`epics[]` 집계 | **확인됨** | `statuses: string[]`, `{id, done, total}` 목록 | `counts` 키를 기본 순서(`todo, in_progress, review, done`)에 맞추고 모르는 칸은 뒤에 붙인다. 설정 순서는 잃는다 |
| 설정 읽기 JSON | **확인됨** (`config --json`) | 패널은 아직 읽지 않는다(선언한 프로필에 없음) | 코드의 기본값 |
| 파생값 | **확인됨, 이름이 다름** | 행에 `derived_milestone`(문자열), `shelved_by`(행을 계획에서 뺀 가장 가까운 행의 id, 스스로 미뤘으면 자기 id), `archived`(`show --all`이 아카이브로 숨기는 행에 `true`). 셋 다 해당할 때만 키가 있다. 가정했던 이름 `derived_deferred`·`archive_candidate`는 쓰이지 않는다 | `nav.rs` 규칙을 이식한 인덱스가 직접 계산한다. 키가 없는 것은 "아님"이 아니라 "모름"으로 읽어 이 계산에 맡긴다 |
| `--fields` | **확인됨** (`show --fields`) | 목록에서 본문 뺀 출력 | 아카이브 쪽 나누기와 잘림 배너로 버틴다. 실측상 필수는 아니다 |
| 안정 페이징 | **확인됨** | `show --archived -n --sort id --after` | 쪽 나누기 불가. 아카이브는 큰 저장소에서 읽을 수 없다 |
| 데몬 카탈로그에 새 프로필 7개 | **대기** — happy-cli 쪽(`se-0g4a.anz`). moai 쪽에서는 선언한 읽기 프로필이 모두 rc=0으로 돈다(`read*`는 개인 설정에 써서 실행하지 않음) | `show-all`, `backlog-all`, `show-archived`, `show-archived-after`, `read`, `read-all`, `read-group`. `backlog-all`은 데몬의 `backlog`(= `backlog add`)와 id가 다르다 | 선언 해시가 달라 데몬이 실행하지 않는다(거부 코드로 돌아온다). 전체 행 읽기가 실패해도 목록이 비는 대신 읽을 수 있는 것으로 물러나는 처리는 잘림에 대해서만 구현돼 있다 |

`archived: true`는 패널이 아카이브에만 있는 행에 붙이던 표시(`source.ts` `markArchived`)와 뜻이 같다. moai가 붙인 행은 그대로 두고, moai가 안 붙인 행은 예전처럼 활성 행에 없으면 붙인다(아카이브를 읽은 뒤 시계가 아카이브해 다시 읽은 활성 목록에서 빠진 행, 옛 moai).

또 하나, `moai read`가 **값 없이** 행의 현재 `updated_at`을 쓰는 것은 설계(그린 행의 값)와 다르다. 상류에 값 지정(`read --seen`)을 요청하는 일은 0.17.0에도 **없고** backlog(`se-a5wl`)에 그대로 있다.

**남은 실기 확인** — moai CLI 쪽은 위와 같이 끝났고, 아래는 아직 하지 않았다.

| 이슈 | 확인할 것 | 막고 있는 것 |
|---|---|---|
| `se-0g4a.anz` | 설치된 데몬 카탈로그에 위 프로필이 들어갔고 선언이 글자 그대로 같은지. `workspace-busy`가 읽기끼리도 나는지(코드상 쓰기 범위 락이라 안 날 수도 있다) | 새 프로필 전부의 실제 동작 |
| `se-0g4a.fjl` | (코드로만 정리됨, 라이브 검증 대기) 읽기 3개를 `await` 없이 연속 시작해 실행이 겹치는지, 쓰기 둘 동시, 두 작업 영역 병렬. 한도 1 MiB에서 종료 상태가 바뀌는지 | 동시 3의 근거 |
| `se-0g4a.zrf` | iframe 포커스를 얻는 방법, Linux에서 `Ctrl+F/B/U/D`, 모달에서 `Esc`. 한글 입력 소스에서 `event.code` 대체(`se-pbqz.k84`, 구현·머지됨, **실기 확인 남음**). 숨긴 도구 탭에서 iframe이 정말 0×0이 되는지(Desktop은 `display:none`만 쓰고 가시성 신호를 주지 않는다) | 키 대체 키의 필요 여부, 숨은 탭 갱신 멈춤(`panelVisibility()`) |
| `se-0g4a.y91` | 패널 프레임에서 `localStorage`가 되는지, `storage.*` 권한의 액션 시그니처. Desktop 코드 조사(`se-vpav`)로는 iframe이 `sandbox="allow-scripts"`뿐이라 origin이 opaque고 `localStorage`가 `SecurityError`를 낼 것으로 보인다(실행은 안 함). "불가, 세션 한정"으로 닫을 수 있다 | 정렬·열·보기 설정 영속화(`se-cv7w.lca`). 지금 기억은 localStorage를 시도하고 안 되면 세션 동안만 유지한다 |
| Desktop 고정 (`se-vpav`) | `build/official-extensions/catalog.v1.json`이 `buzzni.moai` 1.1.1·릴리스 태그·번들 `.base64`·sha256을 고정한다. `tests/officialExtensionInstaller.test.ts`가 버전·태그·sha와 프로필 4개 다이제스트 표를 가진다. 2.0.0 태그 뒤 Desktop 쪽에서 카탈로그 항목, 이 테스트(프로필 13개), 릴리스 노트를 바꾸고 1.1.1 `.base64`를 지워야 한다. 원격 카탈로그에도 새 항목이 필요하다 | 2.0.0 출시 후 Desktop 갱신. 자세한 목록은 [현황 2.0.9절](current-state.md#209-desktop-조사-결과-se-vpav-읽기-전용-2026-10-14), [상류 요청서](upstream-requests.md#desktop-저장소-후속) |
| `se-cv7w.lca` | 위 스파이크 결과로 정렬·필터·열·보기 기억을 붙이기 | — |

## 4. 마일스톤과 에픽

마일스톤 **`se-9inv` Moai 패널 2.0 — TUI 수준 개편** (시작 2026-10-14). 에픽 9개다. `moai show --tree --milestone se-9inv`로 볼 수 있다. 이슈 수는 처음 42개였고 구현 중 리뷰에서 넘어온 항목이 늘어 72개가 됐다(2026-10-14, 60개 완료, 배선 묶음 `a7fe3df` 머지 뒤). 구현 결과는 [현황 2.0절](current-state.md#20-구현-결과)에 있다.

| 에픽 | 이름 | 이슈 | 핵심 산출물 |
|---|---|---|---|
| `se-0g4a` | E0 사전 검증과 외부 의존성 | 6 | 이 위키, Desktop 스파이크 3건, 데몬 프로필, CLI unread 제안 |
| `se-89fu` | E1 패널 기반 재작성 | 16 | 단일 HTML 빌드, 상태 스토어, 요청 큐, 이슈 인덱스(계층 재구성), 자동 갱신, 테스트 하네스 |
| `se-qwkz` | E2 세이코드 룩앤필과 레이아웃 셸 | 6 | 토큰 레이어, 공용 컴포넌트, 탭 셸, 상세 위치 버튼과 리사이저, 반응형 |
| `se-c10x` | E3 목록·칸반·상세 뷰 | 7 | 트리 목록, 열, 칸반, 상세 내용, view 토글, 가상 스크롤 |
| `se-cv7w` | E4 검색·필터·정렬 | 7 | `/` 검색, 필터 문법과 칩 UI, 자동완성, 정렬, 설정 영속화 |
| `se-pbqz` | E5 키보드 단축키 | 12 | 키 표와 라우터, 이동·포커스 키, SPC 리더 메뉴, 도움말 |
| `se-ehdi` | E6 읽음 표시 | 4 | 안 읽음 판정, 읽음 쓰기, NEW 뱃지 |
| `se-rhu3` | E7 위키 탭 | 9 | 목록·본문 2단, 안전한 마크다운, 링크·되감기, 검색·역링크 |
| `se-bz5y` | E8 출시 준비 | 5 | i18n, 버전 2.0.0과 CI·릴리스, 사용자 문서 |

### 진행 순서

```
E0 (스파이크·상류 요청) ──┬─> E1 데이터 계층 ──> E3 뷰 ──> E4 검색·필터·정렬
                          │        │                 └──> E6 읽음
E2 룩앤필·셸 (E0와 병행) ─┘        └──> E7 위키
E5 키보드는 E1 상태 스토어 뒤에 시작하고, E3·E4·E7과 함께 키를 채운다
E8은 마지막
```

`moai link`로 건 선후 관계:

| 막는 이슈 | 막히는 이슈 |
|---|---|
| `se-0g4a.anz` 데몬 프로필 | `se-89fu.ca6` 요청 큐, `se-ehdi.o5u` 읽음 쓰기, `se-rhu3.z9l` 위키 목록 |
| `se-0g4a.fjl` 동시 실행·출력 한도 실측 | `se-89fu.ca6` 요청 큐 |
| `se-0g4a.l89` CLI unread | `se-ehdi.bzp` 안 읽음 판정 |
| `se-0g4a.zrf` 키 스파이크 | `se-pbqz.051` 이동·포커스 키 |
| `se-0g4a.y91` 저장소 스파이크 | `se-cv7w.lca` 설정 영속화 |
| `se-89fu.nqm` 단일 HTML 빌드 | `se-89fu.swr` 테스트 하네스 |
| `se-89fu.peu` 이슈 인덱스 | `se-c10x.jnc` 목록, `se-c10x.bym` 칸반 |
| `se-qwkz.oyb` 토큰 레이어 | `se-qwkz.ot4` 공용 컴포넌트 |
| `se-pbqz.xmy` 키 라우터 | `se-pbqz.051` 이동 키, `se-pbqz.gkm` SPC 메뉴 |
| `se-rhu3.2w4` 마크다운 렌더러 | `se-c10x.mh9` 상세 내용 |

데몬 프로필이 늦어지면 E1~E4는 **픽스처 모드**로 개발한다. `tests/fixtures/moai/`의 JSON을 test-host로 넣고, 실제 연결은 프로필이 들어온 뒤 붙인다.

## 5. 위험

| 위험 | 영향 | 대응 |
|---|---|---|
| 출력 한도 1 MiB | 큰 트래커에서 전체 행을 한 번에 받지 못한다 | 기본은 아카이브를 빼고(`show --all`) 아카이브는 페이징으로 읽는다. 잘림(`truncated`)이 나오면 배너로 알린다. 필요하면 상류에 필드 줄인 출력(`--fields`)을 제안한다 |
| 승인 창 마찰 | 읽기는 프로필·머신·폴더마다 세션에 한 번, 쓰기는 매번 승인한다 | 2.0은 쓰기를 `read`로 최소화한다. `read`가 매번 승인을 받아야 한다면 여러 행을 모아 한 번에 쓴다 |
| 첫 포커스 | 호스트가 도구 탭을 열 때 iframe에 포커스를 주지 않는다 | 패널에 "클릭해서 키보드 사용" 힌트를 두고, `saycode-panel-ready` 때 `body.focus()`를 시도한다 |
| 파생값 재구성 | 마일스톤 소속, 상속된 미룸, 아카이브 후보가 JSON에 없다 | `nav.rs` 규칙을 이식하고, CLI 출력과 같은지 픽스처로 검증한다 |
| 토큰 10개 한계 | hover·warn·success가 테마 계약에 없다 | `color-mix`로 파생한다. 정확한 값이 필요해지면 테마 계약 v2를 Desktop에 제안한다 |
