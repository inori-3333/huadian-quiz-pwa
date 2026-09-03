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

function normalizeQuestionProgress(state = {}) {
  const wrongCount = Math.max(0, Number(state.wrongCount || 0))
  return {
    ...state,
    attempts: Math.max(0, Number(state.attempts || 0)),
    wrongCount,
    favorite: Boolean(state.favorite),
    correctCount: Math.max(0, Number(state.correctCount || 0)),
    // Older versions only stored the cumulative wrong count. Keep those
    // questions in the actionable group until the user answers them again.
    currentWrong: typeof state.currentWrong === 'boolean' ? state.currentWrong : wrongCount > 0
  }
}

function recordQuestionResult(state, correct) {
  const next = normalizeQuestionProgress(state)
  next.attempts += 1
  next.currentWrong = !correct
  if (correct) next.correctCount += 1
  else next.wrongCount += 1
  return next
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

const REGULATION_STOP_BIGRAMS = new Set([
  '依据', '电力', '安全', '工作', '规程', '部分', '要求', '下列', '关于', '说法',
  '正确', '错误', '的是', '可以', '应当', '必须', '进行', '人员', '作业', '规定'
])

function normalizeSearchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/q\s*\/\s*chd\s*85(?:\.[12])?\s*[-—]?\s*2024/g, '')
    .replace(/《电力安全工作规程[^》]*》/g, '')
    .replace(/[\s　]+/g, '')
    .replace(/[，,。；;：:、（）()【】\[\]“”"'‘’《》<>？！?\/\\·—_-]/g, '')
}

function regulationTokens(value) {
  const normalized = normalizeSearchText(value)
  const tokens = new Set(normalized.match(/[a-z]+|\d+(?:\.\d+)?%?/g) || [])
  for (const run of normalized.match(/[\u3400-\u4dbf\u4e00-\u9fff]{2,}/g) || []) {
    for (let index = 0; index < run.length - 1; index += 1) {
      const token = run.slice(index, index + 2)
      if (!REGULATION_STOP_BIGRAMS.has(token)) tokens.add(token)
    }
  }
  return [...tokens]
}

function questionAnswerText(question) {
  if (question.type === 'single' || question.type === 'multiple') {
    const keys = new Set(normalizeChoice(question.answer).split(''))
    return (question.options || []).filter(option => keys.has(option.key)).map(option => option.text).join('；')
  }
  return question.answerRaw || question.answer || ''
}

function regulationReferences(value) {
  const raw = String(value ?? '').replace(/[（(][a-zA-Z][）)]\s*$/g, '').replace(/\s+[a-zA-Z][）)]\s*$/g, '')
  const table = raw.match(/表\s*([A-J]?\.?\d+(?:\.\d+)?)/i)
  if (table) return [table[1].replace(/^([A-J])(?=\d)/i, '$1.')]
  const annex = raw.match(/附录\s*([A-J])\s*(\d+(?:\.\d+)*)?/i)
  if (annex) return [annex[2] ? `${annex[1].toUpperCase()}.${annex[2]}` : `${annex[1].toUpperCase()}.`]
  const directAnnex = raw.match(/\b([A-J](?:\.\d+)+)\b/i)
  if (directAnnex) return [directAnnex[1].toUpperCase()]
  return [...raw.matchAll(/\d+(?:\.\d+)+/g)].map(match => match[0])
}

function sourceIdsForQuestion(bankId) {
  if (bankId === 'youththeory2') return []
  if (bankId === 'safety2024general') return ['general']
  if (bankId === 'safety2024coal') return ['coal']
  return ['general', 'coal']
}

function findRegulationMatches(question, bankId, regulationData, limit = 3) {
  const allowedSources = new Set(sourceIdsForQuestion(bankId))
  if (!allowedSources.size || !regulationData || !Array.isArray(regulationData.clauses)) return []
  const candidates = regulationData.clauses.filter(entry => allowedSources.has(entry.source))
  if (!candidates.length) return []

  const answerText = questionAnswerText(question)
  const optionText = question.sourceRef ? '' : (question.options || []).map(option => option.text).join(' ')
  const query = `${question.stem || ''} ${answerText} ${optionText}`
  const tokens = regulationTokens(query)
  const answerNeedle = normalizeSearchText(answerText)
  const references = regulationReferences(question.sourceRef)
  const searchable = candidates.map(entry => ({ entry, text: normalizeSearchText(entry.text) }))
  const frequencies = new Map(tokens.map(token => [token, searchable.reduce((count, item) => count + Number(item.text.includes(token)), 0)]))
  const usefulTokens = tokens.filter(token => {
    const frequency = frequencies.get(token) || 0
    return frequency > 0 && (/[\d]/.test(token) || frequency <= Math.max(80, candidates.length * 0.2))
  })
  const weights = new Map(usefulTokens.map(token => {
    const rarity = 1 + Math.log((candidates.length + 1) / ((frequencies.get(token) || 0) + 1))
    return [token, rarity * (/[\d]/.test(token) ? 1.8 : 1)]
  }))
  const totalWeight = [...weights.values()].reduce((sum, weight) => sum + weight, 0) || 1

  return searchable.map(({ entry, text }) => {
    const matchedWeight = usefulTokens.reduce((sum, token) => sum + (text.includes(token) ? weights.get(token) : 0), 0)
    const characterScore = matchedWeight / totalWeight
    const answerBoost = answerNeedle.length > 1 && text.includes(answerNeedle) ? 0.45 : 0
    const referenceMatch = references.some(reference => reference.endsWith('.') ? entry.ref.startsWith(reference) : entry.ref === reference)
    return { ...entry, score: characterScore + answerBoost + (referenceMatch ? 1.5 : 0), referenceMatch }
  }).filter(match => match.referenceMatch || match.score >= 0.12)
    .sort((left, right) => right.score - left.score || Number(right.referenceMatch) - Number(left.referenceMatch) || left.text.length - right.text.length)
    .slice(0, Math.max(0, limit))
}

global.QuizCore = {
  normalizeText, normalizeChoice, isCorrectAnswer, usesImmediateSubmission, matchesQuestionGroup,
  normalizeQuestionProgress, recordQuestionResult, createResumeSnapshot, isResumeAvailable, shuffled,
  normalizeSearchText, regulationTokens, regulationReferences, sourceIdsForQuestion, findRegulationMatches
}
})(globalThis)
