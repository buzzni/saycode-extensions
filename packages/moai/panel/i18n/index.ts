/**
 * The panel's words in English, Korean, Japanese and Chinese. The top level is carried over from the 1.x
 * panel; newer words live in one group per area (`shell`, `list`, `board`, `detail`), each with its own
 * interface and its four languages side by side below, so the stages that build those areas add their words
 * inside their own group without touching another's lines.
 */
import type { RefusalCode } from '../data/client.js'
import type { GrepScope, SortKey } from '../data/query.js'

export type Language = 'en' | 'ko' | 'ja' | 'zh'

// ── shell: tab bar, toggles, path line, add field (E2 se-qwkz.2v9) ────────────────────────────────────

export interface ShellCopy {
  /** Accessible name of the tab strip. */
  tabsLabel: string
  tabs: { board: string; list: string; wiki: string }
  /** The position toggle's name says what pressing does; under 640px it says why it is off. */
  detailToLeft: string
  detailToBottom: string
  detailForcedBottom: string
  showDetail: string
  hideDetail: string
  resizer: string
  /** The refresh-time button before the first read finished. */
  refreshNow: string
  /** Accessible name of the path line. */
  pathLabel: string
  /** The root of the path, as the TUI writes it. */
  rootSegment: string
  /** `{names} hidden` — the view toggles that hide rows. */
  hidden: (names: string[]) => string
  deferred: string
  backlog: string
  /** `sort {by}` — only when the order is not the default. */
  sorted: (by: string) => string
  sortFields: Record<SortKey, string>
  /** After the order's words when the whole list is turned around. */
  reversed: string
  /** After a search or filter badge: how to take it off. */
  clearHint: string
  addLabel: string
  wikiPlaceholder: string
  /** The wiki tab with no wiki reads to call (the data layer has not given them). */
  wikiUnavailable: string
  /** `wiki ls` failed; the reason follows. */
  wikiListFailed: (reason: string) => string
}

