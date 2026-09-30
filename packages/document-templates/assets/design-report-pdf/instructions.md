---
name: artifact-template-design-report-pdf
description: "Create a PDF document using the Design Report template and its retained reference file. Use when the user selects or names Design Report. Produce design reports with an executive summary, key findings, implications, recommendations, and appendix."
---

# Design Report PDF

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

## Design Report PDF structure contract

- Preserve the cover image, original report structure, section settings, heading hierarchy, tables, headers and footers.
- The table of contents is a functional part of the reference. Preserve its fields, hyperlinks, bookmarks, tab stops, leader alignment and cached page-number runs. Edit text runs without collapsing a whole paragraph or hyperlink into a single replacement run.
- Never replace a dynamic table of contents with static paragraphs to work around a renderer problem. Keep field instructions and links intact, update field results when supported, and inspect the rendered contents page against the original. If a renderer cannot update fields, retain valid cached results and disclose that limitation rather than deleting the field structure.
- Before completion compare the reference and output field instructions/hyperlink targets/bookmarks, in addition to page count and native tables. Original navigation must survive localization.

### Required repair for this retained source

The source has twelve TOC right-aligned dotted tab stops at `w:pos="12000"` twips, but its letter-size page is only 12240 twips wide with 1440-twip left/right margins: usable text width is **9360 twips**. Preserving 12000 literally clips the cached page numbers outside the page in LibreOffice. In the OUTPUT COPY, clamp these TOC right tab stops to the usable width (9360 for the unmodified source page setup), retaining `w:val="right"`, `w:leader="dot"`, all field instructions, hyperlinks, bookmarks, labels and page-number runs. This narrowly scoped source-layout repair takes precedence over preserving the erroneous tab-stop position. Never modify the retained reference. Render page 2 and verify all twelve TOC page numbers are visible inside the right margin; missing/clipped page numbers are a failed check, even when the headings are readable.

## Required PDF output

This is a Saycode PDF-output adaptation of the retained Codex DOCX template, not an original PDF template. The DOCX is editable source material only. Clone it into a temporary working directory, replace its content while preserving the design, then convert the completed copy to `documents/<requested-name>.pdf` using the available LibreOffice renderer. Never merely rename a DOCX extension to PDF.

The final deliverable MUST be the PDF requested by the user; do not finish by returning a DOCX. Keep the working DOCX and QA files outside `documents/` and out of the completion artifacts unless the user also requests them. A renderer failure blocks PDF completion.

Run pdfinfo on the final PDF, extract text to confirm all requested content and placeholders, render EVERY page with pdftoppm, and visually inspect the final pixels for missing Korean glyphs, clipping, overlap and page-number errors. If text is present but glyphs are missing, use the common document fontconfig recovery workflow and rerender. For a report, also verify that PDF contents-page destinations and visible page numbers match the final pages. Correct issues in the editable copy, reconvert, and inspect again.

PDF is directly previewable: return the verified `.pdf` original in the `axstudio-work-complete` artifacts; do not return a PDF-preview sidecar or the intermediate DOCX as the result. Do not claim an interactive PDF form unless genuine PDF form fields were explicitly requested and verified.

### Repair dangling source TOC destinations for PDF

The retained source has twelve TOC hyperlinks whose anchors are all the same incomplete string `_heading=`, while its actual bookmark names are different. Simply preserving those anchors produces a PDF with no working TOC links. This is a source defect, not valid navigation to retain. In the OUTPUT COPY, match each TOC row to its actual body heading and create a distinct valid bookmark/anchor pair while preserving the TOC field, row formatting and page-number text. Export PDF bookmarks/links and verify the resulting PDF `/Link` annotations and destinations programmatically. If the converter drops valid internal links, add internal GoTo annotations to the final PDF at the actual rendered TOC row rectangles, targeting the corresponding rendered heading/page; do not guess coordinates or leave external file links.

There must be twelve clickable TOC rows. Reopen the final PDF, resolve every link to an existing page containing its heading, and compare the visible page labels (cover excluded from numbering) with the targets. A readable static contents page with zero links is a failed check. This narrowly scoped repair overrides the earlier requirement to preserve the malformed source anchor strings; keep the retained reference unchanged.

When locating a destination in rendered PDF text, match the complete heading line (or heading span with its heading font/style), not the first substring occurrence. For example, the phrase `시사점` also occurs in a highlighted summary sentence before the actual `시사점` heading. Linking to that earlier sentence is incorrect even though it is on the same page. Use the exact heading's measured rectangle and verify all twelve destinations against those rectangles after reopening.
