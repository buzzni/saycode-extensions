# React source locator

Saycode Desktop 내장 브라우저에서 요소를 고르면, 그 요소를 그린 React 컴포넌트 이름과 소스 위치(`file:line:column`)를 찾아 주석 트레이와 AI 프롬프트에 붙인다. API 4의 `elementPickInspectors` 기여와 `browserPicks.inspect` 권한을 쓴다(Desktop `specs/element-pick-source-inspector`).

- **React 18 이하**: 요소 fiber의 `_debugSource`(JSX를 쓴 파일·줄)와 `_debugOwner`(그린 컴포넌트).
- **React 19**: `_debugStack`에서 React·번들러 의존성이 아닌 첫 프레임을 골라, 같은 출처의 소스맵(인라인 data URI 또는 `sourceMappingURL` 파일)으로 원래 파일·줄로 되돌린다. 맵을 못 읽으면 개발 서버가 내준 경로와 생성 위치를 낸다.
- 개발 빌드가 아니거나 React가 아니면 아무것도 내지 않는다.

검사기는 Extension 프로세스가 아니라 정적 스크립트 `inspector.js`다. Desktop은 사용자가 요소를 고른 순간에만, 사용자가 권한을 승인했을 때만 이 함수를 그 페이지 안에서 실행하고, 돌아온 값을 이름 120자·경로 300자·줄/열 정수로 잘라 쓴다. 결과는 이 Extension으로 돌아오지 않는다. 페이지 안에서 실행되므로 페이지 내용에 접근할 수 있다 — 권한 설명이 이를 밝힌다.

```sh
npm run build --workspace @buzzni/saycode-extension-sdk
node --test packages/react-source-locator/tests/*.test.mjs
npm run pack --workspace @buzzni/saycode-extension-react-source-locator
```

Desktop의 확장 관리에서 `buzzni.react-source-locator-1.0.0.saycode-extension`을 설치하고 요소 선택 검사 권한을 허용한 뒤 활성화한다. 공식 catalog 등록·발행은 별도 릴리스 작업이다.
