---
name: artifact-template-minimal-letterhead-pdf
description: "Create a PDF document using the Minimal Letterhead template and its retained reference file. Use when the user selects or names Minimal Letterhead. Write professional business letters with sender, recipient, message, and signature fields in a minimal letterhead layout."
---

# Minimal Letterhead PDF

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

## Required PDF output

This is a Saycode PDF-output adaptation of the retained Codex DOCX template, not an original PDF template. The DOCX is editable source material only. Clone it into a temporary working directory, replace its content while preserving the design, then convert the completed copy to `documents/<requested-name>.pdf` using the available LibreOffice renderer. Never merely rename a DOCX extension to PDF.

The final deliverable MUST be the PDF requested by the user; do not finish by returning a DOCX. Keep the working DOCX and QA files outside `documents/` and out of the completion artifacts unless the user also requests them. A renderer failure blocks PDF completion.

Run pdfinfo on the final PDF, extract text to confirm all requested content and placeholders, render EVERY page with pdftoppm, and visually inspect the final pixels for missing Korean glyphs, clipping, overlap and page-number errors. If text is present but glyphs are missing, use the common document fontconfig recovery workflow and rerender. For a report, also verify that PDF contents-page destinations and visible page numbers match the final pages. Correct issues in the editable copy, reconvert, and inspect again.

PDF is directly previewable: return the verified `.pdf` original in the `axstudio-work-complete` artifacts; do not return a PDF-preview sidecar or the intermediate DOCX as the result. Do not claim an interactive PDF form unless genuine PDF form fields were explicitly requested and verified.

## Required letterhead style checks

Preserve each original run's `w:rPr` in the body, tables, headers and footers. Update existing `w:t` values instead of assigning `paragraph.text` or `cell.text`, which removes run-level styling. If adding paragraphs, clone the intended styled run and paragraph properties. A CJK font substitution may change the font family only; never globally reset sizes, colors, boldness or paragraph spacing.

In particular the original header LOGO run is bold, orange `#F27C26`, 24 pt (`w:sz=48`). Keep these properties whether leaving LOGO as a placeholder or replacing its text with a user-provided short company name. Keep the original small address/footer typography. Compare header run properties against the source before PDF conversion and confirm the orange 24pt brand mark in the final PDF render. A small black LOGO is a failed fidelity check; repair the editable copy and rerender before completion.
