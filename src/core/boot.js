/**
 * boot.js — 唯一入口：按顺序加载全部核心模块
 *
 * 规则来自 docs/构建与模块验证.md：
 *   本地 .js 模块不能写 export，否则产物里会出现 `exports is not defined`，整页黑屏。
 *   所以每个模块都是"副作用模块"：内部定义函数，把 API 挂到 globalThis.__wm。
 */
import '../config.gen.js'
import './config.js'
import './format.js'
import './ime-data.js'
import './ime.js'
import './http.js'
import './save.js'
import './store.js'
import './api.js'

const MODULE_TAG = 'boot.js@wm'
if (!globalThis.__wm_modules__) globalThis.__wm_modules__ = []
globalThis.__wm_modules__.push(MODULE_TAG)
