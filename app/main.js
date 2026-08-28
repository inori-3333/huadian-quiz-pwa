const { isCorrectAnswer, normalizeChoice, usesImmediateSubmission, matchesQuestionGroup, createResumeSnapshot, isResumeAvailable, shuffled } = globalThis.QuizCore

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
let currentView = 'home'
let historyStack = []
let listState = { mode: 'library', query: '', chapter: 'all', limit: 60 }
let session = null
let toastTimer = null
let deferredInstallPrompt = null

const stored = loadStoredState()
const progress = stored.progress || {}
const edits = stored.edits || {}
const resumeSessions = stored.resumeSessions || {}
let currentBankId = stored.currentBankId || null

function loadStoredState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}
  } catch {
    return {}
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentBankId, progress, edits, resumeSessions }))
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
  if (!progress[id]) progress[id] = { attempts: 0, wrongCount: 0, favorite: false, correctCount: 0 }
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
  let wrong = 0
  let favorite = 0
  let attempts = 0
  for (const question of bank.questions) {
    const state = progress[question.id]
    if (!state) continue
    if (state.attempts > 0) answered += 1
    if (state.wrongCount > 0) wrong += 1
    if (state.favorite) favorite += 1
    attempts += state.attempts || 0
  }
  return { answered, wrong, favorite, attempts, percent: Math.round(answered / bank.questionCount * 100) }
}

function showToast(message) {
  clearTimeout(toastTimer)
  toastNode.textContent = message
  toastNode.classList.add('show')
  toastTimer = setTimeout(() => toastNode.classList.remove('show'), 1700)
}

function setHeader(title, subtitle = '', { back = false, switcher = false } = {}) {
  pageTitle.textContent = title
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
}

function renderHome() {
  setHeader('华电刷题')
  setBottomNav(false)
  app.innerHTML = `
    <section class="bank-grid">
      ${[...banks.values()].map(bank => {
        const stats = statsFor(bank)
        return `<article class="bank-card ${bank.id}" data-bank="${bank.id}" tabindex="0">
          <h2>${esc(bank.title)}</h2>
          <p>${bank.questionCount} 道题 · ${bank.chapters.length} 个组</p>
          <div class="bank-stats">
            <div><strong>${stats.answered}</strong><small>已答</small></div>
            <div><strong>${stats.wrong}</strong><small>错题</small></div>
            <div><strong>${stats.favorite}</strong><small>收藏</small></div>
          </div>
        </article>`
      }).join('')}
    </section>`
  app.querySelectorAll('[data-bank]').forEach(card => {
    card.addEventListener('click', () => selectBank(card.dataset.bank))
    card.addEventListener('keydown', event => { if (event.key === 'Enter') selectBank(card.dataset.bank) })
  })
}

