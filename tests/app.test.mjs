import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
await import('../app/core.js')
const { isCorrectAnswer, normalizeChoice, usesImmediateSubmission, matchesQuestionGroup, normalizeQuestionProgress, recordQuestionResult, createResumeSnapshot, isResumeAvailable, shuffled, regulationReferences, sourceIdsForQuestion, findRegulationMatches } = globalThis.QuizCore

const exam0828 = JSON.parse(fs.readFileSync(new URL('../app/assets/data/exam0828.json', import.meta.url)))
const safetyWeek2 = JSON.parse(fs.readFileSync(new URL('../app/assets/data/safety-week2.json', import.meta.url)))
const youthTheory2 = JSON.parse(fs.readFileSync(new URL('../app/assets/data/youth-theory-2.json', import.meta.url)))
const safety2024General = JSON.parse(fs.readFileSync(new URL('../app/assets/data/safety2024general.json', import.meta.url)))
const safety2024Coal = JSON.parse(fs.readFileSync(new URL('../app/assets/data/safety2024coal.json', import.meta.url)))
const regulations = JSON.parse(fs.readFileSync(new URL('../app/assets/data/regulations.json', import.meta.url)))
const allBanks = [exam0828, safetyWeek2, youthTheory2, safety2024General, safety2024Coal]
const embeddedWindow = {}
vm.runInNewContext(fs.readFileSync(new URL('../app/banks-data.js', import.meta.url), 'utf8'), { window: embeddedWindow })
vm.runInNewContext(fs.readFileSync(new URL('../app/regulations-data.js', import.meta.url), 'utf8'), { window: embeddedWindow })
assert.deepEqual(JSON.parse(JSON.stringify(embeddedWindow.QUIZ_BANKS)), allBanks)
assert.deepEqual(JSON.parse(JSON.stringify(embeddedWindow.SAFETY_REGULATIONS)), regulations)
assert.equal(fs.readFileSync(new URL('../app/main.js', import.meta.url), 'utf8').includes('fetch('), false)

const manifest = JSON.parse(fs.readFileSync(new URL('../app/manifest.webmanifest', import.meta.url)))
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.start_url, './')
assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'))
assert.ok(manifest.icons.some(icon => icon.sizes === '512x512'))
const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8')
assert.ok(html.includes('rel="manifest"'))
assert.ok(html.includes('apple-touch-icon'))
assert.ok(html.includes('regulations-data.js'))
const serviceWorker = fs.readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8')
for (const asset of ['index.html', 'styles.css', 'core.js', 'main.js', 'banks-data.js', 'regulations-data.js']) assert.ok(serviceWorker.includes(asset), `service worker does not cache ${asset}`)

assert.equal(regulations.version, 1)
assert.deepEqual(regulations.sources.map(source => source.id), ['general', 'coal'])
assert.ok(regulations.clauses.length > 2800)
assert.ok(regulations.clauses.some(entry => entry.source === 'general' && entry.ref === '3.1' && entry.text.includes('距坠落高度基准面2m')))
assert.ok(regulations.clauses.some(entry => entry.source === 'coal' && entry.ref === '4.1.1' && entry.text.includes('锅炉运行操作人员')))
assert.ok(regulations.clauses.some(entry => entry.kind === 'table' && entry.source === 'general'))

assert.equal(exam0828.questionCount, 270)
assert.equal(exam0828.questions.length, 270)
assert.equal(new Set(exam0828.questions.map(q => q.id)).size, 270)
const updatedGroup3Question = exam0828.questions.find(question => question.chapter === '第3组' && question.section === '选择题' && question.number === 5)
assert.equal(updatedGroup3Question.answer, 'D')
assert.ok(updatedGroup3Question.stem.includes('安全标志'))
assert.equal(safetyWeek2.questionCount, 269)
assert.equal(safetyWeek2.questions.length, 269)
assert.equal(new Set(safetyWeek2.questions.map(q => q.id)).size, 269)
assert.deepEqual(safetyWeek2.chapters, ['选择题', '填空题', '判断题'])
assert.deepEqual(
  Object.fromEntries(['single', 'fill', 'judge'].map(type => [type, safetyWeek2.questions.filter(question => question.type === type).length])),
  { single: 89, fill: 90, judge: 90 }
)
assert.equal(safetyWeek2.questions[42].answer, 'C')
assert.deepEqual(safetyWeek2.questions[42].options.map(option => option.key), ['A', 'B', 'C', 'D'])
assert.equal(safetyWeek2.questions[89].answer, '防护装置')
assert.equal(safetyWeek2.questions[268].answer, '对')
assert.equal(youthTheory2.questionCount, 580)
assert.equal(youthTheory2.questions.length, 580)
assert.equal(new Set(youthTheory2.questions.map(q => q.id)).size, 580)
assert.deepEqual(youthTheory2.chapters, [
  '第一部分：党的理论',
  '第二部分：党史知识',
  '第三部分：团青知识',
  '第四部分：行业信息',
  '第五部分：管理知识',
  '第六部分：安全生产',
  '第七部分：公文常识'
])
assert.deepEqual(
  Object.fromEntries(['single', 'multiple', 'judge'].map(type => [type, youthTheory2.questions.filter(question => question.type === type).length])),
  { single: 288, multiple: 150, judge: 142 }
)
assert.deepEqual(
  Object.fromEntries(['single', 'multiple', 'judge'].map(type => [type, safety2024General.questions.filter(question => question.type === type).length])),
  { single: 852, multiple: 477, judge: 933 }
)
assert.deepEqual(
  Object.fromEntries(['single', 'multiple', 'judge'].map(type => [type, safety2024Coal.questions.filter(question => question.type === type).length])),
  { single: 1268, multiple: 641, judge: 1298 }
)
assert.equal(safety2024General.questionCount, 2262)
assert.equal(safety2024General.questions.length, 2262)
assert.equal(safety2024General.chapters.length, 24)
assert.equal(safety2024Coal.questionCount, 3207)
assert.equal(safety2024Coal.questions.length, 3207)
assert.equal(safety2024Coal.chapters.length, 11)
assert.equal(new Set(allBanks.flatMap(bank => bank.questions.map(question => question.id))).size, 6588)

