# 설문 폼 템플릿

Vite + React + TypeScript 기반의 설문 폼 시작점입니다. 텍스트·선택·라디오·체크박스 문항과 검증, 제출 요약 화면이 동작합니다.

## 실행

```bash
npm install
npm run dev
```

## 구조

- `src/App.tsx` — 문항 정의(`TEAMS`/`SATISFACTION`/`CHANNELS` 상수)와 제출 처리. `submit()`의 TODO를 실제 수집 API로 바꾸는 것부터 시작하세요.
- `src/styles.css` — 라이트/다크 모드 CSS 변수.

요구사항: Node.js 20.19 이상 (또는 22.12 이상)
