/**
 * api.js — 三种模式共用一套调用面
 *
 *   demo   : 本地示例，不联网（用于真机验收 UI）
 *   direct : 手表直接请求 OpenAI 兼容接口（WorkBuddy / DeepSeek / OpenAI / Ollama…）
 *   bridge : 手表只请求自己的桥接服务；由桥接聚合多个 API 再调模型
 *
 * 统一返回 { text, meta } / 卡片数组；错误统一成 { code, message, detail }。
 */
;(function () {
  const TAG = 'api.js@wm'
  if (!globalThis.__wm_modules__) globalThis.__wm_modules__ = []
  globalThis.__wm_modules__.push(TAG)

  const WM = (globalThis.__wm = globalThis.__wm || {})
  const C = WM.config
  const H = WM.http
  const F = WM.format

  const CLIENT = { name: 'watchmate', version: '0.1.0' }

  function req() {
    return C.get().request || {}
  }

  function bridgeHeaders() {
    const h = { Accept: 'application/json' }
    const token = (C.get().bridge && C.get().bridge.token) || ''
    if (token) h.Authorization = 'Bearer ' + token
    return h
  }

  function providerHeaders(p) {
    const h = { Accept: 'application/json' }
    if (p && p.apiKey) {
      const name = p.authHeader || 'Authorization'
      const prefix = p.authPrefix === undefined ? 'Bearer ' : p.authPrefix
      h[name] = prefix + p.apiKey
    }
    return h
  }

  function ensureProvider() {
    const p = C.provider()
    if (!p) throw F.err('E_CONFIG', '没有可用服务商')
    if (!C.baseUrl(p)) throw F.err('E_CONFIG', p.label + ' 的接口地址为空')
    if (!p.model) throw F.err('E_CONFIG', p.label + ' 的模型为空')
    if (!p.apiKey && p.id !== 'ollama') throw F.err('E_CONFIG', p.label + ' 的 Key 为空')
    return p
  }

  function bridgeError(d) {
    const e = (d && d.error) || {}
    let code = e.code || 'E_SERVER'
    if (!/^E_/.test(code)) code = 'E_SERVER'
    return F.err(code, e.message || '桥接返回错误', { detail: e.hint || e.detail || '' })
  }

  function textFromOpenAI(data) {
    if (!data) return ''
    if (typeof data === 'string') return data
    if (typeof data.text === 'string') return data.text
    if (typeof data.output_text === 'string') return data.output_text

    const choices = data.choices
    if (choices && choices.length) {
      const c = choices[0]
      const msg = c.message || c.delta
      if (msg) {
        if (typeof msg.content === 'string') return msg.content
        if (F.isArray(msg.content)) {
          const parts = []
          for (let i = 0; i < msg.content.length; i++) {
            const p = msg.content[i]
            if (typeof p === 'string') parts.push(p)
            else if (p && typeof p.text === 'string') parts.push(p.text)
            else if (p && typeof p.content === 'string') parts.push(p.content)
          }
          if (parts.length) return parts.join('')
        }
      }
      if (typeof c.text === 'string') return c.text
    }

    if (F.isArray(data.content)) {
      const parts = []
      for (let i = 0; i < data.content.length; i++) {
        if (data.content[i] && typeof data.content[i].text === 'string') parts.push(data.content[i].text)
      }
      if (parts.length) return parts.join('')
    }
    if (typeof data.response === 'string') return data.response
    return ''
  }

  function usageOf(data) {
    if (!data || !data.usage) return null
    return data.usage
  }

  function demoAnswer(opt) {
    const label = (opt && opt.label) || ''
    const map = {
      今日简报: '1. 先做最重要的一件事\n2. 25 分钟专注，再休息 5 分钟\n3. 今天推进一点就够',
      起个名字: '腕行\n轻迹\n表伴',
      翻译: 'Work hard today too.\n今日も頑張ります。',
      解释一下: 'Vela 快应用是小米手表上的 JS 应用形态。\n它用 .ux 写界面，打包成 .rpk 安装。\n能调用传感器、网络和本地存储。',
      列清单: '1. 起床\n2. 喝水\n3. 洗漱\n4. 吃早饭\n5. 看日程',
      润色: '这个功能大概什么时候上线？',
      冷笑话: '手表说：我从不迟到，因为我一直在你手上。',
      吃什么: '番茄鸡蛋面\n鸡胸肉沙拉\n青菜豆腐汤'
    }
    const text =
      map[label] ||
      '这是演示模式的示例回答。\n在 config.local.json 里填入 WorkBuddy 或任意 OpenAI 兼容接口，就能得到真实回答。\n当前没有发出任何网络请求。'
    return new Promise(function (resolve) {
      setTimeout(function () {
        resolve({
          text: text,
          meta: { model: 'demo', ms: 400, mode: 'demo', provider: '内置示例', usage: null, demo: true }
        })
      }, 320)
    })
  }

  function demoCards() {
    const now = Date.now()
    return [
      { id: 'weather', title: '北京', value: '26', unit: '°C', detail: '湿度 48%', level: 'info', at: now, err: false },
      { id: 'btc', title: 'BTC', value: '512,340', unit: '¥', detail: '演示数据', level: 'info', at: now, err: false },
      { id: 'fx', title: '美元', value: '7.12', unit: 'CNY', detail: '演示数据', level: 'info', at: now, err: false },
      { id: 'github', title: 'GitHub', value: '3', unit: '条', detail: '最新 review: watch app', level: 'info', at: now, err: false }
    ]
  }

  function buildMessages(text, extraSystem) {
    const sys = extraSystem || req().systemPrompt || '回答请简短。'
    return [
      { role: 'system', content: sys },
      { role: 'user', content: text }
    ]
  }

  function chat(opt) {
    opt = opt || {}
    const mode = C.mode()
    if (mode === 'demo') return demoAnswer(opt)

    if (mode === 'bridge') {
      const base = C.bridgeUrl()
      if (!base) return Promise.reject(F.err('E_CONFIG', '桥接地址为空'))

      const useAsk = !!opt.promptId
      const url = base + (useAsk ? '/v1/ask' : '/v1/chat')
      const body = useAsk
        ? { promptId: opt.promptId, client: CLIENT }
        : {
            messages: opt.messages || buildMessages(opt.text || ''),
            text: opt.text || '',
            maxTokens: opt.maxTokens || req().maxTokens,
            temperature: req().temperature
          }
      const timeout = (C.get().bridge && C.get().bridge.timeoutMs) || req().timeoutMs || 22000

      return H.postJson(url, body, { headers: bridgeHeaders(), timeoutMs: timeout }).then(function (res) {
        const d = res.data || {}
        if (d.ok === false || d.error) throw bridgeError(d)
        const text = String(d.text || d.answer || '').trim()
        if (!text) throw F.err('E_EMPTY', '桥接返回了空回答')
        return {
          text: text,
          meta: {
            model: d.model || 'bridge',
            ms: d.ms || res.ms,
            mode: 'bridge',
            provider: d.provider || '桥接',
            usage: d.usage || null,
            sources: d.sources || []
          }
        }
      })
    }

    let p
    try {
      p = ensureProvider()
    } catch (e) {
      return Promise.reject(e)
    }

    const url = C.joinUrl(C.baseUrl(p), p.chatPath || '/chat/completions')
    const body = {
      model: p.model,
      messages: opt.messages || buildMessages(opt.text || ''),
      max_tokens: opt.maxTokens || req().maxTokens || 320,
      temperature: opt.temperature === undefined ? req().temperature : opt.temperature
    }
    const headers = providerHeaders(p)
    headers['Content-Type'] = 'application/json'

    return H.postJson(url, body, {
      headers: headers,
      timeoutMs: req().timeoutMs || 28000
    }).then(function (res) {
      const d = res.data || {}
      const text = String(textFromOpenAI(d) || '').trim()
      if (!text) throw F.err('E_EMPTY', '模型返回了空内容')
      return {
        text: text,
        meta: {
          model: d.model || p.model,
          ms: res.ms,
          mode: 'direct',
          provider: p.label,
          usage: usageOf(d)
        }
      }
    })
  }

  function ask(prompt) {
    if (!prompt) return Promise.reject(F.err('E_CONFIG', '指令为空'))
    if (C.isBridge() && prompt.id) {
      return chat({ promptId: prompt.id, label: prompt.label })
    }
    return chat({ text: prompt.text || prompt.label || '', label: prompt.label })
  }

  function free(text) {
    text = String(text || '').trim()
    if (!text) return Promise.reject(F.err('E_CONFIG', '内容为空'))
    return chat({ text: text, label: '自由输入' })
  }

  function normalizeCard(c, fallbackAt) {
    c = c || {}
    return {
      id: c.id || '',
      title: c.title || '未命名',
      value: c.value === undefined || c.value === null ? '—' : String(c.value),
      unit: c.unit || '',
      detail: c.detail || '',
      level: c.level || 'info',
      at: c.at || fallbackAt || Date.now(),
      err: !!c.err
    }
  }

  function fetchCard(def) {
    const timeout = def.timeoutMs || 8000
    const headers = {}
    const src = def.headers || {}
    for (const k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue
      const v = String(src[k] || '')
      if (/^Bearer\s*$/.test(v)) {
        return Promise.resolve(
          normalizeCard({
            id: def.id,
            title: def.title,
            value: '—',
            detail: '未配置 Token（' + k + '）',
            level: 'warn',
            err: true
          })
        )
      }
      headers[k] = v
    }

    const method = (def.method || 'GET').toUpperCase()
    const opt = { headers: headers, timeoutMs: timeout, method: method }
    if (method !== 'GET' && def.body !== undefined) opt.body = def.body

    return H.request({
      url: def.url,
      method: method,
      headers: headers,
      body: opt.body,
      timeoutMs: timeout
    })
      .then(function (res) {
        const data = res.data
        const value = F.pickPath(data, def.valuePath || '$')
        if (value === undefined) {
          throw F.err('E_PARSE', '字段不存在：' + (def.valuePath || '$'))
        }
        let detail = ''
        if (def.detailPath) {
          const dv = F.pickPath(data, def.detailPath)
          if (dv !== undefined && dv !== null) {
            detail = (def.detailPrefix || '') + F.fmtValue(dv) + (def.detailSuffix || '')
          }
        } else if (def.detail) {
          detail = def.detail
        }
        return normalizeCard({
          id: def.id,
          title: def.title,
          value: F.fmtValue(value),
          unit: def.unit || '',
          detail: F.clip(detail, 38),
          level: def.level || 'info',
          err: false
        })
      })
      .catch(function (e) {
        const info = F.errorInfo(F.toError(e))
        return normalizeCard({
          id: def.id,
          title: def.title,
          value: '—',
          detail: info.title + ' · ' + info.hint,
          level: 'bad',
          err: true
        })
      })
  }

  function directCards() {
    const list = (C.get().cards || []).slice(0, 4)
    if (!list.length) return Promise.resolve([])
    const jobs = []
    for (let i = 0; i < list.length; i++) jobs.push(fetchCard(list[i]))
    return Promise.all(jobs)
  }

  function cards() {
    const mode = C.mode()
    if (mode === 'demo') return Promise.resolve(demoCards())

    if (mode === 'bridge') {
      const base = C.bridgeUrl()
      if (!base) return Promise.reject(F.err('E_CONFIG', '桥接地址为空'))
      return H.getJson(base + '/api/cards', {
        headers: bridgeHeaders(),
        timeoutMs: req().timeoutMs || 22000
      }).then(function (res) {
        const d = res.data || {}
        if (d.ok === false || d.error) throw bridgeError(d)
        const list = d.cards || []
        const out = []
        for (let i = 0; i < list.length && out.length < 4; i++) out.push(normalizeCard(list[i], d.at))
        return out
      })
    }

    return directCards()
  }

  function fallbackPrompts() {
    const list = C.get().prompts || []
    const out = []
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].id && list[i].label) out.push(list[i])
    }
    return out
  }

  function prompts() {
    const mode = C.mode()
    if (mode === 'demo' || mode === 'direct') return Promise.resolve(fallbackPrompts())

    const base = C.bridgeUrl()
    if (!base) return Promise.resolve(fallbackPrompts())

    return H.getJson(base + '/api/prompts', {
      headers: bridgeHeaders(),
      timeoutMs: 8000
    })
      .then(function (res) {
        const d = res.data || {}
        if (d.ok === false || d.error) throw bridgeError(d)
        const list = d.prompts || []
        if (!list.length) return fallbackPrompts()
        return list
      })
      .catch(function (e) {
        if (WM.store) WM.store.lastError(e)
        return fallbackPrompts()
      })
  }

  function test() {
    const mode = C.mode()
    const started = Date.now()
    if (mode === 'demo') {
      return Promise.resolve({ ok: true, label: '演示模式', detail: '不会发出请求', ms: 0, warn: false })
    }

    if (mode === 'bridge') {
      const base = C.bridgeUrl()
      if (!base) return Promise.reject(F.err('E_CONFIG', '桥接地址为空'))
      return H.getJson(base + '/health', { headers: bridgeHeaders(), timeoutMs: 8000 }).then(function (res) {
        const d = res.data || {}
        return {
          ok: true,
          label: '桥接正常',
          detail: (d.provider || '?') + ' · ' + (d.model || '?') + ' · ' + F.fmtMs(res.ms),
          ms: Date.now() - started,
          warn: false
        }
      })
    }

    let p
    try {
      p = ensureProvider()
    } catch (e) {
      return Promise.reject(e)
    }
    const url = C.joinUrl(C.baseUrl(p), p.modelsPath || '/models')
    return H.getJson(url, { headers: providerHeaders(p), timeoutMs: 10000 })
      .then(function (res) {
        return {
          ok: true,
          label: '端点可达',
          detail: p.label + ' · HTTP ' + res.status + ' · ' + F.fmtMs(res.ms),
          ms: res.ms,
          warn: false
        }
      })
      .catch(function (e) {
        if (e && e.status === 404) {
          return {
            ok: true,
            label: '端点可达',
            detail: '没有 /models，问答仍可能可用',
            ms: Date.now() - started,
            warn: true
          }
        }
        throw e
      })
  }

  WM.api = {
    TAG: TAG,
    chat: chat,
    ask: ask,
    free: free,
    cards: cards,
    prompts: prompts,
    test: test,
    textFromOpenAI: textFromOpenAI,
    normalizeCard: normalizeCard
  }
})()
