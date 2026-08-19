/* Service Worker: App-Huelle offline verfuegbar halten.
   Minen-Daten kommen immer live aus dem Netz (nie aus diesem Cache). */
const CACHE = 'owner-radar-v3';
const SHELL = [
  './', './index.html',
  './assets/css/app.css',
  './assets/js/i18n.js', './assets/js/util.js', './assets/js/cluster.js', './assets/js/world.js', './assets/js/store.js',
  './assets/js/api.js', './assets/js/app.js',
  './manifest.webmanifest', './assets/icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Nur eigene statische Dateien; API und Kartenkacheln immer direkt aus dem Netz.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(hit => {
      const net = fetch(e.request)
        .then(res => {
          if (res && res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => hit);
      return hit || net;    // sofort aus dem Cache, Aktualisierung laeuft im Hintergrund
    })
  );
});
