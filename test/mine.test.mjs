import test from "node:test";
import assert from "node:assert/strict";
import { CARD_QR_PREFIX, newUser } from "../lib/auth.mjs";
import { personalKey } from "../lib/personal.mjs";
import { ensureWhiteKing } from "../lib/whiteking.mjs";
import {
  checkMuster,
  createRecord,
  ensureMine,
  masterView,
  mineHold,
  mineTick,
  okLone,
  raiseSos,
  setWxSim,
  startLone,
  startMuster,
  updateRecord,
  workerMine,
} from "../lib/mine.mjs";
import { seedMine } from "../lib/mineseed.mjs";
import { allocateBeds, cleanRecord, crewChange, fatigueOf, holdReasons, mineKpis, payrollRows, permitState, riskLevel } from "../public/js/minecore.js";
import { addDays, plannedKind } from "../public/js/workstats.js";

const NOW = Date.parse("2026-11-01T10:00:00+08:00");
const TODAY = "2026-11-01";
const H = 3600 * 1000;

function seededRandom(seed = 11) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

function baseDb() {
  const users = [];
  users.push(newUser({ id: "usr_admin", username: "admin", password: "x", role: "admin", existing: users }));
  users.push(newUser({ id: "usr_a", username: "bold", password: "x", role: "user", displayName: "Болд", existing: users }));
  users.push(newUser({ id: "usr_b", username: "saraa", password: "x", role: "user", displayName: "Сараа", existing: users }));
  users.push(newUser({ id: "usr_hr", username: "hr", password: "x", role: "hr", existing: users }));
  users.push(newUser({ id: "usr_master", username: "master", password: "x", role: "master", displayName: "Уурхайн мастер", existing: users }));
  const db = {
    users,
    shiftPlans: {},
    leaves: [],
    attendance: { events: [], usedJti: [], people: { usr_a: { state: "in", since: new Date(NOW - 2 * H).toISOString() } }, historyFrom: "2026-10-01" },
    weather: null,
  };
  ensureWhiteKing(db);
  ensureMine(db);
  return db;
}

const master = (db) => db.users.find((user) => user.role === "master");
const add = (db, name, body, now = NOW) => createRecord(db, name, body, { by: master(db).id, now });
const fit = (db, uid) => {
  add(db, "certs", { uid, type: "hse", expires: addDays(TODAY, 200) });
  add(db, "medicals", { uid, kind: "periodic", date: addDays(TODAY, -30), result: "fit", next: addDays(TODAY, 300) });
};

test("records are checked against the schema", () => {
  const ctx = { user: (uid) => uid === "usr_a", ref: () => false, others: [{ id: "x", code: "EX-01" }] };
  assert.match(cleanRecord("incidents", { kind: "nearmiss" }, ctx).error, /Гарчиг/);
  assert.match(cleanRecord("incidents", { kind: "boom", title: "x", severity: "low", at: "2026-11-01T09:00" }, ctx).error, /Төрөл/);
  assert.match(cleanRecord("equipment", { code: "EX-01", type: "excavator" }, ctx).error, /давхардсан|бүртгэлтэй/);
  const { record } = cleanRecord("permits", { type: "height", title: "Гэрэл солих", holder: "usr_a", from: "2026-11-01T09:00", to: "2026-11-01T15:00", controls: "Бүс", gas: "O2 20.9", isolation: "QF-1" }, ctx);
  assert.equal(record.from, "2026-11-01T01:00:00.000Z");
  assert.equal(record.gas, null, "gas is only for hot work and confined spaces");
  assert.equal(record.isolation, null);
  assert.match(cleanRecord("risks", { hazard: "<b>", likelihood: 3, severity: 3 }, ctx).error, /< >/);
});

test("card holds: training, medical, breath test, and the master switch", () => {
  const db = baseDb();
  const bold = db.users.find((user) => user.id === "usr_a");
  assert.deepEqual(mineHold(db, bold, NOW).length, 2, "no training and no exam on file");
  fit(db, "usr_a");
  assert.equal(mineHold(db, bold, NOW), null);
  add(db, "alcohol", { uid: "usr_a", at: "2026-11-01T08:00", value: 0.2 });
  assert.match(mineHold(db, bold, NOW)[0], /Согтууруулах/);
  assert.equal(mineHold(db, bold, NOW + 25 * H), null, "the breath-test hold lapses after 24 hours");
  assert.ok(db[personalKey("usr_a")].notices.some((item) => item.kind === "hse"), "the worker is told on the phone");
  db.skills.rules.enforce = false;
  assert.equal(mineHold(db, bold, NOW), null);
  assert.equal(mineHold(db, master(db), NOW), null, "only shift staff are held");
  const reasons = holdReasons({ uid: "u", certs: [{ uid: "u", type: "hse", expires: "2026-10-30" }], medicals: [{ uid: "u", date: "2025-10-01", result: "fit", next: "2026-10-01" }], alcohol: [], today: TODAY, now: NOW });
  assert.deepEqual(reasons, ["ХАБ-ын сургалт: хугацаа дууссан", "Үечилсэн үзлэгийн хугацаа 10.01-нд дууссан"]);
});

