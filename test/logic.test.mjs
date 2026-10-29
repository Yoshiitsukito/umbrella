import test from "node:test";
import assert from "node:assert/strict";
import { hydrationTarget, energyFromSleep, clockSpan } from "../lib/wellness.mjs";
import { parseAsk, readRadius } from "../lib/places.mjs";
import { issueToken, verifyToken } from "../lib/token.mjs";
import { classifyPrecip, windFrom, parseLocalIso } from "../lib/weather.mjs";
import { airInfo, bloodPressureBand, bmiInfo, climateAdvice, healthSummary } from "../lib/health.mjs";

test("blood pressure follows AHA bands", () => {
  assert.equal(bloodPressureBand(115, 75).band, "normal");
  assert.equal(bloodPressureBand(125, 78).band, "elevated");
  assert.equal(bloodPressureBand(132, 70).band, "stage1");
  assert.equal(bloodPressureBand(128, 92).band, "stage2");
  assert.equal(bloodPressureBand(185, 100).band, "crisis");
});

test("BMI and air quality bands", () => {
  assert.deepEqual(bmiInfo(62, 165), { value: 22.8, band: "normal", label: "Хэвийн жин" });
  assert.equal(bmiInfo(62, null), null);
  assert.equal(airInfo({ usAqi: 56, pm25: 7, uv: 2 }).band, "moderate");
  assert.equal(airInfo({ usAqi: 180 }).band, "bad");
  assert.equal(climateAdvice(-35).band, "warn");
  assert.equal(climateAdvice(-42).band, "danger");
});

test("health score uses only available data and flags a BP crisis first", () => {
  const summary = healthSummary({
    drunkMl: 1000,
    targetMl: 2000,
    energy: null,
    steps: 8000,
    activeMin: 30,
    vision: null,
    air: null,
    vitals: { bp: { band: "crisis", label: "Яаралтай өндөр", advice: "103" } },
    climate: null,
    hour: 12,
    today: "2026-10-27",
  });
  assert.equal(summary.score, 75);
  assert.equal(summary.parts.length, 2);
  assert.equal(summary.tips[0].level, "danger");
});

test("cold day hydration stays inside the safe band", () => {
  const plan = hydrationTarget(62, -7, true);
  assert.ok(plan.targetMl >= 1500 && plan.targetMl <= 4500);
  assert.equal(plan.heat, 0.95);
  assert.equal(plan.activity, 1.15);
});

test("short sleep produces a low energy day", () => {
  const energy = energyFromSleep({ durationMin: 300, score: 50 });
  assert.equal(energy.band, "low");
  assert.ok(energy.blocks.length >= 3);
});

test("overnight clock span crosses midnight", () => {
  assert.equal(clockSpan("23:00", "07:00"), 480);
});

test("nearby food question stays a place search", () => {
  const parsed = parseAsk("Надад ойр хоолны газруудыг хэлж өгнө үү");
  assert.equal(parsed.intent, "places");
  assert.equal(parsed.radiusM, 1500);
});

test("China trip resolves to Beijing and a date", () => {
  const parsed = parseAsk("Хятад руу онгоцоор явах хуваарь", new Date("2026-10-27T04:00:00Z"));
  assert.equal(parsed.intent, "trip");
  assert.equal(parsed.destination.place.code, "PEK");
  assert.equal(parsed.destination.place.generic, true);
  assert.equal(parsed.date, "2026-10-28");
});

test("food in Shanghai is not a flight search", () => {
  const parsed = parseAsk("Шанхайд ойрхон хоолны газар");
  assert.equal(parsed.intent, "places_there");
  assert.equal(parsed.destination.place.code, "PVG");
});

test("radius parses kilometres", () => {
  assert.equal(readRadius("2 км дотор"), 2000);
});

test("QR token expires and rejects tampering", () => {
  const secret = "test-secret";
  const issued = issueToken(secret, "usr_saran", 30, 1_000_000);
  assert.equal(verifyToken(secret, issued.token, 1_000_100).ok, true);
  assert.equal(verifyToken(secret, issued.token, 1_040_000).reason, "expired");
  const [body] = issued.token.split(".");
  assert.equal(verifyToken(secret, `${body}.aaaa`, 1_000_100).reason, "unknown");
});

test("precipitation alert only fires inside 20 minutes", () => {
  const now = parseLocalIso("2026-10-27T12:00", 28800);
  const clear = classifyPrecip(
    [
      { time: "2026-10-27T12:00", precipMm: 0 },
      { time: "2026-10-27T12:15", precipMm: 0 },
    ],
    now,
    -2,
    0,
    28800,
  );
  assert.equal(clear.status, "clear");
  const soon = classifyPrecip(
    [
      { time: "2026-10-27T12:00", precipMm: 0 },
      { time: "2026-10-27T12:15", precipMm: 0.4 },
    ],
    now,
    -2,
    71,
    28800,
  );
  assert.equal(soon.status, "approaching");
  assert.equal(soon.kind, "snow");
  assert.equal(soon.inMin, 15);
  const nowWet = classifyPrecip([{ time: "2026-10-27T12:00", precipMm: 1 }], now, 8, 61, 28800);
  assert.equal(nowWet.status, "ongoing");
  assert.equal(nowWet.kind, "rain");
});

test("wind direction 231 is southwest", () => {
  assert.equal(windFrom(231), "баруун урд");
  assert.equal(windFrom(0), "хойд");
});
