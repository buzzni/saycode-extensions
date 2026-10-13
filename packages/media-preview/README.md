# Media preview

API 4의 `fileViewers`와 `filePreviews.read`를 사용하는 독립 미디어 player다. Desktop이 사용자가 연 파일 하나의 수명 제한 URL을 전달한다. 실제 경로·머신·계정·인증 정보를 받거나 파일 탐색을 하지 않는다. 영상/음성 format predicate·player·단위 테스트·패키징은 이 저장소가 소유한다.

네이티브 video/audio controls로 재생·일시정지·음량·시간 탐색·전체화면·키보드를 제공하며 자동 재생하지 않는다. 브라우저에서 지원하는 코덱만 재생하고 변환하지 않는다. 연결/코덱 오류에는 원본 저장 후 열기를 안내한다. API 4 미만 Desktop은 이 패키지를 거부하며 기존 API 2/3 확장은 영향받지 않는다.

저장소 루트에서 SDK를 빌드한 뒤 테스트하고 로컬 설치 artifact를 만든다.

```sh
npm run build --workspace @buzzni/saycode-extension-sdk
node --test packages/media-preview/tests/*.test.mjs
npm run pack --workspace @buzzni/saycode-extension-media-preview
```

Desktop의 확장 관리에서 `buzzni.media-preview-1.0.0.saycode-extension`을 설치하고 선택 파일 읽기 권한을 허용한 뒤 활성화한다. 비활성화·철회·제거는 열린 URL을 폐기한다. 다시 설치·허용하면 파일을 다시 열어 복구한다. 공식 catalog 등록/SDK·확장 발행은 별도 릴리스 작업이다. 현재 이 artifact는 로컬 소스 후보이며 공개 발행하지 않았다.

Core DTO v1은 `{version,handle,name,mimeType,sizeBytes,revision,url}`이며 URL은 경로 없는 `saycode-file-preview://<handle>/content`다. URL과 핸들은 내용 읽기 권한으로 취급하고 보관·로그·공유하지 않는다. 전용 capability의 `describe`/`createStream`/`close` action은 `{version:1,handle}`만 받는다. 임의 파일 경로나 URL을 열라는 요청은 제공하지 않는다.
