/**
 * http.js — 对 @system.fetch 的薄封装
 *
 * 为什么不用 responseType:'json'：不同固件对返回类型的处理不一致。
 * 统一拿 text，自己 JSON.parse，错误路径更可控。
 *
 * 页面在 onInit 里调用 WM.http.use(fetch)；测试里用 WM.http.configure({ impl }) 注入桩。
 */
;(function () {
  const TAG = 'http.js@wm'
  if (!globalThis.__wm_modules__) globalThis.__wm_modules__ = []
  globalThis.__wm_modules__.push(TAG)

  const WM = (globalThis.__wm = globalThis.__wm || {})
  const F = WM.format

  let impl = null

  function use(fetchModule) {
    if (!fetchModule) return
    impl = fetchModule.default || fetchModule
  }

  function configure(opt) {
    if (opt && opt.impl) impl = opt.impl
  }

  function hasHeader(headers, name) {
    const lower = name.toLowerCase()
    for (const k in headers) {
      if (Object.prototype.hasOwnProperty.call(headers, k) && k.toLowerCase() === lower) return true
    }
    return false
  }

  function normalizeHeaders(h) {
    const out = {}
    if (!h) return out
    for (const k in h) {
      if (Object.prototype.hasOwnProperty.call(h, k) && h[k] !== null && h[k] !== undefined) {
        out[k] = String(h[k])
      }
    }
    return out
  }

  function parseMaybeJson(text, headers) {
    const ct = headers && (headers['content-type'] || headers['Content-Type'])
    const looksJson =
      (ct && String(ct).indexOf('json') !== -1) ||
      (text && (text.charAt(0) === '{' || text.charAt(0) === '['))
    if (!looksJson) return text
    const parsed = F.safeParse(text)
    return parsed === null ? text : parsed
  }

  function mapStatus(status, body) {
    if (status === 401 || status === 403) {
      return F.err('E_AUTH', '鉴权失败', { status: status, detail: F.clip(body, 120) })
    }
    if (status === 429) {
      return F.err('E_RATE', '请求过于频繁', { status: status, detail: F.clip(body, 120) })
    }
    if (status >= 500) {
      return F.err('E_SERVER', '服务端错误', { status: status, detail: F.clip(body, 120) })
    }
    return F.err('E_HTTP', 'HTTP ' + status, { status: status, detail: F.clip(body, 120) })
  }

  function request(opt) {
    opt = opt || {}
    const url = opt.url || ''
    if (!url) return Promise.reject(F.err('E_CONFIG', '请求地址为空'))

    if (!impl || typeof impl.fetch !== 'function') {
      return Promise.reject(F.err('E_CONFIG', '网络模块未初始化（页面没有调用 WM.http.use）'))
    }

    const method = (opt.method || 'GET').toUpperCase()
    const timeoutMs = opt.timeoutMs || 15000
    const headers = normalizeHeaders(opt.headers)
    let body = opt.body

    if (body !== undefined && body !== null && typeof body === 'object') {
      body = JSON.stringify(body)
      if (!hasHeader(headers, 'Content-Type')) headers['Content-Type'] = 'application/json'
    }

    const started = Date.now()

    return new Promise(function (resolve, reject) {
      let settled = false
      let timer = null

      function done(e, res) {
        if (settled) return
        settled = true
        if (timer) {
          try {
            clearTimeout(timer)
          } catch (x) {}
        }
        if (e) {
          e.url = url
          e.ms = Date.now() - started
          reject(e)
        } else {
          resolve(res)
        }
      }

      timer = setTimeout(function () {
        done(F.err('E_TIMEOUT', '请求超时 ' + timeoutMs + 'ms', { timeoutMs: timeoutMs }))
      }, timeoutMs)

      function onSuccess(raw) {
        let res = raw
        // promise 形式会包一层：{ data: { code, data, headers } }
        // 用 headers 作为判别，避免把业务 JSON 里的 code 字段误当成信封
        if (
          res &&
          res.data &&
          typeof res.data === 'object' &&
          typeof res.data.code !== 'undefined' &&
          res.data.headers !== undefined
        ) {
          res = res.data
        }
        let status = typeof res.code === 'number' ? res.code : 200
        if (status === 0) status = 200

        let text = ''
        let data = null
        if (res.data !== undefined && res.data !== null) {
          if (typeof res.data === 'object') {
            data = res.data
            try {
              text = JSON.stringify(res.data)
            } catch (e) {
              text = String(res.data)
            }
          } else {
            text = String(res.data)
            data = parseMaybeJson(text, res.headers || {})
          }
        }

        if (status >= 400) {
          done(mapStatus(status, text), null)
          return
        }

        done(null, {
          status: status,
          data: data,
          text: text,
          headers: res.headers || {},
          ms: Date.now() - started,
          url: url,
          method: method
        })
      }

      function onFail(data, code) {
        let msg = ''
        if (data && data.data) msg = String(data.data)
        else if (data && data.message) msg = String(data.message)
        else if (typeof data === 'string') msg = data
        done(
          F.err('E_NET', '网络请求失败', {
            detail: 'fail code=' + (code === undefined ? '?' : code) + (msg ? ' · ' + F.clip(msg, 90) : '')
          })
        )
      }

      try {
        const task = impl.fetch({
          url: url,
          method: method,
          header: headers,
          data: body,
          responseType: 'text',
          success: onSuccess,
          fail: onFail
        })
        if (task && typeof task.then === 'function') {
          task.then(onSuccess).catch(function (e) {
            onFail(e)
          })
        }
      } catch (e) {
        done(F.err('E_NET', '发起请求失败：' + ((e && e.message) || e)))
      }
    })
  }

  function getJson(url, opt) {
    const o = opt || {}
    o.url = url
    o.method = 'GET'
    return request(o)
  }

  function postJson(url, body, opt) {
    const o = opt || {}
    o.url = url
    o.method = 'POST'
    o.body = body
    return request(o)
  }

  WM.http = {
    TAG: TAG,
    use: use,
    configure: configure,
    request: request,
    getJson: getJson,
    postJson: postJson,
    ready: function () {
      return !!(impl && typeof impl.fetch === 'function')
    }
  }
})()
