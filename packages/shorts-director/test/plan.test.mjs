import assert from 'node:assert/strict'
import { test } from 'node:test'

import { countTakes, planSeconds, validatePlan } from '../lib/plan.mjs'

function shots(count, seconds) {
  return Array.from({ length: count }, (_, index) => ({ seconds, framing: `f${index}`, action: 'a' }))
}

function goodPlan() {
  return {
    version: 1,
    title: '퇴근길 우산',
    language: 'ko',
    aspect: '9:16',
    target_seconds: 30,
    platform: 'shorts',
    hook: {
      options: [
        { line: '우산 없이 나오면 매일 손해 보는 이유', mechanism: 'loss', question: '무슨 손해지?' },
        { line: '퇴근 10분 전, 하필 비가 쏟아졌다', mechanism: 'situation', question: '그래서 어떻게 됐지?' },
        { line: '편의점 우산이 다 팔린 날 생긴 일', mechanism: 'gap', question: '무슨 일이 생겼지?' },
      ],
      chosen: 1,
    },
    facts: [{ text: '90%', source: '기상청 동네예보 2026-11-21' }],
    ending: { type: 'peak' },
    subjects: [{ id: 'hero', kind: 'person', look: 'Korean office worker in her 30s, beige trench coat' }],
    moments: [
      { id: 'm1', kind: 'take', place: 'subway exit', seconds: 5, subjects: ['hero'], shots: shots(2, 2.5), video_prompt: 'p1', caption: { text: '퇴근 10분 전 폭우', role: 'hook' } },
      { id: 'm2', kind: 'take', place: 'stairs', seconds: 5, subjects: ['hero'], shots: shots(2, 2.5), video_prompt: 'p2' },
      { id: 'm3', kind: 'take', place: 'bus stop', seconds: 5, subjects: ['hero'], shots: shots(2, 2.5), video_prompt: 'p3', beat: 'rehook' },
      { id: 'm4', kind: 'photo', file: 'materials/umbrella.jpg', seconds: 3, shots: shots(1, 3) },
      { id: 'm5', kind: 'take', place: 'shop', seconds: 5, subjects: ['hero'], shots: shots(2, 2.5), video_prompt: 'p4' },
      { id: 'm6', kind: 'take', place: 'home door', seconds: 4, subjects: ['hero'], shots: shots(2, 2), video_prompt: 'p5' },
      { id: 'm7', kind: 'card', seconds: 3, shots: shots(1, 3), caption: { text: '오늘 밤 비 90%', role: 'info' } },
    ],
    narration: [{ text: '비 오는 날 퇴근길, 우산 없이 나와 본 적 있죠?', moment: 'm1' }],
  }
}

function codes(plan) {
  return validatePlan(plan).issues.map((issue) => issue.code)
}

test('a plan that follows the shortform rules has no errors and no warnings', () => {
  const result = validatePlan(goodPlan())
  assert.deepEqual(result.issues, [])
  assert.equal(result.ok, true)
  assert.equal(planSeconds(goodPlan()), 30)
  assert.equal(countTakes(goodPlan()), 5)
})

test('the hook question must offer three or four options and record the choice', () => {
  const plan = goodPlan()
  plan.hook = { options: plan.hook.options.slice(0, 1), chosen: 0 }
  assert.ok(codes(plan).includes('hook.options'))
  plan.hook = { options: goodPlan().hook.options }
  assert.ok(codes(plan).includes('hook.chosen'))
})

test('each hook option names its mechanism and the single question it plants, and the options span three mechanisms', () => {
  const plan = goodPlan()
  plan.hook.options = ['A', 'B', 'C']
  assert.ok(codes(plan).includes('hook.options'), 'plain strings no longer say which mechanism or question')
  plan.hook.options = goodPlan().hook.options.map((option) => ({ ...option, mechanism: 'loss' }))
  assert.ok(codes(plan).includes('hook.mechanism'))
  plan.hook.options = goodPlan().hook.options.map((option, index) => index === 0 ? { ...option, mechanism: 'clickbait' } : option)
  assert.ok(codes(plan).includes('hook.mechanism'), 'unknown mechanisms are rejected')
})

test('the first seconds carry the hook on screen and in sound, not only in the picture', () => {
  const noCaption = goodPlan()
  delete noCaption.moments[0].caption
  assert.ok(codes(noCaption).includes('hook.layers'))
  const noVoice = goodPlan()
  delete noVoice.narration[0].moment
  noVoice.narration[0].start = undefined
  noVoice.narration.unshift({ text: '그 순간', moment: 'm2' })
  assert.ok(codes(noVoice).includes('hook.layers'))
})

