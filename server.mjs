import { randomBytes } from "node:crypto";
import { createSocket } from "node:dgram";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.mjs";
import { inspect, storageLabel, update } from "./lib/store.mjs";
import { firebaseConfigured } from "./lib/firebase.mjs";
import {
  ROLES,
  STAFF_ROLES,
  canLogin,
  canScan,
  cardPatch,
  cardTexts,
  cleanLoginCode,
  cleanUsername,
  clearedCookie,
  CARD_QR_PREFIX,
  ensureCardKeys,
  ensureCardTemplates,
  findByCardQr,
  ensureLoginCodes,
  ensureStationUser,
  ensureUsers,
  hashPassword,
  issueMobileToken,
  issueSession,
  newCardKey,
  newUser,
  passwordProblem,
  photoProblem,
  publicUser,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  verifyMobileToken,
  verifyPassword,
  verifySession,
} from "./lib/auth.mjs";
import { activityInput, applyPhoneActivity, locationInput, phoneSleep, sleepWindows } from "./lib/mobile.mjs";
import { ensureTunnel, HOSTED, publicUrl, tunneled } from "./lib/tunnel.mjs";
import { apparentTemperature, conditionLabel, fetchForecast, sunElevation, weatherCodeFrom, windFrom, windFromVector } from "./lib/weather.mjs";
import { cycleLabel, insideBox, sampleWorld, worldData } from "./lib/gfs.mjs";
import { WX_MODES, renderWeatherTile } from "./lib/wxtiles.mjs";
import { verifyToken } from "./lib/token.mjs";
import { approveDevice, deviceList, deviceLogin, removeDevice, requestDevice } from "./lib/devices.mjs";
import { ensureAttendance, presenceOf, recordScan, shiftWindows } from "./lib/attendance.mjs";
import { applyRestUpdate, cleanPlan, ensureWorkplan, patternsFor, restBlock, restUpdates, leaveRequest, noteAttempt, pruneLeaves } from "./lib/workplan.mjs";
import { faceOf, faceProgress, frameBuffer, photoFace, warmFace } from "./lib/face.mjs";
import { energyFromSleep, hydrationTarget } from "./lib/wellness.mjs";
import {
  addWater,
  announcementInput,
  announcementsFor,
  birthdaysAround,
  birthdayValue,
  dayOf,
  freshNotices,
  leaveNotice,
  moodValue,
  personalKey,
  personalOf,
  planNotice,
  pruneAnnouncements,
  prunePersonal,
  pushNotice,
  reminderInput,
  sleepInput,
  sunTimes,
  toggleMeal,
  applyWatch,
  watchInput,
  waterAmount,
  weekFor,
} from "./lib/personal.mjs";
import { LEAVE_LABEL, PLAN_LABEL, SHIFT_CLOCK, addDays, leaveOn, plannedKind, weekdayOf } from "./public/js/workstats.js";
import { localParts } from "./lib/places.mjs";
import { haversineM } from "./lib/places.mjs";
import { placeAt, reverseGeocode, searchPlaces } from "./lib/geo.mjs";
import { answer } from "./lib/concierge.mjs";
import { PROVIDER_IDS, completeJson, providerList } from "./lib/ai.mjs";
import {
  NUTRITION_SYSTEM,
  addItem,
  cleanItem,
  cleanNutrition,
  dailyKcal,
  eatenKcal,
  ensureMenu,
  findItem,
  menuDate,
  menuItems,
  menuRange,
  menuTotals,
  nutritionPrompt,
  publicItem,
  removeItem,
  shiftMenu,
  toggleEaten,
} from "./lib/menu.mjs";
import { VOICES, synthesize, transcribe, voiceSupport } from "./lib/voice.mjs";
import { TrafficError, trafficConfigured, trafficTile } from "./lib/traffic.mjs";
import { DEFAULT_BUILDINGS_URL, PmtilesError, createPmtilesReader } from "./lib/pmtiles.mjs";
import {
  PLACEHOLDERS,
  addLog,
  cleanConfig,
  dailyPlan,
  dueItems,
  enqueue,
  ensureWhiteKing,
  fillTemplate,
  itemContext,
  lightStates,
  pruneFired,
  setOverride,
  speechContext,
} from "./lib/whiteking.mjs";
import {
  ACTIVE_GOAL,
  STEP_GOAL,
  airInfo,
  bloodPressureBand,
  bmiInfo,
  climateAdvice,
  fetchAir,
  healthSummary,
  heartRateBand,
} from "./lib/health.mjs";

loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, "public");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

const QUEEN_HEAD = `<title>White Queen</title>
    <link rel="manifest" href="/queen.webmanifest" />
    <meta name="theme-color" content="#0b1016" />
    <meta name="mobile-web-app-capable" content="yes" />
    <link rel="apple-touch-icon" href="/queen-192.png" />`;

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data));
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Хэт том хүсэлт"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("JSON буруу"));
      }
    });
    req.on("error", reject);
  });
}

const OWM_LAYERS = new Set(["temp_new", "precipitation_new", "clouds_new", "wind_new", "pressure_new"]);
const tileCache = new Map();

function tileError(res, status, message) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ error: message }));
}

