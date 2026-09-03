// Production builds replace this marker with a hash of every application asset.
const CACHE_REVISION = '__PWA_CACHE_REVISION__'
const CACHE_PREFIX = `huadian-quiz:${new URL(self.registration.scope).pathname}:`
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_REVISION}`
const APP_SHELL = [
  './', './index.html', './styles.css', './core.js', './main.js', './pwa.js',
  './banks-data.js', './regulations-data.js', './manifest.webmanifest',
  './assets/icon.svg', './assets/icon.png', './assets/icon-192.png'
]
const SHELL_URLS = new Set(APP_SHELL.map(path => new URL(path, self.location).href))

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll([...SHELL_URLS].map(url => new Request(url, { cache: 'reload' })))
  ))
})

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return
  url.search = ''
  // Only cache application resources. Other sites on this Pages origin are untouched.
  if (!SHELL_URLS.has(url.href) && event.request.mode !== 'navigate') return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(url.href)
    if (cached) return cached
    try {
      return await fetch(event.request)
    } catch {
      if (event.request.mode === 'navigate') {
        const shell = await cache.match(new URL('./index.html', self.location).href)
        if (shell) return shell
      }
      return new Response('Offline resource unavailable', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
  })())
})
