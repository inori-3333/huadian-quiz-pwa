const { isCorrectAnswer, normalizeChoice, usesImmediateSubmission, matchesQuestionGroup, normalizeQuestionProgress, recordQuestionResult, createResumeSnapshot, isResumeAvailable, shuffled, findRegulationMatches } = globalThis.QuizCore

const STORAGE_KEY = 'huadian-quiz-state-v1'
const CORRECT_FEEDBACK_DELAY_MS = 400
const app = document.querySelector('#app')
const bottomNav = document.querySelector('#bottom-nav')
const backButton = document.querySelector('#back-button')
const bankSwitch = document.querySelector('#bank-switch')
const pageTitle = document.querySelector('#page-title')
const pageSubtitle = document.querySelector('#page-subtitle')
const modalRoot = document.querySelector('#modal-root')
const toastNode = document.querySelector('#toast')
const installButton = document.querySelector('#install-button')
const connectionStatus = document.querySelector('#connection-status')

let banks = new Map()
let regulationData = { sources: [], clauses: [] }
let currentView = 'home'
let historyStack = []
let listState = { mode: 'library', query: '', chapter: 'all', limit: 60, wrongGroup: 'current' }
let session = null
let toastTimer = null
let storageWarningShown = false

const stored = loadStoredState()
const progress = stored.progress || {}
const edits = stored.edits || {}
const resumeSessions = stored.resumeSessions || {}
const examSessions = stored.examSessions || {}
let swipeGuideDismissed = stored.swipeGuideDismissed === true
let currentBankId = stored.currentBankId || null

function loadStoredState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
  } catch {
    return {}
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentBankId, progress, edits, resumeSessions, examSessions, swipeGuideDismissed }))
    return true
  } catch {
    if (!storageWarningShown) showToast('浏览器无法保存进度，请允许本站使用本地存储')
    storageWarningShown = true
    return false
  }
}

function saveCurrentSession() {
  if (!session || !currentBankId) return
  const snapshot = createResumeSnapshot(session)
  if (isResumeAvailable(snapshot)) resumeSessions[currentBankId] = snapshot
  else delete resumeSessions[currentBankId]
  saveState()
}

function savedSessionForBank(bankId) {
  const saved = resumeSessions[bankId]
  if (isResumeAvailable(saved)) return saved
  if (saved) {
    delete resumeSessions[bankId]
    saveState()
  }
  return null
}

function continueSession() {
  const saved = savedSessionForBank(currentBankId)
  if (!saved) return showToast('暂无可继续的练习')
  session = { ...createResumeSnapshot(saved), autoAdvancing: false }
  navigate('practice')
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character])
}

function typeName(type) {
  return ({ single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题' })[type] || '题目'
}

function questionState(id) {
  progress[id] = normalizeQuestionProgress(progress[id])
  return progress[id]
}

function rawBank() {
  return banks.get(currentBankId)
}

function mergedQuestion(raw) {
  return edits[raw.id] ? { ...raw, ...edits[raw.id] } : raw
}

function questionsForBank(bank = rawBank()) {
  return bank.questions.map(mergedQuestion)
}

function findQuestion(id) {
  for (const bank of banks.values()) {
    const raw = bank.questions.find(question => question.id === id)
    if (raw) return mergedQuestion(raw)
  }
  return null
}

function statsFor(bank) {
  let answered = 0
  let currentWrong = 0
  let wrongEver = 0
  let favorite = 0
  let attempts = 0
  for (const question of bank.questions) {
    if (!progress[question.id]) continue
    const state = questionState(question.id)
    if (state.attempts > 0) answered += 1
    if (state.currentWrong) currentWrong += 1
    if (state.wrongCount > 0) wrongEver += 1
    if (state.favorite) favorite += 1
    attempts += state.attempts || 0
  }
  return { answered, currentWrong, wrongEver, favorite, attempts, percent: Math.round(answered / bank.questionCount * 100) }
}

function showToast(message) {
  clearTimeout(toastTimer)
  toastNode.textContent = message
  toastNode.classList.add('show')
  toastTimer = setTimeout(() => toastNode.classList.remove('show'), 1700)
}

function showSwipeGuide() {
  if (swipeGuideDismissed || !['home', 'dashboard'].includes(currentView)) return
  const previousFocus = document.activeElement
  const close = () => {
    swipeGuideDismissed = true
    saveState()
    modalRoot.innerHTML = ''
    previousFocus?.focus()
  }
  modalRoot.innerHTML = `<div class="modal-backdrop swipe-guide-backdrop"><section class="modal swipe-guide" role="dialog" aria-modal="true" aria-labelledby="swipe-guide-title" aria-describedby="swipe-guide-copy">
    <div class="modal-head"><h2 id="swipe-guide-title">右滑，回看上一题</h2><button class="modal-close" type="button" aria-label="关闭提示">×</button></div>
    <div id="swipe-guide-copy">
      <p>刷题时向右滑动，即可查看刚才的答题；向左滑动，返回后面的题目。</p>
      <p>回看时，答对的题也会显示对应的安规条文。</p>
    </div>
    <button class="primary-button full-button modal-done" type="button">知道了</button>
  </section></div>`
  const first = modalRoot.querySelector('.modal-close')
  const last = modalRoot.querySelector('.modal-done')
  first.addEventListener('click', close)
  last.addEventListener('click', close)
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) close() })
  modalRoot.querySelector('.modal').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if (event.key === 'Tab') {
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  })
  first.focus()
}

