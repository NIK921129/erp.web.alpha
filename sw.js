const CACHE_NAME = 'abc-erp-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js'
];

// Install event: Cache our core frontend files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
});

// Activate event: Clean up old caches if the version name changes
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
});

// Fetch event: Serve files from cache if available, otherwise fetch from network
self.addEventListener('fetch', event => {
  // We only want to cache the UI files, NOT the API calls to your Render backend
  if (!event.request.url.startsWith(self.location.origin) || event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then(cachedResponse => cachedResponse || fetch(event.request))
  );
});