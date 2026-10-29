const MANIFEST_URL = "https://api.rainviewer.com/public/weather-maps.json";
const USER_AGENT = "HOLO-Companion/1.0 (local personal assistant)";
export const RADAR_MAX_ZOOM = 7;
export const RADAR_TILE_SIZE = 512;
const MANIFEST_TTL_MS = 2 * 60 * 1000;
const MANIFEST_RETRY_MS = 30 * 1000;
const FRAME_TTL_MS = 3 * 60 * 60 * 1000;
const COVERAGE_TTL_MS = 48 * 60 * 60 * 1000;
const CACHE_LIMIT = 2500;
// RainViewer allows 100 requests per IP per minute on the free tier.
const RATE_LIMIT = 90;
const RATE_WINDOW_MS = 60 * 1000;
const QUEUE_LIMIT = 300;

export class RadarError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function parseManifest(body) {
  const host = typeof body?.host === "string" && /^https:\/\/[a-z0-9.-]+$/i.test(body.host) ? body.host : null;
  const frames = (Array.isArray(body?.radar?.past) ? body.radar.past : [])
    .filter((frame) => Number.isInteger(frame?.time) && /^\/v2\/radar\/[A-Za-z0-9]+$/.test(frame?.path || ""))
    .map(({ time, path }) => ({ time, path }))
    .sort((a, b) => a.time - b.time);
  if (!host || !frames.length) throw new RadarError(502, "RainViewer: радарын фрейм алга");
  return { host, frames, generated: Number(body.generated) || null };
}

export function validRadarTile(z, x, y) {
  const n = 2 ** z;
  return [z, x, y].every(Number.isInteger) && z >= 0 && z <= RADAR_MAX_ZOOM && x >= 0 && y >= 0 && x < n && y < n;
}

export function radarTileUrl(host, path, z, x, y, size = RADAR_TILE_SIZE) {
  return `${host}${path}/${size}/${z}/${x}/${y}/2/0_0.png`;
}

export function coverageTileUrl(host, z, x, y, size = RADAR_TILE_SIZE) {
  return `${host}/v2/coverage/0/${size}/${z}/${x}/${y}/0/0_0.png`;
}

export function createRateLimiter({ limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS, queueLimit = QUEUE_LIMIT, clock = Date.now, wait } = {}) {
  const sleep = wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const stamps = [];
  let chain = Promise.resolve();
  let pending = 0;
  return function acquire() {
    if (pending >= queueLimit) return Promise.reject(new RadarError(429, "RainViewer: хүсэлт хэт олон байна, түр хүлээнэ үү"));
    pending += 1;
    const turn = chain.then(async () => {
      for (;;) {
        const now = clock();
        while (stamps.length && now - stamps[0] >= windowMs) stamps.shift();
        if (stamps.length < limit) {
          stamps.push(now);
          return;
        }
        await sleep(windowMs - (now - stamps[0]) + 5);
      }
    });
    const done = () => {
      pending -= 1;
    };
    chain = turn.then(done, done);
    return turn;
  };
}

export function createRadar({ fetchImpl = globalThis.fetch, clock = Date.now, limiter = createRateLimiter() } = {}) {
  let manifest = null;
  let manifestAt = 0;
  let manifestJob = null;
  const cache = new Map();
  const inflight = new Map();

  async function upstream(url, accept) {
    await limiter();
    let res;
    try {
      res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(15000) });
    } catch (error) {
      throw new RadarError(502, `RainViewer холбогдсонгүй: ${error.message}`);
    }
    if (res.status === 429) throw new RadarError(429, "RainViewer: минутын хүсэлтийн хязгаар хэтэрлээ");
    if (!res.ok) throw new RadarError(502, `RainViewer: ${res.status}`);
    return res;
  }

  async function loadManifest() {
    const res = await upstream(MANIFEST_URL, "application/json");
    return parseManifest(await res.json());
  }

  async function current({ force = false } = {}) {
    const age = clock() - manifestAt;
    if (manifest && age < (force ? MANIFEST_RETRY_MS : MANIFEST_TTL_MS)) return manifest;
    if (!manifestJob) {
      manifestJob = loadManifest()
        .then((next) => {
          manifest = next;
          manifestAt = clock();
          return next;
        })
        .finally(() => {
          manifestJob = null;
        });
    }
    try {
      return await manifestJob;
    } catch (error) {
      if (manifest) return manifest;
      throw error;
    }
  }

  async function cachedTile(key, url, ttlMs) {
    const hit = cache.get(key);
    if (hit && hit.until > clock()) return hit.body;
    if (inflight.has(key)) return inflight.get(key);
    const job = upstream(url, "image/png")
      .then(async (res) => {
        const body = Buffer.from(await res.arrayBuffer());
        cache.delete(key);
        cache.set(key, { body, until: clock() + ttlMs });
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
        return body;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
    return job;
  }

  return {
    async frames() {
      const data = await current();
      return {
        frames: data.frames.map(({ time }) => ({ time })),
        generated: data.generated,
        maxZoom: RADAR_MAX_ZOOM,
        tileSize: RADAR_TILE_SIZE,
      };
    },
    async tile(time, z, x, y) {
      if (!validRadarTile(z, x, y)) throw new RadarError(400, "Тайлын координат буруу");
      let data = await current();
      let frame = data.frames.find((item) => item.time === time);
      if (!frame && time > data.frames.at(-1).time) {
        data = await current({ force: true });
        frame = data.frames.find((item) => item.time === time);
      }
      if (!frame) throw new RadarError(404, "Радарын фрейм хуучирсан эсвэл олдсонгүй");
      const body = await cachedTile(`radar/${time}/${z}/${x}/${y}`, radarTileUrl(data.host, frame.path, z, x, y), FRAME_TTL_MS);
      return { body, maxAgeS: 3600 };
    },
    async coverage(z, x, y) {
      if (!validRadarTile(z, x, y)) throw new RadarError(400, "Тайлын координат буруу");
      const data = await current();
      const body = await cachedTile(`coverage/${z}/${x}/${y}`, coverageTileUrl(data.host, z, x, y), COVERAGE_TTL_MS);
      return { body, maxAgeS: 24 * 3600 };
    },
  };
}
