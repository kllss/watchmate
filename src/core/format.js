/**
 * format.js — 纯函数：文本清洗、路径取值、错误文案、时间格式
 * 不依赖任何 Vela API，可以在 Node 里直接单测。
 */
;(function () {
  const TAG = 'format.js@wm'
  if (!globalThis.__wm_modules__) globalThis.__wm_modules__ = []
  globalThis.__wm_modules__.push(TAG)

  const WM = (globalThis.__wm = globalThis.__wm || {})

  function isArray(v) {
    return Object.prototype.toString.call(v) === '[object Array]'
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n)
  }

  function fmtClock(ts) {
    const d = ts ? new Date(ts) : new Date()
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
  }

  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

  function fmtDate(ts) {
    const d = ts ? new Date(ts) : new Date()
    return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + WEEK[d.getDay()]
  }

  function greeting(ts) {
    const h = (ts ? new Date(ts) : new Date()).getHours()
    if (h < 5) return '夜深了'
    if (h < 9) return '早上好'
    if (h < 12) return '上午好'
    if (h < 14) return '中午好'
    if (h < 18) return '下午好'
    if (h < 23) return '晚上好'
    return '夜深了'
  }

  function clip(s, n) {
    s = s === null || s === undefined ? '' : String(s)
    n = n || 40
    if (s.length <= n) return s
    return s.slice(0, n - 1) + '…'
  }

  function groupDigits(s) {
    const neg = s.charAt(0) === '-'
    if (neg) s = s.slice(1)
    const dot = s.indexOf('.')
    let intPart = dot >= 0 ? s.slice(0, dot) : s
    const decPart = dot >= 0 ? s.slice(dot) : ''
    let out = ''
    let count = 0
    for (let i = intPart.length - 1; i >= 0; i--) {
      out = intPart.charAt(i) + out
      count++
      if (count % 3 === 0 && i > 0) out = ',' + out
    }
    return (neg ? '-' : '') + out + decPart
  }

  function fmtValue(v) {
    if (v === null || v === undefined) return ''
    if (typeof v === 'number') {
      if (!isFinite(v)) return String(v)
      if (Math.abs(v) >= 1000) {
        const hasDec = Math.abs(v - Math.round(v)) > 0.0001
        return groupDigits(hasDec ? v.toFixed(2) : String(Math.round(v)))
      }
      if (Math.abs(v - Math.round(v)) > 0.0001) {
        return String(Math.round(v * 100) / 100)
      }
      return String(v)
    }
    if (typeof v === 'boolean') return v ? '是' : '否'
    if (isArray(v)) {
      const parts = []
      for (let i = 0; i < v.length && i < 3; i++) parts.push(fmtValue(v[i]))
      return clip(parts.join(' · '), 48)
    }
    if (typeof v === 'object') {
      const keys = []
      for (const k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) keys.push(k)
      }
      return clip('{' + keys.slice(0, 3).join(',') + '}', 48)
    }
    return clip(String(v), 40)
  }

  /** 支持 a.b[0].c / length / $ */
  function pickPath(obj, path) {
    if (!path || path === '$' || path === '@') return obj
    const tokens = String(path).match(/[^.[\]]+/g)
    if (!tokens) return undefined
    let cur = obj
    for (let i = 0; i < tokens.length; i++) {
      if (cur === null || cur === undefined) return undefined
      const t = tokens[i]
      if (t === 'length' && (typeof cur === 'string' || isArray(cur))) {
        cur = cur.length
        continue
      }
      cur = cur[t]
    }
    return cur
  }

  function safeParse(text) {
    if (text && typeof text === 'object') return text
    try {
      return JSON.parse(String(text))
    } catch (e) {
      return null
    }
  }

  function stripMarkdown(input) {
    let s = String(input === null || input === undefined ? '' : input)
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    s = s.replace(/[\u200b-\u200d\ufeff]/g, '')
    s = s.replace(/```[^\n]*\n?/g, '')
    s = s.replace(/```/g, '')
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    s = s.replace(/`([^`]+)`/g, '$1')
    s = s.replace(/^#{1,6}\s+/gm, '')
    s = s.replace(/^>\s?/gm, '')
    s = s.replace(/^\s*([-*_])(?:\s*\1){2,}\s*$/gm, '')
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
    s = s.replace(/__([^_]+)__/g, '$1')
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    s = s.replace(/^\s*[-*+]\s+/gm, '· ')
    s = s.replace(/<[^>]+>/g, '')
    s = s.replace(/[ \t]+/g, ' ')
    s = s.replace(/\n{3,}/g, '\n\n')
    const lines = s.split('\n')
    const out = []
    for (let i = 0; i < lines.length; i++) out.push(lines[i].trim())
    return out.join('\n').trim()
  }

  function answerLines(text, maxChars) {
    const t = stripMarkdown(text)
    const capped = t.length > (maxChars || 900) ? t.slice(0, maxChars || 900) + '…' : t
    const raw = capped.split('\n')
    const out = []
    for (let i = 0; i < raw.length; i++) {
      const line = raw[i]
      if (!line) continue
      out.push(line)
      if (out.length >= 26) break
    }
    return out
  }

  function fmtMs(ms) {
    if (ms === null || ms === undefined) return ''
    if (ms < 1000) return Math.round(ms) + 'ms'
    return (Math.round(ms / 100) / 10) + 's'
  }

  function fmtAgo(ts) {
    if (!ts) return ''
    const diff = Date.now() - ts
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
    return '昨天'
  }

  function fmtTokens(usage) {
    if (!usage) return ''
    const t = usage.total_tokens || (usage.input_tokens || 0) + (usage.output_tokens || 0)
    return t ? ' · ' + t + ' tok' : ''
  }

  const ERRORS = {
    E_CONFIG: ['配置不完整', '去「设置」检查接口、模型和 Key'],
    E_NET: ['网络不通', '手表需经手机联网；桥接地址必须能从手表访问'],
    E_TIMEOUT: ['请求超时', '模型响应慢或链路不稳，稍后重试'],
    E_AUTH: ['鉴权失败', 'Key / Token 不正确，或没有该模型的权限'],
    E_RATE: ['触发限流', '请求太频繁，等一会儿再试'],
    E_SERVER: ['服务端错误', '桥接或上游异常，查看服务端日志'],
    E_HTTP: ['请求失败', '检查接口地址、路径和请求方法'],
    E_PARSE: ['返回格式异常', '这个端点可能不是 OpenAI 兼容接口'],
    E_EMPTY: ['回答为空', '换个问法，或检查模型是否正常'],
    E_STORAGE: ['本地存储不可用', '缓存不会被保存，不影响联网使用'],
    E_UNKNOWN: ['出错了', '重试一次；仍然失败就看一眼设置']
  }

  function err(code, message, extra) {
    const e = { code: code || 'E_UNKNOWN', message: message || '' }
    if (extra) {
      for (const k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k]
      }
    }
    return e
  }

  function errorInfo(e) {
    const code = (e && e.code) || 'E_UNKNOWN'
    const row = ERRORS[code] || ERRORS.E_UNKNOWN
    const bits = []
    if (e && e.status) bits.push('HTTP ' + e.status)
    if (e && e.detail) bits.push(clip(e.detail, 90))
    if (!bits.length && e && e.message) bits.push(clip(e.message, 90))
    return {
      code: code,
      title: row[0],
      hint: row[1],
      detail: bits.join(' · ')
    }
  }

  function toError(e) {
    if (e && e.code) return e
    return err('E_UNKNOWN', (e && e.message) || String(e))
  }

  WM.format = {
    TAG: TAG,
    isArray: isArray,
    pad2: pad2,
    fmtClock: fmtClock,
    fmtDate: fmtDate,
    greeting: greeting,
    clip: clip,
    fmtValue: fmtValue,
    pickPath: pickPath,
    safeParse: safeParse,
    stripMarkdown: stripMarkdown,
    answerLines: answerLines,
    fmtMs: fmtMs,
    fmtAgo: fmtAgo,
    fmtTokens: fmtTokens,
    err: err,
    errorInfo: errorInfo,
    toError: toError
  }
})()
