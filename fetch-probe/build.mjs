#!/usr/bin/env node
/**
 * build.mjs — 构建「联网探针」RPK，验证真机 @system.fetch 是否可用
 *
 * 用法：
 *   AIOT_TOOLKIT_BIN=/path/to/aiot-toolkit/lib/bin.js node fetch-probe/build.mjs
 *
 * 产物：data/local/fetch-probe.rpk
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = path.join(HERE, 'src')
const WORK = path.join(HERE, '.build')
const OUT = path.join(ROOT, 'data', 'local')

const OUT_NAME = 'fetch-probe.rpk'

function toolkitBin() {
  if (process.env.AIOT_TOOLKIT_BIN) return process.env.AIOT_TOOLKIT_BIN
  try {
    return createRequire(import.meta.url).resolve('aiot-toolkit/lib/bin.js')
  } catch (e) {
    throw new Error('找不到 aiot-toolkit。设置 AIOT_TOOLKIT_BIN=<path>/aiot-toolkit/lib/bin.js')
  }
}

function main() {
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })
  fs.cpSync(SRC, path.join(WORK, 'src'), { recursive: true })

  execFileSync(process.execPath, [toolkitBin(), 'build'], { cwd: WORK, stdio: 'inherit' })

  const distDir = path.join(WORK, 'dist')
  const rpkName = fs.readdirSync(distDir).find((f) => f.endsWith('.rpk'))
  if (!rpkName) throw new Error('没有找到 RPK：' + distDir)

  fs.mkdirSync(OUT, { recursive: true })
  const target = path.join(OUT, OUT_NAME)
  fs.copyFileSync(path.join(distDir, rpkName), target)

  console.log('\n构建完成 -> ' + target + '  (' + fs.statSync(target).size + ' B)')
}

main()