const SHELL: Record<Language, ShellCopy> = {
  en: {
    tabsLabel: 'Moai views',
    tabs: { board: 'Board', list: 'List', wiki: 'Wiki' },
    detailToLeft: 'Move details to the left',
    detailToBottom: 'Move details to the bottom',
    detailForcedBottom: 'Details stay at the bottom while the panel is narrower than 640px',
    showDetail: 'Show details',
    hideDetail: 'Hide details',
    resizer: 'Resize details',
    refreshNow: 'Refresh',
    pathLabel: 'Current place',
    rootSegment: '/',
    hidden: (names) => `${names.join(' · ')} hidden`,
    deferred: 'deferred',
    backlog: 'backlog',
    sorted: (by) => `sort ${by}`,
    sortFields: { priority: 'priority', created: 'created', updated: 'updated', status: 'status', assignee: 'assignee', title: 'title', id: 'id' },
    reversed: '(reversed)',
    clearHint: 'Esc clears it',
    addLabel: 'New task title',
    wikiPlaceholder: 'The wiki is not here yet.',
    wikiUnavailable: 'The wiki cannot be read here yet.',
    wikiListFailed: (reason) => `The wiki pages could not be read: ${reason}`,
  },
  ko: {
    tabsLabel: 'Moai 보기',
    tabs: { board: '칸반', list: '목록', wiki: '위키' },
    detailToLeft: '상세를 왼쪽으로',
    detailToBottom: '상세를 아래로',
    detailForcedBottom: '패널 폭이 640px보다 좁아서 상세는 아래에 둡니다',
    showDetail: '상세 보이기',
    hideDetail: '상세 숨기기',
    resizer: '상세 크기 조절',
    refreshNow: '새로고침',
    pathLabel: '현재 경로',
    rootSegment: '/',
    hidden: (names) => `${names.join(' · ')} 숨김`,
    deferred: '미룸',
    backlog: '백로그',
    sorted: (by) => `정렬 ${by}`,
    sortFields: { priority: '우선순위', created: '만든 날', updated: '고친 날', status: '칸', assignee: '담당', title: '제목', id: 'ID' },
    reversed: '(뒤집음)',
    clearHint: 'Esc로 해제',
    addLabel: '새 할 일 제목',
    wikiPlaceholder: '위키는 아직 준비 중입니다.',
    wikiUnavailable: '아직 여기서는 위키를 읽을 수 없습니다.',
    wikiListFailed: (reason) => `위키 페이지 목록을 읽지 못했습니다: ${reason}`,
  },
  ja: {
    tabsLabel: 'Moai ビュー',
    tabs: { board: 'カンバン', list: '一覧', wiki: 'Wiki' },
    detailToLeft: '詳細を左へ',
    detailToBottom: '詳細を下へ',
    detailForcedBottom: 'パネルの幅が 640px 未満のため、詳細は下に置きます',
    showDetail: '詳細を表示',
    hideDetail: '詳細を隠す',
    resizer: '詳細のサイズを変更',
    refreshNow: '再読み込み',
    pathLabel: '現在の場所',
    rootSegment: '/',
    hidden: (names) => `${names.join(' · ')} 非表示`,
    deferred: '保留',
    backlog: 'バックログ',
    sorted: (by) => `並べ替え ${by}`,
    sortFields: { priority: '優先度', created: '作成', updated: '更新', status: '列', assignee: '担当', title: 'タイトル', id: 'ID' },
    reversed: '(逆順)',
    clearHint: 'Esc で解除',
    addLabel: '新しいタスクのタイトル',
    wikiPlaceholder: 'Wiki はまだ準備中です。',
    wikiUnavailable: 'ここではまだ Wiki を読めません。',
    wikiListFailed: (reason) => `Wiki のページ一覧を読めませんでした: ${reason}`,
  },
  zh: {
    tabsLabel: 'Moai 视图',
    tabs: { board: '看板', list: '列表', wiki: 'Wiki' },
    detailToLeft: '将详情移到左侧',
    detailToBottom: '将详情移到底部',
    detailForcedBottom: '面板宽度小于 640px，详情固定在底部',
    showDetail: '显示详情',
    hideDetail: '隐藏详情',
    resizer: '调整详情大小',
    refreshNow: '刷新',
    pathLabel: '当前位置',
    rootSegment: '/',
    hidden: (names) => `已隐藏 ${names.join(' · ')}`,
    deferred: '推迟',
    backlog: '待办池',
    sorted: (by) => `排序 ${by}`,
    sortFields: { priority: '优先级', created: '创建', updated: '更新', status: '列', assignee: '负责人', title: '标题', id: 'ID' },
    reversed: '(反向)',
    clearHint: '按 Esc 清除',
    addLabel: '新任务标题',
    wikiPlaceholder: 'Wiki 尚未就绪。',
    wikiUnavailable: '这里暂时无法读取 Wiki。',
    wikiListFailed: (reason) => `无法读取 Wiki 页面列表: ${reason}`,
  },
}

// ── list: the tree list (E3 se-c10x) ─────────────────────────────────────────────────────────────────

export interface ListCopy {
  /** Accessible name of the list. */
  label: string
  /** The `..` line's name: one level up. */
  upLabel: string
  /** The ▸ button in front of a folder. */
  expand: string
  collapse: string
  /** Column heads of the name line. */
  heads: { id: string; priority: string; status: string; title: string; counts: string; tags: string; epic: string; assignee: string; created: string; updated: string }
  /** A column head's name when clicking it sorts by that column. */
  sortBy: (column: string) => string
  /** What the view toggles hide under this place. */
  hiddenCount: (n: number) => string
  /** Lifts the status, deferred and backlog hiding (`SPC v a`); archived rows stay hidden. */
  showAll: string
  /** After the title of a row the view hides that a search shows anyway. */
  hiddenMark: string
}

