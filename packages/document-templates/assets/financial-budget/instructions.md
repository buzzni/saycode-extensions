---
name: artifact-template-financial-budget
description: "Create a spreadsheet using the Financial Budget template and its retained reference file. Use when the user selects or names Financial Budget. Model actuals, budget and scenario forecasts, variances, cash runway, and departmental plans."
---

# Financial Budget

Create a new spreadsheet from this template. Keep the reference file unchanged.

## Workflow

1. Read the attached reference file and work on a copy; its original bytes are immutable. Use the attachment paths in the user message.
2. Read common MCP `get_common_skill` with `skill_id: "common_documents"` and follow its generation, render, review, preview sidecar and completion workflow. If MCP is unavailable, read `.agents/skills/common-documents/SKILL.md` or `.claude/skills/common-documents/SKILL.md`. Use installed tools on this machine; do not depend on Codex-private packages or paths. If a required capability is unavailable, report it and stop.
3. Treat the user's prompt and available sources as the content input. Do not invent facts merely to fill a template slot.
4. Clone or import the reference instead of replacing its visual system with generic defaults.
5. Render and verify the finished spreadsheet, then return the final artifact.

## Fidelity

Preserve sheet structure, formulas, names, number formats, dimensions, tables, charts, validation, conditional formatting, and frozen panes.

User instructions control requested content and explicit deviations. The retained reference controls layout and formatting where the user has not requested a change.

## Content and verification

Use the language of the user request for editable content. Retain reference imagery and visual styling unless the user requests a change. Replace illustrative names, dates and metrics with user-provided facts or clearly marked input placeholders; never present source sample data as real user facts. Preserve formulas and editable native objects. Inspect the reference before editing, work on a copy under `documents/`, and compare the final render against the original layout. Automatically correct clipping, overlap, missing glyphs and unintended style changes before returning the file. Keep the retained original unchanged.

## Financial Budget structure contract

- The four worksheets are Summary, Assumptions, Op Build and Checks. Preserve all four, their formulas, charts, conditional formatting, validation and named ranges.
- Distinguish labels from sample inputs before editing. Column B contains structural row labels, including Op Build B47:B59 (the actual/baseline input section). Translate these labels when needed; NEVER blank or replace them as sample facts. In particular B50:B54 and B57 must remain meaningful labels. Keep every nonempty source row label nonempty after editing and check this programmatically against the reference.
- The scenario selector and scenario-table keys must remain consistent with lookup formulas. Assumptions column C and Op Build C47:N59 contain user input values; clear only actual example input values, not labels, formulas, validation options, tolerance constants or period headers. Do not globally remove text containing words such as "Actual" or "Baseline".
- A blank numeric input must not produce #DIV/0!, #VALUE! or broken lookups. Preserve calculation meaning; if blank guards or neutral technical defaults are necessary, explain them visibly in the workbook rather than treating them as user financial facts. Verify both a blank copy and a populated test copy with recalculation.
- Compare original and output: sheet count, formula cell locations, every original nonempty column-B label, chart count, merges and validations. A missing structural label is a failed check even when the workbook renders.