test("fatigue from sleep and hours on shift", () => {
  assert.equal(fatigueOf({ sleepMin: 280 }).state, "unfit");
  assert.equal(fatigueOf({ sleepMin: 340 }).state, "caution");
  assert.equal(fatigueOf({ sleepMin: 420, onShiftMs: 12.5 * H }).state, "caution");
  assert.equal(fatigueOf({ sleepMin: 420, onShiftMs: 14 * H }).state, "unfit");
  assert.equal(fatigueOf({ sleepMin: null }).state, "unknown");
  assert.equal(fatigueOf({ sleepMin: 450 }).state, "fit");
});

test("operators need the licence; a failed pre-start takes the machine down until the repair is done", () => {
  const db = baseDb();
  fit(db, "usr_a");
  const { item: truck } = add(db, "equipment", { code: "TR-01", type: "truck", hours: 1000, serviceEvery: 250, lastService: 900 });
  const denied = add(db, "assigns", { date: TODAY, shift: "day", equipment: truck.id, operator: "usr_a" });
  assert.match(denied.error, /самосвал/i);
  add(db, "certs", { uid: "usr_a", type: "truck", expires: addDays(TODAY, 100) });
  assert.ok(add(db, "assigns", { date: TODAY, shift: "day", equipment: truck.id, operator: "usr_a" }).item);
  const ok = ["brakes", "steering", "lights", "horn", "tyres", "leaks", "seatbelt", "extinguisher", "mirrors", "fluids", "cab"].filter((key) => key !== "brakes");
  add(db, "prestarts", { equipment: truck.id, operator: "usr_a", date: TODAY, shift: "day", hours: 1010, ok });
  assert.equal(truck.status, "down");
  assert.equal(truck.hours, 1010);
  const order = db.ops.workorders.find((item) => item.equipment === truck.id);
  assert.match(order.title, /Тоормос/);
  const { item: other } = add(db, "equipment", { code: "TR-02", type: "truck" });
  assert.ok(other);
  const busy = add(db, "assigns", { date: TODAY, shift: "night", equipment: truck.id, operator: "usr_a" });
  assert.match(busy.error, /засварт/);
  updateRecord(db, "workorders", order.id, { ...order, status: "done" }, { by: master(db).id, now: NOW + H });
  assert.equal(truck.status, "ready");
  assert.ok(db.ops.workorders.find((item) => item.id === order.id).closed);
});

test("stock moves and PPE issue keep the balance", () => {
  const db = baseDb();
  const { item: boots } = add(db, "stock", { code: "B", name: "Гутал", category: "ppe", qty: 2, unit: "хос", min: 1 });
  add(db, "ppe", { uid: "usr_a", item: "boots", issued: TODAY, life: 12, stock: boots.id });
  assert.equal(boots.qty, 1);
  assert.equal(db.ops.moves.length, 1);
  assert.match(add(db, "moves", { stock: boots.id, kind: "out", qty: 5, at: "2026-11-01T09:00" }).error, /хүрэлцэхгүй/);
  add(db, "moves", { stock: boots.id, kind: "in", qty: 10, at: "2026-11-01T09:00" });
  assert.equal(boots.qty, 11);
});

test("permits need both signatures to go live and expire on time", () => {
  const db = baseDb();
  const base = { type: "hot", title: "Гагнуур", holder: "usr_a", from: "2026-11-01T08:00", to: "2026-11-01T12:00", controls: "Гал унтраагуур", status: "active" };
  assert.match(add(db, "permits", base).error, /гарын үсэг/);
  assert.match(add(db, "permits", { ...base, to: "2026-11-02T12:00", issuerSign: "A", holderSign: "B" }).error, /24 цаг/);
  const { item } = add(db, "permits", { ...base, issuerSign: "A", holderSign: "B" });
  assert.equal(permitState(item, NOW), "active");
  assert.equal(permitState(item, NOW + 3 * H), "expired");
  assert.deepEqual(riskLevel(3, 5), { score: 15, level: "high", label: "Өндөр" });
});

