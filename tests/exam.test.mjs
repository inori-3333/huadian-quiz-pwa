import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createApplication } from './helpers/application.mjs'
await import('../app/core.js')
const {
  createExamPaper, gradeExamPaper, examQuestionPools, defaultExamPlan, prepareExamSections,
  validateExamSections, deriveExamSections, formatExamScore
} = globalThis.QuizCore
const readBank = name => JSON.parse(fs.readFileSync(new URL(`../app/assets/data/${name}.json`, import.meta.url)))
const bank = readBank('safety-week2')

// Available types drive the setup page. The legacy default plan keeps the
// original 25 single / 20 fill / 20 judge, 85-point paper for safety banks.
const pools = examQuestionPools(bank.questions)
assert.deepEqual(pools.map(pool => pool.type), ['single', 'multiple', 'fill', 'judge'])
assert.deepEqual(pools.map(pool => pool.questions.length), [89, 0, 90, 90])
const defaultPlan = defaultExamPlan(pools)
assert.deepEqual(defaultPlan, [
  { type: 'single', count: 25, points: 1 },
  { type: 'fill', count: 20, points: 2 },
  { type: 'judge', count: 20, points: 1 }
])
assert.equal(defaultPlan.reduce((sum, section) => sum + section.count * section.points, 0), 85)
const defaultSections = prepareExamSections(pools)
assert.deepEqual(defaultSections.errors, [])
assert.deepEqual(defaultSections.sections.map(section => section.title), ['第一部分 · 单选题', '第二部分 · 填空题', '第三部分 · 判断题'])

// Arbitrary per-type counts and points are validated before a paper is drawn.
const customPlan = [
  { type: 'single', count: 10, points: 2 },
  { type: 'judge', count: 5, points: 3 },
  { type: 'fill', count: 3, points: 5 }
]
const prepared = prepareExamSections(pools, customPlan)
assert.deepEqual(prepared.errors, [])
assert.deepEqual(prepared.sections.map(section => [section.type, section.count, section.points]), [
  ['single', 10, 2], ['judge', 5, 3], ['fill', 3, 5]
])
assert.equal(prepared.sections.reduce((sum, section) => sum + section.count * section.points, 0), 50)
assert.deepEqual(validateExamSections(pools, []), ['请至少选择一种题型'])
assert.match(validateExamSections(pools, [{ type: 'single', count: 0, points: 1 }])[0], /抽题数需为 1 以上的整数/)
assert.match(validateExamSections(pools, [{ type: 'single', count: 90, points: 1 }])[0], /最多可抽 89 题/)
assert.match(validateExamSections(pools, [{ type: 'single', count: 5, points: 0 }])[0], /每题分值/)
assert.match(validateExamSections(pools, [{ type: 'single', count: 5, points: 2.25 }])[0], /0\.5/)
assert.match(validateExamSections(pools, [{ type: 'single', count: 5, points: 1 }, { type: 'single', count: 5, points: 1 }])[0], /重复设置/)
assert.match(validateExamSections(pools, [{ type: 'nope', count: 5, points: 1 }])[0], /题型无效/)
assert.match(validateExamSections(pools, [{ type: 'multiple', count: 1, points: 1 }])[0], /当前题库没有多选题/)
assert.throws(() => createExamPaper(bank.questions, [{ type: 'single', count: 999, points: 1 }]), /最多可抽 89 题/)
assert.throws(() => createExamPaper([...bank.questions, ...bank.questions], [{ type: 'single', count: 90, points: 1 }]), /最多可抽 89 题/, 'Repeated source IDs must not inflate available counts')

// Every bank can form a default paper from at least one of its own types.
for (const name of ['exam0828', 'safety-week2', 'safety-week3', 'safety-week4', 'youth-theory-2', 'safety2024general', 'safety2024coal', 'dispatch-basic', 'dispatch-wind', 'dispatch-pv', 'dispatch-basic-wind', 'dispatch-basic-pv', 'dispatch-all']) {
  const source = readBank(name)
  const sourcePools = examQuestionPools(source.questions)
  const plan = defaultExamPlan(sourcePools)
  assert.ok(plan.length > 0, `${name} has no examinable type`)
  const drawn = createExamPaper(source.questions, plan, () => 0.42)
  assert.equal(drawn.length, plan.reduce((sum, section) => sum + section.count, 0))
  assert.deepEqual(drawn.map(question => question.type), plan.flatMap(section => Array(section.count).fill(section.type)))
  assert.equal(new Set(drawn.map(question => question.id)).size, drawn.length)
  assert.ok(drawn.every(question => source.questions.some(raw => raw.id === question.id)))
}

