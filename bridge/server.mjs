#!/usr/bin/env node
/**
 * server.mjs — 「腕上搭档」桥接服务
 *
 * 手表只认一套很窄的协议；这里把 WorkBuddy / 任意 OpenAI 兼容模型、
 * 天气、GitHub、自定义 HTTP、本地笔记 拼成一次请求。
 *
 * 零依赖，Node 18+。
 *   node watchmate/bridge/server.mjs
 *   WM_PROVIDER_BASE_URL=https://.../v1 WM_PROVIDER_KEY=sk-... node watchmate/bridge/server.mjs
 */

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const VERSION = '0.1.0'
const MAX_BODY = 128 * 1024

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}

function merge(base, over) {
  if (over === undefined) return base
  if (Array.isArray(base) || Array.isArray(over)) return over
  if (isObj(base) && isObj(over)) {
    const out = {}
    for (const k of Object.keys(base)) out[k] = base[k]
    for (const k of Object.keys(over)) out[k] = merge(base[k], over[k])
    return out
  }
  return over
}

function expandEnv(value) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => process.env[name] || '')
  }
  if (Array.isArray(value)) return value.map(expandEnv)
  if (isObj(value)) {
    const out = {}
    for (const k of Object.keys(value)) out[k] = expandEnv(value[k])
    return out
  }
  return value
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  for (const line of lines) {
    const s = line.trim()
    if (!s || s.charAt(0) === '#') continue
    const i = s.indexOf('=')
    if (i < 0) continue
    const k = s.slice(0, i).trim()
    let v = s.slice(i + 1).trim()
    if ((v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') || (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

export function loadConfig(dir = HERE) {
  loadDotEnv(path.join(dir, '.env'))
  const baseFile = path.join(dir, 'config.default.json')
  const localFile = path.join(dir, 'config.local.json')
  if (!fs.existsSync(baseFile)) throw new Error('缺少 ' + baseFile)
  const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'))
  const local = fs.existsSync(localFile) ? JSON.parse(fs.readFileSync(localFile, 'utf8')) : null
  let cfg = expandEnv(local ? merge(base, local) : base)

  const env = process.env
  cfg.server = cfg.server || {}
  if (env.WM_SERVER_PORT) cfg.server.port = Number(env.WM_SERVER_PORT)
  if (env.WM_SERVER_HOST) cfg.server.host = env.WM_SERVER_HOST
  if (env.WM_SERVER_TOKEN) cfg.server.token = env.WM_SERVER_TOKEN

  const p = (cfg.provider = cfg.provider || {})
  if (env.WM_PROVIDER_BASE_URL) p.baseUrl = env.WM_PROVIDER_BASE_URL
  if (env.WM_PROVIDER_MODEL) p.model = env.WM_PROVIDER_MODEL
  if (env.WM_PROVIDER_LABEL) p.label = env.WM_PROVIDER_LABEL
  if (env.WM_PROVIDER_KEY) p.apiKey = env.WM_PROVIDER_KEY
  if (!p.apiKey && p.apiKeyEnv && env[p.apiKeyEnv]) p.apiKey = env[p.apiKeyEnv]

  cfg.integrations = cfg.integrations || {}
  if (env.GITHUB_TOKEN && !cfg.integrations.githubToken) cfg.integrations.githubToken = env.GITHUB_TOKEN
  if (env.WM_GITHUB_TOKEN && !cfg.integrations.githubToken) cfg.integrations.githubToken = env.WM_GITHUB_TOKEN

  return cfg
}

function isPlaceholder(url) {
  return !url || url.indexOf('your-') !== -1 || url.indexOf('example.com') !== -1
}

export function resolveProvider(cfg) {
  const p = cfg.provider || {}
  let kind = p.kind || 'auto'
  if (kind === 'auto') {
    kind = !isPlaceholder(p.baseUrl) ? 'openai' : 'echo'
  }
  if (kind === 'openai') {
    if (isPlaceholder(p.baseUrl)) throw new Error('provider.baseUrl 未配置')
    if (!p.model) throw new Error('provider.model 未配置')
  }
  return {
    kind,
    label: p.label || (kind === 'echo' ? '演示 Provider' : 'LLM'),
    baseUrl: p.baseUrl || '',
    chatPath: p.chatPath || '/chat/completions',
    model: p.model || (kind === 'echo' ? 'echo' : ''),
    apiKey: p.apiKey || '',
    authHeader: p.authHeader || 'Authorization',
    authPrefix: p.authPrefix === undefined ? 'Bearer ' : p.authPrefix,
    maxTokens: p.maxTokens || 320,
    temperature: p.temperature === undefined ? 0.4 : p.temperature,
    timeoutMs: p.timeoutMs || 25000
  }
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function pad2(n) {
  return n < 10 ? '0' + n : String(n)
}

function nowText() {
  const d = new Date()
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return (
    d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
    ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ' 周' + week
  )
}

function clip(s, n) {
  s = s === null || s === undefined ? '' : String(s)
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

function pickPath(obj, p) {
  if (!p || p === '$') return obj
  const tokens = String(p).match(/[^.[\]]+/g) || []
  let cur = obj
  for (const t of tokens) {
    if (cur === null || cur === undefined) return undefined
    if (t === 'length' && (Array.isArray(cur) || typeof cur === 'string')) {
      cur = cur.length
      continue
    }
    cur = cur[t]
  }
  return cur
}

function bridgeErr(code, message, hint, status) {
  const e = new Error(message)
  e.code = code
  e.hint = hint || ''
  e.status = status || 502
  return e
}

const HINTS = {
  E_CONFIG: '检查 bridge/config.local.json 里的 provider 与 integrations',
  E_AUTH: 'Key / Token 不正确，或没有该模型权限',
  E_RATE: '上游限流，稍后再试',
  E_TIMEOUT: '上游超时，检查网络或调大 timeoutMs',
  E_NET: '桥接访问上游失败，检查网络/代理',
  E_PARSE: '上游返回的不是预期 JSON',
  E_EMPTY: '模型返回空内容',
  E_HTTP: '上游 HTTP 错误',
  E_SERVER: '桥接内部错误，看服务端日志',
  E_BODY: '请求体不是合法 JSON 或过大'
}

function errorHint(code) {
  return HINTS[code] || HINTS.E_SERVER
}

function httpError(status, body) {
  let code = 'E_HTTP'
  if (status === 401 || status === 403) code = 'E_AUTH'
  else if (status === 429) code = 'E_RATE'
  else if (status >= 500) code = 'E_SERVER'
  return bridgeErr(code, '上游 HTTP ' + status, clip(body, 120), 502)
}

async function fetchWithTimeout(url, opt, ms) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), ms)
  try {
    return await fetch(url, Object.assign({}, opt, { signal: ac.signal }))
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
      throw bridgeErr('E_TIMEOUT', '上游超时 ' + ms + 'ms', errorHint('E_TIMEOUT'), 504)
    }
    throw bridgeErr('E_NET', '访问上游失败：' + ((e && e.message) || e), errorHint('E_NET'), 502)
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url, opt, ms) {
  const res = await fetchWithTimeout(url, opt, ms)
  const text = await res.text()
  let data = null
  try {
    data = JSON.parse(text)
  } catch (e) {}
  if (!res.ok) throw httpError(res.status, text)
  return { status: res.status, data: data, text: text }
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a))
  const B = Buffer.from(String(b))
  if (A.length !== B.length) return false
  return crypto.timingSafeEqual(A, B)
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ------------------------------------------------------------------ */
/* 数据源                                                              */
/* ------------------------------------------------------------------ */

async function githubList(cfg, limit) {
  const token = cfg.integrations.githubToken || process.env.GITHUB_TOKEN || ''
  if (!token) throw bridgeErr('E_CONFIG', '未配置 GITHUB_TOKEN', '在 bridge/.env 里设置 GITHUB_TOKEN', 400)
  const url = 'https://api.github.com/notifications?per_page=' + Math.max(1, Math.min(50, limit || 8))
  const r = await fetchJson(
    url,
    {
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'watchmate-bridge/' + VERSION
      }
    },
    9000
  )
  const arr = Array.isArray(r.data) ? r.data : []
  const lines = arr.slice(0, limit || 8).map((n) => {
    const repo = (n.repository && n.repository.full_name) || 'repo'
    const title = (n.subject && n.subject.title) || '(无标题)'
    return '- [' + repo + '] ' + title
  })
  return { count: arr.length, lines: lines, text: lines.length ? lines.join('\n') : '（没有未读通知）' }
}

