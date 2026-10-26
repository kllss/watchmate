/**
 * ime.js — 手表自绘键盘的中文候选
 *
 * 不是完整拼音输入法：没有词库分词、没有声调、没有长句联想。
 * 做法是"尾部拼音串 → 词表前缀匹配"：输入 jt / jintian 都能命中「今天」。
 * 词表 ime-data.js 由 pinyin-pro 校音后生成，约 270 条，覆盖手表上常见的短指令。
 */
;(function () {
  const TAG = 'ime.js@wm'
  if (!globalThis.__wm_modules__) globalThis.__wm_modules__ = []
  globalThis.__wm_modules__.push(TAG)

  const WM = (globalThis.__wm = globalThis.__wm || {})
  const MAX_LEN = 220

  const rows = []
  const seen = {}
  const table = globalThis.__wm_ime_table || ''
  const parts = table.split(';')
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]
    if (!line) continue
    const f = line.split('|')
    const w = f[0]
    if (!w) continue
    if (seen[w]) continue
    seen[w] = true
    rows.push({ w: w, py: (f[1] || '').toLowerCase(), ini: (f[2] || '').toLowerCase(), n: i })
  }

  const commonWords = globalThis.__wm_ime_common || []
  const common = []
  for (let i = 0; i < commonWords.length; i++) {
    for (let j = 0; j < rows.length; j++) {
      if (rows[j].w === commonWords[i]) {
        common.push(rows[j].w)
        break
      }
    }
  }

  const BOARD = [
    ['帮我总结', '帮我翻译', '帮我写', '帮我改', '帮我解释', '帮我推荐', '帮我列出', '帮我查', '帮我算', '帮我找', '今天有什么安排', '明天几点'],
    ['我的未读通知', '我的邮件摘要', '我的待办清单', '这周的重点', '现在几点', '今天几号', '查一下天气', '讲个笑话', '说点鼓励的话', '给我一个建议', '下一步做什么', '值得做吗'],
    ['用三句话', '用五个要点', '写得简单点', '写得详细点', '短一点', '正式一点', '口语一点', '只给结论', '翻译成英文', '翻译成中文', '改得更简洁', '润色这句话'],
    ['推荐三个', '列出五个', '整理成清单', '生成一段代码', '有什么风险', '帮我做决定', '解释一下', '这个词什么意思', '怎么解决', '为什么', '还有呢', '继续']
  ]

  function tailLatin(text) {
    const m = /([a-zA-Z]+)$/.exec(text || '')
    return m ? { word: m[1], index: m.index } : null
  }

  function isCJK(ch) {
    const c = ch.charCodeAt(0)
    return c >= 0x3400 && c <= 0x9fff
  }

  function candidates(text, limit) {
    limit = limit || 6
    const tail = tailLatin(text)
    if (!tail) return common.slice(0, limit)

    const buf = tail.word.toLowerCase()
    const hits = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      let score = -1
      if (r.py && r.py === buf) score = 0
      else if (r.ini && r.ini === buf) score = 0
      else if (r.py && r.py.indexOf(buf) === 0) score = 1
      else if (r.ini && r.ini.indexOf(buf) === 0) score = 2
      else if (r.w.toLowerCase().indexOf(buf) === 0) score = 3
      if (score >= 0) hits.push({ w: r.w, s: score, n: r.n })
    }
    hits.sort(function (a, b) {
      if (a.s !== b.s) return a.s - b.s
      return a.n - b.n
    })

    const out = []
    const used = {}
    for (let i = 0; i < hits.length && out.length < limit; i++) {
      if (used[hits[i].w]) continue
      used[hits[i].w] = true
      out.push(hits[i].w)
    }
    return out
  }

  /** 用候选替换尾部的拼音串；没有尾部字母就按语境插入 */
  function commit(text, word) {
    text = String(text || '')
    const tail = tailLatin(text)
    if (tail) return text.slice(0, tail.index) + word
    if (!text) return word
    const last = text.charAt(text.length - 1)
    if (last === ' ') return text + word
    const latinWord = /^[a-zA-Z]/.test(word)
    if (latinWord && isCJK(last)) return text + ' ' + word
    return text + word
  }

  function insert(text, chunk) {
    text = String(text || '')
    if (!text) return chunk
    const last = text.charAt(text.length - 1)
    if (last === ' ') return text + chunk
    if (isCJK(chunk.charAt(0)) && isCJK(last)) return text + chunk
    if (/[a-zA-Z0-9]/.test(last) && /^[a-zA-Z0-9]/.test(chunk)) return text + ' ' + chunk
    if (isCJK(last) && /^[a-zA-Z0-9]/.test(chunk)) return text + ' ' + chunk
    return text + chunk
  }

  function backspace(text) {
    text = String(text || '')
    return text.length ? text.slice(0, text.length - 1) : ''
  }

  function push(text, ch) {
    text = String(text || '')
    if (text.length >= MAX_LEN) return text
    return text + ch
  }

  function boardPage(i) {
    const p = BOARD[((i % BOARD.length) + BOARD.length) % BOARD.length]
    return p
  }

  WM.ime = {
    TAG: TAG,
    MAX_LEN: MAX_LEN,
    candidates: candidates,
    commit: commit,
    insert: insert,
    backspace: backspace,
    push: push,
    boardPage: boardPage,
    boardCount: BOARD.length
  }
})()
