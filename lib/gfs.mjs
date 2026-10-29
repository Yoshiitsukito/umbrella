import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseGrib2 } from "./grib2.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = path.join(root, "data", "gfs");
const NOMADS = "https://nomads.ncep.noaa.gov/cgi-bin";
const CONCURRENCY = 2;
const RECHECK_MS = 20 * 60 * 1000;
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

const VARIABLES = {
  t2: { category: 0, parameter: 0, surface: 103 },
  rh: { category: 1, parameter: 1, surface: 103 },
  u: { category: 2, parameter: 2, surface: 103 },
  v: { category: 2, parameter: 3, surface: 103 },
  prate: { category: 1, parameter: 7, surface: 1 },
  csnow: { category: 1, parameter: 195, surface: 1 },
  tcdc: { category: 6, parameter: 1, surface: 10 },
};

export class GfsUnavailable extends Error {}

export function gfsBox() {
  const parts = String(process.env.GFS_BBOX || "70,33,135,60").split(",").map(Number);
  const [west, south, east, north] = parts.length === 4 && parts.every(Number.isFinite) ? parts : [70, 33, 135, 60];
  return { west, south, east, north };
}

export function insideBox(lat, lng, box = gfsBox()) {
  return lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east;
}

const DATASETS = {
  regional: {
    id: "0p25",
    script: "filter_gfs_0p25_1hr.pl",
    hours: Array.from({ length: 36 }, (_, index) => index + 1),
    box: gfsBox,
  },
  global: {
    id: "1p00",
    script: "filter_gfs_1p00.pl",
    hours: Array.from({ length: 12 }, (_, index) => (index + 1) * 3),
    box: () => ({ west: 0, south: -90, east: 359, north: 90 }),
  },
};

function cycleId(date) {
  return date.toISOString().slice(0, 13).replace(/[-T]/g, "");
}

function cycleParts(date) {
  const iso = date.toISOString();
  return { day: iso.slice(0, 10).replace(/-/g, ""), hour: iso.slice(11, 13) };
}

function hourUrl(dataset, cycle, fh, { probe = false } = {}) {
  const { day, hour } = cycleParts(cycle);
  const box = dataset.box();
  const url = new URL(`${NOMADS}/${dataset.script}`);
  url.searchParams.set("dir", `/gfs.${day}/${hour}/atmos`);
  url.searchParams.set("file", `gfs.t${hour}z.pgrb2.${dataset.id}.f${String(fh).padStart(3, "0")}`);
  const vars = probe ? ["TMP"] : ["TMP", "RH", "UGRD", "VGRD", "PRATE", "CSNOW", "TCDC"];
  const levels = probe ? ["lev_2_m_above_ground"] : ["lev_2_m_above_ground", "lev_10_m_above_ground", "lev_surface", "lev_entire_atmosphere"];
  for (const name of vars) url.searchParams.set(`var_${name}`, "on");
  for (const level of levels) url.searchParams.set(level, "on");
  url.searchParams.set("subregion", "");
  url.searchParams.set("leftlon", String(box.west));
  url.searchParams.set("rightlon", String(box.east));
  url.searchParams.set("toplat", String(box.north));
  url.searchParams.set("bottomlat", String(box.south));
  return url;
}

