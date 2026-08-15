# API 백오피스 템플릿

Vite + React + TypeScript 기반의 관리자 백오피스 시작점입니다. 목록 조회·등록·수정·삭제·상태 토글이 in-memory API로 동작합니다.

## 실행

```bash
npm install
npm run dev
```

## 구조

- `src/api.ts` — in-memory CRUD API. 실제 백엔드가 생기면 각 함수 본문만 fetch로 바꾸면 화면은 그대로 동작합니다.
- `src/App.tsx` — 등록/수정 폼과 목록 테이블.
- `src/styles.css` — 라이트/다크 모드 CSS 변수.

요구사항: Node.js 20.19 이상 (또는 22.12 이상)
