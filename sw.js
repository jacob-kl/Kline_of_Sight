// ─────────────────────────────────────────────────────────
// Kline of Sight — Service Worker
// Bump CACHE version with each deploy so "Update available"
// banner appears automatically for existing users.
// ─────────────────────────────────────────────────────────
const CACHE = 'kos-v5';   // ← increment this on each deploy

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

const BYPASS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'cloudinary.com',
  'maplibre',
  'globe.gl',
  'arcgisonline.com',
  'cartocdn.com',
  'unpkg.com',
  '/api/config',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  // Don't skipWaiting here — we want the "update available" banner
  // so the user can decide when to reload. skipWaiting is triggered
  // by the main thread when the user clicks "Refresh".
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
  if (BYPASS.some(s => e.request.url.includes(s))) return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic')
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

// Main thread sends 'SKIP_WAITING' when user clicks the update banner
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
