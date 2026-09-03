const { EXAM_SECTIONS, examQuestionPools, createExamPaper, gradeExamPaper } = globalThis.QuizCore
let exam = null
let examReviewIndex = 0

function renderExamSetup() {
  const bank = rawBank()
  if (!bank) return navigate('home', { push: false })
  if (bank.id === 'youththeory2') return navigate('dashboard', { push: false })
  setHeader('模拟安规考试', '', { back: true })
  setBottomNav(false)
  const missing = examQuestionPools(questionsForBank(bank)).filter(pool => pool.questions.length < pool.count)
  const saved = examSessions[bank.id]
  app.innerHTML = `<section class="exam-setup question-card">
    <span class="type-chip">随机组卷 · 共 65 题</span>
    <h1>模拟安规考试</h1>
    <p class="exam-total">满分 <strong>85</strong> 分</p>
    <div class="exam-sections">${EXAM_SECTIONS.map(section => `<div><strong>${section.title}</strong><span>${section.count} 题 × ${section.points} 分，共 ${section.count * section.points} 分</span></div>`).join('')}</div>
    <p>当前题库：<strong>${esc(bank.title)}</strong></p>
    <p class="exam-note">仅从当前题库随机抽题，同一试卷不重复。不限时，交卷前可修改答案，交卷后统一计分。填空题按题库答案整题判分，答对得 2 分，答错或未答得 0 分。</p>
    <p class="exam-note">答题进度自动保存在当前浏览器。每个题库保留最近一次考试及错题回顾。</p>
    <div id="exam-source-actions">
      ${missing.length ? `<p class="exam-unavailable">当前题库无法组成完整试卷：${missing.map(pool => `${typeName(pool.type)}需 ${pool.count} 题，现有 ${pool.questions.length} 题`).join('；')}。</p>` : ''}
      ${saved ? `<button id="open-saved-exam" class="primary-button full-button" type="button">${saved.report ? `查看上次成绩与错题（${saved.report.score} / 85 分）` : `继续考试（已答 ${examAnsweredCount(saved)} / 65 题）`}</button>` : ''}
      ${!missing.length && (!saved || saved.report) ? `<button id="start-exam" class="${saved ? 'secondary' : 'primary'}-button full-button" type="button">${saved ? '重新随机组卷' : '开始考试'}</button>` : ''}
    </div>
  </section>`
  app.querySelector('#start-exam')?.addEventListener('click', startExam)
  app.querySelector('#open-saved-exam')?.addEventListener('click', openSavedExam)
}

function examAnsweredCount(paper = exam) {
  return paper.answers.filter(answer => String(answer).trim()).length
}

function startExam() {
  const bank = rawBank()
  if (!bank || bank.id === 'youththeory2') return
  const bankId = bank.id
  if (examSessions[bankId] && !examSessions[bankId].report) return openSavedExam()
  let questions
  try { questions = createExamPaper(questionsForBank(bank)) }
  catch (error) { return showToast(error.message) }
  saveCurrentSession()
  session = null
  exam = { bankId, questions, answers: Array(questions.length).fill(''), index: 0, report: null }
  examSessions[bankId] = exam
  saveState()
  historyStack = []
  navigate('exam', { push: false })
}

function openSavedExam() {
  const saved = examSessions[currentBankId]
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
  app.querySelector('#exam-answered').textContent = `已答 ${examAnsweredCount()} / 65 题`
  const number = app.querySelector(`[data-exam-index="${exam.index}"]`)
  const answered = Boolean(String(answer).trim())
  number.classList.toggle('answered', answered)
  number.setAttribute('aria-label', `第 ${exam.index + 1} 题，${answered ? '已答' : '未答'}`)
}

