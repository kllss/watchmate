/**
 * core.test.mjs — 不依赖手表，直接跑核心逻辑
 * 用法：node watchmate/test/core.test.mjs
 */
import assert from 'node:assert/strict'

globalThis.__wm_config_raw = {
  schema: 1,
  mode: 'direct',
  bridge: { url: 'https://bridge.test', token: 'bt', timeoutMs: 5000 },
  activeProvider: 'mock',
  providers: [
    {
      id: 'mock',
      label: 'Mock',
      baseUrl: 'https://mock.test/v1',
      chatPath: '/chat/completions',
      modelsPath: '/models',
      model: 'mock-1',
      apiKey: 'sk-test',
      authHeader: 'Authorization',
      authPrefix: 'Bearer '
    }
  ],
  request: {
    timeoutMs: 3000,
    maxTokens: 120,
    temperature: 0.2,
    maxChars: 200,
    systemPrompt: 'short'
  },
  prompts: [
    { id: 'p1', label: '测试', hint: 'h', text: 'hello' }
  ],
  cards: [
    {
      id: 'c1',
      title: 'T',
      url: 'https://api.test/data',
      method: 'GET',
      headers: {},
      valuePath: 'a.b[0].v',
      unit: 'u',
      detailPath: 'a.n',
      detailPrefix: 'n=',
      level: 'info'
    }
  ]
}

await import('../src/core/config.js')
await import('../src/core/format.js')
await import('../src/core/ime-data.js')
await import('../src/core/ime.js')
await import('../src/core/http.js')
await import('../src/core/save.js')
await import('../src/core/store.js')
await import('../src/core/api.js')

const WM = globalThis.__wm
const F = WM.format
const I = WM.ime
const H = WM.http
const A = WM.api
const C = WM.config
const S = WM.store

let pass = 0
let fail = 0
const queue = []

function t(name, fn) {
  queue.push({ name, fn })
}