test('a re-hook lands around a third of the way in', () => {
  const missing = goodPlan()
  delete missing.moments[2].beat
  assert.ok(codes(missing).includes('pace.rehook'))
  const late = goodPlan()
  delete late.moments[2].beat
  late.moments[5].beat = 'rehook'
  assert.ok(codes(late).includes('pace.rehook'))
  const halfway = goodPlan()
  delete halfway.moments[2].beat
  halfway.moments[3].beat = 'rehook'
  assert.ok(codes(halfway).includes('pace.rehook'), 'the window is 25–45%, so a scene starting at 50% is too late')
})

test('narration and captions avoid AI-script filler', () => {
  const plan = goodPlan()
  plan.narration = [{ text: '안녕하세요! 오늘은 우산에 대해 알아보겠습니다.', moment: 'm1' }]
  assert.ok(codes(plan).includes('script.slop'))
  plan.narration = [{ text: '첫째, 우산을 챙긴다. 또한 날씨를 본다.', moment: 'm1' }]
  assert.ok(codes(plan).includes('script.slop'))
})

test('numbers spoken or shown need a source in plan.facts', () => {
  const plan = goodPlan()
  plan.facts = []
  assert.ok(codes(plan).includes('claim.unsourced'), 'the 90% card has no source')
  const spoken = goodPlan()
  spoken.narration.push({ text: '이 우산은 3만 원이에요.' })
  assert.ok(codes(spoken).includes('claim.unsourced'))
})

test('the look is one of the genre looks', () => {
  const plan = goodPlan()
  plan.look = 'neon'
  assert.ok(codes(plan).includes('look'))
  plan.look = 'recipe'
  assert.ok(!codes(plan).includes('look'))
})

test('a caption own look and position are checked: known fonts, colours, readable contrast, above the subtitles', () => {
  const plan = goodPlan()
  plan.moments[0].caption.look = { font: 'Comic Sans MS' }
  assert.ok(codes(plan).includes('caption.look'))
  plan.moments[0].caption.look = { ink: 'red' }
  assert.ok(codes(plan).includes('caption.look'))
  plan.moments[0].caption.look = { ink: '#FFFFFF', fill: '#FFFF66' }
  assert.ok(codes(plan).includes('caption.contrast'), 'white on pale yellow cannot be read')
  plan.moments[0].caption.look = { ink: '#111111', fill: '#FFFF66', font: 'Jua-Regular' }
  assert.ok(!codes(plan).some((code) => code.startsWith('caption.')))
  plan.moments[0].caption.position = { y: 0.85 }
  assert.ok(codes(plan).includes('caption.position'), 'the subtitle band and the platform UI are below 70%')
  plan.moments[0].caption.position = { y: 0.4, x: 'middle' }
  assert.ok(codes(plan).includes('caption.position'))
})

test('an emphasised word must be in its caption', () => {
  const plan = goodPlan()
  plan.moments[0].caption.emphasis = '없는말'
  assert.ok(codes(plan).includes('caption.emphasis'))
  plan.moments[0].caption.emphasis = '폭우'
  assert.ok(!codes(plan).includes('caption.emphasis'))
})

test('a hook caption that cannot be read in two seconds is warned', () => {
  const plan = goodPlan()
  plan.moments[0].caption.text = '퇴근 십 분 전에 갑자기 비가 쏟아져서 우산도 없이 나왔던 그날'
  assert.ok(codes(plan).includes('caption.length'))
})

test('the length suits the platform', () => {
  const plan = goodPlan()
  plan.platform = 'tiktok'
  assert.ok(!codes(plan).includes('length.platform'), '30 seconds suits TikTok')
  plan.moments.push({ id: 'm8', kind: 'card', seconds: 4, shots: shots(1, 4) }, { id: 'm9', kind: 'card', seconds: 4, shots: shots(1, 4) })
  assert.ok(codes(plan).includes('length.platform'), 'TikTok favors about 21-34 seconds, not 38')
  plan.platform = 'myspace'
  assert.ok(codes(plan).includes('platform'))
})

