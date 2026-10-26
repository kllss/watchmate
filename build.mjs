#!/usr/bin/env node
/**
 * build.mjs — 构建「腕上搭档」RPK
 *
 * 做四件事：
 *   1. 合并 config.default.json + config.local.json，展开 ${ENV}，注入到 config.gen.js；
 *   2. 清缓存、复制 src、调 aiot-toolkit 打包；
 *   3. 解包校验：每个核心模块的 MODULE_TAG 必须真的进了页面 bundle；
 *   4. 用 tools/vela-bundle-check.mjs 在 Node 里把页面 bundle 跑一遍，防黑屏。
 *
 * 用法：
 *   node watchmate/build.mjs                 # 正常构建
 *   node watchmate/build.mjs --demo          # 演示模式（不联网，返回示例内容）
 *   node watchmate/build.mjs --config-only   # 只生成配置，不打包
 *   AIOT_TOOLKIT_BIN=/path/to/aiot-toolkit/lib/bin.js node watchmate/build.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const SRC = path.join(HERE, 'src')
const WORK = path.join(HERE, '.build')
const DIST = path.join(HERE, 'dist')
const ICON = path.join(HERE, 'assets', 'icon-watchmate.png')
const DEFAULT_CFG = path.join(HERE, 'config.default.json')
const LOCAL_CFG = path.join(HERE, 'config.local.json')

const SENTINELS = [
  'boot.js@wm',
  'config.js@wm',
  'format.js@wm',
  'http.js@wm',
  'save.js@wm',
  'store.js@wm',
  'api.js@wm',
  'ime.js@wm'
]
const REGISTRY_MARK = '__wm_modules__'

const args = new Set(process.argv.slice(2))
const DEMO = args.has('--demo')
const CONFIG_ONLY = args.has('--config-only')

function log(msg) {
  console.log(msg)
}

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

function expandEnv(value, missing) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
      const v = process.env[name]
      if (v === undefined) {
        if (missing.indexOf(name) === -1) missing.push(name)
        return ''
      }
      return v
    })
  }
  if (Array.isArray(value)) return value.map((v) => expandEnv(v, missing))
  if (isObj(value)) {
    const out = {}
    for (const k of Object.keys(value)) out[k] = expandEnv(value[k], missing)
    return out
  }
  return value
}

function loadConfig() {
  if (!fs.existsSync(DEFAULT_CFG)) {
    throw new Error('缺少默认配置：' + DEFAULT_CFG)
  }
  const base = JSON.parse(fs.readFileSync(DEFAULT_CFG, 'utf8'))
  const local = fs.existsSync(LOCAL_CFG)
    ? JSON.parse(fs.readFileSync(LOCAL_CFG, 'utf8'))
    : null
  let cfg = local ? merge(base, local) : base
  const missing = []
  cfg = expandEnv(cfg, missing)

  if (DEMO) {
    cfg.mode = 'demo'
  }
  if (!cfg.bridge) cfg.bridge = {}
  if (!cfg.request) cfg.request = {}

  const json = JSON.stringify(cfg, null, 2)
  const hash = crypto.createHash('sha1').update(json).digest('hex').slice(0, 8)
  const sources = ['config.default.json']
  if (local) sources.push('config.local.json')
  if (missing.length) sources.push('env-missing:' + missing.join(','))

  return { cfg, json, hash, sources }
}

function warningsFor(cfg) {
  const out = []
  if (cfg.mode === 'demo') {
    out.push('演示模式：不发出任何网络请求，回答是内置示例。')
    return out
  }
  if (cfg.mode === 'bridge') {
    if (!cfg.bridge || !cfg.bridge.url) {
      out.push('桥接模式但 bridge.url 为空：手表会显示「未连接」。')
    } else if (cfg.bridge.url.indexOf('https://') !== 0 && cfg.bridge.url.indexOf('http://') !== 0) {
      out.push('bridge.url 需要以 http:// 或 https:// 开头。')
    }
  } else {
    const p = (cfg.providers || []).filter((x) => x.id === cfg.activeProvider)[0]
    if (!p) {
      out.push('activeProvider 找不到对应服务商：' + cfg.activeProvider)
    } else {
      if (!p.baseUrl) out.push(`服务商「${p.label}」的 baseUrl 为空，需在 config.local.json 填写。`)
      if (!p.model) out.push(`服务商「${p.label}」的 model 为空。`)
      if (!p.apiKey && p.id !== 'ollama') {
        out.push(`服务商「${p.label}」没有 apiKey（可用 \${ENV_NAME} 注入）。`)
      }
    }
  }
  return out
}

function writeConfigGen(json, hash, sources, version) {
  const meta = {
    hash: hash,
    sources: sources,
    version: version,
    builtAt: new Date().toISOString()
  }
  const body =
    '/* 由 build.mjs 生成，不要手改。源：' +
    sources.join(' + ') +
    ' · sha1:' +
    hash +
    ' */\n' +
    'globalThis.__wm_config_raw = ' +
    json +
    '\n' +
    'globalThis.__wm_config_meta = ' +
    JSON.stringify(meta) +
    '\n'
  const target = path.join(WORK, 'src', 'config.gen.js')
  fs.writeFileSync(target, body, 'utf8')
  return target
}

