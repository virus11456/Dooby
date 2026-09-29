// Dooby web app service worker (registered by app.html with scope /dooby/app).
// Caches the app shell so the installed app opens instantly and still renders
// offline; data requests (Supabase, favicons) always go to the network.
const VERSION = 'dooby-app-v1';
const SHELL = ['/dooby/app', '/vendor/supabase-js-2.116.0.js', '/app.webmanifest', '/icons/icon48.png', '/icons/icon128.png', '/icons/icon192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, Google favicons, etc. go straight to the network

  // Navigations: network first (so updates land), fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put('/dooby/app', res.clone())); return res; })
      .catch(() => caches.match('/dooby/app')));
    return;
  }
  // Same-origin assets: cache first, refresh in the background.
  event.respondWith(caches.match(req).then((hit) => {
    const refresh = fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; }).catch(() => hit);
    return hit || refresh;
  }));
});
