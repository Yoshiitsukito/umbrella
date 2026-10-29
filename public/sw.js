const OFFLINE = `<!DOCTYPE html><html lang="mn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>White Queen</title>
<style>body{margin:0;display:grid;place-content:center;min-height:100vh;background:#0b1016;color:#e9eef3;font:17px system-ui,sans-serif;text-align:center}small{color:#8a97a5}</style></head>
<body><p>Сервертэй холбогдож чадсангүй.<br><small>Холболт сэргэхэд автоматаар нээгдэнэ.</small></p><script>setTimeout(()=>location.reload(),10000)</script></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
});
