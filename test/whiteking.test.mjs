import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanConfig,
  dailyPlan,
  defaultConfig,
  dueItems,
  ensureWhiteKing,
  fillTemplate,
  lightStates,
  setOverride,
  speechContext,
} from "../lib/whiteking.mjs";

const at = (local) => Date.parse(`${local}+08:00`);

test("gym warns 15, 10 and 5 minutes before 22:00", () => {
  const plan = dailyPlan(defaultConfig());
  const gym = plan.filter((item) => item.zone === "gym").map((item) => `${item.time} ${item.key}`);
  assert.deepEqual(gym, ["18:00 gym:on", "21:45 gym:warn15", "21:50 gym:warn10", "21:55 gym:warn5", "22:00 gym:off"]);
  assert.equal(plan[0].key, "dorm:on");
  assert.equal(plan[0].time, "05:30");
  assert.equal(plan.find((item) => item.key === "morning").time, "06:00");
});

test("an item is due once inside its two-minute window", () => {
  const plan = dailyPlan(defaultConfig());
  const minute = 21 * 60 + 45;
  assert.deepEqual(dueItems(plan, {}, "2026-10-28", minute).map((item) => item.key), ["gym:warn15"]);
  assert.deepEqual(dueItems(plan, {}, "2026-10-28", minute + 1).map((item) => item.key), ["gym:warn15"]);
  assert.deepEqual(dueItems(plan, {}, "2026-10-28", minute + 2), []);
  assert.deepEqual(dueItems(plan, { "2026-10-28|gym:warn15": "x" }, "2026-10-28", minute), []);
});

test("lights follow the schedule and manual overrides last until the next change", () => {
  const config = defaultConfig();
  const states = (local, overrides) => Object.fromEntries(lightStates(config, overrides, at(local)).map((zone) => [zone.id, zone.state]));
  assert.deepEqual(states("2026-10-28T05:29:00"), { gym: "off", dorm: "off" });
  assert.deepEqual(states("2026-10-28T05:30:00"), { gym: "off", dorm: "on" });
  assert.deepEqual(states("2026-10-28T18:00:00"), { gym: "on", dorm: "on" });
  assert.deepEqual(states("2026-10-28T22:00:00"), { gym: "off", dorm: "on" });
  assert.deepEqual(states("2026-10-28T23:00:00"), { gym: "off", dorm: "off" });

  const wk = { overrides: {} };
  setOverride(wk, config.zones[0], "on", at("2026-10-28T22:30:00"));
  assert.equal(wk.overrides.gym.until, new Date(at("2026-10-29T18:00:00")).toISOString());
  assert.equal(states("2026-10-28T23:00:00", wk.overrides).gym, "on");
  assert.equal(states("2026-10-29T18:30:00", wk.overrides).gym, "on");
  setOverride(wk, config.zones[0], "off", at("2026-10-28T19:00:00"));
  assert.equal(states("2026-10-28T21:59:00", wk.overrides).gym, "off");
  assert.equal(states("2026-10-28T22:00:00", wk.overrides).gym, "off");
  assert.equal(lightStates(config, wk.overrides, at("2026-10-28T22:00:00"))[0].mode, "auto");
});

test("morning text speaks the weather in words", () => {
  const weather = {
    tempC: -7.4,
    feelsLikeC: -11,
    windSpeedMs: 3.6,
    windFrom: "баруун хойд",
    condition: "Цэлмэг",
    precip: { status: "clear" },
    hourly: [{ label: "14:00", precipProb: 20 }, { label: "16:00", precipProb: 55 }],
  };
  const text = fillTemplate(defaultConfig().morning.text, speechContext(weather, at("2026-10-28T06:00:00")));
  assert.equal(
    text,
    "Өглөөний мэнд! Өнөөдөр гадаа хасах 7 градус, салхи баруун хойд зүгээс секундэд 4 метр хурдтай байна. 16:00 цагийн орчимд цас орох магадлал 55 хувь байна. Өнөөдрийн ажилд тань амжилт хүсье!",
  );
  assert.equal(fillTemplate("{zone} {minutes} {unknown}", { zone: "Заал", minutes: 5 }), "Заал 5 {unknown}");
});

test("config validation keeps the two zones and rejects bad input", () => {
  const current = defaultConfig();
  const next = cleanConfig({ ...current, custom: [{ time: "12:00", text: "Үдийн цай", enabled: true }] }, current);
  assert.equal(next.error, undefined);
  assert.equal(next.config.zones.length, 2);
  assert.equal(next.config.custom[0].text, "Үдийн цай");
  assert.match(cleanConfig({ ...current, morning: { ...current.morning, time: "25:00" } }, current).error, /ЦЦ:ММ/);
  assert.match(cleanConfig({ ...current, morning: { ...current.morning, text: "<script>" } }, current).error, /< >/);
  const zones = [{ ...current.zones[0], webhookOff: "file:///etc/passwd" }, current.zones[1]];
  assert.match(cleanConfig({ ...current, zones }, current).error, /http/);
});

test("stored config gains new defaults without losing edits", () => {
  const db = { whiteking: { config: { morning: { time: "06:30" }, zones: [{ id: "gym", off: "21:30" }] } } };
  ensureWhiteKing(db);
  assert.equal(db.whiteking.config.morning.time, "06:30");
  assert.ok(db.whiteking.config.morning.text.startsWith("Өглөөний мэнд"));
  assert.equal(db.whiteking.config.zones[0].off, "21:30");
  assert.equal(db.whiteking.config.zones[0].on, "18:00");
  assert.equal(db.whiteking.config.zones[1].id, "dorm");
});
