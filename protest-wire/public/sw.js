// Minimal service worker: makes the app installable (needed for "Share → Protest Wire").
// It does not cache anything; every request goes to the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
