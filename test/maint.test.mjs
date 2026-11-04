import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, newUser } from "../lib/auth.mjs";
import { createRecord, ensureMine, sweepService, updateRecord } from "../lib/mine.mjs";
import { seedMine } from "../lib/mineseed.mjs";
import { MAINT_ROLE, maintSummary, maintView, seedMaint } from "../lib/maint.mjs";
import { workforceOf } from "../lib/workforce.mjs";
import { fleetView } from "../lib/fleet.mjs";
import { coalByType, localInput, serviceDue } from "../public/js/minecore.js";

const NOW = Date.parse("2026-11-04T10:00:00+08:00");
const H = 3600 * 1000;
const at = (ms) => localInput(ms);

function baseDb() {
  const users = [];
  const add = (id, role, displayName) => users.push(newUser({ id, username: id.slice(4, 8), password: "x", role, displayName, existing: users }));
  add("usr_mast", "master", "Мастер");
  add("usr_main", MAINT_ROLE, "Засварын мастер");
  add("usr_mech", "user", "Механик");
  add("usr_oper", "user", "Оператор");
  add("usr_cook", "kitchen", "Тогооч");
  const db = { users, shiftPlans: {}, leaves: [], attendance: { events: [], usedJti: [], people: {} }, weather: null };
  ensureMine(db);
  return db;
}

function machine(db, body) {
  const result = createRecord(db, "equipment", { type: "truck", serviceEvery: 250, status: "ready", ...body }, { by: "usr_main", now: NOW });
  assert.ok(!result.error, result.error);
  return result.item;
}

const patch = (db, name, id, change, now = NOW) => updateRecord(db, name, id, { ...db[name === "meters" ? "maint" : "ops"][name].find((item) => item.id === id), ...change }, { by: "usr_main", now });
const reading = (db, equipment, ms, hours) => createRecord(db, "meters", { equipment, at: at(ms), hours }, { by: "usr_main", now: NOW });
const planned = (db, id) => db.ops.workorders.filter((order) => order.equipment === id && order.kind === "planned" && order.status !== "done");

test("the maintenance master is a role of its own", () => {
  assert.ok(ROLES.includes(MAINT_ROLE));
});

test("hour-meter readings only move forward and at a pace a machine can run", () => {
  const db = baseDb();
  const truck = machine(db, { code: "TR-01", hours: 1000, lastService: 900 });
  assert.ok(!reading(db, truck.id, NOW - 48 * H, 1000).error);
  assert.match(reading(db, truck.id, NOW - 24 * H, 990).error, /өмнөх 1000/);
  assert.match(reading(db, truck.id, NOW - 24 * H, 1030).error, /24 цагийн дотор 30 мото цаг/);
  assert.ok(!reading(db, truck.id, NOW - 24 * H, 1020).error);
  assert.equal(db.ops.equipment.find((item) => item.id === truck.id).hours, 1020);
  assert.match(reading(db, truck.id, NOW + 2 * H, 1025).error, /ирээдүйд/);
  assert.match(reading(db, truck.id, NOW - 36 * H, 1021).error, /дараагийн 1020/);
  assert.ok(!reading(db, truck.id, NOW - 36 * H, 1008).error, "a back-dated reading between two others fits");
  assert.equal(db.ops.equipment.find((item) => item.id === truck.id).hours, 1020, "an older reading leaves the meter alone");
  const old = machine(db, { code: "TR-09", hours: 5000, status: "retired" });
  assert.match(reading(db, old.id, NOW - H, 5001).error, /актлагдсан/);
});

