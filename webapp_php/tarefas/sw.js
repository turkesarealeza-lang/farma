'use strict';
// Service worker: shows push notifications, handles their buttons, and caches the app shell.

const CACHE = 'tarefas-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Network first so updates show up right away; cache only as offline fallback. The API is never cached.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('api.php')) return;
  e.respondWith(fetch(e.request)
    .then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});

async function notifyClients(msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach((c) => c.postMessage(msg));
  return list;
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Tarefas', body: e.data?.text() }; }
  const opts = {
    body: d.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    data: { id: d.id || 0 },
  };
  if (d.id) {
    // One notification per task: each nag replaces the previous one but still rings.
    Object.assign(opts, {
      tag: 'task-' + d.id,
      renotify: true,
      requireInteraction: true,
      actions: [{ action: 'done', title: '✅ Feito' }, { action: 'snooze', title: '⏰ 30 min' }],
    });
  }
  e.waitUntil(Promise.all([self.registration.showNotification(d.title || 'Tarefas', opts), notifyClients({ type: 'refresh' })]));
});

self.addEventListener('notificationclick', (e) => {
  const id = e.notification.data?.id;
  e.notification.close();

  if (id && (e.action === 'done' || e.action === 'snooze')) {
    const body = e.action === 'done' ? { id, action: 'done' } : { id, action: 'snooze', minutes: 30 };
    e.waitUntil(fetch('api.php?a=act', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Tarefas': '1' },
      body: JSON.stringify(body),
    }).then(() => notifyClients({ type: 'refresh' })).catch(() => self.clients.openWindow('./?t=' + id)));
    return;
  }

  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (list.length) {
      list[0].postMessage({ type: 'open', id });
      return list[0].focus();
    }
    return self.clients.openWindow(id ? './?t=' + id : './');
  })());
});
