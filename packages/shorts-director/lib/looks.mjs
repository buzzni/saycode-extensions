// 장르별 글자 디자인 묶음(look). 한 편의 영상은 묶음 하나로 통일하고, 묶음마다 역할(훅·제목·정보·자막·속마음·라벨)의
// 서체·색·판·외곽선·등장 동작이 다르다. 모든 숏폼이 같은 흰 상자로 나오지 않게 — 레시피는 손글씨 메모, 뉴스는 각진 띠,
// 브이로그는 말투가 보이는 둥근 글씨와 반투명 자막 판처럼 장르의 결을 따른다.
//
// 디자인 필드: font(PostScript 이름, assets.FONTS 에 있는 것만), size(역할 기본 크기 배율), ink(글자색),
// fill(판 색, #RRGGBBAA 로 반투명), shape(square·rounded·pill), shadow(그림자), outline·outlineWidth(외곽선 색·두께 %),
// emphasis(강조어 글자색), emphasisFill(강조어 뒤 형광펜 색), entrance(pop·fade·none).

export const LOOK_ROLES = ['hook', 'title', 'info', 'narration', 'aside', 'label']

const PRETENDARD_SUBTITLE = { font: 'Pretendard-SemiBold', ink: '#FFFFFF', outline: '#101622', outlineWidth: 14, entrance: 'fade' }