const LIST: Record<Language, ListCopy> = {
  en: {
    label: 'Tasks',
    upLabel: 'Up one level',
    expand: 'Expand',
    collapse: 'Collapse',
    heads: { id: 'ID', priority: 'P', status: 'Status', title: 'Title', counts: 'Done', tags: 'Tags', epic: 'Epic', assignee: 'Assignee', created: 'Created', updated: 'Updated' },
    sortBy: (column) => `Sort by ${column}`,
    hiddenCount: (n) => `${n} hidden`,
    showAll: 'Show all',
    hiddenMark: 'hidden',
  },
  ko: {
    label: '할 일 목록',
    upLabel: '한 층 위로',
    expand: '펼치기',
    collapse: '접기',
    heads: { id: 'ID', priority: 'P', status: '상태', title: '제목', counts: '완료', tags: '태그', epic: '에픽', assignee: '담당', created: '만든 날', updated: '고친 날' },
    sortBy: (column) => `${column}(으)로 정렬`,
    hiddenCount: (n) => `${n}개 숨김`,
    showAll: '모두 보이기',
    hiddenMark: '숨김',
  },
  ja: {
    label: 'タスク一覧',
    upLabel: '一つ上の階層へ',
    expand: '展開',
    collapse: '折りたたむ',
    heads: { id: 'ID', priority: 'P', status: '状態', title: 'タイトル', counts: '完了', tags: 'タグ', epic: 'エピック', assignee: '担当', created: '作成', updated: '更新' },
    sortBy: (column) => `${column}で並べ替え`,
    hiddenCount: (n) => `${n} 件を非表示`,
    showAll: 'すべて表示',
    hiddenMark: '非表示',
  },
  zh: {
    label: '任务列表',
    upLabel: '返回上一层',
    expand: '展开',
    collapse: '折叠',
    heads: { id: 'ID', priority: 'P', status: '状态', title: '标题', counts: '完成', tags: '标签', epic: '史诗', assignee: '负责人', created: '创建', updated: '更新' },
    sortBy: (column) => `按${column}排序`,
    hiddenCount: (n) => `已隐藏 ${n} 项`,
    showAll: '全部显示',
    hiddenMark: '已隐藏',
  },
}

// ── board: the kanban (E3 se-c10x) ───────────────────────────────────────────────────────────────────

export interface BoardCopy {
  /** Accessible name of the board. */
  label: string
  /** Accessible name of a status column: its name and card count. */
  columnLabel: (name: string, count: number) => string
  /** An empty column. */
  noCards: string
}

const BOARD: Record<Language, BoardCopy> = {
  en: {
    label: 'Board',
    columnLabel: (name, count) => `${name}, ${count} ${count === 1 ? 'card' : 'cards'}`,
    noCards: 'No cards',
  },
  ko: {
    label: '칸반',
    columnLabel: (name, count) => `${name}, 카드 ${count}장`,
    noCards: '카드 없음',
  },
  ja: {
    label: 'カンバン',
    columnLabel: (name, count) => `${name}、カード ${count} 枚`,
    noCards: 'カードなし',
  },
  zh: {
    label: '看板',
    columnLabel: (name, count) => `${name}，${count} 张卡片`,
    noCards: '没有卡片',
  },
}

// ── detail: the detail pane (E3 se-c10x) ─────────────────────────────────────────────────────────────

export interface DetailCopy {
  /** Accessible name of the detail pane. */
  label: string
  /** The pane is shown but nothing is chosen. */
  none: string
  /** Labels of the fields under the head line. */
  assignee: string
  created: string
  updated: string
  started: string
  ended: string
  due: string
  epic: string
  milestone: string
  blockedBy: string
  blocks: string
  deferred: string
  /** A row put off because the epic, milestone or parent it stands under is (`shelved_by`). */
  deferredUnder: (id: string) => string
  /** A blocker's state: finished, still open, put off, or not in the index. */
  blockerDone: string
  blockerOpen: string
  blockerDeferred: string
  blockerMissing: string
  /** Roll-up of a group: `{done}/{work} done · {percent}%`. */
  rollup: string
  rollupText: (done: number, work: number, percent: number | undefined) => string
  body: string
  commits: string
  journal: string
  noJournal: string
  work: string
  subtasks: string
  kinds: Record<string, string>
  /** The head line's pN. */
  priority: (n: number) => string
  /** Words of a journal line. */
  created_entry: string
  /** The detail's read failed; the reason follows from the refusal words. */
  problem: string
  close: string
}

