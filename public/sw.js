const CACHE_NAME = "codeconnect-v2";

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
   * Socket.IO harus selalu online.
   */
  if (
    url.pathname.startsWith("/socket.io/")
  ) {
    return;
  }

  /*
   * API tidak boleh memakai cache lama.
   */
  if (
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  /*
   * Untuk navigasi halaman:
   * coba network dulu,
   * lalu fallback ke index.html.
   */
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();

          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(
                "/index.html",
                copy
              );
            });

          return response;
        })
        .catch(() => {
          return caches.match(
            "/index.html"
          );
        })
    );

    return;
  }

  /*
   * Untuk CSS, JS, icon, manifest:
   * network-first supaya update terbaru
   * lebih cepat masuk.
   */
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (
          !response ||
          response.status !== 200 ||
          response.type === "opaque"
        ) {
          return response;
        }

        const copy =
          response.clone();

        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(
              request,
              copy
            );
          });

        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});
