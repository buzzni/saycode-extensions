# 세이코드 룩앤필 가이드 (Moai 패널)

Moai 패널이 세이코드 데스크톱의 필 앤 룩을 따르도록 앱의 토큰과 컴포넌트 규격을 정리한다. 출처는 `/home/coder/workspace/aplus-dev-studio-desktop`(Electron + React 19, lucide-react, Radix UI, shadcn 계열 CSS)이고, 경로는 그 저장소를 기준으로 쓴다. 계획은 [개편 계획](overview.md)에, 화면 설계는 [설계](design.md)에 있다.

## 1. 원칙

출처는 `docs/design/DESIGN-PRINCIPLES.md`와 `REDESIGN-BRIEF.md`다.

- **평면 디자인이다.** 그라디언트, 블러, 글로우는 쓰지 않는다. 그림자는 팝오버, 메뉴, 다이얼로그에만 쓰고 버튼과 카드는 `box-shadow: none`이다.
  - 예외 둘(2026-10-15 사용자 결정, `se-gowr`): 칸반 카드는 아래쪽 그림자(`--shadow-card`)를 쓰고, 집은 일의 제목에 흐르는 빛줄기는 그라디언트로 그린다(6절). `tests/moai-shell.test.mjs`가 이 둘 말고는 막는다.
- 영역은 1px 보더로 구분한다.
- 한 화면에 primary 버튼은 하나만 둔다.
- 긴 내용은 해당 영역 안에서 스크롤한다. body 가로 스크롤은 금지한다.
- 이모지는 쓰지 않는다. 아이콘은 lucide를 쓴다.

## 2. 테마가 패널에 오는 방식

- 패널은 `sandbox="allow-scripts"` iframe이라 앱 CSS 변수를 상속하지 못한다.
- 호스트가 주입하는 것은 **`<html data-theme="light|dark">`와 `--saycode-*` 토큰 10개뿐**이다(패널 테마 계약 v1, `src/domain/extensionPanelContract.ts:27-68`).
- 첫 렌더 때는 `buildExtensionPanelDocument()`가 head에 `<style>:root{color-scheme;--saycode-…}</style>`를 넣는다(`src/domain/extensionPanel.ts:66-83`).
- 테마가 바뀌면 MessagePort로 `{type:'saycode:theme', version:1, theme, tokens}`가 오고, 부트스트랩이 `style.setProperty`로 바꾼다(`src/domain/extensionPanelBootstrap.ts:17-27`). iframe을 다시 로드하지 않으므로 패널 상태는 유지된다.
- CSP는 `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:`다. 외부 폰트, 이미지, CSS, fetch를 모두 쓸 수 없다. **아이콘은 인라인 SVG만 쓸 수 있다.**

| 토큰 | 앱 토큰 | 라이트 | 다크 |
|---|---|---|---|
| `--saycode-bg` | `--popover` (도구 탭에서는 `--background`) | #FFFFFF | #2A2D35 (도구 탭에서는 **#13161A**) |
| `--saycode-surface` | `--card` | #FFFFFF | #22252C |
| `--saycode-text` | `--foreground` | #09090B | #FAFAFA |
| `--saycode-text-muted` | `--muted-foreground` | #52525B | #A1A1AA |
| `--saycode-border` | `--border` | #DCDCE0 | #3E424D |
| `--saycode-accent` | `--primary` | #1B64DA | #2470E4 |
| `--saycode-accent-contrast` | `--primary-foreground` | #FFFFFF | #FFFFFF |
| `--saycode-danger` | `--destructive` | #EF4444 | #EF4444 |
| `--saycode-radius` | `--radius-sm` | 10px | 10px |
| `--saycode-font` | `--font-sans` | Inter, Pretendard, system-ui … | 같음 |

Moai는 도구 탭에 열리므로 다크 배경이 #13161A이고, 카드와 입력은 한 단계 밝은 #22252C다. 구형 Desktop은 토큰을 주지 않으므로 지금 패널처럼 `--fb-*` 폴백을 둔다(`packages/moai/panel.html:2-32`). 폴백 값은 위 표의 앱 값으로 맞춘다.

## 3. 패널 토큰 매핑

패널 CSS의 `:root`에 아래처럼 정의한다. 호스트가 주지 않는 값은 `color-mix`로 파생한다.

