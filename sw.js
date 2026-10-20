
"use strict";

const CACHE_NAME = "koreanstream-static-v1";

const APP_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.allSettled(
        APP_FILES.map(file => cache.add(file))
      );
    })
  );

  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key =>
            key.startsWith("koreanstream-static-") &&
            key !== CACHE_NAME
          )
          .map(key => caches.delete(key))
      )
    )
  );

  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cache only this website's own files.
  if (url.origin !== self.location.origin) return;

  // Do not cache API responses or navigation requests.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedPage = await caches.match("./index.html");
        return cachedPage || Response.error();
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      const networkRequest = fetch(request).then(response => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, copy);
          });
        }

        return response;
      });

      return cachedResponse || networkRequest;
    })
  );
});
