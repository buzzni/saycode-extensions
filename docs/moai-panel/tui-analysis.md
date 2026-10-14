# moai TUI 분석

`moai tui`(저장소 `/home/coder/workspace/moa-issue`, Rust)를 웹 패널로 옮기기 위해 정리한 명세다. 경로는 그 저장소를 기준으로 쓴다. 이 명세를 패널에서 어떻게 받는지는 [설계](design.md)와 [단축키 매핑](keybindings.md)에 있다.

핵심 성격은 다음과 같다.

- moai TUI는 **읽기 전용 탐색기**다(`docs/explorer.md:1-8`). 유일한 이슈 쓰기는 `SPC n`(backlog 메모)이다.
- 읽음 표시는 트래커 밖의 개인 설정에 쓴다.
- 이동, 수정, 노트는 모두 CLI(`moai mv/edit/note`)로 한다.

## 1. 화면

| 화면 | 내용 | 열기 |
|---|---|---|
| 목록 (기본) | 마일스톤과 에픽을 디렉터리처럼 드나드는 트리 목록 + 상세 | `SPC g l` |
| 보드 | 같은 행을 칸반으로 배치한다. 목록의 **레이아웃**일 뿐이라 커서, 필터, 검색, 상세를 공유한다(`src/tui/board.rs:1-9`) | `SPC g b` |
| 통계 | `moai stats`를 막대로 그린다. 목록을 덮는 창이다 | `SPC g s` |
| 위키 | `docs/*.md`를 읽는다. 덮는 창이고 읽기만 한다 | `SPC g w` |
| 보조 창 | 프로젝트 고르기, 정렬 편집, 시간대, jot 폼, 링크 선택 | `Mode` enum (`src/tui/mod.rs:178-207`) |

### 1.1 목록 레이아웃

- 위에서 아래로 헤더(로고·사용자·버전), 경로줄, 배너, 본문(목록+상세), SPC 메뉴·필터 힌트, 키 바 순서다(`src/tui/draw.rs:129-215`).
- 경로줄에는 다음이 한 줄로 선다(`draw.rs:2321-2440`).
  - `/마일스톤/에픽` 경로
  - `↻ HH:MM:SS`(마지막으로 읽은 시각)
  - 워크트리 브랜치
  - 숨김·정렬 뱃지
  - 걸린 검색·필터 뱃지
- 상세 위치는 right, bottom, left, top 네 가지이고 `SPC o d`로 순환한다(`src/tui/view.rs:106-168`).
- 분할 비율:
  - 가로 분할이면 목록 55%(`draw.rs:36`), 세로 분할이면 목록 70%(`draw.rs:41`)이고 범위는 15~85%(`draw.rs:56`)다.
  - 구분선을 드래그하면 `[tui] list_width/list_height`에 저장된다.
- 상세는 `SPC v d`로 숨길 수 있다.

### 1.2 상태

| 상태 | 내용 |
|---|---|
| `path` | 현재 경로, `Seg` 배열: Milestone, Epic, Issue, Lost (`src/nav.rs:41-50`) |
| `cursor` | 행 종류는 `Row::Up("..")`, `Row::Item(entry, twig)`, `Row::Project` |
| `expanded` | 펼친 그룹. 저장하지 않는다 |
| `focus` | Explorer 또는 Detail |
| `mode` | Browse, Grep, Filter, Ask, Backlog, Pick, Unregister, Zone, Sort, Stats, Wiki |
| `hung` | 걸린 검색·필터 (`mod.rs:215`) |
| `view` | `hidden` 칸, `hide_deferred`(기본 true), `hide_backlog`, `show_archived` |
| 나머지 | `order`, `fields`, `layout`, `detail_open`, `detail_at`, `raw`, `timezone`, `mouse`, 분할 비율 |

- 스크롤은 목록과 상세가 각각 따로 가진다.
- 휠과 `Ctrl-d/u/f/b`는 커서를 두고 화면만 굴린다("adrift"). 다음 `j`/`k`가 화면을 커서 위치로 되돌린다.

### 1.3 갱신

