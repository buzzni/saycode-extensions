/**
 * Fake final answers for measuring how often a rendered Slack reply passes Core's check (Desktop
 * specs/slack-bot-improvements tasks T34). Deterministic: the same seed gives the same 100 answers, built
 * from the kinds of Markdown coding agents write — prose with inline marks, nested lists, fenced code full
 * of `<`, `&&` and `<@U1>`, tables, quotes, links of every scheme, emoji, escapes, and long answers over
 * one Slack message. Four answers carry a known hard case on purpose: terminal output with ANSI colors
 * (control characters only the plain path can send) and Markdown shown inside a four-backtick fence.
 */

function prng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SENTENCES = [
  '변경 사항을 정리했습니다.',
  '먼저 **원인**을 확인한 뒤 _임시 조치_를 적용했습니다.',
  '`npm test` 를 실행하면 3개 테스트가 실패합니다.',
  '자세한 내용은 [설계 문서](https://wiki.example.com/design?id=42&tab=2) 를 참고하세요.',
  'The build fails because `tsconfig.json` sets `"strict": true` and `foo_bar` is `any`.',
  '~~예전 API~~ 대신 새 엔드포인트를 쓰세요.',
  '경로는 `C:\\Users\\dev\\app` 이고 설정 파일은 `__init__.py` 입니다.',
  'Run it with `NODE_ENV=production node server.js > out.log 2>&1 &`.',
  '이 값은 a < b && c > d 일 때만 참입니다.',
  '알림이 필요하면 <!here> 대신 담당자 <@U12345> 에게 직접 요청하세요.',
  '참고: https://docs.example.com/guide#section-3 에 예시가 있습니다.',
  '배포는 ***반드시*** 승인 후 진행합니다 🚀',
  '가족 사진 👨‍👩‍👧 처럼 결합 이모지도 그대로 보입니다 👍🏽.',
  '문의는 [메일](mailto:ops@example.com) 로 보내 주세요.',
  '상대 링크 [README](./docs/README.md) 와 [앵커](#설치) 는 Slack에서 열리지 않습니다.',
  '스크린샷: ![구성도](https://img.example.com/arch.png)',
  '\\*별표\\* 와 \\_밑줄\\_ 은 문자 그대로 씁니다.',
  'HTML 태그 <br> 와 <details> 는 Slack에서 글자로 보입니다.',
  '함수 `parse<T>(input: string): T` 는 제네릭입니다.',
  'snake_case_name 과 CONSTANT_VALUE 는 바꾸지 않았습니다.',
  '[https://a.example.com](https://b.example.com) 처럼 라벨과 주소가 다른 링크도 있습니다.',
  'Use `a | b` for the union type and `x || y` for fallback.',
  '테스트 커버리지는 87.5% → 91.2% 로 올랐습니다.',
  '1) 설정 2) 빌드 3) 배포 순서입니다.',
]

const CODE = [
  ['bash', ['npm ci && npm run build', 'node --test tests/*.test.mjs > result.txt 2>&1', 'echo "done" && exit 0']],
  ['ts', [
    'export function notify(user: string): string {',
    '  return `<@${user}> 확인 부탁드립니다`',
    '}',
    '',
    'const items: Array<string> = []',
    'if (a && b) items.push(\'<!channel>\')',
  ]],
  ['python', ['def main():', '    print("<@U1>")', '    if a and b:', '        x = y -> z  # arrow', '    return {"key": [1, 2, 3]}']],
  ['json', ['{', '  "name": "app",', '  "scripts": { "test": "vitest && tsc" },', '  "private": true', '}']],
  ['diff', ['--- a/src/index.ts', '+++ b/src/index.ts', '@@ -1,3 +1,3 @@', '-const a = 1', '+const a = 2', ' export { a }']],
  ['sql', ['SELECT id, name', 'FROM users', 'WHERE created_at > now() - interval \'7 days\'', '  AND status <> \'deleted\';']],
  ['', ['# 이 줄은 주석', '- 목록처럼 보이는 줄', '> 인용처럼 보이는 줄', '**굵게 아님**', '| 표 | 아님 |']],
  ['regex', ['^\\d{3}-\\d{4}$', '(?<name>[a-z_]+)\\s*=\\s*"(.*?)"', 'C:\\\\Program Files\\\\App']],
  ['html', ['<div class="card">', '  <a href="https://x.example.com?a=1&b=2">링크</a>', '</div>']],
]

