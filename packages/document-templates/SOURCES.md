# Retained Codex templates

Source: locally installed OpenAI Templates plugin, `openai-templates` version `0.1.1`.
Imported 2026-09-19 at the user’s request. Six representative templates were selected.
`assets/<id>/reference.*` and `assets/<id>/preview.png` are byte-identical copies of the retained Web assets.
Source per-template `SKILL.md` instructions are adapted under `assets/<id>/instructions.md`:
only platform capability/path routing and content/render verification guidance is added.
No Codex-private runtime or credential is required. These are source-template assets, not
user-generated documents. SHA-256 checksums are in `src/catalog.ts`.

- Design Report (`artifact-template-design-report`)
- Minimal Letterhead (`artifact-template-minimal-letterhead`)
- Financial Budget (`artifact-template-financial-budget`)
- Project Tracker (`artifact-template-project-tracker`)
- Business Review (`artifact-template-business-review`)
- Project Kickoff (`artifact-template-project-kickoff`)

## PDF output adaptations

`design-report-pdf` and `minimal-letterhead-pdf` are Saycode adaptations of the corresponding Codex DOCX templates above. Their reference.docx and preview.png are byte-identical to those sources. Their metadata and skills add PDF export and page verification; they are not presented as original Codex PDF templates.

This package copies the retained Web catalog at a0a52891ca388255d9112ad5b5b401fba16c82e1. Workspace paths in workflow step 1 are adapted to the actual composer attachment paths. Original layout/fidelity instructions remain.