- `issues.jsonl`, 읽음 파일, 사용자 설정, 아카이브의 mtime을 키 입력마다 확인하고, 바뀌었으면 다시 읽는다.
- 다시 읽기 전용 키는 없다(`keys.rs:642-647`).
- 위키 창은 열려 있는 동안 다시 읽지 않는다.

## 2. 단축키

원칙(`keys.rs:642-656`):

- 바로 누르는 키는 이동, 드나들기, 포커스, `/`, `Esc`, `0-9`, `r`뿐이다.
- 나머지는 모두 `SPC` 리더 뒤에 있다.
- `q`, `f`, `n`은 단독으로 묶여 있지 않다. 종료는 `SPC q`이고, `Ctrl-C`는 어디서나 즉시 종료한다.

### 2.1 Browse (`keys.rs:657-760`)

| 키 | 동작 |
|---|---|
| `j` `↓` / `k` `↑` | 한 줄 이동 (보드에서는 칸 안에서) |
| `gg` `Home` / `G` `End` | 맨 위·아래 |
| `Ctrl-d` / `Ctrl-u` | 반 페이지 스크롤(5줄), 커서는 그대로 |
| `Ctrl-f` `PageDown` / `Ctrl-b` `PageUp` | 한 페이지 스크롤(10줄) |
| `Enter` / `Backspace` | 들어가기 / 한 층 나가기 |
| `l` `→` / `h` `←` | 한 단계 펼침 / 접음. 접을 것이 없으면 나간다. 보드에서는 좌우 칸 이동 |
| `Tab` | 재귀로 모두 펼침·접음 |
| `0` / `1`~`9` | 모든 프로젝트 목록 / n번 프로젝트 |
| `Ctrl-w w` `W` `h` `j` `k` `l` | 패널 포커스 이동 (vim 창 이동) |
| `/` | 검색 |
| `Esc` | 걸린 검색·필터 해제 |
| `r` | 커서 행 읽음 |
| `SPC f` | 필터 |
| `SPC n` | backlog 메모 |
| `SPC q` | 종료 |
| `SPC p a` / `SPC p d` | 프로젝트 등록 / 해제 |

### 2.2 SPC 메뉴

SPC를 누르면 which-key 식 격자가 뜬다. 메뉴는 키 표에서 자동으로 만든다(`src/tui/menu.rs`).

| 접두 | 키 → 동작 |
|---|---|
| `SPC g` 화면 | `l` 목록, `b` 보드, `s` 통계, `w` 위키 |
| `SPC v` 보기 | `l` 미룸, `b` backlog, `o` 아카이브, `a` 모두 보이기, `1`~`9` n번째 칸, `d` 상세, `w` 워크트리, `r` 원문·렌더링 |
| `SPC s` 정렬 | `p c u s a t`: 그 필드 하나로(다시 누르면 방향 반전). `P C U S A T`: 끝에 추가. `e`: 편집창 |
| `SPC c` 열 | `i` id, `p` priority, `a` assignee, `c` created, `u` updated, `n` counts, `t` tags, `e` epic, `h` 이름줄, `w` branch |
| `SPC m` 읽음 | `a` 모두, `g` 그룹 |
| `SPC o` 옵션 | `d` 상세 위치 순환, `t` 시간대, `m` 마우스 |

메뉴 규칙:

- `Esc`나 `SPC`로 닫고, `Backspace`로 한 층 올라간다.
- 토글 항목은 실행한 뒤에도 메뉴를 열어 둔다.
- 메뉴에 없는 키는 무시한다. 단, 그 층에 없는 이동 키는 메뉴를 닫고 그 이동을 바로 한다.
- 지금 상황에서 의미 없는 항목은 나오지 않는다(`Browse::enabled`, `keys.rs:947`).
- 항목마다 `[shown]`, `[on]`, `[asc]`, `[right]` 같은 상태 라벨이 붙는다.

### 2.3 입력·편집창·위키

