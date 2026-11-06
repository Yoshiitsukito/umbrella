const OFFLINE = `<!DOCTYPE html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>White Queen</title>
<style>body{margin:0;display:grid;place-content:center;min-height:100vh;background:#0b1016;color:#e9eef3;font:17px system-ui,sans-serif;text-align:center}small{color:#8a97a5}</style></head>
<body><p>Сервертэй холбогдож чадсангүй.<br><small>Холболт сэргэхэд автоматаар нээгдэнэ.</small></p><script>setTimeout(()=>location.reload(),10000)</script></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const urgent = Boolean(data.urgent);
  event.waitUntil(
    self.registration.showNotification(data.title || "UMBRELLA", {
      body: data.body || "",
      tag: data.tag,
      icon: "/umbrella-logo.png",
      badge: "/queen-192.png",
      data: { url: data.url || "/" },
      requireInteraction: urgent,
      renotify: urgent && Boolean(data.tag),
      vibrate: urgent ? [400, 120, 400, 120, 400] : [120],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((client) => client.url.startsWith(self.location.origin) && !client.url.includes("/queen"));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
