# 상류 요청서: Happy 데몬 카탈로그와 moai CLI

Moai 확장 2.0(`packages/moai`, `milestone/se-9inv`)이 돌려면 이 저장소 밖에서 두 가지가 먼저 있어야 한다. 이 페이지는 그 두 곳에 건넬 요청을 한 곳에 모은다. 개편 전체 계획은 [개편 계획](overview.md)에 있다.

- **1절 — Happy 데몬(happy-cli) 담당에게**: 카탈로그에 프로필 7개를 더한다. 선언은 `extension.json`과 글자 그대로 같아야 한다. 관리 moai 고정(v0.8.0)도 올려야 한다(1.6절).
- **2절 — moai CLI(`moa-issue`) 담당에게**: 확장이 기대하는 상류 개선 목록과, 없을 때 패널이 하는 일. 8번(`read --seen`)을 빼고 moai 0.17.0에 들어왔다.
- **3절 — 릴리스 순서**.
- **5절 — Desktop 담당에게**: 확인 창을 데몬 광고 확인 뒤에 띄우기, 읽기 일괄 승인, 읽기 승인 유지. 2026-10-15 실기에서 나왔다.

작성일 2026-10-14. 선언의 출처는 `milestone/se-9inv`의 `packages/moai/extension.json`(확장 2.0.0, `apiVersion 3`)이다. 추적 이슈는 `se-0g4a.anz`(데몬), `se-0g4a.l89`(moai unread), `se-a5wl`(`read --seen`).