test("production, availability and injury rates", () => {
  const kpi = mineKpis({
    handovers: [{ date: TODAY, tonnes: 6000 }, { date: TODAY, tonnes: 5000 }, { date: addDays(TODAY, -1), tonnes: 12500 }],
    planTonnes: 12000,
    incidents: [{ kind: "incident", injury: "lti", at: new Date(NOW - 5 * 24 * H).toISOString() }, { kind: "incident", injury: "mti", at: new Date(NOW - 2 * 24 * H).toISOString() }, { kind: "nearmiss", injury: "none", at: new Date(NOW).toISOString() }],
    workorders: [{ equipment: "e1", kind: "breakdown", opened: new Date(NOW - 10 * H).toISOString(), closed: null }],
    equipment: [{ id: "e1" }, { id: "e2" }],
    assigns: [],
    hoursWorked: 200000,
    windowDays: 30,
    today: TODAY,
    now: NOW,
  });
  assert.equal(kpi.production.at(-1).tonnes, 11000);
  assert.equal(kpi.prodTotal, 23500);
  assert.equal(kpi.lti, 1);
  assert.equal(kpi.recordable, 2);
  assert.equal(kpi.ltifr, 5);
  assert.equal(kpi.trifr, 10);
  assert.ok(kpi.availability < 1 && kpi.availability > 0.9);
});

test("payroll counts night hours and overtime from attendance", () => {
  const at = (iso) => new Date(Date.parse(iso)).toISOString();
  const events = [
    { uid: "u", state: "in", at: at("2026-10-05T18:00:00+08:00"), date: "2026-10-05", shift: "night" },
    { uid: "u", state: "out", at: at("2026-10-06T07:00:00+08:00"), date: "2026-10-05", shift: "night" },
  ];
  const [row] = payrollRows({ users: [{ id: "u", displayName: "U", card: { idNumber: "1" } }], events, plans: {}, leaves: [], month: "2026-10", now: NOW });
  assert.equal(row.hours, 13);
  assert.equal(row.nightHours, 8);
  assert.equal(row.overtime, 1);
});

test("crew change and bed allocation follow the rotation", () => {
  const plan = { type: "rotation", pattern: "dd", start: TODAY, before: ["day", "day", "day", "day", "off", "off", "off"] };
  const users = [{ id: "a" }, { id: "b" }];
  const plans = { a: plan };
  assert.equal(plannedKind(plan, addDays(TODAY, -1)), "off");
  assert.notEqual(plannedKind(plan, TODAY), "off");
  assert.deepEqual(crewChange(users, plans, [], TODAY), { arrive: ["a"], depart: [] });
  const rooms = [{ id: "r1", block: "A", number: "A101", beds: 1 }];
  const result = allocateBeds({ rooms, beds: { "r1:0": "gone" }, users, plans, leaves: [], date: TODAY });
  assert.deepEqual(result.beds, { "r1:0": "a" });
  assert.equal(result.freed, 1);
  assert.equal(result.added, 1);
});

test("blast warnings count down on the station and close the zone afterwards", () => {
  const db = baseDb();
  add(db, "certs", { uid: "usr_b", type: "blaster", expires: addDays(TODAY, 100) });
  const at = NOW + 40 * 60000;
  const { item: blast } = add(db, "blasts", { at: new Date(at).toISOString(), place: "Блок 4", radius: 500, blaster: "usr_b" });
  assert.equal(mineTick(db, NOW), 1, "only the daily reminder run");
  mineTick(db, at - 29 * 60000);
  assert.ok(db.whiteking.queue.some((item) => item.text.includes("30 минутын")));
  assert.ok(db[personalKey("usr_a")].notices.some((item) => item.text.includes("Тэсэлгээ")), "people on site get it on the phone");
  mineTick(db, at - 4 * 60000);
  assert.ok(blast.fired.w5 && blast.fired.w15);
  mineTick(db, at + 1000);
  assert.ok(blast.fired.go);
  mineTick(db, at + 16 * 60000);
  assert.equal(blast.status, "done");
  assert.ok(db.whiteking.queue.some((item) => item.text.includes("бүс нээгдлээ")));
});

