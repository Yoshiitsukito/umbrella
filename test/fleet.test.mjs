import test from "node:test";
import assert from "node:assert/strict";
import { newUser } from "../lib/auth.mjs";
import { ensureMine, masterView } from "../lib/mine.mjs";
import { seedMine } from "../lib/mineseed.mjs";
import { FLEET_ROLES, fleetView, fleetWorkorder, seedFleet, setDispatch } from "../lib/fleet.mjs";
import { SITE, SPEED, breakAt, fleetState, haulTotals, hourlyHaul, planFleet, shiftDayStart, truckCapacity } from "../public/js/fleetcore.js";

const NOW = Date.parse("2026-11-01T10:00:00+08:00");
const H = 3600 * 1000;

const FLEET = [
  ["EX-01", "excavator", "Komatsu PC2000"],
  ["EX-02", "excavator", "Hitachi EX1200", "service"],
  ["EX-03", "excavator", "Liebherr R9800"],
  ["LD-01", "loader", "CAT 992K"],
  ["TR-01", "truck", "CAT 777E"],
  ["TR-02", "truck", "CAT 777E"],
  ["TR-03", "truck", "Komatsu HD785", "down"],
  ["TR-04", "truck", "Komatsu HD785"],
  ["TR-05", "truck", "BELAZ 7555"],
  ["TR-06", "truck", "CAT 793F"],
  ["TR-07", "truck", "CAT 793F"],
  ["TR-08", "truck", "Komatsu 830E"],
  ["DZ-01", "dozer", "CAT D10T"],
  ["LV-01", "lv", "Toyota Land Cruiser"],
].map(([code, type, model, status], index) => ({ id: `eq${index}`, code, type, model, status: status || "ready" }));

const byCode = (state, code) => state.machines.find((item) => item.code === code);

function seededRandom(seed = 11) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

function seededDb() {
  const users = [];
  users.push(newUser({ id: "usr_admin", username: "admin", password: "x", role: "admin", existing: users }));
  users.push(newUser({ id: "usr_a", username: "bold", password: "x", role: "user", displayName: "Болд", existing: users }));
  users.push(newUser({ id: "usr_master", username: "master", password: "x", role: "master", displayName: "Мастер", existing: users }));
  users.push(newUser({ id: "usr_eng", username: "eng", password: "x", role: "engineer", displayName: "Инженер", existing: users }));
  const db = { users, shiftPlans: {}, leaves: [], attendance: { events: [], usedJti: [], people: { usr_a: { state: "in" } } }, weather: null };
  ensureMine(db);
  seedMine(db, { now: NOW, random: seededRandom() });
  return db;
}

test("telemetry is the same on every screen and stays on the site", () => {
  const first = fleetState(FLEET, NOW + 123_456);
  const again = fleetState(FLEET, NOW + 123_456);
  assert.deepEqual(first.machines, again.machines);
  const [x0, y0, w, h] = SITE.view;
  for (const unit of first.machines) {
    assert.ok(unit.x >= x0 && unit.x <= x0 + w && unit.y >= y0 && unit.y <= y0 + h, `${unit.code} off the map`);
    assert.ok(unit.kmh >= 0 && unit.kmh <= SPEED.fast * 1.05, `${unit.code} speed ${unit.kmh}`);
    assert.ok(Math.abs(unit.lat - SITE.lat) < 0.02 && Math.abs(unit.lng - SITE.lng) < 0.03);
    if (unit.type === "truck" && unit.cap) assert.ok(unit.payload >= 0 && unit.payload <= unit.cap);
  }
  const broken = byCode(first, "TR-03");
  assert.equal(broken.phase, "down");
  assert.equal(broken.zone, "base");
  assert.equal(broken.moving, false);
  assert.equal(byCode(first, "EX-02").phase, "service");
});

test("trucks move between samples and stop for the shift change", () => {
  const later = fleetState(FLEET, NOW + 30_000);
  const now = fleetState(FLEET, NOW);
  const moved = now.machines.filter((unit) => unit.type === "truck" && unit.status === "ready").some((unit) => {
    const next = later.machines.find((item) => item.id === unit.id);
    return Math.hypot(next.x - unit.x, next.y - unit.y) > 1;
  });
  assert.ok(moved);
  const change = Date.parse("2026-11-01T06:05:00+08:00");
  assert.equal(breakAt(change).label, "Ээлж солилт");
  const paused = fleetState(FLEET, change);
  assert.ok(paused.pause);
  assert.ok(paused.machines.every((unit) => !unit.moving));
  assert.deepEqual(
    fleetState(FLEET, change).machines.map((unit) => [unit.x, unit.y]),
    fleetState(FLEET, change + 10 * 60 * 1000).machines.map((unit) => [unit.x, unit.y]),
  );
});