> **상태.** 아래 가정은 2026-10-14 사람 결정으로 "구현된 것으로 가정하고 진행"한 것이다(`se-0g4a` 노트). 같은 날 moai **0.17.0**이 설치되어 2절은 8번(`read --seen`, `se-a5wl`)을 빼고 모두 **확인됨**이다. 4번 파생값 둘은 이름이 달랐고 패널이 실제 이름을 읽도록 고쳤다(`se-ydco`). 1절 데몬 카탈로그는 happy-cli 쪽이라 아직 **대기**다(`se-0g4a.anz`). 남은 확인은 [개편 계획 3.1절](overview.md#31-구현-시점의-가정과-남은-실기-확인-2026-10-14)의 실기 목록이 맡는다.
>
> **2026-10-15 실기.** Desktop 0.1.69(happy-cli `1.1.10-aplus.322`)에서 돌려 보니 새 7개는 여전히 없고, 데몬은 기기의 moai가 아니라 **관리 moai v0.8.0**만 실행한다(1.6절). 실기 뒤 확장은 `add`를 빼 프로필이 12개다(`se-24ey.oxd`). 결과는 [현황 2.0.10절](current-state.md#2010-실기-테스트-pr-52-2026-10-15-에픽-se-24ey).

## 1. Happy 데몬 카탈로그

### 1.0 요약

확장 2.0은 `buzzni.moai.*` 프로필 12개를 선언한다(실기 뒤 `add`를 뺐다, `se-24ey.oxd`). Desktop 0.1.69에 든 데몬(`happy-cli 1.1.10-aplus.322`)의 카탈로그에 이미 있는 것은 5개이고 **7개가 없다.** 카탈로그의 다른 프로필(`ready`, `stats`, `add`, `mv`, `edit`, `rm`, `note`, `defer`, `link`, `backlog`)은 그대로 두면 된다.

| 구분 | 프로필 |
|---|---|
| 데몬에 이미 있음 (5) | `status`, `prime`, `show`, `wiki-ls`, `wiki-show` |
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

1. 카탈로그에 7개를 더한 뒤, 설치된 데몬에서 확장의 프로필 id 12개가 모두 있는지 본다.
2. 확장 2.0을 올린 작업 영역에서 패널을 열어 호환성 배너가 사라지는지 본다.
3. 읽기 프로필끼리 `workspace-busy`가 나는지 본다. SDK 쪽 코드로는 쓰기 범위 락이라 읽기끼리는 안 날 것으로 읽히지만 라이브로 본 적이 없다(`se-0g4a.anz`, `se-0g4a.fjl`).

### 1.6 관리 moai 고정을 올리기

2026-10-15 실기에서 확인했다. 데몬은 moai를 **PATH에서 찾지 않는다.**

- 카탈로그 옆의 `MOAI_V080_MANAGED_TOOL`이 moai를 **v0.8.0**으로 고정한다(아티팩트 URL, 압축본 `sha256`, 실행 파일 `executableSha256`). 데몬은 그 실행 파일을 `~/.happy/managed-tools/buzzni.moai/0.8.0/`에 두고, 실행할 때 **그 파일 하나만 든 제한 PATH**를 만든다. 없으면 `MACHINE_RUN_TOOL_NOT_INSTALLED`(Desktop의 `tool-missing`)다. 설치는 Desktop 확장 설정의 머신 도구가 `machine.tool` RPC로 한다.
- 0.8.0은 패널이 부르는 명령은 모두 가진다(`show --all`, `backlog show --all`, `show --archived -n --sort --after`, `read <id>`·`--all`·`-e`, `wiki ls/show`). 그러나 2절의 1번(`unread`), 2번(`statuses[]`), 4번(`derived_milestone`·`shelved_by`)을 찍지 않는다. 그래서 프로필 7개가 들어가도 고정이 0.8.0이면 **Desktop에서는 NEW 칩과 탭 뱃지가 꺼지고**, 칸 순서와 파생값은 패널이 직접 계산한다.
- 요청: 7개 프로필과 함께 관리 도구 고정을 **0.17.x**(2절 1~7번이 확인된 판)로 올린다. darwin-arm64·linux-x64 아티팩트의 URL·`sha256`·`executableSha256`·`archiveRoot`를 새 릴리스로 바꾼다. 기존 사용자는 머신 도구에서 다시 설치해야 할 수 있다.

### 1.7 스킬 프로필 2개 — `moai-saycode` 설치 (`se-gowr.fk2`)

2026-10-15 사용자 요청: 저장소에 moai 스킬, 특히 선택 스킬 `moai-saycode`(감독이 Saycode 세션에 일을 맡길 때 쓰는 손)가 없으면 패널이 설치를 권하거나 버튼으로 설치한다. 확장이 프로필 2개를 더 선언한다. 1.1의 7개와 같은 규칙(선언 전체 해시)으로 카탈로그에 더해 달라.

```json
{
  "id": "buzzni.moai.skill-status",
  "executable": "moai",
  "argv": ["--json", "-C", "{{workspaceRoot}}", "skill", "status"],
  "parameters": {},
  "cwd": "workspaceRoot",
  "envAllowlist": ["HOME"],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": ["git"]
},
{
  "id": "buzzni.moai.skill-install-saycode",
  "executable": "moai",
  "argv": ["--json", "-C", "{{workspaceRoot}}", "skill", "install", "--with", "moai-saycode", "--hook-exe", "moai"],
  "parameters": {},
  "cwd": "workspaceRoot",
  "envAllowlist": ["HOME"],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "writeScope": "project",
  "descendantAllowlist": ["git"]
}
```

- `skill-status`는 읽기다. 패널은 연 뒤 한 번만, 그리고 전체 목록(`show-all`)을 읽은 곳에서만 부른다. 카탈로그에 없으면(거부) 배너 없이 이 기능만 꺼진다. 호환성 배너는 이 둘을 세지 않는다.
- `skill-install-saycode`는 쓰기다(`writeScope: project`, `.claude/moai-plugin/`를 쓴다). Desktop은 쓰기마다 묻는다.
- **Claude 등록은 데몬에서 되지 않는다.** 데몬이 주는 PATH에는 `claude`가 없어서 `moai skill install`이 파일만 심고 `registered: false`로 끝난다(2026-10-15 실측, 종료 코드 0). 이미 등록된 저장소에서는 문제가 없고, 처음 까는 저장소에서는 패널이 터미널에서 칠 명령을 보여 준다. 데몬이 이 프로필에 한해 동봉 `claude`를 PATH에 넣고 `descendantAllowlist`에 `claude`를 더하면 등록까지 된다. 그렇게 할지는 데몬 담당이 정한다. 그러면 선언도 같이 바꾼다.
- **훅 철자(2026-10-15 실기).** 데몬은 실행마다 임시 폴더를 만들어 `moai` 래퍼 스크립트(`exec <관리 moai> "$@"`)를 넣고 그 폴더를 PATH로 준다(`createRestrictedPath`). moai는 PATH의 `moai`가 자기와 같은 파일일 때만 훅에 이름을 적는데, 래퍼는 다른 파일이라 관리 moai의 절대 경로(`~/.happy/managed-tools/buzzni.moai/0.17.0/moai`)를 적었다. 그래서 설치 프로필은 훅 철자를 명시하는 moai 옵션(`--hook-exe moai`, 2절 13번)을 넘긴다(위 선언에 들어 있다).
- **세션 PATH 요청(데몬·Desktop).** 훅이 이름 `moai`로 적히면, Saycode 세션은 데몬에서 물려받은 사용자 셸 PATH에서 moai를 찾는다. 사용자가 moai를 따로 깔지 않은 머신에서는 훅이 조용히 꺼진다(`|| exit 0`). 세션 PATH에 관리 moai의 고정 링크 폴더(`~/.happy/managed-tools/buzzni.moai/bin`)를 넣어 달라.
- moai 0.17.0으로 이 쓰기를 돌리면 훅이 깨진다(2절 11번). 패널은 `skill status --json`에 `optional`이 있는 moai(2절 10번)에서만 버튼을 낸다. 그래서 두 프로필을 더하는 것과 함께 **관리 moai 고정을 10·11번이 든 판으로 올려야** 버튼이 보인다. 그 전에는 "moai 스킬이 아예 없음"만 감지해서 명령을 보여 준다.

### 1.8 워크트리 겹쳐 보기 프로필 2개 (`se-etwu`)

2026-10-15 실기: 워크트리가 있으면 TUI가 보이는 `⎇ <브랜치>`가 패널에 없었다. TUI 탐색기처럼 다른 워크트리를 겹쳐 보는 읽기 2개를 더한다. 둘 다 읽기다.

```json
{
  "id": "buzzni.moai.show-all-worktree",
  "executable": "moai",
  "argv": ["--json", "-C", "{{workspaceRoot}}", "show", "--all", "--worktree"],
  "parameters": {},
  "cwd": "workspaceRoot",
  "envAllowlist": ["HOME"],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": ["git"]
},
{
  "id": "buzzni.moai.show-worktree",
  "executable": "moai",
  "argv": ["--json", "-C", "{{workspaceRoot}}", "show", "{{id}}", "--worktree"],
  "parameters": { "id": { "type": "string", "maxLength": 128 } },
  "cwd": "workspaceRoot",
  "envAllowlist": ["HOME"],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "descendantAllowlist": ["git"]
}
```

- 패널은 연 뒤 먼저 일반 목록(`show-all`)으로 그리고, 그다음 `show-all-worktree`를 한 번 시험한다. 되면 그때부터 목록과 상세를 겹쳐 읽고, 카탈로그에 없으면(거부) 그 세션에서는 다시 묻지 않는다. 호환성 배너는 이 둘을 세지 않는다.
- `--worktree`는 `git worktree list`와 옆 워크트리의 스냅샷을 읽는다. `descendantAllowlist`의 `git`으로 충분하다(샌드박스에서 실측).
- 행의 `⎇` 표시는 moai가 `--worktree`일 때 내는 `working`(그 이슈를 쥔 워크트리, 2절 14번)을 쓰고, 없으면 `branch`(그 행이 온 워크트리)를 쓴다.

### 1.9 init 프로필 — 패널에서 `moai init` (`se-s1e8`)

2026-10-20 사용자 요청: init 안 된 프로젝트의 패널은 터미널에서 `moai init`을 돌리라는 안내만 보였다. 이제 그 안내 아래 "여기서 Moai 시작" 버튼으로 init을 돌린다. 확장이 쓰기 프로필 하나를 더 선언한다. 1.1과 같은 규칙(선언 전체 해시)으로 카탈로그에 더해 달라.

```json
{
  "id": "buzzni.moai.init",
  "executable": "moai",
  "argv": ["--json", "-C", "{{workspaceRoot}}", "init", "--no-skill", "--no-register"],
  "parameters": {},
  "cwd": "workspaceRoot",
  "envAllowlist": ["HOME"],
  "timeoutMs": 120000,
  "outputLimitBytes": 1048576,
  "stdin": "none",
  "writeScope": "project",
  "descendantAllowlist": ["git"]
}
```

- 쓰기다(`writeScope: project`). Desktop은 쓰기마다 묻는다. init이 쓰는 곳은 `.moai/`, `.gitattributes`, `.gitignore`, `AGENTS.md`(안내 블록), `.git/config`(merge driver)이다. `--json`이면 묻지 않고 `--yes`와 같이 심는다(git 추적, 안내 블록). 2026-10-20에 관리 경로의 moai(그때 `develop` 빌드)를 데몬처럼 좁은 PATH(`/usr/bin:/bin`)로 돌려 실측했다.
- **관리 moai 고정은 그대로 둬도 된다.** `--no-skill`·`--no-register`는 공개 0.17.0에 이미 있다(`src/init_choice.rs`).
- `--no-skill`: 스킬은 init 뒤 보드가 뜨면 스킬 배너(1.7)가 `--hook-exe moai`로 심는다. init에는 그 옵션이 없어서, init이 스킬까지 심으면 훅에 관리 moai의 절대 경로가 박힌다.
- `--no-register`: 사람의 프로젝트 목록(`~/.config/moai`)은 패널이 바꿀 것이 아니다.
- **merge driver 경로.** 데몬에서 돌린 init은 `.git/config`의 merge driver에 관리 moai의 절대 경로(`~/.happy/managed-tools/buzzni.moai/0.17.0/moai`)를 적는다. PATH의 `moai`가 자기와 같은 파일이 아니기 때문이다(1.7의 훅과 같은 이유). 고정 판이 바뀌어 그 경로가 죽으면 driver는 `git merge-file`로 떨어져 병합은 되지만, 이슈 단위 3-way 병합은 잃는다. 터미널에서 `moai init`을 다시 돌리면 살아 있는 경로로 바뀐다. 철자를 명시하는 moai 옵션은 2절 15번에 요청한다.
- 카탈로그에 없으면 `unsupported-daemon`으로 거부되고, 패널은 그 이유를 init 배너에 쓴다. 호환성 배너는 이것을 세지 않는다(읽기는 모두 그대로 된다). 손으로 하는 안내(`moai init`)는 그 위에 남는다.
- **데몬의 `project` 쓰기 정책(aplus.342, `createManagedProjectWriteScopePolicy`)은 경로를 가두지 않는다.** `.moai`가 작업 폴더 밖을 가리키거나 `.git`·`.claude`·`.aplus`·`AGENTS.md`·`CLAUDE.md`가 심볼릭 링크면 거부하고, 작업 폴더 하나에 쓰기 하나만 동시에 허용한다. 그래서 연결된 워크트리에서도 init은 메인 체크아웃의 git 공용 폴더에 있는 `.git/config`에 driver를 쓴다. 쓰기를 폴더 안에 가두는 정책으로 바뀌면 이 프로필은 워크트리에서 git 오류로 끝나고, 패널은 그 이유를 배너에 보인다.

## 2. moai CLI 상류

패널은 아래 개선이 `moai`에 **이미 있다고 가정하고** 짰고, moai **0.17.0**에서 1~7번이 확인됐다(2026-10-14 실측, `se-0g4a` 노트). 8번은 0.17.0에도 없고, 9번은 2026-10-15 실기에서 나온 제안이다. 10~14번은 2026-10-15에 moai `develop`에 들어갔고 다음 릴리스를 기다린다. 15번은 2026-10-20 제안이다. 1.7·1.8절의 프로필과 머리가 이것들을 쓰므로, 관리 moai 고정(1.6)은 이것들이 든 판으로 올려야 한다. 옛 moai에서도 패널이 죽지는 않는다. 아래 표의 "없으면"이 `compat.ts`·`source.ts`·`index.ts`가 하는 일이다.

| # | 개선 | 패널이 기대하는 모양 | 없으면 (패널의 대체 동작) |
|---|---|---|---|
| 1 | `show --json`의 **`unread`** | 행과 `show <id>`에 `"unread": true`. 안 읽음이 아니면 키가 없고, 사람을 모르면 어디에도 없다. 판정(내게 온 것·내 에픽의 멤버·마일스톤 제외·`updated_at > seen`)은 CLI 한 곳에서 한다. 구현은 moa-issue `moai-cqwy`. **0.17.0 확인됨** | NEW 칩과 탭 뱃지가 꺼진다. 오류는 아니고 배너도 없다: 키는 안 읽음 0이면 없어서 부재를 "기능 없음"과 구별할 수 없고 0.16도 `unread`를 찍는다(`se-xee6`, 사람 결정으로 compat `ORDER`에서 뺐다). 키가 없는 것만으로는 "낡음"이 아니라 "모름"으로 읽는다 |
| 2 | `status --json`의 **`statuses[]`** (설정 순서) | `statuses: string[]`, `.moai/config.toml` 순서. **0.17.0 확인됨** | `counts` 키를 기본 순서(`todo, in_progress, review, done`)에 맞추고 모르는 칸은 뒤에 붙인다. 설정 순서를 잃는다. 배너는 없다(`se-hd7v`) |
| 3 | **설정 읽기 JSON** | 칸 이름·`archive_days` 같은 값을 JSON으로. **0.17.0 확인됨**(`config --json`). 패널은 아직 읽지 않는다(선언한 프로필에 없음) | 코드의 기본값(`archive_days = 14`, 칸 4개) |
| 4 | 파생값 **`derived_milestone`·`shelved_by`·`archived`** (요청 때 이름은 `derived_deferred`·`archive_candidate`) | **0.17.0 확인됨, 이름이 다름.** 행에 `derived_milestone`(문자열), `shelved_by`(행을 계획에서 뺀 가장 가까운 행의 id, 스스로 미뤘으면 자기 id), `archived`(`show --all`이 아카이브로 숨기는 행에 `true`). 셋 다 해당할 때만 키가 있고 `false`·`null`은 나오지 않는다 | `nav.rs` 규칙을 이식한 인덱스가 클라이언트에서 직접 계산한다. 있으면 그 값이 이긴다 |
| 5 | **`--fields`** | 목록에서 본문을 뺀 출력 | 아카이브는 쪽 나누기와 잘림 배너로 버틴다. 실측상 필수는 아니다. (**0.17.0 확인됨**, `show --fields`) |
| 6 | **안정 페이징** | `show --archived -n 200 --sort id --after <id>`가 쪽 사이에서 같은 순서를 낸다. **0.17.0 확인됨** | 쪽 나누기가 안 되고 아카이브는 큰 저장소에서 읽지 못한다(`archive` 기능이 꺼짐) |
| 7 | `status --json`의 **`milestones[]`·`epics[]` 집계** | `{id, done, total}` 목록. 아카이브된 행까지 센 값. **0.17.0 확인됨** | 보드의 n/n이 `show --all`이 가진 행만 센 값이 되어 `moai status`와 어긋난다. `tallies`가 `degraded` |
| 8 | **`read <id> --seen <updated_at>`** (backlog `se-a5wl`) | **0.17.0에 없음.** 화면에 그린 행의 `updated_at`을 값으로 받는다. `read --json` 결과에도 행별 `updated_at`이 있으면 좋다 | 지금 `moai read`는 값 없이 행의 **현재** `updated_at`을 쓴다. 그린 뒤 바뀐 행이 새 판으로 읽음 처리될 수 있고, 패널은 다시 읽은 뒤 바뀜만 알린다(`staleAgainst`, `panel/data/read.ts`). 이 항목은 **2.0 릴리스 없이 갈 수 있다** |
| 9 | **보드 데이터 한 번에** (2026-10-15 실기 제안) | 행 전체(`show --all`)·backlog·`status`를 한 JSON으로 주는 명령 하나(예: `moai board --json`). **제안, 아직 없음** | 보드 한 번 읽기에 프로필 3개가 든다. Desktop은 프로필마다 확인 창을 띄우므로(5절) 처음 열 때 세 번 묻는다 |
| 10 | `skill status --json`의 **`optional`** (`se-gowr.fk2`) | 심긴 선택 스킬 이름 배열(`["moai-saycode"]`), `agents.optional`도 같은 꼴. 늘 있고 없으면 `[]`. **develop에 있음**(moai-yfjj `cc15555e`, 2026-10-15), 아직 릴리스 안 됨 | 패널은 "moai 스킬이 아예 없음"(`written: false`)만 감지하고, 설치 버튼 대신 터미널 명령을 보인다(`data/skills.ts canInstall`) |
| 11 | **`sh` 없이도 훅의 `moai` 철자 유지** (`se-gowr.fk2`) | 데몬처럼 PATH에 moai만 있어 `sh`를 못 띄워도 `skill install`이 커밋된 훅의 `moai`를 그대로 둔다(PATH를 직접 훑음). **develop에 있음**(moai-30g6 `ba12a793`) | 0.17.0을 데몬이 돌리면 훅이 관리 moai의 절대 경로로 바뀌고, 고정 판이 바뀌면 훅이 조용히 꺼진다. 그래서 10번이 없는 moai에서는 버튼을 내지 않는다 |
| 12 | `status --json`의 **`user`·`version`** (`se-qkga`) | `user: {name, email, label}`(TUI 머리의 User 줄, `naming` 적용) 또는 `null`, `version: {current, latest}`(`latest`는 캐시만 읽은 `{state, tag?, heard_at?, why?}` 또는 `null`, 네트워크 안 씀). **develop에 있음**(moai-9ve2 `ee07bee7`). `git config` 실행이 `status`마다 2번 는다 | 머리의 User·Version이 `—`로 나온다 |
| 13 | **`skill install --hook-exe <철자>`** (`se-gowr.fk2`) | 훅에 적을 moai 철자를 명시한다. `--hook-exe moai`면 데몬의 임시 래퍼 PATH에서도 훅이 `command -v -- "moai"`로 적힌다. 기억되지 않으므로 설치마다 넘긴다. **develop에 있음**(moai-r5lf `f5880ed6`) | 데몬에서 설치하면 훅에 관리 moai의 절대 경로가 박혀, 고정 판이 바뀌면 훅이 조용히 꺼진다 |
| 14 | `--worktree` 행의 **`working`** (`se-etwu`) | `show --all --worktree --json`·`show <id> --worktree --json` 등의 행에 그 이슈를 쥔 옆 워크트리 이름(TUI `Origin::working`). 없으면 키가 없다. `status --json --worktree`에 `working` 지도. 끝난 행도 낸다(가리는 것은 그리는 쪽). **develop에 있음**(moai-0n9u `3ee34d25`) | 행의 `⎇`는 `branch`(그 행이 온 워크트리)로만 선다. 이름이나 집은 표식으로 쥔 행에는 표시가 없다 |
| 15 | **`init --driver-exe <철자>`** (`se-s1e8`) | merge driver 명령에 적을 moai 철자를 명시한다(13번 `--hook-exe`와 같은 꼴). `--driver-exe moai`면 데몬의 임시 래퍼 PATH에서도 `.git/config`에 `moai merge-driver …`로 적힌다. **제안, 아직 없음**(0.17.0·develop 모두) | 패널의 init(1.9)이 driver에 관리 moai의 절대 경로를 적는다. 고정 판이 바뀌면 병합이 `git merge-file`로 떨어지고, 터미널에서 `moai init`을 다시 돌릴 때까지 이슈 단위 병합을 잃는다 |

### 2.1 판별 방식

패널은 버전 문자열이 아니라 **모양**으로 낡은 moai를 알아본다(`compat.ts`).

- `status --json`에 `statuses[]`나 `milestones[]`/`epics[]`가 없으면 낡은 moai(0.16)로 읽는다. 0.16은 마일스톤·에픽 셈과 아카이브 쪽 나누기를 이미 가졌으므로 배너를 받지 않는다(`se-hd7v`, `se-xee6`). 배너는 패널이 쓰는 기능이 정말 없을 때만 "moai를 올리라"고 말한다. 보드를 대체해서 읽은 이유(backlog 읽기 실패, `show --all` 없음)는 compat이 아니라 셸 배너 `shell.backlogFailed`·`shell.primeOnly`가 말한다(`se-ka0w`).
- `unread` 키만 없는 것은 증거가 아니다. 판정에 쓰지 않고 "알 수 없음"으로 둔다(`se-xee6`).
- `moai`가 데몬 쪽에 설치되지 않았으면(`tool-missing`) 따로 알린다.

### 2.2 우선순위

| 구분 | 항목 |
|---|---|
| 없으면 기능이 꺼짐 | 1(NEW 칩·뱃지, 배너 없음), 6(아카이브) |
| 없으면 값이 어긋나거나 순서를 잃음 | 2, 7 |
| 없어도 같은 결과를 클라이언트가 낸다 | 3, 4, 5 |
| 릴리스와 따로 | 8, 9, 15 |

## 3. 릴리스 순서

```
moai 상류 릴리스 ─┐
                  ├─> Moai 확장 2.0.0
데몬 카탈로그 갱신 ─┘
```

1. **moai 상류 릴리스** — 2절 1~7번이 들어간 `moai`. **0.17.0으로 나왔다**(2026-10-14 설치·실측).
2. **데몬 카탈로그 갱신** — 1절의 7개 프로필과 관리 moai 고정 상향(1.6절). 1번과 순서는 상관없지만 둘 다 3번보다 먼저다.
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

## 5. Desktop 확인 창

2026-10-15 실기에서 사람이 "설치 때 권한을 받았는데 왜 또 묻나, 너무 많이 묻는다"고 했다. Desktop 코드(`electron/extensions/machineRunApprovalPrompt.ts`, `machineRunMainRuntime.ts`, `src/sync/useMachineRunResponder.ts`)로 읽은 지금 동작:

- 설치 때 받는 것은 `machine.run` **권한**이다. 실행 때 Core는 **프로필마다** 따로 묻는다. 승인은 확장 버전·프로필·프로필 해시·머신·폴더에 묶인다. 읽기는 앱이 켜진 동안, 쓰기는 매번이고, 메모리에만 있어 재시작·확장 업데이트·다른 프로젝트에서 처음부터 다시 묻는다. 거절하면 30초 뒤 다시 물을 수 있다.
- **확인 창이 데몬 광고 확인보다 먼저다.** main이 확인 창을 띄운 뒤에 렌더러가 데몬 `capabilities`를 물어 프로필이 광고되는지 본다. 그래서 카탈로그에 없는 프로필도 사람이 승인한 뒤에 거부된다.

패널은 할 수 있는 만큼 줄였다(`se-24ey`): `add`를 빼 쓰기 확인 창이 없고, 전체 목록이 없다고 확인되면 다른 추가 프로필은 부르지 않으며, 거절된 목록 읽기는 자동 갱신을 멈춘다. 나머지는 Desktop 쪽에서만 된다.

| # | 요청 | 효과 |
|---|---|---|
| 1 | 확인 창을 **데몬이 그 프로필을 광고하는지 본 뒤에** 띄운다(광고되지 않으면 창 없이 `unsupported-daemon`) | 실행되지 않을 명령을 승인하게 하지 않는다 |
| 2 | **확장 단위 읽기 일괄 승인**: `writeScope`가 없는 프로필 모두를 머신·폴더 단위로 한 번에("이 확장의 읽기 명령 모두 허용") | 2.0 패널이 처음 열 때 묻는 횟수가 1번이 된다 |
| 3 | 읽기 승인을 **재시작 뒤에도 유지**(확장 버전·프로필 해시가 바뀌기 전까지, 머신·폴더 단위) | 앱을 켤 때마다 다시 묻지 않는다 |

## Desktop 저장소 후속

`aplus-dev-studio-desktop`을 읽기만 해서 정리했다(`se-vpav`). 이 저장소에서 고칠 것은 없고, **확장 2.0.0 태그가 나온 뒤** Desktop 쪽에서 할 일이다. 순서는 위 3절의 릴리스 순서 끝에 붙는다.

1. `build/official-extensions/catalog.v1.json`의 `buzzni.moai` 항목을 2.0.0, 새 릴리스 태그(이 저장소의 태그이고 확장 버전에서 나오지 않는다), `buzzni.moai-2.0.0.saycode-extension.base64`, 새 sha256으로 바꾼다. 1.1.1 `.base64`는 지운다(남기면 prebuild 검사의 orphan 오류).
2. `tests/officialExtensionInstaller.test.ts`: 버전·태그·sha, `readInstalledManifest('buzzni.moai', '1.1.1')`, 프로필 4개(`status`·`prime`·`show`·`add`) 다이제스트 `toEqual` 표를 12개로 바꾼다(`add`는 빠진다). 같은 다이제스트는 Happy 데몬 카탈로그 쪽과도 같아야 한다(위 1.4절).
3. `release-notes/unreleased/moai-official-extension.md`의 "buzzni.moai 1.1.1" 문구를 바꾼다.
4. 서명된 원격 카탈로그로 기존 사용자에게 2.0.0을 보낸다면 그 설명자(`id`, `version`, `releaseUrl`, `archiveUrl`, `sha256`)에도 새 항목이 필요하다. 번들 카탈로그는 부트스트랩용이다.
5. 1.1.1 → 2.0.0은 자동 교체가 아니라 사용자가 누르는 업데이트다(`apiVersion`이 최소 2 미만일 때만 자동). 실행 중에는 거부된다.
6. 매니페스트는 `apiVersion 3`, `engines ^1.2.0`이라 Desktop이 그대로 받는다. 다만 `apiVersion < 4`는 UI에서 "deprecated" 뱃지가 붙는다. 2026-10-20부터 Moai는 `apiVersion 4`다(`se-ya5e`). API 4는 Desktop 0.1.69부터 현재 판이고 API 3의 상위 집합이라, 매니페스트에서 바뀐 것은 숫자 하나다.
7. 열어 둘 요청(선택): 패널에 가시성·포커스 신호를 주는 포트 메시지, `allow-same-origin` 또는 패널용 저장 API(요청서는 [4절](#4-sdkdesktop-설정-저장-api-se-dnas)). 지금은 iframe이 `sandbox="allow-scripts"`뿐이라 `localStorage`가 세션 한정이고, 숨은 탭은 0×0 뷰포트로만 짐작한다.
