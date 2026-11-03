// Camp camera feeds: demo CCTV scenes drawn on a canvas, this device's camera, or a stream the browser can open
// (MJPEG, snapshot, MP4/HLS video, an NVR web page). Feed nodes are kept across page repaints and moved into
// each `[data-feed]` slot, so a 15 s data refresh does not restart a stream.
import { CAMERA_URL_KINDS } from "./minecore.js";

const TZ_MS = 8 * 3600 * 1000;
const W = 480;
const H = 270;
const HORIZON = 104;

/** slot key -> { wrap, sig, cam, canvas?, video?, img?, timer?, scene? } */
const feeds = new Map();
let raf = 0;
let lastDraw = 0;
let sweepTimer = 0;
let deviceStream = null;
let deviceAsk = null;

const sigOf = (cam) => [cam.kind, cam.url, cam.every, cam.enabled, cam.zone, cam.name].join("|");

function setState(feed, state, message = "") {
  feed.wrap.dataset.state = state;
  feed.wrap.querySelector(".cam-msg").textContent = message;
}

/** Puts a live feed into every `[data-feed]` slot under `root`; `cameras` are the camp camera records. */
export function mountFeeds(root, cameras) {
  const byId = new Map(cameras.map((cam) => [cam.id, cam]));
  for (const slot of root.querySelectorAll("[data-feed]")) {
    const key = slot.dataset.feed;
    const cam = byId.get(key.split(":")[0]);
    if (!cam) continue;
    let feed = feeds.get(key);
    if (feed && feed.sig !== sigOf(cam)) {
      dropFeed(key);
      feed = null;
    }
    if (!feed) {
      feed = createFeed(cam, key.endsWith(":big") ? 2 : 1);
      feeds.set(key, feed);
    }
    if (feed.wrap.parentNode === slot) continue;
    slot.replaceChildren(feed.wrap);
    feed.video?.play().catch(() => {});
  }
  sweep();
  if (feeds.size && !sweepTimer) sweepTimer = setInterval(sweep, 1500);
  if ([...feeds.values()].some((feed) => feed.scene) && !raf) raf = requestAnimationFrame(loop);
}

/** Stops every feed, the camera light and the drawing loop. */
export function stopFeeds() {
  for (const key of [...feeds.keys()]) dropFeed(key);
  sweep();
}

