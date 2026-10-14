/** The panel's words in English, Korean, Japanese and Chinese, carried over from the 1.x panel. */
import type { RefusalCode } from '../data/client.js'

export interface Copy {
  hint: string
  refresh: string
  refreshedAt: (time: string) => string
  board: string
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
  fields: { status: string; priority: string; assignee: string; created: string; id: string; epic: string; milestone: string }
  children: string
  noChildren: string
  journal: string
  createdEntry: string
  closeDetail: string
  stats: Record<string, string>
  notStarted: string
  moaiError: (message: string) => string
  failed: string
  unreadable: string
  refused: Record<RefusalCode, string>
  notInitialized: [string, string]
}

const en: Copy = {
  hint: "Runs in this project's folder. A confirmation showing the machine and folder appears once per session each for the list and details, and every time you add a task.",
  refresh: 'Refresh', refreshedAt: (time) => `Updated ${time}`, board: 'Tasks', empty: 'Nothing here.', more: (n) => `${n} more not shown`,
  up: '..', root: 'All', noMilestone: '(no milestone)', lost: '(lost)', loading: 'Loading…',
  starting: 'Starting… approve the confirmation if it is showing.', running: 'Running on the machine…',
  cancel: 'Cancel', cancelled: 'The run was cancelled.', mayContinue: 'Processes on the machine may not have finished yet.',
  placeholder: 'New task title', add: 'Add task', titleRequired: 'Enter a task title.', added: (t) => `Added: ${t.title} (${t.id})`,
  fields: { status: 'Status', priority: 'Priority', assignee: 'Assignee', created: 'Created', id: 'ID', epic: 'Epic', milestone: 'Milestone' },
  children: 'Subtasks', noChildren: 'No subtasks', journal: 'History', createdEntry: 'Created', closeDetail: 'Close details',
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
}

const ko: Copy = {
  hint: '이 프로젝트 폴더에서 실행됩니다. 목록·상세는 앱을 켜 둔 동안 각각 처음 한 번, 할 일 추가는 매번 머신과 폴더를 보여주는 확인 창이 뜹니다.',
  refresh: '새로고침', refreshedAt: (time) => `${time} 갱신`, board: '할 일 목록', empty: '항목이 없습니다.', more: (n) => `그 밖에 ${n}개는 표시하지 않았습니다`,
  up: '..', root: '전체', noMilestone: '(마일스톤 없음)', lost: '(길 잃음)', loading: '불러오는 중…',
  starting: '시작하는 중… 확인 창이 떠 있으면 승인하세요.', running: '머신에서 실행하는 중…',
  cancel: '취소', cancelled: '실행을 취소했습니다.', mayContinue: '머신에서 프로세스가 아직 끝나지 않았을 수 있습니다.',
  placeholder: '새 할 일 제목', add: '할 일 추가', titleRequired: '할 일 제목을 입력하세요.', added: (t) => `추가했습니다: ${t.title} (${t.id})`,
  fields: { status: '상태', priority: '우선순위', assignee: '담당자', created: '만든 시각', id: 'ID', epic: '에픽', milestone: '마일스톤' },
  children: '하위 항목', noChildren: '하위 항목 없음', journal: '기록', createdEntry: '만들었습니다', closeDetail: '상세 닫기',
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
}

const ja: Copy = {
  hint: 'このプロジェクトのフォルダで実行します。一覧・詳細はアプリの起動中にそれぞれ最初の一回、タスクの追加は毎回、マシンとフォルダを示す確認画面が表示されます。',
  refresh: '再読み込み', refreshedAt: (time) => `${time} 更新`, board: 'タスク一覧', empty: '項目はありません。', more: (n) => `ほかに ${n} 件は表示していません`,
  up: '..', root: 'すべて', noMilestone: '(マイルストーンなし)', lost: '(迷子)', loading: '読み込み中…',
  starting: '開始しています… 確認画面が表示されていれば承認してください。', running: 'マシンで実行中…',
  cancel: 'キャンセル', cancelled: '実行をキャンセルしました。', mayContinue: 'マシン上のプロセスはまだ終了していない可能性があります。',
  placeholder: '新しいタスクのタイトル', add: 'タスクを追加', titleRequired: 'タスクのタイトルを入力してください。', added: (t) => `追加しました: ${t.title} (${t.id})`,
  fields: { status: '状態', priority: '優先度', assignee: '担当者', created: '作成日時', id: 'ID', epic: 'エピック', milestone: 'マイルストーン' },
  children: 'サブタスク', noChildren: 'サブタスクなし', journal: '履歴', createdEntry: '作成しました', closeDetail: '詳細を閉じる',
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
}

const zh: Copy = {
  hint: '在此项目的文件夹中运行。列表和详情在应用运行期间各确认一次，每次添加任务都会确认，确认窗口会显示机器和文件夹。',
  refresh: '刷新', refreshedAt: (time) => `${time} 更新`, board: '任务列表', empty: '没有项目。', more: (n) => `另有 ${n} 项未显示`,
  up: '..', root: '全部', noMilestone: '(无里程碑)', lost: '(无归属)', loading: '加载中…',
  starting: '正在启动… 如果显示了确认窗口，请批准。', running: '正在机器上运行…',
  cancel: '取消', cancelled: '已取消运行。', mayContinue: '机器上的进程可能尚未结束。',
  placeholder: '新任务标题', add: '添加任务', titleRequired: '请输入任务标题。', added: (t) => `已添加: ${t.title} (${t.id})`,
  fields: { status: '状态', priority: '优先级', assignee: '负责人', created: '创建时间', id: 'ID', epic: '史诗', milestone: '里程碑' },
  children: '子任务', noChildren: '无子任务', journal: '记录', createdEntry: '已创建', closeDetail: '关闭详情',
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
}

export const COPY: Record<string, Copy> = { en, ko, ja, zh }

/** The host document's language, else the browser's, else English. */
export function copyFor(language: string | undefined): Copy {
  const base = (language || 'en').split('-')[0]!.toLowerCase()
  return COPY[base] ?? en
}