async function run() {
  for (const item of queue) {
    try {
      await item.fn()
      pass++
      console.log('  ok    ' + item.name)
    } catch (e) {
      fail++
      console.log('  FAIL  ' + item.name + '\n        ' + ((e && e.message) || e))
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

function stubFetch(handler) {
  const calls = []
  H.configure({
    impl: {
      fetch(opt) {
        calls.push(opt)
        return handler(opt, calls.length)
      }
    }
  })
  return calls
}

t('config: provider/model/key 正常', () => {
  assert.equal(C.mode(), 'direct')
  assert.equal(C.provider().id, 'mock')
  assert.equal(C.baseUrl(C.provider()), 'https://mock.test/v1')
  assert.deepEqual(C.issues(), [])
  assert.equal(C.maskKey('sk-1234567890'), '已配置 ····7890')
})

t('format: 去 Markdown', () => {
  const md = '# 标题\n\n**粗体** 和 `code`\n- 项目一\n- 项目二\n[链接](https://x)\n```js\nconst a=1\n```'
  const out = F.stripMarkdown(md)
  assert.ok(out.indexOf('标题') === 0)
  assert.ok(out.indexOf('**') === -1)
  assert.ok(out.indexOf('`') === -1)
  assert.ok(out.indexOf('· 项目一') !== -1)
  assert.ok(out.indexOf('链接') !== -1)
  assert.ok(out.indexOf('const a=1') !== -1)
})

t('format: 数值分组', () => {
  assert.equal(F.fmtValue(1234.5), '1,234.50')
  assert.equal(F.fmtValue(512340), '512,340')
  assert.equal(F.fmtValue(7.123), '7.12')
  assert.equal(F.fmtValue(true), '是')
})

t('format: pickPath', () => {
  const o = { a: { b: [{ v: 42 }], n: 3 }, arr: [1, 2, 3] }
  assert.equal(F.pickPath(o, 'a.b[0].v'), 42)
  assert.equal(F.pickPath(o, 'arr.length'), 3)
  assert.equal(F.pickPath(o, 'a.missing'), undefined)
})

t('format: 错误文案', () => {
  const info = F.errorInfo(F.err('E_AUTH', 'x', { status: 401, detail: 'bad key' }))
  assert.equal(info.title, '鉴权失败')
  assert.ok(info.detail.indexOf('HTTP 401') !== -1)
})

t('ime: 拼音候选与替换', () => {
  const c = I.candidates('jt', 4)
  assert.ok(c.indexOf('今天') !== -1, 'jt 应命中今天，实际 ' + c.join(','))
  assert.equal(I.commit('帮我jt', '今天'), '帮我今天')
  assert.equal(I.commit('', '今天'), '今天')
  assert.equal(I.insert('总结', 'GitHub'), '总结 GitHub')
  assert.equal(I.candidates('', 4).length, 4)
})

t('http: JSON 解析与状态映射', async () => {
  stubFetch(() => Promise.resolve({ code: 200, data: '{"ok":true}', headers: { 'content-type': 'application/json' } }))
  const res = await H.getJson('https://x.test')
  assert.equal(res.status, 200)
  assert.deepEqual(res.data, { ok: true })

  stubFetch(() => Promise.resolve({ code: 401, data: 'nope', headers: {} }))
  await assert.rejects(H.getJson('https://x.test'), (e) => e.code === 'E_AUTH' && e.status === 401)
})

t('http: 超时', async () => {
  stubFetch(() => new Promise(() => {}))
  await assert.rejects(H.getJson('https://x.test', { timeoutMs: 40 }), (e) => e.code === 'E_TIMEOUT')
})

t('api: 直连 chat 的请求体与解析', async () => {
  const calls = stubFetch(() =>
    Promise.resolve({
      code: 200,
      data: JSON.stringify({
        model: 'mock-9',
        choices: [{ message: { content: '你好\n世界' } }],
        usage: { total_tokens: 12 }
      }),
      headers: { 'content-type': 'application/json' }
    })
  )
  const res = await A.chat({ text: 'hi' })
  assert.equal(res.text, '你好\n世界')
  assert.equal(res.meta.model, 'mock-9')
  assert.equal(res.meta.mode, 'direct')
  assert.equal(calls[0].url, 'https://mock.test/v1/chat/completions')
  assert.equal(calls[0].header.Authorization, 'Bearer sk-test')
  const body = JSON.parse(calls[0].data)
  assert.equal(body.model, 'mock-1')
  assert.equal(body.messages[0].role, 'system')
  assert.equal(body.messages[1].content, 'hi')
})

t('api: 桥接 chat 走 /v1/chat', async () => {
  globalThis.__wm_runtime.mode = 'bridge'
  const calls = stubFetch(() =>
    Promise.resolve({
      code: 200,
      data: JSON.stringify({ ok: true, text: '来自桥接', model: 'wb', provider: 'WorkBuddy', ms: 9 }),
      headers: { 'content-type': 'application/json' }
    })
  )
  const res = await A.free('你好')
  assert.equal(res.text, '来自桥接')
  assert.equal(res.meta.mode, 'bridge')
  assert.equal(calls[0].url, 'https://bridge.test/v1/chat')
  assert.equal(calls[0].header.Authorization, 'Bearer bt')
  globalThis.__wm_runtime.mode = 'direct'
})

t('api: 卡片取值', async () => {
  stubFetch((opt) => {
    if (opt.url.indexOf('api.test') !== -1) {
      return Promise.resolve({
        code: 200,
        data: JSON.stringify({ a: { b: [{ v: 23 }], n: 7 } }),
        headers: { 'content-type': 'application/json' }
      })
    }
    return Promise.resolve({ code: 404, data: '', headers: {} })
  })
  const cards = await A.cards()
  assert.equal(cards.length, 1)
  assert.equal(cards[0].value, '23')
  assert.equal(cards[0].unit, 'u')
  assert.equal(cards[0].detail, 'n=7')
  assert.equal(cards[0].err, false)
})

t('api: 卡片缺 Token 时给出可读提示', async () => {
  const old = C.get().cards
  C.get().cards = [
    {
      id: 'gh',
      title: 'GitHub',
      url: 'https://api.github.com/notifications',
      headers: { Authorization: 'Bearer ' },
      valuePath: 'length'
    }
  ]
  const cards = await A.cards()
  assert.equal(cards[0].err, true)
  assert.ok(cards[0].detail.indexOf('Token') !== -1)
  C.get().cards = old
})

t('save: 存储读写', async () => {
  const mem = {}
  WM.save.configure({
    impl: {
      get(o) {
        if (mem[o.key] === undefined) o.fail({}, 0)
        else o.success(mem[o.key])
      },
      set(o) {
        mem[o.key] = o.value
        o.success()
      },
      delete(o) {
        delete mem[o.key]
        o.success()
      }
    }
  })
  await WM.save.setJson('k', { a: 1 })
  assert.deepEqual(await WM.save.getJson('k', null), { a: 1 })
  await WM.save.del('k')
  assert.equal(await WM.save.getJson('k', 'fallback'), 'fallback')
})

t('store: 缓存回答与设置', async () => {
  const mem = {}
  WM.save.configure({
    impl: {
      get(o) {
        if (mem[o.key] === undefined) o.fail({}, 0)
        else o.success(mem[o.key])
      },
      set(o) {
        mem[o.key] = o.value
        o.success()
      },
      delete(o) {
        delete mem[o.key]
        o.success()
      }
    }
  })
  S.state.ready = false
  await S.hydrate()
  await S.cacheAnswer({ text: 'x', at: Date.now(), promptLabel: '测试' })
  await S.setMode('bridge')
  assert.equal(S.state.mode, 'bridge')
  assert.equal(S.state.last.text, 'x')
  assert.equal(globalThis.__wm_runtime.mode, 'bridge')
  globalThis.__wm_runtime.mode = 'direct'
})

await run()
