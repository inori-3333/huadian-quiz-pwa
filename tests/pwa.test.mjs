import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../app/sw.js', import.meta.url), 'utf8')
const scope = 'https://example.github.io/huadian-quiz-pwa/'
const prefix = 'huadian-quiz:/huadian-quiz-pwa/:'
const name = `${prefix}__PWA_CACHE_REVISION__`
const handlers = new Map()
const cached = new Map()
let networkAvailable = true
let skipped = false
let claimed = false
let installedRequests = []
const keys = new Set([`${prefix}old`, 'unrelated-app', 'huadian-quiz:/another-project/:old'])
const cache = {
  async addAll(requests) { installedRequests = requests; requests.forEach(request => cached.set(request.url, new Response(request.url))) },
  async match(url) { return cached.get(url)?.clone() }
}
vm.runInNewContext(source, {
  URL, Request, Response,
  self: {
    registration: { scope }, location: new URL('sw.js', scope),
    addEventListener: (type, listener) => handlers.set(type, listener),
    skipWaiting: async () => { skipped = true }, clients: { claim: async () => { claimed = true } }
  },
  caches: {
    open: async key => { assert.equal(key, name); keys.add(key); return cache },
    keys: async () => [...keys], delete: async key => keys.delete(key)
  },
  fetch: async () => { if (!networkAvailable) throw new Error('offline'); return new Response('network') }
})

async function lifecycle(type, data) {
  let work
  handlers.get(type)({ data, waitUntil: promise => { work = promise } })
  await work
}
function fetchEvent(path, mode = 'cors', method = 'GET') {
  let response
  handlers.get('fetch')({ request: { url: new URL(path, scope).href, method, mode }, respondWith: promise => { response = promise } })
  return response
}

await lifecycle('install')
assert.equal(skipped, false, 'Installing an update must not interrupt practice')
assert.ok(installedRequests.length >= 12)
for (const request of installedRequests) {
  assert.equal(request.cache, 'reload', 'Precache must bypass stale HTTP responses')
  const relative = request.url.slice(scope.length) || 'index.html'
  assert.ok(fs.existsSync(new URL(`../app/${relative}`, import.meta.url)), `Missing offline asset: ${relative}`)
}
const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8')
for (const [, asset] of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png|svg|webmanifest))"/g)) {
  assert.ok(cached.has(new URL(asset, scope).href), `${asset} is missing from precache`)
}
await lifecycle('activate')
assert.ok(claimed)
assert.ok(!keys.has(`${prefix}old`))
assert.ok(keys.has('unrelated-app'))
assert.ok(keys.has('huadian-quiz:/another-project/:old'), 'Keep other GitHub Pages projects cached')
await lifecycle('message', { type: 'OTHER_MESSAGE' })
assert.equal(skipped, false)
await lifecycle('message', { type: 'SKIP_WAITING' })
assert.ok(skipped)

networkAvailable = false
for (const asset of ['?installed=1', 'index.html', 'main.js', 'pwa.js', 'banks-data.js', 'regulations-data.js', 'styles.css?version=2']) {
  assert.equal((await fetchEvent(asset)).status, 200, `Cannot use ${asset} offline`)
}
assert.equal(await (await fetchEvent('some-page', 'navigate')).text(), `${scope}index.html`)
assert.equal(fetchEvent('missing.js'), undefined, 'Do not return HTML for missing scripts')
assert.equal(fetchEvent('https://external.example/script.js'), undefined)
assert.equal(fetchEvent('../other-project/index.html', 'navigate'), undefined)
assert.equal(fetchEvent('main.js', 'cors', 'POST'), undefined)
cached.delete(`${scope}styles.css`)
assert.equal((await fetchEvent('styles.css')).status, 503, 'Missing styles must not get an HTML fallback')
networkAvailable = true
assert.equal(await (await fetchEvent('styles.css')).text(), 'network')

const manifest = JSON.parse(fs.readFileSync(new URL('../app/manifest.webmanifest', import.meta.url)))
for (const field of ['id', 'scope', 'start_url']) assert.equal(manifest[field], './')
for (const icon of manifest.icons) {
  const bytes = fs.readFileSync(new URL(`../app/${icon.src}`, import.meta.url))
  assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes)
}
console.log('PWA tests passed: complete precache, subpath deployment, safe updates, cache isolation and offline navigation.')