function setHeader(title, subtitle = '', { back = false, switcher = false } = {}) {
  pageTitle.textContent = title
  pageTitle.title = title
  pageSubtitle.textContent = subtitle
  pageSubtitle.classList.toggle('hidden', !subtitle)
  backButton.classList.toggle('hidden', !back)
  document.querySelector('.brand-mark').classList.toggle('hidden', back)
  bankSwitch.classList.toggle('hidden', !switcher)
}

function setBottomNav(visible, active = '') {
  bottomNav.classList.toggle('hidden', !visible)
  document.body.classList.toggle('has-primary-nav', visible)
  bottomNav.querySelectorAll('button').forEach(button => {
    const isActive = button.dataset.nav === active
    button.classList.toggle('active', isActive)
    if (isActive) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  })
}

function navigate(view, options = {}) {
  if (options.push !== false && currentView !== view) historyStack.push(currentView)
  currentView = view
  window.scrollTo(0, 0)
  render()
}

function selectBank(id) {
  currentBankId = id
  saveState()
  historyStack = []
  navigate('dashboard', { push: false })
}

function render() {
  app.dataset.view = currentView
  if (currentView === 'home') renderHome()
  else if (currentView === 'dashboard') renderDashboard()
  else if (['library', 'wrong', 'favorite'].includes(currentView)) renderList(currentView)
  else if (currentView === 'practice') renderPractice()
  else if (currentView === 'exam-setup') renderExamSetup()
  else if (currentView === 'exam') renderExam()
  else if (currentView === 'exam-result') renderExamResult()
  else if (currentView === 'exam-review') renderExamReview()
}

function renderHome() {
  setHeader('华电刷题')
  setBottomNav(false)
  app.innerHTML = `
    <div class="library-heading"><div><h1>选择题库</h1><p>${banks.size} 个题库 · ${[...banks.values()].reduce((total, bank) => total + bank.questionCount, 0)} 道题</p></div><span>v${esc(document.querySelector('meta[name="app-version"]').content)}</span></div>
    <section class="bank-grid">
      ${[...banks.values()].map(bank => {
        const stats = statsFor(bank)
        const theme = bank.id === 'youththeory2' ? 'theory' : ''
        return `<article class="bank-card ${theme}" data-bank="${bank.id}" tabindex="0" role="button" aria-label="打开${esc(bank.title)}">
          <h2>${esc(bank.title)}</h2>
          <p>${bank.questionCount} 道题 · ${bank.chapters.length} 个章节</p>
          <div class="bank-stats">
            <div><strong>${stats.answered}</strong><small>已答</small></div>
            <div><strong>${stats.currentWrong}</strong><small>待巩固</small></div>
            <div><strong>${stats.favorite}</strong><small>收藏</small></div>
          </div>
        </article>`
      }).join('')}
    </section>
    <p class="library-note">练习进度、错题与收藏保存在当前浏览器。离线就绪后，断网也能刷题和查看安规原文。</p>`
  app.querySelectorAll('[data-bank]').forEach(card => {
    card.addEventListener('click', () => selectBank(card.dataset.bank))
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectBank(card.dataset.bank) } })
  })
}

function renderDashboard() {
  const bank = rawBank()
  if (!bank) return navigate('home', { push: false })
  const stats = statsFor(bank)
  const savedSession = savedSessionForBank(bank.id)
  const headerTitle = bank.title
  setHeader(headerTitle, '', { switcher: banks.size > 1 })
  setBottomNav(true, 'dashboard')
  app.innerHTML = `
    <section class="progress-card">
      <div class="progress-top"><div><span>题库进度</span><br><strong>${stats.percent}%</strong></div><span>${stats.answered} / ${bank.questionCount}</span></div>
      <div class="progress-track"><i style="width:${stats.percent}%"></i></div>
      <div class="progress-notes"><span>累计作答 ${stats.attempts} 次</span><span>历史错题 ${stats.wrongEver} 题</span><span>收藏 ${stats.favorite} 题</span></div>
    </section>
    <section class="action-grid">
      ${savedSession ? '<button class="action-card continue" data-action="continue"><span class="action-icon">▶</span><strong>继续刷题</strong></button>' : ''}
      ${bank.id !== 'youththeory2' ? '<button class="action-card" data-action="exam"><span class="action-icon">▤</span><strong>模拟安规考试</strong></button>' : ''}
      <button class="action-card" data-action="sequence"><span class="action-icon">→</span><strong>顺序刷题</strong></button>
      <button class="action-card" data-action="start-at"><span class="action-icon">#</span><strong>指定题号</strong></button>
      <button class="action-card" data-action="by-type"><span class="action-icon">≡</span><strong>题型刷题</strong></button>
      <button class="action-card" data-action="random"><span class="action-icon">↝</span><strong>随机练习</strong></button>
      <button class="action-card accent" data-action="wrong"><span class="action-icon">×</span><strong>重刷待巩固（${stats.currentWrong}）</strong></button>
      <button class="action-card" data-action="favorite"><span class="action-icon">★</span><strong>收藏练习</strong></button>
    </section>`
  app.querySelector('[data-action="continue"]')?.addEventListener('click', continueSession)
  app.querySelector('[data-action="exam"]')?.addEventListener('click', () => navigate('exam-setup'))
  app.querySelector('[data-action="sequence"]').addEventListener('click', () => startSession(questionsForBank().map(q => q.id), '顺序刷题'))
  app.querySelector('[data-action="start-at"]').addEventListener('click', openStartPicker)
  app.querySelector('[data-action="by-type"]').addEventListener('click', openTypePicker)
  app.querySelector('[data-action="random"]').addEventListener('click', () => startSession(shuffled(questionsForBank().map(q => q.id)), '随机练习'))
  app.querySelector('[data-action="wrong"]').addEventListener('click', () => startFilteredSession('wrong'))
  app.querySelector('[data-action="favorite"]').addEventListener('click', () => startFilteredSession('favorite'))
}

