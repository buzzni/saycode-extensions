# Installing and managing Saycode Extensions

## Install a local artifact

1. Obtain a `.saycode-extension` artifact and its `.sha256` file from a trusted project release.
2. Verify the checksum before opening Saycode:

   ```bash
   shasum -a 256 -c buzzni.hello-world-1.0.0.saycode-extension.sha256
   ```

3. In Saycode Desktop, open **Settings → Extensions → Install local file** and select the artifact.
4. Review the requested permissions. Installation does not activate the extension.
5. Select **Enable**, review the permissions again, then choose **Approve permissions and enable**.

Use **Disable** before updating an extension. **Update** asks for another local artifact and rejects an artifact with a
different extension id. **Uninstall** removes every installed version and its registry entry.

## Failures and recovery

An extension that crashes repeatedly is disabled and marked **Quarantined**. Read the displayed error and update or
remove the artifact if its source is untrusted. **Recover and re-enable** clears the crash counter only after an explicit
user action; it does not bypass manifest or capability checks.

Saycode v1 has no marketplace or automatic update channel. Never install an artifact received unexpectedly, and never
enter a Saycode token, encryption secret, password, or cookie into an extension panel.

## Permission meanings

| Permission | Allows through the Desktop broker |
|---|---|
| `projects.read` | Read secret-free project metadata |
| `remoteFiles.read` | Read an explicitly scoped remote project file |
| `remoteFiles.write` | Write an explicitly scoped remote project file |
| `machine.execute` | Run an approved operation on a selected machine |
| `network.fetch` | Ask Desktop to make a policy-checked network request |
| `notifications.show` | Display a Desktop notification |
| `storage.read` | Read the extension's private storage |
| `storage.write` | Write the extension's private storage |

Declaring a permission is not enough: Desktop also checks the user's current approval on every protected call. Revoked,
unknown, or undeclared permissions fail closed.