/** The current frame of a feed as a PNG data URL, or null when the source does not allow it. */
export function snapshotOf(key) {
  const feed = feeds.get(key);
  if (!feed) return null;
  const source = feed.canvas || feed.video || feed.img;
  if (!source) return null;
  const width = feed.video?.videoWidth || feed.img?.naturalWidth || source.width;
  const height = feed.video?.videoHeight || feed.img?.naturalHeight || source.height;
  if (!width || !height) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    canvas.getContext("2d").drawImage(source, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export function feedElement(key) {
  return feeds.get(key)?.wrap || null;
}

function dropFeed(key) {
  const feed = feeds.get(key);
  if (!feed) return;
  clearInterval(feed.timer);
  if (feed.video) {
    feed.video.pause();
    feed.video.srcObject = null;
    feed.video.removeAttribute("src");
  }
  if (feed.img) feed.img.removeAttribute("src");
  if (feed.frame) feed.frame.src = "about:blank";
  feed.wrap.remove();
  feeds.delete(key);
}

/** Feeds whose slot has gone (page left, modal closed) are stopped; the device camera is released when unused. */
function sweep() {
  for (const [key, feed] of feeds) if (!feed.wrap.isConnected) dropFeed(key);
  if (deviceStream && ![...feeds.values()].some((feed) => feed.cam.kind === "device")) {
    for (const track of deviceStream.getTracks()) track.stop();
    deviceStream = null;
    deviceAsk = null;
  }
  if (!feeds.size) {
    clearInterval(sweepTimer);
    sweepTimer = 0;
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

function insecure(url) {
  return location.protocol === "https:" && url.startsWith("http:");
}

function createFeed(cam, scale) {
  const wrap = document.createElement("div");
  wrap.className = "cam-feed";
  wrap.innerHTML = `<span class="cam-msg" role="status"></span>`;
  const feed = { wrap, cam, sig: sigOf(cam) };
  if (!cam.enabled) {
    setState(feed, "off", "Унтраалттай");
    return feed;
  }
  if (CAMERA_URL_KINDS.includes(cam.kind) && insecure(cam.url || "")) {
    setState(feed, "error", "http:// хаягийг https хуудаснаас нээх боломжгүй. NVR-ийн https хаяг эсвэл прокси ашиглана уу.");
    return feed;
  }
  setState(feed, "wait", "Холбогдож байна…");
  if (cam.kind === "demo") {
    feed.canvas = document.createElement("canvas");
    feed.canvas.width = W * scale;
    feed.canvas.height = H * scale;
    feed.scene = makeScene(cam);
    wrap.prepend(feed.canvas);
    drawScene(feed, performance.now());
    setState(feed, "live");
  } else if (cam.kind === "device") {
    feed.video = mediaVideo();
    wrap.prepend(feed.video);
    openDevice()
      .then((stream) => {
        feed.video.srcObject = stream;
        feed.video.play().catch(() => {});
        setState(feed, "live");
      })
      .catch(() => setState(feed, "error", "Камер ашиглах зөвшөөрөл олгогдоогүй эсвэл камер олдсонгүй"));
  } else if (cam.kind === "mjpeg" || cam.kind === "snapshot") {
    feed.img = new Image();
    feed.img.alt = "";
    feed.img.decoding = "async";
    feed.img.referrerPolicy = "no-referrer";
    feed.img.addEventListener("load", () => setState(feed, "live"));
    feed.img.addEventListener("error", () => setState(feed, "error", "Урсгалд холбогдож чадсангүй"));
    wrap.prepend(feed.img);
    if (cam.kind === "snapshot") {
      const fresh = () => {
        const url = new URL(cam.url);
        url.searchParams.set("_t", Date.now());
        feed.img.src = url.href;
      };
      fresh();
      feed.timer = setInterval(() => feed.wrap.isConnected && fresh(), Math.max(1, cam.every || 2) * 1000);
    } else feed.img.src = cam.url;
  } else if (cam.kind === "video") {
    feed.video = mediaVideo();
    wrap.prepend(feed.video);
    if (/\.m3u8(\?|$)/i.test(cam.url) && !feed.video.canPlayType("application/vnd.apple.mpegurl")) {
      setState(feed, "error", "Энэ хөтөч HLS (.m3u8)-ийг шууд тоглуулахгүй. MP4, MJPEG эсвэл NVR-ийн вэб хуудас ашиглана уу.");
    } else {
      feed.video.addEventListener("playing", () => setState(feed, "live"));
      feed.video.addEventListener("error", () => setState(feed, "error", "Видео тоглуулж чадсангүй"));
      feed.video.loop = true;
      feed.video.src = cam.url;
    }
  } else if (cam.kind === "embed") {
    feed.frame = document.createElement("iframe");
    feed.frame.title = cam.name;
    feed.frame.referrerPolicy = "no-referrer";
    feed.frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
    feed.frame.setAttribute("allow", "fullscreen");
    feed.frame.addEventListener("load", () => setState(feed, "live"));
    feed.frame.src = cam.url;
    wrap.prepend(feed.frame);
  }
  return feed;
}

function mediaVideo() {
  const video = document.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  return video;
}

function openDevice() {
  if (deviceStream) return Promise.resolve(deviceStream);
  if (!navigator.mediaDevices?.getUserMedia) return Promise.reject(new Error("no camera"));
  deviceAsk ||= navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }).then((stream) => {
    deviceStream = stream;
    return stream;
  });
  deviceAsk.catch(() => (deviceAsk = null));
  return deviceAsk;
}

/* ---------- demo CCTV scenes ---------- */

function seeded(text) {
  let seed = 2166136261;
  for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VESTS = ["#ff8a1f", "#f4d21f", "#ff5a1f", "#c8e62a"];
const CARS = ["#e9ecef", "#d8dde2", "#f0c419", "#c0392b", "#5d6d7e"];

/** A fixed layout per camera (buildings, lanes) and the walkers and vehicles that loop through it. */
function makeScene(cam) {
  const rand = seeded(cam.id);
  const zone = cam.zone;
  const indoor = zone === "canteen";
  const blocks = [];
  if (zone === "dorm" || zone === "office" || zone === "store") {
    const count = zone === "dorm" ? 2 : 1;
    for (let index = 0; index < count; index += 1) blocks.push({ x: 20 + index * 230 + rand() * 30, w: 190 + rand() * 30, h: 46 + rand() * 18, color: zone === "store" ? "#8a8f86" : index ? "#c9d3da" : "#d9e2e6", windows: zone !== "store" });
  } else if (zone === "gate") blocks.push({ x: 300, w: 70, h: 40, color: "#d9e2e6", windows: true });
  else if (zone === "parking") blocks.push({ x: 330, w: 140, h: 34, color: "#b8c2c9", windows: true });
  const walkers = Array.from({ length: { canteen: 7, dorm: 5, gate: 2, parking: 3, perimeter: 1, store: 3, office: 4 }[zone] || 3 }, () => ({
    lane: HORIZON + 30 + rand() * (H - HORIZON - 50),
    speed: (rand() < 0.5 ? -1 : 1) * (10 + rand() * 16),
    phase: rand() * 900,
    gap: zone === "perimeter" ? 2600 : 700 + rand() * 500,
    vest: VESTS[Math.floor(rand() * VESTS.length)],
    sit: indoor && rand() < 0.5,
  }));
  const vehicles = zone === "gate" || zone === "parking" ? Array.from({ length: zone === "gate" ? 2 : 1 }, (_, index) => ({ lane: HORIZON + 70 + index * 40, speed: (index ? -1 : 1) * (38 + rand() * 20), phase: rand() * 1600, gap: 1400 + rand() * 900, color: CARS[Math.floor(rand() * CARS.length)], bus: zone === "parking" })) : [];
  const parked = zone === "parking" ? Array.from({ length: 6 }, (_, index) => ({ x: 30 + index * 70, color: CARS[Math.floor(rand() * CARS.length)], bus: index % 3 === 0 })) : [];
  return { zone, indoor, blocks, walkers, vehicles, parked, grain: seeded(`${cam.id}g`) };
}

function loop(time) {
  raf = requestAnimationFrame(loop);
  if (time - lastDraw < 100) return;
  lastDraw = time;
  for (const feed of feeds.values()) if (feed.scene && feed.wrap.isConnected) drawScene(feed, time);
}

const depth = (y) => 0.35 + ((y - HORIZON) / (H - HORIZON)) * 0.9;
const pos = (item, t) => {
  const span = W + item.gap;
  return ((((item.phase + (t / 1000) * item.speed) % span) + span) % span) - 60;
};

function drawScene(feed, time) {
  const { canvas, scene, cam } = feed;
  const ctx = canvas.getContext("2d");
  const k = canvas.width / W;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const now = Date.now();
  const hour = ((now + TZ_MS) / 3600000) % 24;
  const night = !scene.indoor && (hour < 6.5 || hour >= 19.5);
  if (scene.indoor) indoorBack(ctx);
  else outdoorBack(ctx, scene, night);
  let moving = 0;
  const sprites = [];
  for (const item of scene.walkers) {
    const x = item.sit ? (item.phase % (W - 40)) + 20 : pos(item, time);
    if (x < -20 || x > W + 20) continue;
    if (!item.sit) moving += 1;
    sprites.push({ y: item.lane, draw: () => person(ctx, x, item.lane, depth(item.lane), item, time, night) });
  }
  for (const item of scene.vehicles) {
    const x = pos(item, time);
    if (x < -120 || x > W + 60) continue;
    moving += 1;
    sprites.push({ y: item.lane, draw: () => vehicle(ctx, x, item.lane, depth(item.lane), item, night) });
  }
  sprites.sort((a, b) => a.y - b.y).forEach((sprite) => sprite.draw());
  if (night) {
    ctx.globalCompositeOperation = "saturation";
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(60, 110, 70, 0.16)";
    ctx.fillRect(0, 0, W, H);
  }
  overlay(ctx, scene, cam, now, time, night);
  const alarm = scene.zone === "perimeter" && moving > 0;
  if (feed.wrap.dataset.motion !== String(alarm)) feed.wrap.dataset.motion = String(alarm);
}

function outdoorBack(ctx, scene, night) {
  const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
  sky.addColorStop(0, night ? "#05080a" : "#7fa6c4");
  sky.addColorStop(1, night ? "#151c1f" : "#d6e2e8");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, HORIZON);
  ctx.fillStyle = night ? "#1c211f" : "#9a8f78";
  ctx.beginPath();
  ctx.moveTo(0, HORIZON);
  ctx.lineTo(90, HORIZON - 16);
  ctx.lineTo(170, HORIZON - 6);
  ctx.lineTo(260, HORIZON - 22);
  ctx.lineTo(380, HORIZON - 8);
  ctx.lineTo(W, HORIZON - 18);
  ctx.lineTo(W, HORIZON);
  ctx.fill();
  const ground = ctx.createLinearGradient(0, HORIZON, 0, H);
  ground.addColorStop(0, night ? "#262a27" : "#a99f8a");
  ground.addColorStop(1, night ? "#363a36" : "#857a66");
  ctx.fillStyle = ground;
  ctx.fillRect(0, HORIZON, W, H - HORIZON);
  if (scene.zone === "gate" || scene.zone === "parking") {
    ctx.fillStyle = night ? "#2d302e" : "#6f6a62";
    ctx.fillRect(0, HORIZON + 58, W, 70);
    ctx.strokeStyle = night ? "#55594f" : "#e8e2c8";
    ctx.setLineDash([18, 14]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, HORIZON + 93);
    ctx.lineTo(W, HORIZON + 93);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const block of scene.blocks) {
    const top = HORIZON - block.h + 18;
    ctx.fillStyle = night ? "#3b4043" : block.color;
    ctx.fillRect(block.x, top, block.w, block.h);
    ctx.fillStyle = night ? "#22272a" : "#7d8a93";
    ctx.fillRect(block.x - 3, top - 5, block.w + 6, 6);
    if (block.windows) {
      for (let wx = block.x + 10; wx < block.x + block.w - 14; wx += 22) {
        for (let wy = top + 9; wy < top + block.h - 12; wy += 16) {
          const lit = night && Math.sin(wx * 7.1 + wy * 3.3) > -0.2;
          ctx.fillStyle = lit ? "#e9d48c" : night ? "#1a1e20" : "#5f7a8c";
          ctx.fillRect(wx, wy, 11, 8);
        }
      }
    }
  }
  if (scene.zone === "gate") {
    const open = scene.vehicles.some((item) => Math.abs(pos(item, performance.now()) - 250) < 90);
    ctx.fillStyle = "#555";
    ctx.fillRect(236, HORIZON + 40, 8, 40);
    ctx.save();
    ctx.translate(240, HORIZON + 44);
    ctx.rotate(open ? -1.2 : 0);
    for (let index = 0; index < 6; index += 1) {
      ctx.fillStyle = index % 2 ? "#d22" : "#f2f2f2";
      ctx.fillRect(index * 22, -3, 22, 6);
    }
    ctx.restore();
  }
  if (scene.zone === "perimeter") {
    ctx.strokeStyle = night ? "#6b736c" : "#59605a";
    ctx.lineWidth = 1;
    for (let index = 0; index <= 14; index += 1) {
      const x = 10 + index * 34;
      const y = HORIZON + 8 + index * 9;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 30 - index * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    for (let row = 0; row < 4; row += 1) {
      ctx.moveTo(10, HORIZON - 14 + row * 6);
      ctx.lineTo(486, HORIZON + 92 + row * 8);
    }
    ctx.stroke();
    if (night) {
      const glow = ctx.createRadialGradient(360, HORIZON + 120, 6, 360, HORIZON + 120, 150);
      glow.addColorStop(0, "rgba(255, 244, 200, 0.35)");
      glow.addColorStop(1, "rgba(255, 244, 200, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
    }
  }
  for (const car of scene.parked) vehicle(ctx, car.x, H - 34, 1, { ...car, speed: 1 }, night, true);
}

function indoorBack(ctx) {
  ctx.fillStyle = "#cfc8b8";
  ctx.fillRect(0, 0, W, HORIZON + 10);
  ctx.fillStyle = "#e6e0d2";
  for (let x = 30; x < W; x += 110) ctx.fillRect(x, 18, 60, 4);
  const floor = ctx.createLinearGradient(0, HORIZON, 0, H);
  floor.addColorStop(0, "#9f9584");
  floor.addColorStop(1, "#7c7262");
  ctx.fillStyle = floor;
  ctx.fillRect(0, HORIZON + 10, W, H);
  ctx.fillStyle = "#5c4a3a";
  for (let row = 0; row < 3; row += 1) {
    const y = HORIZON + 40 + row * 46;
    const scale = depth(y);
    for (let x = 30; x < W; x += 150 * scale + 30) ctx.fillRect(x, y, 110 * scale, 10 * scale);
  }
  ctx.fillStyle = "#3d4b55";
  ctx.fillRect(380, 30, 80, HORIZON - 20);
  ctx.fillStyle = "#9fb4c2";
  ctx.fillRect(386, 36, 68, HORIZON - 34);
}

function person(ctx, x, y, scale, item, time, night) {
  const step = item.sit ? 0 : Math.sin(time / 140 + item.phase) * 3 * scale;
  const h = 26 * scale;
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  ctx.beginPath();
  ctx.ellipse(x, y, 7 * scale, 2.4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = night ? "#2a2f33" : "#2f3b46";
  ctx.lineWidth = 3 * scale;
  ctx.beginPath();
  ctx.moveTo(x - 2 * scale, y - h * 0.42);
  ctx.lineTo(x - 2 * scale + step, y);
  ctx.moveTo(x + 2 * scale, y - h * 0.42);
  ctx.lineTo(x + 2 * scale - step, y);
  ctx.stroke();
  ctx.fillStyle = item.vest;
  ctx.fillRect(x - 5 * scale, y - h * 0.85, 10 * scale, h * 0.45);
  ctx.fillStyle = night ? "#cfd8d0" : "#e7f0f2";
  ctx.fillRect(x - 5 * scale, y - h * 0.62, 10 * scale, 1.6 * scale);
  ctx.fillStyle = "#e0b48f";
  ctx.beginPath();
  ctx.arc(x, y - h * 0.95, 3.6 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f2f2f2";
  ctx.beginPath();
  ctx.arc(x, y - h * 1.0, 3.9 * scale, Math.PI, 0);
  ctx.fill();
}

function vehicle(ctx, x, y, scale, item, night, parked = false) {
  const long = (item.bus ? 92 : 52) * scale;
  const tall = (item.bus ? 30 : 20) * scale;
  const left = item.speed > 0 ? x - long : x;
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.fillRect(left + 2, y - 2, long, 4 * scale);
  ctx.fillStyle = night ? "#4a4f52" : item.color;
  ctx.fillRect(left, y - tall, long, tall - 4 * scale);
  ctx.fillStyle = night ? "#15191b" : "#3c5566";
  if (item.bus) for (let wx = left + 6 * scale; wx < left + long - 10 * scale; wx += 13 * scale) ctx.fillRect(wx, y - tall + 4 * scale, 9 * scale, 8 * scale);
  else ctx.fillRect(left + long * 0.25, y - tall + 3 * scale, long * 0.5, 7 * scale);
  ctx.fillStyle = "#111";
  for (const wx of [left + 10 * scale, left + long - 10 * scale]) {
    ctx.beginPath();
    ctx.arc(wx, y - 3 * scale, 4.5 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  if (night && !parked) {
    const front = item.speed > 0 ? left + long : left;
    const dir = item.speed > 0 ? 1 : -1;
    const beam = ctx.createLinearGradient(front, 0, front + dir * 90, 0);
    beam.addColorStop(0, "rgba(255, 250, 220, 0.55)");
    beam.addColorStop(1, "rgba(255, 250, 220, 0)");
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(front, y - tall * 0.5);
    ctx.lineTo(front + dir * 90, y - tall * 1.2);
    ctx.lineTo(front + dir * 90, y + 6);
    ctx.closePath();
    ctx.fill();
  }
}

function overlay(ctx, scene, cam, now, time, night) {
  const rand = scene.grain;
  ctx.fillStyle = night ? "rgba(220, 255, 220, 0.09)" : "rgba(255, 255, 255, 0.07)";
  for (let index = 0; index < 160; index += 1) ctx.fillRect(rand() * W, rand() * H, 1.2, 1.2);
  ctx.fillStyle = "rgba(0, 0, 0, 0.06)";
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  const shade = ctx.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, W * 0.62);
  shade.addColorStop(0, "rgba(0, 0, 0, 0)");
  shade.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  const stamp = new Date(now + TZ_MS).toISOString().slice(0, 19).replace("T", " ");
  ctx.font = "600 11px ui-monospace, Consolas, monospace";
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(6, 6, ctx.measureText(cam.name.toUpperCase()).width + 10, 16);
  ctx.fillRect(W - 136, 6, 130, 16);
  ctx.fillStyle = "#f4f7f4";
  ctx.fillText(cam.name.toUpperCase(), 11, 9);
  ctx.fillText(stamp, W - 131, 9);
  if (Math.floor(time / 600) % 2) {
    ctx.fillStyle = "#ff3b30";
    ctx.beginPath();
    ctx.arc(14, H - 14, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#f4f7f4";
  ctx.fillText(night ? "REC · IR" : "REC", 22, H - 20);
}