async function download(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && buf.toString("ascii", 0, 4) === "GRIB") return buf;
      lastError = new GfsUnavailable(`NOAA GFS ${res.status}`);
      if (res.status === 404) break;
    } catch (error) {
      lastError = new GfsUnavailable(`NOAA GFS холболт: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }
  throw lastError;
}

async function cycleReady(dataset, cycle) {
  try {
    await download(hourUrl(dataset, cycle, dataset.hours.at(-1), { probe: true }), 1);
    return true;
  } catch {
    return false;
  }
}

async function latestCycle(dataset, now = Date.now()) {
  const step = 6 * 3600 * 1000;
  const newest = Math.floor((now - 3.5 * 3600 * 1000) / step) * step;
  for (let i = 0; i < 4; i += 1) {
    const cycle = new Date(newest - i * step);
    if (await cycleReady(dataset, cycle)) return cycle;
  }
  throw new GfsUnavailable("NOAA GFS-ийн сүүлийн ажиллалт олдсонгүй");
}

function pick(messages, spec) {
  const message = messages.find(
    (item) => item.pdt === 0 && item.discipline === 0 && item.category === spec.category && item.parameter === spec.parameter && item.surface === spec.surface,
  );
  if (!message) throw new GfsUnavailable(`GFS хувьсагч дутуу (${spec.category}/${spec.parameter})`);
  return message;
}

function frameFrom(buf, cycle, fh) {
  const messages = parseGrib2(buf);
  const frame = { fh, valid: cycle.getTime() + fh * 3600 * 1000 };
  for (const [name, spec] of Object.entries(VARIABLES)) {
    const message = pick(messages, spec);
    frame.grid ||= { ...message.grid, wrap: Math.round(message.grid.nx * message.grid.dx) === 360 };
    frame[name] = message.values;
  }
  return frame;
}

async function loadHour(dataset, cycle, fh) {
  const dir = path.join(cacheRoot, dataset.id, cycleId(cycle));
  const file = path.join(dir, `f${String(fh).padStart(3, "0")}.grb2`);
  let buf;
  try {
    buf = await readFile(file);
  } catch {
    buf = await download(hourUrl(dataset, cycle, fh));
    await mkdir(dir, { recursive: true });
    await writeFile(file, buf);
  }
  return frameFrom(buf, cycle, fh);
}

async function loadCycle(dataset, cycle) {
  const frames = [];
  let next = 0;
  async function worker() {
    while (next < dataset.hours.length) {
      const fh = dataset.hours[next];
      next += 1;
      frames.push(await loadHour(dataset, cycle, fh));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  frames.sort((a, b) => a.fh - b.fh);
  return { cycle, frames, grid: frames[0].grid, dataset: dataset.id };
}

async function pruneCache(dataset, keepId) {
  try {
    for (const name of await readdir(cacheRoot)) {
      if (/^\d{10}$/.test(name)) await rm(path.join(cacheRoot, name), { recursive: true, force: true });
    }
    const dir = path.join(cacheRoot, dataset.id);
    for (const name of await readdir(dir)) {
      if (name !== keepId) await rm(path.join(dir, name), { recursive: true, force: true });
    }
  } catch {
    /* cache dir may not exist yet */
  }
}

function createLoader(dataset) {
  const state = { data: null, checkedAt: 0, failedAt: 0, pending: null };

  async function refresh() {
    const cycle = await latestCycle(dataset);
    if (state.data && state.data.cycle.getTime() === cycle.getTime()) return state.data;
    const data = await loadCycle(dataset, cycle);
    state.data = data;
    await pruneCache(dataset, cycleId(cycle));
    return data;
  }

  return {
    current: () => state.data,
    async load() {
      const now = Date.now();
      const fresh = state.data && now - state.checkedAt < RECHECK_MS;
      const backingOff = now - state.failedAt < FAILURE_BACKOFF_MS;
      if (fresh || (state.data && backingOff)) return state.data;
      if (backingOff) throw new GfsUnavailable("NOAA GFS түр ачаалагдахгүй байна, хэдэн минутын дараа дахин оролдоно");
      state.pending ||= refresh()
        .then((data) => {
          state.checkedAt = Date.now();
          return data;
        })
        .catch((error) => {
          state.failedAt = Date.now();
          if (state.data) return state.data;
          throw error;
        })
        .finally(() => {
          state.pending = null;
        });
      return state.pending;
    },
  };
}

const regionalLoader = createLoader(DATASETS.regional);
const globalLoader = createLoader(DATASETS.global);

export function gfsData() {
  return regionalLoader.load();
}

export function gfsGlobal() {
  return globalLoader.load();
}

export async function worldData() {
  const [near, far] = await Promise.allSettled([regionalLoader.load(), globalLoader.load()]);
  const world = { regional: near.value || null, global: far.value || null };
  if (!world.regional && !world.global) throw near.reason || far.reason;
  return world;
}

function cellIndex(grid, lat, lng) {
  let fx = (lng - grid.lo1) / grid.dx;
  if (grid.wrap) fx = ((fx % grid.nx) + grid.nx) % grid.nx;
  const fy = (grid.scan & 0x40 ? lat - grid.la1 : grid.la1 - lat) / grid.dy;
  return { fx: grid.wrap ? fx : Math.max(0, Math.min(grid.nx - 1, fx)), fy: Math.max(0, Math.min(grid.ny - 1, fy)) };
}

function bilinear(values, grid, lat, lng) {
  const { fx, fy } = cellIndex(grid, lat, lng);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = grid.wrap ? (x0 + 1) % grid.nx : Math.min(grid.nx - 1, x0 + 1);
  const y1 = Math.min(grid.ny - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x, y) => values[y * grid.nx + x];
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

export function framesAround(data, timeMs) {
  const { frames } = data;
  if (timeMs <= frames[0].valid) return [frames[0], frames[0], 0];
  for (let i = 0; i < frames.length - 1; i += 1) {
    if (timeMs <= frames[i + 1].valid) {
      return [frames[i], frames[i + 1], (timeMs - frames[i].valid) / (frames[i + 1].valid - frames[i].valid)];
    }
  }
  const last = frames.at(-1);
  return [last, last, 0];
}

export function sampleFrame(frame, lat, lng) {
  const grid = frame.grid;
  const get = (name) => bilinear(frame[name], grid, lat, lng);
  const u = get("u");
  const v = get("v");
  return {
    tempC: get("t2") - 273.15,
    rh: Math.max(0, Math.min(100, get("rh"))),
    u,
    v,
    precipMmH: Math.max(0, get("prate") * 3600),
    snow: get("csnow") >= 0.5,
    cloud: Math.max(0, Math.min(100, get("tcdc"))),
  };
}

export function sampleAt(data, lat, lng, timeMs) {
  const [a, b, t] = framesAround(data, timeMs);
  const one = sampleFrame(a, lat, lng);
  if (a === b || t === 0) return one;
  const two = sampleFrame(b, lat, lng);
  const mix = (x, y) => x + (y - x) * t;
  return {
    tempC: mix(one.tempC, two.tempC),
    rh: mix(one.rh, two.rh),
    u: mix(one.u, two.u),
    v: mix(one.v, two.v),
    precipMmH: mix(one.precipMmH, two.precipMmH),
    snow: t < 0.5 ? one.snow : two.snow,
    cloud: mix(one.cloud, two.cloud),
  };
}

export function sampleWorld(world, lat, lng, timeMs) {
  if (world.regional && insideBox(lat, lng)) return sampleAt(world.regional, lat, lng, timeMs);
  if (world.global) return sampleAt(world.global, lat, lng, timeMs);
  return null;
}

export function neighbourhoodProbability(data, frameIndex, lat, lng, radius = 2, thresholdMmH = 0.1) {
  const { frames, grid } = data;
  const { fx, fy } = cellIndex(grid, lat, lng);
  const cx = Math.round(fx);
  const cy = Math.round(fy);
  let wet = 0;
  let total = 0;
  for (let k = Math.max(0, frameIndex - 1); k <= Math.min(frames.length - 1, frameIndex + 1); k += 1) {
    const values = frames[k].prate;
    for (let y = Math.max(0, cy - radius); y <= Math.min(grid.ny - 1, cy + radius); y += 1) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(grid.nx - 1, cx + radius); x += 1) {
        total += 1;
        if (values[y * grid.nx + x] * 3600 >= thresholdMmH) wet += 1;
      }
    }
  }
  return total ? Math.round((wet / total) * 100) : 0;
}

export function cycleLabel(data) {
  const iso = data.cycle.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 13)}Z`;
}
