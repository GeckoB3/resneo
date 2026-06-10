// v2: drop v1 entries cached before logout started purging this store —
// the activate handler deletes every cache that is not CACHE_NAME.
const CACHE_NAME = 'reserve-ni-daysheet-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isDaySheetPage(url) {
  return url.pathname.includes('/dashboard/day-sheet');
}

function isDaySheetApi(url) {
  return url.pathname.startsWith('/api/venue/day-sheet') || url.pathname.startsWith('/api/venue/bookings');
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (!isDaySheetPage(url) && !isDaySheetApi(url)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses only: a 401/redirect cached here would be
        // replayed to whoever uses this browser next time the network fails.
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
