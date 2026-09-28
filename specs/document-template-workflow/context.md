---
feature: document-template-workflow
status: implemented on latest main; Desktop live-app T5 passed with the local stack — PR pending
updated: 2026-09-28
---

Desktop's `specs/desktop-document-template-workflow/` owns the cross-repository plan and the T5 results (`review.md`). The user approved A: ship template selection/management/draft handoff and keep existing Web preview conversion; native renderer migration is deferred.

Branch `codex/document-template-workflow-main` is cut from `origin/main` (2d420d0). The earlier branch `codex/document-template-workflow` sat on an 08-28 base whose two commits were already squashed into main (#13), and it bumped the SDK to 0.3.1 while main had moved to 0.4.0, so the work was re-applied instead of merged. Its snapshot is kept as a local WIP commit (333ae90) only.

- SDK 0.4.1: four API-3 permissions (`assets.read`, `assets.write`, `files.select`, `drafts.prepare`), optional `assets/` packaging, docs, workspace pins.
- `packages/document-templates`: eight retained public references, four-language panel, personal template management and explicit prepare/commit.

Defects found in the Desktop live app and fixed here, each reproduced first by a failing test:
- The panel is an opaque-origin iframe with `sandbox="allow-scripts"`: no `crypto.subtle` (instruction seal failed) and no form submission (Save did nothing). The panel now hashes in plain JavaScript and saves from a button handler; the test harness removes both capabilities.
- Core validation codes (`INVALID_REQUEST`, `UNSUPPORTED_FORMAT`) were collapsed to `SERVICE_UNAVAILABLE` by the command handler's allowlist.
- The editor showed the generated source-analysis block; it now edits only the user-owned part, matching the Web split (heading + one JSON line; text after it stays user-owned).

Verification on this branch: full `npm test` (180), `npm run typecheck`, pack. Not published; no push/merge/npm publish yet.