async function weatherNow(cfg) {
  const w = (cfg.integrations && cfg.integrations.weather) || {}
  const lat = w.lat === undefined ? 39.9042 : w.lat
  const lon = w.lon === undefined ? 116.4074 : w.lon
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,relative_humidity_2m&timezone=Asia%2FShanghai'
  const r = await fetchJson(url, { headers: { Accept: 'application/json' } }, 8000)
  const cur = (r.data && r.data.current) || {}
  return {
    label: w.label || '本地',
    temp: cur.temperature_2m,
    humidity: cur.relative_humidity_2m
  }
}

function readNotes(cfg, rel, max) {
  const base = HERE
  const abs = path.resolve(base, rel || './notes.md')
  if (abs !== base && abs.indexOf(base + path.sep) !== 0) {
    throw bridgeErr('E_CONFIG', '笔记路径越界', '只允许读 bridge 目录内的文件', 400)
  }
  if (!fs.existsSync(abs)) {
    throw bridgeErr('E_CONFIG', '未找到 ' + (rel || './notes.md'), '在 bridge/ 下新建 notes.md 即可', 400)
  }
  const text = fs.readFileSync(abs, 'utf8').trim()
  if (!text) throw bridgeErr('E_EMPTY', '笔记是空的', '', 400)
  return clip(text, max || 1200)
}

