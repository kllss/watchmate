/**
 * bridge.test.mjs — 用假上游验证桥接协议
 * 用法：node watchmate/bridge/test/server.test.mjs
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { createBridgeServer } from '../server.mjs'

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

const seen = []
const upstream = http.createServer(async (req, res) => {
  const body = await readBody(req)
  seen.push({ url: req.url, auth: req.headers.authorization, body })
  res.setHeader('Content-Type', 'application/json')
  if (req.url.indexOf('/chat/completions') !== -1) {
    res.end(
      JSON.stringify({
        model: 'mock-1',
        choices: [{ message: { content: '第一行\n第二行' } }],
        usage: { total_tokens: 9 }
      })
    )
    return
  }
  if (req.url.indexOf('/data') !== -1) {
    res.end(JSON.stringify({ value: 42, latest: 'hello' }))
    return
  }
  res.statusCode = 404
  res.end('{}')
})

const upPort = await listen(upstream)

const cfg = {
  server: { port: 0, host: '127.0.0.1', token: 'tk' },
  provider: {
    kind: 'openai',
    label: 'MockProvider',
    baseUrl: 'http://127.0.0.1:' + upPort + '/v1',
    chatPath: '/chat/completions',
    model: 'mock-1',
    apiKey: 'sk-test',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    maxTokens: 50,
    temperature: 0.2,
    timeoutMs: 3000
  },
  systemPrompt: 'short',
  integrations: {},
  cards: [
    {
      id: 'c1',
      type: 'http',
      title: 'C1',
      url: 'http://127.0.0.1:' + upPort + '/data',
      valuePath: 'value',
      unit: 'u',
      cacheSec: 0
    }
  ],
  prompts: [
    {
      id: 'p1',
      label: 'P1',
      hint: 'h1',
      sources: [{ key: 'd', type: 'http', url: 'http://127.0.0.1:' + upPort + '/data', pick: 'value' }],
      template: '值={{d}}'
    }
  ]
}

const bridge = createBridgeServer(cfg)
const port = await listen(bridge)
const base = 'http://127.0.0.1:' + port
const auth = { Authorization: 'Bearer tk' }

let pass = 0
let fail = 0

async function t(name, fn) {
  try {
    await fn()
    pass++
    console.log('  ok    ' + name)
  } catch (e) {
    fail++
    console.log('  FAIL  ' + name + '\n        ' + ((e && e.message) || e))
  }
}

await t('未带 Token 的 /health 返回 401', async () => {
  const r = await fetch(base + '/health')
  assert.equal(r.status, 401)
  const d = await r.json()
  assert.equal(d.ok, false)
  assert.equal(d.error.code, 'E_AUTH')
})

await t('/health 报告 provider 与模型', async () => {
  const r = await fetch(base + '/health', { headers: auth })
  assert.equal(r.status, 200)
  const d = await r.json()
  assert.equal(d.ok, true)
  assert.equal(d.model, 'mock-1')
  assert.equal(d.provider, 'MockProvider')
  assert.equal(d.prompts, 1)
})

await t('/api/prompts 不泄露模板', async () => {
  const r = await fetch(base + '/api/prompts', { headers: auth })
  const d = await r.json()
  assert.equal(d.prompts.length, 1)
  assert.equal(d.prompts[0].label, 'P1')
  assert.equal(d.prompts[0].template, undefined)
})

await t('/api/cards 取值与单位', async () => {
  const r = await fetch(base + '/api/cards', { headers: auth })
  const d = await r.json()
  assert.equal(d.cards.length, 1)
  assert.equal(d.cards[0].value, '42')
  assert.equal(d.cards[0].unit, 'u')
  assert.equal(d.cards[0].err, false)
})

await t('/v1/ask 会先拼数据再调模型', async () => {
  const r = await fetch(base + '/v1/ask', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: JSON.stringify({ promptId: 'p1' })
  })
  assert.equal(r.status, 200)
  const d = await r.json()
  assert.equal(d.ok, true)
  assert.equal(d.text, '第一行\n第二行')
  assert.equal(d.sources[0].key, 'd')
  assert.equal(d.sources[0].ok, true)

  const call = seen.filter((s) => s.url.indexOf('/chat/completions') !== -1).pop()
  assert.equal(call.auth, 'Bearer sk-test')
  const body = JSON.parse(call.body)
  assert.equal(body.messages[1].content, '值=42')
  assert.equal(body.max_tokens, 50)
})

await t('/v1/chat 自由文本', async () => {
  const r = await fetch(base + '/v1/chat', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: JSON.stringify({ text: '你好' })
  })
  const d = await r.json()
  assert.equal(d.ok, true)
  assert.equal(d.text, '第一行\n第二行')
})

await t('未知 promptId 返回 E_CONFIG', async () => {
  const r = await fetch(base + '/v1/ask', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: JSON.stringify({ promptId: 'nope' })
  })
  assert.equal(r.status, 404)
  const d = await r.json()
  assert.equal(d.error.code, 'E_CONFIG')
})

await t('坏 JSON 返回 E_BODY', async () => {
  const r = await fetch(base + '/v1/chat', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
    body: '{bad'
  })
  assert.equal(r.status, 400)
  const d = await r.json()
  assert.equal(d.error.code, 'E_BODY')
})

console.log(`\n${pass} passed, ${fail} failed`)

bridge.close()
upstream.close()
if (fail) process.exit(1)
