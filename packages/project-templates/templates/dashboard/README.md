# 사내 대시보드 템플릿

Vite + React + TypeScript 기반의 사내 대시보드 시작점입니다.

## 실행

```bash
npm install
npm run dev
```

## 구조

- `src/App.tsx` — KPI 타일, 요일별 처리량 차트, 최근 요청 테이블. 상단의 `WEEKLY_HANDLED` / `RECENT_REQUESTS` 상수를 실제 API 호출로 바꾸는 것부터 시작하세요.
- `src/styles.css` — 라이트/다크 모드 CSS 변수. `--series-1`이 차트 색입니다.

요구사항: Node.js 20.19 이상 (또는 22.12 이상)