function renderExam() {
  if (!exam) return navigate('exam-setup', { push: false })
  if (exam.report) return navigate('exam-result', { push: false })
  setHeader('模拟安规考试', rawBank().title, { back: true })
  setBottomNav(false)
  const question = exam.questions[exam.index]
  const section = EXAM_SECTIONS.find(item => item.type === question.type)
  const answer = exam.answers[exam.index]
  app.innerHTML = `<section class="practice-shell exam-shell">
    <div class="exam-status"><strong id="exam-answered">已答 ${examAnsweredCount()} / 65 题</strong><span>满分 85 分 · 交卷后评分</span></div>
    <article class="question-card">
      <div class="question-card-header"><span class="type-chip">${section.title} · 每题 ${section.points} 分</span><span>${exam.index + 1} / 65</span></div>
      <h2 tabindex="-1">${esc(question.stem)}</h2>
      ${answerControls(question, { answer, submitted: false })}
      ${question.type === 'fill' ? '<p class="exam-note">多个空请按顺序填写完整答案。</p>' : ''}
      <div class="exam-question-actions"><button id="clear-exam-answer" class="tiny-button" type="button">清空本题答案</button></div>
    </article>
    <div class="practice-next"><button id="exam-previous" class="secondary-button" type="button" ${exam.index === 0 ? 'disabled' : ''}>上一题</button><button id="exam-next" class="primary-button" type="button">${exam.index === 64 ? '检查并交卷' : '下一题'}</button></div>
    <details class="exam-answer-sheet" open><summary>答题卡 <small>绿色为已答，点击题号可检查或补答</small></summary>
      ${EXAM_SECTIONS.map(item => `<div class="exam-sheet-section"><h3>${item.title}</h3><div class="exam-number-grid">${exam.questions.map((entry, index) => {
        if (entry.type !== item.type) return ''
        const answered = Boolean(exam.answers[index].trim())
        return `<button data-exam-index="${index}" class="${answered ? 'answered' : ''}" type="button" ${index === exam.index ? 'aria-current="step"' : ''} aria-label="第 ${index + 1} 题，${answered ? '已答' : '未答'}">${index + 1}</button>`
      }).join('')}</div></div>`).join('')}
    </details>
    <div class="practice-next"><button id="pause-exam" class="secondary-button" type="button">保存并退出</button><button id="submit-exam" class="primary-button" type="button">交卷评分</button></div>
  </section>`
  app.querySelectorAll('[data-option]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.option === answer))
    button.addEventListener('click', () => {
      saveExamAnswer(button.dataset.option)
      app.querySelectorAll('[data-option]').forEach(option => {
        const selected = option.dataset.option === exam.answers[exam.index]
        option.classList.toggle('selected', selected)
        option.setAttribute('aria-pressed', String(selected))
      })
    })
  })
  app.querySelector('#fill-answer')?.setAttribute('aria-label', '本题填空答案')
  app.querySelector('#fill-answer')?.addEventListener('input', event => saveExamAnswer(event.target.value))
  app.querySelector('#clear-exam-answer').addEventListener('click', () => { saveExamAnswer(''); renderExam() })
  app.querySelector('#exam-previous').addEventListener('click', () => moveExamQuestion(exam.index - 1))
  app.querySelector('#exam-next').addEventListener('click', () => exam.index === 64 ? confirmExamSubmission() : moveExamQuestion(exam.index + 1))
  app.querySelectorAll('[data-exam-index]').forEach(button => button.addEventListener('click', () => moveExamQuestion(Number(button.dataset.examIndex))))
  app.querySelector('#submit-exam').addEventListener('click', confirmExamSubmission)
  app.querySelector('#pause-exam').addEventListener('click', leaveExamView)
}

function confirmExamSubmission() {
  if (!exam || exam.report) return
  const unanswered = exam.questions.length - examAnsweredCount()
  const close = () => { modalRoot.innerHTML = ''; app.querySelector('#submit-exam')?.focus() }
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="exam-submit-title" aria-describedby="exam-submit-copy">
    <div class="modal-head"><h2 id="exam-submit-title">确认交卷</h2></div>
    <p id="exam-submit-copy">${unanswered ? `还有 ${unanswered} 题未作答，未答题按 0 分计入错题。` : '65 题已全部作答。'}交卷后将显示得分，答案无法再修改。</p>
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
  exam.report = gradeExamPaper(exam.questions, exam.answers)
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
    <div class="score-ring"><div><strong>${report.score}</strong><small>/ ${report.totalScore} 分</small></div></div>
    <h1>本次考试完成</h1><p>答对 ${report.correct} 题，答错 ${report.wrong} 题${report.unanswered ? `（含未答 ${report.unanswered} 题）` : ''}</p>
    <div class="exam-sections">${report.sections.map(section => `<div><strong>${section.title}</strong><span>答对 ${section.correct} / ${section.count} 题 · ${section.score} / ${section.count * section.points} 分</span></div>`).join('')}</div>
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
    <div class="exam-status"><strong>错题 ${examReviewIndex + 1} / ${wrong.length}</strong><span>本次成绩 ${exam.report.score} / 85 分</span></div>
    <article class="question-card"><span class="type-chip">${typeName(question.type)} · 试卷第 ${result.index + 1} 题 · ${result.score} / ${result.points} 分</span>
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

function leaveExamView() {
  if (currentView === 'exam-review') return navigate('exam-result', { push: false })
  if (currentView !== 'exam-setup') {
    saveState()
    return navigate('exam-setup', { push: false })
  }
  historyStack = []
  navigate('dashboard', { push: false })
}
