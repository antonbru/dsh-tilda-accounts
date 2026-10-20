/**
 * Tilda accounts — Client half.
 *
 * Two surfaces over the Host Config:
 *   - Settings → Tilda: add / remove / re-key accounts, choose the active one.
 *   - A composer chip: switch the active account without opening Settings.
 *
 * Both use the shipped `ctx.remote.settings` namespace; this plugin never sees a
 * token because the Host marks it `role('secret')`.
 */

window.__ModuleLoader__.load({
  id: 'dsh-tilda-accounts',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-tilda-accounts'
    const SETTINGS_NS = 'tilda-accounts'
    const MCP_URL = 'https://tilda.ru/api/mcp'
    const HELP_URL = 'https://help.tilda.cc/mcp'

    const EN = {
      nav: 'Tilda',
      title: 'Tilda accounts',
      desc: 'Client Tilda MCP accounts. The active account decides whose projects the agent works with.',
      hint: 'Create the key in Tilda: Profile → MCP server → New key (pick the project). The endpoint is fixed for every account.',
      endpoint: 'MCP endpoint:',
      help: 'Tilda instructions',
      empty: 'No accounts yet. Add the first one below.',
      addTitle: 'Add account',
      name: 'Account name',
      project: 'Project (optional)',
      namePlaceholder: 'e.g. Acme',
      projectPlaceholder: 'e.g. acme.ru',
      token: 'Key',
      tokenPlaceholder: 'key from the Tilda MCP page',
      add: 'Add',
      active: 'active',
      makeActive: 'Make active',
      replaceKey: 'Replace key',
      delete: 'Delete',
      confirmDelete: 'Delete for sure',
      cancel: 'Cancel',
      save: 'Save',
      keySet: 'key set',
      keyMissing: 'no key',
      noProject: 'no project',
      loading: 'Loading…',
      missing: 'The tilda-accounts plugin was not found in settings. Check that it is enabled.',
      errorPrefix: 'Error: ',
      errorName: 'Enter a name.',
      note: 'If the key is wrong, Tilda tools will not appear. Check with /tilda status in chat.',
      chipNone: 'no account',
      chipSwitch: 'Switch Tilda account',
      chipHint: 'Active Tilda account',
      chipNote: 'Switch applies to every session.',
    }

    const RU = {
      nav: 'Tilda',
      title: 'Учётки Tilda',
      desc: 'Клиентские MCP-учётки Tilda. Активная учётка задаёт, с чьими проектами работает агент.',
      hint: 'Ключ создаётся в Тильде: Profile → MCP server → New key (выберите проект). MCP-адрес одинаковый для всех учёток.',
      endpoint: 'Адрес MCP:',
      help: 'Инструкция Тильды',
      empty: 'Пока нет ни одной учётки. Добавьте первую ниже.',
      addTitle: 'Добавить учётку',
      name: 'Название учётки',
      project: 'Проект (необязательно)',
      namePlaceholder: 'например, Acme',
      projectPlaceholder: 'например, acme.ru',
      token: 'Ключ',
      tokenPlaceholder: 'ключ со страницы MCP в Тильде',
      add: 'Добавить',
      active: 'активна',
      makeActive: 'Сделать активной',
      replaceKey: 'Заменить ключ',
      delete: 'Удалить',
      confirmDelete: 'Точно удалить',
      cancel: 'Отмена',
      save: 'Сохранить',
      keySet: 'ключ задан',
      keyMissing: 'ключ не задан',
      noProject: 'проект не указан',
      loading: 'Загрузка…',
      missing: 'Плагин tilda-accounts не найден среди настроек. Проверьте, что он включён.',
      errorPrefix: 'Ошибка: ',
      errorName: 'Укажите название.',
      note: 'Если ключ неверный, инструменты Tilda не появятся. Проверить: /tilda status в чате.',
      chipNone: 'учётка не выбрана',
      chipSwitch: 'Переключить учётку Tilda',
      chipHint: 'Активная учётка Tilda',
      chipNote: 'Переключение действует на все сессии.',
    }

    const DICTS = { en: EN, ru: RU }
    let activeLocale = 'en'

    function translate(key) {
      const dict = DICTS[activeLocale] || EN
      return typeof dict[key] === 'string' ? dict[key] : typeof EN[key] === 'string' ? EN[key] : key
    }

    /* ------------------------------------------------------------------- data */

    function unwrap(result) {
      if (result && typeof result === 'object' && result.ok === false) {
        const error = result.error || {}
        throw new Error(error.message || error.code || 'settings request failed')
      }
      if (result && typeof result === 'object' && result.ok === true && 'value' in result) return result.value
      return result
    }

    function findNamespace(view) {
      const namespaces = view && Array.isArray(view.namespaces) ? view.namespaces : []
      return (
        namespaces.find((entry) => entry && entry.ns === SETTINGS_NS) ||
        namespaces.find((entry) => entry && typeof entry.ns === 'string' && entry.ns.endsWith(`:${SETTINGS_NS}`)) ||
        namespaces.find((entry) => entry && entry.value && Array.isArray(entry.value.accounts)) ||
        undefined
      )
    }

    async function loadSettings(ctx) {
      const view = unwrap(await ctx.remote.settings.describe())
      const namespace = findNamespace(view)
      if (!namespace) return { missing: true }
      const value = namespace.value && typeof namespace.value === 'object' ? namespace.value : {}
      return {
        ns: namespace.ns,
        accounts: Array.isArray(value.accounts) ? value.accounts : [],
        activeId: typeof value.activeId === 'string' ? value.activeId : '',
        revision: typeof namespace.revision === 'number' ? namespace.revision : 0,
        secrets: Array.isArray(namespace.secrets) ? namespace.secrets : [],
      }
    }

    async function mutateSettings(ctx, data, ops) {
      return unwrap(await ctx.remote.settings.mutate(data.ns, ops, data.revision))
    }

    function useTilda(ops) {
      const [state, setState] = React.useState({ status: 'loading' })
      const alive = React.useRef(true)
      const reload = React.useCallback(async () => {
        try {
          const data = await ops.load()
          if (!alive.current) return
          if (data && data.missing) setState({ status: 'missing' })
          else setState({ status: 'ready', data })
        } catch (error) {
          if (!alive.current) return
          setState({ status: 'error', error: String((error && error.message) || error) })
        }
      }, [ops])
      React.useEffect(() => {
        alive.current = true
        void reload()
        const off = ops.onChange((ns) => {
          if (
            typeof ns === 'string' &&
            ns.length > 0 &&
            ns !== SETTINGS_NS &&
            !ns.endsWith(`:${SETTINGS_NS}`)
          ) {
            return
          }
          void reload()
        })
        return () => {
          alive.current = false
          if (typeof off === 'function') off()
        }
      }, [ops, reload])
      return { state, reload }
    }

    function hasSecret(data, index) {
      return data.secrets.some(
        (secret) =>
          Array.isArray(secret.path) &&
          secret.path[0] === 'accounts' &&
          String(secret.path[1]) === String(index) &&
          secret.path[2] === 'token' &&
          secret.set === true,
      )
    }

    function errorText(error) {
      return String((error && error.message) || error || '')
    }

    /* ------------------------------------------------------------------ styles */

    const CSS = `
.ta-section { width: 100%; max-width: 760px; display: flex; flex-direction: column; gap: 14px; color: var(--dsw-alias-label-primary); }
.ta-head { display: flex; flex-direction: column; gap: 4px; }
.ta-title { font-size: 16px; font-weight: 500; line-height: 24px; }
.ta-desc { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.ta-link { color: var(--dsw-alias-state-business-primary); text-decoration: none; font-size: 13px; }
.ta-link:hover { text-decoration: underline; }
.ta-endpoint { font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 0.5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm); padding: 1px 6px; }
.ta-error { color: var(--dsw-alias-state-error-primary); font-size: 13px; line-height: 20px; }
.ta-note { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.ta-empty { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; padding: 14px; border: 1px dashed var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-xl); }
.ta-list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.ta-card { border: 0.5px solid var(--dsw-alias-settings-card-stroke); background: var(--dsw-alias-settings-card-fill); border-radius: var(--dsw-radius-xl); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.ta-card[data-active="true"] { border-color: var(--dsw-alias-state-business-primary); }
.ta-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.ta-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ta-name-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ta-name { font-size: 14px; line-height: 22px; font-weight: 500; }
.ta-badge { font-size: 11px; line-height: 16px; padding: 1px 7px; border-radius: 999px; color: var(--dsw-alias-state-business-primary); border: 1px solid var(--dsw-alias-state-business-primary); }
.ta-meta { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.ta-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.ta-btn { font: inherit; font-size: 12px; line-height: 18px; padding: 4px 10px; border-radius: var(--dsw-radius-sm); border: 1px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; }
.ta-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ta-btn:disabled { opacity: 0.5; cursor: default; }
.ta-btn[data-primary="true"] { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); }
.ta-btn[data-danger="true"] { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.ta-token { display: flex; gap: 6px; align-items: center; }
.ta-token input { flex: 1; min-width: 0; height: 30px; padding: 0 10px; border-radius: var(--dsw-radius-md); border: 0.5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12.5px; outline: none; }
.ta-token input:focus-visible { border-color: var(--dsw-alias-state-business-primary); }
.ta-form { display: flex; flex-direction: column; gap: 10px; border: 0.5px solid var(--dsw-alias-settings-card-stroke); background: var(--dsw-alias-settings-card-fill); border-radius: var(--dsw-radius-xl); padding: 14px; }
.ta-form-title { font-size: 13px; line-height: 20px; font-weight: 500; }
.ta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.ta-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.ta-field-wide { grid-column: 1 / -1; }
.ta-field > span { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.ta-field input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border-radius: var(--dsw-radius-md); border: 0.5px solid var(--dsw-alias-border-l4); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; }
.ta-field input:focus-visible { border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); }
.ta-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ta-hint { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.ta-chip-wrap { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; pointer-events: auto; }
.ta-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11.5px; line-height: 16px; cursor: pointer; user-select: none; white-space: nowrap; }
.ta-chip:hover { border-color: var(--dsw-alias-border-l3); }
.ta-chip-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--dsw-alias-state-business-primary); flex: none; }
.ta-panel { box-sizing: border-box; width: 280px; max-width: calc(100vw - 48px); padding: 8px; border-radius: 10px; display: flex; flex-direction: column; gap: 4px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l1); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); }
.ta-option { display: flex; flex-direction: column; gap: 1px; text-align: left; border: none; background: transparent; border-radius: var(--dsw-radius-md); padding: 7px 9px; cursor: pointer; color: var(--dsw-alias-label-primary); font: inherit; }
.ta-option:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ta-option-name { font-size: 12.5px; line-height: 18px; }
.ta-option-meta { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.ta-panel-note { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; padding: 2px 9px 4px; }
`

    function installStyle(ctx) {
      const existing = document.querySelector('style[data-plugin="dsh-tilda-accounts"]')
      if (existing) existing.remove()
      const style = document.createElement('style')
      style.dataset.plugin = 'dsh-tilda-accounts'
      style.textContent = CSS
      document.head.appendChild(style)
      ctx.effect(() => () => style.remove(), 'tilda-accounts:style')
    }

    /* ---------------------------------------------------------------- settings */

    function TildaSettingsPage(props) {
      const t = props.t
      const ops = props.ops
      const { state, reload } = useTilda(ops)
      const [form, setForm] = React.useState({ name: '', project: '', token: '' })
      const [busy, setBusy] = React.useState(false)
      const [actionError, setActionError] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const [tokenDraft, setTokenDraft] = React.useState('')
      const [confirming, setConfirming] = React.useState(null)

      const data = state.status === 'ready' ? state.data : undefined
      const accounts = data ? data.accounts : []

      const run = async (nextOps) => {
        if (!data) return false
        setBusy(true)
        setActionError('')
        try {
          await ops.mutate(data, nextOps)
          await reload()
          return true
        } catch (error) {
          setActionError(errorText(error))
          return false
        } finally {
          setBusy(false)
        }
      }

      const switchTo = (id) => {
        void run([{ op: 'set', path: ['activeId'], value: id }])
      }

      const remove = (index) => {
        const account = accounts[index]
        if (!account) return
        const remaining = accounts.filter((_entry, position) => position !== index)
        const next = [{ op: 'unset', path: ['accounts', String(index)] }]
        if (data.activeId === account.id) {
          next.push({ op: 'set', path: ['activeId'], value: remaining[0] ? remaining[0].id : '' })
        }
        setConfirming(null)
        void run(next)
      }

      const add = async () => {
        const name = form.name.trim()
        if (!name) {
          setActionError(t('errorName'))
          return
        }
        const id = `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        const value = { id, name, project: form.project.trim(), token: form.token.trim() }
        const next = [{ op: 'set', path: ['accounts', String(accounts.length)], value }]
        if (!data.activeId) next.push({ op: 'set', path: ['activeId'], value: id })
        const ok = await run(next)
        if (ok) setForm({ name: '', project: '', token: '' })
      }

      const saveToken = async (index) => {
        const value = tokenDraft.trim()
        if (!value) return
        const ok = await run([{ op: 'set', path: ['accounts', String(index), 'token'], value }])
        if (ok) {
          setEditing(null)
          setTokenDraft('')
        }
      }

      if (state.status === 'loading') {
        return h('div', { className: 'ta-section' }, h('div', { className: 'ta-note' }, t('loading')))
      }
      if (state.status === 'missing') {
        return h('div', { className: 'ta-section' }, h('div', { className: 'ta-error' }, t('missing')))
      }
      if (state.status === 'error') {
        return h('div', { className: 'ta-section' }, h('div', { className: 'ta-error' }, t('errorPrefix') + state.error))
      }

      const header = h(
        'div',
        { className: 'ta-head' },
        h('div', { className: 'ta-title' }, t('title')),
        h('div', { className: 'ta-desc' }, t('desc')),
        h(
          'div',
          { className: 'ta-desc' },
          t('endpoint') + ' ',
          h('code', { className: 'ta-endpoint' }, MCP_URL),
        ),
        h(
          'div',
          { className: 'ta-desc' },
          t('hint') + ' ',
          h('a', { className: 'ta-link', href: HELP_URL, target: '_blank', rel: 'noreferrer' }, t('help')),
        ),
      )

      const cards = accounts.length
        ? h(
            'ul',
            { className: 'ta-list' },
            accounts.map((account, index) => {
              const active = account.id === data.activeId
              const secret = hasSecret(data, index)
              return h(
                'li',
                { className: 'ta-card', key: account.id, 'data-active': active ? 'true' : 'false' },
                h(
                  'div',
                  { className: 'ta-row' },
                  h(
                    'div',
                    { className: 'ta-main' },
                    h(
                      'div',
                      { className: 'ta-name-row' },
                      h('span', { className: 'ta-name' }, account.name || account.id),
                      active ? h('span', { className: 'ta-badge' }, t('active')) : null,
                    ),
                    h(
                      'span',
                      { className: 'ta-meta' },
                      `${account.project ? account.project : t('noProject')} · ${
                        secret ? t('keySet') : t('keyMissing')
                      }`,
                    ),
                  ),
                  h(
                    'div',
                    { className: 'ta-actions' },
                    active
                      ? null
                      : h(
                          'button',
                          {
                            type: 'button',
                            className: 'ta-btn',
                            'data-primary': 'true',
                            disabled: busy,
                            onClick: () => switchTo(account.id),
                          },
                          t('makeActive'),
                        ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'ta-btn',
                        disabled: busy,
                        onClick: () => {
                          setEditing(editing === index ? null : index)
                          setTokenDraft('')
                        },
                      },
                      t('replaceKey'),
                    ),
                    confirming === account.id
                      ? h(
                          'button',
                          {
                            type: 'button',
                            className: 'ta-btn',
                            'data-danger': 'true',
                            disabled: busy,
                            onClick: () => remove(index),
                          },
                          t('confirmDelete'),
                        )
                      : h(
                          'button',
                          {
                            type: 'button',
                            className: 'ta-btn',
                            disabled: busy,
                            onClick: () => setConfirming(account.id),
                          },
                          t('delete'),
                        ),
                  ),
                ),
                editing === index
                  ? h(
                      'div',
                      { className: 'ta-token' },
                      h('input', {
                        type: 'password',
                        autoComplete: 'off',
                        placeholder: t('token'),
                        value: tokenDraft,
                        onChange: (event) => setTokenDraft(event.target.value),
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'ta-btn',
                          'data-primary': 'true',
                          disabled: busy || !tokenDraft.trim(),
                          onClick: () => void saveToken(index),
                        },
                        t('save'),
                      ),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'ta-btn',
                          disabled: busy,
                          onClick: () => {
                            setEditing(null)
                            setTokenDraft('')
                          },
                        },
                        t('cancel'),
                      ),
                    )
                  : null,
              )
            }),
          )
        : h('div', { className: 'ta-empty' }, t('empty'))

      const formView = h(
        'div',
        { className: 'ta-form' },
        h('div', { className: 'ta-form-title' }, t('addTitle')),
        h(
          'div',
          { className: 'ta-grid' },
          h(
            'label',
            { className: 'ta-field' },
            h('span', null, t('name')),
            h('input', {
              value: form.name,
              placeholder: t('namePlaceholder'),
              onChange: (event) => setForm({ ...form, name: event.target.value }),
            }),
          ),
          h(
            'label',
            { className: 'ta-field' },
            h('span', null, t('project')),
            h('input', {
              value: form.project,
              placeholder: t('projectPlaceholder'),
              onChange: (event) => setForm({ ...form, project: event.target.value }),
            }),
          ),
          h(
            'label',
            { className: 'ta-field ta-field-wide' },
            h('span', null, t('token')),
            h('input', {
              type: 'password',
              autoComplete: 'off',
              value: form.token,
              placeholder: t('tokenPlaceholder'),
              onChange: (event) => setForm({ ...form, token: event.target.value }),
            }),
          ),
        ),
        h(
          'div',
          { className: 'ta-foot' },
          h('span', { className: 'ta-hint' }, t('note')),
          h(
            'button',
            {
              type: 'button',
              className: 'ta-btn',
              'data-primary': 'true',
              disabled: busy || !form.name.trim(),
              onClick: () => void add(),
            },
            t('add'),
          ),
        ),
      )

      return h(
        'div',
        { className: 'ta-section' },
        header,
        actionError ? h('div', { className: 'ta-error' }, t('errorPrefix') + actionError) : null,
        cards,
        formView,
      )
    }

    /* -------------------------------------------------------------------- chip */

    function TildaChip(props) {
      const t = props.t
      const ops = props.ops
      const { state } = useTilda(ops)
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState('')
      const rootRef = React.useRef(null)

      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const root = rootRef.current
          const target = event.target
          if (root && target && typeof root.contains === 'function' && root.contains(target)) return
          setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
        }
      }, [open])

      if (state.status !== 'ready') return null
      const data = state.data
      if (!data.accounts.length) return null
      const active = data.accounts.find((account) => account.id === data.activeId)

      const switchTo = async (id) => {
        setBusy(true)
        setError('')
        try {
          await ops.mutate(data, [{ op: 'set', path: ['activeId'], value: id }])
          setOpen(false)
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusy(false)
        }
      }

      return h(
        'div',
        { ref: rootRef, className: 'ta-chip-wrap' },
        h(
          'button',
          {
            type: 'button',
            className: 'ta-chip',
            title: t('chipHint'),
            'aria-expanded': open,
            onClick: () => setOpen((value) => !value),
          },
          h('span', { className: 'ta-chip-dot', 'aria-hidden': true }),
          h('span', null, `Tilda · ${active ? active.name : t('chipNone')}`),
        ),
        open
          ? h(
              'div',
              { className: 'ta-panel', role: 'group', 'aria-label': t('chipSwitch') },
              data.accounts.map((account) =>
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'ta-option',
                    key: account.id,
                    disabled: busy || account.id === data.activeId,
                    onClick: () => void switchTo(account.id),
                  },
                  h('span', { className: 'ta-option-name' }, account.name || account.id),
                  h(
                    'span',
                    { className: 'ta-option-meta' },
                    `${account.project ? account.project : t('noProject')}${account.id === data.activeId ? ` · ${t('active')}` : ''}`,
                  ),
                ),
              ),
              error ? h('div', { className: 'ta-panel-note ta-error' }, error) : null,
              h('div', { className: 'ta-panel-note' }, t('chipNote')),
            )
          : null,
      )
    }

    /* ------------------------------------------------------------------ plugin */

    function apply(ctx) {
      installStyle(ctx)

      const locale = ctx.get('locale')
      if (locale) {
        const register = (id, dict) => {
          try {
            return locale.register(NS, id, dict)
          } catch {
            return () => {}
          }
        }
        ctx.effect(() => register('en', EN), 'tilda-accounts:locale-en')
        ctx.effect(() => register('ru', RU), 'tilda-accounts:locale-ru')
        ctx.effect(() => {
          const sync = () => {
            const snapshot = locale.getSnapshot()
            const id = String((snapshot && snapshot.active) || 'en').split('-')[0].toLowerCase()
            activeLocale = DICTS[id] ? id : 'en'
          }
          sync()
          return locale.subscribe(sync)
        }, 'tilda-accounts:locale-active')
      }

      const ops = {
        load: () => loadSettings(ctx),
        mutate: (data, nextOps) => mutateSettings(ctx, data, nextOps),
        onChange: (callback) => {
          try {
            return ctx.remote.$on('settings/document-updated', callback)
          } catch {
            return () => {}
          }
        },
      }
      const injected = () => ({ t: translate, ops })

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'tilda',
            order: 30,
            label: () => translate('nav'),
            inject: injected,
          },
          TildaSettingsPage,
        ),
      )

      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'tilda-account',
            order: 3,
            inject: injected,
          },
          TildaChip,
        ),
      )
    }

    return {
      NS,
      apply,
      inject: ['slots', 'locale', 'remote', 'remote.settings'],
    }
  },
})