for (const bank of allBanks) {
  const grouped = ['choice', 'fill', 'judge'].flatMap(group => bank.questions.filter(question => matchesQuestionGroup(question.type, group)))
  assert.equal(grouped.length, bank.questions.length, `${bank.id} type groups do not cover every question`)
  assert.equal(new Set(grouped.map(question => question.id)).size, bank.questions.length, `${bank.id} type groups overlap`)
  for (const question of bank.questions) {
    assert.ok(question.stem.length > 0, `${question.id} has no stem`)
    assert.ok(question.answer.length > 0, `${question.id} has no answer`)
    const searchable = [question.stem, ...question.options.map(option => option.text)].join(' ')
    assert.equal(/(?:^|\s)—\s*\d+(?:\s|$)/.test(searchable), false, `${question.id} contains a page-number artifact`)
    if (['single', 'multiple'].includes(question.type)) {
      assert.ok(question.options.length >= 2, `${question.id} has too few options`)
      assert.equal(new Set(question.options.map(option => option.key)).size, question.options.length, `${question.id} has duplicate options`)
      assert.ok(question.options.every(option => option.text.length > 0), `${question.id} has an empty option`)
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
const migratedWrong = normalizeQuestionProgress({ attempts: 3, wrongCount: 2, correctCount: 1, favorite: true })
assert.equal(migratedWrong.currentWrong, true)
assert.equal(migratedWrong.favorite, true)
const correctedWrong = recordQuestionResult(migratedWrong, true)
assert.equal(correctedWrong.currentWrong, false)
assert.equal(correctedWrong.wrongCount, 2)
assert.equal(correctedWrong.correctCount, 2)
assert.equal(correctedWrong.attempts, 4)
const wrongAgain = recordQuestionResult(correctedWrong, false)
assert.equal(wrongAgain.currentWrong, true)
assert.equal(wrongAgain.wrongCount, 3)
assert.equal(wrongAgain.attempts, 5)
const firstTryCorrect = recordQuestionResult(undefined, true)
assert.equal(firstTryCorrect.currentWrong, false)
assert.equal(firstTryCorrect.wrongCount, 0)
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
assert.deepEqual(regulationReferences('10.1.10（d)'), ['10.1.10'])
assert.deepEqual(regulationReferences('附录A5.3.5'), ['A.5.3.5'])
assert.deepEqual(regulationReferences('表B.1'), ['B.1'])
assert.deepEqual(regulationReferences('I.9'), ['I.9'])
assert.deepEqual(sourceIdsForQuestion('youththeory2'), [])
assert.deepEqual(sourceIdsForQuestion('safety2024general'), ['general'])
assert.deepEqual(sourceIdsForQuestion('exam0828'), ['general', 'coal'])
assert.equal(findRegulationMatches(safety2024General.questions[0], 'safety2024general', regulations, 3)[0].ref, '3.1')
assert.equal(findRegulationMatches(safety2024Coal.questions[0], 'safety2024coal', regulations, 3)[0].ref, '4.1.1')
assert.equal(findRegulationMatches(safetyWeek2.questions[0], 'safetyweek2', regulations, 3)[0].ref, '8.2.1')
assert.equal(findRegulationMatches(exam0828.questions[0], 'exam0828', regulations, 3)[0].ref, '3.9')
assert.deepEqual(findRegulationMatches(youthTheory2.questions[0], 'youththeory2', regulations, 3), [])

console.log('All tests passed: 5 independent banks, 6588 questions, and 2 offline regulation sources validated.')
