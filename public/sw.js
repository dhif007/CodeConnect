const CACHE_NAME = "codeconnect-v1";

const APP_SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

/*
 * =========================================================
 * INSTALL
 * =========================================================
 */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(APP_SHELL);
      })
  );

  self.skipWaiting();
});

/*
 * =========================================================
 * ACTIVATE
 * =========================================================
 */

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => {
        return Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        );
      })
  );

  self.clients.claim();
});

/*
 * =========================================================
 * FETCH
 * =========================================================
 */

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);

  /*
   * Jangan cache Socket.IO.
   * Real-time connection harus selalu ke server.
   */
  if (url.pathname.startsWith("/socket.io/")) {
    return;
  }

  /*
   * Jangan cache API.
   * Room, QR dan data chat harus selalu terbaru.
   */
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        /*
         * Simpan versi terbaru ke cache.
         */
        const copy = response.clone();

        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(request, copy);
          });

        return response;
      })
      .catch(() => {
        /*
         * Kalau internet mati,
         * coba ambil dari cache.
         */
        return caches.match(request);
      })
  );
});
