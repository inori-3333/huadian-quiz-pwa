import assert from 'node:assert/strict'
import { createApplication } from './helpers/application.mjs'

const key = 'huadian-quiz-state-v1'
const app = createApplication()
const questions = app.plain('window.SHORT_ANSWERS')
const regulations = app.plain('regulationData.clauses')
assert.deepEqual(questions.map(item => item.number), Array.from({ length: 20 }, (_, i) => i + 1))
assert.deepEqual(questions.map(item => item.answer.length), [3, 6, 6, 1, 8, 7, 4, 9, 6, 5, 5, 8, 1, 1, 1, 1, 1, 1, 9, 1])
assert.equal(questions[12].question, questions[19].question, 'Keep both supplied copies of the high-voltage question')
assert.notDeepEqual(questions[12].answer, questions[19].answer, 'Keep the supplied answer wording for each duplicate')
const expectedRefs = ['8.2.1', '9.6.3', '10.1.2,10.1.6', '5.2.2.8', '5.2.2.19', '11.2.9,11.2.10,11.2.11', '12.1.20', '12.3.2', '9.3.8', '9.12.14', '10.1.9,10.1.10', '13.2.48', '9.15.1.7,9.15.1.8,9.15.1.9', '11.1.6', '11.2.2', '6.2.2.3', '6.2.3.8,6.2.3.9', '6.1.7.3', '7.7.2', '9.15.1.7,9.15.1.8,9.15.1.9']
assert.deepEqual(questions.map(item => item.refs.join(',')), expectedRefs)
app.modal.querySelector('.modal-done').handlers.get('click')()
assert.equal(app.run('shortAnswerNoticeDismissed'), false, 'The general announcement must not dismiss the revision notice')
assert.match(app.app.innerHTML, /简答题\.\.\.吗？/)
app.app.querySelector('[data-action="short-answers"]').handlers.get('click')()
assert.equal(app.app.dataset.view, 'short-answers')
assert.equal(app.run('currentBankId'), null, 'Revision reading does not require a bank')
assert.match(app.modal.innerHTML, /仅供复习参考/)
assert.match(app.modal.innerHTML, /可能一个都不考/)
assert.equal(app.run('shortAnswerNoticeDismissed'), false, 'Mark seen only after the displayed notice is closed')
assert.equal(app.document.querySelector('#app').inert, true)
assert.equal(app.document.querySelector('#topbar').inert, true)
const compact = text => text.replace(/\s+/g, '')
const rendered = compact(app.app.innerHTML.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
for (const question of questions) {
  assert.ok(rendered.includes(compact(question.question)))
  for (const paragraph of question.answer) assert.ok(rendered.includes(compact(paragraph)), `Missing answer point in question ${question.number}`)
  for (const ref of question.refs) {
    const matches = regulations.filter(item => item.source === 'general' && item.ref === ref && item.kind === 'clause')
    assert.equal(matches.length, 1, `Reference ${ref} must resolve unambiguously`)
    assert.ok(rendered.includes(compact(matches[0].text)), `Reference ${ref} must be displayed in full`)
  }
}
assert.equal((app.app.innerHTML.match(/class="short-answer-card"/g) || []).length, 20)
assert.doesNotMatch(app.app.innerHTML, /<input|<textarea|提交答案|查看答案/)
app.modal.querySelector('.modal-done').handlers.get('click')()
assert.equal(app.document.querySelector('#app').inert, undefined)
app.document.querySelector('#back-button').handlers.get('click')()
assert.equal(app.app.dataset.view, 'home')

// Existing users, all close paths, restart persistence and unrelated learning state.
for (const method of ['done', 'close', 'escape', 'backdrop']) {
  const before = {
    currentBankId: 'safetyweek2', dismissedAnnouncementVersion: app.run('ANNOUNCEMENT_VERSION'),
    progress: { saved: { attempts: 3, favorite: true } }, edits: { saved: { answer: 'A' } },
    resumeSessions: { otherBank: { index: 2 } }, examSessions: { saved: { index: 3 } }
  }
  const storage = new Map([[key, JSON.stringify(before)]])
  const instance = createApplication(storage)
  assert.equal(instance.modal.innerHTML, '', 'Do not show the revision notice on boot')
  assert.match(instance.app.innerHTML, /简答题\.\.\.吗？/)
  instance.app.querySelector('[data-action="short-answers"]').handlers.get('click')()
  assert.match(instance.modal.innerHTML, /可能一个都不考/)
  const first = instance.modal.querySelector('.modal-close')
  const last = instance.modal.querySelector('.modal-done')
  let focused = ''
  first.focus = () => { focused = 'first' }
  last.focus = () => { focused = 'last' }
  instance.document.activeElement = first
  instance.modal.querySelector('.modal').handlers.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault() {} })
  assert.equal(focused, 'last')
  instance.document.activeElement = last
  instance.modal.querySelector('.modal').handlers.get('keydown')({ key: 'Tab', shiftKey: false, preventDefault() {} })
  assert.equal(focused, 'first')
  instance.app.querySelector('#short-answer-heading').focus = () => { focused = 'heading' }
  if (method === 'done') last.handlers.get('click')()
  if (method === 'close') first.handlers.get('click')()
  if (method === 'escape') instance.modal.querySelector('.modal').handlers.get('keydown')({ key: 'Escape', preventDefault() {} })
  if (method === 'backdrop') {
    const backdrop = instance.modal.querySelector('.modal-backdrop')
    backdrop.handlers.get('click')({ target: backdrop, currentTarget: backdrop })
  }
  assert.equal(focused, 'heading')
  assert.equal(instance.modal.innerHTML, '')
  const saved = JSON.parse(storage.get(key))
  assert.equal(saved.shortAnswerNoticeDismissed, true)
  for (const field of Object.keys(before)) assert.deepEqual(saved[field], before[field], `${method} changed ${field}`)
  instance.document.querySelector('#back-button').handlers.get('click')()
  assert.equal(instance.app.dataset.view, 'dashboard')
  instance.run('openShortAnswers()')
  assert.equal(instance.modal.innerHTML, '')
  const restarted = createApplication(storage)
  restarted.run('openShortAnswers()')
  assert.equal(restarted.modal.innerHTML, '', `${method} dismissal must survive reload`)
}

// If persistence is unavailable, content stays readable and dismissal still lasts this run.
const unavailable = createApplication(new Map([[key, JSON.stringify({ dismissedAnnouncementVersion: app.run('ANNOUNCEMENT_VERSION') })]]))
unavailable.run("localStorage.setItem = () => { throw new Error('storage full') }; openShortAnswers()")
unavailable.modal.querySelector('.modal-done').handlers.get('click')()
assert.equal(unavailable.modal.innerHTML, '')
assert.equal(unavailable.run('shortAnswerNoticeDismissed'), true)
assert.match(unavailable.document.querySelector('#toast').textContent, /无法保存/)
assert.equal(unavailable.app.dataset.view, 'short-answers')
console.log('Short answers passed: 20 supplied questions and complete original clauses, independent notice, all dismissal paths, keyboard, restart, storage failure and preserved progress.')