async function sourceText(cfg, src) {
  const type = src.type || 'static'
  if (type === 'time') return nowText()
  if (type === 'static') return String(src.text || '')
  if (type === 'file') return readNotes(cfg, src.path, src.max)
  if (type === 'github') {
    const g = await githubList(cfg, src.limit || 8)
    return g.text
  }
  if (type === 'weather') {
    const w = await weatherNow(cfg)
    return w.label + ' ' + w.temp + '°C · 湿度 ' + w.humidity + '%'
  }
  if (type === 'http') {
    if (!src.url) throw bridgeErr('E_CONFIG', 'http 数据源缺少 url', '', 400)
    const r = await fetchJson(
      src.url,
      {
        method: src.method || 'GET',
        headers: Object.assign({ Accept: 'application/json' }, src.headers || {}),
        body: src.body ? JSON.stringify(src.body) : undefined
      },
      src.timeoutMs || 8000
    )
    const v = src.pick ? pickPath(r.data, src.pick) : r.data
    if (v === undefined) throw bridgeErr('E_PARSE', '字段不存在：' + src.pick, '', 400)
    if (src.format === 'lines' && Array.isArray(v)) {
      return v.slice(0, 20).map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('\n')
    }
    return clip(typeof v === 'string' ? v : JSON.stringify(v), 1500)
  }
  throw bridgeErr('E_CONFIG', '未知数据源类型：' + type, '', 400)
}

async function gather(cfg, sources) {
  const list = sources || []
  const started = Date.now()
  const results = await Promise.all(
    list.map(async (src) => {
      const t0 = Date.now()
      try {
        const text = await sourceText(cfg, src)
        return { key: src.key, ok: true, ms: Date.now() - t0, text: text }
      } catch (e) {
        const msg = clip((e && e.message) || e, 60)
        return { key: src.key, ok: false, ms: Date.now() - t0, text: '（' + src.key + ' 不可用：' + msg + '）' }
      }
    })
  )
  const vars = {}
  for (const r of results) vars[r.key] = r.text
  return {
    vars: vars,
    meta: results.map((r) => ({ key: r.key, ok: r.ok, ms: r.ms })),
    ms: Date.now() - started
  }
}

/* ------------------------------------------------------------------ */
/* LLM                                                                 */
/* ------------------------------------------------------------------ */