test("weather over a threshold stops work until it settles", () => {
  const db = baseDb();
  add(db, "wxRules", { name: "Шуурга", metric: "wind", threshold: 20, action: "Гадна ажил зогсооно", enabled: true });
  db.weather = { fetchedAt: new Date(NOW).toISOString(), windSpeedMs: 8, feelsLikeC: -10, code: 0, precipNowMm: 0 };
  mineTick(db, NOW);
  assert.equal(db.hse.wxEvents.length, 0);
  setWxSim(db, { windSpeedMs: 24, minutes: 10 }, NOW);
  mineTick(db, NOW + 1000);
  assert.equal(db.hse.wxEvents.filter((item) => !item.end).length, 1);
  assert.ok(db.whiteking.queue.some((item) => item.text.startsWith("Ажил зогсоох")));
  assert.equal(workerMine(db, "usr_a", NOW + 2000).stopWork.length, 1);
  setWxSim(db, { windSpeedMs: 19.5, minutes: 10 }, NOW + 2000);
  mineTick(db, NOW + 3000);
  assert.equal(db.hse.wxEvents.filter((item) => !item.end).length, 1, "stays stopped within the margin");
  setWxSim(db, { clear: true }, NOW + 4000);
  mineTick(db, NOW + 5000);
  assert.equal(db.hse.wxEvents.filter((item) => !item.end).length, 0);
});

test("a lone worker who stops answering raises an SOS", () => {
  const db = baseDb();
  startLone(db, "usr_a", { minutes: 15, place: "Насос №2", now: NOW });
  mineTick(db, NOW + 16 * 60000);
  assert.equal(db.hse.sos.length, 0, "a short grace period first");
  mineTick(db, NOW + 21 * 60000);
  assert.equal(db.hse.sos[0].kind, "lone");
  okLone(db, "usr_a", NOW + 22 * 60000);
  assert.equal(db.hse.sos[0].status, "resolved");
  const { sos } = raiseSos(db, "usr_b", { lat: 43.5, lng: 105.9, now: NOW });
  assert.deepEqual(sos.geo, { lat: 43.5, lng: 105.9, source: "browser" });
  assert.ok(db.whiteking.queue.some((item) => item.text.includes("SOS")));
});

test("muster counts the people on site by card and visitor pass", () => {
  const db = baseDb();
  const { item: visitor } = add(db, "visitors", { name: "Зочин", kind: "visitor", from: TODAY, to: TODAY, induction: ["rules", "emergency", "ppe", "hazards", "traffic"] });
  visitor.onSite = true;
  const { muster } = startMuster(db, { reason: "Сургуулилт", by: master(db).id, now: NOW });
  assert.deepEqual(muster.expected, ["usr_a", `v:${visitor.id}`]);
  const bold = db.users.find((user) => user.id === "usr_a");
  assert.equal(checkMuster(db, { qr: `${CARD_QR_PREFIX}${bold.cardKey}`, via: "qr", now: NOW }).name, "Болд");
  assert.equal(checkMuster(db, { qr: `UMBV:${visitor.key}`, via: "qr", now: NOW }).name, "Зочин");
  assert.equal(Object.keys(muster.checked).length, 2);
  assert.ok(checkMuster(db, { uid: "usr_a", now: NOW }).already);
  assert.equal(workerMine(db, "usr_a", NOW).muster.checked, true);
});

test("demo seed fills every page once without blocking real accounts", () => {
  const db = baseDb();
  db.shiftPlans = { usr_a: { type: "rotation", pattern: "dd", start: addDays(TODAY, -3), before: ["off", "off", "off", "off", "off", "off", "off"] } };
  const summary = seedMine(db, { now: NOW, random: seededRandom() });
  assert.deepEqual(summary.errors, []);
  assert.ok(summary.records > 100);
  assert.equal(seedMine(db, { now: NOW, random: seededRandom() }), null);
  const view = masterView(db, NOW);
  assert.ok(view.ops.equipment.length >= 10);
  assert.ok(view.hse.talks.length && view.hse.permits.length && db.camp.rooms.length);
  assert.equal(view.camp, undefined, "camp records belong to the camp manager");
  for (const [uid, reasons] of Object.entries(view.holds)) assert.deepEqual(reasons, [], `${uid} must still clock in`);
  assert.equal(view.kpi.production.length, 7);
  assert.ok(JSON.stringify(db.hse).length < 900_000 && JSON.stringify(db.ops).length < 900_000);
  assert.ok(workerMine(db, "usr_a", NOW).talks.length >= 1);
});
