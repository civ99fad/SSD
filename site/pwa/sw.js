// خدمة التطبيق: الشبكة أولًا دائمًا (البيانات حيّة)، والنسخة المخزّنة للاحتياط عند انقطاع الاتصال فقط.
// لا تُخزَّن طلبات GitHub ولا «الحارس» ولا أي طلب غير GET.
const CACHE = 'cd-app-v1';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || /version\.json$/.test(u.pathname)) return;
  e.respondWith(
    fetch(r).then((res) => {
      if (res && res.ok && res.type === 'basic') { const c = res.clone(); caches.open(CACHE).then((x) => x.put(r, c)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(r).then((m) => m || (r.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
