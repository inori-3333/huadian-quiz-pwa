import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createApplication } from './helpers/application.mjs'
await import('../app/core.js')
const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)))
const bank = read('../app/assets/data/safety-week4.json')
const original = read('../sources/week4/original-questions.json')
const corrections = read('../sources/week4/corrections.json')
const references = read('../sources/week4/references.json')
const regulations = read('../app/assets/data/regulations.json')
assert.equal(bank.questions.length, 270)
assert.equal(bank.questionCount, 270)
assert.equal(bank.chapters.length, 18)
for (const chapter of bank.chapters) {
  const group = bank.questions.filter(q => q.chapter === chapter)
  for (const type of ['single', 'fill', 'judge']) {
    assert.deepEqual(group.filter(q => q.type === type).map(q => q.number), [1,2,3,4,5])
  }
}
// Replay the review against the unmodified extraction: no silent omissions or edits.
const replay = structuredClone(original)
for (const change of corrections) {
  const q = replay.find(q => q.id === change.id)
  for (const [field, before] of Object.entries(change.before)) assert.deepEqual(q[field], before)
  Object.assign(q, change.after)
}
for (const q of replay) { q.sourceRef = references[q.id]; q.answerRaw = q.answer }
assert.deepEqual(bank.questions, replay)
assert.equal(new Set(bank.questions.map(q => q.id)).size, 270)
for (const q of bank.questions) {
  assert.ok(regulations.clauses.some(c => c.source === 'general' && c.ref === q.sourceRef), q.id)
  if (q.type === 'fill') assert.match(q.stem, /（）/, q.id)
  if (q.type === 'single') assert.equal(q.options.length, 4, q.id)
}
const q = n => bank.questions[n-1]
assert.equal(QuizCore.isCorrectAnswer(q(82), '10'), true)
assert.equal(QuizCore.isCorrectAnswer(q(82), '0.1'), false)
assert.equal(QuizCore.isCorrectAnswer(q(115), '19.5%'), true)
assert.equal(QuizCore.isCorrectAnswer(q(126), '21%'), true)
assert.equal(QuizCore.isCorrectAnswer(q(232), '自上而下'), true)
assert.equal(q(32).options[1].text, '0.2')
assert.equal(q(214).options[2].text, '3.0')
assert.equal(q(63).options.find(o => o.key === q(63).answer).text, '10')
assert.match(q(137).stem, /柴油发电机组/)
assert.match(q(204).stem, /氦气/)
for (const n of [14,193,236,238,239]) assert.equal(q(n).answer, '错')
assert.match(q(239).stem, /排水阀门/)
assert.equal(QuizCore.findRegulationMatches(q(232),bank.id,regulations,1)[0].ref, '11.2.11')
const app = createApplication()
assert.match(app.app.innerHTML, /第四周安规考试/)
app.run("selectBank('safetyweek4')")
assert.equal(app.run('questionsForBank().length'), 270)
app.run("startSession(['safetyweek4-0063'], '缺项修复验证')")
assert.match(app.app.innerHTML, /10/)
app.run('session.answer = "D"; submitAnswer(questionsForBank().find(q => q.id === "safetyweek4-0063"), false)')
assert.equal(app.run('session.results[0].correct'), true)
app.run('startExam()')
assert.equal(app.run('exam.questions.length'), 65)
assert.ok(app.plain('exam.questions').every(q => q.id.startsWith('safetyweek4-')))
console.log('week4: audit replay, completeness, corrected grading, practice and exam passed')