function renderDashboard() {
  const bank = rawBank()
  if (!bank) return navigate('home', { push: false })
  const stats = statsFor(bank)
  const savedSession = savedSessionForBank(bank.id)
  const headerTitle = bank.title
  setHeader(headerTitle)
  setBottomNav(true, 'dashboard')
  app.innerHTML = `
    <section class="progress-card">
      <div class="progress-top"><div><span>题库进度</span><br><strong>${stats.percent}%</strong></div><span>${stats.answered} / ${bank.questionCount}</span></div>
      <div class="progress-track"><i style="width:${stats.percent}%"></i></div>
      <div class="progress-notes"><span>累计作答 ${stats.attempts} 次</span><span>收藏 ${stats.favorite} 题</span></div>
    </section>
    <section class="action-grid">
      ${savedSession ? '<button class="action-card continue" data-action="continue"><span class="action-icon">▶</span><strong>继续刷题</strong></button>' : ''}
      <button class="action-card" data-action="sequence"><span class="action-icon">→</span><strong>顺序刷题</strong></button>
      <button class="action-card" data-action="start-at"><span class="action-icon">#</span><strong>指定题号</strong></button>
      <button class="action-card" data-action="by-type"><span class="action-icon">≡</span><strong>题型刷题</strong></button>
      <button class="action-card" data-action="random"><span class="action-icon">↝</span><strong>随机练习</strong></button>
      <button class="action-card accent" data-action="wrong"><span class="action-icon">×</span><strong>重刷错题</strong></button>
      <button class="action-card" data-action="favorite"><span class="action-icon">★</span><strong>收藏练习</strong></button>
    </section>`
  app.querySelector('[data-action="continue"]')?.addEventListener('click', continueSession)
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

function filteredQuestions(mode) {
  return questionsForBank().filter(question => {
    const state = questionState(question.id)
    if (mode === 'wrong' && state.wrongCount <= 0) return false
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
  listState = { mode, query: '', chapter: 'all', limit: 60 }
  const label = mode === 'library' ? '全部题目' : mode === 'wrong' ? '错题本' : '我的收藏'
  setHeader(label, '', { switcher: true })
  setBottomNav(true, mode)
  app.innerHTML = `
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
  updateListResults()
}

function updateListResults() {
  const target = app.querySelector('#list-results')
  if (!target) return
  const items = filteredQuestions(listState.mode)
  const label = listState.mode === 'library' ? '题目' : listState.mode === 'wrong' ? '错题' : '收藏'
  if (!items.length) {
    target.innerHTML = `<section class="empty-state"><div class="empty-icon">${listState.mode === 'wrong' ? '✓' : listState.mode === 'favorite' ? '☆' : '?'}</div><h2>暂无${label}</h2></section>`
    return
  }
  const visible = items.slice(0, listState.limit)
  target.innerHTML = `
    <div class="list-summary"><span>共 ${items.length} 道${label}</span>${listState.mode !== 'library' ? `<button id="practice-filtered" class="tiny-button">练习这 ${items.length} 题</button>` : ''}</div>
    <div class="question-list">${visible.map(questionRow).join('')}</div>
    ${visible.length < items.length ? `<button id="load-more" class="secondary-button full-button">再显示 ${Math.min(60, items.length - visible.length)} 道</button>` : ''}`
  bindQuestionRows(target)
  target.querySelector('#practice-filtered')?.addEventListener('click', () => startSession(items.map(q => q.id), listState.mode === 'wrong' ? '错题重刷' : '收藏练习'))
  target.querySelector('#load-more')?.addEventListener('click', () => { listState.limit += 60; updateListResults() })
}

function questionRow(question) {
  const state = questionState(question.id)
  return `<article class="question-row" data-id="${question.id}">
    <div class="question-row-top">
      <div class="question-meta">${esc(question.chapter)} · ${typeName(question.type)} · 第 ${question.number} 题</div>
      <div class="row-actions">
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

function startFilteredSession(mode) {
  const ids = questionsForBank().filter(question => mode === 'wrong' ? questionState(question.id).wrongCount > 0 : questionState(question.id).favorite).map(question => question.id)
  if (!ids.length) {
    showToast(mode === 'wrong' ? '暂无错题' : '暂无收藏')
    return
  }
  startSession(ids, mode === 'wrong' ? '错题重刷' : '收藏练习')
}

function startSession(ids, title, { displayStart = 1, displayTotal = ids.length } = {}) {
  session = { ids, title, index: 0, displayStart, displayTotal, answer: '', submitted: false, results: [], correct: 0, wrong: 0 }
  saveCurrentSession()
  navigate('practice')
}

function renderPractice() {
  setHeader(session?.title || '练习', '', { back: true })
  setBottomNav(false)
  if (!session || session.index >= session.ids.length) return renderSessionComplete()
  const question = findQuestion(session.ids[session.index])
  const state = questionState(question.id)
  const displayStart = Number(session.displayStart || 1)
  const displayTotal = Number(session.displayTotal || session.ids.length)
  const displayIndex = displayStart + session.index
  const percent = Math.round((displayIndex - 1 + (session.submitted ? 1 : 0)) / displayTotal * 100)
  app.innerHTML = `<section class="practice-shell">
    <div class="practice-progress"><div class="progress-track"><i style="width:${percent}%"></i></div><span>${displayIndex} / ${displayTotal}</span></div>
    <article class="question-card">
      <div class="question-card-header">
        <span class="type-chip">${typeName(question.type)}${question.type === 'multiple' ? ' · 可多选' : ''}</span>
        <div class="row-actions">${state.wrongCount ? `<span class="wrong-badge">累计错 ${state.wrongCount} 次</span>` : ''}<button id="practice-favorite" class="favorite-button ${state.favorite ? 'active' : ''}" type="button">★</button></div>
      </div>
      <h2>${esc(question.stem)}</h2>
      ${answerControls(question)}
      ${session.submitted ? (session.autoAdvancing ? '' : feedbackPanel(question)) : pendingAnswerActions(question)}
    </article>
    ${session.submitted && !session.autoAdvancing ? `<div class="practice-next"><button id="edit-current" class="secondary-button" type="button">编辑此题</button><button id="next-question" class="primary-button" type="button">${session.index + 1 >= session.ids.length ? '查看结果' : '下一题'}</button></div>` : ''}
  </section>`
  bindPractice(question)
}

function pendingAnswerActions(question) {
  if (usesImmediateSubmission(question.type)) {
    return '<div class="answer-actions immediate"><button id="dont-know" class="secondary-button" type="button">不知道</button></div>'
  }
  return '<div class="answer-actions"><button id="dont-know" class="secondary-button" type="button">不知道</button><button id="submit-answer" class="primary-button" type="button">提交答案</button></div>'
}

function answerControls(question) {
  if (question.type === 'fill') {
    const result = session.submitted ? session.results[session.results.length - 1] : null
    const resultClass = result ? (result.correct ? 'correct' : 'wrong') : ''
    return `<input id="fill-answer" class="fill-answer ${resultClass}" type="text" placeholder="输入答案" value="${esc(session.answer)}" ${session.submitted ? 'disabled' : ''}>`
  }
  const options = question.type === 'judge'
    ? [{ key: '对', text: '正确' }, { key: '错', text: '错误' }]
    : question.options
  const selected = question.type === 'multiple' ? normalizeChoice(session.answer).split('') : [session.answer]
  return `<div class="option-list">${options.map(option => {
    const chosen = selected.includes(option.key)
    let resultClass = ''
    if (session.submitted) {
      const correctKeys = question.type === 'judge' ? [String(question.answer).includes('错') ? '错' : '对'] : normalizeChoice(question.answer).split('')
      if (correctKeys.includes(option.key)) resultClass = 'correct'
      else if (chosen) resultClass = 'wrong'
    }
    return `<button class="option ${chosen ? 'selected' : ''} ${resultClass}" data-option="${esc(option.key)}" type="button" ${session.submitted ? 'disabled' : ''}><span class="option-key">${esc(option.key)}</span><span>${esc(option.text)}</span></button>`
  }).join('')}</div>`
}

function feedbackPanel(question) {
  const result = session.results[session.results.length - 1]
  const answerText = question.type === 'single' || question.type === 'multiple'
    ? `${question.answer}（${question.options.filter(option => normalizeChoice(question.answer).includes(option.key)).map(option => option.text).join('；')}）`
    : question.answerRaw || question.answer
  return `<div class="answer-panel ${result.correct ? 'correct' : 'wrong'}"><strong>${result.correct ? '回答正确' : '回答错误'}</strong><p>正确答案：${esc(answerText)}</p>${!result.correct ? `<p>你的答案：${esc(result.userAnswer || '未作答')}</p>` : ''}</div>`
}

function bindPractice(question) {
  app.querySelector('#practice-favorite').addEventListener('click', event => { toggleFavorite(question.id); event.currentTarget.classList.toggle('active', questionState(question.id).favorite) })
  app.querySelectorAll('[data-option]').forEach(button => button.addEventListener('click', () => {
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
  app.querySelector('#fill-answer')?.addEventListener('input', event => { session.answer = event.target.value; saveCurrentSession() })
  app.querySelector('#submit-answer')?.addEventListener('click', () => submitAnswer(question, false, true))
  app.querySelector('#dont-know')?.addEventListener('click', () => submitAnswer(question, true))
  app.querySelector('#next-question')?.addEventListener('click', () => {
    session.index += 1; session.answer = ''; session.submitted = false; saveCurrentSession(); renderPractice(); window.scrollTo(0, 0)
  })
  app.querySelector('#edit-current')?.addEventListener('click', () => openEditor(question.id))
}

function submitAnswer(question, forcedWrong, autoAdvance = false) {
  if (!forcedWrong && !String(session.answer).trim()) return showToast('请先选择或填写答案')
  const correct = !forcedWrong && isCorrectAnswer(question, session.answer)
  const state = questionState(question.id)
  state.attempts += 1
  if (correct) { state.correctCount += 1; session.correct += 1 }
  else { state.wrongCount += 1; session.wrong += 1 }
  session.results.push({ id: question.id, correct, userAnswer: session.answer })
  session.submitted = true
  if (correct && autoAdvance) {
    session.autoAdvancing = true
    saveCurrentSession()
    const activeSession = session
    renderPractice()
    setTimeout(() => {
      if (session !== activeSession || !session.autoAdvancing) return
      session.index += 1
      session.answer = ''
      session.submitted = false
      session.autoAdvancing = false
      saveCurrentSession()
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

backButton.addEventListener('click', () => {
  if (currentView === 'practice') {
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
    if (!Array.isArray(data) || data.length !== 1 || data[0].id !== 'exam0828') throw new Error('Embedded question bank is unavailable')
    banks = new Map(data.map(bank => [bank.id, bank]))
    currentBankId = 'exam0828'
    currentView = 'dashboard'
    saveState()
    render()
  } catch (error) {
    console.error(error)
    app.innerHTML = '<section class="empty-state"><div class="empty-icon">!</div><h2>题库加载失败</h2></section>'
  }
}

boot()

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function isAppleTouchDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

function showInstallHelp() {
  const close = () => { modalRoot.innerHTML = '' }
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal install-guide" role="dialog" aria-modal="true" aria-label="安装到 iPad">
    <div class="modal-head"><div><span class="eyebrow">离线使用</span><h2>安装到 iPad 主屏幕</h2></div><button class="modal-close" type="button" aria-label="关闭">×</button></div>
    <ol>
      <li><span>1</span><div><strong>用 Safari 打开本页</strong><p>iPad 上需要通过 Safari 添加网页应用。</p></div></li>
      <li><span>2</span><div><strong>轻点“共享”按钮</strong><p>它通常位于浏览器工具栏中，是带向上箭头的方框。</p></div></li>
      <li><span>3</span><div><strong>选择“添加到主屏幕”</strong><p>以后可像普通 App 一样全屏启动，题库与进度支持离线使用。</p></div></li>
    </ol>
    <button class="primary-button full-button modal-done" type="button">知道了</button>
  </section></div>`
  modalRoot.querySelector('.modal-close').addEventListener('click', close)
  modalRoot.querySelector('.modal-done').addEventListener('click', close)
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) close() })
}

installButton.addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt()
    await deferredInstallPrompt.userChoice
    deferredInstallPrompt = null
    installButton.classList.add('hidden')
    return
  }
  showInstallHelp()
})

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault()
  deferredInstallPrompt = event
  if (!isStandalone()) installButton.classList.remove('hidden')
})

window.addEventListener('appinstalled', () => installButton.classList.add('hidden'))

if (isAppleTouchDevice() && !isStandalone()) installButton.classList.remove('hidden')

function syncConnectionStatus() {
  const offline = !navigator.onLine
  connectionStatus.textContent = offline ? '当前离线' : '离线可用'
  connectionStatus.classList.toggle('offline', offline)
  connectionStatus.classList.toggle('hidden', !offline)
}

window.addEventListener('online', () => {
  syncConnectionStatus()
  showToast('已恢复网络连接')
})
window.addEventListener('offline', () => {
  syncConnectionStatus()
  showToast('已进入离线模式')
})
syncConnectionStatus()

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => console.warn('Service worker registration failed', error))
  })
}
