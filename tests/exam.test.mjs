import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createApplication } from './helpers/application.mjs'
await import('../app/core.js')
const { createExamPaper, gradeExamPaper, EXAM_SECTIONS } = globalThis.QuizCore
const readBank = name => JSON.parse(fs.readFileSync(new URL(`../app/assets/data/${name}.json`, import.meta.url)))
const bank = readBank('safety-week2')

// Exact composition, section order, no duplicate IDs, source isolation, and
// deterministic random inputs exercise both ends of the shuffle range.
for (const source of [bank, readBank('exam0828')]) {
  for (const random of [() => 0, () => 0.999999, Math.random]) {
    const paper = createExamPaper(source.questions, random)
    assert.equal(paper.length, 65)
    assert.equal(new Set(paper.map(q => q.id)).size, 65)
    assert.deepEqual(paper.map(q => q.type), [...Array(25).fill('single'), ...Array(20).fill('fill'), ...Array(20).fill('judge')])
    assert.ok(paper.every(q => source.questions.some(raw => raw.id === q.id)))
    assert.equal(gradeExamPaper(paper, paper.map(q => q.answer.split(/[|｜]/)[0])).score, 85)
    assert.equal(gradeExamPaper(paper, Array(65).fill('')).score, 0)
  }
  assert.notDeepEqual(createExamPaper(source.questions, () => 0).map(q => q.id), createExamPaper(source.questions, () => 0.99).map(q => q.id))
}
for (const name of ['safety2024general', 'safety2024coal', 'youth-theory-2']) {
  assert.throws(() => createExamPaper(readBank(name).questions), /题量不足/)
}
const tooFew = bank.questions.filter(q => q.type !== 'fill').concat(bank.questions.filter(q => q.type === 'fill').slice(0, 19))
assert.throws(() => createExamPaper(tooFew), /题量不足/)
assert.throws(() => createExamPaper([...tooFew, ...tooFew]), /题量不足/, 'Repeated source IDs must not inflate available counts')
const paper = createExamPaper(bank.questions)
const answers = paper.map(q => q.answer)
answers[0] = 'H'
answers[25] = '不正确的填空答案'
answers[45] = '   '
const report = gradeExamPaper(paper, answers)
assert.equal(report.score, 81)
assert.equal(report.totalScore, 85)
assert.equal(report.correct, 62)
assert.equal(report.wrong, 3)
assert.equal(report.unanswered, 1)
assert.deepEqual(report.sections.map(section => section.score), [24, 38, 19])
assert.deepEqual(report.results.filter(result => !result.correct).map(result => result.index), [0, 25, 45])
assert.equal(EXAM_SECTIONS.reduce((sum, section) => sum + section.count * section.points, 0), 85)

// Snapshot integrity: changing a bank after drawing cannot change the paper.
const original = bank.questions.find(q => q.id === paper[0].id)
original.stem = '修改题干'
original.answer = 'H'
original.options[0].text = '修改选项'
assert.notEqual(paper[0].stem, original.stem)
assert.notEqual(paper[0].options[0].text, original.options[0].text)

const first = createApplication()
first.run("selectBank('safetyweek2')")
assert.match(first.app.innerHTML, /模拟安规考试/)
first.run("startSession([questionsForBank()[0].id], '原有练习'); session.answer = 'B'; saveCurrentSession()")
const savedPractice = first.plain('resumeSessions.safetyweek2')
const priorProgress = first.plain('progress')
first.run('startExam()')
assert.equal(first.app.dataset.view, 'exam')
assert.match(first.app.innerHTML, /第一部分 · 单选题 · 每题 1 分/)
assert.doesNotMatch(first.app.innerHTML, /正确答案|回答正确|回答错误|regulation-panel|data-edit|id="edit-current"/)
first.run("saveExamAnswer('A'); saveExamAnswer('B'); moveExamQuestion(25); saveExamAnswer('草稿 <>&')")
assert.deepEqual(first.plain('resumeSessions.safetyweek2'), savedPractice)
assert.deepEqual(first.plain('progress'), priorProgress, 'Drafting must not record attempts or reveal correctness')
const savedExam = first.plain('exam')
first.run('leaveExamView(); startExam()')
assert.deepEqual(first.plain('exam'), savedExam, 'Starting again must resume an unfinished paper')

