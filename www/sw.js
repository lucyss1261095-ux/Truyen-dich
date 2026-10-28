/* Service worker: chỉ dùng khi chạy bằng trình duyệt (PWA). Lưu sẵn các file của app để dùng offline. */
var CACHE = "truyendich-v5";
var FILES = ["./", "index.html", "style.css", "engine.js", "samples.js", "ai.js", "zip.js", "chapters.js", "webtext.js", "app.js", "books.js", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return; // không chặn gọi API AI
  e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
});
