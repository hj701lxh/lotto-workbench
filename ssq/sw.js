/* 双色球工作台 Service Worker：静态资源缓存优先，API 网络优先 */
const CACHE = 'ssq-wb-v2-' + '20260908-hidebar';
const STATIC = ['./', './index.html', './app.js?v=5', './stats.js?v=5', './snapshot.js?v=5',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    // API：网络优先，失败回缓存
    e.respondWith(fetch(e.request).then((r) => {
      const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r;
    }).catch(() => caches.match(e.request)));
  } else {
    // 静态：网络优先，失败回缓存（确保 app.js 始终是最新版本）
    e.respondWith(fetch(e.request).then((r) => {
      const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r;
    }).catch(() => caches.match(e.request)));
  }
});
