const {
  EXAM_TYPE_NAMES, DEFAULT_EXAM_POINTS, defaultExamPlan, examQuestionPools, normalizeChoice: normalizeExamChoice, normalizeExamSections,
  prepareExamSections, createExamPaper, deriveExamSections, gradeExamPaper, formatExamScore
} = globalThis.QuizCore

const MAX_EXAM_PRESETS = 10
let exam = null
let examReviewIndex = 0
let examPlanDrafts = {}

function availableExamPools(bank = rawBank()) {
  return bank ? examQuestionPools(questionsForBank(bank)).filter(pool => pool.questions.length) : []
}

function bankExamPresets(bankId = currentBankId) {
  const list = bankId ? examPresets[bankId] : null
  return Array.isArray(list)
    ? list.filter(preset => preset && typeof preset.id === 'string' && typeof preset.name === 'string' && Array.isArray(preset.sections))
    : []
}

function draftFromSections(pools, sections = null) {
  const defaults = new Map(defaultExamPlan(pools).map(section => [section.type, section]))
  const saved = new Map((sections || []).map(section => [section.type, section]))
  return {
    sections: pools.map(pool => {
      const found = saved.get(pool.type)
      const fallback = defaults.get(pool.type) || { count: Math.min(20, pool.questions.length), points: 1 }
      return {
        type: pool.type,
        enabled: sections ? Boolean(found) : true,
        count: found && Number(found.count) > 0 ? Number(found.count) : fallback.count,
        points: found && Number(found.points) > 0 ? Number(found.points) : fallback.points
      }
    })
  }
}

function examDraftFor(bank) {
  const pools = availableExamPools(bank)
  const types = new Set(pools.map(pool => pool.type))
  let draft = examPlanDrafts[bank.id]
  if (!draft || !Array.isArray(draft.sections) || draft.sections.some(section => !types.has(section.type))) {
    const saved = examSessions[bank.id]
    const sections = saved && !saved.report && Array.isArray(saved.sections) && saved.sections.length ? saved.sections : null
    draft = draftFromSections(pools, sections)
    examPlanDrafts[bank.id] = draft
  }
  for (const pool of pools) {
    if (draft.sections.some(section => section.type === pool.type)) continue
    const fallback = defaultExamPlan(pools).find(section => section.type === pool.type)
    draft.sections.push({ type: pool.type, enabled: false, count: fallback?.count || 1, points: fallback?.points || 1 })
  }
  return draft
}

function examPlanFromDraft(bankId = currentBankId) {
  const draft = examPlanDrafts[bankId]
  if (!draft) return undefined
  return draft.sections.filter(section => section.enabled).map(({ type, count, points }) => ({ type, count, points }))
}

function examPlanTotals(sections) {
  return sections.reduce((totals, section) => {
    const count = Math.max(0, Number(section.count) || 0)
    const points = Math.max(0, Number(section.points) || 0)
    totals.count += count
    totals.score += count * points
    return totals
  }, { count: 0, score: 0 })
}

function ensureExamSections(paper) {
  if (!paper) return paper
  const paperTypes = new Set((paper.questions || []).map(question => question.type))
  const sections = (Array.isArray(paper.sections) ? paper.sections : []).filter(section => section && paperTypes.has(section.type))
  const covered = new Set(sections.map(section => section.type))
  for (const derived of deriveExamSections(paper.questions)) {
    if (!covered.has(derived.type)) sections.push(derived)
  }
  paper.sections = (sections.length ? sections : deriveExamSections(paper.questions)).map((section, index) => ({
    type: section.type,
    count: Number(section.count) || 0,
    points: Number(section.points) > 0 ? Number(section.points) : (DEFAULT_EXAM_POINTS[section.type] || 1),
    title: `第${['一', '二', '三', '四'][index] || index + 1}部分 · ${EXAM_TYPE_NAMES[section.type] || '题目'}`
  }))
  return paper
}

