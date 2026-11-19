/* SchoolSync service worker: offline app shell + runtime caching. Bump VERSION on each deploy. */
const VERSION = 'v1';
const SHELL = 'schoolsync-shell-' + VERSION, RUNTIME = 'schoolsync-runtime-' + VERSION;
const ASSETS = ['./', 'index.html', 'css/styles.css', 'js/config.js', 'js/icons.js', 'js/store.js', 'js/app.js', 'manifest.webmanifest', 'assets/logo.svg', 'assets/icon-192.png', 'assets/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, RUNTIME].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.pathname.startsWith('/.netlify/') || /supabase\.co$/.test(url.hostname)) return;   // never cache API/auth/email calls
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { const c = r.clone(); caches.open(SHELL).then(ch => ch.put('index.html', c)); return r; }).catch(() => caches.match('index.html')));
    return;
  }
  // stale-while-revalidate for static files, fonts and the Supabase JS bundle
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) { const c = r.clone(); caches.open(url.origin === location.origin ? SHELL : RUNTIME).then(ch => ch.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '#/home';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(cs => { if (cs.length) { cs[0].focus(); cs[0].navigate(new URL(link, cs[0].url).href); } else self.clients.openWindow('./' + link); }));
});
