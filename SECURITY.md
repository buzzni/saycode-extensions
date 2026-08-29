# Security Policy

## Supported versions

The latest `0.3.x` Extension SDK contract is supported during the v1 preview.

## Reporting a vulnerability

Do not open a public issue for sandbox escapes, credential exposure, package traversal, or capability bypasses.

Use this repository's private vulnerability reporting form:
https://github.com/buzzni/saycode-extensions/security/advisories/new. GitHub keeps the report visible only to the
reporter and Saycode maintainers; do not include real production credentials in the report.

Either way, include the affected SDK/API version, a minimal extension package, and reproduction steps without
real credentials.

Public marketplace installation and automatic updates are not supported in v1. Users must install an explicitly
selected local artifact and review its requested permissions.
