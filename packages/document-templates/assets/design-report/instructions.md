---
name: artifact-template-design-report
description: "Create a document using the Design Report template and its retained reference file. Use when the user selects or names Design Report. Produce design reports with an executive summary, key findings, implications, recommendations, and appendix."
---

# Design Report

Create a new document from this template. Keep the reference file unchanged.

## Workflow

1. Read the attached reference file and work on a copy; its original bytes are immutable. Use the attachment paths in the user message.
2. Read common MCP `get_common_skill` with `skill_id: "common_documents"` and follow its generation, render, review, preview sidecar and completion workflow. If MCP is unavailable, read `.agents/skills/common-documents/SKILL.md` or `.claude/skills/common-documents/SKILL.md`. Use installed tools on this machine; do not depend on Codex-private packages or paths. If a required capability is unavailable, report it and stop.
3. Treat the user's prompt and available sources as the content input. Do not invent facts merely to fill a template slot.
4. Clone or import the reference instead of replacing its visual system with generic defaults.
5. Render and verify the finished document, then return the final artifact.

## Fidelity

Preserve page setup, sections, styles, lists, tables, headers, footers, and recurring page elements.

User instructions control requested content and explicit deviations. The retained reference controls layout and formatting where the user has not requested a change.

## Content and verification

Use the language of the user request for editable content. Retain reference imagery and visual styling unless the user requests a change. Replace illustrative names, dates and metrics with user-provided facts or clearly marked input placeholders; never present source sample data as real user facts. Preserve formulas and editable native objects. Inspect the reference before editing, work on a copy under `documents/`, and compare the final render against the original layout. Automatically correct clipping, overlap, missing glyphs and unintended style changes before returning the file. Keep the retained original unchanged.

## Design Report structure contract

- Preserve the cover image, original report structure, section settings, heading hierarchy, tables, headers and footers.
- The table of contents is a functional part of the reference. Preserve its fields, hyperlinks, bookmarks, tab stops, leader alignment and cached page-number runs. Edit text runs without collapsing a whole paragraph or hyperlink into a single replacement run.
- Never replace a dynamic table of contents with static paragraphs to work around a renderer problem. Keep field instructions and links intact, update field results when supported, and inspect the rendered contents page against the original. If a renderer cannot update fields, retain valid cached results and disclose that limitation rather than deleting the field structure.
- Before completion compare the reference and output field instructions/hyperlink targets/bookmarks, in addition to page count and native tables. Original navigation must survive localization.

### Required repair for this retained source

The source has twelve TOC right-aligned dotted tab stops at `w:pos="12000"` twips, but its letter-size page is only 12240 twips wide with 1440-twip left/right margins: usable text width is **9360 twips**. Preserving 12000 literally clips the cached page numbers outside the page in LibreOffice. In the OUTPUT COPY, clamp these TOC right tab stops to the usable width (9360 for the unmodified source page setup), retaining `w:val="right"`, `w:leader="dot"`, all field instructions, hyperlinks, bookmarks, labels and page-number runs. This narrowly scoped source-layout repair takes precedence over preserving the erroneous tab-stop position. Never modify the retained reference. Render page 2 and verify all twelve TOC page numbers are visible inside the right margin; missing/clipped page numbers are a failed check, even when the headings are readable.
