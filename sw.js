/* 双工作台顶层入口 Service Worker：网络优先，避免破坏子工作台的 SW */
const CACHE = 'dual-wb-v1-' + '20260909-initial';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE && !k.startsWith('ssq-') && !k.startsWith('dlt-')).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // 不缓存顶层入口，直接网络
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request)),
  );
});