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

const EXAM_TYPE_ORDER = Object.freeze(['single', 'multiple', 'fill', 'judge'])
const EXAM_TYPE_NAMES = Object.freeze({ single: '单选题', multiple: '多选题', judge: '判断题', fill: '填空题' })
const DEFAULT_EXAM_POINTS = Object.freeze({ single: 1, multiple: 2, judge: 1, fill: 2 })
const DEFAULT_EXAM_COUNTS = Object.freeze({ single: 25, multiple: 20, judge: 20, fill: 20 })
const EXAM_MAX_POINTS = 100
const EXAM_SECTION_NUMERALS = Object.freeze(['一', '二', '三', '四'])

function roundExamScore(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

// Keep 0.5-point steps readable without floating-point artifacts (e.g. 2.5 * 20).
function formatExamScore(value) {
  const rounded = roundExamScore(value)
  return Number.isFinite(rounded) ? String(rounded) : '0'
}

function examSectionTitle(index, type) {
  const numeral = EXAM_SECTION_NUMERALS[index] || String(index + 1)
  return `第${numeral}部分 · ${EXAM_TYPE_NAMES[type] || '题目'}`
}

function examQuestionPools(questions) {
  const unique = [...new Map((questions || []).map(question => [question.id, question])).values()]
  return EXAM_TYPE_ORDER.map(type => ({
    type,
    name: EXAM_TYPE_NAMES[type],
    defaultCount: DEFAULT_EXAM_COUNTS[type],
    defaultPoints: DEFAULT_EXAM_POINTS[type],
    questions: unique.filter(question => question.type === type)
  }))
}

function defaultExamPlan(pools) {
  return pools.filter(pool => pool.questions.length).map(pool => ({
    type: pool.type,
    count: Math.min(Number(pool.defaultCount) || pool.questions.length, pool.questions.length),
    points: Number(pool.defaultPoints) || DEFAULT_EXAM_POINTS[pool.type] || 1
  }))
}

function normalizeExamSections(plan) {
  if (!Array.isArray(plan)) return []
  const seen = new Set()
  return plan.flatMap(item => {
    const type = String(item?.type || '')
    if (!EXAM_TYPE_NAMES[type] || seen.has(type)) return []
    seen.add(type)
    return [{ type, count: Number(item.count), points: roundExamScore(item.points) }]
  })
}

function validateExamSections(pools, plan) {
  if (!Array.isArray(plan) || !plan.length) return ['请至少选择一种题型']
  const errors = []
  const seen = new Set()
  const poolByType = new Map((pools || []).map(pool => [pool.type, pool]))
  for (const item of plan) {
    const type = String(item?.type || '')
    const name = EXAM_TYPE_NAMES[type]
    if (!name) { errors.push('题型无效'); continue }
    if (seen.has(type)) { errors.push(`${name}重复设置`); continue }
    seen.add(type)
    const available = poolByType.get(type)?.questions.length || 0
    if (!available) { errors.push(`当前题库没有${name}，请取消选择`); continue }
    const count = Number(item.count)
    if (!Number.isInteger(count) || count < 1) errors.push(`${name}抽题数需为 1 以上的整数`)
    else if (count > available) errors.push(`${name}最多可抽 ${available} 题（当前设置 ${count} 题）`)
    const points = Number(item.points)
    if (!Number.isFinite(points) || points <= 0 || points > EXAM_MAX_POINTS || Math.abs(points * 2 - Math.round(points * 2)) > 1e-9) {
      errors.push(`${name}每题分值需为 0.5-${EXAM_MAX_POINTS} 之间、以 0.5 为步长的数值`)
    }
  }
  return errors
}

function prepareExamSections(pools, plan) {
  const requested = plan === undefined || plan === null ? defaultExamPlan(pools) : plan
  const errors = validateExamSections(pools, requested)
  const sections = normalizeExamSections(requested).map((section, index) => ({
    ...section,
    title: examSectionTitle(index, section.type)
  }))
  return { sections, errors }
}

function createExamPaper(questions, plan, random = Math.random) {
  // Accept the former createExamPaper(questions, random) call shape as well.
  if (typeof plan === 'function') { random = plan; plan = undefined }
  const pools = examQuestionPools(questions)
  const { sections, errors } = prepareExamSections(pools, plan)
  if (errors.length) throw new Error(errors[0])
  const poolByType = new Map(pools.map(pool => [pool.type, pool]))
  // Freeze the paper's content in a snapshot so later bank edits cannot change
  // an unfinished exam's marking or a completed exam's answer review.
  return sections.flatMap(section => {
    const pool = poolByType.get(section.type)
    return shuffled(pool.questions, random).slice(0, section.count).map(question => ({
      ...question, options: (question.options || []).map(option => ({ ...option }))
    }))
  })
}

// Legacy papers did not store sections; preserve their paper order and the
// original per-type default points so saved unfinished exams keep working.
function deriveExamSections(questions) {
  const counts = new Map()
  for (const question of questions || []) counts.set(question.type, (counts.get(question.type) || 0) + 1)
  return [...counts].map(([type, count], index) => ({
    type,
    title: examSectionTitle(index, type),
    count,
    points: DEFAULT_EXAM_POINTS[type] || 1
  }))
}

function gradeExamPaper(questions, answers, planSections) {
  const paper = Array.isArray(questions) ? questions : []
  const pools = examQuestionPools(paper)
  let sections = deriveExamSections(paper)
  if (Array.isArray(planSections) && planSections.length) {
    const prepared = prepareExamSections(pools, planSections)
    if (!prepared.errors.length) sections = prepared.sections
  }
  const pointsByType = new Map(sections.map(section => [section.type, section.points]))
  const results = paper.map((question, index) => {
    const userAnswer = String(answers?.[index] ?? '')
    const unanswered = !userAnswer.trim()
    const correct = !unanswered && isCorrectAnswer(question, userAnswer)
    const points = pointsByType.get(question.type) ?? DEFAULT_EXAM_POINTS[question.type] ?? 1
    return { id: question.id, index, type: question.type, userAnswer, correct, unanswered, points, score: correct ? points : 0 }
  })
  const reportSections = sections.map(section => {
    const entries = results.filter(result => result.type === section.type)
    return {
      ...section,
      count: entries.length,
      score: roundExamScore(entries.reduce((sum, result) => sum + result.score, 0)),
      correct: entries.filter(result => result.correct).length
    }
  })
  const correct = results.filter(result => result.correct).length
  return {
    results, sections: reportSections, correct, wrong: results.length - correct,
    unanswered: results.filter(result => result.unanswered).length,
    score: roundExamScore(results.reduce((sum, result) => sum + result.score, 0)),
    totalScore: roundExamScore(reportSections.reduce((sum, section) => sum + section.count * section.points, 0))
  }
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
  if (['youththeory2', 'dispatchbasic', 'dispatchwind', 'dispatchpv', 'dispatchall'].includes(bankId)) return []
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

// Literal keyword search across the complete references, independent of question banks.
function searchRegulations(query, data, source = 'all') {
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return data.clauses.filter(entry => {
    if (source !== 'all' && entry.source !== source) return false
    const text = `${entry.ref} ${entry.text}`.toLowerCase()
    return terms.every(term => text.includes(term))
  })
}

global.QuizCore = {
  normalizeText, normalizeChoice, isCorrectAnswer, usesImmediateSubmission, matchesQuestionGroup,
  normalizeQuestionProgress, recordQuestionResult, createResumeSnapshot, isResumeAvailable, shuffled,
  EXAM_TYPE_ORDER, EXAM_TYPE_NAMES, DEFAULT_EXAM_POINTS, DEFAULT_EXAM_COUNTS,
  examQuestionPools, defaultExamPlan, normalizeExamSections, validateExamSections, prepareExamSections,
  createExamPaper, deriveExamSections, gradeExamPaper, formatExamScore,
  normalizeSearchText, regulationTokens, regulationReferences, sourceIdsForQuestion, findRegulationMatches, searchRegulations
}
})(globalThis)
