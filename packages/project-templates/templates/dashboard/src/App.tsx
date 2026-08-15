import { useState } from 'react'

interface DayStat {
  day: string
  handled: number
}

interface RecentRequest {
  id: string
  title: string
  team: string
  status: '완료' | '진행 중' | '대기'
  requestedAt: string
}

const WEEKLY_HANDLED: DayStat[] = [
  { day: '월', handled: 42 },
  { day: '화', handled: 58 },
  { day: '수', handled: 51 },
  { day: '목', handled: 74 },
  { day: '금', handled: 63 },
  { day: '토', handled: 18 },
  { day: '일', handled: 12 },
]

const RECENT_REQUESTS: RecentRequest[] = [
  { id: 'REQ-1042', title: '월간 매출 리포트 갱신', team: '영업', status: '완료', requestedAt: '07-22' },
  { id: 'REQ-1041', title: '신규 입사자 계정 발급', team: '인사', status: '진행 중', requestedAt: '07-22' },
  { id: 'REQ-1040', title: '재고 알림 임계값 조정', team: '물류', status: '진행 중', requestedAt: '07-21' },
  { id: 'REQ-1039', title: '고객 문의 태그 재분류', team: 'CS', status: '완료', requestedAt: '07-21' },
  { id: 'REQ-1038', title: '주간 배포 일정 공유', team: '개발', status: '대기', requestedAt: '07-20' },
]

const CHART = { width: 560, height: 220, padTop: 24, padBottom: 28, padSide: 16 }

function BarChart({ data }: { data: DayStat[] }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(...data.map((d) => d.handled))
  const innerHeight = CHART.height - CHART.padTop - CHART.padBottom
  const innerWidth = CHART.width - CHART.padSide * 2
  const slot = innerWidth / data.length
  const barWidth = Math.min(40, slot * 0.6)
  const maxIndex = data.findIndex((d) => d.handled === max)

  return (
    <figure className="chart-figure">
      <figcaption>요일별 처리 건수</figcaption>
      <svg
        role="img"
        aria-label={`요일별 처리 건수 막대 차트, 최대 ${max}건`}
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      >
        {data.map((d, i) => {
          const barHeight = Math.max(4, (d.handled / max) * innerHeight)
          const x = CHART.padSide + slot * i + (slot - barWidth) / 2
          const y = CHART.height - CHART.padBottom - barHeight
          const labeled = i === maxIndex || hovered === i
          return (
            <g
              key={d.day}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* 히트 영역은 마크보다 넓게 (슬롯 전체) */}
              <rect x={CHART.padSide + slot * i} y={CHART.padTop} width={slot} height={innerHeight} fill="transparent" />
              <rect
                className="chart-bar"
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={4}
                opacity={hovered === null || hovered === i ? 1 : 0.55}
              />
              {/* 라운드 상단만 남기고 베이스라인은 각지게 */}
              <rect className="chart-bar" x={x} y={CHART.height - CHART.padBottom - 4} width={barWidth} height={4} />
              {labeled ? (
                <text className="chart-value" x={x + barWidth / 2} y={y - 6} textAnchor="middle">
                  {d.handled}
                </text>
              ) : null}
              <text className="chart-axis" x={x + barWidth / 2} y={CHART.height - 8} textAnchor="middle">
                {d.day}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

function StatusBadge({ status }: { status: RecentRequest['status'] }) {
  const cls = status === '완료' ? 'done' : status === '진행 중' ? 'active' : 'pending'
  return <span className={`status-badge ${cls}`}>{status}</span>
}

export function App() {
  const total = WEEKLY_HANDLED.reduce((sum, d) => sum + d.handled, 0)
  const busiest = WEEKLY_HANDLED.reduce((a, b) => (b.handled > a.handled ? b : a))
  const inProgress = RECENT_REQUESTS.filter((r) => r.status === '진행 중').length

  return (
    <main className="dashboard">
      <header>
        <h1>사내 대시보드</h1>
        <p>이번 주 업무 요청 현황 요약입니다. 데이터를 실제 API로 바꿔 시작하세요.</p>
      </header>

      <section className="stat-row" aria-label="핵심 지표">
        <article className="stat-tile">
          <span className="stat-label">이번 주 처리</span>
          <strong className="stat-value">{total}건</strong>
        </article>
        <article className="stat-tile">
          <span className="stat-label">가장 바쁜 요일</span>
          <strong className="stat-value">{busiest.day}요일</strong>
        </article>
        <article className="stat-tile">
          <span className="stat-label">진행 중 요청</span>
          <strong className="stat-value">{inProgress}건</strong>
        </article>
      </section>

      <section className="panel">
        <BarChart data={WEEKLY_HANDLED} />
      </section>

      <section className="panel">
        <h2>최근 요청</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">번호</th>
              <th scope="col">제목</th>
              <th scope="col">팀</th>
              <th scope="col">상태</th>
              <th scope="col">요청일</th>
            </tr>
          </thead>
          <tbody>
            {RECENT_REQUESTS.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td>{r.title}</td>
                <td>{r.team}</td>
                <td><StatusBadge status={r.status} /></td>
                <td>{r.requestedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  )
}
