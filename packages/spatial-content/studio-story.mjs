import { storyFileText, storyStepLines } from './scene.mjs'

export const lobbyStory = {
  greeting: '안녕하세요. 어떤 일로 방문하셨나요?',
  meeting: '방문 등록 후 접수대에서 안내해 드릴게요.',
  tour: '방문증을 받으신 뒤 안내를 기다려 주세요.',
}

export function studioStory(text) {
  const lines = storyStepLines(text)
  if (lines.length > 3) throw new Error('첫 대사와 두 가지 다음 안내를 세 줄 이내로 적어 주세요.')
  const [greeting, meeting = '', tour = ''] = lines
  return { greeting, meeting, tour }
}

export async function readStudioStory(file) {
  if (!/\.(txt|md)$/i.test(file.name) || file.size > 64 * 1024) {
    throw new Error('64 KB 이하의 TXT 또는 MD 파일을 선택해 주세요.')
  }
  return studioStory(storyFileText(new Uint8Array(await file.arrayBuffer())))
}