// Deterministic random inputs exercise both ends of the shuffle range, and
// the legacy default paper stays exactly 65 questions / 85 points.
for (const source of [bank, readBank('exam0828'), readBank('safety-week3'), readBank('safety-week4')]) {
  for (const random of [() => 0, () => 0.999999, Math.random]) {
    const paper = createExamPaper(source.questions, undefined, random)
    assert.equal(paper.length, 65)
    assert.equal(new Set(paper.map(question => question.id)).size, 65)
    assert.deepEqual(paper.map(question => question.type), [...Array(25).fill('single'), ...Array(20).fill('fill'), ...Array(20).fill('judge')])
    assert.ok(paper.every(question => source.questions.some(raw => raw.id === question.id)))
    assert.equal(gradeExamPaper(paper, paper.map(question => question.answer.split(/[|｜]/)[0])).score, 85)
    assert.equal(gradeExamPaper(paper, Array(65).fill('')).score, 0)
    assert.equal(gradeExamPaper(paper, Array(65).fill('')).totalScore, 85)
  }
  assert.notDeepEqual(createExamPaper(source.questions, () => 0).map(question => question.id), createExamPaper(source.questions, () => 0.99).map(question => question.id))
}

// Custom point values flow through marking and section-level reporting.
const paper = createExamPaper(bank.questions, customPlan)
assert.equal(paper.length, 18)
assert.deepEqual(paper.map(question => question.type), [...Array(10).fill('single'), ...Array(5).fill('judge'), ...Array(3).fill('fill')])
const answers = paper.map(question => question.answer.split(/[|｜]/)[0])
answers[0] = 'H'
answers[10] = '不正确的判断答案'
answers[15] = ''
const report = gradeExamPaper(paper, answers, prepared.sections)
assert.equal(report.score, 40)
assert.equal(report.totalScore, 50)
assert.equal(report.correct, 15)
assert.equal(report.wrong, 3)
assert.equal(report.unanswered, 1)
assert.deepEqual(report.sections.map(section => [section.type, section.count, section.points, section.score]), [
  ['single', 10, 2, 18], ['judge', 5, 3, 12], ['fill', 3, 5, 10]
])
assert.deepEqual(report.results.filter(result => !result.correct).map(result => result.index), [0, 10, 15])
assert.equal(formatExamScore(report.score), '40')

// Multiple-choice banks can form their own papers with a custom point value.
const youth = readBank('youth-theory-2')
const multiplePlan = [{ type: 'multiple', count: 3, points: 4 }]
const multiplePaper = createExamPaper(youth.questions, multiplePlan, () => 0)
assert.equal(multiplePaper.length, 3)
assert.ok(multiplePaper.every(question => question.type === 'multiple'))
assert.equal(gradeExamPaper(multiplePaper, multiplePaper.map(question => question.answer), multiplePlan).score, 12)
assert.equal(gradeExamPaper(multiplePaper, multiplePaper.map(question => question.answer).map((answer, index) => index === 0 ? 'H' : answer), multiplePlan).score, 8)

// Legacy papers without stored sections derive their order and default points.
const legacyPaper = createExamPaper(bank.questions)
const legacyReport = gradeExamPaper(legacyPaper, legacyPaper.map(question => question.answer))
assert.deepEqual(deriveExamSections(legacyPaper).map(section => section.type), ['single', 'fill', 'judge'])
assert.equal(legacyReport.totalScore, 85)
assert.equal(legacyReport.score, 85)

// Snapshot integrity: changing a bank after drawing cannot change the paper.
const original = bank.questions.find(question => question.id === paper[0].id)
const originalStem = original.stem
const originalAnswer = original.answer
const originalOption = original.options[0].text
original.stem = '修改题干'
original.answer = 'H'
original.options[0].text = '修改选项'
assert.equal(paper[0].stem, originalStem)
assert.equal(paper[0].answer, originalAnswer)
assert.equal(paper[0].options[0].text, originalOption)