- **검색·필터 입력** (`keys.rs:1250-1258`, `src/tui/input.rs`)

  | 키 | 동작 |
  |---|---|
  | `Enter` | 적용 |
  | `Esc` | 취소하고 열기 전 커서로 복귀 |
  | `Tab` / `Shift-Tab` | 검색 범위 순환 / 필터 자동완성 |
  | `↑` / `↓` | 값 후보 고르기 |
  | `Ctrl-u` | 전체 지움 |
  | `Ctrl-w`, `Alt-Backspace` | 단어 지움 |

- **정렬 편집창** (`keys.rs:1283-1295`)

  | 키 | 동작 |
  |---|---|
  | `j` / `k` | 이동 |
  | `J` / `K` | 순서 바꾸기 |
  | `SPC` | 넣기·빼기 |
  | `d` | 방향 반전 |
  | `Enter` | 적용 |
  | `D` | 기본값으로 저장 |
  | `Esc` | 취소 |

- **위키** (`keys.rs:1448-1516`)

  | 키 | 동작 |
  |---|---|
  | `Enter` | 페이지 열기 / 링크 선택창 / 링크로 이동 |
  | `Tab` / `Shift-Tab` | 링크 순환 |
  | `Backspace` `h` `←` | 되감기 |
  | `/` | 검색 |
  | `Esc` | 링크 해제 → 검색 해제 → 창 닫기 |
  | `SPC v r` | 원문·렌더링 |

- **통계**: `b`로 주·일 단위를 바꾸고 `Esc`로 닫는다.
- **마우스**: 클릭하면 그 패널에 포커스가 가고 커서가 선다. 휠은 포인터 밑 패널을 굴린다. 구분선은 드래그할 수 있다. SPC 메뉴 항목을 클릭하면 그 키를 누른 것과 같다.

## 3. 검색

구현은 `src/query.rs:308-372`, `src/tui/mod.rs:3157-3250`에 있다.

- 매칭은 **대소문자를 무시한 부분 문자열**이다. 정규식이나 퍼지 매칭은 없다.
- 범위는 `All`, `Id`, `Title`, `Tag`, `Body`, `Note` 여섯 가지이고 Tab으로 순환한다.
  - `All`은 id, 제목, 태그, 본문, 노트를 모두 본다.
  - `Tag`는 태그마다 따로 비교한다.
  - `Note`는 저널에서 읽는다.
- 치는 대로 적용된다(`live()`, `mod.rs:5940`).
- **검색은 view 숨김을 걷는다**(`mod.rs:3125-3131`). 드러난 행은 흐리게 그리고 "숨김"을 표시하며, "N건 숨김"을 알린다.
- 그룹은 자신이나 자손이 매치되면 남는다(`nav.rs:403-455`).
- 하이라이트: 목록에서는 id와 제목, 상세에서는 id·제목·태그·본문을 칠한다. 노트 범위이면 상세에 걸린 노트 줄만 모은 절을 붙인다.
- "다음 결과" 키는 없다. 목록에 걸린 줄만 남으므로 `j`/`k`로 이동한다.

## 4. 필터

- 문법은 `moai show --filter`와 같다(`query.rs:1-12, 545-564, 1113-1146, 1197-1233`).
- 키:

  | 키 | 값 |
  |---|---|
  | `status` | 칸, 쉼표 OR |
  | `tag` | 반복하면 AND |
  | `no-tag` | |
  | `epic` | 물려받은 소속 포함 |
  | `milestone` | 에픽을 거쳐 온 것 포함 |
  | `parent` | |
  | `priority` | p0~p3 |
  | `assignee` | 반복하면 OR. `me`, `none` |
  | `type` | issue, epic, milestone, backlog |
  | `grep` | |
  | `stale` | 칸에 머문 일수 |
  | `since` | |
  | `created` | 생성 시각 범위 |
  | `done` | done에 든 시각 범위 |
  | `updated_at` `started_at` `done_at` | 시각 범위 |

- 조합 규칙:
  - 한 키 안의 쉼표는 OR이고, 서로 다른 키끼리는 AND다.
  - `status`, `epic`, `milestone`, `parent`, `priority`, `grep`, `type`, `stale`은 두 번 쓰면 거절한다.
  - 필드 사이 OR는 없다.