function openTypePicker() {
  const questions = questionsForBank()
  const groups = [
    { key: 'choice', label: '选择题' },
    { key: 'fill', label: '填空题' },
    { key: 'judge', label: '判断题' }
  ].map(group => ({ ...group, questions: questions.filter(question => matchesQuestionGroup(question.type, group.key)) }))
  const close = () => { modalRoot.innerHTML = '' }
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="选择题型">
    <div class="modal-head"><h2>选择题型</h2><button class="modal-close" type="button">×</button></div>
    <div class="type-picker">${groups.map(group => `<button data-question-group="${group.key}" type="button" ${group.questions.length ? '' : 'disabled'}><strong>${group.label}</strong><span>${group.questions.length}</span></button>`).join('')}</div>
  </section></div>`
  modalRoot.querySelector('.modal-close').addEventListener('click', close)
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) close() })
  modalRoot.querySelectorAll('[data-question-group]').forEach(button => button.addEventListener('click', () => {
    const group = groups.find(item => item.key === button.dataset.questionGroup)
    close()
    startSession(group.questions.map(question => question.id), `${group.label}练习`)
  }))
}

function openStartPicker() {
  const questions = questionsForBank()
  const close = () => { modalRoot.innerHTML = '' }
  const start = () => {
    const position = Number(modalRoot.querySelector('#start-position').value)
    if (!Number.isInteger(position) || position < 1 || position > questions.length) return showToast(`请输入 1-${questions.length}`)
    close()
    startSession(questions.slice(position - 1).map(question => question.id), '顺序刷题', { displayStart: position, displayTotal: questions.length })
  }
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="指定题号">
    <div class="modal-head"><h2>指定题号</h2><button class="modal-close" type="button">×</button></div>
    <div class="form-group"><label for="start-position">起始题号</label><input id="start-position" type="number" inputmode="numeric" min="1" max="${questions.length}" value="1"></div>
    <div class="modal-actions"><button id="cancel-start" class="secondary-button" type="button">取消</button><button id="confirm-start" class="primary-button" type="button">开始刷题</button></div>
  </section></div>`
  modalRoot.querySelector('.modal-close').addEventListener('click', close)
  modalRoot.querySelector('#cancel-start').addEventListener('click', close)
  modalRoot.querySelector('#confirm-start').addEventListener('click', start)
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) close() })
  modalRoot.querySelector('#start-position').addEventListener('keydown', event => { if (event.key === 'Enter') start() })
  modalRoot.querySelector('#start-position').focus()
}

function isInWrongGroup(state, group = 'current') {
  return group === 'history' ? state.wrongCount > 0 : state.currentWrong
}

function wrongGroupLabel(group = listState.wrongGroup) {
  return group === 'history' ? '历史错题' : '待巩固'
}

