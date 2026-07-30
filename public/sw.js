/**
 * Service Worker（P2 PWA，零依赖）
 * 策略：stale-while-revalidate —— 同源 GET 优先返回缓存，后台静默更新。
 * 不预缓存带哈希的构建产物（文件名会变），改为运行时按需缓存，避免版本漂移。
 */
const CACHE = 'ai-ledger-v1';
const APP_SHELL = ['/', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 仅缓存同源资源

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      // 先返回缓存（若有），后台更新；离线时回退到缓存
      return cached || network;
    }),
  );
});
