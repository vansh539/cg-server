const CACHE_NAME = 'aaral-static-v1';
const STATIC_PATHS = ['/styles.css', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_PATHS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isStaticAsset = url.pathname === '/styles.css'
    || url.pathname === '/manifest.json'
    || url.pathname.startsWith('/assets/');
  if (!isStaticAsset) return; // never intercept HTML pages or /api/* — ledger data must always be live

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
