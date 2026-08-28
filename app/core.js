(function exposeQuizCore(global) {
function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s　]+/g, '')
    .replace(/[，,。；;：:、（）()]/g, '')
}

function normalizeChoice(value) {
  return [...new Set(String(value ?? '').toUpperCase().match(/[A-H]/g) || [])]
    .sort()
    .join('')
}

function isCorrectAnswer(question, userAnswer) {
  if (question.type === 'single' || question.type === 'multiple') {
    return normalizeChoice(userAnswer) === normalizeChoice(question.answer)
  }
  if (question.type === 'judge') {
    const answer = String(question.answer).includes('错') ? '错' : '对'
    return String(userAnswer) === answer
  }
  const accepted = String(question.answer).split(/[|｜]/).map(normalizeText).filter(Boolean)
  return accepted.includes(normalizeText(userAnswer))
}

function usesImmediateSubmission(type) {
  return type === 'single' || type === 'judge'
}

function matchesQuestionGroup(type, group) {
  if (group === 'choice') return type === 'single' || type === 'multiple'
  return type === group
}

function createResumeSnapshot(session) {
  const advance = Boolean(session.autoAdvancing)
  return {
    ids: [...session.ids],
    title: String(session.title || '练习'),
    index: advance ? session.index + 1 : session.index,
    displayStart: Number(session.displayStart || 1),
    displayTotal: Number(session.displayTotal || session.ids.length),
    answer: advance ? '' : String(session.answer || ''),
    submitted: advance ? false : Boolean(session.submitted),
    results: (session.results || []).map(result => ({ ...result })),
    correct: Number(session.correct || 0),
    wrong: Number(session.wrong || 0)
  }
}

function isResumeAvailable(saved) {
  return Boolean(saved && Array.isArray(saved.ids) && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < saved.ids.length)
}

function shuffled(items, random = Math.random) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[result[index], result[target]] = [result[target], result[index]]
  }
  return result
}

global.QuizCore = { normalizeText, normalizeChoice, isCorrectAnswer, usesImmediateSubmission, matchesQuestionGroup, createResumeSnapshot, isResumeAvailable, shuffled }
})(globalThis)
