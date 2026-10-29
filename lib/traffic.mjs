const SESSION_URL = "https://tile.googleapis.com/v1/createSession";
const TILE_URL = "https://tile.googleapis.com/v1/2dtiles";
const RETRY_MS = 60 * 1000;

let session = null;
let pending = null;
let failure = null;

export class TrafficError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function trafficKey() {
  return process.env.GOOGLE_TILES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
}

export function trafficConfigured() {
  return Boolean(trafficKey());
}

function googleMessage(text, status) {
  try {
    return JSON.parse(text).error?.message || `${status}`;
  } catch {
    return text.slice(0, 160) || `${status}`;
  }
}

async function sessionToken(key) {
  if (session && session.key === key && session.expiresAt - Date.now() > 10 * 60 * 1000) return session.token;
  if (failure && failure.key === key && failure.until > Date.now()) throw new TrafficError(failure.status, failure.message);
  pending ||= (async () => {
    const res = await fetch(`${SESSION_URL}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapType: "roadmap", language: "mn", region: "MN", layerTypes: ["layerTraffic"], overlay: true }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      /* handled below */
    }
    if (!res.ok || !data.session) {
      const message = `Google Map Tiles: ${googleMessage(text, res.status)}`;
      failure = { key, status: res.status === 403 || res.status === 401 ? 403 : 502, message, until: Date.now() + RETRY_MS };
      throw new TrafficError(failure.status, message);
    }
    failure = null;
    const expiry = Number(data.expiry) * 1000;
    session = { key, token: data.session, expiresAt: Number.isFinite(expiry) && expiry > 0 ? expiry : Date.now() + 24 * 60 * 60 * 1000 };
    return session.token;
  })().finally(() => {
    pending = null;
  });
  return pending;
}

export async function trafficTile(z, x, y) {
  const key = trafficKey();
  if (!key) throw new TrafficError(503, "Замын түгжрэлд Google түлхүүр хэрэгтэй (.env: GOOGLE_TILES_API_KEY эсвэл GOOGLE_MAPS_API_KEY)");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await sessionToken(key);
    const res = await fetch(`${TILE_URL}/${z}/${x}/${y}?session=${encodeURIComponent(token)}&key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      return { body: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") || "image/png" };
    }
    const text = await res.text();
    if (attempt === 0 && (res.status === 400 || res.status === 401) && /session/i.test(text)) {
      session = null;
      continue;
    }
    throw new TrafficError(res.status === 403 ? 403 : 502, `Google Map Tiles: ${googleMessage(text, res.status)}`);
  }
  throw new TrafficError(502, "Google Map Tiles: session");
}
