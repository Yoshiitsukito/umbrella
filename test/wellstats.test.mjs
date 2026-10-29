import test from "node:test";
import assert from "node:assert/strict";
import {
  bpStats,
  breakIndex,
  briefingText,
  departureAdvice,
  moodLinks,
  parseHeartRate,
  pulseZone,
  shiftAdvice,
  sleepDebt,
  trendSeries,
  watchAdvice,
  workload,
} from "../public/js/wellstats.js";

const at = (iso) => Date.parse(`${iso}+08:00`);
const DAY_WEEK = ["off", "day", "day", "day", "day", "day", "off"];
const NIGHT_WEEK = ["off", "night", "night", "night", "night", "day", "off"];

test("evening before a day shift says when to sleep and wake", () => {
  const tips = shiftAdvice({ week: DAY_WEEK, leaves: [], uid: "u", today: "2026-10-27", now: at("2026-10-27T19:00:00") });
  assert.equal(tips[0].title, "Маргааш 06:00-д өдрийн ээлж");
  assert.match(tips[0].text, /^21:00-аас өмнө унтаж, 04:30-д бос/);
});

test("morning after a night shift recommends a daytime sleep window", () => {
  const tips = shiftAdvice({ week: NIGHT_WEEK, leaves: [], uid: "u", today: "2026-10-28", now: at("2026-10-28T06:20:00") });
  const sleep = tips.find((tip) => tip.title === "Шөнийн ээлжийн дараа унт");
  assert.match(sleep.text, /^06:30–13:30/);
  assert.ok(tips.some((tip) => tip.title === "Өнөөдөр 18:00-д шөнийн ээлж"));
});

test("a night shift in progress and a day off get their own advice", () => {
  assert.equal(shiftAdvice({ week: NIGHT_WEEK, leaves: [], uid: "u", today: "2026-10-27", now: at("2026-10-28T00:00:00") })[0].title, "Шөнийн ээлж явж байна");
  const weekend = shiftAdvice({ week: DAY_WEEK, leaves: [], uid: "u", today: "2026-10-31", now: at("2026-10-31T10:00:00") });
  assert.equal(weekend[0].title, "Амралтын өдөр");
});

test("workload flags more than 14 days without rest, days off worked and three nights in a row", () => {
  const now = at("2026-10-29T08:00:00");
  const day = (back) => new Date(now + 8 * 3600000 - back * 86400000).toISOString().slice(0, 10);
  const session = (back) => ({ start: now - back * 86400000, end: now - back * 86400000 + 11 * 3600000, date: day(back) });
  const sessions = Array.from({ length: 16 }, (_, index) => session(index + 1));
  const load = workload({ sessions, week: NIGHT_WEEK, leaves: [], uid: "u", today: "2026-10-29", now });
  assert.equal(load.workStreak, 16);
  assert.equal(load.nightStreak, 4);
  assert.equal(load.warnings.length, 2);
  assert.match(load.warnings[0].text, /^16 өдөр амралтгүй ажилласан/);
  assert.match(load.warnings[1].text, /4 шөнө дараалсан ээлж \(10\.26–10\.29\)/);
  const sunday = workload({ sessions: [session(4)], week: DAY_WEEK, leaves: [], uid: "u", today: "2026-10-29", now });
  assert.equal(sunday.extraDays, 1);
  assert.match(sunday.warnings[0].text, /амралтын 1 өдөр ажилласан/);
  assert.equal(workload({ sessions: [], week: DAY_WEEK, leaves: [], uid: "u", today: "2026-10-29", now }).warnings.length, 0);
});

test("sleep debt counts recorded nights and points at the next day off", () => {
  const days = {
    "2026-10-26": { sleep: { min: 360 } },
    "2026-10-27": { sleep: { min: 390 } },
    "2026-10-28": { sleep: { min: 420 } },
  };
  const debt = sleepDebt({ days, today: "2026-10-28", week: DAY_WEEK, leaves: [], uid: "u" });
  assert.equal(debt.nights, 3);
  assert.equal(debt.debtMin, 180);
  assert.equal(debt.offDay, "2026-10-31");
  assert.match(debt.advice, /^Бя гарагт \(10\.31\) 1 цаг илүү унтаж/);
});

test("blood pressure averages the last week and alerts after three high readings", () => {
  const now = at("2026-10-28T10:00:00");
  const vitals = [
    { at: "2026-10-10T01:00:00Z", sys: 120, dia: 80 },
    { at: "2026-10-26T01:00:00Z", sys: 145, dia: 85 },
    { at: "2026-10-27T01:00:00Z", sys: 138, dia: 92 },
    { at: "2026-10-28T01:00:00Z", sys: 150, dia: 95 },
    { at: "2026-10-28T02:00:00Z", hr: 70 },
  ];
  const stats = bpStats(vitals, now);
  assert.deepEqual(stats.avg7, { sys: 144, dia: 91, n: 3 });
  assert.equal(stats.alert, true);
  assert.equal(bpStats(vitals.slice(0, 2), now).alert, false);
});

