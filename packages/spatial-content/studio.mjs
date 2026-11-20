import { buildScene, exportExperience, IMAGE_LIMIT, imageMime, mountViewer, STORY_LIMIT, storyFileText, storyStepLines } from './scene.mjs'

const samples = {
  security: {
    title: '사업장 출입 보안', environment: '보안 게이트 로비', image: SPATIAL_SAMPLE_LOBBY,
    character: '안내 직원', story: '로비에 도착했습니다. 방문 등록 단말에서 방문 목적을 확인하세요.\n안내 직원에게 방문증을 받으세요.\n게이트 앞에서 출입 절차를 확인하세요.',
  },
  tour: {
    title: '오피스 투어', environment: '오피스 1층 로비', image: SPATIAL_SAMPLE_LOBBY,
    character: '오피스 가이드', story: '안내데스크에서 층별 안내를 확인하세요.\n업무 구역 입구를 확인하세요.\n방문할 층을 골라 보세요.',
  },
  showroom: {
    title: '스피커 쇼룸', environment: '오디오 쇼룸', image: SPATIAL_SAMPLE_SHOWROOM,
    character: '제품 안내 담당자', story: '가운데 진열대의 스피커를 살펴보세요.\n안내 담당자에게 스피커의 기능을 확인하세요.',
  },
}
const byId = (id) => document.getElementById(id)
const title = byId('title')
const characterName = byId('character-name')
const story = byId('story')
const experience = byId('experience')
const draftPreview = byId('draft-preview')
const saveButton = byId('export')
const buildButton = byId('build')
const buildStatus = byId('build-status')
const undoSample = byId('undo-sample')
const imageHint = byId('image-hint')
const previewImage = document.createElement('img')
previewImage.alt = ''
previewImage.hidden = true
imageHint.before(previewImage)
const sampleMenu = document.querySelector('.samples')
const changeTokens = new Map()
const pending = new Set()
let environment = null
let characterImage = null
let scene = null
let authored = false
let beforeSample = null

function hasAuthoredInput() {
  return authored && Boolean(title.value.trim() || story.value.trim() || characterName.value.trim() || environment || characterImage)
}

window.addEventListener('saycode:panel-before-close', event => {
  if (hasAuthoredInput() || beforeSample || pending.size) event.preventDefault()
})

function setError(key, message = '') {
  const error = byId(key + '-error')
  error.textContent = message
  error.hidden = !message
}

function renderDraft() {
  scene = null
  experience.replaceChildren()
  draftPreview.hidden = false
  saveButton.hidden = true
  const image = environment?.image ?? ''
  if (/^data:image\/(?:png|jpeg|webp);base64,/.test(image) && !/["&<>]/.test(image)) {
    previewImage.src = image
    previewImage.alt = environment.name
    previewImage.hidden = false
  } else {
    previewImage.removeAttribute('src')
    previewImage.hidden = true
  }
  imageHint.hidden = !previewImage.hidden
  byId('environment-name').textContent = environment?.name ?? '체험할 공간 사진을 올려 주세요.'
  const characterFileName = byId('character-file-name')
  characterFileName.textContent = characterImage?.name ?? ''
  characterFileName.hidden = !characterImage
  let storyReady = false
  try { storyReady = storyStepLines(story.value).length > 0 } catch { /* A story that cannot be built is not ready. */ }
  const ready = [environment, characterName.value.trim() || characterImage, storyReady].filter(Boolean).length
  buildStatus.textContent = ready + ' / 3 파트 준비됨'
  buildStatus.classList.remove('error')
  undoSample.hidden = !beforeSample
}

async function readImage(file) {
  if (file.size > IMAGE_LIMIT) throw new Error('10 MiB 이하의 이미지를 선택해 주세요.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = imageMime(bytes)
  if (!mime) throw new Error('PNG, JPG 또는 WebP 이미지를 선택해 주세요.')
  const image = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('이미지를 읽지 못했어요.'))
    reader.readAsDataURL(new Blob([bytes], { type: mime }))
  })
  const probe = new Image()
  probe.src = image
  try { await probe.decode() } catch { throw new Error('이미지를 열 수 없어요. 다른 파일을 선택해 주세요.') }
  return { name: file.name, image }
}

