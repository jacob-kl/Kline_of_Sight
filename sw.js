// ─────────────────────────────────────────────────────────
// Kline of Sight — Service Worker
// Strategy: cache-first for app shell, network-only for
// Firebase / Cloudinary / Mapbox API calls.
// ─────────────────────────────────────────────────────────
const CACHE = 'kos-v1';

const SHELL = [
  '/',
  '/index.html',
  '/css/base.css',
  '/css/layout.css',
  '/css/modals.css',
  '/css/upload.css',
  '/css/viewer.css',
  '/css/sharing.css',
  '/css/event-additions.css',
  '/js/firebase.js',
  '/js/auth.js',
  '/js/map.js',
  '/js/connections.js',
  '/js/events.js',
  '/js/viewer.js',
  '/js/lightbox.js',
  '/js/upload.js',
  '/js/sharing.js',
  '/icon-192.png',
  '/icon-512.png',
];

// Domains that must always go to network (live data)
const NETWORK_ONLY = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'cloudinary.com',
  '/api/config',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (NETWORK_ONLY.some(s => url.includes(s))) return; // bypass cache

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached); // offline fallback
      return cached || fresh;
    })
  );
});