test("trend series and mood links read per-day records", () => {
  const days = {
    "2026-10-26": { steps: 1800, sleep: { min: 330 }, mood: 2 },
    "2026-10-27": { steps: 9400, sleep: { min: 480 }, mood: 5 },
    "2026-10-31": { mood: 4 },
  };
  const steps = trendSeries("steps", { days, vitals: [], from: "2026-10-26", to: "2026-10-28" });
  assert.deepEqual(steps.map((item) => item.value), [1800, 9400, null]);
  assert.deepEqual(trendSeries("sleep", { days, vitals: [], from: "2026-10-26", to: "2026-10-26" })[0].value, 5.5);
  const bp = trendSeries("bp", { days, vitals: [{ at: "2026-10-27T01:00:00Z", sys: 130, dia: 85 }], from: "2026-10-27", to: "2026-10-27" });
  assert.deepEqual([bp[0].value, bp[0].low], [130, 85]);
  const links = moodLinks({ days, week: DAY_WEEK, leaves: [], uid: "u", from: "2026-10-26", to: "2026-11-01" });
  assert.deepEqual(links.shifts.map((row) => row.avg), [3.5, null, 4]);
  assert.deepEqual(links.sleep.map((row) => row.avg), [2, null, 5]);
});

test("break reminders follow the clock", () => {
  assert.equal(breakIndex(at("2026-10-28T08:00:00"), at("2026-10-28T12:30:00")), 2);
});

test("watch advice puts fatigue and high blood pressure first", () => {
  const now = at("2026-10-28T10:00:00");
  const days = {
    "2026-10-23": { steps: 3000, active: 10 },
    "2026-10-24": { steps: 3500 },
    "2026-10-27": { steps: 4000 },
    "2026-10-28": { sleep: { min: 300 } },
  };
  const vitals = [
    { at: "2026-10-10T01:00:00Z", hr: 62 },
    { at: "2026-10-14T01:00:00Z", hr: 64 },
    { at: "2026-10-27T01:00:00Z", hr: 72 },
    { at: "2026-10-28T01:00:00Z", sys: 146, dia: 92, hr: 74 },
  ];
  const { tips, stats } = watchAdvice({ days, vitals, today: "2026-10-28", now, week: NIGHT_WEEK, leaves: [], uid: "u" });
  assert.equal(tips[0].title, "Ядаргааны шинж");
  assert.equal(tips[0].level, "danger");
  assert.ok(tips.some((tip) => tip.title === "Даралт 146/92"));
  assert.ok(tips.some((tip) => tip.title === "Дунджаар 3500 алхам"));
  assert.ok(tips.length <= 5);
  assert.deepEqual([stats.hrAvg, stats.hrBefore, stats.stepsAvg, stats.activeWeek], [73, 63, 3500, 10]);
});

test("watch advice with no data asks for sleep and blood pressure", () => {
  const { tips } = watchAdvice({ days: {}, vitals: [], today: "2026-10-28", now: at("2026-10-28T10:00:00"), week: DAY_WEEK, leaves: [], uid: "u" });
  assert.deepEqual(tips.map((tip) => tip.title), ["Нойрны мэдээлэл алга", "Даралтаа хэмжих цаг боллоо"]);
});

test("live Bluetooth heart rate is parsed and zoned", () => {
  assert.equal(parseHeartRate(new DataView(Uint8Array.of(0, 72).buffer)), 72);
  assert.equal(parseHeartRate(new DataView(Uint8Array.of(1, 0x2c, 0x01).buffer)), 300);
  assert.equal(pulseZone(64).label, "Тайван");
  assert.equal(pulseZone(135).key, "work");
});

test("departure advice reads the forecast at shift end", () => {
  const hourly = [{ time: "2026-10-28T18:00", tempC: -14.4, windSpeedMs: 9.2, precipProb: 10, code: 3 }];
  const advice = departureAdvice(hourly, at("2026-10-28T18:00:00"));
  assert.equal(advice.text, "18:00-д -14°, салхи 9 м/с. Хүйтэн: давхар хувцаслаж, малгай, бээлийтэй гар, салхи хүчтэй.");
  assert.equal(departureAdvice(hourly, at("2026-10-29T06:00:00")), null);
});

test("the spoken briefing covers shift, reminders and news", () => {
  const text = briefingText({
    name: "Бат",
    now: at("2026-10-28T05:10:00"),
    shift: { kind: "day", start: at("2026-10-28T06:00:00"), end: at("2026-10-28T18:00:00") },
    weather: { tempC: -8.2, feelsLikeC: -14, condition: "Үүлэрхэг" },
    reminders: [{ title: "Тайлан", due: "16:00", done: false }],
    announcements: [{ text: "10:00-д хурал", read: false }],
    birthdays: [{ name: "Сараа", inDays: 0 }],
  });
  assert.match(text, /^Өглөөний мэнд, Бат\. Өнөөдөр өдрийн ээлж, 06:00-аас 18:00 хүртэл\./);
  assert.match(text, /16:00-д Тайлан/);
  assert.match(text, /Шинэ зарлал: 10:00-д хурал/);
  assert.match(text, /Сараа/);
  assert.doesNotMatch(text, /усны|уусан/);
});
