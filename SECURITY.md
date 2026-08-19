# Security Policy

## Supported versions

The latest `0.1.x` Extension SDK contract is supported during the v1 preview.

## Reporting a vulnerability

Do not open a public issue for sandbox escapes, credential exposure, package traversal, or capability bypasses.

**Reporting from outside Buzzni** (for example if you use the published `@buzzni/saycode-extension-sdk`): this
repository is private, so its Security tab is unreachable to you. File the report at
https://github.com/buzzni/saycode-desktop-releases/security/advisories/new instead — that repository is public
with private vulnerability reporting enabled, so any GitHub account can submit and only the Saycode maintainers
see the report.

**Repository collaborators** may use this repository's own **Security → Report a vulnerability** flow.

Either way, include the affected SDK/API version, a minimal extension package, and reproduction steps without
real credentials.

Public marketplace installation and automatic updates are not supported in v1. Users must install an explicitly
selected local artifact and review its requested permissions.