const DETAIL: Record<Language, DetailCopy> = {
  en: {
    label: 'Details',
    none: 'Choose a task to see its details.',
    assignee: 'Assignee', created: 'Created', updated: 'Updated', started: 'Started', ended: 'Ended', due: 'Due', epic: 'Epic', milestone: 'Milestone',
    blockedBy: 'Blocked by', blocks: 'Blocks', deferred: 'Deferred',
    deferredUnder: (id) => `Deferred — under ${id}`,
    blockerDone: 'done', blockerOpen: 'open', blockerDeferred: 'deferred', blockerMissing: 'not found',
    rollup: 'Progress', rollupText: (done, work, percent) => `${done}/${work} done${percent === undefined ? '' : ` · ${percent}%`}`,
    body: 'Description', commits: 'Commits', journal: 'History', noJournal: 'No history yet', work: 'Work log', subtasks: 'Subtasks',
    kinds: { issue: 'task', epic: 'epic', milestone: 'milestone', backlog: 'backlog' },
    priority: (n) => `P${n}`, created_entry: 'Created', problem: 'The details could not be read.', close: 'Close details',
  },
  ko: {
    label: '상세',
    none: '할 일을 고르면 상세가 여기에 나옵니다.',
    assignee: '담당자', created: '만든 시각', updated: '고친 시각', started: '시작', ended: '끝남', due: '마감', epic: '에픽', milestone: '마일스톤',
    blockedBy: '막는 것', blocks: '막고 있는 것', deferred: '미룸',
    deferredUnder: (id) => `미룸 — ${id} 아래`,
    blockerDone: '끝남', blockerOpen: '열림', blockerDeferred: '미룸', blockerMissing: '없음',
    rollup: '진척', rollupText: (done, work, percent) => `${done}/${work} 완료${percent === undefined ? '' : ` · ${percent}%`}`,
    body: '본문', commits: '커밋', journal: '기록', noJournal: '아직 기록이 없습니다', work: '작업 기록', subtasks: '하위 항목',
    kinds: { issue: '할 일', epic: '에픽', milestone: '마일스톤', backlog: '백로그' },
    priority: (n) => `P${n}`, created_entry: '만들었습니다', problem: '상세를 읽지 못했습니다.', close: '상세 닫기',
  },
  ja: {
    label: '詳細',
    none: 'タスクを選ぶと、ここに詳細が表示されます。',
    assignee: '担当者', created: '作成', updated: '更新', started: '開始', ended: '終了', due: '期限', epic: 'エピック', milestone: 'マイルストーン',
    blockedBy: 'ブロック元', blocks: 'ブロック先', deferred: '保留',
    deferredUnder: (id) => `保留 — ${id} の配下`,
    blockerDone: '完了', blockerOpen: '未完了', blockerDeferred: '保留', blockerMissing: '見つからない',
    rollup: '進捗', rollupText: (done, work, percent) => `${done}/${work} 完了${percent === undefined ? '' : ` · ${percent}%`}`,
    body: '本文', commits: 'コミット', journal: '履歴', noJournal: '履歴はまだありません', work: '作業ログ', subtasks: 'サブタスク',
    kinds: { issue: 'タスク', epic: 'エピック', milestone: 'マイルストーン', backlog: 'バックログ' },
    priority: (n) => `P${n}`, created_entry: '作成しました', problem: '詳細を読み込めませんでした。', close: '詳細を閉じる',
  },
  zh: {
    label: '详情',
    none: '选择任务后，详情会显示在这里。',
    assignee: '负责人', created: '创建', updated: '更新', started: '开始', ended: '结束', due: '截止', epic: '史诗', milestone: '里程碑',
    blockedBy: '被阻塞于', blocks: '阻塞', deferred: '已搁置',
    deferredUnder: (id) => `已搁置 — 隶属于 ${id}`,
    blockerDone: '已完成', blockerOpen: '未完成', blockerDeferred: '已搁置', blockerMissing: '未找到',
    rollup: '进度', rollupText: (done, work, percent) => `${done}/${work} 完成${percent === undefined ? '' : ` · ${percent}%`}`,
    body: '正文', commits: '提交', journal: '历史', noJournal: '暂无历史', work: '工作记录', subtasks: '子任务',
    kinds: { issue: '任务', epic: '史诗', milestone: '里程碑', backlog: '待办池' },
    priority: (n) => `P${n}`, created_entry: '已创建', problem: '无法读取详情。', close: '关闭详情',
  },
}

// ── toolbar: search, filter and sort above the list and board (E4 se-cv7w) ───────────────────────────

