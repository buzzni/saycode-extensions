export const IMAGE_LIMIT = 10 * 1024 * 1024
export const STORY_LIMIT = 64 * 1024
export const STORY_LENGTH = 4800
const MAX_STEPS = 12
const IMAGE_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

export function imageMime(bytes) {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

export function storyFileText(bytes) {
  if (bytes.length > STORY_LIMIT) throw new Error('64 KB 이하의 스토리 파일을 선택해 주세요.')
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('UTF-8로 저장한 TXT 또는 MD 파일을 선택해 주세요.')
  }
  if (!text.trim() || text.includes('\0')) throw new Error('스토리 파일에 읽을 수 있는 텍스트가 없어요.')
  if (text.length > STORY_LENGTH) throw new Error('스토리 파일을 4,800자 이하로 줄여 주세요.')
  return text
}

function imageSource(value, message) {
  if (!value?.name?.trim() || !IMAGE_URL.test(value.image) ||
      value.image.length > Math.ceil(IMAGE_LIMIT / 3) * 4 + 32) throw new Error(message)
  return { name: value.name.trim().slice(0, 100), image: value.image }
}

export function buildScene({ title, environment, character, story }) {
  if (!title.trim()) throw new Error('콘텐츠 제목을 입력해 주세요.')
  const space = imageSource(environment, '환경 이미지를 올려 주세요.')
  const person = character?.image
    ? imageSource(character, '인물 이미지를 다시 올려 주세요.')
    : { name: character?.name?.trim().slice(0, 100) || '', image: null }
  if (!person.name) throw new Error('인물 이미지를 올리거나 인물 이름을 입력해 주세요.')
  const lines = story.split(/\r\n?|\n/).map((line) =>
    line.trim().replace(/^(?:#{1,6}|[-*+]|\d+[.)])\s+/, '').trim()).filter(Boolean)
  if (!lines.length) throw new Error('스토리를 입력하거나 파일로 올려 주세요.')
  if (lines.length > MAX_STEPS || lines.some((line) => line.length > 400)) {
    throw new Error('스토리는 12단계까지 만들 수 있어요. 한 줄은 400자 이하로 적어 주세요.')
  }
  const steps = lines.map((text, index) => ({
    id: 'step-' + (index + 1),
    text,
    next: index + 1 < lines.length ? 'step-' + (index + 2) : null,
  }))
  return { version: 1, title: title.trim().slice(0, 80), environment: space, character: person, steps }
}

export const VIEWER_STYLES = `
.experience { display: grid; gap: 10px; }
.experience h2, .experience p { margin: 0; overflow-wrap: anywhere; }
.experience-space { position: relative; overflow: hidden; background: var(--surface); border-radius: 12px; }
.experience-space img { display: block; width: 100%; height: auto; }
.experience-point { position: absolute; inset-inline-start: var(--point-x); inset-block-start: 52%; transform: translate(-50%, -50%); }
.experience-person { display: flex; gap: 8px; align-items: center; overflow-wrap: anywhere; }
.experience-person img { width: 36px; height: 36px; object-fit: cover; border-radius: 50%; }
.experience-step { padding: 9px 0; min-height: 38px; }
.experience button { min-height: 36px; background: var(--primary); color: var(--on-primary); border: 0; border-radius: 999px; padding: 6px 14px; cursor: pointer; font: inherit; justify-self: start; }
.experience .experience-point { min-width: 44px; min-height: 44px; border: 2px solid white; box-shadow: 0 2px 8px #0007; }
`

export function mountViewer(target, scene) {
  // This function is also serialized into the standalone result. Keep its DOM code self-contained.
  const document = target.ownerDocument
  const add = (parent, tag, className, text = '') => {
    const element = document.createElement(tag)
    element.className = className
    element.textContent = text
    parent.append(element)
    return element
  }
  const root = add(target, 'div', 'experience')
  const heading = add(root, 'h2', '', scene.title)
  heading.tabIndex = -1
  const space = add(root, 'div', 'experience-space')
  const environment = add(space, 'img', '')
  environment.alt = scene.environment.name
  environment.src = scene.environment.image
  const point = add(space, 'button', 'experience-point')
  const personRow = add(root, 'div', 'experience-person')
  if (scene.character.image) {
    const portrait = add(personRow, 'img', '')
    portrait.alt = ''
    portrait.src = scene.character.image
  }
  add(personRow, 'span', '', scene.character.name)
  const status = add(root, 'div', 'experience-step')
  status.setAttribute('aria-live', 'polite')
  const step = add(status, 'p', '')
  const action = add(root, 'button', '')
  point.type = action.type = 'button'
  let index = 0
  let completed = false

  function renderStep() {
    step.textContent = completed
      ? '체험을 완료했어요.'
      : (index + 1) + ' / ' + scene.steps.length + ' · ' + scene.steps[index].text
    point.hidden = completed
    point.textContent = String(index + 1)
    point.style.setProperty('--point-x', index % 2 === 0 ? '36%' : '70%')
    point.setAttribute('aria-label', (index + 1) + '단계 확인')
    action.textContent = completed ? '다시 체험' : scene.steps[index].next === null ? '체험 완료' : '다음'
  }

  function advance() {
    if (completed) {
      index = 0
      completed = false
    } else if (scene.steps[index].next === null) {
      completed = true
    } else {
      index += 1
    }
    renderStep()
  }

  action.addEventListener('click', advance)
  point.addEventListener('click', () => {
    advance()
    if (completed) action.focus()
  })
  renderStep()
  return heading
}

export function exportExperience(scene) {
  const data = JSON.stringify(scene).replaceAll('<', '\\u003c')
  const viewer = mountViewer.toString()
  return '<!doctype html><html lang="ko"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'">' +
    '<title>공간컨텐츠 체험</title><style>html{color-scheme:light dark}body{--surface:light-dark(#f2f2f2,#272932);--primary:#1b64da;--on-primary:#fff;max-width:900px;margin:24px auto;padding:0 12px;font:16px/1.5 system-ui}[hidden]{display:none!important}' +
    VIEWER_STYLES + '</style><main id="experience"></main><script>(' + viewer +
    ')(document.getElementById("experience"),' + data + ')</script></html>'
}