function extractText(data) {
  if (!data) return ''
  if (typeof data === 'string') return data
  if (typeof data.text === 'string') return data.text
  if (typeof data.output_text === 'string') return data.output_text
  const choices = data.choices
  if (Array.isArray(choices) && choices.length) {
    const c = choices[0]
    const msg = c.message || c.delta
    if (msg) {
      if (typeof msg.content === 'string') return msg.content
      if (Array.isArray(msg.content)) {
        return msg.content
          .map((p) => (typeof p === 'string' ? p : p && (p.text || p.content) ? p.text || p.content : ''))
          .join('')
      }
    }
    if (typeof c.text === 'string') return c.text
  }
  if (Array.isArray(data.content)) {
    return data.content.map((p) => (p && p.text) || '').join('')
  }
  return ''
}

function echoReply(messages, sources) {
  const last = messages[messages.length - 1] || {}
  const text = String(last.content || '')
  const first = clip(text.replace(/\s+/g, ' '), 46)
  const lines = ['（演示桥接）收到：' + (first || '空请求')]
  if (sources && sources.length) {
    const ok = sources.filter((s) => s.ok)
    const bad = sources.length - ok.length
    lines.push('数据源：' + ok.length + ' 个成功' + (bad ? ' · ' + bad + ' 个失败' : ''))
  }
  lines.push('接 WorkBuddy：设置 WM_PROVIDER_BASE_URL / KEY / MODEL 后重启')
  return { text: lines.join('\n'), model: 'echo', usage: null }
}

async function callLLM(cfg, provider, messages, sources) {
  if (provider.kind === 'echo') return echoReply(messages, sources)

  const url = provider.baseUrl.replace(/\/+$/, '') + provider.chatPath
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (provider.apiKey) headers[provider.authHeader] = provider.authPrefix + provider.apiKey

  const body = {
    model: provider.model,
    messages: messages,
    max_tokens: provider.maxTokens,
    temperature: provider.temperature
  }
  const t0 = Date.now()
  const r = await fetchJson(
    url,
    { method: 'POST', headers: headers, body: JSON.stringify(body) },
    provider.timeoutMs
  )
  const text = String(extractText(r.data) || '').trim()
  if (!text) throw bridgeErr('E_EMPTY', '模型返回空内容', errorHint('E_EMPTY'), 502)
  return {
    text: text,
    model: (r.data && r.data.model) || provider.model,
    usage: (r.data && r.data.usage) || null,
    ms: Date.now() - t0
  }
}

/* ------------------------------------------------------------------ */
/* 卡片                                                                */
/* ------------------------------------------------------------------ */

const cache = new Map()

async function withCache(key, ttlSec, fn) {
  const now = Date.now()
  const hit = cache.get(key)
  if (hit && now - hit.at < ttlSec * 1000) return hit.value
  const value = await fn()
  cache.set(key, { at: now, value: value })
  return value
}

function cardBase(def) {
  return {
    id: def.id || '',
    title: def.title || '未命名',
    value: '—',
    unit: def.unit || '',
    detail: '',
    level: def.level || 'info',
    at: Date.now(),
    err: false
  }
}