export const LOOKS = {
  clean: {
    suits: '깔끔한 정보형 — 정보·팁·생활용품·제품 소개·재테크',
    hook: { font: 'Pretendard-ExtraBold', ink: '#0E1624', fill: '#FFFFFF', shape: 'rounded', shadow: true, emphasis: '#1E86C5', entrance: 'pop' },
    title: { font: 'Pretendard-ExtraBold', size: 0.85, ink: '#0E1624', fill: '#FFFFFF', shape: 'rounded', shadow: true, emphasis: '#1E86C5', entrance: 'pop' },
    info: { font: 'Pretendard-ExtraBold', ink: '#FFFFFF', fill: '#1A6FA3', shape: 'pill', emphasis: '#FFD600', entrance: 'pop' },
    narration: PRETENDARD_SUBTITLE,
    aside: { font: 'Pretendard-Bold', size: 0.9, ink: '#FFFFFF', outline: '#101622', outlineWidth: 16, entrance: 'pop' },
    label: { font: 'Pretendard-Bold', ink: '#FFFFFF', fill: '#1A6FA3', shape: 'pill' },
  },
  vlog: {
    suits: '브이로그·일상 — 자취·루틴·하루 기록·예능 톤',
    hook: { font: 'Jua-Regular', size: 1.15, ink: '#FFFFFF', outline: '#E0487A', outlineWidth: 18, shadow: true, emphasis: '#FFE066', entrance: 'pop' },
    title: { font: 'Jua-Regular', ink: '#FFFFFF', outline: '#2B2B2B', outlineWidth: 16, emphasis: '#FFE066', entrance: 'pop' },
    info: { font: 'Jua-Regular', ink: '#2B2B2B', fill: '#FFE066', shape: 'rounded', emphasis: '#E0487A', entrance: 'pop' },
    narration: { font: 'Jua-Regular', ink: '#FFFFFF', fill: '#000000B3', shape: 'rounded', emphasis: '#FFE066', entrance: 'fade' },
    aside: { font: 'NanumPen-Regular', size: 1.45, ink: '#FFFFFF', outline: '#2B2B2B', outlineWidth: 14, entrance: 'pop' },
    label: { font: 'Jua-Regular', ink: '#FFFFFF', fill: '#C2185B', shape: 'pill' },
  },
  news: {
    suits: '뉴스·속보 — 소식·발표·사건·정책·수치 브리핑',
    hook: { font: 'BlackHanSans-Regular', size: 1.05, ink: '#FFFFFF', fill: '#B3122B', shape: 'square', shadow: true, emphasis: '#FFE066', entrance: 'fade' },
    title: { font: 'BlackHanSans-Regular', size: 0.85, ink: '#FFFFFF', fill: '#0B2545', shape: 'square', emphasis: '#FFE066', entrance: 'fade' },
    info: { font: 'Pretendard-ExtraBold', ink: '#0B2545', fill: '#FFFFFF', shape: 'square', emphasis: '#B3122B', entrance: 'fade' },
    narration: { font: 'Pretendard-SemiBold', ink: '#FFFFFF', fill: '#0B2545D9', shape: 'square', entrance: 'fade' },
    aside: { font: 'Pretendard-Bold', size: 0.85, ink: '#FFFFFF', fill: '#0B2545D9', shape: 'square', entrance: 'fade' },
    label: { font: 'Pretendard-ExtraBold', ink: '#FFFFFF', fill: '#B3122B', shape: 'square' },
  },
  recipe: {
    suits: '레시피·요리 — 만들기·단계·재료·맛집 한 끼',
    hook: { font: 'Gaegu-Bold', size: 1.15, ink: '#3B2A1A', fill: '#FFF4DC', shape: 'rounded', shadow: true, emphasis: '#C4470A', entrance: 'pop' },
    title: { font: 'Gaegu-Bold', ink: '#3B2A1A', fill: '#FFF4DC', shape: 'rounded', shadow: true, emphasis: '#C4470A', entrance: 'pop' },
    info: { font: 'Gaegu-Bold', size: 1.1, ink: '#FFFFFF', fill: '#C4470A', shape: 'pill', emphasis: '#FFE066', entrance: 'pop' },
    narration: { ...PRETENDARD_SUBTITLE, outline: '#3B2A1A' },
    aside: { font: 'NanumPen-Regular', size: 1.45, ink: '#FFF4DC', outline: '#3B2A1A', outlineWidth: 14, entrance: 'pop' },
    label: { font: 'Gaegu-Bold', ink: '#FFFFFF', fill: '#C4470A', shape: 'pill' },
  },
  review: {
    suits: '리뷰·비교 — 써 보니·장단점·점수·이것 vs 저것',
    hook: { font: 'DoHyeon-Regular', size: 1.1, ink: '#111111', fill: '#FFFFFF', shape: 'square', shadow: true, emphasisFill: '#FFE066', entrance: 'pop' },
    title: { font: 'DoHyeon-Regular', ink: '#FFFFFF', outline: '#111111', outlineWidth: 16, emphasis: '#FFE066', entrance: 'pop' },
    info: { font: 'DoHyeon-Regular', size: 1.15, ink: '#FFE066', fill: '#111111', shape: 'rounded', emphasis: '#FFFFFF', entrance: 'pop' },
    narration: { ...PRETENDARD_SUBTITLE, outline: '#111111' },
    aside: { font: 'DoHyeon-Regular', size: 0.85, ink: '#FFFFFF', fill: '#111111CC', shape: 'pill', entrance: 'pop' },
    label: { font: 'DoHyeon-Regular', ink: '#FFE066', fill: '#111111', shape: 'pill' },
  },
  ad: {
    suits: '광고·혜택 — 할인·이벤트·신제품·매장 홍보',
    hook: { font: 'BlackHanSans-Regular', size: 1.15, ink: '#FFFFFF', outline: '#C92A2A', outlineWidth: 20, shadow: true, emphasis: '#FFE066', entrance: 'pop' },
    title: { font: 'BlackHanSans-Regular', ink: '#C92A2A', fill: '#FFFFFF', shape: 'rounded', shadow: true, emphasis: '#1A1A1A', entrance: 'pop' },
    info: { font: 'BlackHanSans-Regular', size: 1.15, ink: '#1A1A1A', fill: '#FFE066', shape: 'pill', emphasis: '#C92A2A', entrance: 'pop' },
    narration: { font: 'Pretendard-Bold', ink: '#FFFFFF', outline: '#1A1A1A', outlineWidth: 14, entrance: 'fade' },
    aside: { font: 'Pretendard-ExtraBold', size: 0.9, ink: '#FFFFFF', fill: '#C92A2A', shape: 'pill', entrance: 'pop' },
    label: { font: 'Pretendard-ExtraBold', ink: '#1A1A1A', fill: '#FFE066', shape: 'pill' },
  },
  drama: {
    suits: '스토리·숏드라마 — 상황극·사연·반전 이야기',
    hook: { font: 'GowunBatang-Bold', size: 0.95, ink: '#FFFFFF', shadow: true, outline: '#000000', outlineWidth: 6, emphasis: '#FFD8A8', entrance: 'fade' },
    title: { font: 'GowunBatang-Bold', size: 0.8, ink: '#FFFFFF', shadow: true, outline: '#000000', outlineWidth: 6, entrance: 'fade' },
    info: { font: 'GowunBatang-Bold', size: 0.8, ink: '#FFFFFF', fill: '#000000A6', shape: 'square', entrance: 'fade' },
    narration: { font: 'Pretendard-SemiBold', ink: '#FFFFFF', shadow: true, outline: '#000000', outlineWidth: 8, entrance: 'fade' },
    aside: { font: 'GowunBatang-Bold', size: 0.85, ink: '#FFFFFF', shadow: true, outline: '#000000', outlineWidth: 8, entrance: 'fade' },
    label: { font: 'GowunBatang-Bold', ink: '#FFFFFF', fill: '#000000A6', shape: 'square' },
  },
  calm: {
    suits: '감성·공간 — 인테리어·여행·브랜드·카페·힐링',
    hook: { font: 'GowunBatang-Bold', ink: '#FFFFFF', shadow: true, outline: '#2A2A2A', outlineWidth: 6, emphasis: '#F1E3C8', entrance: 'fade' },
    title: { font: 'GowunBatang-Bold', size: 0.8, ink: '#FFFFFF', shadow: true, outline: '#2A2A2A', outlineWidth: 6, entrance: 'fade' },
    info: { font: 'Pretendard-SemiBold', size: 0.8, ink: '#FFFFFF', fill: '#00000080', shape: 'rounded', entrance: 'fade' },
    narration: { font: 'Pretendard-SemiBold', ink: '#FFFFFF', shadow: true, outline: '#2A2A2A', outlineWidth: 6, entrance: 'fade' },
    aside: { font: 'GowunBatang-Bold', size: 0.85, ink: '#FFFFFF', shadow: true, outline: '#2A2A2A', outlineWidth: 6, entrance: 'fade' },
    label: { font: 'Pretendard-SemiBold', ink: '#FFFFFF', fill: '#000000A6', shape: 'pill' },
  },
}

const ROLE_KEY = { dialogue: 'narration' }

export function designFor(look, role) {
  const chosen = LOOKS[look] ?? LOOKS.clean
  return chosen[ROLE_KEY[role] ?? role]
}

// 이 묶음이 쓰는 글꼴 이름들(받아 둘 것).
export function lookFonts(look) {
  const chosen = LOOKS[look] ?? LOOKS.clean
  return [...new Set(LOOK_ROLES.map((role) => chosen[role].font))]
}