test('the ending is a peak, a seamless loop or exactly one call to action', () => {
  const plan = goodPlan()
  plan.ending = { type: 'cta' }
  assert.ok(codes(plan).includes('ending.cta'))
  plan.ending = { type: 'cta', cta: ['save', 'share'] }
  assert.ok(codes(plan).includes('ending.cta'))
  plan.ending = { type: 'cta', cta: 'save' }
  assert.ok(!codes(plan).includes('ending.cta'))
  plan.ending = { type: 'fade' }
  assert.ok(codes(plan).includes('ending.type'))
})

test('the video must not open on a text-only card', () => {
  const plan = goodPlan()
  plan.moments.unshift({ id: 'm0', kind: 'card', seconds: 2, shots: shots(1, 2), caption: { text: '안녕하세요', role: 'title' } })
  plan.moments.at(-1).seconds = 1
  plan.moments.at(-1).shots = shots(1, 1)
  assert.ok(codes(plan).includes('opening.card'))
})

test('too few cuts for the length reads as a slideshow', () => {
  const plan = goodPlan()
  for (const moment of plan.moments) {
    moment.shots = shots(1, moment.seconds)
  }
  assert.ok(codes(plan).includes('pace.cuts'))
})

test('a shot longer than four seconds is flagged', () => {
  const plan = goodPlan()
  plan.moments[0].shots = [{ seconds: 4.5, framing: 'wide', action: 'a' }, { seconds: 0.5, framing: 'close', action: 'b' }]
  assert.ok(codes(plan).includes('pace.shot'))
})

test('take shots must add up to the take length', () => {
  const plan = goodPlan()
  plan.moments[0].shots = shots(2, 2)
  assert.ok(codes(plan).includes('take.shots_sum'))
})

test('take length must fit the backend limits (LTX: up to 5 seconds per generation)', () => {
  const plan = goodPlan()
  plan.moments[0].seconds = 6
  plan.moments[0].shots = shots(3, 2)
  assert.ok(codes(plan).includes('take.seconds'))
  assert.ok(!validatePlan(plan, { take: { min: 1, max: 10 } }).issues.some((issue) => issue.code === 'take.seconds'))
})

test('a take can start from an earlier take only, and from a real photo only under materials/', () => {
  const plan = goodPlan()
  plan.moments[1].from = { take: 'm1' }
  assert.ok(!codes(plan).includes('take.from'))
  plan.moments[1].from = { take: 'm3' }
  assert.ok(codes(plan).includes('take.from'), 'a later take cannot be the starting frame')
  plan.moments[1].from = { file: 'stills/x.png' }
  assert.ok(codes(plan).includes('take.from'))
  plan.moments[1].from = { file: 'materials/me.jpg' }
  assert.ok(!codes(plan).includes('take.from'))
})

test('a hard cut inside a chained take loses the face, so it is warned', () => {
  const plan = goodPlan()
  plan.moments[1].from = { take: 'm1' }
  plan.moments[1].shots[1].transition = 'cut'
  const issue = validatePlan(plan).issues.find((item) => item.code === 'take.cut_after_anchor')
  assert.equal(issue?.level, 'warning')
  plan.moments[1].shots[1].transition = 'move'
  assert.ok(!codes(plan).includes('take.cut_after_anchor'))
})

test('moment ids and file paths cannot leave the project folder', () => {
  const plan = goodPlan()
  plan.moments[0].id = '../../evil'
  assert.ok(codes(plan).includes('moment.id'))
  const second = goodPlan()
  second.moments[3].file = 'materials/../../.ssh/id_ed25519'
  assert.ok(codes(second).includes('photo.real'))
  const third = goodPlan()
  third.moments[1].from = { file: 'materials/../secret.png' }
  assert.ok(codes(third).includes('take.from'))
  const fourth = goodPlan()
  fourth.moments.at(-1).background = 'black,drawbox'
  assert.ok(codes(fourth).includes('card.background'))
  const fifth = goodPlan()
  fifth.music = { file: '../../Music/song.mp3' }
  assert.ok(codes(fifth).includes('music.file'))
  const unknownTrack = goodPlan()
  unknownTrack.music = { track: 'top-40-hit' }
  assert.ok(codes(unknownTrack).includes('music.track'), 'only tracks from the CC0 catalog')
  const catalogTrack = goodPlan()
  catalogTrack.music = { track: 'be-chillin' }
  assert.ok(!codes(catalogTrack).some((code) => code.startsWith('music.')))
  const sixth = goodPlan()
  sixth.moments[0].sfx = [{ kind: 'boom', at: 1 }]
  assert.ok(codes(sixth).includes('sfx.kind'), 'only the sounds the renderer can make')
})