test("reaching the interval opens planned service and takes the machine off work until it is done", () => {
  const db = baseDb();
  const truck = machine(db, { code: "TR-02", hours: 1020, lastService: 780 });
  const digger = machine(db, { code: "EX-01", type: "excavator", hours: 3000, lastService: 2900 });
  db.ops.dispatch = { [truck.id]: digger.id };
  assert.ok(!reading(db, truck.id, NOW - 24 * H, 1020).error);
  assert.equal(planned(db, truck.id).length, 0);
  assert.ok(!reading(db, truck.id, NOW - H, 1032).error);
  const live = db.ops.equipment.find((item) => item.id === truck.id);
  const [order] = planned(db, truck.id);
  assert.ok(order, "planned order opened automatically");
  assert.equal(order.by, "system");
  assert.match(order.title, /250 мото цагийн/);
  assert.equal(live.status, "service");
  assert.equal(db.ops.dispatch[truck.id], undefined, "taken off dispatch");
  assert.ok(!reading(db, truck.id, NOW, 1033).error);
  assert.equal(planned(db, truck.id).length, 1, "no second order while one is open");
  const done = patch(db, "workorders", order.id, { status: "done" }, NOW + H);
  assert.ok(!done.error, done.error);
  assert.equal(live.lastService, 1033);
  assert.equal(live.status, "ready");
  assert.equal(serviceDue(live).due, false);
});

test("fuel logs, equipment edits and new machines also trigger planned service", () => {
  const db = baseDb();
  const a = machine(db, { code: "TR-03", hours: 1200, lastService: 960 });
  createRecord(db, "fuel", { equipment: a.id, at: at(NOW - H), liters: 900, hours: 1215 }, { by: "usr_mast", now: NOW });
  assert.equal(planned(db, a.id).length, 1);
  const b = machine(db, { code: "TR-04", hours: 500, lastService: 400 });
  assert.ok(!patch(db, "equipment", b.id, { lastService: 200 }).error);
  assert.equal(planned(db, b.id).length, 1);
  assert.equal(db.ops.equipment.find((item) => item.id === b.id).status, "service");
  const c = machine(db, { code: "TR-05", hours: 2000, lastService: 1600 });
  assert.equal(planned(db, c.id).length, 1, "a new machine already past its interval goes straight to service");
  assert.equal(sweepService(db, NOW), 0);
});

test("the board separates breakdowns, planned service and machines nearing service", () => {
  const db = baseDb();
  const broken = machine(db, { code: "TR-06", hours: 800, lastService: 700 });
  const servicing = machine(db, { code: "TR-07", hours: 900, lastService: 640 });
  const soon = machine(db, { code: "TR-08", hours: 900, lastService: 680 });
  machine(db, { code: "TR-10", hours: 900, lastService: 880 });
  createRecord(db, "workorders", { equipment: broken.id, kind: "breakdown", title: "Тоормос", priority: "high", status: "open", mechanic: "usr_mech" }, { by: "usr_main", now: NOW - 5 * H });
  const sum = maintSummary(db, NOW);
  assert.deepEqual(sum.unplanned.map((item) => item.code), ["TR-06"]);
  assert.equal(sum.unplanned[0].order.hours, 5);
  assert.equal(sum.unplanned[0].order.mechanic, "Механик");
  assert.deepEqual(sum.planned.map((item) => item.code), ["TR-07"]);
  assert.equal(sum.planned[0].order.auto, true);
  assert.deepEqual(sum.soon.map((item) => item.code), ["TR-08"]);
  assert.equal(sum.counts.down, 1);
  assert.equal(sum.counts.service, 1);
  assert.equal(sum.counts.ready, 2);
  assert.equal(sum.month.breakdowns, 1);
  assert.equal(sum.month.downHours, 5);
  assert.ok(servicing.id && soon.id);
  const view = maintView(db, NOW);
  assert.ok(view.maint.meters && view.ops.workorders && view.maintSum);
  assert.equal(view.users.some((user) => user.id === "usr_mech"), true);
  assert.equal(JSON.stringify(view).includes("passwordHash"), false);
});

