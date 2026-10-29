import { encodePng } from "./png.mjs";
import { sampleWorld } from "./gfs.mjs";

const SIZE = 256;
const STEP = 8;
const GRID = SIZE / STEP + 1;

const RAIN = [
  [0.1, [120, 195, 255, 120]],
  [0.5, [70, 150, 255, 175]],
  [1.5, [40, 100, 245, 205]],
  [4, [95, 60, 230, 220]],
  [8, [175, 50, 220, 230]],
  [15, [240, 50, 120, 235]],
  [30, [255, 95, 40, 240]],
  [60, [255, 215, 60, 245]],
];

const SNOW = [
  [0.1, [205, 245, 255, 125]],
  [0.5, [155, 232, 255, 175]],
  [1.5, [105, 205, 255, 205]],
  [4, [75, 160, 255, 220]],
  [10, [135, 110, 255, 230]],
];

export const WX_MODES = new Set(["both", "clouds", "precip"]);

export function rampColor(ramp, value) {
  if (value < ramp[0][0]) return null;
  for (let i = 1; i < ramp.length; i += 1) {
    const [v1, c1] = ramp[i];
    if (value <= v1) {
      const [v0, c0] = ramp[i - 1];
      const t = (value - v0) / (v1 - v0);
      return c0.map((channel, k) => channel + (c1[k] - channel) * t);
    }
  }
  return ramp.at(-1)[1];
}

export function cloudAlpha(cloud) {
  if (cloud <= 15) return 0;
  return Math.min(1, (cloud - 15) / 85) ** 1.3 * 205;
}

function tileLat(ty, z) {
  const n = Math.PI * (1 - (2 * ty) / 2 ** z);
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
}

function tileLng(tx, z) {
  return (tx / 2 ** z) * 360 - 180;
}

export function renderWeatherTile(world, z, x, y, timeMs, mode = "both") {
  const cloud = new Float32Array(GRID * GRID);
  const rain = new Float32Array(GRID * GRID);
  const snow = new Float32Array(GRID * GRID);
  for (let j = 0; j < GRID; j += 1) {
    const lat = Math.max(-89.9, Math.min(89.9, tileLat(y + j / (GRID - 1), z)));
    for (let i = 0; i < GRID; i += 1) {
      const lng = tileLng(x + i / (GRID - 1), z);
      const point = sampleWorld(world, lat, lng, timeMs);
      const k = j * GRID + i;
      if (!point) continue;
      cloud[k] = point.cloud;
      const frozen = point.snow || point.tempC <= 0;
      rain[k] = frozen ? 0 : point.precipMmH;
      snow[k] = frozen ? point.precipMmH : 0;
    }
  }
  const showClouds = mode !== "precip";
  const showPrecip = mode !== "clouds";
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  for (let py = 0; py < SIZE; py += 1) {
    const gy = py / STEP;
    const j0 = Math.floor(gy);
    const ty = gy - j0;
    const j1 = Math.min(GRID - 1, j0 + 1);
    for (let px = 0; px < SIZE; px += 1) {
      const gx = px / STEP;
      const i0 = Math.floor(gx);
      const tx = gx - i0;
      const i1 = Math.min(GRID - 1, i0 + 1);
      const lerp = (field) =>
        (field[j0 * GRID + i0] * (1 - tx) + field[j0 * GRID + i1] * tx) * (1 - ty) +
        (field[j1 * GRID + i0] * (1 - tx) + field[j1 * GRID + i1] * tx) * ty;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      if (showClouds) {
        const alpha = cloudAlpha(lerp(cloud)) / 255;
        r = 238;
        g = 242;
        b = 247;
        a = alpha;
      }
      if (showPrecip) {
        const rainMm = lerp(rain);
        const snowMm = lerp(snow);
        const color = snowMm > rainMm ? rampColor(SNOW, snowMm) : rampColor(RAIN, rainMm);
        if (color) {
          const ca = color[3] / 255;
          const out = ca + a * (1 - ca);
          r = (color[0] * ca + r * a * (1 - ca)) / out;
          g = (color[1] * ca + g * a * (1 - ca)) / out;
          b = (color[2] * ca + b * a * (1 - ca)) / out;
          a = out;
        }
      }
      const o = (py * SIZE + px) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = Math.round(a * 255);
    }
  }
  return encodePng(SIZE, SIZE, rgba);
}
