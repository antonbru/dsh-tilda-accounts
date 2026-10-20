/**
 * Pure helpers for the Tilda accounts plugin.
 *
 * Kept free of Cordis and schemastery imports so they can be tested with plain Node.
 */

/** The Tilda MCP endpoint. Fixed for every account; only the key changes. */
export const TILDA_MCP_URL = 'https://tilda.ru/api/mcp'

/** Trimmed string, or an empty string for anything else. */
export function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Normalize the stored account list: drop entries without an id, deduplicate ids,
 * trim the fields, and guarantee a name.
 * @param {unknown} raw
 * @returns {Array<{id: string, name: string, project: string, token: string}>}
 */
export function normalizeAccounts(raw) {
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  const accounts = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const id = cleanText(item.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    accounts.push({
      id,
      name: cleanText(item.name) || id,
      project: cleanText(item.project),
      token: typeof item.token === 'string' ? item.token.trim() : '',
    })
  }
  return accounts
}

/**
 * Resolve one account by id, exact name, then unique substring.
 * @param {ReturnType<typeof normalizeAccounts>} accounts
 * @param {string} query
 * @returns {{account: object} | {error: string}}
 */
export function resolveAccount(accounts, query) {
  const q = cleanText(query).toLowerCase()
  if (!q) return { error: 'Укажите id или название учётки.' }
  const byId = accounts.find((account) => account.id.toLowerCase() === q)
  if (byId) return { account: byId }
  const exact = accounts.filter((account) => account.name.toLowerCase() === q)
  if (exact.length === 1) return { account: exact[0] }
  if (exact.length > 1) {
    return { error: `Название «${query}» неоднозначно: ${exact.map((account) => account.id).join(', ')}.` }
  }
  const partial = accounts.filter(
    (account) => account.name.toLowerCase().includes(q) || account.id.toLowerCase().includes(q),
  )
  if (partial.length === 1) return { account: partial[0] }
  if (partial.length > 1) {
    return {
      error: `Подходит несколько учёток: ${partial
        .map((account) => `${account.name} (${account.id})`)
        .join(', ')}.`,
    }
  }
  return { error: `Учётка «${query}» не найдена.` }
}

/**
 * Build the Authorization header value: keep an explicit scheme, otherwise use Bearer.
 * @param {string} token
 * @returns {string}
 */
export function authHeaderValue(token) {
  const value = cleanText(token)
  if (!value) return ''
  return /^(Bearer|Basic|Token)\s+/i.test(value) ? value : `Bearer ${value}`
}

/**
 * Build the `@deepseek-ai/dsh-mcp-client` config for one account.
 *
 * Tilda serves the MCP endpoint with a trailing slash and answers the bare path
 * with a 301, which would turn a POST initialize into a GET. Normalize the fixed
 * endpoint to the slash form for the transport while keeping the public constant
 * exactly as documented.
 * @param {{token: string}} account
 * @returns {object}
 */
export function buildMcpConfig(account) {
  const url = TILDA_MCP_URL.endsWith('/') ? TILDA_MCP_URL : `${TILDA_MCP_URL}/`
  const headers = {}
  const auth = authHeaderValue(account.token)
  if (auth) headers.Authorization = auth
  return {
    transport: 'streamable-http',
    serverName: 'tilda',
    url,
    headers,
    toolCallTimeoutMs: 120000,
    failOnStartupError: true,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 15000, maxAttempts: 5 },
  }
}

/** Identity that decides whether the mounted MCP client must be replaced. */
export function accountSignature(account) {
  return JSON.stringify([account.id, account.token])
}

/**
 * Parse the `/tilda` command line.
 * @param {string} rawInput
 * @returns {{kind: 'list'|'status'|'help'|'use'|'error', query?: string, text?: string}}
 */
export function parseTildaCommand(rawInput) {
  const input = cleanText(rawInput)
  if (!input) return { kind: 'list' }
  const [head, ...rest] = input.split(/\s+/)
  const command = head.toLowerCase()
  const tail = rest.join(' ').trim()
  if (command === 'list' || command === 'ls') return { kind: 'list' }
  if (command === 'status') return { kind: 'status' }
  if (command === 'help') return { kind: 'help' }
  if (command === 'use' || command === 'switch') {
    if (!tail) return { kind: 'error', text: 'Укажите учётку: /tilda use <id|название>' }
    return { kind: 'use', query: tail }
  }
  return {
    kind: 'error',
    text: `Неизвестная команда «${command}». Использование: /tilda [list|use <id|имя>|status|help]`,
  }
}

/**
 * Remove query strings from URLs in a message so a URL that carries a key never
 * reaches logs, the prompt, or the settings page.
 * @param {unknown} error
 * @returns {string}
 */
export function safeErrorMessage(error) {
  const text = String((error && error.message) || error || '')
  return text.replace(/https?:\/\/[^\s"'`]+/g, (match) => {
    try {
      const url = new URL(match)
      return `${url.origin}${url.pathname}`
    } catch {
      return '<url>'
    }
  })
}