// Full restart preserves order, selected question, drafts and original practice.
const resumed = createApplication(first.storage)
resumed.run('openSavedExam()')
assert.deepEqual(resumed.plain('exam'), savedExam)
assert.match(resumed.app.innerHTML, /value="草稿 &lt;&gt;&amp;"/)
assert.deepEqual(resumed.plain('resumeSessions.safetyweek2'), savedPractice)
resumed.run("confirmExamSubmission()")
assert.match(resumed.modal.innerHTML, /还有 63 题未作答/)
resumed.modal.querySelector('#cancel-exam-submit').handlers.get('click')()
assert.equal(resumed.run('exam.report'), null)
assert.equal(resumed.modal.innerHTML, '')
resumed.run(`
  exam.questions.forEach((q, index) => { exam.answers[index] = q.answer })
  exam.answers[0] = 'H'
  exam.answers[25] = '<错误答案>'
  exam.answers[45] = ''
  const choiceId = exam.questions[0].id
  edits[choiceId] = { answer: 'H', answerRaw: 'H' }
  confirmExamSubmission()
`)
resumed.modal.querySelector('#confirm-exam-submit').handlers.get('click')()
assert.equal(resumed.app.dataset.view, 'exam-result')
assert.equal(resumed.run('exam.report.score'), 81, 'Marking must use the frozen answer key')
assert.match(resumed.app.innerHTML, /答对 62 题，答错 3 题（含未答 1 题）/)
assert.equal(resumed.run('Object.values(progress).reduce((sum, state) => sum + state.attempts, 0)'), 65)
const marked = resumed.plain('exam')
const progressAfterSubmit = resumed.plain('progress')
resumed.run("submitExam(); saveExamAnswer('A'); moveExamQuestion(0)")
assert.deepEqual(resumed.plain('exam'), marked, 'Double submission and post-submit editing must be harmless')
assert.deepEqual(resumed.plain('progress'), progressAfterSubmit)
resumed.app.querySelector('#review-exam-wrong').handlers.get('click')()
assert.equal(resumed.app.dataset.view, 'exam-review')
assert.match(resumed.app.innerHTML, /试卷第 1 题/)
assert.match(resumed.app.innerHTML, /你的答案：H/)
assert.match(resumed.app.innerHTML, /正确答案/)
resumed.app.querySelector('#exam-review-next').handlers.get('click')()
assert.match(resumed.app.innerHTML, /试卷第 26 题 · 0 \/ 2 分/)
assert.match(resumed.app.innerHTML, /你的答案：&lt;错误答案&gt;/)
resumed.app.querySelector('#exam-review-next').handlers.get('click')()
assert.match(resumed.app.innerHTML, /试卷第 46 题/)
assert.match(resumed.app.innerHTML, /你的答案：未作答/)
resumed.app.querySelector('#exam-review-next').handlers.get('click')()
assert.equal(resumed.app.dataset.view, 'exam-result')
assert.deepEqual(resumed.plain('progress'), progressAfterSubmit, 'Review must not count attempts again')

const reopened = createApplication(resumed.storage)
reopened.run('openSavedExam()')
assert.equal(reopened.app.dataset.view, 'exam-result')
assert.deepEqual(reopened.plain('exam'), marked)
reopened.run("selectBank('exam0828'); startExam()")
assert.deepEqual(reopened.plain('examSessions.safetyweek2'), marked, 'Each bank has an independent latest exam')
const beforeFailedStart = reopened.plain('exam')
reopened.run("selectBank('safety2024general'); startExam()")
assert.deepEqual(reopened.plain('exam'), beforeFailedStart, 'Incomplete banks must not replace an existing exam')
reopened.run("selectBank('safetyweek2'); openSavedExam(); startExam()")
assert.equal(reopened.run('exam.report'), null)
assert.equal(reopened.run('examAnsweredCount()'), 0)
assert.deepEqual(reopened.plain('progress'), progressAfterSubmit, 'A new exam must retain accumulated wrong answers')

const perfect = createApplication()
perfect.run("selectBank('safetyweek2'); startExam(); exam.answers = exam.questions.map(q => q.answer); submitExam()")
assert.equal(perfect.run('exam.report.score'), 85)
assert.match(perfect.app.innerHTML, /全部答对，没有错题/)
assert.doesNotMatch(perfect.app.innerHTML, /id="review-exam-wrong"/)
const empty = createApplication()
empty.run("selectBank('safetyweek2'); startExam(); submitExam()")
assert.equal(empty.run('exam.report.score'), 0)
assert.equal(empty.run('exam.report.wrong'), 65)
assert.equal(empty.run('exam.report.unanswered'), 65)

// The actual dashboard -> setup -> start/resume handlers must bind the exam
// to the current bank, without a second bank selector or cross-bank fallback.
const currentBankOnly = createApplication()
for (const id of ['safetyweek2', 'exam0828']) {
  currentBankOnly.run(`selectBank('${id}')`)
  currentBankOnly.app.querySelector('[data-action="exam"]').handlers.get('click')()
  assert.match(currentBankOnly.app.innerHTML, /当前题库：/)
  assert.doesNotMatch(currentBankOnly.app.innerHTML, /<select|选择出题题库/)
  assert.ok(currentBankOnly.app.innerHTML.includes(currentBankOnly.run('rawBank().title')))
  assert.doesNotMatch(currentBankOnly.app.innerHTML, /id="open-saved-exam"/, 'Other banks must not expose their saved exams here')
  currentBankOnly.app.querySelector('#start-exam').handlers.get('click')()
  assert.equal(currentBankOnly.run('currentBankId'), id)
  assert.equal(currentBankOnly.run('exam.bankId'), id)
  assert.equal(currentBankOnly.run('exam.questions.every(q => rawBank().questions.some(raw => raw.id === q.id))'), true)
  currentBankOnly.run("saveExamAnswer('B'); leaveExamView()")
  assert.match(currentBankOnly.app.innerHTML, /继续考试（已答 1 \/ 65 题）/)
  currentBankOnly.app.querySelector('#open-saved-exam').handlers.get('click')()
  assert.equal(currentBankOnly.run('exam.bankId'), id)
}
for (const id of ['safety2024general', 'safety2024coal']) {
  const savedPapers = currentBankOnly.plain('examSessions')
  currentBankOnly.run(`selectBank('${id}'); navigate('exam-setup')`)
  assert.match(currentBankOnly.app.innerHTML, /当前题库无法组成完整试卷：填空题需 20 题，现有 0 题/)
  assert.doesNotMatch(currentBankOnly.app.innerHTML, /<select|id="start-exam"|id="open-saved-exam"/)
  currentBankOnly.run('startExam(); openSavedExam()')
  assert.equal(currentBankOnly.run('currentBankId'), id)
  assert.equal(currentBankOnly.app.dataset.view, 'exam-setup')
  assert.deepEqual(currentBankOnly.plain('examSessions'), savedPapers, 'An incomplete current bank must never borrow questions or exams from another bank')
}

console.log('Exam tests passed: current-bank-only setup and draw, exact 65-question / 85-point composition, marking, draft recovery, bank isolation, immutable review and repeat-submit protection.')
