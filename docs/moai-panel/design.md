# Moai 패널 2.0 설계

[개편 계획](overview.md)의 결정을 구현 단위로 풀어 쓴 설계다. 원본 동작은 [moai TUI 분석](tui-analysis.md), 스타일 값은 [세이코드 룩앤필 가이드](look-and-feel.md), 키는 [단축키 매핑](keybindings.md)을 기준으로 한다.

> **구현 후 표시.** 이 페이지는 구현 **전**의 설계이고 본문은 고치지 않았다. 구현이 설계와 달라진 곳과 아직 열려 있는 곳은 아래 "구현과 달라진 점"에 모았고, 본문에도 해당 절에 `※`로 가리켰다. 구현 결과 자체는 [현황 2.0절](current-state.md#20-구현-결과)이 기준이다.

## 구현과 달라진 점 (2026-10-14, `milestone/se-9inv` 배선 묶음 `a7fe3df` 기준)

| 설계 | 구현 | 상태 |
|---|---|---|
| 2절 구조의 `data/unread.ts` | `data/read.ts`. 판정은 CLI가 하고(`row.unread`), 파일은 판정 헬퍼와 쓰기·갱신 비교를 둔다 | 머지됨 |
| 2절 `keys/table.ts`·`router.ts` | 같은 이름 | 머지됨 |
| 2절 `view/` 목록 | 목록·칸반이 `list-model.ts`, `board-groups.ts`, `detail-format.ts`, `responsive.ts`, `components.ts`, `icons.ts`로 더 쪼개졌다 | 머지됨 |
| 3.1 `backlog` 프로필 | `backlog-all`(`backlog show --all`). 데몬의 기존 `buzzni.moai.backlog`가 `backlog add`라서 id를 따로 잡았다 | 선언만, 데몬 확인 대기 |
| 3.1 `show-archived` 한 개 | `show-archived`(첫 쪽)와 `show-archived-after`(다음 쪽) 두 개, 쪽당 200 고정 | 선언만, 데몬 확인 대기 |
| 3.1 `statuses`를 얻을 `config` 프로필 | 만들지 않았다. `status --json`의 `statuses` 배열을 읽고, 없으면(옛 moai) `counts` 키를 기본 순서에 맞춘다 | 머지됨. 상류 moai 0.17.0에서 확인 |
| 3.2 동시 상한 "스파이크로 정함" | 동시 3, `workspace-busy`는 큐로 되돌려 최대 3번(1초씩 늘려) 재시도 | 머지됨(`main.ts`가 `PANEL_CLIENT_OPTIONS` 사용), 라이브 확인 대기 |
| 3.2 폴링 500ms | 그대로 | 머지됨 |
| 3.3 시작 때 `show-all`·`backlog`·`status` | `loadAllRows`가 `show-all`과 `backlog-all`을 나란히 읽는다. 잘리거나 거부되면 `prime`으로 물러난다: `show-all`이 없으면 `prime`+backlog, `backlog-all`만 없으면 backlog 없는 목록, 둘 다 없으면 `prime`. 카탈로그 줄이 없는 것을 말한다(`se-mt96`, `se-haiw`) | 머지됨(`se-bco3`). `main.ts`가 `loadAllRows`를 쓰고 잘림 배너를 단다 |
| 3.4 셈(n/n)을 행에서 계산 | `status --json`의 `milestones[]`·`epics[]`의 `done/total`을 받아 `IssueIndex(rows, tallies)`에 넘긴다. 시간으로 아카이브된 행이 `show --all`에 없기 때문이다 | 머지됨(`se-tcd4`, 연결 `se-poaz`) |
| 3.4 마일스톤 소속·상속 미룸·아카이브 후보를 인덱스가 계산 | 상류 moai 0.17.0이 행에 `derived_milestone`, `shelved_by`, `archived`를 해당할 때만 준다(요청 때 이름은 `derived_deferred`·`archive_candidate`). 있으면 그것을 우선하고, 없을 때만 `nav.rs` 규칙으로 계산한다 | 머지됨(`se-ydco`). 상류 0.17.0에서 확인 |
| 4.4 검색 범위 `note` | 매처는 노트를 `notes`(id → 텍스트들)로 따로 받고, 없으면 `note` 범위는 아무것도 찾지 못한다. 행에 노트가 없으므로 이 맵을 채우는 연결은 없고, `note` 범위는 조용히 아무것도 못 찾는다 | 매처만 머지됨. 2.0 툴바에서는 `note`를 범위 순환에서 뺐다(`se-thyl`, `31ad3a2`). 되살리기는 `se-qxeh`(`show -g` 연결) |
| 4.9 안 읽음은 클라이언트가 `seen`으로 판정 | CLI가 `unread`를 찍어 주고 패널은 읽기만 한다. 사람을 모르면 NEW가 꺼진다 | 머지됨. 상류 `moai-cqwy`, 0.17.0에서 확인 |
| 4.9 쓰는 값은 그린 행의 `updated_at` | CLI는 값을 받지 않고 **현재** `updated_at`을 쓴다. 쓰기 뒤 다시 읽어 `staleAgainst`로만 비교한다 | 달라짐. 상류 요청은 backlog `se-a5wl` |
| 4.9 NEW 모든 행 | **아카이브에서만 온 행은 NEW를 그리지 않는다.** `moai read`가 활성 행만 풀기 때문이다 | 머지됨(`se-fvou`) |
| 4.9 탭 뱃지·NEW 칩 | 목록 행·칸반 카드·상세 머리에 NEW 칩, 칸반·목록 탭에 프로젝트 전체 안 읽음 수 뱃지. 읽음 표시 뒤 열린 상세도 다시 읽는다 | 머지됨(`se-ehdi.zcx`, `se-ehdi.aka`) |
| 4.11 렌더러 지원 목록 | 엔티티·참조 링크·취소선·작업 목록이 더해졌다. 이미지는 여전히 지원하지 않는다 | 머지됨 |
| 5 설정 영속화 범위 "탭: 프로젝트" | 기억은 키 `buzzni.moai.panel` 하나에 **전역**으로 둔다. 항목은 탭·상세 표시·위치·위치별 비율뿐이다 | 머지됨 |
| 5 정렬·열·보기·위키 분할 기억 | 정렬·필터·열·보기·기본 정렬(`D`)은 **세션 동안만** 기억한다(`SettingsStorage` 이음새). 위키 분할은 기억하지 않는다. 영속은 SDK 설정 저장 API 뒤 | 세션 수준 머지됨(`se-cv7w.lca`, `se-5air`), 영속 대기(`se-c9mu`) |

### 배선 묶음이 머지된 뒤 (`a7fe3df`)

한 워크트리가 들고 있던 배선 묶음이 머지됐다(epic-end 리뷰 `se-pbqz.y8z` max, 15건 반영). 설계와 달라진 구현 결정은 이렇다.

| 이슈 | 결과 |
|---|---|
| `se-jwl3` | 키 라우터·SPC 메뉴·도움말·kbd 힌트를 `main.ts`·`store.ts`에 이었다. 키 주인은 라우터 한 곳이고, 입력창·IME 중에는 물러나며, 컨트롤의 `Enter`/`Space`는 컨트롤의 것이다 |
| `se-pbqz.k84` | 한글 입력 소스는 `event.code`로 읽는다. **실기 확인 남음** |
| `se-cv7w.0qk` | 툴바(검색·필터·정렬)를 스토어·목록·칸반에 이었다. 툴바는 한 번만 만들고 갱신해 IME 조합이 끊기지 않는다 |
| `se-jj42` | 위키 탭을 셸에 이었다. 탭을 바꿔도 상태가 복원되고, 라우터가 `wiki.handleKey`를 부른다 |
| `se-bco3`, `se-poaz` | `main.ts`가 `PANEL_CLIENT_OPTIONS`·`loadAllRows`·잘림 배너·`loadTallies`·`loadArchived`를 쓴다 |
| 스토어 어휘 | 칸 이름 `status`, 사람 이름 `names`, 아카이브 표시 `showArchived`(참이면 보임) |

### 아직 열려 있는 것

열린 이슈 `se-1t2r`·`se-5y3p`·`se-kd3u`·`se-s3vv`(i18n·E8 리뷰 잔여), SDK 설정 저장 API 뒤의 영속(`se-c9mu`). `se-qxeh`(note 검색 범위)는 사람이 2.0 밖으로 미뤘다. 상세는 [현황 2.0.8절](current-state.md#208-아직-열려-있는-것-2026-10-14)에 있다.

## 1. 화면 구성

```
┌──────────────────────────────────────────────────────────────┐
│ [칸반] [목록] [위키]                      ↻ 12:03  [▤|▥] [?] │  탭 바 40px
├──────────────────────────────────────────────────────────────┤
│ 🔍 검색(/)  [범위:all▾] │ 필터 칩… [+필터] │ 정렬▾ 보기▾ 열▾  │  툴바 40px
│ /v2.0/E3 목록·칸반 뷰   [done 숨김 · sort priority↑]  [Esc 해제] │  경로줄 28px
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                목록 또는 칸반 (스크롤 영역)                  │
│                                                              │
├────────────────────────── 리사이저 ──────────────────────────┤
│                 상세 (아래 위치일 때)                        │
└──────────────────────────────────────────────────────────────┘
```

- **탭 바**: 칸반, 목록, 위키 세 탭이다. 오른쪽에는 갱신 시각(`↻ HH:MM:SS`), 상세 위치 토글 버튼, 도움말 버튼이 있다.
  - 갱신 시각을 누르면 새로 읽는다.
  - 상세 위치 토글은 28×28 아이콘 버튼 하나다. 아이콘은 lucide `panel-left` / `panel-bottom`이고, 누를 때마다 왼쪽과 아래가 바뀐다. `aria-label`과 `title`을 둔다.
  - 위키 탭에서는 툴바가 위키 검색 하나로 바뀌고, 상세 대신 위키 본문이 선다.
- **툴바**: 검색, 필터, 정렬, 보기, 열 컨트롤이 있다. 좁은 폭에서는 정렬, 보기, 열이 아이콘 버튼 메뉴로 접힌다.
- **경로줄**: TUI의 crumbs와 같다. 현재 경로(`/마일스톤/에픽`), 숨김·정렬 뱃지, 걸린 검색·필터 뱃지(경고색), 그리고 "Esc로 해제" 안내를 보여 준다.
- **본문**: 목록이나 칸반과 상세를 나눈 영역이다.

### 1.1 상세 위치

- 상세 위치는 **왼쪽(left)과 아래(bottom)만** 지원한다. 기본은 아래다.
- 왼쪽 레이아웃은 `[상세 | 리사이저 | 목록]` 순서다. 상세가 목록보다 앞에 온다.
- 분할 비율:
  - 왼쪽일 때는 상세 폭 기본 45%(목록 55%), 아래일 때는 상세 높이 기본 30%(목록 70%)다. TUI 기본값과 같다.
  - 허용 범위는 15~85%다. 최소 크기는 목록 3줄과 상세 6줄 또는 상세 240px이다.
  - 리사이저는 1px `--border` 선이다. 히트 영역은 9px이고 hover·focus 시 3px `--accent`로 바뀐다. 키보드로는 리사이저에 포커스한 뒤 화살표로 조절한다.
  - 비율은 위치별로 따로 기억한다(`ratio.left`, `ratio.bottom`).
- 패널 폭이 640px보다 좁으면 아래로 강제하고, 토글 버튼은 비활성화한 뒤 툴팁으로 이유를 알린다.
- `SPC v d`로 상세를 숨기거나 보인다. 숨기면 목록이 전체를 쓴다.
- 칸반 탭에서도 상세는 같은 위치 규칙을 따른다.

### 1.2 탭 상태

- 탭을 바꿔도 각 탭의 스크롤과 커서를 유지한다. 목록과 칸반은 TUI처럼 **같은 커서, 필터, 검색, 상세를 공유한다**(칸반은 목록의 레이아웃일 뿐이다).
- 위키 탭은 자기 상태를 따로 가진다. 페이지, trail, 검색이 여기에 든다.
- 마지막 탭은 영속 설정에 저장한다. TUI의 `[tui] layout`에 해당한다.

## 2. 아키텍처

```
packages/moai/
  extension.json        machineCommands 프로필 추가, panel.entrypoint → dist/panel.html
  src/index.ts          run(profileId, params) 화이트리스트 확장
  panel/
    main.ts             부트스트랩: saycodePanel.ready, 포커스, 테마 관찰
    store.ts            단일 상태 + subscribe, 액션 → 리듀서
    data/
      client.ts         요청 큐: start → poll → parse, 요청별 상태와 취소
      index.ts          이슈 인덱스: 계층, 파생값 (nav.rs 이식)
      query.ts          검색·필터 파서·매처, 정렬 비교기 (query.rs 이식)
      unread.ts         안 읽음 판정
    view/
      shell.ts tabs.ts toolbar.ts crumbs.ts split.ts
      list.ts board.ts detail.ts wiki.ts menu.ts help.ts
      markdown.ts       안전한 마크다운 렌더러
    keys/
      table.ts          키 표(데이터) — 모드별 바인딩, 라벨, 상태 라벨
      router.ts         keydown → 시퀀스 버퍼 → 액션
    style/tokens.css components.css
    i18n/*.json
  build.mjs             esbuild 번들 + CSS·JS 인라인 → dist/panel.html (512 KiB 이하 확인)
```

- **렌더링**은 상태가 바뀌면 영역별 `render(state)`를 다시 호출하는 단방향 방식이다. 목록은 가상 스크롤로 보이는 행만 그린다. 프레임워크는 쓰지 않는다.
- **순수 로직**(`data/index.ts`, `data/query.ts`, `data/unread.ts`, `keys/router.ts`)은 DOM과 무관하게 두고 `node --test`로 직접 검증한다.
- **테스트**:
  - 순수 함수 단위 테스트: moa-issue의 실제 `--json` 출력을 픽스처로 쓴다.
  - jsdom 스모크: 탭 전환, 상세 위치 토글, 키 시퀀스 정도만 확인한다.
  - 기존 `tests/moai.test.mjs`의 `PANEL_IDS` 의존 테스트는 다시 쓴다. `packMoai`는 `dist/panel.html` 경로를 따르도록 고친다.

## 3. 데이터 계층

### 3.1 프로필 (데몬 카탈로그와 함께 추가)

※ 구현은 12개이고(`add`는 2026-10-15 실기 뒤 뺐다) `backlog`는 `backlog-all`, 아카이브는 두 개다. 위 "구현과 달라진 점"과 [현황 2.0.3](current-state.md#203-프로필-12개)을 본다.

| 프로필 id | argv (`moai --json -C {{workspaceRoot}} …`) | 용도 | 쓰기 |
|---|---|---|---|
| `status` (기존) | `status` | 칸 이름, 카운트, 경고 | 아니오 |
| `show` (기존) | `show {{id}}` | 상세: journal, children, members, commits, work | 아니오 |
| ~~`add` (기존)~~ | `add {{title}}` | 할 일 추가 — 2026-10-15 실기 뒤 뺐다(`se-24ey.oxd`) | 예 |
| `show-all` (신규) | `show --all` | 활성 행 전체(done·미룸 포함, 아카이브 제외) | 아니오 |
| `backlog` (신규) | `backlog show` | backlog 행 | 아니오 |
| `show-archived` (신규) | `show --archived -n {{limit}} --after {{after}}` | 아카이브 페이징 (`SPC v o`를 켤 때만) | 아니오 |
| `wiki-ls` (신규) | `wiki ls` | 위키 페이지 목록, 링크, 역링크 | 아니오 |
| `wiki-show` (신규) | `wiki show {{slug}}` | 페이지 본문 | 아니오 |
| `read` (신규) | `read {{id}}` | 한 행 읽음 | 개인 설정만 |
| `read-all` (신규) | `read --all` | 모두 읽음 | 개인 설정만 |
| `read-group` (신규) | `read -e {{group}}` | 그룹 읽음 | 개인 설정만 |

- `read`는 트래커가 아니라 `~/.config/moai/read/`에 쓴다. `writeScope`를 붙여야 하는지는 데몬과 정한다.
- 칸 이름(`statuses`)이 `status --json`에 없으면 `config` 조회 프로필을 하나 더 둔다. 이 점은 스파이크 `se-0g4a.fjl`에서 확인한다.
- `show-all`이 1 MiB를 넘으면(`truncated`) 배너로 알린다. 상류에는 본문을 뺀 목록 출력을 제안한다. 본문은 상세를 열 때 `show <id>`로 읽으면 된다.

### 3.2 요청 큐

※ 동시 3과 `workspace-busy` 재시도로 정했다. [현황 2.0.4](current-state.md#204-요청-큐-동시-3-workspace-busy-재시도).

- 전역 `busy` 락을 없앤다. 요청마다 `{profileId, params, state, operationId}`를 갖는다.
- 같은 키(`profileId+params`)로 이미 실행 중인 요청이 있으면 그 요청을 공유한다.
- 동시 실행 상한은 스파이크 결과로 정한다. 직렬만 된다면 우선순위 큐를 쓴다: 사용자가 연 상세 > 위키 본문 > 목록 갱신 순.
- 거부 코드(`declined`, `approval-timeout`, `workspace-busy`, `tool-missing`, `NOT_A_REPOSITORY` 등)는 영역별 배너로 보여 준다. 처리 로직은 기존 `run()`/`poll()`에서 옮긴다.
- 폴링 간격은 500ms다(기존과 같음).

### 3.3 갱신

- 패널이 열릴 때 `show-all`, `backlog`, `status`를 읽는다.
- 자동 갱신은 탭이 보이는 동안 10초마다 `show-all`을 다시 읽는다(처음 설계는 60초, 2026-10-15 실기 뒤 사람 결정으로 줄였다, `se-24ey.14i`). 승인은 세션에 한 번이라 부담이 적다. 목록 읽기를 확인 창에서 거절하면 자동 갱신을 멈추고 수동 갱신으로 다시 켠다. 간격은 설정할 수 있게 한다.
- 수동 갱신은 갱신 시각 버튼을 누르는 것이다. TUI에는 `r` 다시 읽기가 없고 `r`은 읽음 키이므로 키는 배정하지 않는다.
- 다시 읽어도 커서는 같은 id에 남긴다. 그 행이 사라졌으면 가장 가까운 행으로 옮긴다.

### 3.4 이슈 인덱스 (nav.rs 이식)

`show --all`의 행에서 다음을 계산한다.

- **계층**:
  - 마일스톤은 뿌리에 선다. 에픽은 제 마일스톤 밑에, 이슈는 `derived_epic` 밑에 선다.
  - **에픽이 마일스톤을 이긴다.** 이슈에 적힌 마일스톤과 에픽의 마일스톤이 달라도 이슈는 에픽을 따라간다.
  - id가 `부모.자식`이고 부모와 같은 에픽이면 부모 밑에 접힌다.
  - backlog는 뿌리 또는 `(마일스톤 없음)` 바구니에 잎으로 선다.
  - 에픽을 찾지 못하면 `(길 잃음)` 바구니로 간다.
  - 중복 id는 어느 그룹에도 세지 않는다.
- **파생값**:
  - `derived_status`는 JSON에 있다.
  - `milestone_of`는 에픽의 마일스톤, 에픽이 없으면 조상을 따라 올라간다.
  - 상속된 미룸은 자신·부모·에픽·마일스톤의 `deferred_at`에서 계산한다.
  - 아카이브 후보는 `status==done`이면서 `status_since`가 `archive_days`보다 오래된 것이다.
- **셈(n/n)**: 일(work)만 센다. backlog와 그룹은 세지 않는다.
- **정확성 검증**: 같은 저장소에서 `moai tui --json --path <id>`의 디렉터리 목록과 인덱스 결과가 같은지 픽스처 테스트로 맞춘다.

## 4. 기능 명세

### 4.1 목록 탭

- 행은 TUI와 같은 순서로 놓는다: 커서, id, `pN`, 칸 글리프, 가지, `NEW`, 제목(그룹은 끝에 `/`), 오른쪽 열, 셈 `n/n`.
- 드나들기:
  - `Enter`(또는 그룹 행 더블클릭)로 들어가고 `Backspace`로 나온다. 경로줄의 각 조각을 클릭하면 그 층으로 간다.
  - 첫 행은 `..`(한 층 위)다.
- 펼침: `l`/`h`/`Tab`과 행 앞의 ▸ 버튼으로 한다. 펼친 상태는 세션 동안만 유지한다(TUI와 같음).
- 정렬: 그룹(디렉터리)이 항상 잎보다 먼저 오고, 바구니는 맨 끝이다.
- 색:
  - 칸 글리프 색은 TUI 색을 세이코드 토큰에 대응시킨다(룩앤필 가이드 6절).
  - 우선순위는 p0 = danger 굵게, p1 = danger, p2 = 기본, p3 = muted다.

### 4.2 칸반 탭

- 칸은 `Backlog`, `미룸`, 그리고 설정의 `statuses` 순서다.
  - 미룸 칸은 `SPC v l`, 상태 칸은 `SPC v 1~9`를 따라 숨는다.
  - 숨긴 칸이라도 걸린 카드가 있으면 남긴다.
- 레인: 뿌리에서는 마일스톤마다 레인 하나를 두고 `(마일스톤 없음)`을 마지막에 둔다. 마일스톤이나 에픽 안에서는 레인이 하나다.
- 카드:
  - 1줄: `id 글리프 pN n/n`
  - 2줄: `NEW 제목`
  - 3줄: 켠 열이 있을 때만 태그·에픽·담당·날짜를 보여 준다.
  - 남의 카드는 흐리게 그리고 `→ 이름`을 붙인다.
  - 에픽과 마일스톤은 카드가 아니라 레인 머리다.
- 칸 최소 폭은 200px이다. 폭이 모자라면 칸반이 가로로 스크롤하고, 칸 머리는 고정한다. 커서가 있는 칸은 늘 화면에 보이게 한다.
- 카드 이동(드래그)은 2.0에서 하지 않는다. 쓰기 프로필 `mv`가 필요하다.

### 4.3 상세

내용은 위에서 아래로 쌓는다.

1. id
2. 제목
3. 머리줄: 칸 · pN · kind · 미룸 사유
4. 태그 칩
5. 라벨 필드: Assignee, Epic, Milestone(실제로 선 자리와 그 이유), Blocked-by(✓ 끝남 / · 열림 / 없음 / 미룸), Due, Created/Updated, Started/Ended
6. 그룹이면 롤업: 진척 막대, done/work, %, 칸별 건수
7. 본문 마크다운. `SPC v r`로 원문 보기
8. 커밋 목록: 짧은 해시와 제목

TUI와의 차이:

- 상세를 열면 `show <id>`를 지연 로드해서 **이력(journal)**을 접을 수 있는 절로 보여 준다. 생성, 칸 이동, 노트가 시간순으로 나온다. TUI에는 없는 기능이지만, 지금 패널이 이미 보여 주고 있어서 유지한다.
- `work`(AI 작업 기록)는 접힌 절로 둔다.
- 날짜는 Desktop 로캘 시간대로 `YYYY-MM-DD HH:MM`을 보여 준다.

### 4.4 검색 (`/`)

- 검색창은 툴바 왼쪽에 있다. 돋보기 아이콘(14px)과 범위 셀렉트가 붙는다.
- 범위는 `all → id → title → tag → body → note` 순서이고 `Tab`으로 순환한다.
  - `note` 범위는 노트가 필요하다. 처음 쓸 때만 행마다 `show <id>`를 부르는 것은 비싸다. 2.0에서는 `note`를 툴바 범위에서 뺐다(`se-thyl`). 노트 포함 검색 출력(예: `show -g` id 목록)으로 되살리는 것은 `se-qxeh`다.
- 매칭은 대소문자를 무시하는 부분 일치다. 태그는 태그마다 따로 비교한다.
- 치는 대로 적용한다. `Enter`는 확정이고, `Esc`는 취소하면서 커서를 열기 전 행으로 되돌린다.
- **검색은 view 숨김을 걷는다.** 숨겨 둔 done, 미룸, backlog 행도 찾는다. 그렇게 드러난 행은 흐리게 그리고 "숨김" 표시를 붙이며, 검색창에 "N건 숨김"을 보여 준다.
- 그룹은 자신이 매치되거나 자손이 매치되면 남긴다.
- 하이라이트는 목록의 id와 제목, 상세의 id·제목·태그·본문에 `<mark>`(배경 `--warn-soft`)로 칠한다.

### 4.5 필터 (`SPC f`)

- 문법은 `moai show --filter`와 같다. `key=value`를 공백으로 나열하고, 쉼표는 OR, 같은 키 반복은 AND(`assignee`만 OR), 다른 키끼리는 AND다. 공백이 든 값은 따옴표로 묶는다.
- 키: `status`, `tag`, `no-tag`, `epic`, `milestone`, `parent`, `priority`, `assignee`(`me`, `none`), `type`, `grep`, `stale`, `since`, `created`, `done`, `updated_at`, `started_at`, `done_at`.
  - 시간 범위는 `from..to` 또는 `from~to`다.
  - `me`는 `status --json`이나 `prime`에서 얻은 사용자로 푼다.
- 두 가지 UI를 함께 둔다.
  1. **텍스트 입력**: TUI와 같다. 힌트 패널(키 목록과 예시), `Tab` 자동완성, 값 후보 목록(`↑`/`↓`, `Enter`로 삽입)을 띄운다. 문법 오류는 입력칸 아래에 붙인다.
  2. **칩 UI**: `+ 필터` 버튼으로 키를 고르고 값을 고르면 칩이 생긴다. 칩의 x로 지운다. 칩과 텍스트는 같은 상태를 서로 다르게 보여 주는 것이라 항상 같은 내용이다.
- 필터는 치는 도중에는 걸리지 않는다. 반쯤 친 `status=in`은 틀린 문법이기 때문이다. Enter로 적용한다. 칩은 고르는 즉시 적용한다.
- 필터는 view 숨김을 따른다. 검색과 다른 점이다.

### 4.6 정렬

- 필드: priority(asc), created(desc), updated(desc), column(=status, 설정 순서), assignee, title.
- 기본은 `priority`다. 동점이면 `(priority, id)`로 가른다. 마지막 필드가 created나 updated면 id로 가른다.
- `SPC s <소문자>`는 그 필드 하나로 바꾸고, 같은 키를 다시 누르면 방향을 뒤집는다. `SPC s <대문자>`는 끝에 추가한다.
- 툴바 "정렬 ▾" 팝오버에서는 필드 목록을 체크하고, 드래그로 순서를 바꾸고, 방향 버튼을 누른다. `SPC s e`와 같은 화면이다.
- 기본이 아닐 때만 경로줄에 `sort priority↑, updated↓` 뱃지를 보여 준다.

### 4.7 보기 (view)

- 토글: 칸별 표시(`SPC v 1~9`), 미룸(기본 숨김), backlog, 아카이브(기본 숨김, 켜면 `show-archived`를 페이징으로 읽음), 모두 보이기, 상세 표시, 원문 보기.
- 툴바 "보기 ▾" 메뉴에는 체크 항목으로 두고, 항목마다 단축키를 함께 적는다.
- 숨긴 것은 경로줄 뱃지(`done 숨김 · 미룸 숨김 · 아카이브 312 숨김`)로 알린다.

### 4.8 열 (column)

- 열과 기본값:

  | 열 | 기본 |
  |---|---|
  | id | 켬 |
  | priority | 켬 |
  | counts(n/n) | 켬 |
  | 이름줄(h) | 켬 |
  | tags | 끔 |
  | epic | 끔 |
  | assignee | 끔 |
  | created | 끔 |
  | updated | 끔 |

- 오른쪽 열 폭은 고정이다: tags 14ch, epic 16ch, assignee 10ch, 날짜 6ch.
- 폭이 좁아지면 날짜 → epic → assignee → tags 순으로 사라진다. 컨테이너 쿼리로 구현한다.
- 이름줄을 켜면 목록 맨 위에 sticky 머리줄이 붙는다. 머리줄을 클릭하면 그 열로 정렬한다. 웹에서만 하는 확장이고 `SPC s`와 같은 상태를 바꾼다.
- 툴바 "열 ▾" 메뉴로도 토글한다.
- `fields_known` 규칙도 따른다. 새로 생긴 열은 기본값으로 서고, 사용자가 끈 열은 계속 꺼 둔다.

### 4.9 읽음 (read)

※ 판정 주체, 쓰는 값, 아카이브 행이 설계와 다르다. 위 표와 [현황 2.0.6](current-state.md#206-읽음-아카이브-보드-셈).

- 판정:
  - 대상은 "내게 온 것"뿐이다. 담당이 나인 행, 그 `.자식`, 내 에픽의 멤버가 여기에 든다. 마일스톤 축은 세지 않는다.
  - `seen[id]`가 없거나 `updated_at > seen[id]`이면 안 읽음이다.
  - 데이터는 상류 제안(`se-0g4a.l89`)으로 받는다. 받기 전까지는 NEW 표시를 끈다. 호환 배너는 NEW를 말하지 않는다: 키는 안 읽음 0이면 없어 부재를 기능 없음으로 읽을 수 없고, 0.16도 `unread`를 찍는다(`se-xee6`).
- 표시:
  - 목록 행과 칸반 카드의 제목 앞에 `NEW` 칩(`--warn-soft` 배경, `--warn` 글자)을 붙인다.
  - 탭 라벨에는 안 읽은 수 뱃지를 붙인다. TUI에는 없는 웹 확장이다.
- 쓰기:
  - `r`은 커서 행, `SPC m a`는 모두, `SPC m g`는 그룹을 읽음 처리한다.
  - 적는 값은 **화면에 그린 행의 `updated_at`**이다. 화면이 낡았으면 다시 NEW가 선다(TUI와 같음).
  - 자동 읽음 처리는 하지 않는다.

### 4.10 위키 탭

- 왼쪽은 페이지 목록이다. `README`와 `index`가 먼저 오고 나머지는 제목순이다. 충돌, 못 읽음, 1MB 초과 페이지에는 경고 칩을 붙인다.
- 오른쪽은 본문이다. 머리에 제목과 경로를 둔다. 분할은 위키 전용 비율(`wiki_width`)을 쓴다. 위키 탭은 상세 위치 토글과 상관없이 늘 좌우 분할이고, 좁으면 목록과 본문을 쌓는다.
- 본문을 렌더링한다(4.11).
- 링크:
  - 상대 `.md` 링크는 위키 안에서 이동하고 trail에 `(slug, 스크롤 위치)`를 쌓는다. `Backspace`로 되감는다.
  - `#anchor`는 GitHub slug 규칙으로 풀어 그 제목으로 스크롤하고 잠깐 강조한다.
  - 위키 밖 주소는 링크로 표시만 하고 열지 않는다. CSP가 막는다.
  - 본문 속 이슈 id(`wiki ls`의 `issues[]`)는 링크로 바꾼다. 누르면 목록 탭으로 가서 그 행에 선다.
- 본문 끝에 이 페이지를 가리키는 역링크(`linked_from`)를 둔다.
- 검색: `/`로 제목과 본문을 대소문자 무시 부분 일치로 찾아 목록을 좁힌다.

### 4.11 마크다운 렌더러

- 지원: 제목, 문단, 중첩·번호 목록, 코드 블록, 인용, 표, 가로줄, 굵게, 기울임, 인라인 코드, 링크.
- 지원하지 않음: raw HTML(모두 이스케이프), 이미지(CSP가 `img-src data:`만 허용), 각주.
- 직접 작은 파서를 쓴다. 외부 라이브러리를 쓴다면 HTML 출력을 끄고 크기를 확인해야 한다.
- 이슈 본문과 위키가 같은 렌더러를 쓴다.

## 5. 설정 영속화

※ 구현은 전역 키 하나에 탭·상세만 기억한다. 나머지는 스파이크 뒤로 미뤘다. [현황 2.0.5](current-state.md#205-기억memory-프레임-localstorage-전역).

| 설정 | TUI 키 | 범위 |
|---|---|---|
| 탭 | `layout` | 프로젝트 |
| 정렬 | `order` | 프로젝트 |
| 열 | `fields`, `fields_known` | 전역 |
| 보기 | `hidden`, `hide_deferred`, `hide_backlog`, `show_archived` | 전역 |
| 상세 | `detail_open`, 위치, 위치별 비율 | 전역 |
| 위키 분할 | `wiki_width` | 전역 |

- 저장소는 스파이크 `se-0g4a.y91` 결과로 정한다. 순서는 localStorage → `storage.*` 권한 → 세션 메모리다.
- 모든 접근은 try/catch로 감싸고, 저장이 실패해도 기본값으로 동작해야 한다.

## 6. 접근성

- 탭 바는 `role=tablist/tab/tabpanel`이다. 목록은 `role=treegrid`, 칸반 칸은 `role=list`를 쓴다.
- 커서 행에는 `aria-selected`를 붙인다. 포커스 이동은 roving tabindex로 하고 `:focus-visible` 링은 2px `--accent`다.
- 색만으로 상태를 전하지 않는다. 칸 글리프와 우선순위 텍스트를 늘 함께 보여 준다.
- 모든 아이콘 버튼에 `aria-label`과 `title`을 둔다.