async function serveTile(res, kind, layer, z, x, y) {
  const n = 2 ** z;
  const maxZ = kind === "base" ? 17 : 12;
  if (z < 0 || z > maxZ || x < 0 || y < 0 || x >= n || y >= n) {
    tileError(res, 400, "Тайлын координат буруу");
    return;
  }
  let upstream;
  let ttlMs;
  if (kind === "base") {
    upstream = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
    ttlMs = 24 * 60 * 60 * 1000;
  } else {
    if (!OWM_LAYERS.has(layer)) {
      tileError(res, 400, "Давхарга буруу");
      return;
    }
    if (!process.env.OPENWEATHERMAP_API_KEY) {
      tileError(res, 503, "OpenWeatherMap түлхүүр .env дээр алга (OPENWEATHERMAP_API_KEY)");
      return;
    }
    upstream = `https://tile.openweathermap.org/map/${layer}/${z}/${x}/${y}.png?appid=${encodeURIComponent(process.env.OPENWEATHERMAP_API_KEY)}`;
    ttlMs = 10 * 60 * 1000;
  }
  const key = `${kind}/${layer || ""}/${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached && cached.until > Date.now()) {
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": `max-age=${Math.round(ttlMs / 1000)}` });
    res.end(cached.body);
    return;
  }
  const upstreamRes = await fetch(upstream, {
    headers: { "User-Agent": "HOLO-Companion/1.0 (local personal assistant)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!upstreamRes.ok) {
    const text = await upstreamRes.text();
    let detail = text.slice(0, 160);
    try {
      detail = JSON.parse(text).message || detail;
    } catch {
      /* keep raw text */
    }
    const label = kind === "base" ? "Суурь газрын зураг" : "OpenWeatherMap";
    tileError(res, upstreamRes.status === 401 ? 401 : 502, `${label}: ${upstreamRes.status} ${detail}`);
    return;
  }
  const body = Buffer.from(await upstreamRes.arrayBuffer());
  tileCache.set(key, { body, until: Date.now() + ttlMs });
  if (tileCache.size > 1500) tileCache.delete(tileCache.keys().next().value);
  res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": `max-age=${Math.round(ttlMs / 1000)}` });
  res.end(body);
}

const TRAFFIC_TTL_MS = 2 * 60 * 1000;

async function serveTraffic(res, z, x, y) {
  const n = 2 ** z;
  if (z < 0 || z > 20 || x < 0 || y < 0 || x >= n || y >= n) {
    tileError(res, 400, "Тайлын координат буруу");
    return;
  }
  const key = `traffic/${z}/${x}/${y}`;
  const cached = tileCache.get(key);
  if (cached && cached.until > Date.now()) {
    res.writeHead(200, { "Content-Type": cached.type, "Cache-Control": "max-age=60" });
    res.end(cached.body);
    return;
  }
  try {
    const tile = await trafficTile(z, x, y);
    tileCache.set(key, { body: tile.body, type: tile.type, until: Date.now() + TRAFFIC_TTL_MS });
    if (tileCache.size > 1500) tileCache.delete(tileCache.keys().next().value);
    res.writeHead(200, { "Content-Type": tile.type, "Cache-Control": "max-age=60" });
    res.end(tile.body);
  } catch (error) {
    tileError(res, error instanceof TrafficError ? error.status : 502, error.message);
  }
}

const buildings = createPmtilesReader(process.env.OVERTURE_BUILDINGS_URL || DEFAULT_BUILDINGS_URL);
const buildingCache = new Map();

async function serveBuildings(res, z, x, y) {
  const n = 2 ** z;
  if (z < 0 || z > 14 || x < 0 || y < 0 || x >= n || y >= n) {
    tileError(res, 400, "Тайлын координат буруу");
    return;
  }
  const key = `${z}/${x}/${y}`;
  try {
    let body = buildingCache.get(key);
    if (body === undefined) {
      const [tile, info] = await Promise.all([buildings.tile(z, x, y), buildings.info()]);
      body = tile && info.gzip ? gunzipSync(tile) : tile;
      buildingCache.set(key, body);
      if (buildingCache.size > 600) buildingCache.delete(buildingCache.keys().next().value);
    }
    if (!body) {
      res.writeHead(204, { "Cache-Control": "max-age=86400" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/x-protobuf", "Cache-Control": "max-age=86400" });
    res.end(body);
  } catch (error) {
    tileError(res, error instanceof PmtilesError ? 502 : 500, `Overture барилга: ${error.message}`);
  }
}

const FIELD_N = 13;
const FIELD_R = 3;
const FIELD_TTL_MS = 10 * 60 * 1000;
const fieldCache = new Map();

function tileLat(ty, z) {
  const n = 2 ** z;
  const y = Math.max(0, Math.min(n, ty));
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return Math.max(-84, Math.min(84, lat));
}

function tileLng(tx, z) {
  const lng = (tx / 2 ** z) * 360 - 180;
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

async function serveField(res, z, x, y) {
  const n = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 2 || z > 14 || x < 0 || y < 0 || x >= n || y >= n) {
    json(res, 400, { error: "Талбарын координат буруу" });
    return;
  }
  const key = `${z}/${x}/${y}`;
  const cached = fieldCache.get(key);
  if (cached && cached.until > Date.now()) {
    json(res, 200, cached.body);
    return;
  }
  let world;
  try {
    world = await worldData();
  } catch (error) {
    json(res, 503, { error: error.message });
    return;
  }
  const now = Date.now();
  const span = FIELD_R * 2 + 1;
  const u = [];
  const v = [];
  const precip = [];
  const clouds = [];
  const temp = [];
  const snow = [];
  let inside = 0;
  const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
  for (let j = 0; j < FIELD_N; j += 1) {
    const lat = tileLat(y - FIELD_R + (span * j) / (FIELD_N - 1), z);
    for (let i = 0; i < FIELD_N; i += 1) {
      const lng = tileLng(x - FIELD_R + (span * i) / (FIELD_N - 1), z);
      const point = sampleWorld(world, lat, lng, now);
      if (!point) {
        u.push(0);
        v.push(0);
        precip.push(0);
        clouds.push(0);
        temp.push(null);
        snow.push(0);
        continue;
      }
      inside += 1;
      const frozen = point.snow || point.tempC <= 0;
      u.push(round(point.u, 2));
      v.push(round(point.v, 2));
      precip.push(round(point.precipMmH, 2));
      clouds.push(Math.round(point.cloud));
      temp.push(round(point.tempC, 1));
      snow.push(frozen ? round(point.precipMmH, 2) : 0);
    }
  }
  if (!inside) {
    json(res, 404, { error: "Энэ хэсэгт NOAA GFS өгөгдөл алга" });
    return;
  }
  const data = world.regional || world.global;
  const body = {
    z,
    x,
    y,
    R: FIELD_R,
    N: FIELD_N,
    u,
    v,
    precip,
    clouds,
    temp,
    snow,
    time: new Date(Math.floor(now / 900000) * 900000).toISOString().slice(0, 16),
    source: `NOAA GFS ${cycleLabel(data)}`,
  };
  fieldCache.set(key, { body, until: now + FIELD_TTL_MS });
  if (fieldCache.size > 200) fieldCache.delete(fieldCache.keys().next().value);
  json(res, 200, body);
}

const WX_BUCKET_MS = 10 * 60 * 1000;
const wxTileCache = new Map();

function wxBucket(raw) {
  const now = Math.floor(Date.now() / WX_BUCKET_MS);
  const asked = Number(raw);
  return Number.isInteger(asked) && Math.abs(asked - now) <= 6 * 36 ? asked : now;
}

function worldKey(world) {
  return [world.regional, world.global].map((data) => (data ? data.cycle.getTime() : 0)).join("-");
}

async function serveWxTile(res, mode, z, x, y, bucket) {
  const n = 2 ** z;
  if (!WX_MODES.has(mode) || z < 0 || z > 10 || x < 0 || y < 0 || x >= n || y >= n) {
    tileError(res, 400, "Тайлын координат буруу");
    return;
  }
  let world;
  try {
    world = await worldData();
  } catch (error) {
    tileError(res, 503, error.message);
    return;
  }
  const key = `${worldKey(world)}/${mode}/${bucket}/${z}/${x}/${y}`;
  let body = wxTileCache.get(key);
  if (!body) {
    body = renderWeatherTile(world, z, x, y, bucket * WX_BUCKET_MS, mode);
    wxTileCache.set(key, body);
    if (wxTileCache.size > 1500) wxTileCache.delete(wxTileCache.keys().next().value);
  }
  res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=600" });
  res.end(body);
}

async function serveWxPoint(res, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90) {
    json(res, 400, { error: "Координат буруу" });
    return;
  }
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  const world = await worldData();
  const now = Date.now();
  const point = sampleWorld(world, lat, wrapped, now);
  if (!point) {
    json(res, 404, { error: "Энэ цэгт NOAA GFS өгөгдөл алга" });
    return;
  }
  const windMs = Math.hypot(point.u, point.v);
  const windDirDeg = Math.round(windFromVector(point.u, point.v));
  const code = weatherCodeFrom(point);
  json(res, 200, {
    lat,
    lng: wrapped,
    code,
    condition: conditionLabel(code),
    isDay: sunElevation(lat, wrapped, now) > -0.833,
    tempC: Math.round(point.tempC * 10) / 10,
    feelsLikeC: Math.round(apparentTemperature(point.tempC, point.rh, windMs) * 10) / 10,
    windKmh: Math.round(windMs * 3.6),
    windDirDeg,
    windFrom: windFrom(windDirDeg),
    precipMmH: Math.round(point.precipMmH * 10) / 10,
    snow: point.snow || point.tempC <= 0,
    cloud: Math.round(point.cloud),
    source: world.regional && insideBox(lat, wrapped) ? "NOAA GFS 0.25°" : "NOAA GFS 1°",
  });
}

function providers() {
  return {
    weather: "NOAA GFS 0.25°",
    weatherMap: Boolean(process.env.OPENWEATHERMAP_API_KEY),
    maps: process.env.GOOGLE_MAPS_API_KEY ? "Google Maps" : "OpenStreetMap + OSRM",
    traffic: trafficConfigured(),
    flights: Boolean(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    ai: providerList(),
    voice: voiceSupport(),
  };
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Бичлэг хэт урт байна"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const ttsCache = new Map();

function cleanLabel(value) {
  const text = String(value || "")
    .replace(/[\u1800-\u18AF]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || "Байршил";
}

function clientWeather(weather) {
  if (!weather) return null;
  const copy = { ...weather };
  delete copy.slots;
  return copy;
}

function healthView(db, record, day, hydration, energy) {
  const clock = localParts();
  const lastBp = record.vitals.findLast((item) => item.sys && item.dia) || null;
  const lastHr = record.vitals.findLast((item) => item.hr) || null;
  const vitals = {
    bp: lastBp ? { sys: lastBp.sys, dia: lastBp.dia, at: lastBp.at, ...bloodPressureBand(lastBp.sys, lastBp.dia) } : null,
    hr: lastHr ? { bpm: lastHr.hr, at: lastHr.at, ...heartRateBand(lastHr.hr) } : null,
    history: record.vitals.slice(-6).reverse(),
    last: record.vitals.at(-1) || null,
  };
  const air = airInfo(db.air);
  const climate = db.weather ? climateAdvice(db.weather.feelsLikeC) : null;
  const steps = day.steps || 0;
  const activeMin = day.active || 0;
  return {
    steps,
    stepGoal: STEP_GOAL,
    activeMin,
    activeGoal: ACTIVE_GOAL,
    heightCm: record.heightCm || null,
    bmi: bmiInfo(record.weightKg, record.heightCm),
    vitals,
    air,
    climate,
    summary: healthSummary({
      energy,
      steps,
      activeMin,
      vision: db.vision,
      air,
      vitals,
      climate,
      hour: clock.hh + clock.mm / 60,
      today: clock.date,
    }),
  };
}

let sunCache = { key: "", value: null };

function sunToday(db, date) {
  const key = `${date}|${db.location.lat.toFixed(2)}|${db.location.lng.toFixed(2)}`;
  if (sunCache.key !== key) sunCache = { key, value: sunTimes(db.location.lat, db.location.lng, date) };
  return sunCache.value;
}

/** Today's planned shift kind for a user, or "off" on approved leave. */
function plannedToday(db, user, date) {
  if (!user || leaveOn(db.leaves, user.id, date)) return "off";
  return plannedKind(weekFor(db, user), date);
}

function hydrationFor(db, record, day, busy) {
  const target = hydrationTarget(record.weightKg, db.weather?.feelsLikeC, busy);
  return {
    targetMl: target.targetMl,
    reason: `${target.reason} Суурь ${target.baseMl} мл, дулаан ×${target.heat}, ачаалал ×${target.activity}.`,
    drunkMl: day.water || 0,
    cups: day.cups || 0,
  };
}

const energyOf = (sleep) => (sleep ? energyFromSleep({ durationMin: sleep.min, score: sleep.score }) : null);

function lastSleep(record) {
  const date = Object.keys(record.days).filter((key) => record.days[key].sleep).sort().at(-1);
  return date ? { date, ...record.days[date].sleep } : null;
}

/** Today's shift as schedule lines for Red King. */
function shiftLines(db, uid) {
  const today = localParts().date;
  const user = db.users.find((item) => item.id === uid);
  const leave = user && leaveOn(db.leaves, uid, today);
  if (leave) return [{ start: "", end: "", title: `Чөлөөтэй (${LEAVE_LABEL[leave.type]})` }];
  const kind = plannedToday(db, user, today);
  if (kind === "off") return [{ start: "", end: "", title: "Амралтын өдөр" }];
  const [start, end] = SHIFT_CLOCK[kind];
  return [{ start, end, title: `${PLAN_LABEL[kind]} ээлж` }];
}

/** This shift's canteen menu (by shift date, so a night shift keeps its own meals past midnight) and what this person ate. */
function menuView(db, user, record) {
  const date = shiftWindows().date;
  const kind = plannedToday(db, user, date);
  const { shift, meals, morning, items: dishes } = shiftMenu(db, date, kind);
  const items = dishes.map(publicItem);
  const eaten = (record.days[date]?.eaten || []).filter((id) => items.some((item) => item.id === id));
  return { date, shift, meals, morning, items, eaten, totals: menuTotals(items), eatenKcal: eatenKcal(items, eaten), targetKcal: dailyKcal(record.weightKg, kind !== "off") };
}

/** The menu for one date as the kitchen edits it, with a strip of the dates around it. */
function kitchenView(db, date) {
  const today = shiftWindows().date;
  const range = menuRange(today);
  const days = [];
  for (let day = range.min; day <= range.max; day = addDays(day, 1)) {
    const items = db.menu?.days?.[day] || [];
    days.push({ date: day, count: items.length, kcal: menuTotals(items).total });
  }
  const items = menuItems(db, date);
  return { date, today, range, days, items: items.map(publicItem), totals: menuTotals(items) };
}

/** Asks AI for a dish's calories; failures come back as `{ error }` so the dish is still saved. */
async function estimateNutrition(item) {
  try {
    const { data, provider } = await completeJson(NUTRITION_SYSTEM, nutritionPrompt(item));
    return { ...cleanNutrition(data, item), source: "ai", provider };
  } catch (error) {
    return { error: error.message };
  }
}

/** Fields to store for a dish: typed-in calories win, otherwise the AI estimate (or a pending marker). */
async function nutritionFor(item) {
  if (item.kcal != null) return { fields: { source: "manual", protein: null, fat: null, carbs: null, aiNote: null, kcalError: null } };
  const estimate = await estimateNutrition(item);
  if (estimate.error) return { fields: { kcal: null, source: null, kcalError: estimate.error }, warning: `Калори тооцоолж чадсангүй: ${estimate.error}. Калорийг гараар оруулж болно.` };
  return { fields: { ...estimate, kcalError: null } };
}

/** The personal, read-only part of /api/live for one user. */
function personalView(db, uid) {
  const today = localParts().date;
  const user = db.users.find((item) => item.id === uid);
  const record = personalOf(db, uid);
  const day = record.days[today] || {};
  const planned = plannedToday(db, user, today);
  const hydration = hydrationFor(db, record, day, planned !== "off");
  const energy = energyOf(day.sleep);
  const sleep = lastSleep(record);
  return {
    hydration: { date: today, ...hydration },
    sleep: sleep ? { ...sleep, durationMin: sleep.min } : null,
    energy,
    health: healthView(db, record, day, hydration, energy),
    menu: menuView(db, user, record),
    wellness: { today, days: record.days, vitals: record.vitals, weightKg: record.weightKg || null, heightCm: record.heightCm || null },
    reminders: record.reminders.filter((item) => !item.done || item.doneOn === today),
    notices: freshNotices(record),
    announcements: announcementsFor(db.announcements || [], uid),
    birthdays: birthdaysAround(db.users, today),
  };
}

async function refreshAir(db, lat, lng) {
  const age = db.air?.fetchedAt ? Date.now() - new Date(db.air.fetchedAt).getTime() : Infinity;
  const moved = db.air ? haversineM(db.air, { lat, lng }) > 5000 : true;
  if (age < 30 * 60 * 1000 && !moved) return;
  try {
    db.air = await fetchAir(lat, lng);
  } catch (error) {
    console.error(error.message);
  }
}

function profileOf(db, uid) {
  if (uid === db.profile.id) return db.profile;
  const user = db.users.find((item) => item.id === uid);
  return { id: uid, displayName: user?.displayName || "", title: user?.title || "", email: user?.email || "" };
}

function view(db, uid = db.profile.id) {
  const today = localParts().date;
  return {
    ...personalView(db, uid),
    profile: profileOf(db, uid),
    location: { ...db.location, label: cleanLabel(db.location.label) },
    sun: sunToday(db, today),
    presence: presenceOf(db.attendance, uid),
    shifts: shiftWindows(),
    events: db.attendance.events.filter((item) => item.uid === uid),
    trackFrom: db.attendance.historyFrom || null,
    trackAt: db.attendance.resetAt || null,
    shiftPlan: db.shiftPlans?.[uid] || null,
    leaves: (db.leaves || []).filter((item) => item.uid === uid),
    cardAttempts: (db.cardAttempts || []).filter((item) => item.uid === uid && Date.now() - Date.parse(item.at) < 14 * 24 * 3600 * 1000),
    briefing: db.briefings.find((item) => item.localDate === today) || null,
    weather: clientWeather(db.weather),
    vision: db.vision,
    messages: db.messages.slice(-20),
    providers: providers(),
    clock: localParts(),
  };
}

async function refreshWeather(db, lat, lng) {
  const weather = await fetchForecast(lat, lng);
  delete weather.slots;
  db.weather = weather;
  db.location = { ...db.location, lat, lng };
  await refreshAir(db, lat, lng);
  const today = localParts().date;
  if (weather.precip.status === "approaching") {
    const bucket = Math.floor(Date.now() / (30 * 60 * 1000));
    const key = `${today}-${bucket}-${weather.precip.kind}`;
    if (!db.alerts.some((item) => item.key === key)) {
      db.alerts.push({ key, text: weather.precip.text, at: new Date().toISOString() });
      db.alerts = db.alerts.slice(-20);
    }
  }
  const clock = localParts();
  if (clock.hh >= 6 && !db.briefings.some((item) => item.localDate === today)) {
    db.briefings.push({
      localDate: today,
      generatedAt: new Date().toISOString(),
      auto: clock.hh === 6 && clock.mm < 2,
      summary: weather.summary,
      tempC: weather.tempC,
      feelsLikeC: weather.feelsLikeC,
      windSpeedMs: weather.windSpeedMs,
      windDirDeg: weather.windDirDeg,
      windFrom: weather.windFrom,
      condition: weather.condition,
    });
  }
  db.briefings = db.briefings.slice(-14);
}

let weatherRetryAt = 0;

async function ensureFresh(db, force = false) {
  const age = db.weather?.fetchedAt ? Date.now() - new Date(db.weather.fetchedAt).getTime() : Infinity;
  if (!force && (age < 90 * 1000 || Date.now() < weatherRetryAt)) return;
  try {
    await refreshWeather(db, db.location.lat, db.location.lng);
    weatherRetryAt = 0;
  } catch (error) {
    weatherRetryAt = Date.now() + 60 * 1000;
    console.error(error.message);
    await refreshAir(db, db.location.lat, db.location.lng);
  }
}

const PUBLIC_API = [/^\/api\/tiles\//, /^\/api\/wx\//, /^\/api\/field$/, /^\/api\/maps\/config$/];
const loginFails = new Map();

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The caller's address; behind the Cloudflare tunnel every request arrives from localhost, so its header is used. */
function clientIp(req) {
  const remote = req.socket.remoteAddress || "local";
  if (HOSTED) return String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || remote).split(",").pop().trim();
  const forwarded = String(req.headers["cf-connecting-ip"] || "").trim();
  return LOOPBACK.has(remote) && forwarded ? forwarded : remote;
}

async function mobileUser(req) {
  const token = String(req.headers.authorization || "").match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;
  return inspect((db) => {
    const payload = verifyMobileToken(db.secret, token);
    if (!payload) return null;
    const user = (db.users || []).find((item) => item.id === payload.uid);
    if (!user || (user.ver || 0) !== payload.v || !canLogin(user) || user.role === "whiteking") return null;
    return publicUser(user, db.cardTemplates);
  });
}

function lockedFor(ip) {
  const entry = loginFails.get(ip);
  return entry && entry.until > Date.now() ? Math.ceil((entry.until - Date.now()) / 1000) : 0;
}

function noteLoginFail(ip) {
  const entry = loginFails.get(ip) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    entry.count = 0;
    entry.until = Date.now() + 60 * 1000;
  }
  loginFails.set(ip, entry);
}

async function sessionUser(req) {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return inspect((db) => {
    const payload = verifySession(db.secret, token);
    if (!payload) return null;
    const user = (db.users || []).find((item) => item.id === payload.uid);
    if (!user || (user.ver || 0) !== payload.v || !canLogin(user)) return null;
    return publicUser(user, db.cardTemplates);
  });
}

function profileFields(body) {
  const patch = {};
  if (body.displayName !== undefined) {
    const name = String(body.displayName).trim();
    if (name.length < 1 || name.length > 40) return { error: "Нэр 1–40 тэмдэгт байна" };
    patch.displayName = name;
  }
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (title.length > 60) return { error: "Албан тушаал хэт урт байна" };
    patch.title = title;
  }
  if (body.email !== undefined) {
    const email = String(body.email).trim();
    if (email && (email.length > 80 || !/^[^\s@]+@[^\s@]+$/.test(email))) return { error: "И-мэйл буруу" };
    patch.email = email;
  }
  if (body.birthday !== undefined) {
    const birthday = birthdayValue(body.birthday);
    if (birthday.error) return { error: birthday.error };
    patch.birthday = birthday.value;
  }
  return { patch };
}

function syncLinkedProfile(db, user) {
  if (user.id !== db.profile.id) return;
  db.profile.displayName = user.displayName;
  db.profile.title = user.title;
  db.profile.email = user.email;
}

function activeAdmins(db) {
  return db.users.filter((item) => item.role === "admin" && canLogin(item)).length;
}

/** Accounts and cards only; attendance, shift plans and announcements belong to human resources. */
function adminView(db) {
  const shifts = shiftWindows();
  const users = db.users.map((user) => publicUser(user, db.cardTemplates));
  return {
    users,
    stats: {
      total: users.length,
      admins: users.filter((item) => item.role === "admin").length,
      active: users.filter((item) => item.card.status === "ACTIVE").length,
      blocked: users.filter((item) => item.card.status !== "ACTIVE").length,
      scansToday: db.attendance.events.filter((item) => item.date === shifts.date).length,
    },
    cardTemplates: db.cardTemplates || {},
  };
}

const HR_CARD_FIELDS = ["idNumber", "clearance", "status", "expires", "issued", "classification", "restUntil"];

/** What human resources sees: staff records without login secrets or card keys, plus attendance. */
function hrView(db) {
  const shifts = shiftWindows();
  const users = db.users
    .filter((user) => STAFF_ROLES.includes(user.role))
    .map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      title: user.title || "",
      email: user.email || "",
      birthday: user.birthday || "",
      photo: user.photo || null,
      role: user.role,
      lastLoginAt: user.lastLoginAt || null,
      card: Object.fromEntries(HR_CARD_FIELDS.filter((key) => user.card?.[key] !== undefined).map((key) => [key, user.card[key]])),
    }));
  const ids = new Set(users.map((user) => user.id));
  const people = db.attendance.people || {};
  return {
    users,
    attendance: {
      ...shifts,
      historyFrom: db.attendance.historyFrom || shifts.date,
      trackAt: db.attendance.resetAt || null,
      people: Object.fromEntries(Object.entries(people).filter(([uid]) => ids.has(uid))),
      events: db.attendance.events.filter((item) => ids.has(item.uid)).map(({ at, uid, state, date, shift, lat, lng }) => ({ at, uid, state, date, shift, lat, lng })),
      plans: Object.fromEntries(Object.entries(db.shiftPlans || {}).filter(([uid]) => ids.has(uid))),
      leaves: (db.leaves || []).filter((item) => ids.has(item.uid)),
    },
    announcements: pruneAnnouncements(db.announcements || []).reverse(),
  };
}

/** Moves the old app-wide health data onto its owner and drops the shared copies. */
function migrateSharedHealth(db) {
  const legacy = ["health", "hydration", "sleep", "energy", "reminders"].filter((key) => key in db);
  if (!legacy.length) return false;
  const owner = db.users?.find((item) => item.id === db.profile?.id);
  if (owner) {
    const record = personalOf(db, owner.id);
    record.weightKg ??= db.profile.weightKg;
    record.heightCm ??= db.profile.heightCm;
    if (!record.vitals.length && Array.isArray(db.health?.vitals)) record.vitals = db.health.vitals;
  }
  for (const key of legacy) delete db[key];
  return true;
}

function noticeFor(db, uid, kind, text) {
  if (!text || !db.users.some((item) => item.id === uid)) return;
  pushNotice(personalOf(db, uid), kind, text);
}

const dotDate = (date) => date.slice(5).replace("-", ".");

/** Suspends or resumes rotation users' cards for their rest blocks and tells them why. */
function applyRestCards(db, now = Date.now()) {
  const changes = restUpdates(db.users, db.shiftPlans, now);
  for (const change of changes) {
    const user = db.users.find((item) => item.id === change.id);
    applyRestUpdate(user.card, change);
    if (change.type === "suspend") {
      noticeFor(db, user.id, "plan", `Ажлын 14 хоног дууслаа. Амралтын хугацаанд ID карт түдгэлзлээ; ${dotDate(change.until)}-ны ${change.kind === "night" ? "шөнийн" : "өдрийн"} ээлжийн өмнө автоматаар идэвхжинэ.`);
      if (db.whiteking) addLog(db.whiteking, "config", `${user.displayName}: амралт эхэлж ID карт ${dotDate(change.until)} хүртэл түдгэлзлээ`, now);
    } else if (change.type === "resume") {
      noticeFor(db, user.id, "plan", "Амралт дууслаа. ID карт дахин идэвхжлээ.");
      if (db.whiteking) addLog(db.whiteking, "config", `${user.displayName}: амралт дуусч ID карт идэвхжлээ`, now);
    }
  }
  return changes.length;
}

async function restTick() {
  try {
    const now = Date.now();
    if (!(await inspect((db) => restUpdates(db.users, db.shiftPlans, now).length > 0))) return;
    await update((db) => {
      applyRestCards(db, now);
    });
  } catch (error) {
    console.error(`Амралтын карт: ${error.message}`);
  }
}

async function routeAuth(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const ip = clientIp(req);
    const wait = lockedFor(ip);
    if (wait) {
      json(res, 429, { error: `Олон удаа буруу оруулсан. ${wait} секундын дараа оролдоно уу.` });
      return;
    }
    const body = await readBody(req);
    const code = cleanLoginCode(body.username);
    const password = String(body.password || "");
    const result = await update((db) => {
      const user = code && db.users.find((item) => item.loginCode === code);
      if (!user || !verifyPassword(password, user.pass)) return { error: "Нэвтрэх нэр эсвэл нууц үг буруу", status: 401 };
      if (!canLogin(user)) return { error: "Энэ эрх түдгэлзсэн байна. Админд хандана уу.", status: 403 };
      user.lastLoginAt = new Date().toISOString();
      return { token: issueSession(db.secret, user), user: publicUser(user, db.cardTemplates) };
    });
    if (result.error) {
      if (result.status === 401) noteLoginFail(ip);
      json(res, result.status, { error: result.error });
      return;
    }
    loginFails.delete(ip);
    res.setHeader("Set-Cookie", sessionCookie(result.token, tunneled(req)));
    json(res, 200, { user: result.user });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/ping") {
    json(res, 200, { app: STATION_APP, ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/auth/device/request") {
    const body = await readBody(req);
    const result = await update((db) => {
      ensureWhiteKing(db);
      const request = requestDevice(db.whiteking, body.name);
      if (!request.error) addLog(db.whiteking, "config", `Шинэ станцын төхөөрөмж холбогдох хүсэлт илгээв (код ${request.code})`);
      return request;
    });
    json(res, result.error ? 429 : 200, result);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/auth/device/login") {
    const body = await readBody(req);
    const result = await update((db) => {
      ensureWhiteKing(db);
      const check = deviceLogin(db.whiteking, body.id, body.key);
      if (check.status !== "ok") return check;
      const station = db.users.find((item) => item.role === "whiteking" && canLogin(item));
      if (!station) return { status: "blocked" };
      station.lastLoginAt = new Date().toISOString();
      return { status: "ok", token: issueSession(db.secret, station), user: publicUser(station, db.cardTemplates) };
    });
    if (result.status === "ok") {
      res.setHeader("Set-Cookie", sessionCookie(result.token, tunneled(req)));
      json(res, 200, { user: result.user });
    } else if (result.status === "pending") json(res, 202, { status: "pending", code: result.code });
    else if (result.status === "blocked") json(res, 403, { error: "White Queen станцын эрх түдгэлзсэн байна. Админд хандана уу." });
    else json(res, 401, { error: "Төхөөрөмж бүртгэлгүй эсвэл хасагдсан байна." });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    res.setHeader("Set-Cookie", clearedCookie(tunneled(req)));
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = await sessionUser(req);
    if (!user) {
      json(res, 401, { error: "Нэвтэрнэ үү" });
      return;
    }
    json(res, 200, { user });
    return;
  }
  json(res, 404, { error: "Олдсонгүй" });
}

const NOTICE_TITLE = { plan: "Ээлжийн хуваарь", leave: "Чөлөөний хүсэлт", card: "ID карт" };

/** What the phone app's background service needs: sleep-button times, today's steps and new messages. */
function mobileState(db, uid, now = Date.now()) {
  const user = db.users.find((item) => item.id === uid);
  const record = personalOf(db, uid);
  const today = localParts(new Date(now)).date;
  const day = record.days[today] || {};
  const kindOn = (date) => plannedToday(db, user, date);
  const notices = freshNotices(record, now).map((item) => ({ id: item.id, title: NOTICE_TITLE[item.kind] || "Мэдэгдэл", text: item.text, at: item.at }));
  const announcements = announcementsFor(db.announcements || [], uid, now)
    .filter((item) => !item.read)
    .map((item) => ({ id: item.id, title: "Зарлал", text: item.text, at: item.at }));
  return {
    name: user?.displayName || "",
    today,
    shift: { date: shiftWindows(now).date, kind: kindOn(shiftWindows(now).date) },
    sleepWindows: sleepWindows(kindOn, now),
    steps: day.steps || 0,
    active: day.active || 0,
    messages: [...notices, ...announcements].sort((a, b) => a.at.localeCompare(b.at)),
  };
}

/** Bearer-token API for the UMBRELLA app's background service (steps, location, sleep button, notifications). */
async function routeMobile(req, res, url, me) {
  if (req.method === "GET" && url.pathname === "/api/mobile/state") {
    json(res, 200, await inspect((db) => mobileState(db, me.id)));
    return;
  }
  const save = async (mutate) => {
    const result = await update((db) => {
      const today = localParts().date;
      const record = personalOf(db, me.id);
      const error = mutate(record, today);
      if (error) return { error };
      prunePersonal(record, today);
      return mobileState(db, me.id);
    });
    json(res, result.error ? 400 : 200, result);
  };
  if (req.method === "POST" && url.pathname === "/api/mobile/activity") {
    const body = await readBody(req);
    await save((record, today) => {
      const input = activityInput(body, today);
      if (input.error) return input.error;
      applyPhoneActivity(dayOf(record, input.date), input);
      return null;
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/mobile/location") {
    const body = await readBody(req);
    await save((record) => {
      const { place, error } = locationInput(body);
      if (error) return error;
      if (!record.place || record.place.at <= place.at) record.place = place;
      return null;
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/mobile/sleep") {
    const body = await readBody(req);
    await save((record) => {
      const { date, sleep, error } = phoneSleep(body);
      if (error) return error;
      dayOf(record, date).sleep = sleep;
      return null;
    });
    return;
  }
  json(res, 404, { error: "Олдсонгүй" });
}

/** Human resources: staff records, attendance, shift plans, leave decisions and announcements. */
async function routeKitchen(req, res, url, me) {
  const today = shiftWindows().date;
  if (req.method === "GET" && url.pathname === "/api/kitchen/menu") {
    const date = menuDate(url.searchParams.get("date"), today) || today;
    json(res, 200, await inspect((db) => kitchenView(db, date)));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/kitchen/menu") {
    const body = await readBody(req);
    const date = menuDate(body.date, today);
    if (!date) {
      json(res, 400, { error: "Огноо 7 хоногийн өмнөхөөс 14 хоногийн дараах хооронд байна" });
      return;
    }
    const { item, error } = cleanItem(body);
    if (error) {
      json(res, 400, { error });
      return;
    }
    const { fields, warning } = await nutritionFor(item);
    const result = await update((db) => {
      const added = addItem(db, date, { ...item, ...fields }, me.id, today);
      if (added.error) return added;
      return { ...kitchenView(db, date), added: added.item.id, warning: warning || null };
    });
    json(res, result.error ? 400 : 200, result);
    return;
  }

  const one = url.pathname.match(/^\/api\/kitchen\/menu\/(mn_[\w]+)(\/estimate)?$/);
  if (one && req.method === "DELETE" && !one[2]) {
    const result = await update((db) => {
      const found = findItem(db, one[1]);
      if (!found || !removeItem(db, one[1])) return { error: "Хоол олдсонгүй", status: 404 };
      return kitchenView(db, found.date);
    });
    json(res, result.error ? result.status : 200, result);
    return;
  }

  if (one && ((req.method === "PUT" && !one[2]) || (req.method === "POST" && one[2]))) {
    const body = one[2] ? {} : await readBody(req);
    const current = await inspect((db) => structuredClone(findItem(db, one[1])));
    if (!current) {
      json(res, 404, { error: "Хоол олдсонгүй" });
      return;
    }
    let next = { ...current.item, kcal: null };
    if (!one[2]) {
      const { item, error } = cleanItem(body);
      if (error) {
        json(res, 400, { error });
        return;
      }
      const same = ["meal", "category", "name", "portion"].every((field) => item[field] === current.item[field]);
      next = item.kcal == null && same && current.item.kcal != null && current.item.source === "ai" ? { ...item, kcal: current.item.kcal, keep: true } : item;
    }
    const { fields, warning } = next.keep ? { fields: {} } : await nutritionFor(next);
    delete next.keep;
    const result = await update((db) => {
      const found = findItem(db, one[1]);
      if (!found) return { error: "Хоол олдсонгүй", status: 404 };
      Object.assign(found.item, next, fields, { editedAt: new Date().toISOString(), editedBy: me.id });
      return { ...kitchenView(db, found.date), warning: warning || null };
    });
    json(res, result.error ? result.status : 200, result);
    return;
  }

  json(res, 404, { error: "Олдсонгүй" });
}

async function routeHr(req, res, url, me) {
  if (req.method === "GET" && url.pathname === "/api/hr") {
    json(res, 200, await inspect((db) => hrView(db)));
    return;
  }
  const planMatch = url.pathname.match(/^\/api\/hr\/shift-plans\/([\w-]+)$/);
  if (planMatch && req.method === "PUT") {
    const body = await readBody(req);
    if (!cleanPlan(body, null, null, ["dn", "nd", "dd"])) {
      json(res, 400, { error: "Хуваарь буруу байна" });
      return;
    }
    const result = await update((db) => {
      const user = db.users.find((item) => item.id === planMatch[1]);
      if (!user || !STAFF_ROLES.includes(user.role)) return { error: "Хэрэглэгч олдсонгүй", status: 404 };
      ensureWorkplan(db);
      const before = weekFor(db, user);
      const today = localParts().date;
      const plan = cleanPlan(body, before, today, patternsFor(user.role));
      if (!plan || (user.role === "hr" && Array.isArray(plan))) {
        return { error: user.role === "hr" ? "Хүний нөөц зөвхөн 14 өдөр ажиллаж, 14 хоног амарна" : "Хуваарь буруу байна", status: 400 };
      }
      db.shiftPlans[user.id] = plan;
      noticeFor(db, user.id, "plan", planNotice(before, plan, addDays(today, 1)));
      applyRestCards(db);
      return hrView(db);
    });
    json(res, result.error ? result.status : 200, result);
    return;
  }
  const leaveMatch = url.pathname.match(/^\/api\/hr\/leaves\/([\w-]+)$/);
  if (leaveMatch && req.method === "POST") {
    const status = (await readBody(req)).status;
    if (status !== "approved" && status !== "rejected") {
      json(res, 400, { error: "Шийдвэр буруу байна" });
      return;
    }
    const result = await update((db) => {
      ensureWorkplan(db);
      const leave = db.leaves.find((item) => item.id === leaveMatch[1]);
      if (!leave) return { error: "Хүсэлт олдсонгүй", status: 404 };
      Object.assign(leave, { status, decidedAt: new Date().toISOString(), decidedBy: me.displayName });
      noticeFor(db, leave.uid, status === "approved" ? "leave-ok" : "leave-no", leaveNotice(leave));
      return hrView(db);
    });
    json(res, result.error ? result.status : 200, result);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/hr/announcements") {
    const { announcement, error } = announcementInput(await readBody(req), me.displayName);
    if (error) {
      json(res, 400, { error });
      return;
    }
    json(
      res,
      200,
      await update((db) => {
        db.announcements = pruneAnnouncements([...(db.announcements || []), announcement]);
        return hrView(db);
      }),
    );
    return;
  }
  const announceMatch = url.pathname.match(/^\/api\/hr\/announcements\/([\w-]+)$/);
  if (announceMatch && req.method === "DELETE") {
    const result = await update((db) => {
      const list = db.announcements || [];
      if (!list.some((item) => item.id === announceMatch[1])) return { error: "Зарлал олдсонгүй", status: 404 };
      db.announcements = list.filter((item) => item.id !== announceMatch[1]);
      return hrView(db);
    });
    json(res, result.error ? result.status : 200, result);
    return;
  }
  json(res, 404, { error: "Олдсонгүй" });
}

async function routeMe(req, res, url, me) {
  if (req.method === "PUT" && (url.pathname === "/api/me" || url.pathname === "/api/me/photo") && me.role !== "admin") {
    json(res, 403, { error: "Хувийн мэдээлэл, зургийг зөвхөн админ өөрчилнө" });
    return;
  }
  if (req.method === "PUT" && url.pathname === "/api/me") {
    const { patch, error } = profileFields(await readBody(req));
    if (error) {
      json(res, 400, { error });
      return;
    }
    const user = await update((db) => {
      const user = db.users.find((item) => item.id === me.id);
      Object.assign(user, patch);
      syncLinkedProfile(db, user);
      return publicUser(user, db.cardTemplates);
    });
    json(res, 200, { user });
    return;
  }
  if (req.method === "PUT" && url.pathname === "/api/me/photo") {
    const body = await readBody(req);
    const photo = body.photo ?? null;
    const problem = photoProblem(photo);
    if (problem) {
      json(res, 400, { error: problem });
      return;
    }
    const user = await update((db) => {
      const user = db.users.find((item) => item.id === me.id);
      user.photo = photo;
      return publicUser(user, db.cardTemplates);
    });
    json(res, 200, { user });
    return;
  }
  if (req.method === "PUT" && url.pathname === "/api/me/password") {
    const body = await readBody(req);
    const problem = passwordProblem(body.next);
    if (problem) {
      json(res, 400, { error: problem });
      return;
    }
    const result = await update((db) => {
      const user = db.users.find((item) => item.id === me.id);
      if (!verifyPassword(String(body.current || ""), user.pass)) return { error: "Одоогийн нууц үг буруу" };
      user.pass = hashPassword(String(body.next));
      user.ver = (user.ver || 0) + 1;
      return { token: issueSession(db.secret, user), user: publicUser(user, db.cardTemplates) };
    });
    if (result.error) {
      json(res, 400, { error: result.error });
      return;
    }
    res.setHeader("Set-Cookie", sessionCookie(result.token, tunneled(req)));
    json(res, 200, { user: result.user });
    return;
  }
  json(res, 404, { error: "Олдсонгүй" });
}

async function routeAdmin(req, res, url, me) {
  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    json(res, 200, await inspect(adminView));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/users") {
    const body = await readBody(req);
    const username = cleanUsername(body.username);
    if (!username) {
      json(res, 400, { error: "Хэрэглэгчийн нэр 3–24 латин үсэг, тоо, . _ - байна" });
      return;
    }
    const problem = passwordProblem(body.password);
    if (problem) {
      json(res, 400, { error: problem });
      return;
    }
    const role = ROLES.includes(body.role) ? body.role : "user";
    const fields = profileFields({ displayName: body.displayName || username, title: body.title ?? "", email: body.email ?? "", birthday: body.birthday ?? "" });
    if (fields.error) {
      json(res, 400, { error: fields.error });
      return;
    }
    const result = await update((db) => {
      if (db.users.some((item) => item.username === username)) return { error: "Энэ хэрэглэгчийн нэр бүртгэлтэй байна" };
      const user = newUser({ username, password: String(body.password), role, ...fields.patch, existing: db.users });
      const card = cardPatch(body, user.card);
      if (card.error) return { error: card.error };
      if (db.users.some((item) => item.card?.idNumber === card.card.idNumber)) return { error: "Энэ ID дугаар өөр картанд бүртгэлтэй байна" };
      user.card = card.card;
      db.users.push(user);
      return adminView(db);
    });
    json(res, result.error ? 400 : 200, result);
    return;
  }
  const templateMatch = url.pathname.match(/^\/api\/admin\/card-templates\/([1-5])$/);
  if (templateMatch && req.method === "PUT") {
    const { texts, error } = cardTexts((await readBody(req)).texts ?? null);
    if (error) {
      json(res, 400, { error });
      return;
    }
    const result = await update((db) => {
      ensureCardTemplates(db);
      if (Object.keys(texts).length) db.cardTemplates[templateMatch[1]] = texts;
      else delete db.cardTemplates[templateMatch[1]];
      return { ...adminView(db), self: publicUser(db.users.find((item) => item.id === me.id), db.cardTemplates) };
    });
    json(res, 200, result);
    return;
  }
  const photoMatch = url.pathname.match(/^\/api\/admin\/users\/([\w-]+)\/photo$/);
  if (photoMatch && req.method === "PUT") {
    const body = await readBody(req);
    const photo = body.photo ?? null;
    const problem = photoProblem(photo);
    if (problem) {
      json(res, 400, { error: problem });
      return;
    }
    const result = await update((db) => {
      const user = db.users.find((item) => item.id === photoMatch[1]);
      if (!user) return { error: "Хэрэглэгч олдсонгүй", status: 404 };
      user.photo = photo;
      return { ...adminView(db), self: user.id === me.id ? publicUser(user, db.cardTemplates) : undefined };
    });
    json(res, result.error ? result.status || 400 : 200, result);
    return;
  }
  const qrMatch = url.pathname.match(/^\/api\/admin\/users\/([\w-]+)\/card-qr$/);
  if (qrMatch && req.method === "POST") {
    const result = await update((db) => {
      const user = db.users.find((item) => item.id === qrMatch[1]);
      if (!user) return { error: "Хэрэглэгч олдсонгүй", status: 404 };
      if (user.role === "whiteking") return { error: "Станцад ирцийн QR олгохгүй", status: 400 };
      user.cardKey = newCardKey();
      return { ...adminView(db), self: user.id === me.id ? publicUser(user, db.cardTemplates) : undefined };
    });
    json(res, result.error ? result.status || 400 : 200, result);
    return;
  }
  const match = url.pathname.match(/^\/api\/admin\/users\/([\w-]+)$/);
  if (match && req.method === "PUT") {
    const body = await readBody(req);
    const fields = profileFields(body);
    if (fields.error) {
      json(res, 400, { error: fields.error });
      return;
    }
    if (body.role !== undefined && !ROLES.includes(body.role)) {
      json(res, 400, { error: "Эрх буруу" });
      return;
    }
    if (body.password) {
      const problem = passwordProblem(body.password);
      if (problem) {
        json(res, 400, { error: problem });
        return;
      }
    }
    const loginCode = body.loginCode === undefined ? null : cleanLoginCode(body.loginCode);
    if (body.loginCode !== undefined && !loginCode) {
      json(res, 400, { error: "Нэвтрэх нэр үсэг, тоо холилдсон 4 тэмдэгт байна" });
      return;
    }
    const result = await update((db) => {
      const user = db.users.find((item) => item.id === match[1]);
      if (!user) return { error: "Хэрэглэгч олдсонгүй", status: 404 };
      const card = cardPatch(body, user.card);
      if (card.error) return { error: card.error };
      if (db.users.some((item) => item.id !== user.id && item.card.idNumber === card.card.idNumber)) return { error: "Энэ ID дугаар өөр картанд бүртгэлтэй байна" };
      if (loginCode && db.users.some((item) => item.id !== user.id && item.loginCode === loginCode)) return { error: "Энэ нэвтрэх нэр өөр хэрэглэгчид олгогдсон байна" };
      if (loginCode) user.loginCode = loginCode;
      const before = { role: user.role, card: user.card };
      if (body.role !== undefined) user.role = body.role;
      user.card = card.card;
      if (body.status !== undefined) {
        delete user.card.restUntil;
        const block = restBlock(db.shiftPlans?.[user.id], Date.now());
        if (block) user.card.restHold = block.until;
        else delete user.card.restHold;
      }
      if (activeAdmins(db) < 1) {
        user.role = before.role;
        user.card = before.card;
        return { error: "Дор хаяж нэг идэвхтэй админ үлдэх ёстой" };
      }
      Object.assign(user, fields.patch);
      if (body.password) {
        user.pass = hashPassword(String(body.password));
        user.ver = (user.ver || 0) + 1;
      }
      syncLinkedProfile(db, user);
      return { ...adminView(db), self: user.id === me.id ? publicUser(user, db.cardTemplates) : undefined };
    });
    json(res, result.error ? result.status || 400 : 200, result);
    return;
  }
  if (match && req.method === "DELETE") {
    if (match[1] === me.id) {
      json(res, 400, { error: "Өөрийн эрхийг устгах боломжгүй" });
      return;
    }
    const result = await update((db) => {
      const index = db.users.findIndex((item) => item.id === match[1]);
      if (index < 0) return { error: "Хэрэглэгч олдсонгүй", status: 404 };
      const [removed] = db.users.splice(index, 1);
      if (activeAdmins(db) < 1) {
        db.users.splice(index, 0, removed);
        return { error: "Дор хаяж нэг идэвхтэй админ үлдэх ёстой" };
      }
      delete db[personalKey(removed.id)];
      if (db.shiftPlans) delete db.shiftPlans[removed.id];
      return adminView(db);
    });
    json(res, result.error ? result.status || 400 : 200, result);
    return;
  }
  json(res, 404, { error: "Олдсонгүй" });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  try {
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }
    await routeFile(res, url.pathname);
  } catch (error) {
    json(res, 500, { error: error.message || "Алдаа" });
  }
});

const CARD_COOLDOWN_MS = 60 * 1000;

function coolingDown(db, uid) {
  const since = presenceOf(db.attendance, uid).since;
  return Boolean(since && Date.now() - Date.parse(since) < CARD_COOLDOWN_MS);
}

/** A refusal for a card suspended by the rotation's rest block, or null. */
function resting(person) {
  if (person?.card?.status !== "SUSPENDED" || !person.card.restUntil) return null;
  return { ok: false, reason: "rest", person, error: `Амралтын хугацаа. ID карт ${dotDate(person.card.restUntil)} хүртэл түдгэлзсэн.` };
}

/** Checks a scanned QR (and burns one-time phone tokens) without recording attendance yet. */
function resolveScan(db, body, { card = false } = {}) {
  if (String(body.token || "").startsWith(CARD_QR_PREFIX)) {
    if (!card) return { ok: false, reason: "station" };
    const person = findByCardQr(db.users, body.token);
    if (resting(person)) return resting(person);
    if (!canScan(person)) return { ok: false, reason: "unknown" };
    if (coolingDown(db, person.id)) return { ok: false, reason: "cooldown", person };
    return { ok: true, person, card: true, place: db.location };
  }
  const check = verifyToken(db.secret, body.token);
  if (!check.ok) return { ok: false, reason: check.reason };
  const person = db.users.find((item) => item.id === check.payload.uid);
  if (resting(person)) return resting(person);
  if (!canScan(person)) return { ok: false, reason: "unknown" };
  if (db.attendance.usedJti.includes(check.payload.jti)) return { ok: false, reason: "replay" };
  db.attendance.usedJti.push(check.payload.jti);
  db.attendance.usedJti = db.attendance.usedJti.slice(-400);
  return {
    ok: true,
    person,
    card: false,
    place: { lat: Number(body.lat) || db.location.lat, lng: Number(body.lng) || db.location.lng },
  };
}

const STATION_APP = "umbrella-white-queen";
const STATION_PROBE = "UMBRELLA-WQ?";

const FACE_TTL_MS = 2 * 60 * 1000;
const FACE_BODY_LIMIT = 800_000;
const FACE_FRAMES_KEPT = 200;
const faceChecks = new Map();

/** After a valid QR: asks the scanner for face frames of the QR owner. */
async function openFaceCheck(scan, me, logFailure) {
  const { person } = scan;
  let reference = null;
  try {
    reference = person.photo ? await photoFace(person.photo) : null;
  } catch (error) {
    console.error(`Нүүр таних: ${error.message}`);
    throw new Error("Нүүр таних систем ажиллахгүй байна");
  }
  if (!reference) {
    await logFailure(`${person.displayName}: ID картын зурагт нүүр байхгүй тул ирц бүртгэгдсэнгүй`);
    return { ok: false, reason: "nophoto", name: person.displayName };
  }
  const now = Date.now();
  for (const [key, item] of faceChecks) if (item.expires < now) faceChecks.delete(key);
  const id = randomBytes(12).toString("base64url");
  faceChecks.set(id, { uid: person.id, by: me.id, card: scan.card, place: scan.place, reference, faces: [], expires: now + FACE_TTL_MS });
  return { ok: true, step: "face", challenge: id, name: person.displayName, seconds: FACE_TTL_MS / 1000 };
}

/**
 * Feeds one camera frame into a pending face check (or cancels it).
 * The verdict stays { done: false, hint } until the check is decided.
 */
async function faceStep(body, me) {
  const key = String(body.challenge || "");
  const check = faceChecks.get(key);
  if (!check || check.by !== me.id) return { verdict: { done: true, ok: false, reason: "timeout" } };
  if (body.cancel) {
    faceChecks.delete(key);
    return { verdict: { done: true, ok: false, reason: "cancelled" }, check };
  }
  if (check.expires < Date.now()) {
    faceChecks.delete(key);
    return { verdict: { ...faceProgress(check.reference, check.faces), done: true, ok: false, reason: "timeout" }, check };
  }
  const buffer = frameBuffer(body.frame);
  const face = buffer ? await faceOf(buffer).catch(() => null) : null;
  if (face && check.faces.length < FACE_FRAMES_KEPT) check.faces.push(face);
  const verdict = faceProgress(check.reference, check.faces);
  if (verdict.done) faceChecks.delete(key);
  return { verdict: { ...verdict, face: Boolean(face) }, check };
}

const FACE_FAIL = {
  mismatch: "нүүр ID картын зурагтай таарсангүй",
  timeout: "нүүр шалгах хугацаа дууссан",
};

function faceLogText(name, verdict) {
  const numbers = Number.isFinite(verdict.distance) ? ` · зөрүү ${verdict.distance}, эргэлт ${verdict.turn}` : "";
  return `${name}: ${FACE_FAIL[verdict.reason] || verdict.reason}${numbers}`;
}

function logFaceFailure(text) {
  return update((db) => {
    addLog(db.whiteking, "face", text);
  });
}

/** Records attendance once the face check has passed. */
function finishScan(db, check) {
  const person = db.users.find((item) => item.id === check.uid);
  if (resting(person)) return resting(person);
  if (!canScan(person)) return { ok: false, reason: "unknown" };
  if (check.card && coolingDown(db, person.id)) return { ok: false, reason: "cooldown", person };
  return { ok: true, reason: recordScan(db.attendance, person.id, check.place), person };
}

const STATION_ONLINE_MS = 60 * 1000;
const stations = new Map();

function stationList() {
  const now = Date.now();
  for (const [key, item] of stations) if (now - item.seen > 24 * 3600 * 1000) stations.delete(key);
  return [...stations.values()]
    .map((item) => ({ ...item, seen: new Date(item.seen).toISOString(), online: now - item.seen < STATION_ONLINE_MS }))
    .sort((a, b) => b.seen.localeCompare(a.seen));
}

function todayScans(db) {
  const today = shiftWindows().date;
  const names = new Map(db.users.map((user) => [user.id, user]));
  return db.attendance.events
    .filter((item) => item.date === today)
    .slice(-12)
    .reverse()
    .map(({ at, uid, state, shift }) => ({ at, state, shift, name: names.get(uid)?.displayName || "Тодорхойгүй", title: names.get(uid)?.title || "" }));
}

function planView(db, now) {
  const wk = db.whiteking;
  const date = localParts(new Date(now)).date;
  const context = speechContext(db.weather, now);
  return dailyPlan(wk.config).map((item) => ({
    key: item.key,
    time: item.time,
    kind: item.kind,
    zone: item.zone || null,
    state: item.state || null,
    label: item.label,
    text: fillTemplate(item.template, { ...context, ...itemContext(item, wk.config) }),
    fired: Boolean(wk.fired[`${date}|${item.key}`]),
  }));
}

function briefWeather(weather) {
  if (!weather) return null;
  const { tempC, feelsLikeC, windSpeedMs, windFrom: from, condition, code, precip, fetchedAt } = weather;
  return { tempC, feelsLikeC, windSpeedMs, windFrom: from, condition, code, precip, fetchedAt, hourly: (weather.hourly || []).slice(0, 8) };
}

function stationView(db, after) {
  const wk = db.whiteking;
  const now = Date.now();
  const announcements = Number.isFinite(after)
    ? wk.queue.filter((item) => item.id > after)
    : wk.queue.filter((item) => now - Date.parse(item.at) < 2 * 60 * 1000);
  return {
    clock: localParts(new Date(now)),
    now: new Date(now).toISOString(),
    weather: briefWeather(db.weather),
    lights: lightStates(wk.config, wk.overrides, now),
    plan: planView(db, now),
    announcements,
    seq: wk.seq,
    voice: wk.config.voice,
    chime: wk.config.chime,
    tts: voiceSupport().tts.length > 0,
    scans: todayScans(db),
  };
}

function adminWhiteKing(db) {
  const wk = db.whiteking;
  const now = Date.now();
  return {
    config: wk.config,
    clock: localParts(new Date(now)),
    lights: lightStates(wk.config, wk.overrides, now),
    plan: planView(db, now),
    log: wk.log.slice(-60).reverse(),
    seq: wk.seq,
    stations: stationList(),
    devices: deviceList(wk, now),
    placeholders: PLACEHOLDERS,
    weather: briefWeather(db.weather),
    tts: voiceSupport().tts.length > 0,
    scans: todayScans(db),
  };
}

function syncLights(wk, now) {
  const hooks = [];
  for (const [id, override] of Object.entries(wk.overrides)) if (Date.parse(override.until) <= now) delete wk.overrides[id];
  for (const zone of lightStates(wk.config, wk.overrides, now)) {
    if (wk.applied[zone.id] === zone.state) continue;
    wk.applied[zone.id] = zone.state;
    addLog(wk, "light", `${zone.name}: гэрэл ${zone.state === "on" ? "асав" : "унтрав"} (${zone.mode === "manual" ? "гараар" : "автомат"})`, now);
    const config = wk.config.zones.find((item) => item.id === zone.id);
    const url = zone.state === "on" ? config.webhookOn : config.webhookOff;
    if (url) hooks.push({ url, zone: zone.name });
  }
  return hooks;
}

function fireWebhooks(hooks) {
  for (const hook of hooks) {
    fetch(hook.url, { signal: AbortSignal.timeout(8000) })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      })
      .catch((error) => {
        console.error(`White Queen · ${hook.zone}: ${error.message}`);
        update((db) => {
          if (db.whiteking) addLog(db.whiteking, "error", `${hook.zone}: гэрлийн холбоос амжилтгүй (${error.message})`);
        }).catch(() => {});
      });
  }
}

let whitekingBusy = false;

async function whitekingTick() {
  if (whitekingBusy) return;
  whitekingBusy = true;
  try {
    const now = Date.now();
    const clock = localParts(new Date(now));
    const minute = clock.hh * 60 + clock.mm;
    const needed = await inspect((db) => {
      const wk = db.whiteking;
      if (!wk) return false;
      return (
        dueItems(dailyPlan(wk.config), wk.fired, clock.date, minute).length > 0 ||
        lightStates(wk.config, wk.overrides, now).some((zone) => wk.applied[zone.id] !== zone.state) ||
        Object.keys(wk.fired).some((key) => !key.startsWith(`${clock.date}|`))
      );
    });
    if (!needed) return;
    const hooks = await update(async (db) => {
      ensureWhiteKing(db);
      const wk = db.whiteking;
      const due = dueItems(dailyPlan(wk.config), wk.fired, clock.date, minute);
      if (due.some((item) => item.key === "morning")) await ensureFresh(db, true);
      const context = speechContext(db.weather, now);
      for (const item of due) {
        wk.fired[`${clock.date}|${item.key}`] = new Date(now).toISOString();
        const text = fillTemplate(item.template, { ...context, ...itemContext(item, wk.config) });
        if (text) enqueue(wk, text, item.label, "schedule", now);
      }
      pruneFired(wk, clock.date);
      return syncLights(wk, now);
    });
    fireWebhooks(hooks);
  } catch (error) {
    console.error(`White Queen: ${error.message}`);
  } finally {
    whitekingBusy = false;
  }
}

async function routeWhiteKing(req, res, url, me) {
  if (req.method === "GET" && url.pathname === "/api/whiteking/state") {
    const key = `${me.id}|${clientIp(req)}`;
    stations.set(key, { name: me.displayName, role: me.role, ip: clientIp(req), seen: Date.now() });
    const after = url.searchParams.has("after") ? Number(url.searchParams.get("after")) : Number.NaN;
    json(res, 200, await inspect((db) => stationView(db, after)));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/whiteking/scan") {
    const body = await readBody(req);
    const scan = await update((db) => {
      const result = resolveScan(db, body, { card: true });
      if (!result.ok) return { ok: false, reason: result.reason, ...(result.error ? { error: result.error } : {}), ...(result.person ? { name: result.person.displayName } : {}), scans: todayScans(db) };
      return result;
    });
    json(res, 200, scan.ok ? await openFaceCheck(scan, me, logFaceFailure) : scan);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/whiteking/face") {
    const { verdict, check } = await faceStep(await readBody(req, FACE_BODY_LIMIT), me);
    if (!verdict.done) return json(res, 200, { pending: true, hint: verdict.hint, face: verdict.face });
    const data = await update((db) => {
      const wk = db.whiteking;
      const owner = check && db.users.find((item) => item.id === check.uid);
      if (!verdict.ok) {
        if (owner && verdict.reason !== "cancelled") {
          addLog(wk, "face", faceLogText(owner.displayName, verdict));
          db.cardAttempts = noteAttempt(db.cardAttempts || [], owner.id, verdict);
          if (verdict.reason === "mismatch" || verdict.reason === "timeout") {
            const clock = localParts();
            const why = verdict.reason === "mismatch" ? "нүүр картын зурагтай таараагүй" : "нүүр шалгалт дуусаагүй";
            noticeFor(db, owner.id, "card", `Таны картаар ${String(clock.hh).padStart(2, "0")}:${String(clock.mm).padStart(2, "0")}-д оролдлого хийгдсэн, ${why}. Та биш бол админд мэдэгдэнэ үү.`);
          }
        }
        return { ok: false, reason: verdict.reason, ...(owner ? { name: owner.displayName } : {}), scans: todayScans(db) };
      }
      const result = finishScan(db, check);
      if (!result.ok) return { ok: false, reason: result.reason, ...(result.error ? { error: result.error } : {}), ...(result.person ? { name: result.person.displayName } : {}), scans: todayScans(db) };
      const name = result.person.displayName;
      const template = result.reason === "in" ? wk.config.scan.inText : wk.config.scan.outText;
      addLog(wk, "scan", `${name}: ${result.reason === "in" ? "ирц бүртгүүлэв" : "гарсан цаг бүртгүүлэв"} · нүүр таарсан (зөрүү ${verdict.distance})`);
      return {
        ok: true,
        state: result.reason,
        person: { name, title: result.person.title || "", photo: result.person.photo || null, idNumber: result.person.card?.idNumber || "" },
        speech: wk.config.voice && wk.config.scan.enabled ? fillTemplate(template, speechContext(db.weather, Date.now(), { name })) : "",
        scans: todayScans(db),
      };
    });
    json(res, 200, data);
    return;
  }
  json(res, 404, { error: "Олдсонгүй" });
}

function cleanSay(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 400 || /[<>\p{Cc}]/u.test(text)) return null;
  return text;
}

async function routeAdminWhiteKing(req, res, url, me) {
  if (req.method === "GET" && url.pathname === "/api/admin/whiteking") {
    json(res, 200, await inspect(adminWhiteKing));
    return;
  }
  if (req.method === "PUT" && url.pathname === "/api/admin/whiteking") {
    const body = await readBody(req);
    const result = await update((db) => {
      const wk = db.whiteking;
      const next = cleanConfig(body, wk.config);
      if (next.error) return { error: next.error };
      wk.config = next.config;
      addLog(wk, "config", `${me.displayName} тохиргоог шинэчлэв`);
      return { hooks: syncLights(wk, Date.now()), view: adminWhiteKing(db) };
    });
    if (result.error) {
      json(res, 400, { error: result.error });
      return;
    }
    fireWebhooks(result.hooks);
    json(res, 200, result.view);
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/whiteking/say") {
    const text = cleanSay((await readBody(req)).text);
    if (!text) {
      json(res, 400, { error: "Мэдэгдэл 1–400 тэмдэгт, < > тэмдэггүй байна" });
      return;
    }
    json(res, 200, await update((db) => {
      enqueue(db.whiteking, text, `${me.displayName} · шууд мэдэгдэл`, "admin");
      return adminWhiteKing(db);
    }));
    return;
  }
  const device = url.pathname.match(/^\/api\/admin\/whiteking\/devices\/([a-f0-9]+)(\/approve)?$/);
  if (device && ((req.method === "POST" && device[2]) || (req.method === "DELETE" && !device[2]))) {
    const result = await update((db) => {
      const wk = db.whiteking;
      if (device[2]) {
        const approved = approveDevice(wk, device[1]);
        if (!approved) return { error: "Хүсэлтийн хугацаа дууссан эсвэл олдсонгүй" };
        addLog(wk, "config", `${me.displayName}: «${approved.name}» төхөөрөмжийг зөвшөөрөв (код ${approved.code})`);
      } else {
        const removed = removeDevice(wk, device[1]);
        if (!removed) return { error: "Төхөөрөмж олдсонгүй" };
        if (removed.status === "approved") {
          for (const user of db.users.filter((item) => item.role === "whiteking")) user.ver = (user.ver || 0) + 1;
        }
        addLog(wk, "config", `${me.displayName}: «${removed.name}» төхөөрөмжийг ${removed.status === "approved" ? "хасав" : "татгалзав"}`);
      }
      return adminWhiteKing(db);
    });
    json(res, result.error ? 404 : 200, result);
    return;
  }
  const lights = url.pathname.match(/^\/api\/admin\/whiteking\/lights\/([a-z0-9_-]+)$/);
  if (req.method === "POST" && lights) {
    const mode = (await readBody(req)).mode;
    if (!["on", "off", "auto"].includes(mode)) {
      json(res, 400, { error: "Горим буруу" });
      return;
    }
    const result = await update((db) => {
      const wk = db.whiteking;
      const zone = wk.config.zones.find((item) => item.id === lights[1]);
      if (!zone) return { error: "Бүс олдсонгүй" };
      const now = Date.now();
      setOverride(wk, zone, mode, now);
      addLog(wk, "light", `${me.displayName}: ${zone.name} → ${{ on: "гараар асаах", off: "гараар унтраах", auto: "автомат горим" }[mode]}`, now);
      return { hooks: syncLights(wk, now), view: adminWhiteKing(db) };
    });
    if (result.error) {
      json(res, 404, { error: result.error });
      return;
    }
    fireWebhooks(result.hooks);
    json(res, 200, result.view);
    return;
  }
  json(res, 404, { error: "Олдсонгүй" });
}

const STATION_PATHS = [/^\/api\/whiteking\//, /^\/api\/tts$/, /^\/api\/me(\/|$)/];

async function routeApi(req, res, url) {
  if (url.pathname.startsWith("/api/auth/")) {
    await routeAuth(req, res, url);
    return;
  }
  if (url.pathname.startsWith("/api/mobile/") && url.pathname !== "/api/mobile/token" && url.pathname !== "/api/mobile/link") {
    const phone = await mobileUser(req);
    if (!phone) {
      json(res, 401, { error: "Апп-аас дахин нэвтэрнэ үү" });
      return;
    }
    await routeMobile(req, res, url, phone);
    return;
  }
  let me = null;
  if (tunneled(req) || !PUBLIC_API.some((pattern) => pattern.test(url.pathname))) {
    me = await sessionUser(req);
    if (!me) {
      json(res, 401, { error: "Нэвтэрнэ үү" });
      return;
    }
    if (me.role === "whiteking" && !STATION_PATHS.some((pattern) => pattern.test(url.pathname))) {
      json(res, 403, { error: "White Queen станц зөвхөн ирц, мэдэгдлийн хэсгийг ашиглана" });
      return;
    }
    if (url.pathname === "/api/me" || url.pathname.startsWith("/api/me/")) {
      await routeMe(req, res, url, me);
      return;
    }
    if (url.pathname.startsWith("/api/whiteking/")) {
      if (me.role !== "whiteking" && me.role !== "admin") {
        json(res, 403, { error: "Зөвхөн White Queen станц болон админд зориулсан" });
        return;
      }
      await routeWhiteKing(req, res, url, me);
      return;
    }
    if (url.pathname === "/api/hr" || url.pathname.startsWith("/api/hr/")) {
      if (me.role !== "hr") {
        json(res, 403, { error: "Зөвхөн хүний нөөцөд зориулсан" });
        return;
      }
      await routeHr(req, res, url, me);
      return;
    }
    if (url.pathname === "/api/kitchen" || url.pathname.startsWith("/api/kitchen/")) {
      if (me.role !== "kitchen") {
        json(res, 403, { error: "Зөвхөн гал тогоонд зориулсан" });
        return;
      }
      await routeKitchen(req, res, url, me);
      return;
    }
    if (url.pathname.startsWith("/api/admin/")) {
      if (me.role !== "admin") {
        json(res, 403, { error: "Зөвхөн админд зориулсан" });
        return;
      }
      if (url.pathname === "/api/admin/whiteking" || url.pathname.startsWith("/api/admin/whiteking/")) await routeAdminWhiteKing(req, res, url, me);
      else await routeAdmin(req, res, url, me);
      return;
    }
  }
  if (req.method === "POST" && url.pathname === "/api/mobile/token") {
    const token = await inspect((db) => issueMobileToken(db.secret, db.users.find((item) => item.id === me.id)));
    json(res, 200, { token, user: { id: me.id, name: me.displayName, role: me.role } });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/mobile/link") {
    json(res, 200, { url: publicUrl() });
    return;
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/wx/")) {
    const wxTile = url.pathname.match(/^\/api\/wx\/tiles\/([a-z]+)\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (wxTile) {
      await serveWxTile(res, wxTile[1], Number(wxTile[2]), Number(wxTile[3]), Number(wxTile[4]), wxBucket(url.searchParams.get("t")));
      return;
    }
    if (url.pathname === "/api/wx/point") {
      await serveWxPoint(res, Number(url.searchParams.get("lat")), Number(url.searchParams.get("lng")));
      return;
    }
  }
  if (req.method === "GET" && url.pathname.startsWith("/api/tiles/")) {
    const base = url.pathname.match(/^\/api\/tiles\/osm\/(\d+)\/(\d+)\/(\d+)$/);
    const owm = url.pathname.match(/^\/api\/tiles\/owm\/([a-z_]+)\/(\d+)\/(\d+)\/(\d+)$/);
    const traffic = url.pathname.match(/^\/api\/tiles\/traffic\/(\d+)\/(\d+)\/(\d+)$/);
    const building = url.pathname.match(/^\/api\/tiles\/buildings\/(\d+)\/(\d+)\/(\d+)$/);
    if (building) {
      await serveBuildings(res, Number(building[1]), Number(building[2]), Number(building[3]));
      return;
    }
    if (traffic) {
      await serveTraffic(res, Number(traffic[1]), Number(traffic[2]), Number(traffic[3]));
      return;
    }
    if (base) {
      await serveTile(res, "base", null, Number(base[1]), Number(base[2]), Number(base[3]));
      return;
    }
    if (owm) {
      await serveTile(res, "owm", owm[1], Number(owm[2]), Number(owm[3]), Number(owm[4]));
      return;
    }
    tileError(res, 404, "Тайл олдсонгүй");
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/maps/config") {
    json(res, 200, {
      googleKey: process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY || null,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/place") {
    const lat = Number(url.searchParams.get("lat"));
    const lng = Number(url.searchParams.get("lng"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      json(res, 400, { error: "Координат буруу" });
      return;
    }
    const place = await placeAt(lat, lng, (url.searchParams.get("name") || "").slice(0, 120));
    json(res, place ? 200 : 404, place || { error: "Энэ цэгт газрын мэдээлэл олдсонгүй" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/place-search") {
    const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
    if (!query) {
      json(res, 400, { error: "Хайх үг хоосон байна" });
      return;
    }
    const coord = (name) => (url.searchParams.has(name) ? Number(url.searchParams.get(name)) : Number.NaN);
    const places = await searchPlaces(query, coord("lat"), coord("lng"));
    json(res, 200, { places });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/field") {
    await serveField(
      res,
      Number(url.searchParams.get("z")),
      Number(url.searchParams.get("x")),
      Number(url.searchParams.get("y")),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/live") {
    const data = await update(async (db) => {
      await ensureFresh(db);
      return view(db, me?.id);
    });
    json(res, 200, data);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/location") {
    const body = await readBody(req);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      json(res, 400, { error: "Байршил буруу" });
      return;
    }
    const data = await update(async (db) => {
      const moved = haversineM(db.location, { lat, lng }) > 300 || !db.location.label;
      db.location = { ...db.location, lat, lng };
      if (moved) {
        try {
          db.location.label = await reverseGeocode(lat, lng);
        } catch {
          /* keep previous label */
        }
      }
      await ensureFresh(db, true);
      return view(db, me?.id);
    });
    json(res, 200, data);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/leaves") {
    const body = await readBody(req);
    const result = await update((db) => {
      ensureWorkplan(db);
      const today = shiftWindows().date;
      const request = leaveRequest(body, { uid: me.id, today, leaves: db.leaves });
      if (request.error) return request;
      db.leaves = pruneLeaves([...db.leaves, request.leave], today);
      return view(db, me.id);
    });
    json(res, result.error ? 400 : 200, result);
    return;
  }

  const ownLeave = url.pathname.match(/^\/api\/leaves\/([\w-]+)$/);
  if (req.method === "DELETE" && ownLeave) {
    const result = await update((db) => {
      ensureWorkplan(db);
      const leave = db.leaves.find((item) => item.id === ownLeave[1] && item.uid === me.id);
      if (!leave) return { error: "Хүсэлт олдсонгүй", status: 404 };
      if (leave.status !== "pending") return { error: "Шийдвэрлэгдсэн хүсэлтийг цуцлах боломжгүй", status: 409 };
      db.leaves = db.leaves.filter((item) => item !== leave);
      return view(db, me.id);
    });
    json(res, result.error ? result.status : 200, result);
    return;
  }

  /** Applies a change to the caller's own record; the mutator returns an error string to reject it. */
  const personal = async (mutate) => {
    const result = await update((db) => {
      const today = localParts().date;
      const record = personalOf(db, me.id);
      const error = mutate(record, today, db);
      if (error) return { error };
      prunePersonal(record, today);
      return view(db, me.id);
    });
    json(res, result.error ? 400 : 200, result);
  };

  if (req.method === "POST" && url.pathname === "/api/hydration") {
    const amount = waterAmount((await readBody(req)).amountMl);
    if (!amount) {
      json(res, 400, { error: "Хэмжээ 50–1000 мл" });
      return;
    }
    await personal((record, today) => void addWater(dayOf(record, today), amount));
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/sleep") {
    const { sleep, error } = sleepInput(await readBody(req));
    if (error) {
      json(res, 400, { error });
      return;
    }
    await personal((record, today) => void (dayOf(record, today).sleep = sleep));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/health/eat") {
    const id = String((await readBody(req)).id || "");
    await personal((record, today, db) => {
      const date = shiftWindows().date;
      const user = db.users.find((item) => item.id === me.id);
      const { items } = shiftMenu(db, date, plannedToday(db, user, date));
      if (!items.some((item) => item.id === id)) return "Энэ хоол таны ээлжийн цэсэнд алга";
      toggleEaten(dayOf(record, date), items, id);
      return null;
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/health/meal") {
    const meal = (await readBody(req)).meal;
    await personal((record, today) => (toggleMeal(dayOf(record, today), meal) ? null : "Хоолны төрөл буруу"));
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/health/mood") {
    const mood = moodValue((await readBody(req)).mood);
    if (!mood) {
      json(res, 400, { error: "Сэтгэл санаа 1–5 байна" });
      return;
    }
    await personal((record, today) => {
      const day = dayOf(record, today);
      day.mood = day.mood === mood ? undefined : mood;
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/notices/seen") {
    const id = (await readBody(req)).id;
    await personal((record) => {
      for (const item of record.notices) if (!id || item.id === id) item.seen = true;
    });
    return;
  }

  const readMatch = url.pathname.match(/^\/api\/announcements\/([\w-]+)\/read$/);
  if (readMatch && req.method === "POST") {
    await personal((record, today, db) => {
      const item = (db.announcements || []).find((entry) => entry.id === readMatch[1]);
      if (!item) return "Зарлал олдсонгүй";
      if (!item.readBy.includes(me.id)) item.readBy.push(me.id);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reminders") {
    const { reminder, error } = reminderInput(await readBody(req));
    if (error) {
      json(res, 400, { error });
      return;
    }
    await personal((record) => void record.reminders.push(reminder));
    return;
  }

  const reminderMatch = url.pathname.match(/^\/api\/reminders\/([\w-]+)$/);
  if (reminderMatch && (req.method === "POST" || req.method === "DELETE")) {
    await personal((record, today) => {
      const item = record.reminders.find((entry) => entry.id === reminderMatch[1]);
      if (!item) return "Сануулга олдсонгүй";
      if (req.method === "DELETE") record.reminders = record.reminders.filter((entry) => entry !== item);
      else Object.assign(item, { done: !item.done, doneOn: item.done ? null : today });
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/health/activity") {
    const body = await readBody(req);
    const addSteps = body.addSteps == null || body.addSteps === "" ? 0 : Number(body.addSteps);
    const addMinutes = body.addMinutes == null || body.addMinutes === "" ? 0 : Number(body.addMinutes);
    const steps = body.steps == null || body.steps === "" ? null : Number(body.steps);
    const valid =
      Number.isInteger(addSteps) && addSteps >= 0 && addSteps <= 30000 &&
      Number.isInteger(addMinutes) && addMinutes >= 0 && addMinutes <= 600 &&
      (steps === null || (Number.isInteger(steps) && steps >= 0 && steps <= 100000));
    if (!valid || (!addSteps && !addMinutes && steps === null)) {
      json(res, 400, { error: "Алхам 0–100000, идэвхтэй минут 0–600 байна" });
      return;
    }
    await personal((record, today) => {
      const day = dayOf(record, today);
      if (steps !== null) day.steps = steps;
      day.steps = Math.min(100000, (day.steps || 0) + addSteps);
      day.active = Math.min(1440, (day.active || 0) + addMinutes);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/health/watch") {
    const { reading, error } = watchInput(await readBody(req));
    if (error) {
      json(res, 400, { error });
      return;
    }
    await personal((record, today) => void applyWatch(record, dayOf(record, today), reading));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/health/vitals") {
    const body = await readBody(req);
    const read = (value) => (value == null || value === "" ? null : Number(value));
    const sys = read(body.sys);
    const dia = read(body.dia);
    const hr = read(body.hr);
    const bpGiven = sys !== null || dia !== null;
    const bpOk = !bpGiven || (sys >= 70 && sys <= 260 && dia >= 40 && dia <= 160 && sys > dia);
    const hrOk = hr === null || (hr >= 30 && hr <= 220);
    if (!bpOk || !hrOk || (!bpGiven && hr === null)) {
      json(res, 400, { error: "Даралт 70–260 / 40–160, судасны цохилт 30–220 байна" });
      return;
    }
    await personal((record) => {
      record.vitals.push({
        at: new Date().toISOString(),
        sys: bpGiven ? Math.round(sys) : null,
        dia: bpGiven ? Math.round(dia) : null,
        hr: hr === null ? null : Math.round(hr),
      });
    });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/health/body") {
    const body = await readBody(req);
    const weight = Number(body.weightKg);
    const height = Number(body.heightCm);
    if (!(weight >= 35 && weight <= 220) || !(height >= 120 && height <= 230)) {
      json(res, 400, { error: "Жин 35–220 кг, өндөр 120–230 см байна" });
      return;
    }
    await personal((record, today) => {
      record.weightKg = Math.round(weight * 10) / 10;
      record.heightCm = Math.round(height);
      dayOf(record, today).weight = record.weightKg;
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/vision") {
    const body = await readBody(req);
    const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
    const data = await update((db) => {
      db.vision = {
        at: new Date().toISOString(),
        fatigue: clamp(body.fatigue),
        stress: clamp(body.stress),
        hydration: clamp(body.hydration),
        irritation: clamp(body.irritation),
        confidence: clamp(body.confidence),
        quote: String(body.quote || "").slice(0, 240),
        advice: String(body.advice || "").slice(0, 600),
        skinAdvice: String(body.skinAdvice || "").slice(0, 400),
        withheld: Boolean(body.withheld),
      };
      return view(db, me?.id);
    });
    json(res, 200, data);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/tts") {
    const body = await readBody(req);
    const text = String(body.text || "").trim().slice(0, 1500);
    if (!text) {
      json(res, 400, { error: "Унших текст хоосон байна" });
      return;
    }
    const voice = VOICES.includes(body.voice) ? body.voice : "jarvis";
    const key = `${voice}|${text}`;
    try {
      let speech = ttsCache.get(key);
      if (!speech) {
        speech = await synthesize(text, voice);
        ttsCache.set(key, speech);
        if (ttsCache.size > 80) ttsCache.delete(ttsCache.keys().next().value);
      }
      res.writeHead(200, { "Content-Type": speech.type, "Cache-Control": "no-store", "X-Voice-Source": encodeURIComponent(speech.source) });
      res.end(speech.audio);
    } catch (error) {
      json(res, 503, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stt") {
    const type = String(req.headers["content-type"] || "audio/webm");
    if (!type.startsWith("audio/")) {
      json(res, 400, { error: "Аудио формат буруу" });
      return;
    }
    const audio = await readRaw(req, 10_000_000);
    if (audio.length < 1000) {
      json(res, 400, { error: "Бичлэг хэт богино байна" });
      return;
    }
    try {
      json(res, 200, await transcribe(audio, type));
    } catch (error) {
      json(res, 503, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/ask") {
    const body = await readBody(req);
    const message = String(body.message || "").trim();
    if (!message || message.length > 1000) {
      json(res, 400, { error: "Асуулт хоосон эсвэл хэт урт" });
      return;
    }
    const provider = ["auto", "all", ...PROVIDER_IDS].includes(body.provider) ? body.provider : "auto";
    const context = await update(async (db) => {
      await ensureFresh(db);
      const mine = personalView(db, me.id);
      return structuredClone({
        origin: { lat: db.location.lat, lng: db.location.lng },
        locationLabel: db.location.label,
        weather: clientWeather(db.weather),
        schedule: shiftLines(db, me.id),
        reminders: mine.reminders.filter((item) => !item.done).map((item) => ({ due: item.due || "", title: item.title })),
        hydration: { targetMl: mine.hydration.targetMl, reason: mine.hydration.reason, logs: [{ amountMl: mine.hydration.drunkMl }] },
        energy: mine.energy,
        history: db.messages,
      });
    });
    const askedAt = new Date().toISOString();
    const result = await answer({ ...context, message, provider });
    const data = await update((db) => {
      db.messages.push({ role: "user", text: message, at: askedAt });
      db.messages.push({
        role: "assistant",
        text: result.reply,
        unclear: Boolean(result.unclear),
        cards: result.cards,
        provider: result.provider,
        note: result.note || null,
        answers: result.answers || null,
        at: new Date().toISOString(),
      });
      db.messages = db.messages.slice(-20);
      return view(db, me?.id);
    });
    json(res, 200, data);
    return;
  }

  json(res, 404, { error: "Олдсонгүй" });
}

async function routeFile(res, pathname) {
  if (pathname === "/queen") {
    const html = await readFile(path.join(publicDir, "index.html"), "utf8");
    send(res, 200, html.replace(/<title>[^<]*<\/title>/, QUEEN_HEAD), types[".html"]);
    return;
  }
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, decodeURIComponent(requested)));
  const relative = path.relative(publicDir, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    send(res, 403, "Хориотой", "text/plain; charset=utf-8");
    return;
  }
  try {
    const body = await readFile(filePath);
    send(res, 200, body, types[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Олдсонгүй", "text/plain; charset=utf-8");
  }
}

setInterval(() => {
  update(async (db) => {
    const clock = localParts();
    const age = db.weather?.fetchedAt ? Date.now() - new Date(db.weather.fetchedAt).getTime() : Infinity;
    const briefingDue = clock.hh === 6 && clock.mm < 2;
    if ((age < 5 * 60 * 1000 && !briefingDue) || Date.now() < weatherRetryAt) return;
    await ensureFresh(db, true);
  }).catch((error) => console.error(error.message));
}, 30 * 1000);

update((db) => {
  const seeded = ensureUsers(db);
  if (seeded) {
    console.log(`Анхны эрхүүд үүслээ. Админ: ${seeded.adminCode} / ${seeded.admin} · Хэрэглэгч: ${seeded.userCode} / ${seeded.user}. Нэвтэрсний дараа нууц үгээ солино уу.`);
  }
  if (ensureCardTemplates(db)) console.log("Картын бичвэрүүд түвшний загвар руу шилжлээ.");
  for (const user of ensureLoginCodes(db)) console.log(`Нэвтрэх нэр олгогдлоо: @${user.username} → ${user.loginCode}`);
  const keyed = ensureCardKeys(db);
  if (keyed) console.log(`ID картын ирцийн QR үүслээ: ${keyed} хэрэглэгч`);
  const station = ensureStationUser(db);
  if (station) console.log(`White Queen станцын эрх үүслээ: ${station.code} / ${station.password}`);
  ensureAttendance(db);
  ensureWorkplan(db);
  ensureMenu(db);
  if (migrateSharedHealth(db)) console.log("Эрүүл мэндийн нийтийн өгөгдлийг хэрэглэгч бүрт тусгаарлалаа.");
  ensureWhiteKing(db);
})
  .then(() => update((db) => ensureFresh(db, true)))
  .catch((error) => console.error(error.message))
  .finally(() => {
    whitekingTick();
    restTick();
  });
setInterval(whitekingTick, 10 * 1000);
setInterval(restTick, 60 * 1000);

if (HOSTED && !firebaseConfigured()) {
  console.error("FIREBASE_SERVICE_ACCOUNT тохируулаагүй байна. Интернэт сервер анхны нууц үгтэй хоосон өгөгдлөөр асахгүй.");
  process.exit(1);
}

const port = Number(process.env.PORT) || 4173;
server.listen(port, HOSTED ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`UMBRELLA Corporation: http://127.0.0.1:${port}`);
  ensureTunnel(port).catch((error) => console.error(`Cloudflare туннель: ${error.message}`));
  try {
    console.log(`Өгөгдлийн сан: ${storageLabel()}`);
  } catch (error) {
    console.error(`Өгөгдлийн сан: ${error.message}`);
  }
  warmFace()
    .then(() => inspect((db) => db.users.filter((user) => user.role !== "whiteking").map((user) => ({ name: user.displayName, photo: user.photo }))))
    .then(async (people) => {
      const missing = [];
      for (const person of people) if (!person.photo || !(await photoFace(person.photo))) missing.push(person.name);
      console.log(`Нүүр таних бэлэн: ${people.length - missing.length}/${people.length} хэрэглэгчийн зураг ашиглагдана${missing.length ? ` · зураг/нүүргүй: ${missing.join(", ")}` : ""}`);
    })
    .catch((error) => console.error(`Нүүр таних ачаалагдсангүй: ${error.message}`));
  worldData()
    .then((world) => console.log(`NOAA GFS бэлэн: 0.25° ${world.regional ? cycleLabel(world.regional) : "алга"}, 1° ${world.global ? cycleLabel(world.global) : "алга"}`))
    .catch((error) => console.error(error.message));
});