function examMaxScore(paper = exam) {
  if (!paper) return 0
  ensureExamSections(paper)
  return examPlanTotals(paper.sections).score
}

function examPlanRow(pool, section) {
  const subtotal = section.enabled ? (Number(section.count) || 0) * (Number(section.points) || 0) : 0
  return `<div class="exam-plan-row ${section.enabled ? '' : 'disabled'}" data-exam-plan-type="${pool.type}">
    <label class="exam-plan-toggle">
      <input type="checkbox" data-plan-enabled ${section.enabled ? 'checked' : ''}>
      <span><strong>${pool.name}</strong><small>题库共 ${pool.questions.length} 题可选</small></span>
    </label>
    <div class="exam-plan-fields">
      <label>抽题数<input type="number" inputmode="numeric" min="1" max="${pool.questions.length}" step="1" value="${esc(section.count)}" data-plan-count aria-label="${pool.name}抽题数" ${section.enabled ? '' : 'disabled'}></label>
      <label>每题分值<input type="number" inputmode="decimal" min="0.5" max="100" step="0.5" value="${esc(section.points)}" data-plan-points aria-label="${pool.name}每题分值" ${section.enabled ? '' : 'disabled'}></label>
      <span class="exam-plan-subtotal" data-plan-subtotal>${formatExamScore(subtotal)} 分</span>
    </div>
  </div>`
}

function examPresetSummary(preset) {
  const sections = normalizeExamSections(preset.sections)
  if (!sections.length) return '方案已失效，可删除后重新保存'
  const totals = examPlanTotals(sections)
  return `${sections.map(section => `${EXAM_TYPE_NAMES[section.type]} ${section.count} 题 × ${formatExamScore(section.points)} 分`).join(' · ')} · 共 ${formatExamScore(totals.count)} 题，${formatExamScore(totals.score)} 分`
}

function defaultExamPresetName(sections) {
  return sections.map(section => `${EXAM_TYPE_NAMES[section.type]}${section.count}`).join('·').slice(0, 24) || '我的考试方案'
}

