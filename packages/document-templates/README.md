# Document templates

Eight bundled DOCX/XLSX/PPTX/PDF output templates, personal DOCX/XLSX/PPTX management, and explicit draft handoff. Requires Desktop host engine 1.1.0 and API 3. It uses only commands, an isolated panel, and four separately granted asset/draft capabilities.

Build from the repository root with `npm ci && npm run build && npm run typecheck && npm test`. Pack with `npm run pack -w @buzzni/saycode-extension-document-templates`. Install the resulting `.saycode-extension` through Desktop extension settings, enable it, and grant the required permissions. Open it from a composer. Selection does not send or modify a draft; Add to draft requires Core confirmation. Personal source application is restricted to private personal chats on the user's own machine.

Core holds authentication, temporary handles, revision checks and native confirmations. Web remains authoritative for private originals, metadata, instructions and thumbnails. No private original is persisted in the extension, localStorage or the artifact. Staged attachments expire after five idle minutes; reapply after expiration/revocation. Existing Web preview conversion is retained; this release does not move native renderers into the sandbox.

Rollback: disable the extension, close the panel, remove the package or restore the previous compatible artifact, then re-enable/grant explicitly. Web private originals survive uninstall. When rolling Desktop back below engine 1.1.0, leave this package disabled; it is incompatible with older hosts. A timed-out save has an unknown outcome until the catalog is reloaded, so do not blindly retry creates.

Local verification covers artifact contents/checksums, public capability calls, panel selection/application and private target refusal. Desktop owns host isolation, caller fencing and install/revoke/uninstall/recovery smoke. Real GUI/live-account verification remains a release prerequisite.
