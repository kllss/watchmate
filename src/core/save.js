/**
 * save.js — @system.storage 的 Promise 包装 + JSON 编解码
 * 只存字符串；所有结构化数据 JSON.stringify 后写入。
 */
;(function () {
  const TAG = 'save.js@wm'
  if (!globalThis.__wm_modules__) globalThis.__wm_modules__ = []
  globalThis.__wm_modules__.push(TAG)

  const WM = (globalThis.__wm = globalThis.__wm || {})
  const F = WM.format
  const PREFIX = 'wm:v1:'
  const memory = {}
  let impl = null
  let available = true

  function use(storageModule) {
    if (!storageModule) return
    impl = storageModule.default || storageModule
  }

  function configure(opt) {
    if (opt && opt.impl) impl = opt.impl
  }

  function keyOf(k) {
    return PREFIX + k
  }

  function getRaw(key) {
    const full = keyOf(key)
    return new Promise(function (resolve) {
      if (!impl || typeof impl.get !== 'function') {
        available = false
        resolve(memory[full] === undefined ? '' : memory[full])
        return
      }
      try {
        impl.get({
          key: full,
          success: function (v) {
            resolve(v === null || v === undefined ? '' : String(v))
          },
          fail: function () {
            available = false
            resolve(memory[full] === undefined ? '' : memory[full])
          }
        })
      } catch (e) {
        available = false
        resolve(memory[full] === undefined ? '' : memory[full])
      }
    })
  }

  function setRaw(key, value) {
    const full = keyOf(key)
    memory[full] = String(value)
    return new Promise(function (resolve) {
      if (!impl || typeof impl.set !== 'function') {
        available = false
        resolve(false)
        return
      }
      try {
        impl.set({
          key: full,
          value: String(value),
          success: function () {
            resolve(true)
          },
          fail: function () {
            available = false
            resolve(false)
          }
        })
      } catch (e) {
        available = false
        resolve(false)
      }
    })
  }

  function del(key) {
    const full = keyOf(key)
    delete memory[full]
    return new Promise(function (resolve) {
      if (!impl || typeof impl.delete !== 'function') {
        available = false
        resolve(false)
        return
      }
      try {
        impl.delete({
          key: full,
          success: function () {
            resolve(true)
          },
          fail: function () {
            resolve(false)
          }
        })
      } catch (e) {
        resolve(false)
      }
    })
  }

  function getJson(key, fallback) {
    return getRaw(key).then(function (text) {
      if (!text) return fallback
      const v = F.safeParse(text)
      return v === null ? fallback : v
    })
  }

  function setJson(key, value) {
    let text = ''
    try {
      text = JSON.stringify(value)
    } catch (e) {
      return Promise.resolve(false)
    }
    return setRaw(key, text)
  }

  WM.save = {
    TAG: TAG,
    use: use,
    configure: configure,
    getRaw: getRaw,
    setRaw: setRaw,
    del: del,
    getJson: getJson,
    setJson: setJson,
    isAvailable: function () {
      return available
    }
  }
})()