// Setup, presets, draft recovery and marking through the real controllers.
const first = createApplication()
first.run("selectBank('safetyweek2')")
assert.match(first.app.innerHTML, /模拟考试/)
assert.doesNotMatch(first.app.innerHTML, /模拟安规考试/)
first.run("startSession([questionsForBank()[0].id], '原有练习'); session.answer = 'B'; saveCurrentSession()")
const savedPractice = first.plain('resumeSessions.safetyweek2')
const priorProgress = first.plain('progress')
first.run("navigate('exam-setup', { push: false })")
assert.equal(first.app.dataset.view, 'exam-setup')
assert.match(first.app.innerHTML, /选择题型、题量与分值/)
assert.match(first.app.innerHTML, /data-exam-plan-type="single"/)
assert.match(first.app.innerHTML, /data-exam-plan-type="judge"/)
assert.match(first.app.innerHTML, /data-exam-plan-type="fill"/)
assert.doesNotMatch(first.app.innerHTML, /data-exam-plan-type="multiple"/)
assert.match(first.app.innerHTML, /已选 <strong id="exam-plan-count">65<\/strong> 题，满分 <strong id="exam-plan-score">85<\/strong> 分/)
assert.match(first.app.innerHTML, /还没有预设/)
assert.match(first.app.innerHTML, /题库共 89 题可选/)

// Invalid settings block starting; the custom plan can be saved and restored.
first.run(`
  examPlanDrafts.safetyweek2 = { sections: [
    { type: 'single', enabled: true, count: 10, points: 2 },
    { type: 'fill', enabled: true, count: 3, points: 5 },
    { type: 'judge', enabled: true, count: 5, points: 3 }
  ] }
  renderExamSetup()
`)
assert.match(first.app.innerHTML, /已选 <strong id="exam-plan-count">18<\/strong> 题，满分 <strong id="exam-plan-score">50<\/strong> 分/)
assert.match(first.app.innerHTML, /value="10"[^>]*data-plan-count/)
assert.equal(first.run("saveExamPreset('我的方案')"), true)
assert.equal(first.run("bankExamPresets('safetyweek2').length"), 1)
assert.deepEqual(first.plain("bankExamPresets('safetyweek2')[0].sections"), [
  { type: 'single', count: 10, points: 2 }, { type: 'fill', count: 3, points: 5 }, { type: 'judge', count: 5, points: 3 }
])
assert.match(first.app.innerHTML, /我的方案/)
assert.match(first.app.innerHTML, /单选题 10 题 × 2 分/)
const presetId = first.run("bankExamPresets('safetyweek2')[0].id")

first.run("examPlanDrafts.safetyweek2.sections.forEach(section => { section.enabled = false }); renderExamSetup()")
assert.match(first.app.innerHTML, /请至少选择一种题型/)
assert.equal(first.app.querySelector('#start-exam').disabled, true)
first.run('startExam()')
assert.equal(first.run('exam'), null, 'An invalid plan must not draw a paper')
first.run(`applyExamPreset('${presetId}')`)
assert.match(first.app.innerHTML, /已选 <strong id="exam-plan-count">18<\/strong> 题，满分 <strong id="exam-plan-score">50<\/strong> 分/)
assert.deepEqual(first.plain('examPlanDrafts.safetyweek2.sections.map(section => [section.type, section.enabled, section.count, section.points])'), [
  ['single', true, 10, 2], ['fill', true, 3, 5], ['judge', true, 5, 3]
])

// The same preset list survives a restart and stays scoped to its bank.
const presetReloaded = createApplication(first.storage)
presetReloaded.run("selectBank('safetyweek2'); navigate('exam-setup')")
assert.match(presetReloaded.app.innerHTML, /我的方案/)
assert.equal(presetReloaded.run("bankExamPresets('safetyweek2').length"), 1)
assert.equal(presetReloaded.run("bankExamPresets('exam0828').length"), 0)
presetReloaded.run(`deleteExamPreset('${presetId}')`)
assert.equal(presetReloaded.run("bankExamPresets('safetyweek2').length"), 0)
assert.match(presetReloaded.app.innerHTML, /还没有预设/)

first.app.querySelector('#start-exam').handlers.get('click')()
assert.equal(first.app.dataset.view, 'exam')
assert.equal(first.run('exam.questions.length'), 18)
assert.deepEqual(first.plain('exam.sections.map(section => [section.type, section.count, section.points])'), [
  ['single', 10, 2], ['fill', 3, 5], ['judge', 5, 3]
])
assert.match(first.app.innerHTML, /第一部分 · 单选题 · 每题 2 分/)
assert.match(first.app.innerHTML, /已答 0 \/ 18 题/)
assert.match(first.app.innerHTML, /满分 50 分/)
assert.doesNotMatch(first.app.innerHTML, /正确答案|回答正确|回答错误|regulation-panel|data-edit|id="edit-current"/)

