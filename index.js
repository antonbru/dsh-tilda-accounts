/**
 * Tilda accounts — Host half.
 *
 * Stores client Tilda MCP accounts in this plugin's volatile Config, keeps at most
 * one `@deepseek-ai/dsh-mcp-client` instance mounted for the active account, and
 * exposes list/switch/status through a tool and `/tilda`.
 *
 * The settings page writes the same Config through `ctx.remote.settings`; the
 * Loader then emits `loader/volatile-update`, which remounts the MCP client.
 */

import z from '@deepseek-ai/schemastery'
import {
  TILDA_MCP_URL,
  accountSignature,
  buildMcpConfig,
  cleanText,
  normalizeAccounts,
  parseTildaCommand,
  resolveAccount,
  safeErrorMessage,
} from './helpers.js'

/** Loader row id; also the Settings namespace. */
export const name = 'tilda-accounts'
export const inject = ['tools', 'loader', 'commands', 'configEditor']

/** MCP namespace owned by this plugin. */
const SERVER = 'tilda'
const TOOL_PREFIX = `mcp__${SERVER}__`
const HELP = [
  'Учётки Tilda MCP:',
  '/tilda — список учёток',
  '/tilda use <id|название> — переключить активную',
  '/tilda status — состояние подключения',
  'Добавить, удалить или заменить ключ: Settings → Tilda.',
].join('\n')

export const Config = z.object({
  accounts: z
    .array(
      z.object({
        id: z.string().required(),
        name: z.string().default(''),
        project: z.string().default(''),
        token: z.string().role('secret').default(''),
      }),
    )
    .default([])
    .volatile(),
  activeId: z.string().default('').volatile(),
})

/** Read a Config field that may be a volatile reference or a plain value. */
function readField(value) {
  return value && typeof value.get === 'function' ? value.get() : value
}

