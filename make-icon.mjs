#!/usr/bin/env node
/**
 * make-icon.mjs — 「腕上搭档」图标：深蓝底 + 青绿对话气泡（三个孔洞）
 * 用法：node watchmate/make-icon.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng, renderShape } from './lib/png-icon.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SIZE = Number(process.env.ICON_SIZE || 192)
const BG = [0x0b, 0x12, 0x20]
const FG = [0x5e, 0xe1, 0xc1]

function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1
}

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (!inRect(x, y, x0, y0, x1, y1)) return false
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

function bubble(x, y) {
  const body = inRoundRect(x, y, 0.20, 0.22, 0.80, 0.64, 0.12)
  const tail = inTriangle(x, y, 0.34, 0.60, 0.29, 0.80, 0.50, 0.64)
  if (!body && !tail) return false
  const dots = [
    [0.35, 0.43],
    [0.50, 0.43],
    [0.65, 0.43]
  ]
  for (const d of dots) {
    const dx = x - d[0]
    const dy = y - d[1]
    if (dx * dx + dy * dy <= 0.032 * 0.032) return false
  }
  return true
}

const rgb = renderShape(bubble, FG, { size: SIZE, bg: BG })
const png = encodePng(SIZE, SIZE, rgb)

const outDir = path.join(HERE, 'assets')
fs.mkdirSync(outDir, { recursive: true })
const name = SIZE === 192 ? 'icon-watchmate.png' : `preview-${SIZE}-icon-watchmate.png`
fs.writeFileSync(path.join(outDir, name), png)
console.log(`${name}  ${SIZE}x${SIZE}  bubble  ${png.length} B`)
