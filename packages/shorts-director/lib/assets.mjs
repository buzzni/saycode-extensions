// 패키지 밖에서 받아 쓰는 공개 자산: 글꼴(SIL OFL)과 배경음(CC0). 파일은 싣지 않고 주소·체크섬만 싣는다 —
// 패키지를 가볍게 두고, 처음 쓸 때 이 PC 의 ~/.config/shorts-director/ 에 받아 둔다. 체크섬이 다르면 쓰지 않는다.
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PRETENDARD = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static'

// Pretendard (Kil Hyung-jin, SIL Open Font License 1.1) — https://github.com/orioncactus/pretendard
export const FONTS = [
  { name: 'Pretendard-SemiBold', file: 'Pretendard-SemiBold.otf', sha256: 'c89bc43027dc7cde5726e96223376f8eec09302b2fc1f8147fd5b57cfc376118' },
  { name: 'Pretendard-Bold', file: 'Pretendard-Bold.otf', sha256: '2e91915fab54df71cc9598ebf608b2bdb54c6fe3c066ac61dff0bc44fca71cc7' },
  { name: 'Pretendard-ExtraBold', file: 'Pretendard-ExtraBold.otf', sha256: 'c35fe941b7568d52a96010561540e47f9d3948dfde66ba25bc1908233e0a40cd' },
].map((font) => ({ ...font, url: `${PRETENDARD}/${font.file}`, license: 'OFL-1.1' }))

const FREEPD = 'https://archive.org/download/abook-music-freepd-cc0'

// FreePD.com 의 공개 도메인(CC0) 곡. 사이트가 닫혀 Internet Archive 사본(CC0 명시, 곡별 출처 ATTRIBUTION.txt)에서 받는다.
// lufs 는 곡 전체 음량 실측값(렌더가 같은 크기로 맞춘다), start 는 조용한 도입부를 건너뛸 초. 분위기는 곡명·원 분류로 붙인 것이다.
export const MUSIC = Object.fromEntries(Object.entries({
  'be-chillin': { title: 'Be Chillin', mood: '느긋한 그루브 — 일상·브이로그·자취 팁', key: 'fpd-6c9a5c343a351b0f', lufs: -17.5, start: 3, sha256: '1abaa9455ced505f10306b34d1fe569a43be28809ae39e62f422c69f312a74cb' },
  inspiration: { title: 'Inspiration', mood: '밝은 업비트 — 변화·전후 비교·성공담', key: 'fpd-878d4dee797d92ef', lufs: -11.1, start: 1.5, sha256: 'a254227da398809c79a0c753073a3a92c7341672abc92bb0166b6326e126f0b4' },
  'inventing-flight': { title: 'Inventing Flight', mood: '호기심·경쾌 — 제품 소개·방법 안내', key: 'fpd-bf421296305f76bc', lufs: -11.3, start: 0, sha256: '916e736efa3caed4ea8534e727670dbac41af0fb44f00fa667aebaab9b2b6407' },
  'stereotype-news': { title: 'Stereotype News', mood: '뉴스풍 경쾌 — 정보·소식·수치', key: 'fpd-07e974381e5a302b', lufs: -10.1, start: 0, sha256: 'be0c93c2c4d59ec054e8f214eae3ce9bca83005491943ce1f8bf0086f2764d9f' },
  celebration: { title: 'Celebration', mood: '밝고 들뜬 — 결과 공개·이벤트', key: 'fpd-ac97bd9918f6cb79', lufs: -12.3, start: 0, sha256: '60947088034b356bb06ebbd0f623638ca8c1f9b7b5633aff74a7504d094624a1' },
  'holiday-weasel': { title: 'Holiday Weasel', mood: '장난스러운 — 실수담·코믹 상황', key: 'fpd-c52c33c1edb41ed5', lufs: -17.4, start: 0, sha256: '2ebe278f5695cad39112073e1036330598c5a16b72a49962acdd2fd4a8bd1b3c' },
  'meditating-beat': { title: 'Meditating Beat', mood: '차분한 비트 — 정리·루틴·힐링', key: 'fpd-dd8e6e76e21357b2', lufs: -17.6, start: 0, sha256: 'e498c2015a413e6cba5ab8dbef2a60cdebf7c4d4a97f9edd84851752ff49d3b6' },
  'painting-room': { title: 'Painting Room', mood: '잔잔한 — 감성·공간·인테리어', key: 'fpd-b01e7b753e35c9b5', lufs: -22.9, start: 0, sha256: 'ddfb9a5aa5420f1894902b290b7afc421ae644f6b5f4d4d9e24e5d464d95b1d1' },
  'hidden-truth': { title: 'Hidden Truth', mood: '긴장·미스터리 — 반전·폭로·경고', key: 'fpd-ef37130a6cfa7fd7', lufs: -16.7, start: 0, sha256: '39af66accc2de04c8d21c6bc5a31dd1168bb75f7b723c901699f025d1923aa51' },
  energizing: { title: 'Energizing', mood: '서서히 고조 — 동기부여·도전', key: 'fpd-c37643abec093971', lufs: -23.1, start: 0, sha256: '6b6f002c9721debbdb4a870fd7a084ec920761a064ca0333ad603e6348a538a4' },
}).map(([id, { key, ...track }]) => [id, {
  ...track,
  file: `${id}.mp3`,
  url: `${FREEPD}/${key}.mp3`,
  source: `FreePD.com "${track.title}" (public domain) via archive.org/details/abook-music-freepd-cc0`,
  license: 'CC0-1.0',
}]))

// 받아 둔 파일이 있고 체크섬이 맞으면 그대로, 아니면 받아서 확인한 뒤 바꿔 넣는다.
export async function ensureAsset(asset, directory) {
  const path = join(directory, asset.file)
  try {
    if (sha256(await readFile(path)) === asset.sha256) return path
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const response = await fetch(asset.url)
  if (!response.ok) throw new Error(`${asset.file} 을(를) 받지 못했다: HTTP ${response.status} — ${asset.url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== asset.sha256) throw new Error(`${asset.file} 의 sha256 이 목록과 다르다 — 받은 파일을 쓰지 않는다`)
  await mkdir(directory, { recursive: true })
  const partial = `${path}.part`
  await writeFile(partial, bytes)
  await rename(partial, path).catch(async (error) => {
    await rm(partial, { force: true })
    throw error
  })
  return path
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
