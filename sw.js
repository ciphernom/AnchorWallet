self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open('anchor-v1').then(cache => cache.addAll([
      './',
      './index.html',
      './manifest.json',
      './js/app.js'
    ]))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then(resp => resp || fetch(e.request))
  );
});
