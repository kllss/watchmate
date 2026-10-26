/**
 * config.js — 读取构建期注入的配置，叠加运行时选择
 *
 * 配置来源：build.mjs 把 config.default.json + config.local.json 合并后写进
 * .build/src/config.gen.js，展开 ${ENV}，最后打包进 RPK。
 * 注意：打进包里的 Key 一定能被解出来，敏感场景请用桥接模式。
 */
;(function () {
  const TAG = 'config.js@wm'
  if (!globalThis.__wm_modules__) globalThis.__wm_modules__ = []
  globalThis.__wm_modules__.push(TAG)

  const WM = (globalThis.__wm = globalThis.__wm || {})
  const RAW = globalThis.__wm_config_raw || null
  const RUNTIME = (globalThis.__wm_runtime = globalThis.__wm_runtime || {})

  const FALLBACK = {
    schema: 0,
    mode: 'demo',
    bridge: { url: '', token: '', timeoutMs: 22000 },
    activeProvider: '',
    providers: [],
    request: {
      timeoutMs: 28000,
      maxTokens: 320,
      temperature: 0.4,
      maxChars: 900,
      systemPrompt: '你是一个手表助手。回答必须短：最多 120 个汉字或 4 行。'
    },
    prompts: [],
    cards: []
  }

  const cfg = RAW || FALLBACK

  function clone(o) {
    const out = {}
    for (const k in o) {
      if (!Object.prototype.hasOwnProperty.call(o, k)) continue
      const v = o[k]
      out[k] = v && typeof v === 'object' && !Array.isArray(v) ? clone(v) : v
    }
    return out
  }

  function get() {
    return cfg
  }

  function mode() {
    return RUNTIME.mode || cfg.mode || 'direct'
  }

  function isBridge() {
    return mode() === 'bridge'
  }

  function isDemo() {
    return mode() === 'demo'
  }

  function providers() {
    return cfg.providers || []
  }

  function providerById(id) {
    const list = providers()
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i]
    }
    return null
  }

  function provider() {
    const id = RUNTIME.providerId || cfg.activeProvider
    return providerById(id) || providers()[0] || null
  }

  function stripSlash(s) {
    s = s || ''
    while (s.length && s.charAt(s.length - 1) === '/') s = s.slice(0, -1)
    return s
  }

  function bridgeUrl() {
    return stripSlash((cfg.bridge && cfg.bridge.url) || '')
  }

  function baseUrl(p) {
    return stripSlash((p && p.baseUrl) || '')
  }

  function joinUrl(base, path) {
    base = stripSlash(base)
    path = path || ''
    if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) return path
    if (!base) return path
    if (!path) return base
    return base + (path.charAt(0) === '/' ? path : '/' + path)
  }

  function hostOf(url) {
    const s = String(url || '').replace(/^https?:\/\//, '')
    const i = s.indexOf('/')
    return i >= 0 ? s.slice(0, i) : s
  }

  function maskKey(key) {
    key = String(key || '')
    if (!key) return '未配置'
    if (key.length <= 6) return '已配置'
    return '已配置 ····' + key.slice(-4)
  }

  function setMode(next) {
    if (next !== 'direct' && next !== 'bridge' && next !== 'demo') return
    RUNTIME.mode = next
  }

  function setProvider(id) {
    RUNTIME.providerId = id
  }

  function providerIndex() {
    const list = providers()
    const cur = provider()
    if (!cur) return -1
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === cur.id) return i
    }
    return -1
  }

  function cycleProvider(dir) {
    const list = providers()
    if (!list.length) return null
    let i = providerIndex()
    i = (i + (dir || 1) + list.length) % list.length
    RUNTIME.providerId = list[i].id
    return list[i]
  }

  function issues() {
    const out = []
    if (isDemo()) {
      out.push('演示模式：所有内容都是内置示例，不会联网。')
      return out
    }
    if (isBridge()) {
      if (!bridgeUrl()) out.push('桥接地址为空，需在 config.local.json 填 bridge.url。')
      else if (!/^https?:\/\//.test(bridgeUrl())) out.push('桥接地址必须以 http:// 或 https:// 开头。')
      return out
    }
    const p = provider()
    if (!p) {
      out.push('没有可用服务商，检查 config.activeProvider。')
      return out
    }
    if (!baseUrl(p)) out.push(p.label + ' 的 baseUrl 为空。')
    if (!p.model) out.push(p.label + ' 的 model 为空。')
    if (!p.apiKey && p.id !== 'ollama') out.push(p.label + ' 的 apiKey 为空。')
    return out
  }

  function ready() {
    return !!(RAW && providers().length)
  }

  WM.config = {
    get: get,
    raw: clone(cfg),
    mode: mode,
    setMode: setMode,
    isBridge: isBridge,
    isDemo: isDemo,
    provider: provider,
    providers: providers,
    providerById: providerById,
    providerIndex: providerIndex,
    cycleProvider: cycleProvider,
    setProvider: setProvider,
    bridgeUrl: bridgeUrl,
    baseUrl: baseUrl,
    joinUrl: joinUrl,
    hostOf: hostOf,
    maskKey: maskKey,
    issues: issues,
    ready: ready,
    meta: globalThis.__wm_config_meta || {},
    TAG: TAG
  }
})()
