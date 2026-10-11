/* World Pulse service worker: offline app shell + network-first news data. */
const BUILD = "__BUILD__";
const SHELL = `wp-shell-${BUILD}`;
const DATA = "wp-data";
const SHELL_FILES = [
  "./", "index.html", "styles.css", "app.js", "config.js", "land.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon.svg", "story.html", "story.css", "story.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("wp-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // publisher images and links go straight to the network

  if (url.pathname.includes("/api/")) {
    // News: always try the network first, fall back to the last copy when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
    return;
  }

  // App shell: serve from cache instantly, refresh in the background.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      const net = fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit || caches.match("index.html"));
      return hit || net;
    }),
  );
});