/** Why the list would hide a row that a search shows (view/list-model.ts viewHides): the view toggle that hides it. */
export type HiddenReason = 'column' | 'deferred' | 'backlog' | 'archived'

export interface ToolbarCopy {
  search: string
  searchPlaceholder: string
  /** Accessible name of the search scope select. */
  scope: string
  scopes: Record<GrepScope, string>
  filter: string
  filterPlaceholder: string
  removeChip: string
  /** Accessible name of the filter's suggestion list. */
  hints: string
  sort: string
  sortEdit: string
  reversed: string
  replace: string
  append: string
  flip: string
  sortKeys: Record<SortKey, string>
  /** `N hidden` — rows the search shows that the view hides. */
  hidden: (n: number) => string
  hiddenReasons: Record<HiddenReason, string>
}

const TOOLBAR: Record<Language, ToolbarCopy> = {
  en: {
    search: 'Search', searchPlaceholder: 'Search (/)', scope: 'Search in',
    scopes: { all: 'All', id: 'ID', title: 'Title', tag: 'Tag', body: 'Body', note: 'Note' },
    filter: 'Filter', filterPlaceholder: 'status=todo tag=bug,ui (Enter applies)', removeChip: 'Remove filter item', hints: 'Suggestions',
    sort: 'Sort', sortEdit: 'Edit sort', reversed: 'reversed', replace: 'Only this', append: 'Add', flip: 'Flip direction',
    sortKeys: { priority: 'Priority', created: 'Created', updated: 'Updated', status: 'Status', assignee: 'Assignee', title: 'Title', id: 'ID' },
    hidden: (n) => `${n} hidden`,
    hiddenReasons: { column: 'hidden column', deferred: 'deferred', backlog: 'backlog', archived: 'archived' },
  },
  ko: {
    search: '검색', searchPlaceholder: '검색 (/)', scope: '검색 범위',
    scopes: { all: '전체', id: 'ID', title: '제목', tag: '태그', body: '본문', note: '메모' },
    filter: '필터', filterPlaceholder: 'status=todo tag=bug,ui (Enter로 적용)', removeChip: '필터 항목 지우기', hints: '자동 완성',
    sort: '정렬', sortEdit: '정렬 편집', reversed: '뒤집힘', replace: '이것만', append: '추가', flip: '방향 바꿈',
    sortKeys: { priority: '우선순위', created: '만든 때', updated: '고친 때', status: '상태', assignee: '담당', title: '제목', id: 'ID' },
    hidden: (n) => `${n}건 숨김`,
    hiddenReasons: { column: '숨긴 칸', deferred: '미룸', backlog: '백로그', archived: '보관' },
  },
  ja: {
    search: '検索', searchPlaceholder: '検索 (/)', scope: '検索範囲',
    scopes: { all: 'すべて', id: 'ID', title: 'タイトル', tag: 'タグ', body: '本文', note: 'メモ' },
    filter: 'フィルター', filterPlaceholder: 'status=todo tag=bug,ui (Enter で適用)', removeChip: 'フィルター項目を削除', hints: '候補',
    sort: '並べ替え', sortEdit: '並べ替えを編集', reversed: '逆順', replace: 'これだけ', append: '追加', flip: '向きを反転',
    sortKeys: { priority: '優先度', created: '作成', updated: '更新', status: '状態', assignee: '担当', title: 'タイトル', id: 'ID' },
    hidden: (n) => `${n} 件を非表示`,
    hiddenReasons: { column: '非表示の列', deferred: '保留', backlog: 'バックログ', archived: 'アーカイブ' },
  },
  zh: {
    search: '搜索', searchPlaceholder: '搜索 (/)', scope: '搜索范围',
    scopes: { all: '全部', id: 'ID', title: '标题', tag: '标签', body: '正文', note: '备注' },
    filter: '筛选', filterPlaceholder: 'status=todo tag=bug,ui (按 Enter 应用)', removeChip: '删除筛选项', hints: '建议',
    sort: '排序', sortEdit: '编辑排序', reversed: '反向', replace: '仅此项', append: '添加', flip: '反转方向',
    sortKeys: { priority: '优先级', created: '创建', updated: '更新', status: '状态', assignee: '负责人', title: '标题', id: 'ID' },
    hidden: (n) => `已隐藏 ${n} 项`,
    hiddenReasons: { column: '隐藏的列', deferred: '推迟', backlog: '待办池', archived: '已归档' },
  },
}

