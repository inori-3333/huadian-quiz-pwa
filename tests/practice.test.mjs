import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Exercise the actual practice controller with deterministic timers and storage.
// Browser layout and native touch delivery are checked separately in Playwright.
class Element {
  innerHTML = ''
  dataset = {}
  style = {}
  handlers = new Map()
  children = new Map()
  classList = { toggle() {}, add() {}, remove() {} }
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Element())
    return this.children.get(selector)
  }
  querySelectorAll() { return [] }
  addEventListener(type, handler) { this.handlers.set(type, handler) }
  setAttribute() {}
  setPointerCapture() {}
  closest() { return null }
}

const document = new Element()
document.body = new Element()
const app = document.querySelector('#app')
const timers = []
const storage = new Map()
const context = vm.createContext({
  document, console,
  window: { scrollTo() {} },
  localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer },
  clearTimeout: timer => { if (timer) timer.cancelled = true }
})
const run = source => vm.runInContext(source, context)
const plain = source => JSON.parse(JSON.stringify(run(source)))
for (const file of ['core.js', 'banks-data.js', 'regulations-data.js', 'main.js']) {
  run(fs.readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8'))
}
const flushAdvance = () => {
  const index = timers.findIndex(timer => timer.delay === 400 && !timer.cancelled)
  assert.ok(index >= 0, 'A correct answer must schedule automatic advance')
  timers.splice(index, 1)[0].callback()
}
const click = selector => app.querySelector(selector).handlers.get('click')()
const swipe = (dx, dy = 0, overrides = {}) => {
  const event = { pointerId: 1, pointerType: 'touch', isPrimary: true, target: app, preventDefault() {}, ...overrides }
  app.handlers.get('pointerdown')({ ...event, clientX: 300, clientY: 300 })
  app.handlers.get('pointermove')({ ...event, clientX: 300 + dx, clientY: 300 + dy })
  app.handlers.get('pointerup')({ ...event, clientX: 300 + dx, clientY: 300 + dy })
}

run(`
  currentBankId = 'safetyweek2'
  const choice = questionsForBank().find(q => q.type === 'single')
  const fill = questionsForBank().find(q => q.type === 'fill')
  const judge = questionsForBank().find(q => q.type === 'judge')
  startSession([choice.id, fill.id, judge.id], '历史回看测试', { displayStart: 10, displayTotal: 99 })
`)
swipe(-120)
assert.equal(run('session.index'), 0, 'First-question swipe must not leave the session')
assert.equal(run('session.reviewIndex'), undefined)
run('session.answer = choice.answer; submitAnswer(choice, false, true)')
assert.doesNotMatch(app.innerHTML, /regulation-panel/, 'Normal correct-answer feedback must not show regulations')
run('submitAnswer(choice, false, true)')
assert.equal(run('session.results.length'), 1, 'Repeated submit must not count twice')
flushAdvance()
run("session.answer = '尚未提交的填空'; saveCurrentSession()")
const beforeReview = plain('createResumeSnapshot(session)')
const beforeProgress = plain('progress')
swipe(-120, 160)
assert.equal(run('session.reviewIndex'), undefined, 'Vertical scroll is not history navigation')
swipe(-20)
assert.equal(run('session.reviewIndex'), undefined, 'A short drag is not a swipe')
swipe(-120, 0, { pointerType: 'mouse' })
assert.equal(run('session.reviewIndex'), undefined, 'Mouse text selection is not a swipe')
swipe(-120, 0, { target: { closest: () => ({}) } })
assert.equal(run('session.reviewIndex'), undefined, 'Editing input text must not navigate')
swipe(-120)
assert.equal(run('session.reviewIndex'), 0)
assert.match(app.innerHTML, /历史回看/)
assert.match(app.innerHTML, /10 \/ 99/)
assert.match(app.innerHTML, /回答正确/)
assert.match(app.innerHTML, /regulation-panel/)
assert.match(app.innerHTML, /data-option="[A-H]" type="button" disabled/)
assert.doesNotMatch(app.innerHTML, /id="submit-answer"|id="dont-know"/)
run('submitAnswer(choice, true)')
assert.deepEqual(plain('createResumeSnapshot(session)'), beforeReview)
assert.deepEqual(plain('progress'), beforeProgress, 'Review must not change attempts, scores or wrong-question groups')
swipe(120)
assert.equal(run('session.reviewIndex'), undefined)
assert.match(app.innerHTML, /value="尚未提交的填空"/)
assert.doesNotMatch(app.innerHTML, /regulation-panel/)

run('submitAnswer(fill, false, true)')
assert.match(app.innerHTML, /回答错误/)
assert.match(app.innerHTML, /regulation-panel/)
click('#next-question')
swipe(-120)
assert.equal(run('session.reviewIndex'), 1)
assert.match(app.innerHTML, /fill-answer wrong/)
assert.match(app.innerHTML, /你的答案：尚未提交的填空/)
swipe(-120)
assert.match(app.innerHTML, /回答正确/, 'Older correct answers must use their own result')
click('#next-question')
assert.equal(run('session.reviewIndex'), 1)
click('#return-current')
assert.equal(run('session.index'), 2)
assert.equal(run('session.reviewIndex'), undefined)

// The last answer remains accessible from completion without recounting it.
run("session.answer = String(judge.answer).includes('错') ? '错' : '对'; submitAnswer(judge, false, true)")
flushAdvance()
assert.match(app.innerHTML, /本轮练习完成/)
swipe(-120)
assert.equal(run('session.reviewIndex'), 2)
assert.match(app.innerHTML, /回答正确/)
click('#return-current')
assert.match(app.innerHTML, /答对 2 题，答错 1 题/)
assert.equal(run('resumeSessions[currentBankId]'), undefined)

// Settle a correct answer mid-delay, then answer the next before the old timer
// fires. The stale timer must not advance that newer answer prematurely.
run("startSession([choice.id, judge.id, fill.id], '计时回归'); session.answer = choice.answer; submitAnswer(choice, false, true)")
swipe(-120)
assert.equal(run('session.index'), 1)
assert.equal(run('session.reviewIndex'), 0)
assert.match(app.innerHTML, /regulation-panel/)
swipe(120)
run("session.answer = String(judge.answer).includes('错') ? '错' : '对'; submitAnswer(judge, false, true)")
flushAdvance()
assert.equal(run('session.index'), 1, 'Timer from an earlier answer must not advance a later question')
flushAdvance()
assert.equal(run('session.index'), 2)

// Multi-select drafts and saved progress survive browsing and resuming.
run(`
  currentBankId = 'safety2024general'
  const generalChoice = questionsForBank().find(q => q.type === 'single')
  const multiple = questionsForBank().find(q => q.type === 'multiple')
  startSession([generalChoice.id, multiple.id], '多选续练')
  session.answer = generalChoice.answer
  submitAnswer(generalChoice, false, true)
`)
flushAdvance()
run("session.answer = 'AC'; saveCurrentSession()")
swipe(-120)
run('saveCurrentSession(); session = null; continueSession()')
assert.equal(run('session.index'), 1)
assert.equal(run('session.answer'), 'AC')
assert.equal(run('session.reviewIndex'), undefined)
assert.equal(run('session.submitted'), false)
assert.equal((app.innerHTML.match(/option selected/g) || []).length, 2)
swipe(-120)
assert.equal(run('session.reviewIndex'), 0, 'Saved results remain available for review after resume')

// Banks without regulation sources must stay free of unrelated regulations.
run(`
  currentBankId = 'youththeory2'
  const youth = questionsForBank().find(q => q.type === 'single')
  startSession([youth.id], '知识竞赛')
  session.answer = youth.answer
  submitAnswer(youth, false, true)
`)
flushAdvance()
swipe(-120)
assert.match(app.innerHTML, /回答正确/)
assert.doesNotMatch(app.innerHTML, /regulation-panel/)

console.log('Practice tests passed: swipe review, answer feedback, draft/resume preservation, completion and timer races.')
