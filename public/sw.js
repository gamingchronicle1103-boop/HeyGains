// HeyGains service worker — app-shell cache only. API calls (/api/*) are
// never cached: quotes, trades and state must always be live. If this
// worker fails to install or the cache is unavailable, the app still loads
// from the network as before — the worker is an enhancement, not a gate.
'use strict';
const CACHE = 'heygains-shell-v3'; // bump on every deploy so a shipped fix takes effect on the NEXT load, not the one after
const SHELL = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.json', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', (e) => {
  // Fail LOUDLY: the old code swallowed addAll failures, so a broken shell
  // silently kept the old worker forever. Now a failed install rejects, the
  // old worker stays in place, and the error is visible in the console.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()).catch((err) => { console.error('[HeyGains SW] install failed, keeping old worker:', err); throw err; }));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return; // cross-origin + non-GET: network only
  if (url.pathname.startsWith('/api/')) return; // never cache API calls
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}); }
        return res;
      }).catch(() => hit);
      return hit || net; // stale-while-revalidate for shell assets
    })
  );
});
