# Shorts Director (project template)

Creates a project in which the agent works as a shorts director: from one request it plans a vertical (9:16) short,
checks the plan, generates takes and voice, and assembles a review-ready cut. The user-facing guide is
[`templates/shorts-director/README.md`](templates/shorts-director/README.md); the agent's procedure is the skill in
`templates/shorts-director/.claude/skills/shorts-director/`.

## What ships

- `tools/sd.mjs` — plan validation, backend routing and cost estimate, take job state machine (no double submission),
  Gemini API clients (Omni video through the Interactions API in background mode, TTS, image), ffmpeg assembly,
  caption rendering through macOS JXA (works without libass/drawtext), contact sheet, status board.
- `tools/test/` — unit tests and a full pipeline test with fake backends (no Google calls; rendering tests need macOS).
- `tools/import-viskit-knowledge.py` — copies the internal viskit director prompts from a local `shorts_maker`
  checkout into the created project's git-ignored `knowledge/` folder.

## Private knowledge stays out of this repository

This repository is public. The viskit planning prompts belong to a private repository, so the template ships only a
summary written for this package (`references/craft.md`) and the importer. Do not commit imported `knowledge/` files
or text copied from them here.

## Not done yet

- Driving the Gemini web app with the user's own account (ego lite) — waits for capability measurements.
- Live verification against the Gemini API (request shapes follow the public docs and the viskit backend).
- Release wiring (`release.yml`, catalog entry).

## Checks

```bash
npm run build -w @buzzni/saycode-extension-sdk
node --test tests/shorts-director.test.mjs packages/shorts-director/templates/shorts-director/tools/test/*.test.mjs
npm run package:shorts-director
```