function filteredQuestions(mode) {
  return questionsForBank().filter(question => {
    const state = questionState(question.id)
    if (mode === 'wrong' && !isInWrongGroup(state, listState.wrongGroup)) return false
    if (mode === 'favorite' && !state.favorite) return false
    if (listState.chapter !== 'all' && question.chapter !== listState.chapter) return false
    if (listState.query) {
      const needle = listState.query.toLowerCase()
      const haystack = `${question.stem} ${question.answerRaw} ${question.options.map(option => option.text).join(' ')}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })
}

function renderList(mode) {
  listState = { mode, query: '', chapter: 'all', limit: 60, wrongGroup: 'current' }
  const label = mode === 'library' ? '全部题目' : mode === 'wrong' ? '错题本' : '我的收藏'
  const stats = mode === 'wrong' ? statsFor(rawBank()) : null
  setHeader(label, '', { switcher: true })
  setBottomNav(true, mode)
  app.innerHTML = `
    ${mode === 'wrong' ? `<section class="wrong-group-panel">
      <div class="wrong-group-switch" role="tablist" aria-label="错题分组">
        <button class="active" data-wrong-group="current" type="button" role="tab" aria-selected="true">
          <span><strong>待巩固</strong><small>最近一次做错</small></span><b>${stats.currentWrong}</b>
        </button>
        <button data-wrong-group="history" type="button" role="tab" aria-selected="false">
          <span><strong>历史错题</strong><small>错过即保留</small></span><b>${stats.wrongEver}</b>
        </button>
      </div>
      <p id="wrong-group-help" class="wrong-group-help">做对后会自动移出，可持续练习至 0。</p>
    </section>` : ''}
    <div class="toolbar">
      <input id="search" class="search" type="search" placeholder="搜索题干、选项或答案">
      <select id="chapter-filter" class="filter-select" aria-label="章节筛选">
        <option value="all">全部章节</option>
        ${rawBank().chapters.map(chapter => `<option value="${esc(chapter)}">${esc(chapter)}</option>`).join('')}
      </select>
    </div>
    <div id="list-results"></div>`
  const search = app.querySelector('#search')
  search.addEventListener('input', () => { listState.query = search.value.trim(); listState.limit = 60; updateListResults() })
  app.querySelector('#chapter-filter').addEventListener('change', event => { listState.chapter = event.target.value; listState.limit = 60; updateListResults() })
  app.querySelectorAll('[data-wrong-group]').forEach(button => button.addEventListener('click', () => {
    listState.wrongGroup = button.dataset.wrongGroup
    listState.limit = 60
    app.querySelectorAll('[data-wrong-group]').forEach(item => {
      const active = item.dataset.wrongGroup === listState.wrongGroup
      item.classList.toggle('active', active)
      item.setAttribute('aria-selected', String(active))
    })
    app.querySelector('#wrong-group-help').textContent = listState.wrongGroup === 'history'
      ? '曾经做错过就会保留，方便长期回顾。'
      : '做对后会自动移出，可持续练习至 0。'
    updateListResults()
  }))
  updateListResults()
}

function updateListResults() {
  const target = app.querySelector('#list-results')
  if (!target) return
  const items = filteredQuestions(listState.mode)
  const label = listState.mode === 'library' ? '题目' : listState.mode === 'wrong' ? wrongGroupLabel() : '收藏'
  if (!items.length) {
    const emptyTitle = listState.mode === 'wrong' && listState.wrongGroup === 'current' ? '待巩固已清零' : `暂无${label}`
    const emptyDetail = listState.mode === 'wrong' && listState.wrongGroup === 'current' ? '<p>最近一次做错的题已经全部掌握。</p>' : ''
    target.innerHTML = `<section class="empty-state"><div class="empty-icon">${listState.mode === 'wrong' ? '✓' : listState.mode === 'favorite' ? '☆' : '?'}</div><h2>${emptyTitle}</h2>${emptyDetail}</section>`
    return
  }
  const visible = items.slice(0, listState.limit)
  target.innerHTML = `
    <div class="list-summary"><span>共 ${items.length} 道${label}</span>${listState.mode !== 'library' ? `<button id="practice-filtered" class="tiny-button">练习这 ${items.length} 题</button>` : ''}</div>
    <div class="question-list">${visible.map(questionRow).join('')}</div>
    ${visible.length < items.length ? `<button id="load-more" class="secondary-button full-button">再显示 ${Math.min(60, items.length - visible.length)} 道</button>` : ''}`
  bindQuestionRows(target)
  target.querySelector('#practice-filtered')?.addEventListener('click', () => startSession(items.map(q => q.id), listState.mode === 'wrong' ? (listState.wrongGroup === 'history' ? '历史错题练习' : '待巩固重刷') : '收藏练习'))
  target.querySelector('#load-more')?.addEventListener('click', () => { listState.limit += 60; updateListResults() })
}

function questionRow(question) {
  const state = questionState(question.id)
  return `<article class="question-row" data-id="${question.id}">
    <div class="question-row-top">
      <div class="question-meta">${esc(question.chapter)} · ${typeName(question.type)} · 第 ${question.number} 题</div>
      <div class="row-actions">
        ${listState.mode === 'wrong' && listState.wrongGroup === 'history' && !state.currentWrong ? '<span class="mastered-badge">已巩固</span>' : ''}
        ${state.wrongCount ? `<span class="wrong-badge">错 ${state.wrongCount} 次</span>` : ''}
        <button class="favorite-button ${state.favorite ? 'active' : ''}" data-favorite type="button" aria-label="收藏">★</button>
      </div>
    </div>
    <h3>${esc(question.stem)}</h3>
    <div class="row-actions"><button class="tiny-button" data-practice type="button">练习此题</button><button class="tiny-button" data-edit type="button">编辑题目</button></div>
  </article>`
}

function bindQuestionRows(root) {
  root.querySelectorAll('.question-row').forEach(row => {
    const id = row.dataset.id
    row.querySelector('[data-favorite]').addEventListener('click', () => { toggleFavorite(id); updateListResults() })
    row.querySelector('[data-practice]').addEventListener('click', () => startSession([id], '单题练习'))
    row.querySelector('[data-edit]').addEventListener('click', () => openEditor(id))
  })
}

function startFilteredSession(mode, wrongGroup = 'current') {
  const ids = questionsForBank().filter(question => mode === 'wrong' ? isInWrongGroup(questionState(question.id), wrongGroup) : questionState(question.id).favorite).map(question => question.id)
  if (!ids.length) {
    showToast(mode === 'wrong' ? (wrongGroup === 'history' ? '暂无历史错题' : '待巩固已清零') : '暂无收藏')
    return
  }
  startSession(ids, mode === 'wrong' ? (wrongGroup === 'history' ? '历史错题练习' : '待巩固重刷') : '收藏练习')
}

function startSession(ids, title, { displayStart = 1, displayTotal = ids.length } = {}) {
  session = { ids, title, index: 0, displayStart, displayTotal, answer: '', submitted: false, results: [], correct: 0, wrong: 0 }
  saveCurrentSession()
  navigate('practice')
}

// Keep the live question and its draft intact while browsing answered questions.
// reviewIndex is deliberately omitted from createResumeSnapshot.
function practiceQuestionState() {
  const reviewing = Number.isInteger(session.reviewIndex)
  const index = reviewing ? session.reviewIndex : session.index
  const result = session.results[index]
  return {
    index,
    reviewing,
    result,
    answer: reviewing ? String(result.userAnswer || '') : session.answer,
    submitted: reviewing || session.submitted,
    autoAdvancing: !reviewing && session.autoAdvancing
  }
}

function advanceCurrentQuestion() {
  session.index += 1
  session.answer = ''
  session.submitted = false
  session.autoAdvancing = false
  saveCurrentSession()
}

function reviewPreviousQuestion() {
  if (!session) return
  // A swipe during correct-answer feedback opens the answer just submitted.
  // Settling the advance also invalidates its pending timer.
  if (session.autoAdvancing) advanceCurrentQuestion()
  const previousIndex = practiceQuestionState().index - 1
  if (previousIndex < 0 || !session.results[previousIndex]) return
  session.reviewIndex = previousIndex
  renderPractice()
  window.scrollTo(0, 0)
}

function returnToCurrentQuestion() {
  delete session.reviewIndex
  renderPractice()
  window.scrollTo(0, 0)
}

function reviewNextQuestion() {
  if (!session || !Number.isInteger(session.reviewIndex)) return
  if (session.reviewIndex + 1 >= session.index) return returnToCurrentQuestion()
  session.reviewIndex += 1
  renderPractice()
  window.scrollTo(0, 0)
}

function renderPractice() {
  setHeader(session?.title || '练习', '', { back: true })
  setBottomNav(false)
  if (!session) return
  const view = practiceQuestionState()
  if (view.index >= session.ids.length) return renderSessionComplete()
  const question = findQuestion(session.ids[view.index])
  const state = questionState(question.id)
  const displayStart = Number(session.displayStart || 1)
  const displayTotal = Number(session.displayTotal || session.ids.length)
  const displayIndex = displayStart + view.index
  const percent = Math.round((displayIndex - 1 + (view.submitted ? 1 : 0)) / displayTotal * 100)
  const returnLabel = session.index >= session.ids.length ? '返回结果' : '返回当前题'
  app.innerHTML = `<section class="practice-shell">
    <div class="practice-progress"><div class="progress-track"><i style="width:${percent}%"></i></div><span>${displayIndex} / ${displayTotal}</span></div>
    <article class="question-card">
      <div class="question-card-header">
        <span class="type-chip">${typeName(question.type)}${question.type === 'multiple' ? ' · 可多选' : ''}</span>
        <div class="row-actions">${state.wrongCount ? `<span class="wrong-badge">累计错 ${state.wrongCount} 次</span>` : ''}<button id="practice-favorite" class="favorite-button ${state.favorite ? 'active' : ''}" type="button">★</button></div>
      </div>
      <h2>${esc(question.stem)}</h2>
      ${answerControls(question, view)}
      ${view.submitted ? (view.autoAdvancing ? '' : feedbackPanel(question, view)) : pendingAnswerActions(question)}
    </article>
    ${view.submitted && !view.autoAdvancing ? `<div class="practice-next"><button id="edit-current" class="secondary-button" type="button">编辑此题</button><button id="next-question" class="primary-button" type="button">${view.reviewing ? (view.index + 1 < session.index ? '下一道已答题' : returnLabel) : (session.index + 1 >= session.ids.length ? '查看结果' : '下一题')}</button></div>` : ''}
  </section>`
  bindPractice(question)
}

function pendingAnswerActions(question) {
  if (usesImmediateSubmission(question.type)) {
    return '<div class="answer-actions immediate"><button id="dont-know" class="secondary-button" type="button">不知道</button></div>'
  }
  return '<div class="answer-actions"><button id="dont-know" class="secondary-button" type="button">不知道</button><button id="submit-answer" class="primary-button" type="button">提交答案</button></div>'
}

function answerControls(question, view) {
  if (question.type === 'fill') {
    const result = view.submitted ? view.result : null
    const resultClass = result ? (result.correct ? 'correct' : 'wrong') : ''
    return `<input id="fill-answer" class="fill-answer ${resultClass}" type="text" placeholder="输入答案" value="${esc(view.answer)}" ${view.submitted ? 'disabled' : ''}>`
  }
  const options = question.type === 'judge'
    ? [{ key: '对', text: '正确' }, { key: '错', text: '错误' }]
    : question.options
  const selected = question.type === 'multiple' ? normalizeChoice(view.answer).split('') : [view.answer]
  return `<div class="option-list">${options.map(option => {
    const chosen = selected.includes(option.key)
    let resultClass = ''
    if (view.submitted) {
      const correctKeys = question.type === 'judge' ? [String(question.answer).includes('错') ? '错' : '对'] : normalizeChoice(question.answer).split('')
      if (correctKeys.includes(option.key)) resultClass = 'correct'
      else if (chosen) resultClass = 'wrong'
    }
    return `<button class="option ${chosen ? 'selected' : ''} ${resultClass}" data-option="${esc(option.key)}" type="button" ${view.submitted ? 'disabled' : ''}><span class="option-key">${esc(option.key)}</span><span>${esc(option.text)}</span></button>`
  }).join('')}</div>`
}

function feedbackPanel(question, view) {
  const result = view.result
  const answerText = question.type === 'single' || question.type === 'multiple'
    ? `${question.answer}（${question.options.filter(option => normalizeChoice(question.answer).includes(option.key)).map(option => option.text).join('；')}）`
    : question.answerRaw || question.answer
  return `<div class="answer-panel ${result.correct ? 'correct' : 'wrong'}"><strong>${result.correct ? '回答正确' : '回答错误'}</strong><p>正确答案：${esc(answerText)}</p>${!result.correct ? `<p>你的答案：${esc(result.userAnswer || '未作答')}</p>` : ''}</div>${!result.correct || view.reviewing ? regulationPanel(question) : ''}`
}

function correctAnswerText(question) {
  if (question.type === 'single' || question.type === 'multiple') {
    const keys = new Set(normalizeChoice(question.answer).split(''))
    return question.options.filter(option => keys.has(option.key)).map(option => option.text).join('；')
  }
  return question.answerRaw || question.answer || ''
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightedRegulationText(text, question) {
  const answer = correctAnswerText(question).trim()
  const terms = new Set()
  if (answer.length <= 30 && !['正确', '错误'].includes(answer) && (answer.length >= 2 || /\d/.test(answer))) terms.add(answer)
  for (const match of answer.matchAll(/\d+(?:\.\d+)?(?:%|℃|kv|mpa|mm|cm|m|h|min|年|月|次)?/gi)) {
    if (match[0]) terms.add(match[0])
  }
  for (const match of String(question.stem || '').matchAll(/[“"]([^”"]{2,16})[”"]/g)) terms.add(match[1])
  const ordered = [...terms].sort((left, right) => right.length - left.length)
  if (!ordered.length) return esc(text)
  const patterns = ordered.map(term => /^\d/.test(term) ? `(?<!\\d)${escapeRegExp(term)}(?!\\d)` : escapeRegExp(term))
  const parts = String(text).split(new RegExp(`(${patterns.join('|')})`, 'gi'))
  const normalizedTerms = new Set(ordered.map(term => term.toLowerCase()))
  return parts.map(part => normalizedTerms.has(part.toLowerCase()) ? `<mark>${esc(part)}</mark>` : esc(part)).join('')
}

function regulationPanel(question) {
  const matches = findRegulationMatches(question, currentBankId, regulationData, 3)
  if (!matches.length) return ''
  const sources = new Map(regulationData.sources.map(source => [source.id, source]))
  return `<section class="regulation-panel" aria-labelledby="regulation-title">
    <header class="regulation-panel-head">
      <span class="regulation-book" aria-hidden="true">文</span>
      <div><strong id="regulation-title">安规原文依据</strong><p>根据题干与正确答案，从两本 2024 版安规中离线匹配</p></div>
    </header>
    <div class="regulation-matches">
      ${matches.map((match, index) => {
        const source = sources.get(match.source) || {}
        const refLabel = match.kind === 'table' ? `表 ${match.ref}` : `第 ${match.ref} 条`
        return `<details class="regulation-match" ${index === 0 ? 'open' : ''}>
          <summary>
            <span class="regulation-rank">${index + 1}</span>
            <span class="regulation-source"><strong>${esc(source.title || '安规原文')}</strong><small>${esc(source.standard || '')}</small></span>
            <span class="regulation-ref">${esc(refLabel)}</span>
          </summary>
          <div class="regulation-copy"><p>${highlightedRegulationText(match.text, question)}</p></div>
        </details>`
      }).join('')}
    </div>
    <p class="regulation-note">匹配结果用于定位原文，实际执行请结合完整条款及所在章节。</p>
  </section>`
}

function bindPractice(question) {
  app.querySelector('#practice-favorite').addEventListener('click', event => { toggleFavorite(question.id); event.currentTarget.classList.toggle('active', questionState(question.id).favorite) })
  app.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => {
    if (practiceQuestionState().submitted) return
    const key = button.dataset.option
    if (question.type === 'multiple') {
      const values = new Set(normalizeChoice(session.answer).split('').filter(Boolean))
      values.has(key) ? values.delete(key) : values.add(key)
      session.answer = [...values].sort().join('')
      saveCurrentSession()
      renderPractice()
      return
    }
    session.answer = key
    submitAnswer(question, false, true)
  }))
  app.querySelector('#fill-answer')?.addEventListener('input', event => {
    if (practiceQuestionState().submitted) return
    session.answer = event.target.value
    saveCurrentSession()
  })
  app.querySelector('#submit-answer')?.addEventListener('click', () => submitAnswer(question, false, true))
  app.querySelector('#dont-know')?.addEventListener('click', () => submitAnswer(question, true))
  app.querySelector('#next-question')?.addEventListener('click', () => {
    if (practiceQuestionState().reviewing) return reviewNextQuestion()
    advanceCurrentQuestion()
    renderPractice()
    window.scrollTo(0, 0)
  })
  app.querySelector('#edit-current')?.addEventListener('click', () => openEditor(question.id))
}

function submitAnswer(question, forcedWrong, autoAdvance = false) {
  if (!session || practiceQuestionState().submitted || question.id !== session.ids[session.index]) return
  if (!forcedWrong && !String(session.answer).trim()) return showToast('请先选择或填写答案')
  const correct = !forcedWrong && isCorrectAnswer(question, session.answer)
  progress[question.id] = recordQuestionResult(questionState(question.id), correct)
  if (correct) session.correct += 1
  else session.wrong += 1
  session.results.push({ id: question.id, correct, userAnswer: session.answer })
  session.submitted = true
  if (correct && autoAdvance) {
    session.autoAdvancing = true
    saveCurrentSession()
    const activeSession = session
    const answeredIndex = session.index
    renderPractice()
    setTimeout(() => {
      if (session !== activeSession || session.index !== answeredIndex || !session.autoAdvancing) return
      advanceCurrentQuestion()
      window.scrollTo(0, 0)
      renderPractice()
    }, CORRECT_FEEDBACK_DELAY_MS)
    return
  }
  saveCurrentSession()
  renderPractice()
}

function renderSessionComplete() {
  delete resumeSessions[currentBankId]
  saveState()
  const total = session.correct + session.wrong
  const score = total ? Math.round(session.correct / total * 100) : 0
  app.innerHTML = `<section class="session-complete">
    <div class="score-ring"><div><strong>${score}%</strong><small>正确率</small></div></div>
    <h1>本轮练习完成</h1>
    <p>答对 ${session.correct} 题，答错 ${session.wrong} 题</p>
    <div class="complete-actions">
      ${session.wrong ? '<button id="retry-session-wrong" class="primary-button" type="button">重刷本轮错题</button>' : ''}
      <button id="back-dashboard" class="secondary-button" type="button">返回题库主页</button>
    </div>
  </section>`
  app.querySelector('#retry-session-wrong')?.addEventListener('click', () => {
    const ids = session.results.filter(result => !result.correct).map(result => result.id)
    startSession(ids, '本轮错题')
  })
  app.querySelector('#back-dashboard').addEventListener('click', () => { historyStack = []; navigate('dashboard', { push: false }) })
}

function toggleFavorite(id) {
  const state = questionState(id)
  state.favorite = !state.favorite
  saveState()
  showToast(state.favorite ? '已加入收藏' : '已取消收藏')
}

function openEditor(id) {
  const question = findQuestion(id)
  const optionText = question.options.map(option => `${option.key}. ${option.text}`).join('\n')
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="编辑题目">
    <div class="modal-head"><h2>编辑题目</h2><button class="modal-close" type="button">×</button></div>
    <div class="form-group"><label for="edit-stem">题干</label><textarea id="edit-stem">${esc(question.stem)}</textarea></div>
    <div class="form-group"><label for="edit-type">题型</label><select id="edit-type">
      ${[['single','单选题'],['multiple','多选题'],['judge','判断题'],['fill','填空题']].map(([value,label]) => `<option value="${value}" ${question.type === value ? 'selected' : ''}>${label}</option>`).join('')}
    </select></div>
    <div class="form-group" id="options-group"><label for="edit-options">选项</label><textarea id="edit-options">${esc(optionText)}</textarea></div>
    <div class="form-group"><label for="edit-answer">正确答案</label><input id="edit-answer" value="${esc(question.answer)}"></div>
    <div class="modal-actions"><button id="reset-question" class="danger-button" type="button">恢复原题</button><button id="save-question" class="primary-button" type="button">保存修改</button></div>
    <button id="clear-progress" class="secondary-button full-button" type="button">清除本题作答与错误记录</button>
  </section></div>`
  const close = () => { modalRoot.innerHTML = '' }
  modalRoot.querySelector('.modal-close').addEventListener('click', close)
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) close() })
  const typeSelect = modalRoot.querySelector('#edit-type')
  const syncOptionVisibility = () => modalRoot.querySelector('#options-group').classList.toggle('hidden', !['single','multiple'].includes(typeSelect.value))
  typeSelect.addEventListener('change', syncOptionVisibility); syncOptionVisibility()
  modalRoot.querySelector('#save-question').addEventListener('click', () => {
    const type = typeSelect.value
    const stem = modalRoot.querySelector('#edit-stem').value.trim()
    const answer = modalRoot.querySelector('#edit-answer').value.trim()
    if (!stem || !answer) return showToast('题干和答案不能为空')
    const options = ['single','multiple'].includes(type) ? parseEditedOptions(modalRoot.querySelector('#edit-options').value) : []
    if (['single','multiple'].includes(type) && options.length < 2) return showToast('选择题至少需要两个选项')
    edits[id] = { stem, type, options, answer, answerRaw: answer }
    saveState(); close(); showToast('题目已修改'); render()
  })
  modalRoot.querySelector('#reset-question').addEventListener('click', () => {
    if (!edits[id]) return showToast('当前已经是原题')
    delete edits[id]; saveState(); close(); showToast('已恢复原题'); render()
  })
  modalRoot.querySelector('#clear-progress').addEventListener('click', () => {
    delete progress[id]; saveState(); close(); showToast('本题记录已清除'); render()
  })
}

