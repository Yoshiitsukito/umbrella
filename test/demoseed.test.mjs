import test from "node:test";
import assert from "node:assert/strict";
import { newUser } from "../lib/auth.mjs";
import { DEMO_VERSION, MENU_DAYS, seedDemo } from "../lib/demoseed.mjs";
import { addDays, isRotation, periodSummary, plannedKind, sessionsOf, shiftDateOf } from "../public/js/workstats.js";

const NOW = Date.parse("2026-10-29T12:00:00+08:00");

function seededRandom(seed = 7) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

function baseDb() {
  const users = [];
  users.push(newUser({ id: "usr_admin", username: "admin", password: "x", role: "admin", existing: users }));
  users.push(newUser({ id: "usr_saran", username: "saran", password: "x", role: "user", existing: users }));
  users.push(newUser({ id: "usr_hr", username: "hr", password: "x", role: "hr", existing: users }));
  users.push(newUser({ id: "usr_cook", username: "cook", password: "x", role: "kitchen", existing: users }));
  const realIn = "2026-10-28T16:00:06.125Z";
  return {
    users,
    location: { lat: 47.9, lng: 106.9 },
    attendance: { events: [{ at: realIn, date: "2026-10-28", shift: "night", state: "in", uid: "usr_saran", lat: 47.9, lng: 106.9 }], usedJti: [], people: { usr_saran: { state: "in", since: realIn } }, historyFrom: "2026-10-28", resetAt: "2026-10-28T14:16:51.730Z" },
    shiftPlans: { usr_hr: { type: "rotation", pattern: "dd", start: "2026-10-29", before: ["off", "day", "day", "day", "day", "day", "off"] } },
    leaves: [],
    menu: { days: {} },
  };
}

test("demo seed adds five staff per card level with unique codes and cards", () => {
  const db = baseDb();
  const result = seedDemo(db, { now: NOW, random: seededRandom() });
  assert.equal(result.users, 25);
  const demo = db.users.filter((user) => db.demoSeed.users.includes(user.id));
  for (let level = 1; level <= 5; level += 1) assert.equal(demo.filter((user) => user.card.clearance === level).length, 5);
  assert.ok(demo.every((user) => user.role === "user" && user.cardKey && user.pass.startsWith("scrypt$")));
  assert.equal(new Set(db.users.map((user) => user.loginCode)).size, db.users.length);
  assert.equal(new Set(db.users.map((user) => user.card.idNumber)).size, db.users.length);
  assert.equal(new Set(db.users.map((user) => user.username)).size, db.users.length);
});

test("demo seed gives every staff member a plan and 14 days of attendance", () => {
  const db = baseDb();
  seedDemo(db, { now: NOW, random: seededRandom(3) });
  const today = shiftDateOf(NOW);
  const from = addDays(today, -14);
  assert.equal(db.attendance.historyFrom, from);
  assert.ok(db.attendance.resetAt < new Date(Date.parse(`${from}T06:00:00+08:00`)).toISOString());
  const staff = db.users.filter((user) => ["user", "hr", "kitchen"].includes(user.role));
  for (const user of staff) {
    const plan = db.shiftPlans[user.id];
    assert.ok(isRotation(plan), user.username);
    if (user.role === "hr") assert.equal(plannedKind(plan, addDays(from, 1)) === "night", false);
    const sessions = sessionsOf(db.attendance.events, user.id, NOW);
    const sum = periodSummary({ sessions, week: plan, leaves: [], uid: user.id, from, to: today, now: NOW, since: db.attendance.historyFrom, sinceAt: Date.parse(db.attendance.resetAt) });
    if (user.id !== "usr_saran") assert.ok(sum.workedDays >= 1, `${user.username} worked ${sum.workedDays}`);
  }
  assert.ok(db.attendance.events.every((event) => Date.parse(event.at) < NOW));
  const sorted = [...db.attendance.events].sort((a, b) => a.at.localeCompare(b.at));
  assert.deepEqual(db.attendance.events, sorted);
});

test("demo seed keeps real records and future plans", () => {
  const db = baseDb();
  seedDemo(db, { now: NOW, random: seededRandom(11) });
  const saran = db.attendance.events.filter((event) => event.uid === "usr_saran");
  assert.equal(saran.at(-1).at, "2026-10-28T16:00:06.125Z");
  assert.ok(saran.slice(0, -1).every((event) => event.at < "2026-10-28T16:00:06.125Z"));
  assert.deepEqual(db.attendance.people.usr_saran, { state: "in", since: "2026-10-28T16:00:06.125Z" });
  const hr = db.shiftPlans.usr_hr;
  assert.equal(hr.start, "2026-10-29");
  assert.equal(hr.pattern, "dd");
  assert.ok(isRotation(hr.before));
  assert.equal(hr.before.pattern, "dd");
});

test("demo seed fills a week of menu and runs only once", () => {
  const db = baseDb();
  const today = shiftDateOf(NOW);
  db.menu.days[addDays(today, 2)] = [{ id: "mn_real", meal: "lunch", category: "main", name: "Бууз", portion: 300, unit: "г", kcal: 590, by: "usr_cook", at: "2026-10-29T01:00:00Z" }];
  const first = seedDemo(db, { now: NOW, random: seededRandom(5) });
  assert.equal(Object.keys(db.menu.days).length, MENU_DAYS);
  assert.equal(db.menu.days[addDays(today, 2)].length, 1);
  assert.ok(db.menu.days[today].every((item) => item.kcal > 0 || item.name === "Ус"));
  assert.ok(["breakfast", "lunch", "dinner", "night"].every((meal) => db.menu.days[today].some((item) => item.meal === meal)));
  assert.ok(db.menu.days[today].every((item) => item.by === "usr_cook"));
  assert.ok(first.dishes > 0);
  assert.equal(db.demoSeed.version, DEMO_VERSION);
  const count = db.users.length;
  assert.equal(seedDemo(db, { now: NOW + 3600 * 1000 }), null);
  assert.equal(db.users.length, count);
});
