# channel-contract-v2 (Desktop 공용 fixture 사본)

Slack 봇 개선 Core(Desktop)↔Extension 계약의 공용 fixture를 **바이트 그대로** 복사한 것이다. 원본과 해석 규칙은 Desktop 저장소
`tests/fixtures/channel-contract-v2/README.md`에 있다. 여기서는 고치지 않는다 — 계약이 바뀌면 Desktop 원본과 contracts를 먼저 고치고 다시 복사한다.

- 출처: `buzzni/aplus-dev-studio-desktop` 커밋 `ad7ec2ac7f874d96e37900c63e3bdfe18325c3be` (`tests/fixtures/channel-contract-v2/`, PR #2588)
- 복사: `git show <커밋>:tests/fixtures/channel-contract-v2/<파일> > <파일>`
- 검사: `tests/slack.test.mjs`가 아래 sha256과 실제 파일을 대조하고, `normalize/*.json`·`slack-text-tokens.json`으로 Slack 정규화를 검사한다.
  `skeleton.json`·`rendered-reply.json`은 Slack 렌더러(Phase 2 E)가 쓴다.

| 파일 | sha256 |
|---|---|
| `normalize-result.json` | `2a94a97261356351b8d112e5a58800b45ce254816b791b0a5a34855f65c2f9b1` |
| `normalize/forward.json` | `b2ff8335d7ca1e4eb6355117faf2aa7cb874d2df8e742ff947ba44be5d66ed5b` |
| `normalize/quote.json` | `448c321beb2c6def47ac73d75f8833656edd61614ed481c44245710e1676678d` |
| `normalize/same-text-blocks.json` | `39fec781ff4e750f9bcf01d52a5a6881b636cb16bf138ca654e20f1494463167` |
| `normalize/table.json` | `6b39590cfcc8694c9a35aab86f40dbf5fdda6a6e6a1d9b4b7ace8323d2fd7882` |
| `normalize/unfurl-only.json` | `ffef0f63ad57f2f82ced4bd3394e96b6e6bbd798ac22827206d5783734c60cc3` |
| `rendered-reply.json` | `37697c787b180dcdb65411807afe03acfae1696cf95c6b00f69d7741f68265e7` |
| `skeleton.json` | `0f4a052eb263a58d27895ef6a6ad466fd36624b93bb0dc89b6052375516e61cc` |
| `slack-text-tokens.json` | `dcaeadbb37fe9649f9b104bd98a7a458859c8ab1e5ea0be669a049697ffcd00f` |
