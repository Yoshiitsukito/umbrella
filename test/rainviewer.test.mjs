import test from "node:test";
import assert from "node:assert/strict";
import { RadarError, coverageTileUrl, createRadar, createRateLimiter, parseManifest, radarTileUrl, validRadarTile } from "../lib/rainviewer.mjs";

const MANIFEST = {
  version: "2.0",
  generated: 1793274321,
  host: "https://tilecache.rainviewer.com",
  radar: {
    past: [
      { time: 1793274000, path: "/v2/radar/861c1557d906" },
      { time: 1793273400, path: "/v2/radar/110c155f3d24" },
      { time: 1793272800, path: "../../etc" },
    ],
    nowcast: [],
  },
};

function fakeFetch(manifests) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes("weather-maps.json")) {
      const body = manifests[Math.min(calls.filter((item) => item.includes("weather-maps")).length - 1, manifests.length - 1)];
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 });
  };
  return { fetchImpl, calls };
}

const openLimiter = () => async () => {};

test("parseManifest keeps only safe radar frames in time order", () => {
  const data = parseManifest(MANIFEST);
  assert.equal(data.host, "https://tilecache.rainviewer.com");
  assert.deepEqual(data.frames.map((item) => item.time), [1793273400, 1793274000]);
  assert.throws(() => parseManifest({ host: "http://evil.example", radar: { past: MANIFEST.radar.past } }), RadarError);
  assert.throws(() => parseManifest({ host: MANIFEST.host, radar: { past: [] } }), RadarError);
});

test("tile urls follow the free-tier format", () => {
  assert.equal(radarTileUrl("https://h", "/v2/radar/abc", 5, 24, 11), "https://h/v2/radar/abc/512/5/24/11/2/0_0.png");
  assert.equal(coverageTileUrl("https://h", 3, 6, 2), "https://h/v2/coverage/0/512/3/6/2/0/0_0.png");
  assert.ok(validRadarTile(7, 127, 0));
  assert.ok(!validRadarTile(8, 0, 0));
  assert.ok(!validRadarTile(2, 4, 0));
});

test("radar maps frame times to upstream paths and caches tiles", async () => {
  const { fetchImpl, calls } = fakeFetch([MANIFEST]);
  const radar = createRadar({ fetchImpl, limiter: openLimiter() });
  const list = await radar.frames();
  assert.deepEqual(list.frames, [{ time: 1793273400 }, { time: 1793274000 }]);
  assert.equal(list.maxZoom, 7);
  await radar.tile(1793274000, 5, 24, 11);
  await radar.tile(1793274000, 5, 24, 11);
  const tiles = calls.filter((url) => url.includes("/v2/radar/"));
  assert.deepEqual(tiles, ["https://tilecache.rainviewer.com/v2/radar/861c1557d906/512/5/24/11/2/0_0.png"]);
  await assert.rejects(radar.tile(1700000000, 5, 24, 11), (error) => error.status === 404);
  await assert.rejects(radar.tile(1793274000, 9, 0, 0), (error) => error.status === 400);
});

test("radar refreshes the manifest when a newer frame is requested", async () => {
  let now = 0;
  const newer = { ...MANIFEST, radar: { past: [...MANIFEST.radar.past, { time: 1793274600, path: "/v2/radar/fresh01" }] } };
  const { fetchImpl, calls } = fakeFetch([MANIFEST, newer]);
  const radar = createRadar({ fetchImpl, limiter: openLimiter(), clock: () => now });
  await radar.frames();
  now = 31_000;
  await radar.tile(1793274600, 4, 12, 5);
  assert.ok(calls.some((url) => url.includes("/v2/radar/fresh01/512/4/12/5/")));
});

test("rate limiter waits once the window is full", async () => {
  let now = 0;
  const waits = [];
  const acquire = createRateLimiter({
    limit: 2,
    windowMs: 1000,
    clock: () => now,
    wait: async (ms) => {
      waits.push(ms);
      now += ms;
    },
  });
  await Promise.all([acquire(), acquire(), acquire()]);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 1000);
  const full = createRateLimiter({ limit: 1, queueLimit: 1, clock: () => 0, wait: () => new Promise(() => {}) });
  full();
  await assert.rejects(full(), (error) => error.status === 429);
});
