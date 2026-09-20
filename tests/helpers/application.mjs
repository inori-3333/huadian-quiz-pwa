import fs from 'node:fs'
import vm from 'node:vm'

// Minimal DOM for deterministic controller, timer and persistence checks.
// Real DOM interactions and layout are verified separately in the browser.
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
  focus() {}
  closest() { return null }
}

const sources = ['core.js', 'banks-data.js', 'regulations-data.js', 'exam.js', 'main.js'].map(file =>
  fs.readFileSync(new URL(`../../app/${file}`, import.meta.url), 'utf8'))

export function createApplication(storage = new Map()) {
  const document = new Element()
  document.body = new Element()
  const app = document.querySelector('#app')
  const modal = document.querySelector('#modal-root')
  const timers = []
  const context = vm.createContext({
    document, console,
    window: { scrollTo() {} },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer },
    clearTimeout: timer => { if (timer) timer.cancelled = true }
  })
  const run = source => vm.runInContext(source, context)
  const plain = source => JSON.parse(JSON.stringify(run(source)))
  sources.forEach(run)
  return { document, app, modal, timers, storage, run, plain }
}
