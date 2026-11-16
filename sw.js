
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Destr Connect', body: 'Напоминание', url: '/admin' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    try {
      data.body = event.data.text();
    } catch (__) {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Destr Connect', {
      body: data.body || '',
      data: { url: data.url || '/admin' },
      badge: '/images/logoPWA.png',
      icon: '/images/logoPWA.png'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin';
  event.waitUntil(clients.openWindow(url));
});
