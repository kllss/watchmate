/**
 * store.js — 跨页面共享状态 + 本地缓存
 *
 * 状态不放在页面 private 里：子页被系统 pop / 重建后 private 会重置。
 * 这里的状态挂在 globalThis，进程活着就一直存在；持久化用 @system.storage。
 */
;(function () {
  const TAG = 'store.js@wm'
  if (!globalThis.__wm_modules__) globalThis.__wm_modules__ = []
  globalThis.__wm_modules__.push(TAG)

  const WM = (globalThis.__wm = globalThis.__wm || {})
  const C = WM.config
  const S = WM.save

  const state = (globalThis.__wm_state = globalThis.__wm_state || {
    ready: false,
    mode: '',
    providerId: '',
    deckIndex: 0,
    prompts: [],
    promptsAt: 0,
    cards: [],
    cardsAt: 0,
    last: null,
    pendingText: '',
    lastError: null,
    bootAt: Date.now()
  })

  let hydrating = null

  function applyRuntime() {
    globalThis.__wm_runtime = globalThis.__wm_runtime || {}
    globalThis.__wm_runtime.mode = state.mode
    globalThis.__wm_runtime.providerId = state.providerId
  }

  function saveSettings() {
    return S.setJson('settings', {
      mode: state.mode,
      providerId: state.providerId,
      deckIndex: state.deckIndex
    })
  }

  function hydrate(cb) {
    if (state.ready) {
      if (cb) cb(state)
      return Promise.resolve(state)
    }
    if (hydrating) {
      return hydrating.then(function (s) {
        if (cb) cb(s)
        return s
      })
    }

    hydrating = Promise.all([
      S.getJson('settings', null),
      S.getJson('last', null),
      S.getJson('cards', null),
      S.getJson('prompts', null)
    ]).then(function (res) {
      const settings = res[0] || {}
      const last = res[1]
      const cards = res[2]
      const prompts = res[3]

      const cfgMode = C.mode()
      state.mode = cfgMode === 'demo' ? 'demo' : settings.mode || cfgMode
      state.providerId = settings.providerId || C.get().activeProvider || ''
      state.deckIndex = typeof settings.deckIndex === 'number' ? settings.deckIndex : 0

      if (last && last.text) state.last = last
      if (cards && cards.cards && cards.cards.length) {
        state.cards = cards.cards
        state.cardsAt = cards.at || 0
      }
      if (prompts && prompts.prompts && prompts.prompts.length) {
        state.prompts = prompts.prompts
        state.promptsAt = prompts.at || 0
      }

      applyRuntime()
      state.ready = true
      hydrating = null
      return state
    })

    return hydrating.then(function (s) {
      if (cb) cb(s)
      return s
    })
  }

  function setMode(mode) {
    state.mode = mode
    C.setMode(mode)
    applyRuntime()
    return saveSettings()
  }

  function setProvider(id) {
    state.providerId = id
    C.setProvider(id)
    applyRuntime()
    return saveSettings()
  }

  function cycleProvider(dir) {
    const p = C.cycleProvider(dir)
    if (p) state.providerId = p.id
    applyRuntime()
    saveSettings()
    return p
  }

  function setDeck(i) {
    state.deckIndex = i
    saveSettings()
    return i
  }

  function cacheAnswer(answer) {
    state.last = answer
    return S.setJson('last', answer)
  }

  function cacheCards(cards) {
    state.cards = cards
    state.cardsAt = Date.now()
    return S.setJson('cards', { at: state.cardsAt, cards: cards })
  }

  function cachePrompts(prompts) {
    state.prompts = prompts
    state.promptsAt = Date.now()
    return S.setJson('prompts', { at: state.promptsAt, prompts: prompts })
  }

  function pending(text) {
    state.pendingText = text || ''
  }

  function takePending() {
    const t = state.pendingText
    state.pendingText = ''
    return t
  }

  function lastError(e) {
    state.lastError = e || null
  }

  function resetCache() {
    state.last = null
    state.cards = []
    state.cardsAt = 0
    state.prompts = []
    state.promptsAt = 0
    state.lastError = null
    state.pendingText = ''
    return Promise.all([S.del('last'), S.del('cards'), S.del('prompts')])
  }

  WM.store = {
    TAG: TAG,
    state: state,
    hydrate: hydrate,
    saveSettings: saveSettings,
    setMode: setMode,
    setProvider: setProvider,
    cycleProvider: cycleProvider,
    setDeck: setDeck,
    cacheAnswer: cacheAnswer,
    cacheCards: cacheCards,
    cachePrompts: cachePrompts,
    pending: pending,
    takePending: takePending,
    lastError: lastError,
    resetCache: resetCache
  }
})()
