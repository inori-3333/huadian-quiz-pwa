const CACHE_NAME = 'huadian-quiz-v1.3.0'
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './core.js',
  './main.js',
  './banks-data.js',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon.png',
  './assets/icon-192.png'
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL.map(path => new URL(path, self.location).href)))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response
        const copy = response.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
        return response
      })
    }).catch(() => caches.match(new URL('./index.html', self.location).href))
  )
})