async function readStory(file) {
  if (!/\.(txt|md)$/i.test(file.name)) throw new Error('TXT 또는 MD 스토리 파일을 선택해 주세요.')
  if (file.size > STORY_LIMIT) throw new Error('64 KB 이하의 스토리 파일을 선택해 주세요.')
  return storyFileText(new Uint8Array(await file.arrayBuffer()))
}

function updateBusy() {
  buildButton.disabled = pending.size > 0
  buildButton.textContent = pending.size ? '파일 읽는 중…' : '콘텐츠 만들기'
}

function resetFileReads() {
  changeTokens.clear()
  pending.clear()
  updateBusy()
  for (const key of ['environment', 'character', 'story']) setError(key)
}

async function applyFile(key, file) {
  const token = Symbol(key)
  changeTokens.set(key, token)
  pending.add(key)
  updateBusy()
  setError(key)
  try {
    const updated = key === 'story' ? await readStory(file) : await readImage(file)
    if (changeTokens.get(key) !== token) return
    if (key === 'story') story.value = updated
    if (key === 'environment') environment = updated
    if (key === 'character') {
      characterImage = updated
      if (!characterName.value.trim()) characterName.value = file.name.replace(/\.[^.]*$/, '').slice(0, 100)
    }
    authored = true
    renderDraft()
  } catch (error) {
    if (changeTokens.get(key) === token) setError(key, error.message || '파일을 읽지 못했어요.')
  } finally {
    if (changeTokens.get(key) === token) {
      changeTokens.delete(key)
      pending.delete(key)
      updateBusy()
    }
  }
}

for (const button of document.querySelectorAll('[data-pick]')) {
  const key = button.dataset.pick
  const input = byId(key + '-file')
  button.addEventListener('click', () => input.click())
  input.addEventListener('change', () => {
    const file = input.files[0]
    input.value = ''
    if (file) void applyFile(key, file)
  })
}

for (const input of [title, characterName, story]) input.addEventListener('input', () => {
  if (input === story) {
    changeTokens.delete('story')
    pending.delete('story')
    setError('story')
    updateBusy()
  }
  authored = true
  renderDraft()
})

sampleMenu.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229 || !sampleMenu.open) return
  event.preventDefault()
  sampleMenu.open = false
  sampleMenu.querySelector('summary').focus()
})

for (const button of sampleMenu.querySelectorAll('[data-sample]')) button.addEventListener('click', () => {
  const sample = samples[button.dataset.sample]
  if (hasAuthoredInput()) beforeSample = { title: title.value, story: story.value, character: characterName.value, environment, characterImage, scene }
  resetFileReads()
  authored = false
  title.value = sample.title
  environment = { name: sample.environment, image: sample.image }
  characterImage = null
  characterName.value = sample.character
  story.value = sample.story
  sampleMenu.open = false
  renderDraft()
  title.focus()
})

undoSample.addEventListener('click', () => {
  if (!beforeSample) return
  const previous = beforeSample
  beforeSample = null
  resetFileReads()
  title.value = previous.title
  story.value = previous.story
  characterName.value = previous.character
  environment = previous.environment
  characterImage = previous.characterImage
  authored = true
  renderDraft()
  if (previous.scene) showExperience(previous.scene)
  else title.focus()
})

function showExperience(result) {
  scene = result
  buildStatus.textContent = '체험을 만들었어요.'
  buildStatus.classList.remove('error')
  draftPreview.hidden = true
  experience.replaceChildren()
  mountViewer(experience, scene).focus()
  saveButton.hidden = Boolean(window.saycodePanel)
}

// The Desktop sandbox blocks form submission, so use a local button action.
buildButton.addEventListener('click', () => {
  if (pending.size) return
  try {
    showExperience(buildScene({
      title: title.value, environment,
      character: { name: characterName.value.trim() || characterImage?.name, image: characterImage?.image },
      story: story.value,
    }))
  } catch (error) {
    buildStatus.textContent = error.message
    buildStatus.classList.add('error')
  }
})

for (const input of [title, characterName]) input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.isComposing) buildButton.click()
})

saveButton.addEventListener('click', () => {
  if (!scene || window.saycodePanel) return
  const url = URL.createObjectURL(new Blob([exportExperience(scene)], { type: 'text/html' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'spatial-content.html'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
})
renderDraft()
