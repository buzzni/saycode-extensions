import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'

import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'

const root = new URL('../packages/project-templates', import.meta.url).pathname

async function filesBelow(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) files.push(relative(directory, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  }
  return files.sort()
}

test('official project-templates package declares three namespaced asset trees without Desktop imports', async () => {
  const manifest = parseExtensionManifest(
    JSON.parse(await readFile(join(root, 'extension.json'), 'utf8')),
    { supportedApiVersion: 1 },
  )

  assert.equal(manifest.id, 'buzzni.project-templates')
  assert.deepEqual(manifest.contributes.projectTemplates.map((template) => template.id), [
    'buzzni.project-templates.dashboard',
    'buzzni.project-templates.survey-form',
    'buzzni.project-templates.api-backoffice',
  ])
  assert.deepEqual(await filesBelow(join(root, 'templates')), [
    'api-backoffice/README.md',
    'api-backoffice/index.html',
    'api-backoffice/package.json',
    'api-backoffice/src/App.tsx',
    'api-backoffice/src/api.ts',
    'api-backoffice/src/main.tsx',
    'api-backoffice/src/styles.css',
    'api-backoffice/tsconfig.json',
    'api-backoffice/vite.config.ts',
    'dashboard/README.md',
    'dashboard/index.html',
    'dashboard/package.json',
    'dashboard/src/App.tsx',
    'dashboard/src/main.tsx',
    'dashboard/src/styles.css',
    'dashboard/tsconfig.json',
    'dashboard/vite.config.ts',
    'survey-form/README.md',
    'survey-form/index.html',
    'survey-form/package.json',
    'survey-form/src/App.tsx',
    'survey-form/src/main.tsx',
    'survey-form/src/styles.css',
    'survey-form/tsconfig.json',
    'survey-form/vite.config.ts',
  ])
  assert.doesNotMatch(await readFile(join(root, 'src/index.ts'), 'utf8'), /aplus-dev-studio|@\/|electron|@buzzni\/saycode-core/)
})