// ── keys: the key router's words (se-jwl3); the key table's own labels live in keys/table.ts ─────────────

export interface KeysCopy {
  /** Shown while the panel's frame has no keyboard focus (the host does not give it one). */
  focusHint: string
  /** `r`, `SPC m a`, `SPC m g` before the data layer that writes read marks is merged. */
  readUnavailable: string
  /** `D` in the sort editor: the panel has nowhere to keep a default order yet. */
  sortDefaultUnavailable: string
}

const KEYS: Record<Language, KeysCopy> = {
  en: {
    focusHint: 'Click to use the keyboard',
    readUnavailable: 'Marking items read is not available in the panel yet.',
    sortDefaultUnavailable: 'Saving a default sort is not available in the panel yet.',
  },
  ko: {
    focusHint: '클릭하면 키보드를 쓸 수 있습니다',
    readUnavailable: '읽음 표시는 아직 패널에서 쓸 수 없습니다.',
    sortDefaultUnavailable: '기본 정렬 저장은 아직 패널에서 쓸 수 없습니다.',
  },
  ja: {
    focusHint: 'クリックするとキーボードを使えます',
    readUnavailable: '既読の記録はまだパネルでは使えません。',
    sortDefaultUnavailable: '既定の並べ替えの保存はまだパネルでは使えません。',
  },
  zh: {
    focusHint: '点击后即可使用键盘',
    readUnavailable: '面板中暂时还不能标记为已读。',
    sortDefaultUnavailable: '面板中暂时还不能保存默认排序。',
  },
}

// ── the 1.x words, and the groups put together ───────────────────────────────────────────────────────

export interface Copy {
  hint: string
  refreshedAt: (time: string) => string
  empty: string
  more: (n: number) => string
  up: string
  root: string
  noMilestone: string
  lost: string
  loading: string
  starting: string
  running: string
  cancel: string
  cancelled: string
  mayContinue: string
  placeholder: string
  add: string
  titleRequired: string
  added: (task: { id: string; title?: string }) => string
  stats: Record<string, string>
  notStarted: string
  moaiError: (message: string) => string
  failed: string
  unreadable: string
  refused: Record<RefusalCode, string>
  notInitialized: [string, string]
  shell: ShellCopy
  list: ListCopy
  board: BoardCopy
  detail: DetailCopy
  toolbar: ToolbarCopy
  keys: KeysCopy
}

const en: Copy = {
  hint: "Runs in this project's folder. A confirmation showing the machine and folder appears once per session each for the list and details, and every time you add a task.",
  refreshedAt: (time) => `Updated ${time}`, empty: 'Nothing here.', more: (n) => `${n} more not shown`,
  up: '..', root: 'All', noMilestone: '(no milestone)', lost: '(lost)', loading: 'Loading…',
  starting: 'Starting… approve the confirmation if it is showing.', running: 'Running on the machine…',
  cancel: 'Cancel', cancelled: 'The run was cancelled.', mayContinue: 'Processes on the machine may not have finished yet.',
  placeholder: 'New task title', add: 'Add task', titleRequired: 'Enter a task title.', added: (t) => `Added: ${t.title} (${t.id})`,
  stats: { todo: 'To do', in_progress: 'In progress', review: 'Review', done: 'Done' },
  notStarted: 'The run did not start. It may have been declined, or this machine does not support Moai yet.',
  moaiError: (message) => `Moai reported an error: ${message}`, failed: 'The run failed.', unreadable: 'The run finished, but its result could not be read.',
  refused: {
    declined: 'The run did not start: the confirmation was declined.',
    'approval-timeout': 'The confirmation was not answered in time, so nothing ran. Try again.',
    'workspace-busy': 'Another change is still running in this folder on that machine. Try again when it finishes.',
    'tool-missing': 'Moai is not installed on that machine. Install it for that machine under Machine tools in Settings → Extensions.',
    'unsupported-platform': "Moai cannot run on that machine's operating system.",
    'unsupported-daemon': "That machine's Saycode runtime is too old to run Moai. Update the runtime, then try again.",
  },
  notInitialized: ['This project has no Moai board yet. On that machine, run ', ' once in the project folder, then try again. If moai is not found, run it from the Moai path shown under Machine tools in Settings → Extensions.'],
  shell: SHELL.en, list: LIST.en, board: BOARD.en, detail: DETAIL.en, toolbar: TOOLBAR.en, keys: KEYS.en,
}

