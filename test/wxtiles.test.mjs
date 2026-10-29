import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { encodePng } from "../lib/png.mjs";
import { cloudAlpha, rampColor, renderWeatherTile } from "../lib/wxtiles.mjs";
import { sampleFrame, sampleWorld } from "../lib/gfs.mjs";
import { nightPolygon } from "../public/js/terrain3d.js";

function decodePng(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6);
    }
    if (type === "IDAT") idat.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  assert.equal(raw.length, stride * height);
  const pixel = (x, y) => [...raw.subarray(y * stride + 1 + x * 4, y * stride + 5 + x * 4)];
  return { width, height, pixel };
}

function globalFrame({ prate = 0, csnow = 0, t2 = 283.15, tcdc = 0 } = {}) {
  const nx = 360;
  const ny = 181;
  const grid = { nx, ny, la1: -90, lo1: 0, dx: 1, dy: 1, scan: 64, wrap: true };
  const fill = (value) =>
    typeof value === "function"
      ? Float32Array.from({ length: nx * ny }, (_, k) => value(k % nx, Math.floor(k / nx)))
      : new Float32Array(nx * ny).fill(value);
  return { valid: 0, grid, t2: fill(t2), rh: fill(50), u: fill(0), v: fill(0), prate: fill(prate), csnow: fill(csnow), tcdc: fill(tcdc) };
}

function inside(polygon, lng, lat) {
  const ring = polygon.geometry.coordinates[0];
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

test("PNG encoder writes a valid RGBA image", () => {
  const rgba = new Uint8Array(2 * 2 * 4);
  rgba.set([255, 0, 0, 255], 0);
  rgba.set([0, 0, 255, 128], 12);
  const png = decodePng(encodePng(2, 2, rgba));
  assert.equal(png.width, 2);
  assert.equal(png.height, 2);
  assert.deepEqual(png.pixel(0, 0), [255, 0, 0, 255]);
  assert.deepEqual(png.pixel(1, 1), [0, 0, 255, 128]);
  assert.deepEqual(png.pixel(1, 0), [0, 0, 0, 0]);
});

test("precipitation ramp and cloud opacity", () => {
  const ramp = [
    [0.1, [0, 0, 0, 100]],
    [1, [100, 200, 0, 200]],
  ];
  assert.equal(rampColor(ramp, 0.05), null);
  assert.deepEqual(rampColor(ramp, 0.55).map(Math.round), [50, 100, 0, 150]);
  assert.deepEqual(rampColor(ramp, 9), [100, 200, 0, 200]);
  assert.equal(cloudAlpha(10), 0);
  assert.equal(Math.round(cloudAlpha(100)), 205);
  assert.ok(cloudAlpha(60) > 0 && cloudAlpha(60) < 205);
});

test("global grid wraps across the antimeridian", () => {
  const frame = globalFrame({ t2: (x) => (x === 359 ? 293.15 : 273.15) });
  assert.equal(Math.round(sampleFrame(frame, 0, -1).tempC), 20);
  assert.equal(Math.round(sampleFrame(frame, 0, 359.5).tempC), 10);
  assert.equal(Math.round(sampleFrame(frame, 0, -0.5).tempC), 10);
  const world = { regional: null, global: { frames: [frame], grid: frame.grid } };
  assert.equal(Math.round(sampleWorld(world, 0, 179.5).tempC) + 0, 0);
  assert.equal(sampleWorld({ regional: null, global: null }, 0, 0, 0), null);
});

test("weather tile colours rain, snow and clouds", () => {
  const rainy = { regional: null, global: { frames: [globalFrame({ prate: 5 / 3600 })] } };
  const rain = decodePng(renderWeatherTile(rainy, 0, 0, 0, 0, "precip")).pixel(128, 128);
  assert.ok(rain[3] > 200 && rain[2] > rain[1], `rain pixel ${rain}`);

  const snowy = { regional: null, global: { frames: [globalFrame({ prate: 1 / 3600, csnow: 1, t2: 263.15 })] } };
  const snow = decodePng(renderWeatherTile(snowy, 0, 0, 0, 0, "precip")).pixel(128, 128);
  assert.ok(snow[3] > 150 && snow[1] > 180, `snow pixel ${snow}`);

  const cloudy = { regional: null, global: { frames: [globalFrame({ tcdc: 100, prate: 5 / 3600 })] } };
  const cloud = decodePng(renderWeatherTile(cloudy, 0, 0, 0, 0, "clouds")).pixel(128, 128);
  assert.deepEqual(cloud, [238, 242, 247, 205]);

  const clear = decodePng(renderWeatherTile({ regional: null, global: { frames: [globalFrame()] } }, 0, 0, 0, 0, "both"));
  assert.equal(clear.pixel(10, 10)[3], 0);
});

test("night polygon covers the dark side of the Earth", () => {
  const night = nightPolygon(Date.UTC(2026, 9, 27, 4, 0), 0);
  assert.equal(inside(night, 106.92, 47.92), false);
  assert.equal(inside(night, -74, 40.7), true);
  assert.equal(inside(night, 0, -80), false);
  assert.equal(inside(night, 0, 80), true);
});
