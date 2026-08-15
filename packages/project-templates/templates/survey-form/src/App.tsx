import { useState, type FormEvent } from 'react'

interface SurveyAnswers {
  name: string
  team: string
  satisfaction: string
  channels: string[]
  feedback: string
}

const TEAMS = ['개발', '디자인', '영업', 'CS', '기타']
const SATISFACTION = ['매우 만족', '만족', '보통', '불만족']
const CHANNELS = ['사내 공지', '동료 추천', '메신저', '메일']

const EMPTY_ANSWERS: SurveyAnswers = {
  name: '',
  team: TEAMS[0],
  satisfaction: '',
  channels: [],
  feedback: '',
}

export function App() {
  const [answers, setAnswers] = useState<SurveyAnswers>(EMPTY_ANSWERS)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState<SurveyAnswers | null>(null)

  function toggleChannel(channel: string) {
    setAnswers((current) => ({
      ...current,
      channels: current.channels.includes(channel)
        ? current.channels.filter((item) => item !== channel)
        : [...current.channels, channel],
    }))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!answers.name.trim()) {
      setError('이름을 입력해 주세요.')
      return
    }
    if (!answers.satisfaction) {
      setError('만족도를 선택해 주세요.')
      return
    }
    setError('')
    // TODO: 실제 수집 API(POST)로 교체하세요.
    setSubmitted(answers)
  }

  if (submitted) {
    return (
      <main className="survey">
        <section className="card">
          <h1>제출 완료</h1>
          <p className="lead">응답이 저장됐습니다. 아래 내용으로 접수됐어요.</p>
          <dl className="summary">
            <div><dt>이름</dt><dd>{submitted.name}</dd></div>
            <div><dt>소속 팀</dt><dd>{submitted.team}</dd></div>
            <div><dt>만족도</dt><dd>{submitted.satisfaction}</dd></div>
            <div><dt>알게 된 경로</dt><dd>{submitted.channels.length > 0 ? submitted.channels.join(', ') : '선택 안 함'}</dd></div>
            {submitted.feedback.trim() ? <div><dt>의견</dt><dd>{submitted.feedback}</dd></div> : null}
          </dl>
          <button type="button" onClick={() => { setSubmitted(null); setAnswers(EMPTY_ANSWERS) }}>
            새 응답 작성
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="survey">
      <form className="card" onSubmit={submit}>
        <h1>사내 도구 만족도 설문</h1>
        <p className="lead">3분이면 충분해요. 제출 결과는 화면에서 바로 확인할 수 있습니다.</p>

        {error ? <p className="error" role="alert">{error}</p> : null}

        <label>
          이름
          <input
            value={answers.name}
            onChange={(event) => setAnswers({ ...answers, name: event.target.value })}
            placeholder="홍길동"
          />
        </label>

        <label>
          소속 팀
          <select value={answers.team} onChange={(event) => setAnswers({ ...answers, team: event.target.value })}>
            {TEAMS.map((team) => <option key={team} value={team}>{team}</option>)}
          </select>
        </label>

        <fieldset>
          <legend>도구 만족도</legend>
          {SATISFACTION.map((level) => (
            <label key={level} className="choice">
              <input
                checked={answers.satisfaction === level}
                name="satisfaction"
                type="radio"
                onChange={() => setAnswers({ ...answers, satisfaction: level })}
              />
              {level}
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>알게 된 경로 (복수 선택)</legend>
          {CHANNELS.map((channel) => (
            <label key={channel} className="choice">
              <input
                checked={answers.channels.includes(channel)}
                type="checkbox"
                onChange={() => toggleChannel(channel)}
              />
              {channel}
            </label>
          ))}
        </fieldset>

        <label>
          하고 싶은 말
          <textarea
            rows={4}
            value={answers.feedback}
            onChange={(event) => setAnswers({ ...answers, feedback: event.target.value })}
            placeholder="자유롭게 적어주세요."
          />
        </label>

        <button type="submit">제출하기</button>
      </form>
    </main>
  )
}