function renderExamSetup() {
  const bank = rawBank()
  if (!bank) return navigate('home', { push: false })
  setHeader('模拟考试', '', { back: true })
  setBottomNav(false)
  const pools = availableExamPools(bank)
  if (!pools.length) {
    app.innerHTML = `<section class="exam-setup question-card">
      <span class="type-chip">随机组卷 · 不限时</span>
      <h1>模拟考试</h1>
      <p>当前题库：<strong>${esc(bank.title)}</strong></p>
      <p class="exam-unavailable">当前题库没有可用于考试的题目。</p>
      <button id="exam-back-dashboard" class="secondary-button full-button" type="button">返回题库主页</button>
    </section>`
    app.querySelector('#exam-back-dashboard').addEventListener('click', () => { historyStack = []; navigate('dashboard', { push: false }) })
    return
  }

  const draft = examDraftFor(bank)
  const prepared = prepareExamSections(pools, examPlanFromDraft(bank.id))
  const totals = examPlanTotals(prepared.sections)
  const saved = examSessions[bank.id] ? ensureExamSections(examSessions[bank.id]) : null
  const presets = bankExamPresets(bank.id)
  const savedAction = saved ? `<button id="open-saved-exam" class="primary-button full-button" type="button">${saved.report ? `查看上次成绩（${formatExamScore(saved.report.score)} / ${formatExamScore(saved.report.totalScore)} 分）` : `继续考试（已答 ${examAnsweredCount(saved)} / ${saved.questions.length} 题）`}</button>` : ''
  const startAction = !saved || saved.report
    ? `<button id="start-exam" class="${saved ? 'secondary' : 'primary'}-button full-button" type="button" ${prepared.errors.length ? 'disabled' : ''}>${saved ? '重新组卷并开始' : '开始考试'}</button>`
    : ''

  app.innerHTML = `<section class="exam-setup question-card">
    <span class="type-chip">随机组卷 · 不限时</span>
    <h1>模拟考试</h1>
    <p class="exam-total">已选 <strong id="exam-plan-count">${formatExamScore(totals.count)}</strong> 题，满分 <strong id="exam-plan-score">${formatExamScore(totals.score)}</strong> 分</p>
    <p>当前题库：<strong>${esc(bank.title)}</strong></p>
    <div class="exam-plan-head"><h2>选择题型、题量与分值</h2><p>勾选要考的题型；只会列出当前题库已有的题型。</p></div>
    <div class="exam-plan">${pools.map(pool => examPlanRow(pool, draft.sections.find(section => section.type === pool.type))).join('')}</div>
    <div id="exam-plan-errors" class="exam-plan-errors" aria-live="polite">${prepared.errors.map(error => `<p class="exam-plan-error">${esc(error)}</p>`).join('')}</div>
    <section class="exam-presets" aria-labelledby="exam-presets-title">
      <div class="exam-presets-head"><div><h2 id="exam-presets-title">考试方案预设</h2><p>只对当前题库生效，下次可一键套用。</p></div><span>${presets.length} / ${MAX_EXAM_PRESETS}</span></div>
      <div class="exam-preset-list">
        ${presets.length ? presets.map(preset => `<div class="exam-preset-row">
          <button class="exam-preset-apply" data-apply-preset="${esc(preset.id)}" type="button"><strong>${esc(preset.name)}</strong><span>${esc(examPresetSummary(preset))}</span></button>
          <button class="exam-preset-delete" data-delete-preset="${esc(preset.id)}" type="button" aria-label="删除预设 ${esc(preset.name)}">×</button>
        </div>`).join('') : '<p class="exam-preset-empty">还没有预设。设置好题型、题量和分值后，可以保存下来下次直接用。</p>'}
      </div>
      <button id="save-exam-preset" class="secondary-button full-button" type="button" ${prepared.errors.length ? 'disabled' : ''}>保存当前方案为预设</button>
    </section>
    <div id="exam-source-actions">
      ${savedAction}
      ${startAction}
      ${saved && !saved.report ? '<p class="exam-note">当前有未完成的考试。如需重新组卷，请先继续完成或直接交卷。</p>' : ''}
    </div>
    <p class="exam-note">只从当前题库随机抽题，同一试卷不重复。交卷前可修改答案，交卷后统一计分；未答题得 0 分并计入错题。</p>
    <p class="exam-note">填空题按题库答案整题判分，答对得所选分值，答错或未答得 0 分。答题进度自动保存在当前浏览器，每个题库保留最近一次考试及错题回顾。</p>
  </section>`
  bindExamSetup()
  refreshExamPlanSummary()
}

function bindExamSetup() {
  app.querySelectorAll('[data-exam-plan-type]').forEach(row => {
    const type = row.dataset.examPlanType
    const toggle = row.querySelector('[data-plan-enabled]')
    const countInput = row.querySelector('[data-plan-count]')
    const pointsInput = row.querySelector('[data-plan-points]')
    toggle.addEventListener('change', () => {
      updateExamPlanSection(type, { enabled: toggle.checked })
      countInput.disabled = !toggle.checked
      pointsInput.disabled = !toggle.checked
      row.classList.toggle('disabled', !toggle.checked)
      refreshExamPlanSummary()
    })
    countInput.addEventListener('input', () => { updateExamPlanSection(type, { count: countInput.value }); refreshExamPlanSummary() })
    pointsInput.addEventListener('input', () => { updateExamPlanSection(type, { points: pointsInput.value }); refreshExamPlanSummary() })
  })
  app.querySelector('#start-exam')?.addEventListener('click', () => startExam(examPlanFromDraft(currentBankId)))
  app.querySelector('#open-saved-exam')?.addEventListener('click', openSavedExam)
  app.querySelector('#save-exam-preset')?.addEventListener('click', openExamPresetDialog)
  app.querySelectorAll('[data-apply-preset]').forEach(button => button.addEventListener('click', () => applyExamPreset(button.dataset.applyPreset)))
  app.querySelectorAll('[data-delete-preset]').forEach(button => button.addEventListener('click', () => deleteExamPreset(button.dataset.deletePreset)))
}

