const CACHE_NAME = "notes-cache-v2";
const CORE_ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(CORE_ASSETS);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    (async () => {
      const url = new URL(req.url);
      if (url.origin !== self.location.origin) return fetch(req);

      const cache = await caches.open(CACHE_NAME);
      const isNavigation = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
      const path = url.pathname;
      const isCoreFile =
        isNavigation ||
        path.endsWith("/app.js") ||
        path.endsWith("/style.css") ||
        path.endsWith("/index.html") ||
        path.endsWith("/manifest.webmanifest") ||
        path.endsWith("/icon.svg");

      const cached = await cache.match(req, { ignoreSearch: true });

      if (isCoreFile) {
        try {
          const res = await fetch(req, { cache: "no-store" });
          if (res.ok) cache.put(req, res.clone()).catch(() => {});
          return res;
        } catch {
          if (cached) return cached;
          throw new Error("offline");
        }
      }

      if (cached) {
        fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
          })
          .catch(() => {});
        return cached;
      }

      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })(),
  );
});