test("shift reports split coal by type and the total follows the split", () => {
  const db = baseDb();
  const base = { date: "2026-11-04", shift: "day", work: "Олборлолт" };
  const split = createRecord(db, "handovers", { ...base, coking: 1200, thermal: 1800, oxidized: 300, tonnes: 9999 }, { by: "usr_mast", now: NOW });
  assert.equal(split.item.tonnes, 3300);
  createRecord(db, "handovers", { ...base, shift: "night", tonnes: 1000 }, { by: "usr_mast", now: NOW });
  createRecord(db, "handovers", { ...base, date: "2026-10-20", coking: 500 }, { by: "usr_mast", now: NOW });
  const today = coalByType(db.ops.handovers, "2026-11-04", "2026-11-04");
  assert.deepEqual(today, { coking: 1200, thermal: 1800, oxidized: 300, unclassified: 1000, total: 4300 });
  assert.equal(coalByType(db.ops.handovers, "2026-10-01", "2026-11-04").coking, 1700);
});

test("the workforce summary counts shifts, leave, departments and the coming week", () => {
  const db = baseDb();
  const days = (kind) => Array(7).fill(kind);
  db.shiftPlans = { usr_mech: days("day"), usr_oper: days("night"), usr_cook: days("off") };
  db.leaves = [{ id: "lv1", uid: "usr_oper", type: "sick", from: "2026-11-04", to: "2026-11-05", status: "approved" }];
  db.attendance.people = { usr_mech: { state: "in" } };
  const dept = createRecord(db, "depts", { name: "Засвар" }, { by: "usr_mast", now: NOW }).item;
  createRecord(db, "posts", { uid: "usr_mech", position: "mechanic", dept: dept.id }, { by: "usr_mast", now: NOW });
  const work = workforceOf(db, NOW);
  assert.equal(work.total, 3, "only shift staff count");
  assert.equal(work.onSite, 1);
  assert.deepEqual(work.today, { day: 1, night: 0, off: 1, leave: 1 });
  assert.equal(work.leave.sick, 1);
  assert.deepEqual(work.departments.find((item) => item.name === "Засвар"), { name: "Засвар", total: 1, onSite: 1 });
  assert.equal(work.departments.find((item) => item.name === "Хэлтэсгүй").total, 2);
  assert.equal(work.positions.find((item) => item.name === "Механик").total, 1);
  assert.equal(work.forecast.length, 7);
  assert.equal(work.forecast[2].night, 1, "back on nights after the sick leave");
});

function seededRandom(seed = 7) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

test("the demo seeds a month of readings, splits coal, and the sweep plans due service once", () => {
  const db = baseDb();
  seedMine(db, { now: NOW, random: seededRandom() });
  const hoursBefore = new Map(db.ops.equipment.map((item) => [item.id, item.hours]));
  const result = seedMaint(db, NOW);
  assert.ok(result.readings > 100);
  assert.ok(result.split > 0);
  assert.ok(result.services > 0);
  assert.equal(maintSummary(db, NOW).month.planned, result.services);
  assert.equal(seedMaint(db, NOW), null);
  for (const item of db.ops.equipment.filter((row) => row.status !== "retired")) {
    const list = db.maint.meters.filter((row) => row.equipment === item.id).sort((a, b) => a.at.localeCompare(b.at));
    if (!list.length) continue;
    assert.equal(item.hours, hoursBefore.get(item.id), `${item.code} meter unchanged`);
    assert.equal(list.at(-1).hours, item.hours);
    for (let index = 1; index < list.length; index += 1) assert.ok(list[index].hours >= list[index - 1].hours);
  }
  for (const report of db.ops.handovers.filter((row) => row.tonnes > 0)) {
    assert.ok(report.coking + report.thermal + report.oxidized <= report.tonnes + 1);
    assert.ok(report.coking > 0 && report.thermal > 0);
  }
  sweepService(db, NOW);
  for (const item of db.ops.equipment.filter((row) => row.status !== "retired" && serviceDue(row).due)) assert.equal(planned(db, item.id).length, 1, `${item.code} planned`);
  assert.equal(sweepService(db, NOW), 0);
  const view = fleetView(db, NOW);
  assert.ok(view.maintenance && view.workforce && view.coal.month.total > 0);
  assert.equal(view.personnel.total, view.workforce.total);
});