test("dispatch sends a truck to the chosen digger unless that digger is down", () => {
  const auto = planFleet(FLEET);
  assert.ok(!auto.haul.has("eq6"), "a broken truck gets no work");
  assert.equal(auto.haul.get("eq9").digger.machine.code, "EX-03", "big trucks go to overburden");
  const sent = planFleet(FLEET, { eq9: "eq0" });
  assert.equal(sent.haul.get("eq9").digger.machine.code, "EX-01");
  const ignored = planFleet(FLEET, { eq9: "eq1" });
  assert.notEqual(ignored.haul.get("eq9").digger.machine.code, "EX-02");
});

test("hauled tonnes add up and sit near the coal plan", () => {
  const start = shiftDayStart(NOW);
  const day = haulTotals(FLEET, start, start + 24 * H);
  assert.ok(day.coal > 9000 && day.coal < 18000, `coal ${day.coal}`);
  assert.ok(day.waste > day.coal);
  const half = haulTotals(FLEET, start, start + 12 * H);
  const rest = haulTotals(FLEET, start + 12 * H, start + 24 * H);
  assert.equal(half.loads + rest.loads, day.loads);
  assert.equal(half.coal + rest.coal, day.coal);
  const hours = hourlyHaul(FLEET, NOW, { hours: 6 });
  assert.equal(hours.length, 6);
  assert.ok(hours.every((row) => row.coal + row.waste >= 0));
  assert.equal(truckCapacity("CAT 797F"), 363);
  assert.equal(truckCapacity("Komatsu HD785"), 91);
  assert.equal(truckCapacity("BELAZ 7555"), 55);
});

test("the control centre view, dispatch and repair orders", () => {
  assert.deepEqual(FLEET_ROLES, ["engineer", "master"]);
  const db = seededDb();
  const before = db.ops.equipment.length;
  assert.equal(seedFleet(db, NOW).added, 5);
  assert.equal(db.ops.equipment.length, before + 5);
  assert.equal(seedFleet(db, NOW), null);
  const view = fleetView(db, NOW);
  assert.equal(view.equipment.length, db.ops.equipment.length);
  assert.ok(view.equipment.every((item) => item.service && Array.isArray(item.orders)));
  assert.equal(view.personnel.onSite, 1);
  const truck = db.ops.equipment.find((item) => item.code === "TR-06");
  const shovel = db.ops.equipment.find((item) => item.code === "EX-01");
  const down = db.ops.equipment.find((item) => item.code === "EX-02");
  assert.equal(setDispatch(db, "nope", shovel.id).status, 404);
  assert.match(setDispatch(db, truck.id, down.id).error, /засварт/);
  assert.deepEqual(setDispatch(db, truck.id, shovel.id), { ok: true });
  assert.equal(fleetView(db, NOW).dispatch[truck.id], shovel.id);
  assert.equal(planFleet(db.ops.equipment, db.ops.dispatch).haul.get(truck.id).digger.machine.id, shovel.id);
  setDispatch(db, truck.id, null);
  assert.equal(fleetView(db, NOW).dispatch[truck.id], undefined);
  assert.ok(fleetWorkorder(db, { equipment: truck.id, title: "" }, "usr_eng", NOW).error);
  const order = fleetWorkorder(db, { equipment: truck.id, kind: "breakdown", title: "Тоормос", priority: "high" }, "usr_eng", NOW);
  assert.ok(order.item?.id);
  assert.equal(db.ops.equipment.find((item) => item.id === truck.id).status, "down");
  assert.equal(masterView(db, NOW).ops.equipment.find((item) => item.id === truck.id).status, "down");
  assert.equal(fleetView(db, NOW).equipment.find((item) => item.id === truck.id).orders[0].title, "Тоормос");
  assert.equal(byCode(fleetState(db.ops.equipment, NOW), "TR-06").phase, "down");
});
