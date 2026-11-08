import { defineExtension, type SessionOpenBeforeInput, type SessionOpenBeforeResult } from '@buzzni/saycode-extension-sdk'

/**
 * The `company` hook is `dynamic`: Saycode calls this at every session open (create or resume) and adds the value to
 * that session only. It can fill SAMPLE_COMPANY_WORKSPACE because the manifest declares that name as non-secret.
 * SAMPLE_DOCS_TOKEN is secret: the person enters it in Saycode, and no handler can read or return it.
 */
function companyWorkspace(input: SessionOpenBeforeInput): SessionOpenBeforeResult {
  const companyId = input.project.companyId
  // `scope: "company"` already skips projects without a company; returning nothing is still a valid answer.
  return companyId ? { env: { SAMPLE_COMPANY_WORKSPACE: `company-${companyId}` } } : {}
}

export default defineExtension({
  activate(context) {
    if (!context.sessionHooks) throw new Error('session hooks need Saycode 1.4.0 or later')
    context.sessionHooks.onOpenBefore('buzzni.session-env-sample.company', companyWorkspace)
  },
})