export function apply(ctx, config) {
  const state = {
    /** Mounted mcp-client fiber. */
    fiber: undefined,
    /** Signature of the account that fiber belongs to. */
    signature: '',
    accountId: '',
    toolCount: 0,
    error: undefined,
  }

  const accounts = () => normalizeAccounts(readField(config.accounts))
  const activeId = () => cleanText(readField(config.activeId))
  const activeAccount = () => accounts().find((account) => account.id === activeId())

  const countTools = () => {
    try {
      return ctx.tools.schemas().filter((schema) => String(schema.name).startsWith(TOOL_PREFIX)).length
    } catch {
      return 0
    }
  }

  const unmount = async () => {
    const fiber = state.fiber
    state.fiber = undefined
    state.signature = ''
    state.accountId = ''
    state.toolCount = 0
    if (!fiber) return
    try {
      await fiber.dispose()
    } catch (error) {
      ctx.logger.warn(`tilda-accounts: MCP dispose failed: ${safeErrorMessage(error)}`)
    }
  }

  const sync = async () => {
    const account = activeAccount()
    if (!account) {
      await unmount()
      state.error = undefined
      return
    }
    const signature = accountSignature(account)
    if (state.fiber && state.signature === signature) return
    await unmount()
    try {
      const module = await ctx.loader.import('@deepseek-ai/dsh-mcp-client')
      const fiber = ctx.plugin(module, buildMcpConfig(account))
      await fiber.await()
      state.fiber = fiber
      state.signature = signature
      state.accountId = account.id
      state.toolCount = countTools()
      state.error = undefined
      ctx.logger.info(`tilda-accounts: active "${account.name}" (${String(state.toolCount)} tools)`)
    } catch (error) {
      state.error = safeErrorMessage(error)
      ctx.logger.warn(`tilda-accounts: connection for "${account.name}" failed: ${state.error}`)
    }
  }

  let queue = Promise.resolve()
  const schedule = () => {
    queue = queue.then(sync).catch((error) => {
      state.error = safeErrorMessage(error)
      ctx.logger.warn(`tilda-accounts: sync failed: ${state.error}`)
    })
    return queue
  }

  const listText = () => {
    const list = accounts()
    const current = activeId()
    if (!list.length) {
      return [
        'Учёток Tilda нет.',
        'Добавьте клиента в Settings → Tilda: нужны название, проект и ключ из Profile → MCP server в Тильде.',
        `MCP-адрес общий для всех: ${TILDA_MCP_URL}.`,
      ].join('\n')
    }
    const lines = [`Учётки Tilda (${String(list.length)}):`]
    for (const account of list) {
      const marks = []
      if (account.id === current) marks.push('активна')
      if (account.project) marks.push(`проект: ${account.project}`)
      marks.push(account.token ? 'ключ задан' : 'ключ не задан')
      lines.push(`• ${account.name} [${account.id}] — ${marks.join(' · ')}`)
    }
    lines.push('', 'Переключить: /tilda use <id|имя>. Добавить или удалить: Settings → Tilda.')
    return lines.join('\n')
  }

  const statusText = () => {
    const list = accounts()
    const current = activeId()
    const account = list.find((candidate) => candidate.id === current)
    if (!account) {
      return list.length
        ? 'Активная учётка не выбрана. Переключите: /tilda use <id|имя> или Settings → Tilda.'
        : 'Учёток Tilda нет. Добавьте в Settings → Tilda.'
    }
    const lines = [
      `Активная учётка: ${account.name} [${account.id}]`,
      `Проект: ${account.project || '—'}`,
      `Сервер: ${TILDA_MCP_URL}`,
      `Ключ: ${account.token ? 'задан' : 'не задан'}`,
    ]
    if (state.error) lines.push(`Подключение: ошибка — ${state.error}`)
    else if (state.fiber) lines.push(`Подключение: есть, инструментов ${TOOL_PREFIX}*: ${String(state.toolCount)}`)
    else lines.push('Подключение: нет')
    return lines.join('\n')
  }

  const promptText = () => {
    const account = activeAccount()
    if (!account) return ''
    const parts = [
      `Tilda MCP: активна учётка «${account.name}» (id: ${account.id}${account.project ? `, проект: ${account.project}` : ''}). Все инструменты ${TOOL_PREFIX}* относятся только к ней.`,
    ]
    if (state.error) parts.push('Подключение к Tilda сейчас не установлено; проверьте /tilda status.')
    parts.push('Сменить учётку: /tilda use <id|имя>.')
    return parts.join(' ')
  }

  const setActive = async (id) => {
    const entry = ctx.fiber.entry
    if (!entry) throw new Error('Профильная запись tilda-accounts не найдена.')
    await ctx.configEditor.edit(entry, (raw) => ({
      ...(raw && typeof raw === 'object' ? raw : {}),
      activeId: id,
    }))
    await schedule()
  }

  const writeAccounts = async (nextAccounts, nextActiveId) => {
    const entry = ctx.fiber.entry
    if (!entry) throw new Error('Профильная запись tilda-accounts не найдена.')
    await ctx.configEditor.edit(entry, (raw) => ({
      ...(raw && typeof raw === 'object' ? raw : {}),
      accounts: nextAccounts,
      activeId: nextActiveId,
    }))
    await schedule()
  }

  const addAccount = async (args) => {
    const name = cleanText(args && args.name)
    if (!name) throw new Error('Укажите name учётки.')
    const list = accounts()
    const id = cleanText(args && args.id) || `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    if (list.some((account) => account.id === id)) {
      throw new Error(`Учётка с id «${id}» уже есть.`)
    }
    const account = {
      id,
      name,
      project: cleanText(args && args.project),
      token: typeof (args && args.token) === 'string' ? args.token.trim() : '',
    }
    const next = [...list, account]
    const nextActive = activeId() || id
    await writeAccounts(next, nextActive)
    return `Добавлено: ${account.name} [${account.id}]${nextActive === id ? ' — активна' : ''}.`
  }

  const removeAccount = async (query) => {
    const list = accounts()
    const resolved = resolveAccount(list, query)
    if (resolved.error) throw new Error(resolved.error)
    const index = list.findIndex((account) => account.id === resolved.account.id)
    const next = list.filter((_account, position) => position !== index)
    const nextActive = activeId() === resolved.account.id ? next[0]?.id || '' : activeId()
    await writeAccounts(next, nextActive)
    return `Удалено: ${resolved.account.name} [${resolved.account.id}].`
  }

  const runTool = async (args) => {
    const action = cleanText(args && args.action)
    if (action === 'list') return listText()
    if (action === 'status') return statusText()
    if (action === 'add') return addAccount(args)
    if (action === 'remove') {
      if (!cleanText(args && args.account)) throw new Error('Укажите account для remove.')
      return removeAccount(args.account)
    }
    if (action === 'use') {
      const list = accounts()
      if (!list.length) throw new Error('Учёток Tilda нет. Добавьте клиента в Settings → Tilda.')
      const resolved = resolveAccount(list, args && args.account)
      if (resolved.error) throw new Error(resolved.error)
      await setActive(resolved.account.id)
      return [`Переключено на «${resolved.account.name}».`, statusText()].join('\n\n')
    }
    throw new Error('Неизвестное действие. Используйте list, use, status, add или remove.')
  }

  /* --------------------------------------------------------------- lifecycle */

  ctx.effect(() => () => unmount(), 'tilda-accounts:mcp')
  ctx.on('loader/volatile-update', () => {
    void schedule()
  })
  void schedule()

  /* ------------------------------------------------------------------ prompt */

  ctx.inject(['systemPrompt'], (inner) => {
    inner.systemPrompt.section({
      name: 'tilda-accounts',
      order: inner.systemPrompt.getSectionOrder('MCP_SERVERS'),
      interpolate: false,
      text: promptText,
    })
  })

  ctx.inject(['settings'], (inner) => {
    try {
      inner.effect(
        () => inner.settings.configure({ auto: false }, ctx.fiber),
        'tilda-accounts:settings',
      )
    } catch (error) {
      ctx.logger.warn(`tilda-accounts: settings policy skipped: ${safeErrorMessage(error)}`)
    }
  })

  /* ---------------------------------------------------------------- command */

  ctx.commands.register({
    name: 'tilda',
    description: 'Учётки Tilda MCP: список, переключение активной, состояние подключения.',
    input: { hint: 'list | use <id|имя> | status | help' },
    handler: async (invocation) => {
      try {
        const parsed = parseTildaCommand(invocation.rawInput)
        if (parsed.kind === 'help') return { kind: 'success', text: HELP }
        if (parsed.kind === 'list') return { kind: 'success', text: listText() }
        if (parsed.kind === 'status') return { kind: 'success', text: statusText() }
        if (parsed.kind === 'error') return { kind: 'error', text: parsed.text }
        const resolved = resolveAccount(accounts(), parsed.query)
        if (resolved.error) return { kind: 'error', text: resolved.error }
        await setActive(resolved.account.id)
        return {
          kind: 'success',
          text: `Активная учётка: «${resolved.account.name}» [${resolved.account.id}].\n\n${statusText()}`,
        }
      } catch (error) {
        return { kind: 'error', text: safeErrorMessage(error) }
      }
    },
  })

  /* ------------------------------------------------------------------- tool */

  void (async () => {
    try {
      const { defineTool } = await ctx.loader.import('@deepseek-ai/dsh-tools')
      if (ctx.fiber.uid === null) return
      ctx.tools.register(
        defineTool({
          name: 'tilda_accounts',
          description:
            'List configured Tilda client accounts, switch the active account, add or remove an account, or report the Tilda MCP connection status. All accounts use the fixed endpoint https://tilda.ru/api/mcp; Tilda tools are mcp__tilda__* and always act on the active account. For a real client key prefer Settings → Tilda: a token passed to add is recorded in this session log.',
          parameters: {
            action: {
              type: 'string',
              required: true,
              enum: ['list', 'use', 'status', 'add', 'remove'],
              description:
                'list — show accounts and the active one; use — switch to `account`; status — connection state and tool count; add — create an account from name and optional project/token; remove — delete `account`.',
            },
            account: {
              type: 'string',
              description: 'Account id or name; required for use and remove.',
            },
            name: {
              type: 'string',
              description: 'Display name for add.',
            },
            project: {
              type: 'string',
              description: 'Optional Tilda project label for add.',
            },
            token: {
              type: 'string',
              description:
                'Optional key for add. Prefer Settings → Tilda: a value passed here stays in the session log.',
            },
            id: {
              type: 'string',
              description: 'Optional stable account id for add; generated when omitted.',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: { text: { type: 'string', required: true } },
            },
            render: (_args, value) => [{ type: 'text', text: value.text }],
          },
          async execute(args) {
            return { text: await runTool(args) }
          },
        }),
      )
    } catch (error) {
      ctx.logger.warn(`tilda-accounts: tool registration skipped: ${safeErrorMessage(error)}`)
    }
  })()
}