async function buildCard(cfg, provider, startedAt, def) {
  const ttl = def.cacheSec === undefined ? 20 : def.cacheSec
  const run = async () => {
    const card = cardBase(def)
    if (def.type === 'self') {
      const mins = Math.max(0, Math.round((Date.now() - startedAt) / 60000))
      card.value = String(mins)
      card.unit = '分钟'
      card.detail = provider.label + ' · ' + (provider.model || provider.kind)
      return card
    }
    if (def.type === 'static') {
      card.value = String(def.value === undefined ? '—' : def.value)
      card.detail = def.detail || ''
      return card
    }
    if (def.type === 'weather') {
      const w = await weatherNow(cfg)
      card.title = def.title || w.label
      card.value = w.temp === undefined ? '—' : String(w.temp)
      card.unit = def.unit || '°C'
      card.detail = '湿度 ' + (w.humidity === undefined ? '—' : w.humidity) + '%'
      return card
    }
    if (def.type === 'github') {
      const g = await githubList(cfg, def.limit || 5)
      card.value = String(g.count)
      card.unit = def.unit || '条'
      card.detail = g.lines.length ? '最新 ' + clip(g.lines[0].replace(/^- \[[^\]]*\]\s*/, ''), 32) : '没有未读'
      return card
    }
    if (def.type === 'http') {
      if (!def.url) throw bridgeErr('E_CONFIG', '卡片缺少 url', '', 400)
      const r = await fetchJson(
        def.url,
        {
          method: def.method || 'GET',
          headers: Object.assign({ Accept: 'application/json' }, def.headers || {}),
          body: def.body ? JSON.stringify(def.body) : undefined
        },
        def.timeoutMs || 8000
      )
      const v = pickPath(r.data, def.valuePath || '$')
      if (v === undefined) throw bridgeErr('E_PARSE', '字段不存在：' + (def.valuePath || '$'), '', 400)
      card.value = typeof v === 'number' ? String(Math.round(v * 100) / 100) : clip(v, 24)
      if (def.detailPath) {
        const d = pickPath(r.data, def.detailPath)
        if (d !== undefined) card.detail = clip((def.detailPrefix || '') + d + (def.detailSuffix || ''), 38)
      } else if (def.detail) {
        card.detail = clip(def.detail, 38)
      }
      return card
    }
    throw bridgeErr('E_CONFIG', '未知卡片类型：' + def.type, '', 400)
  }

  try {
    return ttl > 0 ? await withCache('card:' + def.id, ttl, run) : await run()
  } catch (e) {
    const card = cardBase(def)
    card.value = '—'
    card.level = e.code === 'E_CONFIG' ? 'warn' : 'bad'
    card.err = true
    card.detail = clip(((e && e.message) || '失败') + ' · ' + errorHint(e.code), 40)
    return card
  }
}

/* ------------------------------------------------------------------ */
/* 服务                                                                */
/* ------------------------------------------------------------------ */

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  })
  res.end(body)
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store'
  })
  res.end(html)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(bridgeErr('E_BODY', '请求体过大', '', 413))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (!text) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch (e) {
        reject(bridgeErr('E_BODY', '请求体不是合法 JSON', '', 400))
      }
    })
    req.on('error', (e) => reject(bridgeErr('E_BODY', '读取请求体失败：' + e.message, '', 400)))
  })
}

function normalizeMessages(body, cfg) {
  if (Array.isArray(body.messages) && body.messages.length) {
    const out = []
    for (const m of body.messages.slice(0, 12)) {
      if (!m || typeof m.content !== 'string') continue
      const role = m.role === 'system' || m.role === 'assistant' ? m.role : 'user'
      out.push({ role: role, content: clip(m.content, 4000) })
    }
    if (out.length) return out
  }
  const text = String(body.text || '').trim()
  if (!text) throw bridgeErr('E_CONFIG', '缺少 messages 或 text', '传 {"text":"..."}', 400)
  return [
    { role: 'system', content: cfg.systemPrompt || '回答请简短。' },
    { role: 'user', content: clip(text, 4000) }
  ]
}

