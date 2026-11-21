# Shorts Director (project template)

Creates a project in which the agent works as a shorts director: from one request it plans a vertical (9:16) short,
checks the plan, generates takes and voice, and assembles a review-ready cut. The user-facing guide is
[`templates/shorts-director/README.md`](templates/shorts-director/README.md); the agent's procedure is the skill in
`templates/shorts-director/.claude/skills/shorts-director/`.

## What ships

- `tools/sd.mjs` — server checks (`doctor`), plan validation, take job state machine (no double submission),
  clients for an LTX-2.5 video server (text to video with sound, up to 121 frames) and a Qwen3-TTS server (bearer
  token), speech silence trimming, ffmpeg assembly, caption rendering through macOS JXA (works without
  libass/drawtext), contact sheet, status board. Server addresses and the token live in the project's `.env`.
- `tools/test/` — unit tests and a full pipeline test with fake backends (no Google calls; rendering tests need macOS).
- `tools/import-viskit-knowledge.py` — copies the internal viskit director prompts from a local `shorts_maker`
  checkout into the created project's git-ignored `knowledge/` folder.

## Private knowledge stays out of this repository

This repository is public. The viskit planning prompts belong to a private repository, so the template ships only a
summary written for this package (`references/craft.md`) and the importer. Do not commit imported `knowledge/` files
or text copied from them here.

## Opening the template in Desktop today

Desktop 0.1.94 has no Templates tab in the new-project dialog (removed on 2026-09-30), so an installed
`projectTemplates` contribution is not reachable from the UI. Until that entry point returns, zip
`templates/shorts-director/` and use **New project → ZIP·파일** — ZIP import keeps `.claude/` and other dotfiles.

## Not done yet

- Release wiring (`release.yml`, catalog entry).
- Rendering on Windows/Linux (captions use macOS JXA).

## Checks

```bash
npm run build -w @buzzni/saycode-extension-sdk
node --test tests/shorts-director.test.mjs packages/shorts-director/templates/shorts-director/tools/test/*.test.mjs
npm run package:shorts-director
```