function updateExamPlanSection(type, patch) {
  const draft = examPlanDrafts[currentBankId]
  const section = draft?.sections.find(item => item.type === type)
  if (section) Object.assign(section, patch)
}

function refreshExamPlanSummary() {
  const draft = examPlanDrafts[currentBankId]
  if (!draft) return
  let count = 0
  let score = 0
  for (const section of draft.sections) {
    const sectionCount = section.enabled ? Math.max(0, Number(section.count) || 0) : 0
    const sectionPoints = section.enabled ? Math.max(0, Number(section.points) || 0) : 0
    count += sectionCount
    score += sectionCount * sectionPoints
    const subtotal = app.querySelector(`[data-exam-plan-type="${section.type}"]`)?.querySelector('[data-plan-subtotal]')
    if (subtotal) subtotal.textContent = `${formatExamScore(sectionCount * sectionPoints)} 分`
  }
  const countNode = app.querySelector('#exam-plan-count')
  const scoreNode = app.querySelector('#exam-plan-score')
  if (countNode) countNode.textContent = formatExamScore(count)
  if (scoreNode) scoreNode.textContent = formatExamScore(score)

  const prepared = prepareExamSections(availableExamPools(), examPlanFromDraft(currentBankId))
  const errorNode = app.querySelector('#exam-plan-errors')
  if (errorNode) errorNode.innerHTML = prepared.errors.map(error => `<p class="exam-plan-error">${esc(error)}</p>`).join('')
  const startButton = app.querySelector('#start-exam')
  if (startButton) startButton.disabled = prepared.errors.length > 0
  const saveButton = app.querySelector('#save-exam-preset')
  if (saveButton) saveButton.disabled = prepared.errors.length > 0
}

function examAnsweredCount(paper = exam) {
  return (paper?.answers || []).filter(answer => String(answer).trim()).length
}

function startExam(plan = examPlanFromDraft(currentBankId)) {
  const bank = rawBank()
  if (!bank) return
  const bankId = bank.id
  if (examSessions[bankId] && !examSessions[bankId].report) return openSavedExam()
  const pools = availableExamPools(bank)
  const prepared = prepareExamSections(pools, plan)
  if (prepared.errors.length) return showToast(prepared.errors[0])
  let questions
  try { questions = createExamPaper(questionsForBank(bank), prepared.sections) }
  catch (error) { return showToast(error.message) }
  saveCurrentSession()
  session = null
  exam = { bankId, sections: prepared.sections, questions, answers: Array(questions.length).fill(''), index: 0, report: null }
  examSessions[bankId] = exam
  examPlanDrafts[bankId] = draftFromSections(pools, prepared.sections)
  saveState()
  historyStack = []
  navigate('exam', { push: false })
}

function openSavedExam() {
  const saved = ensureExamSections(examSessions[currentBankId])
  if (!saved) return
  saveCurrentSession()
  session = null
  exam = saved
  saveState()
  historyStack = []
  navigate(exam.report ? 'exam-result' : 'exam', { push: false })
}

function moveExamQuestion(index) {
  if (!exam || exam.report || !Number.isInteger(index) || index < 0 || index >= exam.questions.length) return
  exam.index = index
  saveState()
  renderExam()
  window.scrollTo(0, 0)
  app.querySelector('.question-card h2')?.focus()
}

function saveExamAnswer(answer) {
  if (!exam || exam.report) return
  exam.answers[exam.index] = String(answer)
  saveState()
  app.querySelector('#exam-answered').textContent = `已答 ${examAnsweredCount()} / ${exam.questions.length} 题`
  const number = app.querySelector(`[data-exam-index="${exam.index}"]`)
  const answered = Boolean(String(answer).trim())
  number.classList.toggle('answered', answered)
  number.setAttribute('aria-label', `第 ${exam.index + 1} 题，${answered ? '已答' : '未答'}`)
}

