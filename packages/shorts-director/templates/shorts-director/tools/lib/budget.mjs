// 영상 백엔드 선택. 한 편 안에서는 백엔드를 섞지 않는다 — 모델 질감·오디오·워터마크가 컷마다 달라진다.
// 본인 계정 Gemini 앱(실측을 마친 경우)을 먼저 쓰고, 한도가 모자라면 그 편 전체를 공식 API 로 만든다.

// 호출마다 붙는 입력·생각 토큰 비용(viskit 실측 기준 약 3,500 입력 + 1,500 생각 토큰).
const PER_CALL_OVERHEAD_USD = (3500 * 1.5 + 1500 * 12) / 1_000_000

export function estimateApiUsd(takes, api) {
  const perSecond = api.costPerSecond?.[api.resolution] ?? 0
  const seconds = takes.reduce((sum, value) => sum + Number(value), 0)
  return Math.round((seconds * perSecond + takes.length * PER_CALL_OVERHEAD_USD) * 10000) / 10000
}

export function routeBackend({ takes, app = {}, api = {}, autopilot = false, fake = false }) {
  if (fake) return { backend: 'fake', needsApproval: false, estimatedUsd: 0, reason: '가짜 백엔드(테스트·리허설)' }

  const needed = takes.length
  if (app.enabled && app.measured && Number(app.remaining) >= needed) {
    return { backend: 'gemini-app', needsApproval: false, estimatedUsd: 0, reason: `앱 남은 한도 ${app.remaining}개로 테이크 ${needed}개를 모두 만든다` }
  }

  const appReason = !app.enabled
    ? '앱 백엔드 꺼짐'
    : !app.measured
      ? '앱 백엔드 미실측'
      : `앱 남은 한도 ${Number(app.remaining) || 0}개 < 필요 ${needed}개`

  if (!api.enabled) {
    return { backend: 'wait', needsApproval: false, estimatedUsd: 0, reason: `${appReason}, API 꺼짐 — 한도 리셋을 기다린다` }
  }

  const estimatedUsd = estimateApiUsd(takes, api)
  if (autopilot) {
    if (estimatedUsd > Number(api.capUsd)) {
      return { backend: 'wait', needsApproval: true, estimatedUsd, reason: `${appReason}, 예상 $${estimatedUsd} 가 편당 API 상한 $${api.capUsd} 를 넘는다` }
    }
    return { backend: 'gemini-omni-api', needsApproval: false, estimatedUsd, reason: `${appReason} — 편당 상한 안에서 API 로 만든다` }
  }
  return { backend: 'gemini-omni-api', needsApproval: true, estimatedUsd, reason: `${appReason} — API 로 만들려면 예상 비용 확인이 필요하다` }
}