const TABLES = [
  ['| 파일 | 변경 | 비고 |', '|---|---:|:---:|', '| `src/a.ts` | +12 | 리팩터 |', '| `src/b.ts` | -3 | **삭제** |', '| [README](https://x.example.com/readme) | +1 | 문서 |'],
  ['| Name | Status |', '|:--|:--|', '| api-1 | ✅ OK |', '| api-2 | ⚠️ 점검 중 |', '| db | ❌ down |'],
  ['| 옵션 | 설명 |', '|---|---|', '| `--force` | 강제 실행 \\| 주의 |', '| `-v` | 자세히 |'],
  ['| 항목 | 값 |', '| --- | --- |', '| a_b | 1 |', '| 합계 | **3** |'],
]

function pick(random, list) {
  return list[Math.floor(random() * list.length)]
}

function paragraph(random, sentences = 1 + Math.floor(random() * 3)) {
  return Array.from({ length: sentences }, () => pick(random, SENTENCES)).join(' ')
}

function codeBlock(random, repeat = 1) {
  const [language, lines] = pick(random, CODE)
  const body = Array.from({ length: repeat }, () => lines).flat()
  return [`\`\`\`${language}`, ...body, '```'].join('\n')
}

function list(random) {
  const ordered = random() < 0.4
  const items = []
  const count = 2 + Math.floor(random() * 4)
  for (let index = 0; index < count; index += 1) {
    items.push(`${ordered ? `${index + 1}.` : pick(random, ['-', '*', '+'])} ${paragraph(random, 1)}`)
    if (random() < 0.3) items.push(`   ${pick(random, ['-', '*'])} ${paragraph(random, 1)}`)
    if (random() < 0.15) items.push(`   \`\`\`bash\n   npm run check:${index}\n   \`\`\``)
  }
  return items.join('\n')
}

function section(random) {
  const roll = random()
  if (roll < 0.3) return paragraph(random)
  if (roll < 0.5) return list(random)
  if (roll < 0.68) return codeBlock(random)
  if (roll < 0.8) return pick(random, TABLES).join('\n')
  if (roll < 0.88) return paragraph(random, 2).split('. ').map((line) => `> ${line}`).join('\n')
  if (roll < 0.94) return `${pick(random, ['#', '##', '###'])} ${pick(random, ['요약', '원인 분석', 'Next steps', '변경 내용 **정리**'])}`
  if (roll < 0.97) return pick(random, ['---', '***', '- [ ] 남은 작업\n- [x] 끝난 작업'])
  return codeBlock(random, 40)
}

const HARD_CASES = [
  '테스트 결과:\n```\n\u001b[32m✓\u001b[0m 12 passed\n\u001b[31m✗\u001b[0m 1 failed\n```',
  'README 예시:\n````md\n```js\nconsole.log("<@U1>")\n```\n````',
]

/** `count` answers; every tenth is long (over 3,000 UTF-16 units), a few use CRLF line ends. */
export function fakeAnswers(count = 100, seed = 20261030) {
  const random = prng(seed)
  return Array.from({ length: count }, (_, index) => {
    const sections = index % 10 === 9 ? 14 + Math.floor(random() * 10) : 1 + Math.floor(random() * 6)
    let answer = Array.from({ length: sections }, () => section(random)).join('\n\n')
    if (index % 10 === 9 && answer.length <= 3000) answer += `\n\n${codeBlock(random, 60)}`
    if (index % 33 === 5) answer = answer.replaceAll('\n', '\r\n')
    if (index % 25 === 12) answer += `\n\n${HARD_CASES[Math.floor(index / 25) % 2]}`
    return answer
  })
}