function renderExam() {
  if (!exam) return navigate('exam-setup', { push: false })
  if (exam.report) return navigate('exam-result', { push: false })
  ensureExamSections(exam)
  setHeader('模拟考试', rawBank().title, { back: true })
  setBottomNav(false)
  const question = exam.questions[exam.index]
  const section = exam.sections.find(item => item.type === question.type) || { title: typeName(question.type), points: 1 }
  const answer = exam.answers[exam.index]
  const total = exam.questions.length
  const maxScore = examMaxScore(exam)
  app.innerHTML = `<section class="practice-shell exam-shell">
    <div class="exam-status"><strong id="exam-answered">已答 ${examAnsweredCount()} / ${total} 题</strong><span>满分 ${formatExamScore(maxScore)} 分 · 交卷后评分</span></div>
    <article class="question-card">
      <div class="question-card-header"><span class="type-chip">${esc(section.title)} · 每题 ${formatExamScore(section.points)} 分${question.type === 'multiple' ? ' · 可多选' : ''}</span><span>${exam.index + 1} / ${total}</span></div>
      <h2 tabindex="-1">${esc(question.stem)}</h2>
      ${answerControls(question, { answer, submitted: false })}
      ${question.type === 'fill' ? '<p class="exam-note">多个空请按顺序填写完整答案。</p>' : ''}
      <div class="exam-question-actions"><button id="clear-exam-answer" class="tiny-button" type="button">清空本题答案</button></div>
    </article>
    <div class="practice-next"><button id="exam-previous" class="secondary-button" type="button" ${exam.index === 0 ? 'disabled' : ''}>上一题</button><button id="exam-next" class="primary-button" type="button">${exam.index === total - 1 ? '检查并交卷' : '下一题'}</button></div>
    <details class="exam-answer-sheet" open><summary>答题卡 <small>绿色为已答，点击题号可检查或补答</small></summary>
      ${exam.sections.map(item => `<div class="exam-sheet-section"><h3>${esc(item.title)}</h3><div class="exam-number-grid">${exam.questions.map((entry, index) => {
        if (entry.type !== item.type) return ''
        const answered = Boolean(exam.answers[index].trim())
        return `<button data-exam-index="${index}" class="${answered ? 'answered' : ''}" type="button" ${index === exam.index ? 'aria-current="step"' : ''} aria-label="第 ${index + 1} 题，${answered ? '已答' : '未答'}">${index + 1}</button>`
      }).join('')}</div></div>`).join('')}
    </details>
    <div class="practice-next"><button id="pause-exam" class="secondary-button" type="button">保存并退出</button><button id="submit-exam" class="primary-button" type="button">交卷评分</button></div>
  </section>`
  const selectedKeys = question.type === 'multiple' ? normalizeExamChoice(answer).split('') : [answer]
  app.querySelectorAll('[data-option]').forEach(button => {
    button.setAttribute('aria-pressed', String(selectedKeys.includes(button.dataset.option)))
    button.addEventListener('click', () => {
      if (question.type === 'multiple') {
        const values = new Set(normalizeExamChoice(exam.answers[exam.index]).split('').filter(Boolean))
        if (values.has(button.dataset.option)) values.delete(button.dataset.option)
        else values.add(button.dataset.option)
        saveExamAnswer([...values].sort().join(''))
      } else {
        saveExamAnswer(button.dataset.option)
      }
      const current = question.type === 'multiple' ? normalizeExamChoice(exam.answers[exam.index]).split('') : [exam.answers[exam.index]]
      app.querySelectorAll('[data-option]').forEach(option => {
        const selected = current.includes(option.dataset.option)
        option.classList.toggle('selected', selected)
        option.setAttribute('aria-pressed', String(selected))
      })
    })
  })
  app.querySelector('#fill-answer')?.setAttribute('aria-label', '本题填空答案')
  app.querySelector('#fill-answer')?.addEventListener('input', event => saveExamAnswer(event.target.value))
  app.querySelector('#clear-exam-answer').addEventListener('click', () => { saveExamAnswer(''); renderExam() })
  app.querySelector('#exam-previous').addEventListener('click', () => moveExamQuestion(exam.index - 1))
  app.querySelector('#exam-next').addEventListener('click', () => exam.index === total - 1 ? confirmExamSubmission() : moveExamQuestion(exam.index + 1))
  app.querySelectorAll('[data-exam-index]').forEach(button => button.addEventListener('click', () => moveExamQuestion(Number(button.dataset.examIndex))))
  app.querySelector('#submit-exam').addEventListener('click', confirmExamSubmission)
  app.querySelector('#pause-exam').addEventListener('click', leaveExamView)
}