first.run("saveExamAnswer('A'); moveExamQuestion(13); saveExamAnswer('错')")
assert.deepEqual(first.plain('resumeSessions.safetyweek2'), savedPractice, 'Drafting an exam must not overwrite practice progress')
assert.deepEqual(first.plain('progress'), priorProgress, 'Drafting must not record attempts or reveal correctness')
const savedExam = first.plain('exam')

// Leaving and starting again resumes the same paper instead of redrawing it.
first.run('leaveExamView()')
assert.equal(first.app.dataset.view, 'exam-setup')
assert.match(first.app.innerHTML, /继续考试（已答 2 \/ 18 题）/)
assert.doesNotMatch(first.app.innerHTML, /id="start-exam"/)
first.run('startExam()')
assert.deepEqual(first.plain('exam'), savedExam, 'Starting again must resume an unfinished paper')

const legacyStorage = new Map(first.storage)
const legacyState = JSON.parse(legacyStorage.get('huadian-quiz-state-v1'))
delete legacyState.examSessions.safetyweek2.sections
legacyStorage.set('huadian-quiz-state-v1', JSON.stringify(legacyState))

// A full restart preserves order, selected question, drafts and practice state.
const resumed = createApplication(first.storage)
resumed.run('openSavedExam()')
assert.equal(resumed.app.dataset.view, 'exam')
assert.deepEqual(resumed.plain('exam'), savedExam)
assert.deepEqual(resumed.plain('resumeSessions.safetyweek2'), savedPractice)
resumed.run("confirmExamSubmission()")
assert.match(resumed.modal.innerHTML, /还有 16 题未作答/)
resumed.modal.querySelector('#cancel-exam-submit').handlers.get('click')()
assert.equal(resumed.run('exam.report'), null)
assert.equal(resumed.modal.innerHTML, '')
resumed.run(`
  exam.questions.forEach((question, index) => { exam.answers[index] = question.answer })
  exam.answers[0] = 'H'
  exam.answers[10] = ''
  exam.answers[13] = '不正确的判断答案'
  const choiceId = exam.questions[0].id
  edits[choiceId] = { answer: 'H', answerRaw: 'H' }
  confirmExamSubmission()
`)
resumed.modal.querySelector('#confirm-exam-submit').handlers.get('click')()
assert.equal(resumed.app.dataset.view, 'exam-result')
assert.equal(resumed.run('exam.report.score'), 40, 'Marking must use the frozen answer key and configured points')
assert.equal(resumed.run('exam.report.totalScore'), 50)
assert.match(resumed.app.innerHTML, /答对 15 题，答错 3 题（含未答 1 题）/)
assert.match(resumed.app.innerHTML, /40<\/strong><small>\/ 50 分/)
assert.equal(resumed.run('Object.values(progress).reduce((sum, state) => sum + state.attempts, 0)'), 18)
const marked = resumed.plain('exam')
const progressAfterSubmit = resumed.plain('progress')
resumed.run("submitExam(); saveExamAnswer('A'); moveExamQuestion(0)")
assert.deepEqual(resumed.plain('exam'), marked, 'Double submission and post-submit editing must be harmless')
assert.deepEqual(resumed.plain('progress'), progressAfterSubmit)
resumed.app.querySelector('#review-exam-wrong').handlers.get('click')()
assert.equal(resumed.app.dataset.view, 'exam-review')
assert.match(resumed.app.innerHTML, /试卷第 1 题/)
assert.match(resumed.app.innerHTML, /0 \/ 2 分/)
assert.match(resumed.app.innerHTML, /你的答案：H/)
assert.match(resumed.app.innerHTML, /正确答案/)
resumed.app.querySelector('#exam-review-next').handlers.get('click')()
assert.match(resumed.app.innerHTML, /试卷第 11 题 · 0 \/ 5 分/)
assert.match(resumed.app.innerHTML, /你的答案：未作答/)
resumed.app.querySelector('#exam-review-next').handlers.get('click')()
assert.match(resumed.app.innerHTML, /试卷第 14 题 · 0 \/ 3 分/)
assert.match(resumed.app.innerHTML, /你的答案：不正确的判断答案/)
resumed.app.querySelector('#exam-review-next').handlers.get('click')()
assert.equal(resumed.app.dataset.view, 'exam-result')
assert.deepEqual(resumed.plain('progress'), progressAfterSubmit, 'Review must not count attempts again')

const reopened = createApplication(resumed.storage)
reopened.run('openSavedExam()')
assert.equal(reopened.app.dataset.view, 'exam-result')
assert.deepEqual(reopened.plain('exam'), marked)
reopened.run("selectBank('exam0828'); startExam()")
assert.deepEqual(reopened.plain('examSessions.safetyweek2'), marked, 'Each bank has an independent latest exam')

