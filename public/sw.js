// Minimal service worker — enables "Add to Home Screen" / install prompts.
// Intentionally does not cache aggressively, since Augustus's content is dynamic.

const CACHE_NAME = "augustus-shell-v1";
const SHELL_FILES = ["/", "/index.html", "/app.js", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", (event) => {
  // Network-first for the API; cache-first fallback for shell files only.
  if (event.request.url.includes("/api/")) return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
