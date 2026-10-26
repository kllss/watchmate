#!/usr/bin/env node
/**
 * make-ui-icons.mjs — 生成 UI 小图标 PNG（深色圆角底 + 亮色几何形状）
 * Vela 手表不渲染 emoji，图标一律用 PNG。
 * 输出：src/Common/icons/*.png（64×64，RGB 无 alpha，深色底 #0f141d）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng, renderShape } from './lib/png-icon.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'src', 'Common', 'icons')
const SIZE = 64

// 配色（与页面主题一致）
const BG = [0x0f, 0x14, 0x1d] // 卡片深色底
const FG = [0x5e, 0xe1, 0xc1] // 主强调青绿
const FG2 = [0x9f, 0xb0, 0xc7] // 次要灰蓝
const FG3 = [0x78, 0x83, 0x9a] // 弱灰

// ---------- 几何工具（归一化 0..1） ----------
function dist(px, py, cx, cy) {
  return Math.hypot(px - cx, py - cy)
}
function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1
}
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (!inRect(x, y, x0, y0, x1, y1)) return false
  const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x
  const cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y
  return dist(x, y, cx, cy) <= r
}
function inCircle(x, y, cx, cy, r) {
  return dist(x, y, cx, cy) <= r
}
function inRing(x, y, cx, cy, rOuter, rInner) {
  return dist(x, y, cx, cy) <= rOuter && dist(x, y, cx, cy) >= rInner
}
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}
// 线段（带厚度的胶囊）
function inSeg(x, y, x0, y0, x1, y1, w) {
  const vx = x1 - x0
  const vy = y1 - y0
  const len2 = vx * vx + vy * vy
  let t = len2 === 0 ? 0 : ((x - x0) * vx + (y - y0) * vy) / len2
  t = Math.max(0, Math.min(1, t))
  const px = x0 + t * vx
  const py = y0 + t * vy
  return dist(x, y, px, py) <= w
}

// ---------- 形状定义 ----------
const shapes = {
  // 对话气泡（问 AI）
  chat(x, y) {
    const body = inRoundRect(x, y, 0.14, 0.20, 0.86, 0.68, 0.16)
    const tail = inTriangle(x, y, 0.30, 0.62, 0.24, 0.86, 0.46, 0.66)
    if (!body && !tail) return false
    for (const d of [
      [0.34, 0.44],
      [0.50, 0.44],
      [0.66, 0.44]
    ]) {
      if (inCircle(x, y, d[0], d[1], 0.045)) return false
    }
    return true
  },
  // 卡片（看卡片）
  card(x, y) {
    const body = inRoundRect(x, y, 0.16, 0.22, 0.84, 0.78, 0.08)
    if (!body) return false
    if (inRect(x, y, 0.16, 0.22, 0.84, 0.36)) return false // 顶部留白成标题条
    // 三条线
    if (inRect(x, y, 0.28, 0.46, 0.72, 0.52)) return true
    if (inRect(x, y, 0.28, 0.58, 0.72, 0.64)) return true
    return false
  },
  // 齿轮（设置）
  gear(x, y) {
    const c = 0.5
    const a = Math.atan2(y - c, x - c)
    const r = dist(x, y, c, c)
    const teeth = 8
    // 齿轮体：齿尖半径 0.40，齿根半径 0.30，孔半径 0.16
    const seg = Math.PI / teeth
    const m = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    const idx = Math.floor(m / seg)
    const within = m - idx * seg
    // 齿（前半段）比齿根（后半段）更外凸
    const rBound = within < seg * 0.5 ? 0.40 : 0.30
    if (r > rBound) return false
    if (r < 0.16) return false
    return true
  },
  // 键盘（自己写）
  keyboard(x, y) {
    const body = inRoundRect(x, y, 0.12, 0.16, 0.88, 0.84, 0.06)
    if (!body) return false
    // 四排按键：每排 3 个圆角小格
    const rows = [0.26, 0.42, 0.58, 0.74]
    for (const ry of rows) {
      for (let k = 0; k < 3; k++) {
        const cx = 0.26 + k * 0.24
        if (inRoundRect(x, y, cx - 0.09, ry - 0.06, cx + 0.09, ry + 0.06, 0.03)) return true
      }
    }
    return false
  },
  // 返回箭头
  back(x, y) {
    const head = inTriangle(x, y, 0.30, 0.50, 0.60, 0.26, 0.60, 0.74)
    const shaft = inRect(x, y, 0.56, 0.44, 0.78, 0.56)
    return head || shaft
  },
  // 刷新（循环箭头，带箭头头）
  refresh(x, y) {
    const c = 0.5
    const a = Math.atan2(y - c, x - c)
    const r = dist(x, y, c, c)
    // 环体
    const inRing = r <= 0.40 && r >= 0.30
    if (inRing) {
      const ang = ((a + Math.PI * 2) % (Math.PI * 2))
      // 开口在右上方
      if (ang > Math.PI * 0.78 && ang < Math.PI * 1.22) return false
      return true
    }
    // 箭头头（右上开口处的一个三角）
    const hx = 0.5 + 0.40 * Math.cos(Math.PI * 0.78)
    const hy = 0.5 + 0.40 * Math.sin(Math.PI * 0.78)
    return inTriangle(x, y, hx, hy, hx - 0.10, hy + 0.12, hx + 0.06, hy - 0.12)
  }
}

const ICONS = [
  { name: 'chat', fg: FG, shape: shapes.chat },
  { name: 'gear', fg: FG2, shape: shapes.gear },
  { name: 'keyboard', fg: FG, shape: shapes.keyboard },
  { name: 'back', fg: FG2, shape: shapes.back },
  { name: 'refresh', fg: FG, shape: shapes.refresh }
]

fs.mkdirSync(OUT, { recursive: true })
for (const ic of ICONS) {
  const rgb = renderShape(ic.shape, ic.fg, { size: SIZE, bg: BG })
  const png = encodePng(SIZE, SIZE, rgb)
  const p = path.join(OUT, ic.name + '.png')
  fs.writeFileSync(p, png)
  console.log('icon/' + ic.name + '.png  ' + png.length + ' B')
}
console.log('done ->', OUT)
