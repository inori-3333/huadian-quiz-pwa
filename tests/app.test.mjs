import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
await import('../app/core.js')
const { isCorrectAnswer, normalizeChoice, usesImmediateSubmission, matchesQuestionGroup, createResumeSnapshot, isResumeAvailable, shuffled } = globalThis.QuizCore

const exam0828 = JSON.parse(fs.readFileSync(new URL('../app/assets/data/exam0828.json', import.meta.url)))
const embeddedWindow = {}
vm.runInNewContext(fs.readFileSync(new URL('../app/banks-data.js', import.meta.url), 'utf8'), { window: embeddedWindow })
assert.deepEqual(JSON.parse(JSON.stringify(embeddedWindow.QUIZ_BANKS)), [exam0828])
assert.equal(fs.readFileSync(new URL('../app/main.js', import.meta.url), 'utf8').includes('fetch('), false)

const manifest = JSON.parse(fs.readFileSync(new URL('../app/manifest.webmanifest', import.meta.url)))
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.start_url, './')
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'))
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'))
const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8')
assert.ok(html.includes('rel="manifest"'))
assert.ok(html.includes('apple-touch-icon'))
const serviceWorker = fs.readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8')
for (const asset of ['index.html', 'styles.css', 'core.js', 'main.js', 'banks-data.js']) assert.ok(serviceWorker.includes(asset), `service worker does not cache ${asset}`)

assert.equal(exam0828.questionCount, 270)
assert.equal(exam0828.questions.length, 270)
assert.equal(new Set(exam0828.questions.map(q => q.id)).size, 270)
const updatedGroup3Question = exam0828.questions.find(question => question.chapter === '第3组' && question.section === '选择题' && question.number === 5)
assert.equal(updatedGroup3Question.answer, 'D')
assert.ok(updatedGroup3Question.stem.includes('安全标志'))

for (const bank of [exam0828]) {
  const grouped = ['choice', 'fill', 'judge'].flatMap(group => bank.questions.filter(question => matchesQuestionGroup(question.type, group)))
  assert.equal(grouped.length, bank.questions.length, `${bank.id} type groups do not cover every question`)
  assert.equal(new Set(grouped.map(question => question.id)).size, bank.questions.length, `${bank.id} type groups overlap`)
  for (const question of bank.questions) {
    assert.ok(question.stem.length > 0, `${question.id} has no stem`)
    assert.ok(question.answer.length > 0, `${question.id} has no answer`)
    if (['single', 'multiple'].includes(question.type)) {
      assert.ok(question.options.length >= 2, `${question.id} has too few options`)
      assert.ok(normalizeChoice(question.answer).split('').every(key => question.options.some(option => option.key === key)), `${question.id} answer not found in options`)
    }
  }
}

assert.equal(isCorrectAnswer({ type: 'single', answer: 'B' }, 'B'), true)
assert.equal(isCorrectAnswer({ type: 'multiple', answer: 'ACD' }, 'DCA'), true)
assert.equal(isCorrectAnswer({ type: 'judge', answer: '错误' }, '错'), true)
assert.equal(isCorrectAnswer({ type: 'fill', answer: '2 m|2米' }, '2m'), true)
assert.equal(usesImmediateSubmission('single'), true)
assert.equal(usesImmediateSubmission('judge'), true)
assert.equal(usesImmediateSubmission('multiple'), false)
assert.equal(usesImmediateSubmission('fill'), false)
assert.equal(matchesQuestionGroup('single', 'choice'), true)
assert.equal(matchesQuestionGroup('multiple', 'choice'), true)
assert.equal(matchesQuestionGroup('fill', 'choice'), false)
assert.equal(matchesQuestionGroup('fill', 'fill'), true)
assert.equal(matchesQuestionGroup('judge', 'judge'), true)
const pausedSession = { ids: ['q1', 'q2'], title: '顺序刷题', index: 1, answer: 'B', submitted: true, results: [{ id: 'q1', correct: false }], correct: 0, wrong: 1 }
assert.deepEqual(createResumeSnapshot(pausedSession), { ...pausedSession, displayStart: 1, displayTotal: 2 })
assert.equal(isResumeAvailable(createResumeSnapshot(pausedSession)), true)
const advancingSession = { ...pausedSession, index: 0, answer: 'A', submitted: true, autoAdvancing: true }
assert.equal(createResumeSnapshot(advancingSession).index, 1)
assert.equal(createResumeSnapshot(advancingSession).submitted, false)
assert.equal(createResumeSnapshot(advancingSession).answer, '')
const offsetSession = createResumeSnapshot({ ...pausedSession, displayStart: 100, displayTotal: 270 })
assert.equal(offsetSession.displayStart, 100)
assert.equal(offsetSession.displayTotal, 270)
assert.equal(isResumeAvailable({ ids: ['q1'], index: 1 }), false)
assert.deepEqual(shuffled([1, 2, 3], () => 0), [2, 3, 1])

console.log('All tests passed: 270 questions and core answer logic validated.')