- 시간 값:
  - `YYYY-MM-DD`는 사용자 시간대의 하루다.
  - `YYYY-MM-DD HH:MM`은 그 1분이다.
  - `…Z`는 UTC 시각이다.
  - 범위는 `a..b` 또는 `a~b`이고 한쪽을 비워도 된다.
- 공백이 든 값은 `="…"`처럼 따옴표로 묶는다.
- UI(`src/tui/hint.rs`):
  - 입력칸 위에 힌트 패널(최대 6줄)이 뜬다. 키 목록과 예시가 나오고, 값 자리에서는 트래커의 실제 값 목록이 나온다.
  - `Tab`으로 키와 값을 자동완성한다.
  - 오류는 입력칸 옆에 두 줄로 보인다.
- 필터는 치는 도중에 걸리지 않고 Enter로 적용한다. 필터는 view 숨김을 따른다.

## 5. 정렬

- 필드(`keys.rs:421-463`, `query.rs:1333-1390`):

  | 필드 | 기본 방향 | 비고 |
  |---|---|---|
  | priority | asc | |
  | created | desc | |
  | updated | desc | |
  | status | asc | 설정 순서 |
  | assignee | asc | 담당 없음은 뒤 |
  | title | asc | |

- 기본은 `priority`다. 필드 순서대로 비교한다(SQL ORDER BY). 동점이면 `(priority, id)`로 가르고, 마지막 필드가 created나 updated면 id로 가른다(`query.rs:1327, 1524-1560`).
- 그룹은 항상 잎보다 먼저 오고, 바구니는 맨 끝이다(`nav.rs:437-447`).
- 저장: 프로젝트 안에서 고른 정렬은 `[tui.project."<경로>"] order`에, 전체 목록에서 고른 정렬은 `[tui] order`에 저장한다. 형식은 `["priority", "updated:desc"]`다.

## 6. 보기와 계층

- 숨김 축(`src/tui/view.rs:11-80`):
  - `hidden`: 칸 이름 목록. 기본은 빈 목록이라 done도 보인다.
  - `hide_deferred`: 기본 true.
  - `hide_backlog`: 기본 false.
  - `show_archived`: 기본 false. done에 `archive_days`(기본 14)일 넘게 머문 행이다.
  - `SPC v a`는 칸, 미룸, backlog 숨김을 풀지만 아카이브는 그대로 둔다.
- 계층(`nav.rs:1-25, 606-720`):
  - 마일스톤 → 에픽 → 이슈 순으로 놓인다. **에픽이 마일스톤을 이긴다.**
  - `부모.자식` id는 같은 에픽이면 부모 밑에 놓인다.
  - backlog는 계획 계층에 걸리지 않는다.
  - 가상 폴더로 `(마일스톤 없음)`(`--path none`)과 `(길 잃음)`(`--path lost`)이 있다.
- 펼침(`l`, `Tab`)은 세션 동안만 유지한다. 가지는 `├─ └─ │`로 그린다.
- 그룹 행 끝에는 `done/work`를 보여 준다. 일(work)만 센다.
- 상세 롤업(`draw.rs:4364`): 막대, `done/work`, %, 미룬 멤버 수, 칸별 건수.

### 6.1 칸반 (`src/tui/board.rs`, `draw.rs:2706-3060`)

- 칸은 `Backlog`, `Shelved`(미룸), 그리고 설정의 `statuses` 순서다(기본 `todo,in_progress,review,done`).
  - backlog 행은 미룸이어도 Backlog 칸에 선다.
- 레인: 뿌리에서는 마일스톤마다 하나, 안에서는 하나다.
- 카드:
  - 1줄은 `id 글리프 pN n/n`, 2줄은 `[NEW] 제목`이다.
  - 열을 켰을 때만 3줄(발줄)이 선다.
  - 남의 카드는 흐리게 그리고 `→ 이름`을 붙인다.
  - 에픽과 마일스톤은 카드가 아니다.
- 칸 최소 폭은 18칸이다. 커서가 있는 칸은 늘 보인다.
- 보드에서 카드를 옮길 수는 없다.

