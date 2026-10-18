self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body:event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Novo pedido — Tio Nan', {
    body:data.body || 'Um novo pedido chegou pelo site.',
    icon:'/favicon-admin.png',
    badge:'/favicon-admin.png',
    tag:data.tag || 'tio-nan-novo-pedido',
    renotify:true,
    data:{ url:data.url || '/admin.html#pedidos' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/admin.html#pedidos', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type:'window', includeUncontrolled:true }).then(windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) return existing.focus().then(() => existing.navigate(target));
    return clients.openWindow(target);
  }));
});
