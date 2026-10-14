# 상류 요청서: Happy 데몬 카탈로그와 moai CLI

Moai 확장 2.0(`packages/moai`, `milestone/se-9inv`)이 돌려면 이 저장소 밖에서 두 가지가 먼저 있어야 한다. 이 페이지는 그 두 곳에 건넬 요청을 한 곳에 모은다. 개편 전체 계획은 [개편 계획](overview.md)에 있다.

- **1절 — Happy 데몬(happy-cli) 담당에게**: 카탈로그에 프로필 7개를 더한다. 선언은 `extension.json`과 글자 그대로 같아야 한다.
- **2절 — moai CLI(`moa-issue`) 담당에게**: 확장이 기대하는 상류 개선 목록과, 없을 때 패널이 하는 일. 8번(`read --seen`)을 빼고 moai 0.17.0에 들어왔다.
- **3절 — 릴리스 순서**.

작성일 2026-10-14. 선언의 출처는 `milestone/se-9inv`의 `packages/moai/extension.json`(확장 2.0.0, `apiVersion 3`)이다. 추적 이슈는 `se-0g4a.anz`(데몬), `se-0g4a.l89`(moai unread), `se-a5wl`(`read --seen`).

> **상태.** 아래 가정은 2026-10-14 사람 결정으로 "구현된 것으로 가정하고 진행"한 것이다(`se-0g4a` 노트). 같은 날 moai **0.17.0**이 설치되어 2절은 8번(`read --seen`, `se-a5wl`)을 빼고 모두 **확인됨**이다. 4번 파생값 둘은 이름이 달랐고 패널이 실제 이름을 읽도록 고쳤다(`se-ydco`). 1절 데몬 카탈로그는 happy-cli 쪽이라 아직 **대기**다(`se-0g4a.anz`). 남은 확인은 [개편 계획 3.1절](overview.md#31-구현-시점의-가정과-남은-실기-확인-2026-10-14)의 실기 목록이 맡는다.

## 1. Happy 데몬 카탈로그

### 1.0 요약

확장 2.0은 `buzzni.moai.*` 프로필 13개를 선언한다. 설치된 데몬(`happy-cli 1.1.10-aplus.320`)의 카탈로그에 이미 있는 것은 6개이고 **7개가 없다.**

| 구분 | 프로필 |
|---|---|
| 데몬에 이미 있음 (6) | `status`, `prime`, `show`, `add`, `wiki-ls`, `wiki-show` |
| **더할 것 (7)** | `show-all`, `backlog-all`, `show-archived`, `show-archived-after`, `read`, `read-all`, `read-group` |

데몬은 확장이 선언한 `machineCommands`의 해시가 자기 카탈로그의 다이제스트와 같을 때만 프로필을 실행한다(`packages/moai/README.md`, [현황 2절](current-state.md)). 그래서 카탈로그가 아래 선언과 **한 글자라도 다르면** 그 프로필은 `unsupported-daemon`으로 거부된다.

### 1.1 더할 프로필 7개 — 선언 그대로

공통 필드는 모두 같다: `executable: moai`, `cwd: workspaceRoot`, `envAllowlist: [HOME]`, `timeoutMs: 120000`, `outputLimitBytes: 1048576`, `stdin: none`, `descendantAllowlist: [git]`. 이 일곱 개에는 `writeScope`가 하나도 없다. 아래 JSON은 `extension.json`에서 기계적으로 뽑은 것이므로 키 순서·값까지 그대로 옮기면 된다. 사람이 옮기다 틀리는 것을 피하려면 파일에서 직접 복사한다.

#### 1.1.1 `buzzni.moai.show-all`

- 실행: `show --all`
- 용도: 활성 행 전체(done·deferred 포함, 아카이브 제외)를 한 번에 읽는다. 클라이언트가 트리·필터·정렬을 계산하는 2.0 데이터 계층의 바탕이다.
- 쓰기 범위: 읽기 전용. `writeScope`가 없다. 트래커를 바꾸지 않으므로 쓰기 범위 락도 필요 없다.

```json
{
  "id": "buzzni.moai.show-all",
  "executable": "moai",
  "argv": [
    "--json",
    "-C",
    "{{workspaceRoot}}",
    "show",
    "--all"
  ],
  "parameters": {},
  "cwd": "workspaceRoot",
  "envAllowlist": [
    "HOME"
  ],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": [
    "git"
  ]
}
```

#### 1.1.2 `buzzni.moai.backlog-all`

- 실행: `backlog show --all`
- 용도: backlog 행을 done·deferred까지 읽는다.
- 쓰기 범위: 읽기 전용, `writeScope` 없음. **이름 충돌**: 데몬의 `buzzni.moai.backlog`는 이미 `backlog add {{title}}`(쓰기)이므로 읽기 프로필은 `backlog-all`이라는 별도 id를 쓴다. 아래 1.2절.

```json
{
  "id": "buzzni.moai.backlog-all",
  "executable": "moai",
  "argv": [
    "--json",
    "-C",
    "{{workspaceRoot}}",
    "backlog",
    "show",
    "--all"
  ],
  "parameters": {},
  "cwd": "workspaceRoot",
  "envAllowlist": [
    "HOME"
  ],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": [
    "git"
  ]
}
```

#### 1.1.3 `buzzni.moai.show-archived`

- 실행: `show --archived -n 200 --sort id`
- 용도: 아카이브 첫 쪽. 큰 저장소의 `show --archived --json`은 1 MiB 한도를 넘어(moa-issue 2.35 MB) 쪽으로 나눠 읽는다.
- 쓰기 범위: 읽기 전용, `writeScope` 없음. `--after`가 빈 값을 받지 않아 첫 쪽은 파라미터 없는 별도 프로필이다.

```json
{
  "id": "buzzni.moai.show-archived",
  "executable": "moai",
  "argv": [
    "--json",
    "-C",
    "{{workspaceRoot}}",
    "show",
    "--archived",
    "-n",
    "200",
    "--sort",
    "id"
  ],
  "parameters": {},
  "cwd": "workspaceRoot",
  "envAllowlist": [
    "HOME"
  ],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": [
    "git"
  ]
}
```

#### 1.1.4 `buzzni.moai.show-archived-after`

- 실행: `show --archived -n 200 --sort id --after {{after}}`
- 용도: 아카이브의 다음 쪽. 직전 쪽의 마지막 id를 `after`로 준다.
- 쓰기 범위: 읽기 전용, `writeScope` 없음. `after`는 행 id라서 `maxLength 128`.

```json
{
  "id": "buzzni.moai.show-archived-after",
  "executable": "moai",
  "argv": [
    "--json",
    "-C",
    "{{workspaceRoot}}",
    "show",
    "--archived",
    "-n",
    "200",
    "--sort",
    "id",
    "--after",
    "{{after}}"
  ],
  "parameters": {
    "after": {
      "type": "string",
      "maxLength": 128
    }
  },
  "cwd": "workspaceRoot",
  "envAllowlist": [
    "HOME"
  ],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": [
    "git"
  ]
}
```

#### 1.1.5 `buzzni.moai.read`

- 실행: `read {{id}}`
- 용도: 한 행을 읽음 처리한다 (`~/.config/moai/read/*.toml`에 기록).
- 쓰기 범위: **읽음 표시를 쓰는 프로필이지만 `writeScope`를 선언하지 않았다.** 쓰는 곳이 트래커(`.moai/`)가 아니라 사용자 개인 설정(`~/.config/moai/read/`)이라 `moai` 쓰기 범위로 보지 않은 선택이다(설계상의 판단이며 데몬이 어떻게 보는지는 확인되지 않았다). 데몬이 `writeScope`를 요구하면 선언을 바꾸고 다이제스트도 같이 바뀐다.

```json
{
  "id": "buzzni.moai.read",
  "executable": "moai",
  "argv": [
    "--json",
    "-C",
    "{{workspaceRoot}}",
    "read",
    "{{id}}"
  ],
  "parameters": {
    "id": {
      "type": "string",
      "maxLength": 128
    }
  },
  "cwd": "workspaceRoot",
  "envAllowlist": [
    "HOME"
  ],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": [
    "git"
  ]
}
```

#### 1.1.6 `buzzni.moai.read-all`

- 실행: `read --all`
- 용도: 현재 안 읽은 행 전부를 읽음 처리한다 (TUI의 `SPC m a`).
- 쓰기 범위: 위 `read`와 같다: 개인 설정만 바꾸므로 `writeScope` 없음.

```json
{
  "id": "buzzni.moai.read-all",
  "executable": "moai",
  "argv": [
    "--json",
    "-C",
    "{{workspaceRoot}}",
    "read",
    "--all"
  ],
  "parameters": {},
  "cwd": "workspaceRoot",
  "envAllowlist": [
    "HOME"
  ],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": [
    "git"
  ]
}
```

#### 1.1.7 `buzzni.moai.read-group`

- 실행: `read -e {{group}}`
- 용도: 에픽·마일스톤 한 그룹의 행을 읽음 처리한다 (TUI의 `SPC m g`).
- 쓰기 범위: 위 `read`와 같다. `group`은 id라서 `maxLength 128`.

```json
{
  "id": "buzzni.moai.read-group",
  "executable": "moai",
  "argv": [
    "--json",
    "-C",
    "{{workspaceRoot}}",
    "read",
    "-e",
    "{{group}}"
  ],
  "parameters": {
    "group": {
      "type": "string",
      "maxLength": 128
    }
  },
  "cwd": "workspaceRoot",
  "envAllowlist": [
    "HOME"
  ],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": [
    "git"
  ]
}
```

### 1.2 이름 충돌: `backlog`와 `backlog-all`

데몬의 카탈로그에는 이미 `buzzni.moai.backlog`가 있고 그 선언은 `backlog add {{title}}`, 곧 **쓰기**다. 패널이 backlog를 읽으려고 같은 id를 쓰면 쓰기 프로필이 읽기로 쓰이거나 다이제스트가 어긋난다. 그래서 읽기는 `buzzni.moai.backlog-all`(`backlog show --all`)이라는 별도 id로 선언했다.

데몬 쪽 요청: 기존 `backlog`는 건드리지 않고 `backlog-all`을 **따로** 더한다. 이름을 바꾸자는 제안이 있으면 `extension.json`과 패널 `PROFILE.backlog`(`panel/data/source.ts`)를 같이 바꿔야 하므로 먼저 알려 달라.

### 1.3 `wiki-show`의 slug `maxLength`는 128

`wiki-ls`와 `wiki-show`는 데몬에 이미 있고 확장의 선언이 그 선언과 같다고 가정한다. 다만 `wiki-show`의 `slug`는 `maxLength`가 데몬과 같은 **128**이어야 한다(`se-0g4a.anz` 노트). 값이 다르면 선언이 달라져 다이제스트가 어긋난다. 확장 선언은 이렇다.

```json
{
  "id": "buzzni.moai.wiki-show",
  "executable": "moai",
  "argv": [
    "--json",
    "-C",
    "{{workspaceRoot}}",
    "wiki",
    "show",
    "{{slug}}"
  ],
  "parameters": {
    "slug": {
      "type": "string",
      "maxLength": 128
    }
  },
  "cwd": "workspaceRoot",
  "envAllowlist": [
    "HOME"
  ],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": [
    "git"
  ]
}
```

### 1.4 다이제스트가 맞아야 한다는 규칙

- 데몬은 **선언 전체**(argv, parameters, cwd, envAllowlist, timeoutMs, outputLimitBytes, stdin, writeScope, descendantAllowlist)의 해시를 카탈로그와 견준다. 한 필드만 달라도 거부된다.
- 확장은 카탈로그를 모르고 선언만 한다. 그래서 카탈로그를 이 문서가 아니라 **`extension.json`에 맞춘다**. 이 문서와 `extension.json`이 다르면 `extension.json`이 맞다.
- 확장의 테스트가 `init|tui|wake|hooks|editor|shell` 서브커맨드 프로필을 금지한다(`tests/moai.test.mjs`). 카탈로그에 그런 것을 더하자는 요청이 아니다.
- 거부는 패널에서 배너로 보인다(`compat.ts`): 프로필 하나만 거부되면 "데몬 카탈로그를 업데이트하라"와 함께 해당 기능만 꺼진다. 기준선 프로필(`status`, `prime`, …)까지 거부되면 데몬 전체가 낡은 것으로 읽는다.

### 1.5 확인 방법 (데몬 쪽)

1. 카탈로그에 7개를 더한 뒤, 설치된 데몬에서 프로필 id 13개가 모두 있는지 본다.
2. 확장 2.0을 올린 작업 영역에서 패널을 열어 호환성 배너가 사라지는지 본다.
3. 읽기 프로필끼리 `workspace-busy`가 나는지 본다. SDK 쪽 코드로는 쓰기 범위 락이라 읽기끼리는 안 날 것으로 읽히지만 라이브로 본 적이 없다(`se-0g4a.anz`, `se-0g4a.fjl`).

## 2. moai CLI 상류

패널은 아래 개선이 `moai`에 **이미 있다고 가정하고** 짰고, moai **0.17.0**에서 1~7번이 확인됐다(2026-10-14 실측, `se-0g4a` 노트). 8번은 0.17.0에도 없다. 옛 moai에서도 패널이 죽지는 않는다. 아래 표의 "없으면"이 `compat.ts`·`source.ts`·`index.ts`가 하는 일이다.

| # | 개선 | 패널이 기대하는 모양 | 없으면 (패널의 대체 동작) |
|---|---|---|---|
| 1 | `show --json`의 **`unread`** | 행과 `show <id>`에 `"unread": true`. 안 읽음이 아니면 키가 없고, 사람을 모르면 어디에도 없다. 판정(내게 온 것·내 에픽의 멤버·마일스톤 제외·`updated_at > seen`)은 CLI 한 곳에서 한다. 구현은 moa-issue `moai-cqwy`. **0.17.0 확인됨** | NEW 칩과 탭 뱃지가 꺼진다. 오류는 아니고, 이제 NEW를 그리므로 호환 배너가 "Upgrade moai (NEW marks)"로 말한다(`se-hd7v`: 배너는 패널이 쓰는 기능만 말한다). 키가 없는 것만으로는 "낡음"이 아니라 "모름"으로 읽는다 |
| 2 | `status --json`의 **`statuses[]`** (설정 순서) | `statuses: string[]`, `.moai/config.toml` 순서. **0.17.0 확인됨** | `counts` 키를 기본 순서(`todo, in_progress, review, done`)에 맞추고 모르는 칸은 뒤에 붙인다. 설정 순서를 잃는다. 배너는 없다(`se-hd7v`) |
| 3 | **설정 읽기 JSON** | 칸 이름·`archive_days` 같은 값을 JSON으로. **0.17.0 확인됨**(`config --json`). 패널은 아직 읽지 않는다(선언한 프로필에 없음) | 코드의 기본값(`archive_days = 14`, 칸 4개) |
| 4 | 파생값 **`derived_milestone`·`shelved_by`·`archived`** (요청 때 이름은 `derived_deferred`·`archive_candidate`) | **0.17.0 확인됨, 이름이 다름.** 행에 `derived_milestone`(문자열), `shelved_by`(행을 계획에서 뺀 가장 가까운 행의 id, 스스로 미뤘으면 자기 id), `archived`(`show --all`이 아카이브로 숨기는 행에 `true`). 셋 다 해당할 때만 키가 있고 `false`·`null`은 나오지 않는다 | `nav.rs` 규칙을 이식한 인덱스가 클라이언트에서 직접 계산한다. 있으면 그 값이 이긴다 |
| 5 | **`--fields`** | 목록에서 본문을 뺀 출력 | 아카이브는 쪽 나누기와 잘림 배너로 버틴다. 실측상 필수는 아니다. (**0.17.0 확인됨**, `show --fields`) |
| 6 | **안정 페이징** | `show --archived -n 200 --sort id --after <id>`가 쪽 사이에서 같은 순서를 낸다. **0.17.0 확인됨** | 쪽 나누기가 안 되고 아카이브는 큰 저장소에서 읽지 못한다(`archive` 기능이 꺼짐) |
| 7 | `status --json`의 **`milestones[]`·`epics[]` 집계** | `{id, done, total}` 목록. 아카이브된 행까지 센 값. **0.17.0 확인됨** | 보드의 n/n이 `show --all`이 가진 행만 센 값이 되어 `moai status`와 어긋난다. `tallies`가 `degraded` |
| 8 | **`read <id> --seen <updated_at>`** (backlog `se-a5wl`) | **0.17.0에 없음.** 화면에 그린 행의 `updated_at`을 값으로 받는다. `read --json` 결과에도 행별 `updated_at`이 있으면 좋다 | 지금 `moai read`는 값 없이 행의 **현재** `updated_at`을 쓴다. 그린 뒤 바뀐 행이 새 판으로 읽음 처리될 수 있고, 패널은 다시 읽은 뒤 바뀜만 알린다(`staleAgainst`, `panel/data/read.ts`). 이 항목은 **2.0 릴리스 없이 갈 수 있다** |

### 2.1 판별 방식

패널은 버전 문자열이 아니라 **모양**으로 낡은 moai를 알아본다(`compat.ts`).

- `status --json`에 `statuses[]`나 `milestones[]`/`epics[]`가 없으면 낡은 moai(0.16)로 읽는다. 배너는 패널이 쓰는 기능이 없을 때만 "moai를 올리라"고 말하고, 0.16의 `status`는 배너를 받지 않는다(`se-hd7v`).
- `unread` 키만 없는 것은 약한 증거라서 "알 수 없음"으로만 둔다.
- `moai`가 데몬 쪽에 설치되지 않았으면(`tool-missing`) 따로 알린다.

### 2.2 우선순위

| 구분 | 항목 |
|---|---|
| 없으면 기능이 꺼짐 | 1(NEW 칩·뱃지), 6(아카이브) |
| 없으면 값이 어긋나거나 순서를 잃음 | 2, 7 |
| 없어도 같은 결과를 클라이언트가 낸다 | 3, 4, 5 |
| 릴리스와 따로 | 8 |

## 3. 릴리스 순서

```
moai 상류 릴리스 ─┐
                  ├─> Moai 확장 2.0.0
데몬 카탈로그 갱신 ─┘
```

1. **moai 상류 릴리스** — 2절 1~7번이 들어간 `moai`. **0.17.0으로 나왔다**(2026-10-14 설치·실측).
2. **데몬 카탈로그 갱신** — 1절의 7개 프로필. 1번과 순서는 상관없지만 둘 다 3번보다 먼저다.
3. **확장 2.0.0** — 위 둘이 나온 뒤에 내보낸다. 확장과 moai는 버전 번호가 따로이고 확장의 `README` 호환성 표가 "moai 0.17.0 이상"으로 적혀 있다.
4. 2절 8번(`read --seen`)은 위와 상관없이 언제든 들어갈 수 있다.

### 3.1 "moai 0.17.0" 번호 (확정)

- 처음에는 `0.17.0`이 자리표시자였고, 상류가 같은 번호로 릴리스해 확정됐다(2026-10-14). 확장 `README.md` 호환성 표, `compat.ts` 헤더, 이 문서 2절과 3절에서 "가정" 표시를 걷었다(`se-ydco`).
- 확장 코드는 번호를 비교하지 않고 모양만 본다(2.1절). 0.17.0의 `status --json`(`statuses[]`와 집계)은 `moai: ok`로 읽힌다(`tests/moai-compat.test.mjs`, 실제 출력 픽스처 `tests/fixtures/moai/*-v017.json`).
- 8번(`read --seen`)은 0.17.0에 들어오지 않았다. 들어오면 표의 그 줄과 [개편 계획 3.1절](overview.md#31-구현-시점의-가정과-남은-실기-확인-2026-10-14)을 고친다.

## 4. SDK·Desktop 설정 저장 API (`se-dnas`)

패널이 설정을 Desktop을 다시 켜도 남기려면 SDK와 Desktop에 저장 API가 있어야 한다. 사람이 정했다(2026-10-14): 패널 localStorage는 불가능하고(`se-vpav`) SDK에 요청한다. 이 절은 **요청서**이고, 이 저장소의 코드는 바꾸지 않는다. 표기: **[읽음]**은 코드에서 직접 읽은 것(`aplus-dev-studio-desktop` 9086c62ed, 읽기 전용), **[추정]**은 읽은 것에서 이끌어 낸 제안이다.

### 4.1 왜 필요한가 — 지금 상태 [읽음]

| 사실 | 근거 |
|---|---|
| 패널 iframe은 `sandbox="allow-scripts"`뿐이라 opaque origin이다. localStorage는 SecurityError이고 다시 열면 비어 있다 | `src/components/extensions/useExtensionPanelFrame.tsx:122`, 조사 `se-vpav` |
| CSP가 `connect-src 'none'`이라 패널이 스스로 어디에도 쓸 수 없다 | `src/domain/extensionPanel.ts:67`(`EXTENSION_PANEL_CSP`) |
| 패널이 호스트에 부를 수 있는 것은 `invokeCommand(commandId, args)` 하나다. 요청은 키 `args,commandId,kind,requestId`만 허용하고 64 KiB를 넘지 못한다 | `src/domain/extensionPanel.ts:41-67`, `extensionPanelBootstrap.ts:8,33-37` |
| 호스트→패널 포트는 테마만 싣는다 | `extensionPanelPort.ts:66-78` |
| `storage.read`·`storage.write`는 권한 이름으로 **선언만 있다**. 처리기가 없어 브로커가 `CAPABILITY_UNAVAILABLE`을 던진다 | `src/domain/extensionManifest.ts:31-32`, `electron/extensions/capabilityBroker.ts:46-50`, 이 저장소 `packages/sdk/src/manifest.ts:5` |
| 확장 코드(`index.js`)는 `context.invokeCapability(permission, action, args)`로 권한 기능을 부른다. 지금 쓰는 것은 `machine.run`의 `start`·`status` 등이다 | `packages/sdk/src/index.ts:71,122` |
| 호스트는 확장마다 `CapabilityBroker`를 만들고 `handlers` 표에 권한별 처리기를 등록한다. 선언(`declaredPermissions`)과 사용자 승인(`approvedPermissions`)을 둘 다 본다 | `electron/main.ts:1764-1786` |

그래서 지금 패널은 `data/memory.ts`가 **세션 메모리**에 두고(`createMemory`의 localStorage getter가 던지면 메모리로 떨어진다), 다시 열면 기본값이다.

### 4.2 패널이 저장하려는 것과 크기

| 항목 | 값 | 현재(2.0.x) | 크기 |
|---|---|---|---|
| 마지막 탭 | `board`·`list`·`wiki` | 키 `buzzni.moai.panel`(`MEMORY_KEY`), 세션만 | 수십 B |
| 상세 표시·위치·위치별 비율 | `visible`, `position`, `ratio.left`·`ratio.bottom` | 같은 키, 세션만 | 수십 B |
| 정렬 | 키 목록(최대 몇 개)과 방향 | 세션만(`se-cv7w.lca`, 영속은 `se-c9mu`) | 수백 B |
| 필터 | `key=value` 문법 문자열 | 세션만(`se-cv7w.lca`) | 수백 B |
| 열 | 켠 열 id 목록 | 세션만(`se-cv7w.lca`) | 수백 B |
| 보이기 토글 | 칸별 숨김, 미룸·backlog·아카이브 표시, 상세·원문 | 세션만(`se-cv7w.lca`) | 수십 B |
| **기본 정렬**(`se-5air`) | 정렬 편집기 `D`가 저장하는 값 | 세션만(`se-5air`) | 수백 B |

`se-5air`·`se-cv7w.lca`는 세션 수준에서 닫혔다. 영속 저장은 SDK API를 기다리는 `se-c9mu`다. 현재 이음새(`SettingsStorage`)는 동기식이고 범위가 없어, 요청한 API(4.3절, 비동기·workspace/global)에 붙일 때 호출부가 바뀐다.

합계는 **4 KiB 아래**로 본다 **[추정]**. 값은 JSON 한 덩어리(`{version, tab, detail, sort, filter, columns, view, defaultSort}`)이고 `version`으로 옛 모양을 올린다(`MEMORY_VERSION`, `normalizeMemory`가 모르는 키·틀린 값을 기본값으로 바꾼다 — 이 점은 저장소가 어떻게 바뀌어도 그대로다). 세션 한정이 맞는 것(검색어·커서·접힘)은 저장하지 않는다.

### 4.3 제안 API

#### 권한

`storage.read`, `storage.write`를 **그대로** 쓴다(새 이름 없음). 매니페스트의 `permissions`에 선언하고 사용자가 승인한다. 승인 대화 문구는 "이 확장이 자기 설정을 이 기기에 저장"이면 된다 **[추정]**.

#### 확장 쪽 액션 (`context.invokeCapability`)

| 권한 | 액션 | args | 결과 |
|---|---|---|---|
| `storage.read` | `get` | `{ scope, key }` | `{ found: boolean, value?: JsonValue, rev: number }` |
| `storage.read` | `list` | `{ scope, prefix?: string }` | `{ keys: string[] }` |
| `storage.write` | `set` | `{ scope, key, value: JsonValue, ifRev?: number }` | `{ rev: number }` |
| `storage.write` | `delete` | `{ scope, key }` | `{ deleted: boolean }` |

- `scope`는 `"workspace"`(이 확장 × **이 작업 폴더**) 또는 `"global"`(이 확장 × 모든 작업 폴더). 패널은 탭·레이아웃을 `global`에, 정렬·필터·열·기본 정렬을 `workspace`에 둔다 **[추정]**: 사람이 프로젝트마다 다른 정렬을 쓰고, 레이아웃은 기기 취향이다.
- `key`: `^[a-z0-9][a-z0-9._-]{0,63}$`. `value`: JSON, 직렬화 **16 KiB 이하**. 요청 전체는 패널 메시지 한도 64 KiB 안에 있다 **[읽음]** (`MAX_EXTENSION_PANEL_MESSAGE_BYTES`).
- `ifRev`는 선택이다. 같은 작업 폴더를 두 창이 열었을 때 마지막 쓴 쪽이 이긴다는 것을 알리려는 것이고, 패널은 처음에는 쓰지 않고 `rev`만 읽는다 **[추정]**.
- 값은 **JsonValue**여서 `assertSafeExtensionDto`를 그대로 지난다 **[읽음]** (`capabilityBroker.invoke`가 이미 거친다).

#### 패널에서 어떻게 닿는가 — 두 길

1. **명령 경유(권장, 호스트 변경 최소)**: 확장이 `storage-get`·`storage-set`·`storage-delete` 명령을 `context.commands.register`로 등록하고 안에서 `invokeCapability('storage.read'|'storage.write', …)`를 부른다. 패널은 지금 쓰는 `invokeCommand`만 쓴다. **패널 계약과 CSP는 바뀌지 않는다.** 권한 검사·승인은 브로커가 한다 **[읽음]**. 대가: 확장 `index.js`에 얇은 명령 세 개가 늘고, 호스트 스레드를 한 번 더 거친다.
2. **패널 직접(선택)**: `window.saycodePanel.storage.get/set/delete/list`를 부트스트랩(`extensionPanelBootstrap.ts`)이 내놓고 내부에서 `invokeCommand`와 같은 포트 메시지(`kind: 'storage'`)로 호스트에 보낸다. 패널이 승인 없이 쓰지 못하도록 호스트가 같은 `CapabilityBroker`를 지나가게 해야 한다 **[추정]**. `parseExtensionPanelCommandRequest`의 키 목록 검사가 새 `kind`를 막으므로 파서 확장이 따른다 **[읽음]**.

moai는 **1번**으로 시작한다. 2번은 이 요청의 필수 조건이 아니다.

#### 쓰는 때

패널은 설정이 바뀔 때마다 `store.subscribe`로 알지만(`remember()`), **300~500 ms 디바운스**하고 값이 이전과 같으면 쓰지 않는다 **[추정]**. 닫힐 때(`pagehide`)는 보장하지 않는다 — 샌드박스 프레임의 비동기 호출은 신뢰할 수 없다. 읽기는 패널이 뜰 때 한 번이고, 응답이 오기 전에는 기본값으로 그리고 도착하면 `restore`한다(깜박임 허용). 응답이 오기 전에 사람이 바꾼 설정은 읽은 값이 덮지 않는다 **[추정]**.

#### 한도와 오류

| 코드 | 언제 |
|---|---|
| `PERMISSION_NOT_DECLARED`, `PERMISSION_NOT_APPROVED` | 브로커가 이미 던지는 것 **[읽음]** |
| `CAPABILITY_UNAVAILABLE` | 처리기가 없는 옛 Desktop **[읽음]** — 패널은 세션 폴백으로 간다 |
| `STORAGE_QUOTA` | 확장당 합계 한도 초과(제안: **256 KiB**, 키 **128개**) **[추정]** |
| `STORAGE_VALUE_TOO_LARGE` | 값 16 KiB 초과 **[추정]** |
| `STORAGE_KEY_INVALID` | 키 패턴 위반 **[추정]** |
| `STORAGE_CONFLICT` | `ifRev` 불일치 **[추정]** |
| `STORAGE_UNAVAILABLE` | 디스크를 못 쓴다 **[추정]** |

오류 코드는 `machine.run`이 쓰는 방식을 따라 `error.code`로 낸다(`refusalCode`, `packages/sdk/src/index.ts:111-120` **[읽음]**). SDK에는 `machineRun`처럼 얇은 `storageGet/Set/Delete/List(context, …)`와 코드 목록(`STORAGE_ERROR_CODES`)을 더하자는 것이 제안이다 **[추정]**.

#### 프라이버시

- 값은 **이 기기에만** 둔다. 계정·원격 카탈로그·동기화로 올리지 않는다. 올리려면 별도 권한과 사용자 표시가 있어야 한다.
- 다른 확장은 읽을 수 없다(확장 id가 키 공간의 일부다). 확장을 지우면 값도 지운다.
- 값에는 비밀·토큰을 넣지 않는다고 확장이 약속한다. moai 패널은 정렬·필터·레이아웃만 저장한다.

### 4.4 Desktop에서 닿을 곳 **[읽음 + 추정]**

| 일 | 곳 |
|---|---|
| 처리기 등록: `handlers` 표에 `'storage.read'`·`'storage.write'`를 `extensionManifest.id`에 묶어 더한다 | `electron/main.ts:1764-1786`(다른 처리기가 있는 같은 블록) |
| 처리기 구현 · 저장 파일 | 새 `electron/extensions/extensionStorageService.ts` 같은 모듈 **[추정]**. 기존 `extensionStore.ts`·`extensionRevocationStore.ts`가 있는 곳 옆. 작업 폴더 범위는 `projects`/scope 정보를 처리기에 묶어야 한다(이 저장소 조사에서는 확인하지 못함) |
| 승인 문구·권한 목록 | `src/domain/extensionManifest.ts:31-32`(이름은 이미 있다), 승인 UI와 i18n(`en/ko/ja/zh`) |
| 1번 길을 쓰면 | 패널 계약 변경 없음 |
| 2번 길을 쓰면 | `src/domain/extensionPanel.ts:41-67`(요청 키 목록), `extensionPanelBootstrap.ts`, `extensionPanelPort.ts` |
| 채널 게이트웨이 | `electron/channelGateway/gatewayRuntime.ts:206`에서도 같은 `CapabilityBroker`를 만들므로 처리기를 공유하려면 `capabilityHandlersFor`에 같은 표가 있는지 확인해야 한다 |
| `apiVersion` | 새 SDK 액션을 쓰면 확장 `apiVersion`을 올려야 하는지는 Desktop 규칙(ADR-049, 최소 2·현재 4)에 달렸다. moai는 지금 3이다 |

### 4.5 받기 전까지 패널이 하는 것 (폴백)

- 지금 그대로 둔다: `createMemory`의 세션 메모리. `storage-*` 명령이 `CAPABILITY_UNAVAILABLE`·권한 거부로 돌아오면 같은 폴백으로 내려가고, 배너는 따로 말하지 않는다(설정이 안 남는 것은 오류가 아니다).
- 패널은 응답으로 기능을 판별한다: 읽기 성공 → 영속, 실패 → 세션. 버전 번호를 비교하지 않는다(2.1절과 같은 원칙).
- `se-cv7w.lca`(검색·필터·정렬·열·보기 영속화)와 `se-5air`(기본 정렬)는 이 API를 기다린다. 그 전에는 세션 한정이다.

### 4.6 SDK·Desktop 담당에게 붙여 줄 짧은 요청

> **요청: 확장용 설정 저장 API (`storage.read` / `storage.write` 처리기)**
>
> moai 패널은 마지막 탭·상세 위치·분할 비율·정렬·필터·열·보기 토글을 Desktop을 다시 켜도 남기고 싶습니다. 패널 iframe은 `sandbox="allow-scripts"`라 localStorage를 못 쓰고 CSP가 `connect-src 'none'`이라, 확장 호스트를 거치는 길밖에 없습니다.
>
> 매니페스트에 이름(`storage.read`, `storage.write`)은 이미 있지만 `electron/main.ts`의 `CapabilityBroker.handlers`에 처리기가 없어 `CAPABILITY_UNAVAILABLE`이 납니다. 다음을 부탁합니다.
>
> - `storage.read`: `get {scope,key}`, `list {scope,prefix?}` / `storage.write`: `set {scope,key,value,ifRev?}`, `delete {scope,key}`.
> - `scope`는 `workspace`(확장×작업 폴더)와 `global`(확장×모든 폴더). 값은 JSON, 16 KiB 이하. 확장당 256 KiB·128키.
> - 오류는 `error.code`: `STORAGE_QUOTA`, `STORAGE_VALUE_TOO_LARGE`, `STORAGE_KEY_INVALID`, `STORAGE_CONFLICT`, `STORAGE_UNAVAILABLE`.
> - 이 기기에만 저장, 다른 확장은 못 읽음, 확장을 지우면 함께 지움.
> - 패널은 확장의 `invokeCommand` 명령을 거치므로 패널 계약 변경은 필요 없습니다. SDK에는 `machineRun` 같은 얇은 도우미를 더해 주시면 좋습니다.
>
> 받기 전까지 moai는 세션 메모리로 동작합니다(오류 아님). 받으면 `se-cv7w.lca`·`se-5air`를 이 API로 닫습니다.

## Desktop 저장소 후속

`aplus-dev-studio-desktop`을 읽기만 해서 정리했다(`se-vpav`). 이 저장소에서 고칠 것은 없고, **확장 2.0.0 태그가 나온 뒤** Desktop 쪽에서 할 일이다. 순서는 위 3절의 릴리스 순서 끝에 붙는다.

1. `build/official-extensions/catalog.v1.json`의 `buzzni.moai` 항목을 2.0.0, 새 릴리스 태그(이 저장소의 태그이고 확장 버전에서 나오지 않는다), `buzzni.moai-2.0.0.saycode-extension.base64`, 새 sha256으로 바꾼다. 1.1.1 `.base64`는 지운다(남기면 prebuild 검사의 orphan 오류).
2. `tests/officialExtensionInstaller.test.ts`: 버전·태그·sha, `readInstalledManifest('buzzni.moai', '1.1.1')`, 프로필 4개(`status`·`prime`·`show`·`add`) 다이제스트 `toEqual` 표를 13개로 바꾼다. 같은 다이제스트는 Happy 데몬 카탈로그 쪽과도 같아야 한다(위 1.4절).
3. `release-notes/unreleased/moai-official-extension.md`의 "buzzni.moai 1.1.1" 문구를 바꾼다.
4. 서명된 원격 카탈로그로 기존 사용자에게 2.0.0을 보낸다면 그 설명자(`id`, `version`, `releaseUrl`, `archiveUrl`, `sha256`)에도 새 항목이 필요하다. 번들 카탈로그는 부트스트랩용이다.
5. 1.1.1 → 2.0.0은 자동 교체가 아니라 사용자가 누르는 업데이트다(`apiVersion`이 최소 2 미만일 때만 자동). 실행 중에는 거부된다.
6. 매니페스트는 `apiVersion 3`, `engines ^1.2.0`이라 Desktop이 그대로 받는다. 다만 `apiVersion < 4`는 UI에서 "deprecated" 뱃지가 붙는다. 이 뱃지를 피하려면 API 4 기능을 쓰는 확장 버전이 따로 필요하다.
7. 열어 둘 요청(선택): 패널에 가시성·포커스 신호를 주는 포트 메시지, `allow-same-origin` 또는 패널용 저장 API(요청서는 [4절](#4-sdkdesktop-설정-저장-api-se-dnas)). 지금은 iframe이 `sandbox="allow-scripts"`뿐이라 `localStorage`가 세션 한정이고, 숨은 탭은 0×0 뷰포트로만 짐작한다.