## 7. 열

- 행 구성: 커서, id, pN, 칸 글리프, 가지, `[NEW]`, `⎇ 브랜치`, 제목, 오른쪽 열, 셈.
- 열 10개(`view.rs:202-343`):
  - 기본 켬: id, priority, counts, 이름줄, branch
  - 기본 끔: tags(14칸), epic(16칸), assignee(10칸), created(6칸), updated(6칸)
- 좁아지면 dates → epic → assignee → tags 순으로 사라진다(`Field::drop_rank`).
- 폭은 상수다. 사용자가 열 폭을 바꿀 수는 없다.
- 저장은 `[tui] fields`와 `fields_known`에 한다. 새 열은 기본값으로 서고, 사용자가 끈 열은 계속 꺼진다.

## 8. 읽음 표시

- **대상**은 "내게 온 것"뿐이다(`src/query.rs:1655-1720`, `src/report.rs:1141-1196`).
  - 담당이 나인 행, 그 `.자식`, 내 에픽의 멤버가 여기에 든다.
  - 마일스톤 축은 세지 않는다.
  - 내가 누구인지 모르면 `[NEW]`가 서지 않는다.
- **판정**: `seen[id]`가 없거나 `updated_at > seen[id]`이면 안 읽음이다. 노트는 `updated_at`을 바꾸지 않으므로 세지 않는다.
- **쓰기**:
  - `r`은 커서 행 하나(`moai read <id>`), `SPC m a`는 모두(`--all`), `SPC m g`는 그룹(`-e <group>`)이다.
  - **자동 읽음은 없다.**
  - 적는 값은 화면에 그린 행의 `updated_at`이다.
- **저장**: `~/.config/moai/read/<fnv1a64(canonical 루트)>.toml`의 `[read]` 표에 `id = "updated_at"`로 쓴다(`src/read_marks.rs`). 트래커에는 쓰지 않는다.
- **표시**: 제목 앞에 `[NEW]`를 붙인다(빨강 글자, 연노랑 배경). 개수 뱃지는 없다.
- **웹 이식 시 문제**: 안 읽음 목록을 JSON으로 주는 CLI가 없다. `moai read --json`은 쓴 결과(`{read, missing, held, problems, at}`)만 준다.

## 9. 상세

`about()`(`draw.rs:3905-4185`)이 위에서 아래로 쌓는다.

1. id와 브랜치
2. 제목
3. 머리줄: 칸 · pN · kind · 미룸 사유
4. 태그
5. 라벨 필드: Assignee, Epic, Milestone(실제로 선 자리와 그 이유), Blocked-by(5종 판정), Due, Created, Updated, Started, Ended
6. 그룹이면 롤업
7. 노트 절: 검색이 노트를 볼 때만
8. 본문 마크다운(`src/markdown.rs`). 블록은 제목, 문단, 목록, 코드, 인용, 표, 가로줄이다. `SPC v r`로 원문을 본다
9. 커밋 목록

**이력(journal)과 `work`는 TUI 상세에 나오지 않는다.**

## 10. 위키

- 데이터는 `<wiki_dir>/**/*.md`다. 기본 `docs/`이고 `.moai/config.toml`의 `wiki_dir`로 바꾼다.
  - 작업 트리 파일을 읽으므로 위키는 브랜치를 따른다.
- 정렬은 `README`, `index`를 먼저 두고 나머지를 제목순으로 둔다.
- 페이지 모델(`src/wiki.rs:109-133`): `slug`, `title`, `path`, `bytes`, `issues[]`, `links[]`, `headings[]`, `linked_from[]`, `conflict`, `error`, `body`.
- 링크 해석(`wiki::target`, 838):
  - 상대 `.md`만 위키 안 링크로 본다. 링크가 적힌 페이지의 폴더를 기준으로 푼다.
  - `#anchor`, `%XX`를 처리한다.
  - 절대 경로와 `scheme:` 주소는 위키 밖이다.