const ko: Copy = {
  hint: '이 프로젝트 폴더에서 실행됩니다. 목록·상세는 앱을 켜 둔 동안 각각 처음 한 번, 할 일 추가는 매번 머신과 폴더를 보여주는 확인 창이 뜹니다.',
  refreshedAt: (time) => `${time} 갱신`, empty: '항목이 없습니다.', more: (n) => `그 밖에 ${n}개는 표시하지 않았습니다`,
  up: '..', root: '전체', noMilestone: '(마일스톤 없음)', lost: '(길 잃음)', loading: '불러오는 중…',
  starting: '시작하는 중… 확인 창이 떠 있으면 승인하세요.', running: '머신에서 실행하는 중…',
  cancel: '취소', cancelled: '실행을 취소했습니다.', mayContinue: '머신에서 프로세스가 아직 끝나지 않았을 수 있습니다.',
  placeholder: '새 할 일 제목', add: '할 일 추가', titleRequired: '할 일 제목을 입력하세요.', added: (t) => `추가했습니다: ${t.title} (${t.id})`,
  stats: { todo: '할 일', in_progress: '진행 중', review: '검토', done: '완료' },
  notStarted: '실행이 시작되지 않았습니다. 확인 창에서 거부했거나, 이 머신이 아직 Moai를 지원하지 않을 수 있습니다.',
  moaiError: (message) => `Moai 오류: ${message}`, failed: '실행에 실패했습니다.', unreadable: '실행은 끝났지만 결과를 읽지 못했습니다.',
  refused: {
    declined: '확인 창에서 거부해 실행하지 않았습니다.',
    'approval-timeout': '확인 창에 시간 안에 응답하지 않아 실행하지 않았습니다. 다시 시도하세요.',
    'workspace-busy': '그 머신의 이 폴더에서 다른 변경이 아직 실행 중입니다. 끝난 뒤 다시 시도하세요.',
    'tool-missing': '그 머신에 Moai가 설치되어 있지 않습니다. 설정 → 확장의 머신 도구에서 그 머신에 Moai를 설치하세요.',
    'unsupported-platform': '그 머신의 운영체제에서는 Moai를 실행할 수 없습니다.',
    'unsupported-daemon': '그 머신의 Saycode 런타임이 오래되어 Moai를 실행할 수 없습니다. 런타임을 업데이트한 뒤 다시 시도하세요.',
  },
  notInitialized: ['이 프로젝트에는 아직 Moai 보드가 없습니다. 그 머신의 프로젝트 폴더에서 ', '을 한 번 실행한 뒤 다시 시도하세요. moai를 찾을 수 없으면 설정 → 확장의 머신 도구에 표시된 Moai 경로로 실행하세요.'],
  shell: SHELL.ko, list: LIST.ko, board: BOARD.ko, detail: DETAIL.ko, toolbar: TOOLBAR.ko, keys: KEYS.ko,
}