// White Queen phones on the Wi-Fi reach only the station API through this port; everything else stays on localhost.
const STATION_PORT = Number(process.env.STATION_PORT) || 4174;
const LAN_PATHS = new Set([
  "/api/auth/ping",
  "/api/auth/device/request",
  "/api/auth/device/login",
  "/api/whiteking/state",
  "/api/whiteking/scan",
  "/api/whiteking/face",
  "/api/tts",
]);
function openStationLan() {
  const stationGate = createServer((req, res) => {
    if (LAN_PATHS.has(new URL(req.url, "http://station").pathname)) {
      server.emit("request", req, res);
      return;
    }
    json(res, 404, { error: "Олдсонгүй" });
  });
  stationGate.on("error", (error) => console.error(`White Queen Wi-Fi холболт нээгдсэнгүй: ${error.message}`));
  stationGate.listen(STATION_PORT, "0.0.0.0", () => {
    const addresses = Object.values(networkInterfaces())
      .flat()
      .filter((item) => item?.family === "IPv4" && !item.internal)
      .map((item) => `http://${item.address}:${STATION_PORT}`);
    console.log(`White Queen Wi-Fi холболт: ${addresses.join(", ") || `порт ${STATION_PORT}`}`);
  });

  const finder = createSocket("udp4");
  finder.on("message", (message, from) => {
    if (message.toString() !== STATION_PROBE) return;
    finder.send(JSON.stringify({ app: STATION_APP, port: STATION_PORT }), from.port, from.address);
  });
  finder.on("error", (error) => console.error(`White Queen хайлт ажиллахгүй: ${error.message}`));
  finder.bind(STATION_PORT);
}

if (!HOSTED) openStationLan();