export function createBridgeServer(cfg) {
  const startedAt = Date.now()
  const provider = resolveProvider(cfg)
  const token = (cfg.server && cfg.server.token) || ''

  function authorized(req) {
    if (!token) return true
    const h = req.headers.authorization || ''
    const got = String(h).replace(/^Bearer\s+/i, '')
    return safeEqual(got, token)
  }

  async function handle(req, res) {
    const t0 = Date.now()
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url, 'http://localhost')
    let pathname = url.pathname
    if (pathname.length > 1 && pathname.charAt(pathname.length - 1) === '/') pathname = pathname.slice(0, -1)

    if (pathname === '/') {
      sendHtml(res, 200, homePage(cfg, provider, startedAt, token))
      log(req, 200, t0)
      return
    }

    if (pathname !== '/health' && !authorized(req)) {
      sendJson(res, 401, {
        ok: false,
        error: { code: 'E_AUTH', message: '桥接 Token 不正确', hint: '手表设置里的 bridge.token 要和服务端一致' }
      })
      log(req, 401, t0)
      return
    }

    if (pathname === '/health') {
      if (!authorized(req)) {
        sendJson(res, 401, { ok: false, error: { code: 'E_AUTH', message: 'Token 不正确', hint: '' } })
        log(req, 401, t0)
        return
      }
      sendJson(res, 200, {
        ok: true,
        version: VERSION,
        provider: provider.kind === 'echo' ? 'echo (demo)' : provider.label,
        model: provider.model,
        uptimeMs: Date.now() - startedAt,
        cards: (cfg.cards || []).length,
        prompts: (cfg.prompts || []).length,
        time: nowText()
      })
      log(req, 200, t0)
      return
    }

    if (pathname === '/api/prompts' && req.method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        prompts: (cfg.prompts || []).map((p) => ({ id: p.id, label: p.label, hint: p.hint || '' })),
        at: Date.now()
      })
      log(req, 200, t0)
      return
    }

    if (pathname === '/api/cards' && req.method === 'GET') {
      const defs = (cfg.cards || []).slice(0, 8)
      const cards = await Promise.all(defs.map((d) => buildCard(cfg, provider, startedAt, d)))
      sendJson(res, 200, { ok: true, cards: cards, at: Date.now() })
      log(req, 200, t0)
      return
    }

    if (pathname === '/v1/chat' && req.method === 'POST') {
      const body = await readJson(req)
      const messages = normalizeMessages(body, cfg)
      const out = await callLLM(cfg, provider, messages, null)
      sendJson(res, 200, {
        ok: true,
        text: out.text,
        model: out.model,
        provider: provider.kind === 'echo' ? 'echo (demo)' : provider.label,
        ms: out.ms || Date.now() - t0,
        usage: out.usage || null
      })
      log(req, 200, t0)
      return
    }

    if (pathname === '/v1/ask' && req.method === 'POST') {
      const body = await readJson(req)
      let prompt = null
      if (body.promptId) {
        prompt = (cfg.prompts || []).find((p) => p.id === body.promptId)
        if (!prompt) throw bridgeErr('E_CONFIG', '未知指令：' + body.promptId, '检查 /api/prompts', 404)
      }

      let userText = String(body.text || '').trim()
      let sources = []
      let gatherMs = 0
      if (prompt) {
        const g = await gather(cfg, prompt.sources)
        sources = g.meta
        gatherMs = g.ms
        const vars = Object.assign({ time: nowText() }, g.vars)
        userText = String(prompt.template || '{{text}}').replace(/\{\{(\w+)\}\}/g, (_, k) =>
          vars[k] === undefined ? '（无）' : String(vars[k])
        )
      }
      if (!userText) throw bridgeErr('E_CONFIG', '缺少 promptId 或 text', '', 400)

      const messages = [
        { role: 'system', content: (cfg.systemPrompt || '回答请简短。') + (prompt && prompt.system ? '\n' + prompt.system : '') },
        { role: 'user', content: clip(userText, 4000) }
      ]
      const out = await callLLM(cfg, provider, messages, sources)
      sendJson(res, 200, {
        ok: true,
        text: out.text,
        model: out.model,
        provider: provider.kind === 'echo' ? 'echo (demo)' : provider.label,
        ms: out.ms || Date.now() - t0,
        gatherMs: gatherMs,
        usage: out.usage || null,
        sources: sources
      })
      log(req, 200, t0)
      return
    }

    sendJson(res, 404, { ok: false, error: { code: 'E_HTTP', message: '没有这个接口', hint: pathname } })
    log(req, 404, t0)
  }

  function log(req, status, t0) {
    const ms = Date.now() - t0
    console.log(
      '[' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '] ' +
        req.method + ' ' + req.url + ' ' + status + ' ' + ms + 'ms'
    )
  }

  const server = http.createServer((req, res) => {
    const started = Date.now()
    handle(req, res).catch((e) => {
      const code = e.code || 'E_SERVER'
      const status = e.status || 500
      if (status >= 500) console.error('[error]', req.method, req.url, code, e.message)
      sendJson(res, status, {
        ok: false,
        error: { code: code, message: e.message || '桥接内部错误', hint: e.hint || errorHint(code) }
      })
      log(req, status, started)
    })
  })

  server.bridgeConfig = cfg
  server.bridgeProvider = provider
  return server
}