// Legacy saved papers without a sections array still render and keep their
// original per-type default point values.
const legacy = createApplication(legacyStorage)
legacy.run('openSavedExam()')
assert.equal(legacy.app.dataset.view, 'exam')
assert.equal(legacy.run('exam.sections.length'), 3)
assert.match(legacy.app.innerHTML, /第一部分 · 单选题/)
assert.match(legacy.app.innerHTML, /每题 1 分/)

// A perfect paper and an empty paper are both marked with the custom total.
const perfect = createApplication()
perfect.run("selectBank('safetyweek2'); startExam([{ type: 'single', count: 4, points: 2.5 }]); exam.answers = exam.questions.map(question => question.answer); submitExam()")
assert.equal(perfect.run('exam.report.score'), 10)
assert.equal(perfect.run('exam.report.totalScore'), 10)
assert.match(perfect.app.innerHTML, /全部答对，没有错题/)
assert.doesNotMatch(perfect.app.innerHTML, /id="review-exam-wrong"/)
const empty = createApplication()
empty.run("selectBank('safetyweek2'); startExam([{ type: 'single', count: 4, points: 2.5 }]); submitExam()")
assert.equal(empty.run('exam.report.score'), 0)
assert.equal(empty.run('exam.report.wrong'), 4)
assert.equal(empty.run('exam.report.unanswered'), 4)

// Every bank now exposes a usable exam setup, and only its own types appear.
for (const id of ['exam0828', 'safetyweek2', 'safetyweek3', 'safetyweek4', 'youththeory2', 'safety2024general', 'safety2024coal', 'dispatchbasic', 'dispatchwind', 'dispatchpv', 'dispatchbasicwind', 'dispatchbasicpv', 'dispatchall']) {
  const app = createApplication()
  app.run(`selectBank('${id}')`)
  assert.match(app.app.innerHTML, /模拟考试/, `${id} dashboard is missing the exam entry`)
  app.run("navigate('exam-setup')")
  const available = app.plain('availableExamPools().map(pool => pool.type)')
  assert.ok(available.length > 0, `${id} has no examinable type`)
  assert.doesNotMatch(app.app.innerHTML, /当前题库无法组成完整试卷/)
  assert.doesNotMatch(app.app.innerHTML, /<select|<option|选择出题题库/)
  for (const type of ['single', 'multiple', 'judge', 'fill']) {
    if (available.includes(type)) assert.match(app.app.innerHTML, new RegExp(`data-exam-plan-type="${type}"`), `${id} is missing the ${type} row`)
    else assert.doesNotMatch(app.app.innerHTML, new RegExp(`data-exam-plan-type="${type}"`), `${id} shows an unavailable ${type} row`)
  }
  app.app.querySelector('#start-exam').handlers.get('click')()
  assert.equal(app.app.dataset.view, 'exam', `${id} could not start an exam`)
  assert.equal(app.run('exam.questions.every(question => rawBank().questions.some(raw => raw.id === question.id))'), true)
  assert.ok(app.run('exam.questions.length') > 0, `${id} drew an empty paper`)
}

// The dashboard route still binds the exam entry to the current bank only.
const currentBankOnly = createApplication()
for (const id of ['safetyweek2', 'exam0828', 'safetyweek3']) {
  currentBankOnly.run(`selectBank('${id}')`)
  currentBankOnly.app.querySelector('[data-action="exam"]').handlers.get('click')()
  assert.equal(currentBankOnly.app.dataset.view, 'exam-setup')
  assert.match(currentBankOnly.app.innerHTML, /当前题库：/)
  assert.ok(currentBankOnly.app.innerHTML.includes(currentBankOnly.run('rawBank().title')))
  currentBankOnly.app.querySelector('#start-exam').handlers.get('click')()
  assert.equal(currentBankOnly.run('currentBankId'), id)
  assert.equal(currentBankOnly.run('exam.bankId'), id)
  currentBankOnly.run("saveExamAnswer('B'); leaveExamView()")
  assert.match(currentBankOnly.app.innerHTML, /继续考试（已答 1 \/ \d+ 题）/)
  currentBankOnly.app.querySelector('#open-saved-exam').handlers.get('click')()
  assert.equal(currentBankOnly.run('exam.bankId'), id)
}

console.log('Exam tests passed: configurable type/count/points plans, all-bank papers, exact marking, per-bank presets, draft recovery, legacy migration and bank isolation.')