const ja: Copy = {
  hint: 'このプロジェクトのフォルダで実行します。一覧・詳細はアプリの起動中にそれぞれ最初の一回、タスクの追加は毎回、マシンとフォルダを示す確認画面が表示されます。',
  refreshedAt: (time) => `${time} 更新`, empty: '項目はありません。', more: (n) => `ほかに ${n} 件は表示していません`,
  up: '..', root: 'すべて', noMilestone: '(マイルストーンなし)', lost: '(迷子)', loading: '読み込み中…',
  starting: '開始しています… 確認画面が表示されていれば承認してください。', running: 'マシンで実行中…',
  cancel: 'キャンセル', cancelled: '実行をキャンセルしました。', mayContinue: 'マシン上のプロセスはまだ終了していない可能性があります。',
  placeholder: '新しいタスクのタイトル', add: 'タスクを追加', titleRequired: 'タスクのタイトルを入力してください。', added: (t) => `追加しました: ${t.title} (${t.id})`,
  stats: { todo: '未着手', in_progress: '進行中', review: 'レビュー', done: '完了' },
  notStarted: '実行が開始されませんでした。確認画面で拒否されたか、このマシンがまだ Moai に対応していない可能性があります。',
  moaiError: (message) => `Moai のエラー: ${message}`, failed: '実行に失敗しました。', unreadable: '実行は完了しましたが、結果を読み取れませんでした。',
  refused: {
    declined: '確認画面で拒否されたため、実行しませんでした。',
    'approval-timeout': '確認画面に時間内に応答がなかったため、実行しませんでした。もう一度お試しください。',
    'workspace-busy': 'そのマシンのこのフォルダでは、別の変更がまだ実行中です。終了してからもう一度お試しください。',
    'tool-missing': 'そのマシンに Moai がインストールされていません。設定 → 拡張機能のマシンツールから、そのマシンに Moai をインストールしてください。',
    'unsupported-platform': 'そのマシンの OS では Moai を実行できません。',
    'unsupported-daemon': 'そのマシンの Saycode ランタイムが古いため、Moai を実行できません。ランタイムを更新してから、もう一度お試しください。',
  },
  notInitialized: ['このプロジェクトにはまだ Moai ボードがありません。そのマシンのプロジェクトフォルダで ', ' を一度実行してから、もう一度お試しください。moai が見つからない場合は、設定 → 拡張機能のマシンツールに表示される Moai のパスから実行してください。'],
  shell: SHELL.ja, list: LIST.ja, board: BOARD.ja, detail: DETAIL.ja, toolbar: TOOLBAR.ja, keys: KEYS.ja,
}

const zh: Copy = {
  hint: '在此项目的文件夹中运行。列表和详情在应用运行期间各确认一次，每次添加任务都会确认，确认窗口会显示机器和文件夹。',
  refreshedAt: (time) => `${time} 更新`, empty: '没有项目。', more: (n) => `另有 ${n} 项未显示`,
  up: '..', root: '全部', noMilestone: '(无里程碑)', lost: '(无归属)', loading: '加载中…',
  starting: '正在启动… 如果显示了确认窗口，请批准。', running: '正在机器上运行…',
  cancel: '取消', cancelled: '已取消运行。', mayContinue: '机器上的进程可能尚未结束。',
  placeholder: '新任务标题', add: '添加任务', titleRequired: '请输入任务标题。', added: (t) => `已添加: ${t.title} (${t.id})`,
  stats: { todo: '待办', in_progress: '进行中', review: '审核', done: '完成' },
  notStarted: '运行未开始。可能在确认窗口中被拒绝，或此机器尚不支持 Moai。',
  moaiError: (message) => `Moai 错误: ${message}`, failed: '运行失败。', unreadable: '运行已结束，但无法读取结果。',
  refused: {
    declined: '已在确认窗口中拒绝，因此未运行。',
    'approval-timeout': '未在规定时间内回应确认窗口，因此未运行。请重试。',
    'workspace-busy': '该机器的此文件夹中仍有其他更改正在运行。请在其结束后重试。',
    'tool-missing': '该机器上未安装 Moai。请在「设置 → 扩展」的机器工具中为该机器安装 Moai。',
    'unsupported-platform': '该机器的操作系统无法运行 Moai。',
    'unsupported-daemon': '该机器的 Saycode 运行时版本过旧，无法运行 Moai。请更新运行时后重试。',
  },
  notInitialized: ['此项目还没有 Moai 看板。请在该机器的项目文件夹中运行一次 ', '，然后重试。如果找不到 moai，请使用「设置 → 扩展」的机器工具中显示的 Moai 路径运行。'],
  shell: SHELL.zh, list: LIST.zh, board: BOARD.zh, detail: DETAIL.zh, toolbar: TOOLBAR.zh, keys: KEYS.zh,
}

export const COPY: Record<Language, Copy> = { en, ko, ja, zh }

/** The host document's language, else the browser's, else English. */
export function copyFor(language: string | undefined): Copy {
  const base = (language || 'en').split('-')[0]!.toLowerCase()
  return COPY[base as Language] ?? en
}