- 앵커(`wiki::anchor`, 198)는 GitHub slug 규칙을 따른다. 소문자로 바꾸고, 글자·숫자·`-`·`_`만 남기고, 공백은 `-`로 바꾼다. 같은 앵커가 반복되면 `-1`, `-2`를 붙인다.
- 화면: 왼쪽 목록, 오른쪽 본문. `Tab`으로 링크를 고른다. trail로 되감으면 읽던 줄까지 복원된다. 이슈 id 링크를 고르면 그 이슈 행으로 이동한다.

## 11. 데이터 소스

| 경로 | 내용 |
|---|---|
| `.moai/issues.jsonl` | 이슈 스냅샷. backlog는 파일에 `"kind":"idea"`로 저장되고 CLI JSON에서는 `backlog`로 나온다 |
| `.moai/archive/<year>.jsonl` | 아카이브된 행 |
| `.moai/journal/<user>.jsonl` | 이력: create, status, note, rm |
| `.moai/config.toml` | `prefix`, `statuses`, `archive_days`, `naming`, `wiki_dir` |
| `~/.config/moai/config.toml` | `[tui]` 설정 (`src/user_config.rs:1470-1533`) |
| `~/.config/moai/read/<hash>.toml` | 읽음 표시 |

CLI(`--json`, `-C <dir>`):

| 목적 | 명령 | 출력 |
|---|---|---|
| 활성 전체 | `moai show --all` | 배열. 아카이브 제외 |
| 아카이브 포함 | `moai show --archived` | moa-issue 기준 2289행, 2.35 MB, 0.19초 |
| backlog | `moai backlog show` | |
| 상세 | `moai show <id>` | `journal[]`, `children[]`, `members[]`, `commits[]`, `work[]`, `derived_*` |
| 필터·정렬·페이징 | `moai show --filter … --sort … -n N --after <id>` | |
| 요약 | `moai status` | `{counts, total, milestones, epics, archived, warnings, notices, flow}` |
| 바로 할 일 | `moai ready` | `{ready, others, held}` |
| 통계 | `moai stats` | |
| 위키 | `moai wiki ls`, `moai wiki show <slug>` | |
| 한 디렉터리 | `moai tui --json --path <id\|none\|lost>` | `{id, title, kind, dir, path, status, derived_status, priority}`. 정렬·필터 없음 |
| 읽음 쓰기 | `moai read <id>… \| --all \| -e <group>` | |

JSON에 **없는** 파생값(웹에서 재구성해야 함):

- 마일스톤 소속
- 상속된 미룸
- 아카이브 후보 여부
- 안 읽음

있는 파생값은 `derived_status`와 `derived_epic`이다.

## 12. 웹 이식 시 주의점

1. 계층 계산(`nav::Index::home`)을 정확히 이식해야 셈, 레인, 읽음 판정이 CLI와 같아진다.
2. 필터를 키마다 CLI에 맡기면 한 번에 0.1~0.3초가 든다. 클라이언트에서 구현하고 CLI와 결과가 같은지 테스트로 맞춘다.
3. 노트 검색에는 저널(3.2 MB)이 필요하다. TUI도 처음 쓸 때만 읽는다.
4. 수천 행이 될 수 있으므로 가상 스크롤이 필요하다.
5. 두 키 시퀀스(`gg`, `Ctrl-w x`, `SPC …`)에는 키 버퍼가 필요하다. 브라우저와 Desktop이 예약한 Ctrl 키를 피해야 한다.
6. 시간대: 저장은 UTC이고 표시는 `[tui] timezone`을 따른다. CLI 필터는 `[tui] timezone`을 읽지 않는다.
7. 칸(`statuses`)은 프로젝트 설정이다. 하드코딩하지 않는다.
8. 마크다운은 raw HTML, 이미지, 각주를 지원하지 않는다. 웹에서는 반드시 이스케이프한다.
9. 쓰기는 반드시 CLI에 맡긴다. JSONL을 직접 쓰면 락, 저널, 병합 규칙이 깨진다.
10. i18n 문구는 `i18n/{en,ko,ja,zh,es}.json`의 `tui.*` 키를 참고한다.