function toolkitBin() {
  if (process.env.AIOT_TOOLKIT_BIN) return process.env.AIOT_TOOLKIT_BIN
  try {
    return createRequire(import.meta.url).resolve('aiot-toolkit/lib/bin.js')
  } catch (e) {
    throw new Error(
      '找不到 aiot-toolkit。请任选一种方式：\n' +
        '  1) 在 watchmate/ 里 npm i -D aiot-toolkit\n' +
        '  2) 设置 AIOT_TOOLKIT_BIN=<path>/aiot-toolkit/lib/bin.js\n' +
        '  本机已有：C:/Users/klls/WorkBuddy/2026-10-18-16-22-52/toolchain/node_modules/aiot-toolkit/lib/bin.js'
    )
  }
}

function unzipText(rpk, entry) {
  return execFileSync('unzip', ['-p', rpk, entry], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
}

function pageTexts(rpk) {
  const list = execFileSync('unzip', ['-l', rpk], { encoding: 'utf8' })
  const pages = list
    .split('\n')
    .map((l) => l.trim().split(/\s+/).pop())
    .filter((f) => /^pages\/[^/]+\/index\.js$/.test(f))
  const out = {}
  for (const p of pages) out[p] = unzipText(rpk, p)
  return out
}

function verify(rpk) {
  const pages = pageTexts(rpk)
  const names = Object.keys(pages)
  if (!names.length) throw new Error('RPK 里没有任何页面 bundle')

  const all = names.map((n) => pages[n]).join('\n')
  const missing = SENTINELS.filter((s) => all.indexOf(s) === -1)
  if (all.indexOf(REGISTRY_MARK) === -1) missing.push('(模块自注册代码)')
  if (missing.length) {
    throw new Error(
      '哨兵校验失败，以下模块没有进到页面 bundle：\n' +
        missing.map((m) => '  - ' + m).join('\n') +
        '\n最可能的原因：模块被编译成空模块。删掉 .build 后重试。'
    )
  }

  const empties = names.filter((n) => /"\.\/src\/[^"]+" \(\) \{\}/.test(pages[n]))
  if (empties.length) throw new Error('检测到空模块，出现在：' + empties.join(', '))

  return { pages: names, sentinels: SENTINELS.length }
}

function main() {
  if (!fs.existsSync(ICON)) {
    execFileSync(process.execPath, [path.join(HERE, 'make-icon.mjs')], { stdio: 'inherit' })
  }

  const { cfg, json, hash, sources } = loadConfig()
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'))

  fs.rmSync(path.join(HERE, 'node_modules', '.cache'), { recursive: true, force: true })
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })
  fs.cpSync(SRC, path.join(WORK, 'src'), { recursive: true })
  fs.copyFileSync(ICON, path.join(WORK, 'src', 'Common', 'icon.png'))
  writeConfigGen(json, hash, sources, manifest.versionName)

  const warns = warningsFor(cfg)
  log('')
  log('配置：' + sources.join(' + ') + ' · sha1:' + hash)
  log('模式：' + cfg.mode + (cfg.mode === 'direct' ? ' · ' + cfg.activeProvider : ''))
  if (warns.length) {
    log('注意：')
    for (const w of warns) log('  - ' + w)
  }

  if (CONFIG_ONLY) {
    log('')
    log('已生成：' + path.join(WORK, 'src', 'config.gen.js') + '（未打包）')
    return
  }

  execFileSync(process.execPath, [toolkitBin(), 'build'], { cwd: WORK, stdio: 'inherit' })

  const distDir = path.join(WORK, 'dist')
  const rpkName = fs.readdirSync(distDir).find((f) => f.endsWith('.rpk'))
  if (!rpkName) throw new Error('构建成功但没有找到 RPK：' + distDir)

  const rpk = path.join(distDir, rpkName)
  const info = verify(rpk)

  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'vela-bundle-check.mjs'), rpk], {
    stdio: 'inherit'
  })

  fs.mkdirSync(DIST, { recursive: true })
  const target = path.join(DIST, `watchmate-${manifest.versionName}.rpk`)
  fs.copyFileSync(rpk, target)

  const size = fs.statSync(target).size
  log('')
  log(`构建完成：${size} B -> ${target}`)
  log(`  页面：${info.pages.join(', ')}`)
  log(`  哨兵：${info.sentinels} 个全部命中`)
  log(`  配置：${cfg.mode}${cfg.mode === 'direct' ? ' · ' + cfg.activeProvider : ''}`)
  if (warns.length) log(`  提醒：${warns.length} 条（见上方）`)
}

main()