| 패널 변수 | 값 | 앱 대응 |
|---|---|---|
| `--bg` | `var(--saycode-bg)` | `--background` |
| `--surface` | `var(--saycode-surface)` | `--card` |
| `--text` | `var(--saycode-text)` | `--foreground` |
| `--muted` | `var(--saycode-text-muted)` | `--muted-foreground` |
| `--border` | `var(--saycode-border)` | `--border` |
| `--accent` | `var(--saycode-accent)` | `--primary` |
| `--accent-contrast` | `var(--saycode-accent-contrast)` | `--primary-foreground` |
| `--danger` | `var(--saycode-danger)` | `--destructive` |
| `--radius` | `var(--saycode-radius, 10px)` | `--radius-sm` |
| `--radius-xs` | `6px` | `--radius-xs` |
| `--hover` | `color-mix(in srgb, var(--text) 8%, var(--bg))` | `--accent` (#E2E2E4 / #333740) |
| `--selected` | `color-mix(in srgb, var(--accent) 10%, var(--bg))` | `--surface-active` (식이 같음) |
| `--muted-bg` | `color-mix(in srgb, var(--text) 6%, var(--bg))` | `--muted` (#EBEBEC / #272932) |
| `--accent-hover` | `color-mix(in srgb, var(--accent) 88%, black)` | `--primary-hover` |
| `--danger-soft` | `color-mix(in srgb, var(--danger) 10%, var(--bg))` | `--danger-soft` (식이 같음) |
| `--ok` | `color-mix(in srgb, #10B981 65%, var(--text))` | `--ok` (식이 같음) |
| `--ok-soft` | `color-mix(in srgb, #10B981 12%, var(--bg))` | `--ok-soft` |
| `--warn` | 라이트 `#b9730a` / 다크 `#fbc04e` | `--warn` |
| `--warn-soft` | `color-mix(in srgb, var(--warn) 12%, var(--bg))` | `--warn-soft` |
| `--border-soft` | `color-mix(in srgb, var(--border) 65%, transparent)` | `--border-soft` |
| `--shadow-md` | 라이트 `0 2px 6px rgba(20,27,56,.07), 0 18px 40px -14px rgba(20,27,56,.20)` / 다크 `0 2px 6px rgba(0,0,0,.45), 0 20px 44px -14px rgba(0,0,0,.66)` | `--shadow-md` |
| `--lane-bg` | 라이트 `#F4F5F7` / 다크 `#1A1D22` | 없음(칸반 칸, 상세 필드, 목록 이름줄, 빈 상태 바탕) |
| `--card-bg` | 라이트 `var(--bg)` / 다크 `var(--surface)` | 없음(칸반 카드) |
| `--shadow-card` | 라이트 `0 1px 1px rgba(9,30,66,.25), 0 0 1px rgba(9,30,66,.31)` / 다크 `0 1px 1px rgba(0,0,0,.5), 0 0 1px rgba(0,0,0,.6)` | 없음 |
| `--radius-card` | `3px` | 없음 |
| `--glint-edge` / `--glint-core` | `var(--warn)` / 라이트 `#F2B01E`, 다크 `#FFE7A3` | 없음(빛줄기) |
| `--font` | `var(--saycode-font, system-ui, sans-serif)` | `--font-sans` |
| `--mono` | `"SF Mono","JetBrains Mono","Fira Code",ui-monospace,Menlo,monospace` | `--font-mono` |

- `--warn`, `--shadow-md`와 칸반·빛줄기 값은 `:root[data-theme="dark"]`와 `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`에서 다크 값으로 바꾼다.
- `--hover`와 `--muted-bg`의 파생 값은 앱 값과 조금 다르다. 정확히 맞춰야 하면 테마별 하드코딩 값을 쓴다. 다만 앱 값은 계약 밖이라 앱이 바꾸면 어긋날 수 있다. 장기적으로는 계약 v2에 hover, success, warn 토큰을 넣자고 제안한다.

## 4. 타이포·간격·기타

- 본문은 13px/1.5이고 보조 텍스트는 12px, 칩은 11px, 섹션 제목은 14~16px이다. 패널에는 큰 제목을 두지 않는다. 탭 라벨이 곧 제목이다.
- 굵기는 버튼 500, 선택된 탭 600, 상태 칩 500이다.
- 간격은 4/6/8/10/12/16/20/24px 단계로 쓴다.
- 반경은 컨트롤 10px, 탭·아이콘 버튼·메뉴 항목 6~7px, 칩 6px이다.
- 포커스는 `:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px }`다.
- disabled는 `opacity: .5`다.
- 선택 영역은 `::selection { background: var(--selected) }`다.
- 스크롤바는 6px이다. thumb은 `var(--border)`에 반경 999px이고, hover 때 `var(--muted)`다(`src/styles.css:826-845`).

## 5. 컴포넌트 규격

### 5.1 탭 바 (칸반·목록·위키)

작업 영역 도구 탭 규격(`src/styles/sessionTools.css:11,103-109`, `WorkspaceToolTabStrip.tsx`)을 따른다.

- 바는 높이 40px, `gap: 4px`, `padding: 0 8px`, 하단 `1px solid var(--border)`다.
- 탭은 높이 30px, `padding: 0 8px`, `border-radius: 7px`, 12px/500이다.
  - 글자색은 `var(--muted)`, hover와 선택 때 배경은 `var(--hover)`, 선택된 탭의 글자는 `var(--text)` 600이다.
  - 선택된 탭은 바의 아랫선 위에 2px `var(--accent)` 막대를 둔다(좌우 8px 안쪽).
  - 아이콘은 15px이다: 칸반 `kanban`, 목록 `list-tree`, 위키 `book-open`.
- 안 읽음 수 뱃지는 탭 라벨 뒤에 11px 칩으로 붙인다.
- 접근성: `role=tablist/tab`, `aria-selected`, roving tabindex(선택된 탭만 0), 좌우 화살표로 순환한다.

### 5.2 아이콘 버튼 (상세 위치 토글 등)

규격은 `sessionTools.css:264-271`이다.

- 28×28, `border: 0`, `border-radius: 6px`, 배경은 투명, 색은 `var(--muted)`, 아이콘은 16px이다.
- hover와 `aria-pressed=true` 때 `background: var(--hover); color: var(--text)`다.
- `aria-label`과 `title`이 반드시 있어야 한다. 예: "상세를 아래로", "상세를 왼쪽으로".

### 5.3 버튼

규격은 `src/styles/primitives.css:5-21`이다.

- 기본은 `min-height: 34px; padding: 0 12px; border-radius: var(--radius); font: 500 13px`다.
- 변형:

  | 변형 | 스타일 |
  |---|---|
  | primary | `var(--accent)` 배경, `var(--accent-contrast)` 글자 |
  | outline | `var(--bg)` 배경, `var(--border)` 보더, hover 때 보더를 accent 35%로 섞음 |
  | ghost | 투명 배경, `var(--muted)` 글자, hover 때 `var(--hover)` |
  | danger | `var(--danger)` 배경 |

- 작은 버튼은 `min-height: 28px; padding: 0 8px; font-size: 12px`다.

### 5.4 입력·검색창·셀렉트

규격은 `primitives.css:22-36`이다.

- 입력은 `padding: 7px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); font: 13px/1.5`다.
  - focus 때 `border-color: var(--accent)`이고 그림자는 없다.
  - placeholder는 `var(--muted)`에 `opacity: .8`이다.
  - `[aria-invalid=true]`면 `border-color: var(--danger)`다. 필터 문법 오류에 쓴다.
- 검색창은 높이 32px이고 앞에 14px 돋보기를 둔다. 오른쪽에는 범위 셀렉트와 `/` kbd 힌트를 붙인다.
- 셀렉트는 네이티브 `<select>`를 입력과 같은 스타일로 쓴다(`min-height: 34px`).
- 커스텀 메뉴와 팝오버(정렬, 보기, 열, SPC 메뉴):
  - 컨테이너: `padding: 4px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg); box-shadow: var(--shadow-md)`
  - 항목: `min-height: 32px; padding: 6px 8px; border-radius: 6px`이고 highlight 때 `var(--hover)`
  - 구분선: `1px var(--border)`

### 5.5 칩·뱃지

- 기본은 `min-height: 22px; padding: 0 8px; border-radius: 6px; font: 500 11px; border: 1px solid var(--border); background: var(--muted-bg); color: var(--muted)`다.
- 상태 칩은 `border-color: transparent`에 soft 배경과 대응 색을 쓴다(ok, warn, danger, accent).
- 필터 칩은 기본 칩에 x 버튼(12px)을 붙인다.
- `NEW` 칩은 `--warn-soft` 배경에 `--warn` 글자, 600이다.

### 5.6 목록 행

참고한 규격은 `.developer-feature-list`(`surfaces.css`)와 사이드바 파일 목록(`sessionTools.css:23-25`)이다.

- 행 높이는 24px이다(`list.css --moai-row-h`, `list.ts ROW_HEIGHT`). 앱 파일 목록에 맞춘 28px에서는 트리 가지가 행마다 끊겨 보여 줄였다(`se-gowr.4x9`). 좌우 패딩은 8px이다.
- 트리 가지는 TUI 글자(`│ ├─ └─`)를 텍스트로 두되 투명하게 하고, 단계마다 2ch 칸에 CSS 선을 행 높이 끝까지 그린다. 그래서 위아래 행의 가지가 이어진다. 선 색은 `--muted` 55%이고 `└`는 반경 4px로 꺾는다.
- hover는 `var(--hover)`, 커서 행(선택)은 `var(--selected)`에 왼쪽 2px `var(--accent)` 막대를 둔다.
- 키보드 포커스는 `outline: 2px solid var(--accent); outline-offset: -2px`다.
- id와 우선순위, 오른쪽 열은 `--mono` 12px `var(--muted)`, 제목은 13px `var(--text)`이고 넘치면 ellipsis다.
- 이름줄(열 머리)은 sticky이고 11px/500 `var(--muted)`, 바탕은 `--lane-bg`, 하단에 `1px var(--border-soft)`를 둔다.

### 5.7 칸반

처음에는 에이전트 보드(`src/styles.css:19520-19540`)를 따랐고, 2026-10-15 사용자 피드백(`se-gowr.0vl`)으로 Jira 보드에 가깝게 바꿨다.

- 보드는 패널 바탕(`--bg`) 위에 6px 안쪽 여백을 두고, 칸 사이는 4px로 좁게 둔다.
- 칸은 `--lane-bg`(라이트 `#F4F5F7`) 바탕에 반경 3px이다. 카드 사이 간격과 카드와 칸 옆선 사이 간격은 같은 6px이다.
- 칸 머리도 `--lane-bg` 바탕이고 sticky다. 글리프와 이름은 12px/600 `--muted`이고, 카드 수는 오른쪽 끝에 mono 11px로 둔다.
- 카드는 보더 없이 `background: var(--card-bg); border-radius: 3px; padding: 8px 10px; box-shadow: var(--shadow-card)`다. 그림자는 모서리를 따라 아래쪽에 진다. hover는 바탕에 `--text` 3%를 섞는다. 선택 카드는 `var(--selected)` 바탕에 안쪽 1px `var(--accent)` 테두리를 그림자에 더한다.
- 마일스톤 레인 머리는 이름 뒤에 그 레인의 카드 수를 mono 11px `--muted`로 붙인다.
- 숫자 셋(칸 최소 폭 200px, 칸 사이 4px, 보드 여백 6px)은 `board.ts`의 보드 최소 폭 계산에도 쓰므로 같이 바꾼다.

### 5.8 분할 리사이저

`chrome.css:233-235` 방식을 따른다. 1px `var(--border)` 선에 투명 히트 영역 9px을 두고, hover와 focus 때 3px `var(--accent)`로 바꾼다. 드래그하는 동안에는 `user-select: none`을 건다.

### 5.9 빈 상태·배너·툴팁·kbd

- 빈 상태는 점선 상자 대신 `background: var(--lane-bg); border-radius: 3px; color: var(--muted); padding: 24px; text-align: center`다. 아이콘 배경은 `var(--card-bg)`, 제목은 500이다.
- 배너는 `padding: 10px 12px; font-size: 12px; border-radius: 10px; background: var(--muted-bg); border: 1px solid var(--border)`다. danger 배너는 배경 `--danger-soft`에 보더를 danger 35%로 섞는다.
- 툴팁은 우선 `title` 속성을 쓴다. 커스텀 툴팁이 필요하면 `--bg` 배경, `--border` 보더, `--shadow-md` 그림자, 12px로 한다.
- `<kbd>`는 `font: 11px var(--mono); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; background: var(--muted-bg)`로 한다. 앱에 정해진 규격이 없어서 제안 값이다.

### 5.10 상세

2026-10-15 사용자 피드백("너무 밋밋하다", `se-gowr.dk5`)으로 다듬었다. 스타일은 `view/detail.ts`의 `STYLE`에 있다.

- 머리: 상태 글리프(집은 일이면 돎)와 id를 mono 12px `--muted` 한 줄로, 제목은 16px/600, 그 아래 칩. 머리 아래에 `1px var(--border-soft)` 구분선.
- 필드(`dl`)는 `--lane-bg` 바탕에 반경 3px 카드로 묶는다. 이름은 12px `--muted`.
- 섹션 제목(`h3`, 접는 `summary`)은 12px/600 `--text`이고, 오른쪽 끝까지 `--border-soft` 가는 선을 잇는다. 접는 표시는 `▸`가 열리면 90° 돈다.
- 진척 바는 8px이고 완료(`--ok`)·리뷰(`--review`)·진행 중(`--warn`)을 그 순서로 나눠 칠한다. 아래에 같은 색 점의 범례를 둔다.
- 커밋 해시와 하위 일·막는 일의 id는 `--muted-bg` 알약(mono 11px)으로, 글은 그 옆에서 줄바꿈한다.
- 기록은 타임라인이다. 왼쪽 세로선 위에 항목마다 점을 찍고, 점 색은 만듦 `--ok`, 칸 이동 `--accent`, 메모 `--warn`이다. 누가·언제는 그 아래 11px.

## 6. moai 의미 색의 대응

TUI의 터미널 색(`moa-issue/src/style.rs:19-27`)을 세이코드 토큰에 대응시킨다.

| 의미 | TUI | 패널 |
|---|---|---|
| todo `·` | 기본 | `var(--muted)` |
| in_progress `▸` | 밝은 노랑 굵게 | `var(--warn)` 600 |
| review `?` | 밝은 자홍 | `color-mix(in srgb, #a855f7 70%, var(--text))` |
| done `✓` | 초록 흐림 | `var(--ok)` |
| 기타 칸 `○` | 청록 | `var(--accent)` |
| p0 | 밝은 빨강 굵게 | `var(--danger)` 700 |
| p1 | 빨강 | `var(--danger)` |
| p2 | 기본 | `var(--text)` |
| p3 | 흐림 | `var(--muted)` |
| 에픽 이름 | 밝은 파랑 흐림 | `color-mix(in srgb, var(--accent) 70%, var(--muted))` |
| 태그 `#tag` | 청록 | 칩 (`--muted-bg`) |
| 검색 매치 | 반전 | `<mark>` 배경 `var(--warn-soft)` |
| 숨김에서 드러난 행 | 흐림 | `opacity: .6`과 "숨김" 칩 |

- 글리프(`· ▸ ? ✓ ○`)는 TUI와 같은 글자를 쓴다. 색만으로 상태를 전하지 않기 위해서다.
- 집은 일은 TUI처럼 움직인다(`se-gowr.oie`, `view/spin.ts`, `components.css`). 도는 줄은 TUI 규칙(`tui::App::spins`)을 따라, in_progress인 일과 그런 일을 품은 묶음이고 미룬 것은 돌지 않는다. 목록, 칸반 카드, 칸반 칸 머리, 상세 머리에 같이 쓴다.
  - 글리프: `▸`를 DOM에 둔 채 위에 점자 스피너(`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`)를 120ms마다 바꿔 그린다(`content` 키프레임).
  - 제목 빛줄기: 노랑 띠(가장자리 `--glint-edge`, 가운데 `--glint-core`, 폭 3ch)가 제목 위를 왼쪽에서 오른쪽으로 흐르고, 끝을 지나 8칸 쉰 뒤 다시 들어온다. 속도는 TUI처럼 한 칸에 120ms이고, 제목마다 `(칸 수 + 3 + 8) × 120ms`를 `--glint-time`으로 준다(한글은 두 칸). `background-clip: text`로 그린다. 검색 하이라이트(`mark`)는 띠를 건너뛴다.
  - `prefers-reduced-motion: reduce`면 둘 다 멈춘다. `▸`와 제 색의 제목이 보인다.

## 7. 아이콘

- 앱은 lucide-react ^0.468.0을 쓴다. 기본 크기는 16px이고 밀집 UI에서는 14px이다. 메뉴 항목과 탭은 15px, 닫기 X는 13px이다.
- 패널은 lucide SVG path를 인라인으로 복사해서 `stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"`로 쓴다. 쓰는 아이콘만 `icons.ts`에 모은다.
- 쓸 아이콘:

  | 용도 | 아이콘 |
  |---|---|
  | 탭 | `kanban`, `list-tree`, `book-open` |
  | 상세 위치 | `panel-left`, `panel-bottom` |
  | 툴바 | `search`, `filter`, `arrow-up-down`, `eye`, `columns-3`, `refresh-cw`, `circle-help` |
  | 목록과 기타 | `chevron-right`, `x`, `folder`, `corner-left-up` |

- 도구 탭의 아이콘은 호스트가 정한다. 지금은 `Blocks`로 고정되어 있다(`useExtensionToolTabs.tsx`). 패널 쪽에서는 바꿀 수 없다.