function parseEditedOptions(text) {
  return text.split(/\n+/).map((line, index) => {
    const match = line.trim().match(/^([A-H])\s*[.．、]?\s*(.+)$/i)
    return match ? { key: match[1].toUpperCase(), text: match[2].trim() } : { key: 'ABCDEFGH'[index], text: line.trim() }
  }).filter(option => option.text)
}

// Bind once to the stable root: selecting an answer replaces the question DOM.
// Leave vertical scrolling, pinch zoom and text input gestures to the browser.
let practiceGesture = null
let suppressPracticeClickUntil = 0
app.addEventListener('pointerdown', event => {
  if (!event.isPrimary) { practiceGesture = null; return }
  suppressPracticeClickUntil = 0
  if (currentView !== 'practice' || !session || !['touch', 'pen'].includes(event.pointerType)) return
  if (event.target.closest('input:enabled, textarea, select, [contenteditable="true"]')) return
  practiceGesture = { id: event.pointerId, x: event.clientX, y: event.clientY, session }
}, true)
app.addEventListener('pointermove', event => {
  if (!practiceGesture || practiceGesture.id !== event.pointerId) return
  const dx = event.clientX - practiceGesture.x
  const dy = event.clientY - practiceGesture.y
  if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) {
    practiceGesture = null
  } else if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    app.setPointerCapture(event.pointerId)
  }
}, true)
app.addEventListener('pointerup', event => {
  const gesture = practiceGesture
  practiceGesture = null
  if (!gesture || gesture.id !== event.pointerId || gesture.session !== session || currentView !== 'practice') return
  const dx = event.clientX - gesture.x
  const dy = event.clientY - gesture.y
  if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy) * 1.5) return
  suppressPracticeClickUntil = Date.now() + 500
  event.preventDefault()
  if (dx > 0) reviewPreviousQuestion()
  else reviewNextQuestion()
}, true)
app.addEventListener('pointercancel', () => { practiceGesture = null }, true)
app.addEventListener('click', event => {
  if (event.detail !== 0 && Date.now() < suppressPracticeClickUntil) {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
}, true)

backButton.addEventListener('click', () => {
  if (currentView.startsWith('exam')) return leaveExamView()
  if (currentView === 'practice') {
    if (Number.isInteger(session?.reviewIndex)) return returnToCurrentQuestion()
    session = null
    currentView = historyStack.pop() || 'dashboard'
    render()
    return
  }
  currentView = historyStack.pop() || (currentBankId ? 'dashboard' : 'home')
  render()
})

bankSwitch.addEventListener('click', () => { session = null; historyStack = []; navigate('home', { push: false }) })

bottomNav.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
  session = null
  historyStack = []
  navigate(button.dataset.nav, { push: false })
}))

function boot() {
  try {
    const data = window.QUIZ_BANKS
    const references = window.SAFETY_REGULATIONS
    if (!Array.isArray(data) || !data.length) throw new Error('Embedded question banks are unavailable')
    if (!references || !Array.isArray(references.sources) || !Array.isArray(references.clauses)) throw new Error('Embedded regulation references are unavailable')
    banks = new Map(data.map(bank => [bank.id, bank]))
    regulationData = references
    if (banks.size !== data.length || !banks.has('exam0828') || !banks.has('safetyweek2') || !banks.has('youththeory2')) {
      throw new Error('Embedded question banks are incomplete')
    }
    if (!currentBankId || !banks.has(currentBankId)) currentBankId = null
    currentView = currentBankId ? 'dashboard' : 'home'
    saveState()
    render()
    showSwipeGuide()
  } catch (error) {
    console.error(error)
    app.innerHTML = '<section class="empty-state"><div class="empty-icon">!</div><h2>题库加载失败</h2></section>'
  }
}

boot()