function homePage(cfg, provider, startedAt, token) {
  const mins = Math.max(0, Math.round((Date.now() - startedAt) / 60000))
  const rows = [
    ['GET', '/health', '服务状态'],
    ['GET', '/api/prompts', '指令列表'],
    ['GET', '/api/cards', '卡片数据'],
    ['POST', '/v1/ask', '按 promptId 执行配方'],
    ['POST', '/v1/chat', '自由文本问答']
  ]
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>腕上搭档 · 桥接</title>
<style>
body{margin:0;background:#07090d;color:#dfe7f2;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:28px}
h1{font-size:22px;margin:0 0 4px}
.muted{color:#7f8a9d}
.card{background:#0f141d;border:1px solid #1b2230;border-radius:14px;padding:16px;margin:16px 0;max-width:720px}
code{background:#151b25;padding:2px 6px;border-radius:6px;color:#9ff0d8}
table{width:100%;border-collapse:collapse}
td{padding:7px 0;border-bottom:1px solid #161d28;vertical-align:top}
td:first-child{width:70px;color:#5ee1c1}
td:nth-child(2){width:170px;color:#c3cddc}
.ok{color:#6ee7a8}.warn{color:#f3c07b}
</style></head><body>
<h1>腕上搭档 · 桥接</h1>
<div class="muted">运行 ${mins} 分钟 · v${VERSION}</div>
<div class="card">
  <div>Provider：<b>${esc(provider.kind === 'echo' ? 'echo (演示)' : provider.label)}</b>
  · 模型：<code>${esc(provider.model || '—')}</code></div>
  <div class="muted" style="margin-top:6px">Token：${token ? '<span class="ok">已启用</span>' : '<span class="warn">未设置（任何人都能访问）</span>'}
  · 卡片 ${(cfg.cards || []).length} 张 · 指令 ${(cfg.prompts || []).length} 条</div>
</div>
<div class="card">
  <table>${rows
    .map((r) => `<tr><td>${r[0]}</td><td><code>${r[1]}</code></td><td>${r[2]}</td></tr>`)
    .join('')}</table>
</div>
<div class="card muted">
  ${provider.kind === 'echo'
    ? '当前是演示模式：不会调用模型。设置 <code>WM_PROVIDER_BASE_URL</code>、<code>WM_PROVIDER_KEY</code>、<code>WM_PROVIDER_MODEL</code> 后重启即可接 WorkBuddy。'
    : '手表端把 <code>bridge.url</code> 设为这个服务的可访问地址；跨设备访问时建议加 Token，并使用 HTTPS。'}
</div>
</body></html>`
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url

if (isMain) {
  let cfg
  try {
    cfg = loadConfig()
  } catch (e) {
    console.error('配置读取失败：' + e.message)
    process.exit(2)
  }
  const server = createBridgeServer(cfg)
  const p = server.bridgeProvider
  const port = (cfg.server && cfg.server.port) || 8787
  const host = (cfg.server && cfg.server.host) || '127.0.0.1'

  server.listen(port, host, () => {
    console.log('')
    console.log('腕上搭档 · 桥接 v' + VERSION)
    console.log('  地址：http://' + host + ':' + port)
    console.log('  Provider：' + (p.kind === 'echo' ? 'echo (演示，不联网)' : p.label + ' · ' + p.model))
    console.log('  Token：' + ((cfg.server && cfg.server.token) ? '已启用' : '未设置'))
    console.log('  卡片：' + (cfg.cards || []).length + ' · 指令：' + (cfg.prompts || []).length)
    if (p.kind === 'echo') {
      console.log('')
      console.log('  接 WorkBuddy：')
      console.log('    WM_PROVIDER_BASE_URL=https://<你的 OpenAI 兼容地址>/v1 \\')
      console.log('    WM_PROVIDER_KEY=sk-... WM_PROVIDER_MODEL=<模型名> \\')
      console.log('    node watchmate/bridge/server.mjs')
    }
    if (host === '0.0.0.0' && !(cfg.server && cfg.server.token)) {
      console.log('')
      console.log('  ⚠ 监听 0.0.0.0 但没有设置 Token，建议设置 WM_SERVER_TOKEN')
    }
    console.log('')
  })

  const stop = () => {
    console.log('\n关闭中…')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1500)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
