# 상류 요청서: Happy 데몬 카탈로그와 moai CLI

Moai 확장 2.0(`packages/moai`, `milestone/se-9inv`)이 돌려면 이 저장소 밖에서 두 가지가 먼저 있어야 한다. 이 페이지는 그 두 곳에 건넬 요청을 한 곳에 모은다. 개편 전체 계획은 [개편 계획](overview.md)에 있다.

- **1절 — Happy 데몬(happy-cli) 담당에게**: 카탈로그에 프로필 7개를 더한다. 선언은 `extension.json`과 글자 그대로 같아야 한다.
- **2절 — moai CLI(`moa-issue`) 담당에게**: 확장이 이미 있는 것으로 가정한 상류 개선 목록과, 없을 때 패널이 하는 일.
- **3절 — 릴리스 순서**.

작성일 2026-10-14. 선언의 출처는 `milestone/se-9inv`의 `packages/moai/extension.json`(확장 2.0.0, `apiVersion 3`)이다. 추적 이슈는 `se-0g4a.anz`(데몬), `se-0g4a.l89`(moai unread), `se-a5wl`(`read --seen`).

> **상태.** 아래 가정은 2026-10-14 사람 결정으로 "구현된 것으로 가정하고 진행"한 것이고(`se-0g4a` 노트), 실제 환경에서는 아직 하나도 확인되지 않았다. 확인은 [개편 계획 3.1절](overview.md#31-구현-시점의-가정과-남은-실기-확인-2026-10-14)의 실기 목록이 맡는다.

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

패널은 아래 개선이 `moai`에 **이미 있다고 가정하고** 짰다. 가정하는 번호는 `0.17.0`이고 이 번호는 자리표시자다(3절). 가정이 빗나가도 패널이 죽지는 않는다. 아래 표의 "없으면"이 `compat.ts`·`source.ts`·`index.ts`가 하는 일이다.

| # | 개선 | 패널이 기대하는 모양 | 없으면 (패널의 대체 동작) |
|---|---|---|---|
| 1 | `show --json`의 **`unread`** | 행과 `show <id>`에 `"unread": true`. 안 읽음이 아니면 키가 없고, 사람을 모르면 어디에도 없다. 판정(내게 온 것·내 에픽의 멤버·마일스톤 제외·`updated_at > seen`)은 CLI 한 곳에서 한다. 구현은 moa-issue `moai-cqwy`(브랜치 `worktree-moai-cqwy`, 미병합) | NEW 뱃지가 꺼진다(`unread` 기능이 `degraded`에 든다). 오류는 아니다. 키가 없는 것만으로는 "낡음"이 아니라 "모름"으로 읽는다 |
| 2 | `status --json`의 **`statuses[]`** (설정 순서) | `statuses: string[]`, `.moai/config.toml` 순서 | `counts` 키를 기본 순서(`todo, in_progress, review, done`)에 맞추고 모르는 칸은 뒤에 붙인다. 설정 순서를 잃고 `status-order`가 `degraded` |
| 3 | **설정 읽기 JSON** | 칸 이름·`archive_days` 같은 값을 JSON으로 | 코드의 기본값(`archive_days = 14`, 칸 4개) |
| 4 | 파생값 **`derived_milestone`·`derived_deferred`·`archive_candidate`** | 행에 `derived_milestone`(문자열 또는 null), `derived_deferred`(bool), `archive_candidate`(bool) | `nav.rs` 규칙을 이식한 인덱스가 클라이언트에서 직접 계산한다. 있으면 그 값이 이긴다 |
| 5 | **`--fields`** | 목록에서 본문을 뺀 출력 | 아카이브는 쪽 나누기와 잘림 배너로 버틴다. 실측상 필수는 아니다 |
| 6 | **안정 페이징** | `show --archived -n 200 --sort id --after <id>`가 쪽 사이에서 같은 순서를 낸다 | 쪽 나누기가 안 되고 아카이브는 큰 저장소에서 읽지 못한다(`archive` 기능이 꺼짐) |
| 7 | `status --json`의 **`milestones[]`·`epics[]` 집계** | `{id, done, total}` 목록. 아카이브된 행까지 센 값 | 보드의 n/n이 `show --all`이 가진 행만 센 값이 되어 `moai status`와 어긋난다. `tallies`가 `degraded` |
| 8 | **`read <id> --seen <updated_at>`** (backlog `se-a5wl`) | 화면에 그린 행의 `updated_at`을 값으로 받는다. `read --json` 결과에도 행별 `updated_at`이 있으면 좋다 | 지금 `moai read`는 값 없이 행의 **현재** `updated_at`을 쓴다. 그린 뒤 바뀐 행이 새 판으로 읽음 처리될 수 있고, 패널은 다시 읽은 뒤 바뀜만 알린다(`staleAgainst`, `panel/data/read.ts`). 이 항목은 **2.0 릴리스 없이 갈 수 있다** |

### 2.1 판별 방식

패널은 버전 문자열이 아니라 **모양**으로 낡은 moai를 알아본다(`compat.ts`).

- `status --json`에 `statuses[]`나 `milestones[]`/`epics[]`가 없으면 낡은 moai(0.16)로 읽고 배너가 "moai를 올리라"고 말한다.
- `unread` 키만 없는 것은 약한 증거라서 "알 수 없음"으로만 둔다.
- `moai`가 데몬 쪽에 설치되지 않았으면(`tool-missing`) 따로 알린다.

### 2.2 우선순위

| 구분 | 항목 |
|---|---|
| 없으면 기능이 꺼짐 | 1(NEW 뱃지), 6(아카이브) |
| 없으면 값이 어긋나거나 순서를 잃음 | 2, 7 |
| 없어도 같은 결과를 클라이언트가 낸다 | 3, 4, 5 |
| 릴리스와 따로 | 8 |

## 3. 릴리스 순서

```
moai 상류 릴리스 ─┐
                  ├─> Moai 확장 2.0.0
데몬 카탈로그 갱신 ─┘
```

1. **moai 상류 릴리스** — 2절 1~7번이 들어간 `moai`. 이 문서가 가정하는 번호는 `0.17.0`이다.
2. **데몬 카탈로그 갱신** — 1절의 7개 프로필. 1번과 순서는 상관없지만 둘 다 3번보다 먼저다.
3. **확장 2.0.0** — 위 둘이 나온 뒤에 내보낸다. 확장과 moai는 버전 번호가 따로이고 확장의 `README` 호환성 표가 "moai 0.17.0 이상(**가정**)"으로 적혀 있다.
4. 2절 8번(`read --seen`)은 위와 상관없이 언제든 들어갈 수 있다.

### 3.1 "moai 0.17.0 가정" 자리표시자

- `0.17.0`은 **실제 릴리스 번호가 아니다.** 지금 확인된 moai는 0.16이고 위 개선은 아직 하나도 릴리스되지 않았다(unread는 미병합 브랜치뿐).
- 상류 릴리스 번호가 정해지면 바꿀 곳: 확장 `README.md`의 호환성 표(Needs 표의 `moai` CLI 행과 "assumed" 주석), `compat.ts` 헤더의 설명, 이 문서 2절 첫 문장과 3절. 확장 코드는 번호를 비교하지 않고 모양만 보므로 번호가 바뀌어도 동작은 바뀌지 않는다.
- 상류가 일부만 받아들이면 표의 "없으면" 열이 곧 그 릴리스의 동작이다. 그 경우 호환성 표의 "Notes" 칸을 받아들여진 항목에 맞춰 줄인다.

## Desktop 저장소 후속

`aplus-dev-studio-desktop`을 읽기만 해서 정리했다(`se-vpav`). 이 저장소에서 고칠 것은 없고, **확장 2.0.0 태그가 나온 뒤** Desktop 쪽에서 할 일이다. 순서는 위 3절의 릴리스 순서 끝에 붙는다.

1. `build/official-extensions/catalog.v1.json`의 `buzzni.moai` 항목을 2.0.0, 새 릴리스 태그(이 저장소의 태그이고 확장 버전에서 나오지 않는다), `buzzni.moai-2.0.0.saycode-extension.base64`, 새 sha256으로 바꾼다. 1.1.1 `.base64`는 지운다(남기면 prebuild 검사의 orphan 오류).
2. `tests/officialExtensionInstaller.test.ts`: 버전·태그·sha, `readInstalledManifest('buzzni.moai', '1.1.1')`, 프로필 4개(`status`·`prime`·`show`·`add`) 다이제스트 `toEqual` 표를 13개로 바꾼다. 같은 다이제스트는 Happy 데몬 카탈로그 쪽과도 같아야 한다(위 1.4절).
3. `release-notes/unreleased/moai-official-extension.md`의 "buzzni.moai 1.1.1" 문구를 바꾼다.
4. 서명된 원격 카탈로그로 기존 사용자에게 2.0.0을 보낸다면 그 설명자(`id`, `version`, `releaseUrl`, `archiveUrl`, `sha256`)에도 새 항목이 필요하다. 번들 카탈로그는 부트스트랩용이다.
5. 1.1.1 → 2.0.0은 자동 교체가 아니라 사용자가 누르는 업데이트다(`apiVersion`이 최소 2 미만일 때만 자동). 실행 중에는 거부된다.
6. 매니페스트는 `apiVersion 3`, `engines ^1.2.0`이라 Desktop이 그대로 받는다. 다만 `apiVersion < 4`는 UI에서 "deprecated" 뱃지가 붙는다. 이 뱃지를 피하려면 API 4 기능을 쓰는 확장 버전이 따로 필요하다.
7. 열어 둘 요청(선택): 패널에 가시성·포커스 신호를 주는 포트 메시지, `allow-same-origin` 또는 패널용 저장 API. 지금은 iframe이 `sandbox="allow-scripts"`뿐이라 `localStorage`가 세션 한정이고, 숨은 탭은 0×0 뷰포트로만 짐작한다.