test('camera moves over stills are only for real photos from materials/', () => {
  const plan = goodPlan()
  plan.moments[3].file = 'stills/generated.png'
  assert.ok(codes(plan).includes('photo.real'))
})

test('unknown subjects are rejected', () => {
  const plan = goodPlan()
  plan.moments[0].subjects = ['ghost']
  assert.ok(codes(plan).includes('subject.unknown'))
})

test('asking the video model for no subtitles makes it draw fake lettering, so those words are rejected', () => {
  const plan = goodPlan()
  plan.moments[0].video_prompt = 'rainy street. No text, no subtitles, no music.'
  assert.ok(codes(plan).includes('prompt.text_words'))
  plan.moments[0].video_prompt = 'rainy street'
  plan.moments[0].shots[0].action = 'a caption appears'
  assert.ok(codes(plan).includes('prompt.text_words'))
})

test('a signage-heavy place without a blurred background is warned, because LTX draws garbled Korean on signs', () => {
  const plan = goodPlan()
  plan.moments[0].video_prompt = 'Handheld phone video, bright convenience store entrance on a rainy night, realistic.'
  const issue = validatePlan(plan).issues.find((item) => item.code === 'prompt.signage')
  assert.equal(issue?.level, 'warning')
  assert.equal(issue?.where, 'm1')

  plan.moments[0].video_prompt = 'Handheld phone video, very shallow depth of field, bright convenience store entrance on a rainy night.'
  assert.ok(!codes(plan).includes('prompt.signage'), 'a blurred background is enough')
  plan.moments[0].video_prompt = 'Close-up under a glass awning on a rainy night, plain dark glass behind her.'
  assert.ok(!codes(plan).includes('prompt.signage'), 'a place without signage is fine')
  plan.moments[0].video_prompt = 'Handheld phone video at a Seoul subway exit, rainy night.'
  assert.ok(codes(plan).includes('prompt.signage'))
})

test('prices and numbers inside a video prompt are warned to move to overlays', () => {
  const plan = goodPlan()
  plan.moments[0].video_prompt = 'a sign that says 9,900원'
  const issue = validatePlan(plan).issues.find((item) => item.code === 'prompt.numbers')
  assert.equal(issue?.level, 'warning')
})

test('a subscribe or like ending is warned', () => {
  const plan = goodPlan()
  plan.moments.at(-1).caption = { text: '구독과 좋아요 부탁해요', role: 'info' }
  assert.ok(codes(plan).includes('ending.tail'))
})

test('narration far longer than the video can carry is warned before TTS', () => {
  const plan = goodPlan()
  plan.narration = [{ text: '가'.repeat(400) }]
  assert.ok(codes(plan).includes('narration.length'))
})

test('total length far from the target is flagged', () => {
  const plan = goodPlan()
  plan.target_seconds = 60
  assert.ok(codes(plan).includes('length.target'))
})

test('a product video names its brand out loud at least twice, so viewers remember what it was', () => {
  const plan = goodPlan()
  plan.brand = '데이터라이즈'
  assert.ok(codes(plan).includes('brand.mentions'), 'brand never spoken')
  plan.narration = [
    { text: '데이터라이즈 에이전트한테 한 줄만 물으면 돼요.', moment: 'm1' },
    { text: '데이터라이즈, 30일 무료예요.', moment: 'm7' },
  ]
  assert.ok(!codes(plan).includes('brand.mentions'))
  // 화면 글자는 말로 치지 않는다 — 소리로 들려야 기억에 남는다. 대사(dialogue)는 센다.
  plan.narration = [{ text: '한 줄만 물으면 돼요.', moment: 'm1' }]
  plan.moments[0].caption = { text: '데이터라이즈', role: 'hook' }
  plan.moments[1].dialogue = [{ speaker: 'She', text: '데이터라이즈 써 봤어?' }]
  assert.ok(codes(plan).includes('brand.mentions'), 'one spoken mention is not enough')
  plan.brand = { name: 'Datarize', spoken: ['데이터라이즈'] }
  plan.moments[2].dialogue = [{ speaker: 'He', text: '응, 데이터라이즈.' }]
  assert.ok(!codes(plan).includes('brand.mentions'), 'spoken forms of a latin brand name count')
})
