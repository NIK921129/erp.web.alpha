const CACHE_NAME = 'abc-erp-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js'
];

// Install event: Cache our core frontend files
self.addEventListener('install', event => {
  self.skipWaiting(); // Force the new service worker to activate immediately
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
    }).then(() => self.clients.claim()) // Take control of all open pages immediately
  );
});

// Fetch event: Network First, fallback to cache (Ideal for rapid updates)
self.addEventListener('fetch', event => {
  // We only want to cache the UI files, NOT the API calls to your Render backend
  if (!event.request.url.startsWith(self.location.origin) || event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request).then(networkResponse => {
      // Update the cache with the fresh version
      const responseClone = networkResponse.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
      return networkResponse;
    }).catch(() => caches.match(event.request))
  );
});