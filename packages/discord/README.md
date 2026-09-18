# Saycode Discord 채널 (`buzzni.discord`)

전용 테스트 Discord 앱의 Gateway 연결로 Saycode 세션을 시작·이어가는 Extension입니다.

**현재 상태**: SDK 단위 테스트·패킹 완료. Core가 이제 실제 Discord Application Command(슬래시 명령)를
등록하며, `/pair`·`/projects`·`/new`·`/use`·`/prompt` 등록과 수신까지 패킹된 아티팩트 기준 통합 테스트로
확인됐습니다. **다만 이는 로컬 패키지 통합 검증이며, 실제 Electron sandbox 안에서의 동작과 실제 Discord
봇을 통한 라이브 확인은 아직 이뤄지지 않았습니다.** 승인 버튼(T22)과 Desktop 종료 후 상시 수신(P4)은
별도로 진행 중입니다. 실제 연결 가능 여부는 Desktop 채널 설정 화면에서 확인하세요.

## 준비물

- 이 용도로만 쓸 전용 Discord 애플리케이션/봇, 서버 관리 권한.
- Desktop에 로그인된 Saycode 계정.

## Desktop에 설치

이 폴더를 패키징한 `.saycode-extension` 파일을 전달받았다면, Desktop **설정 → 확장 → 로컬 파일 설치**로
설치한 뒤 **활성화**를 눌러 요청 권한을 확인하고 승인하세요(확장 ID: `buzzni.discord`). 설치·활성화
전에도 "메신저 채널" 설정 화면에 Discord 행 자체는 표시되지만, 활성화하기 전에는 "어댑터 Extension이
설치되어 있지 않습니다" 경고가 뜨고 페어링을 진행할 수 없습니다.

## Discord 애플리케이션·봇 생성

1. https://discord.com/developers/applications 에서 새 애플리케이션을 만듭니다.
2. **Bot** 페이지에서 **Reset Token**으로 봇 토큰을 발급받습니다. Desktop UI가 지금 입력받는 값은 이
   **봇 토큰 하나뿐**입니다 — Application ID는 Core가 이 봇 토큰으로 스스로 확인하며, 사용자가 별도로
   입력하는 값은 아닙니다.
3. 같은 페이지에서 **MESSAGE CONTENT INTENT를 반드시 켜야 합니다** — 권장이 아니라 필수입니다. Core가
   Gateway에 매번 이 privileged intent를 포함해 요청하도록 고정돼 있어서, 포털에서 켜 두지 않으면
   Discord가 연결 자체를 close code `4014`로 끊습니다(공식 문서: 승인하지 않은 privileged intent를
   요청하면 Gateway 연결이 4014로 종료됨 — https://docs.discord.com/developers/events/gateway).
4. **Installation** 페이지에서 `bot`과 **`applications.commands`** 두 scope를 모두 선택합니다(공식
   quick-start가 길드 설치에 이 조합을 명시적으로 안내합니다 — `bot`에 이미 포함되어 있지만 명시적으로
   함께 선택하는 쪽이 공식 권장입니다: https://docs.discord.com/developers/interactions/application-commands).
   `bot` scope 권한은 최소 **Send Messages**, **Read Message History**를 선택하고, 생성된 초대 링크로
   서버에 봇을 추가합니다.

(공식 문서: https://docs.discord.com/developers/quick-start/getting-started 및 https://docs.discord.com/developers/topics/gateway)

## 페어링 (Desktop 승인 필수 — 임의의 첫 메시지로는 절대 열리지 않음)

1. Desktop 채널 설정에서 **"허용 범위"**(프로젝트/머신/기존 세션/허용 작업)를 먼저 선택합니다. 비워두면
   이후 어떤 명령도 실행되지 않는 그랜트가 만들어지므로, 코드를 발급하기 전에 반드시 지정하세요.
2. 봇 토큰을 저장한 뒤 나타나는 **"페어링 코드 발급"** 버튼을 누릅니다.
3. Discord에서 봇이 있는 채널(또는 DM)에 `/pair` 슬래시 명령을 입력하고 `code` 옵션에 Desktop이
   보여준 일회용 코드를 넣어 보냅니다.
4. Desktop의 **"승인 대기"** 항목에 보낸 사람·대화·스레드 정보가 표시됩니다. 여기서 **"승인"**을 눌러야만
   연결이 완료됩니다 — 코드를 보낸 것만으로 자동 승인되지 않습니다.
5. 코드는 몇 분 안에 만료되고 1회만 사용할 수 있습니다.

## 사용 가능한 명령

Discord가 자동완성으로 보여주는 실제 슬래시 명령입니다. `/`를 입력하면 아래 7개가 뜹니다.

| 명령 | 옵션 | 동작 |
|---|---|---|
| `/pair` | `code`(필수) | 페어링 코드 제출 |
| `/projects` | | 접근 가능한 프로젝트 목록 |
| `/new` | `project`(필수), `agent`/`model`/`effort`(선택) | 새 세션 생성 |
| `/use` | `session_id`(필수) | 기존 세션 선택 |
| `/status` | | 현재 세션 상태 확인 |
| `/stop` | | 진행 중인 턴 중단 |
| `/prompt` | `text`(필수) | 선택된 세션에 대한 후속 지시 |

일반 채팅 메시지에 `/pair <코드>`, `/new 내프로젝트`처럼 입력하는 텍스트 별칭도 지원합니다.
봇 멘션은 필요하지 않으며, 연결된 봇을 가리키는 앞부분 멘션은 명령 처리 전에 제거합니다.

승인 대기가 필요한 작업은 메시지에 승인/거부 버튼이 함께 표시됩니다(T22, 진행 중).

## 평문 메신저 경계

- Discord로는 해당 요청의 최종 답변과 접수/진행 상태만 전송됩니다. 과거 transcript, 원본 tool 출력,
  환경변수, 첨부파일은 자동 전송되지 않고, 첨부파일 다운로드 자체가 이번 범위에 없습니다.
- Discord 메시지는 Saycode의 종단간 암호화 구간 밖의 평문 메신저입니다.

## 상시 실행

Desktop 앱이 종료되면 이 채널도 함께 멈춥니다(현재 단계). Desktop 없이 계속 수신하는 별도 실행 위치는
이후 단계로 계획되어 있고, 아직 포함되지 않았습니다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 봇이 반응 없음 | Desktop에서 "승인" 완료했는지 확인 — 자동 승인 아님 |
| 연결 자체가 계속 끊김(close code `4014`) | MESSAGE CONTENT INTENT를 포털에서 켜지 않은 것입니다 — Core가 이 intent를 항상 요청하므로 켜져 있지 않으면 Gateway가 연결을 거부합니다. 포털에서 켠 뒤 다시 연결하세요 |
| `/` 슬래시 명령이 서버에 안 뜸 | `bot` scope에는 `applications.commands`가 포함되지만, 초대 링크 생성 시 두 scope를 명시적으로 함께 선택했는지 다시 확인하세요 — 그래도 안 뜨면 Discord 클라이언트 캐시 문제일 수 있으니 서버를 다시 열거나 잠시 후 재시도하세요 |
| `/new`를 보냈는데 거부됨 | 프로젝트ID/이름을 반드시 함께 입력 |
| `/use`나 `/select`를 보냈는데 거부됨 | 세션ID를 반드시 함께 입력 — 생략하면 일반 대화로 넘어가지 않고 거부됩니다 |
