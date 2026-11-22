/**
 * Slack tokens (`<@U1|kim>`, `<!here>`, `<url|label>`) in Slack-authored mrkdwn, written the way Core
 * writes them in the primary text (Desktop specs/slack-bot-improvements contracts §5.2, checked against
 * the shared `slack-text-tokens.json`). Additions then read like the primary instead of carrying raw
 * tokens: one person is `@kim` in both, and `<!channel>` is never a live mention.
 */

const LABEL_MAX_UTF16_UNITS = 64
const BROADCASTS: Record<string, string> = { '!here': '@here', '!channel': '@channel', '!everyone': '@everyone' }
/** As Desktop's link template: a URI scheme, then no `|` or whitespace. */
const LINK_URL = /^[A-Za-z][A-Za-z0-9+.-]*:[^|\s]*$/

/** Control characters removed, then cut to 64 UTF-16 units; spaces stay (`@Justin Kim`). */
export function sanitizeSlackLabel(label: string): string {
  return label.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').slice(0, LABEL_MAX_UTF16_UNITS)
}

export function slackUserLabel(userId: string, userLabels: Readonly<Record<string, string>>, tokenLabel?: string): string {
  // Own string values only: `constructor` or `__proto__` as an id must not reach Object.prototype.
  const resolved = Object.hasOwn(userLabels, userId) ? userLabels[userId] : undefined
  return `@${sanitizeSlackLabel(typeof resolved === 'string' ? resolved : tokenLabel ?? userId)}`
}

/** An absent label is a bare url; an empty one is still a label, as in Core (` (url)`). */
export function slackLinkText(url: string, label: string | undefined): string {
  return label === undefined ? url : `${sanitizeSlackLabel(label)} (${url})`
}

export function renderSlackTextTokens(text: string, userLabels: Readonly<Record<string, string>>): string {
  let rendered = ''
  let last = 0
  for (const match of text.matchAll(/<([^<>]*)>/g)) {
    rendered += literal(text.slice(last, match.index)) + token(match[1]!, userLabels)
    last = match.index + match[0].length
  }
  return rendered + literal(text.slice(last))
}

/** Slack escapes only these three; restored once, so `&amp;lt;` reads `&lt;`. */
function literal(text: string): string {
  return text.replace(/&(lt|gt|amp);/g, (_, name: string) => ({ lt: '<', gt: '>', amp: '&' })[name]!)
}

function token(body: string, userLabels: Readonly<Record<string, string>>): string {
  const bar = body.indexOf('|')
  const head = bar === -1 ? body : body.slice(0, bar)
  const label = bar === -1 ? undefined : body.slice(bar + 1)
  if (/^@U[A-Z0-9]+$/.test(head)) return slackUserLabel(head.slice(1), userLabels, label)
  if (/^#C[A-Z0-9]+$/.test(head)) return `#${label === undefined ? head.slice(1) : sanitizeSlackLabel(label)}`
  if (label === undefined && Object.hasOwn(BROADCASTS, head)) return BROADCASTS[head]!
  if (/^!subteam\^S[A-Z0-9]+$/.test(head)) return label === undefined ? '@usergroup' : sanitizeSlackLabel(label)
  if (head.startsWith('!date^') && label !== undefined) return sanitizeSlackLabel(label)
  if (LINK_URL.test(head)) return slackLinkText(head, label)
  return `<${body}>`
}