test('project-template metadata and migrated asset contents match the approved Desktop parity snapshot', async () => {
  const manifest = parseExtensionManifest(
    JSON.parse(await readFile(join(root, 'extension.json'), 'utf8')),
    { supportedApiVersion: 1 },
  )
  const templates = manifest.contributes.projectTemplates

  assert.deepEqual(templates.map(({ assetsRoot: _assetsRoot, id, ...metadata }) => ({ id, ...metadata })), [
    {
      id: 'buzzni.project-templates.dashboard',
      title: 'Internal Dashboard',
      description: 'Start from a working dashboard with KPI tiles, a chart, and a request table.',
      stack: 'Vite · React · TypeScript',
      firstPrompt: 'This project starts from the Vite + React internal dashboard template. First run npm install and npm run dev, confirm the dashboard actually renders in the browser, and report the result with the local URL. Then propose, based on the code, how to wire the WEEKLY_HANDLED and RECENT_REQUESTS dummy data in src/App.tsx to a real API.',
      devServerCommand: 'npm run dev',
      localizations: {
        ko: { title: '사내 대시보드', description: 'KPI 타일·차트·요청 목록이 이미 동작하는 대시보드에서 시작합니다.', firstPrompt: '이 프로젝트는 Vite + React 사내 대시보드 템플릿에서 시작했어. 먼저 npm install과 npm run dev를 실행해 대시보드가 브라우저에 실제로 뜨는 것까지 확인하고, 접속 주소와 함께 결과를 보고해줘. 그다음 src/App.tsx의 WEEKLY_HANDLED, RECENT_REQUESTS 더미 데이터를 실제 데이터로 바꾸려면 어떤 구조로 API를 연결하면 되는지 코드 기준으로 제안해줘.' },
        ja: { title: '社内ダッシュボード', description: 'KPIタイル・チャート・リクエスト一覧が動作するダッシュボードから始めます。', firstPrompt: 'このプロジェクトは Vite + React の社内ダッシュボードテンプレートから始まりました。まず npm install と npm run dev を実行し、ダッシュボードがブラウザに実際に表示されることを確認して、ローカルURLと結果を報告してください。その後、src/App.tsx の WEEKLY_HANDLED と RECENT_REQUESTS のダミーデータを実際のAPIに接続する方法をコードに基づいて提案してください。' },
        zh: { title: '内部仪表盘', description: '从已经可运行的仪表盘开始：KPI 卡片、图表和请求列表。', firstPrompt: '这个项目基于 Vite + React 内部仪表盘模板。请先运行 npm install 和 npm run dev，确认仪表盘真的在浏览器中渲染出来，并连同本地地址一起报告结果。然后基于代码提出如何把 src/App.tsx 中的 WEEKLY_HANDLED 和 RECENT_REQUESTS 假数据接入真实 API。' },
      },
    },
    {
      id: 'buzzni.project-templates.survey-form',
      title: 'Survey Form',
      description: 'Start from a working survey form with questions, validation, and a submission summary.',
      stack: 'Vite · React · TypeScript',
      firstPrompt: 'This project starts from the Vite + React survey form template. First run npm install and npm run dev, confirm the form works through submission in the browser, and report the result with the local URL. Then propose, based on the code, how to adapt the question constants (TEAMS, SATISFACTION, CHANNELS) in src/App.tsx to my survey topic and how to replace the TODO in submit() with a real collection API.',
      devServerCommand: 'npm run dev',
      localizations: {
        ko: { title: '설문 폼', description: '문항·검증·제출 요약이 이미 동작하는 설문 폼에서 시작합니다.', firstPrompt: '이 프로젝트는 Vite + React 설문 폼 템플릿에서 시작했어. 먼저 npm install과 npm run dev를 실행해 폼 제출까지 브라우저에서 동작하는 것을 확인하고, 접속 주소와 함께 결과를 보고해줘. 그다음 src/App.tsx의 문항 상수(TEAMS, SATISFACTION, CHANNELS)를 내 설문 주제에 맞게 바꾸는 방법과 submit()의 TODO를 실제 수집 API로 바꾸는 방법을 코드 기준으로 제안해줘.' },
        ja: { title: 'アンケートフォーム', description: '設問・検証・送信サマリーが動作するアンケートフォームから始めます。', firstPrompt: 'このプロジェクトは Vite + React のアンケートフォームテンプレートから始まりました。まず npm install と npm run dev を実行し、送信までブラウザで動作することを確認して、ローカルURLと結果を報告してください。その後、src/App.tsx の設問定数(TEAMS, SATISFACTION, CHANNELS)を私のアンケートテーマに合わせる方法と、submit() の TODO を実際の収集APIに置き換える方法をコードに基づいて提案してください。' },
        zh: { title: '问卷表单', description: '从已经可运行的问卷表单开始：题目、校验和提交摘要。', firstPrompt: '这个项目基于 Vite + React 问卷表单模板。请先运行 npm install 和 npm run dev，确认表单在浏览器中可以完成提交，并连同本地地址一起报告结果。然后基于代码提出如何把 src/App.tsx 中的题目常量（TEAMS、SATISFACTION、CHANNELS）改成我的问卷主题，以及如何把 submit() 中的 TODO 换成真实的收集 API。' },
      },
    },
    {
      id: 'buzzni.project-templates.api-backoffice',
      title: 'API Backoffice',
      description: 'Start from a working admin screen with list, create, edit, and delete.',
      stack: 'Vite · React · TypeScript',
      firstPrompt: 'This project starts from the Vite + React API backoffice template. First run npm install and npm run dev, confirm creating/editing/deleting items works in the browser, and report the result with the local URL. Then propose, based on the code, the order of work to replace the in-memory functions in src/api.ts with a real backend API.',
      devServerCommand: 'npm run dev',
      localizations: {
        ko: { title: 'API 백오피스', description: '목록·등록·수정·삭제가 이미 동작하는 관리자 화면에서 시작합니다.', firstPrompt: '이 프로젝트는 Vite + React API 백오피스 템플릿에서 시작했어. 먼저 npm install과 npm run dev를 실행해 상품 등록/수정/삭제가 브라우저에서 동작하는 것을 확인하고, 접속 주소와 함께 결과를 보고해줘. 그다음 src/api.ts의 in-memory 함수들을 실제 백엔드 API로 바꾸려면 어떤 순서로 작업하면 되는지 코드 기준으로 제안해줘.' },
        ja: { title: 'API バックオフィス', description: '一覧・登録・編集・削除が動作する管理画面から始めます。', firstPrompt: 'このプロジェクトは Vite + React の API バックオフィステンプレートから始まりました。まず npm install と npm run dev を実行し、商品の登録/編集/削除がブラウザで動作することを確認して、ローカルURLと結果を報告してください。その後、src/api.ts の in-memory 関数を実際のバックエンドAPIに置き換える作業順序をコードに基づいて提案してください。' },
        zh: { title: 'API 管理后台', description: '从已经可运行的管理界面开始：列表、新增、编辑和删除。', firstPrompt: '这个项目基于 Vite + React API 管理后台模板。请先运行 npm install 和 npm run dev，确认商品的新增/编辑/删除在浏览器中可用，并连同本地地址一起报告结果。然后基于代码提出把 src/api.ts 中的 in-memory 函数替换为真实后端 API 的工作顺序。' },
      },
    },
  ])

  const expectedHashes = {
    'api-backoffice/README.md': 'cb3032e08538dceee24c81bfb65e23fd12bc4bf83bd4100e09f5fff2bfc3f24f',
    'api-backoffice/index.html': '1c327ccb40644580b78f7c754210305771d4a0da1bd2df8e4e93a172a932dcb5',
    'api-backoffice/package.json': '1a2eb4bee0073880420b94c506ffb383aabfc9980cb5a18f8cac2be20e98383d',
    'api-backoffice/src/App.tsx': '03d5a3b11ae2c852b4b86c536d36ea1c85b1b73da1b6b93d93b0fdd7cbfd2b8a',
    'api-backoffice/src/api.ts': '1a52f795a253c876ea6fac0fb630f8c94f7a77eb926680f8afd685f517ad4c5c',
    'api-backoffice/src/main.tsx': '9547f5a7f4db488a5c0166bf7e62ec7e784d42fa81bc6f4d8f56decdd37aa060',
    'api-backoffice/src/styles.css': '593bb64955646982b5fe67cf4eda32432807f3795a465d3f337cbbfa173c0b4e',
    'api-backoffice/tsconfig.json': '0cd5c5896f60e88fd2cf302a1e8df6c62cc9b390ad327af5133f9c7a2c49eb2e',
    'api-backoffice/vite.config.ts': '7c3566d9467f52ec6736741d73e6259606200fffecdbc63aebee82d97a4ed157',
    'dashboard/README.md': 'dc7b511812cfad58d35cfad54e6eaf6cbcc2286d342eef394996bda2894396f8',
    'dashboard/index.html': 'a5bada82afade43eb312ee745e6e54f2829d89f1011fe4565ed2f5aa358d5173',
    'dashboard/package.json': 'd8e67874ad3125ef7532936fddd6927102b3187d4f7d24d2b934396e16c6e002',
    'dashboard/src/App.tsx': 'd9979b0bf663c15480840315c1eadc697c8c98959ce38363fd16372687c9010d',
    'dashboard/src/main.tsx': '9547f5a7f4db488a5c0166bf7e62ec7e784d42fa81bc6f4d8f56decdd37aa060',
    'dashboard/src/styles.css': '22820bfbd7f66a9d99cd8b66b5383b57e723448549865f8120b8f615bd478974',
    'dashboard/tsconfig.json': '0cd5c5896f60e88fd2cf302a1e8df6c62cc9b390ad327af5133f9c7a2c49eb2e',
    'dashboard/vite.config.ts': '7c3566d9467f52ec6736741d73e6259606200fffecdbc63aebee82d97a4ed157',
    'survey-form/README.md': 'dcb4c0af82e8a809d7b30c76425fe4c6ab0cb6f3736036e02acd02542be2b5d9',
    'survey-form/index.html': 'c4cbc7edb30a5629bb1959b39586278a0015f81ea0ae01f63ff9d4525ba12d17',
    'survey-form/package.json': '5adf21360124b948c16b47195e6b0a3db0a8fe7bc3e6654dbdd5f315760ebea7',
    'survey-form/src/App.tsx': 'c9353a8ab0775588f056845baab29353f482cd18519f82408b85d1c8ffd0728e',
    'survey-form/src/main.tsx': '9547f5a7f4db488a5c0166bf7e62ec7e784d42fa81bc6f4d8f56decdd37aa060',
    'survey-form/src/styles.css': '0ebe5e6a8e536bae2e88d9067935c2b314ad431726a772fbc37d3297e7a95fff',
    'survey-form/tsconfig.json': '0cd5c5896f60e88fd2cf302a1e8df6c62cc9b390ad327af5133f9c7a2c49eb2e',
    'survey-form/vite.config.ts': '7c3566d9467f52ec6736741d73e6259606200fffecdbc63aebee82d97a4ed157',
  }
  const actualHashes = {}
  for (const path of await filesBelow(join(root, 'templates'))) {
    actualHashes[path] = createHash('sha256').update(await readFile(join(root, 'templates', path))).digest('hex')
  }
  assert.deepEqual(actualHashes, expectedHashes)
})
