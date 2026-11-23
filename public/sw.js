const CACHE_NAME = 'tipiz-pwa-v5';
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/css/style.css',
  '/js/api.js',
  '/js/app.js',
  '/js/pwa.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('tipiz-pwa-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/stream/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        return (await caches.match('/offline.html')) || Response.error();
      })
    );
    return;
  }

  if (
    !url.pathname.startsWith('/css/') &&
    !url.pathname.startsWith('/js/') &&
    !url.pathname.startsWith('/icons/') &&
    url.pathname !== '/manifest.webmanifest'
  ) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
          );
        }
        return response;
      });
    })
  );
});