function confirmExamSubmission() {
  if (!exam || exam.report) return
  const total = exam.questions.length
  const unanswered = total - examAnsweredCount()
  const close = () => { modalRoot.innerHTML = ''; app.querySelector('#submit-exam')?.focus() }
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="exam-submit-title" aria-describedby="exam-submit-copy">
    <div class="modal-head"><h2 id="exam-submit-title">确认交卷</h2></div>
    <p id="exam-submit-copy">${unanswered ? `还有 ${unanswered} 题未作答，未答题按 0 分计入错题。` : `全部 ${total} 题已作答。`}交卷后将显示得分，答案无法再修改。</p>
    <div class="modal-actions"><button id="cancel-exam-submit" class="secondary-button" type="button">继续检查</button><button id="confirm-exam-submit" class="primary-button" type="button">确认交卷</button></div>
  </section></div>`
  const cancel = modalRoot.querySelector('#cancel-exam-submit')
  const submit = modalRoot.querySelector('#confirm-exam-submit')
  cancel.addEventListener('click', close)
  submit.addEventListener('click', () => { modalRoot.innerHTML = ''; submitExam() })
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) close() })
  modalRoot.querySelector('.modal').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if (event.key === 'Tab' && event.shiftKey && document.activeElement === cancel) { event.preventDefault(); submit.focus() }
    else if (event.key === 'Tab' && !event.shiftKey && document.activeElement === submit) { event.preventDefault(); cancel.focus() }
  })
  cancel.focus()
}

function submitExam() {
  if (!exam || exam.report) return
  ensureExamSections(exam)
  exam.report = gradeExamPaper(exam.questions, exam.answers, exam.sections)
  for (const result of exam.report.results) progress[result.id] = recordQuestionResult(questionState(result.id), result.correct)
  saveState()
  navigate('exam-result', { push: false })
}

function renderExamResult() {
  if (!exam?.report) return navigate('exam-setup', { push: false })
  setHeader('模拟考试成绩', rawBank().title, { back: true })
  setBottomNav(false)
  const report = exam.report
  app.innerHTML = `<section class="session-complete exam-result">
    <div class="score-ring"><div><strong>${formatExamScore(report.score)}</strong><small>/ ${formatExamScore(report.totalScore)} 分</small></div></div>
    <h1>本次考试完成</h1><p>答对 ${report.correct} 题，答错 ${report.wrong} 题${report.unanswered ? `（含未答 ${report.unanswered} 题）` : ''}</p>
    <div class="exam-sections">${report.sections.map(section => `<div><strong>${esc(section.title)}</strong><span>答对 ${section.correct} / ${section.count} 题 · ${formatExamScore(section.score)} / ${formatExamScore(section.count * section.points)} 分</span></div>`).join('')}</div>
    <p class="exam-note">${report.wrong ? '本次错题已加入错题本，可逐题回顾你的答案与正确答案。' : '本次考试全部答对，没有错题。'}</p>
    <div class="complete-actions">
      ${report.wrong ? `<button id="review-exam-wrong" class="primary-button" type="button">回顾本次错题（${report.wrong} 题）</button>` : ''}
      <button id="exam-return-setup" class="secondary-button" type="button">返回模拟考试</button>
      <button id="exam-dashboard" class="secondary-button" type="button">返回题库主页</button>
    </div>
  </section>`
  app.querySelector('#review-exam-wrong')?.addEventListener('click', () => { examReviewIndex = 0; navigate('exam-review', { push: false }) })
  app.querySelector('#exam-return-setup').addEventListener('click', () => navigate('exam-setup', { push: false }))
  app.querySelector('#exam-dashboard').addEventListener('click', () => { historyStack = []; navigate('dashboard', { push: false }) })
}

function renderExamReview() {
  if (!exam?.report) return navigate('exam-setup', { push: false })
  const wrong = exam.report.results.filter(result => !result.correct)
  if (!wrong.length) return navigate('exam-result', { push: false })
  const result = wrong[examReviewIndex]
  const question = exam.questions[result.index]
  const view = { answer: result.userAnswer, result, submitted: true, reviewing: true }
  setHeader('本次考试错题', `${examReviewIndex + 1} / ${wrong.length}`, { back: true })
  setBottomNav(false)
  app.innerHTML = `<section class="practice-shell exam-shell">
    <div class="exam-status"><strong>错题 ${examReviewIndex + 1} / ${wrong.length}</strong><span>本次成绩 ${formatExamScore(exam.report.score)} / ${formatExamScore(exam.report.totalScore)} 分</span></div>
    <article class="question-card"><span class="type-chip">${typeName(question.type)} · 试卷第 ${result.index + 1} 题 · ${formatExamScore(result.score)} / ${formatExamScore(result.points)} 分</span>
      <h2 tabindex="-1">${esc(question.stem)}</h2>${answerControls(question, view)}${feedbackPanel(question, view)}
    </article>
    <div class="practice-next"><button id="exam-review-previous" class="secondary-button" type="button" ${examReviewIndex === 0 ? 'disabled' : ''}>上一道错题</button><button id="exam-review-next" class="primary-button" type="button">${examReviewIndex + 1 === wrong.length ? '返回成绩' : '下一道错题'}</button></div>
    <button id="exam-review-result" class="secondary-button full-button" type="button">返回成绩</button>
  </section>`
  app.querySelector('#exam-review-previous').addEventListener('click', () => { if (examReviewIndex > 0) { examReviewIndex -= 1; renderExamReview(); window.scrollTo(0, 0) } })
  app.querySelector('#exam-review-next').addEventListener('click', () => {
    if (examReviewIndex + 1 === wrong.length) return navigate('exam-result', { push: false })
    examReviewIndex += 1
    renderExamReview()
    window.scrollTo(0, 0)
  })
  app.querySelector('#exam-review-result').addEventListener('click', () => navigate('exam-result', { push: false }))
}

function focusExamSetupPrimary() {
  const target = app.querySelector('#start-exam') || app.querySelector('#open-saved-exam') || app.querySelector('[data-plan-enabled]')
  target?.focus()
}

function openExamPresetDialog() {
  const bank = rawBank()
  if (!bank) return
  const prepared = prepareExamSections(availableExamPools(bank), examPlanFromDraft(bank.id))
  if (prepared.errors.length) return showToast(prepared.errors[0])
  const restoreFocus = document.activeElement
  const close = (restore = true) => {
    modalRoot.innerHTML = ''
    if (restore) restoreFocus?.focus?.()
  }
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="exam-preset-title" aria-describedby="exam-preset-copy">
    <div class="modal-head"><h2 id="exam-preset-title">保存考试方案</h2><button id="close-exam-preset" class="modal-close" type="button" aria-label="关闭">×</button></div>
    <div class="form-group"><label for="exam-preset-name">预设名称</label><input id="exam-preset-name" maxlength="24" value="${esc(defaultExamPresetName(prepared.sections))}"></div>
    <p id="exam-preset-copy" class="exam-note">预设只对当前题库生效，同名预设会覆盖更新；下次进入模拟考试时可一键套用。</p>
    <div class="modal-actions"><button id="cancel-exam-preset" class="secondary-button" type="button">取消</button><button id="confirm-exam-preset" class="primary-button" type="button">保存</button></div>
  </section></div>`
  const input = modalRoot.querySelector('#exam-preset-name')
  const closeButton = modalRoot.querySelector('#close-exam-preset')
  const cancel = modalRoot.querySelector('#cancel-exam-preset')
  const confirm = modalRoot.querySelector('#confirm-exam-preset')
  const save = () => {
    if (!saveExamPreset(input.value)) return
    close(false)
    focusExamSetupPrimary()
  }
  closeButton.addEventListener('click', close)
  cancel.addEventListener('click', close)
  confirm.addEventListener('click', save)
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); save() } })
  modalRoot.querySelector('.modal-backdrop').addEventListener('click', event => { if (event.target === event.currentTarget) close() })
  modalRoot.querySelector('.modal').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); close() }
    if (event.key === 'Tab' && event.shiftKey && document.activeElement === closeButton) { event.preventDefault(); confirm.focus() }
    else if (event.key === 'Tab' && !event.shiftKey && document.activeElement === confirm) { event.preventDefault(); closeButton.focus() }
  })
  input.focus()
  input.select?.()
}

