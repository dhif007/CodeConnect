/*
 * =========================================================
 * CODECONNECT SERVICE WORKER
 * =========================================================
 */

const CACHE_NAME = "codeconnect-v3";
const STATIC_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json"
];


/*
 * =========================================================
 * INSTALL
 * =========================================================
 */

self.addEventListener("install", event => {

  event.waitUntil(

    caches
      .open(CACHE_NAME)
      .then(cache => {

        return cache.addAll(
          STATIC_FILES
        );

      })

  );

  self.skipWaiting();

});


/*
 * =========================================================
 * ACTIVATE
 * =========================================================
 */

self.addEventListener("activate", event => {

  event.waitUntil(

    caches
      .keys()
      .then(keys => {

        return Promise.all(

          keys
            .filter(
              key =>
                key !== CACHE_NAME
            )
            .map(
              key =>
                caches.delete(key)
            )

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

self.addEventListener("fetch", event => {

  if (
    event.request.method !== "GET"
  ) {
    return;
  }

  event.respondWith(

    fetch(event.request)

      .then(response => {

        const copy =
          response.clone();

        caches
          .open(CACHE_NAME)
          .then(cache => {

            cache.put(
              event.request,
              copy
            );

          });

        return response;

      })

      .catch(() => {

        return caches.match(
          event.request
        );

      })

  );

});


/*
 * =========================================================
 * PUSH NOTIFICATION
 * =========================================================
 */

self.addEventListener("push", event => {

  console.log(
    "[SW] Push received"
  );

  let data = {};

  if (event.data) {

    try {

      data =
        event.data.json();

    } catch (error) {

      data = {
        body:
          event.data.text()
      };

    }

  }


  const title =
    data.title ||
    "CodeConnect";


  const options = {

    body:
      data.body ||
      "You have a new message.",

    icon:
      "/icon-192.png",

    badge:
      "/icon-192.png",

    tag:
      data.tag ||
      "codeconnect-message",

    renotify: true,

    data: {

      url:
        data.url ||
        "/",

      roomCode:
        data.roomCode ||
        null

    }

  };


  event.waitUntil(

    self.registration
      .showNotification(
        title,
        options
      )

  );

});


/*
 * =========================================================
 * NOTIFICATION CLICK
 * =========================================================
 */

self.addEventListener(
  "notificationclick",
  (event) => {

    event.notification.close();

    const targetUrl =
      event.notification
        .data?.url || "/";

    event.waitUntil(
      clients
        .matchAll({
          type: "window",
          includeUncontrolled: true
        })
        .then(async (clientList) => {

          /*
           * Jika PWA sudah terbuka,
           * arahkan window tersebut
           * ke room yang benar.
           */
          for (
            const client
            of clientList
          ) {
            if (
              "navigate" in client &&
              "focus" in client
            ) {
              try {
                await client.navigate(
                  targetUrl
                );

                return client.focus();

              } catch (error) {
                console.error(
                  "[SW] Navigation failed:",
                  error
                );
              }
            }
          }

          /*
           * Jika PWA benar-benar tertutup,
           * buka window baru ke room.
           */
          if (
            clients.openWindow
          ) {
            return clients.openWindow(
              targetUrl
            );
          }

          return null;
        })
    );
  }
);