function saveExamPreset(name) {
  const bank = rawBank()
  if (!bank) return false
  const trimmed = String(name || '').trim().slice(0, 24)
  if (!trimmed) { showToast('请输入预设名称'); return false }
  const prepared = prepareExamSections(availableExamPools(bank), examPlanFromDraft(bank.id))
  if (prepared.errors.length) { showToast(prepared.errors[0]); return false }
  const list = [...bankExamPresets(bank.id)]
  const sections = prepared.sections.map(({ type, count, points }) => ({ type, count, points }))
  const existing = list.find(preset => preset.name === trimmed)
  if (existing) existing.sections = sections
  else {
    if (list.length >= MAX_EXAM_PRESETS) { showToast(`最多保存 ${MAX_EXAM_PRESETS} 个预设`); return false }
    list.push({ id: `exam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: trimmed, sections })
  }
  examPresets[bank.id] = list
  saveState()
  renderExamSetup()
  showToast(existing ? '预设已更新' : '预设已保存')
  return true
}

function applyExamPreset(id) {
  const bank = rawBank()
  if (!bank) return
  const preset = bankExamPresets(bank.id).find(item => item.id === id)
  if (!preset) return
  const pools = availableExamPools(bank)
  const availableTypes = new Set(pools.map(pool => pool.type))
  const applied = preset.sections.filter(section => availableTypes.has(section.type))
  if (!applied.length) return showToast('该预设的题型已不在当前题库')
  const draft = draftFromSections(pools, applied)
  let clamped = false
  for (const section of draft.sections) {
    if (!section.enabled) continue
    const pool = pools.find(item => item.type === section.type)
    if (pool && Number(section.count) > pool.questions.length) {
      section.count = pool.questions.length
      clamped = true
    }
  }
  examPlanDrafts[bank.id] = draft
  renderExamSetup()
  focusExamSetupPrimary()
  showToast(clamped ? '已套用预设，题量已按题库现有题数调整' : '已套用预设')
}

function deleteExamPreset(id) {
  const bank = rawBank()
  if (!bank) return
  const list = bankExamPresets(bank.id).filter(preset => preset.id !== id)
  examPresets[bank.id] = list
  saveState()
  renderExamSetup()
  app.querySelector('#save-exam-preset')?.focus()
  showToast('预设已删除')
}

function leaveExamView() {
  if (currentView === 'exam-review') return navigate('exam-result', { push: false })
  if (currentView !== 'exam-setup') {
    saveState()
    return navigate('exam-setup', { push: false })
  }
  historyStack = []
  navigate('dashboard', { push: false })
}
