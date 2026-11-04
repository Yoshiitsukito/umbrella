import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, newUser } from "../lib/auth.mjs";
import { createRecord, deleteRecord, ensureMine, updateRecord } from "../lib/mine.mjs";
import { seedMine } from "../lib/mineseed.mjs";
import {
  COAL_COLLECTIONS,
  DIRECTOR_ROLE,
  ENV_COLLECTIONS,
  ENV_ROLE,
  FINANCE_ROLE,
  FIN_COLLECTIONS,
  REQUEST_COLLECTIONS,
  SHIP_ROLE,
  bizReport,
  decideRequest,
  envView,
  execView,
  financeView,
  monthSummary,
  procureView,
  requestInbox,
  saveCoalSettings,
  saveFinSettings,
  seedBiz,
} from "../lib/biz.mjs";
import { cleanRecord } from "../public/js/minecore.js";
import { addMonth, coalGrade, depreciation, envState, financeMonth, netOf, saleProgress } from "../public/js/bizcore.js";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-01T10:00:00+08:00");
const local = (ms) => new Date(ms + 8 * HOUR).toISOString().slice(0, 16);
const finance = { id: "usr_fin", displayName: "Санхүү" };
const director = { id: "usr_dir", displayName: "Захирал" };

function baseDb() {
  const users = [];
  const add = (id, role, displayName) => users.push(newUser({ id, username: id, password: "x", role, displayName, existing: users }));
  add("usr_op", "user", "Оператор");
  add("usr_master", "master", "Мастер");
  add("usr_eng", "engineer", "Уулын ахлах");
  add("usr_fin", FINANCE_ROLE, "Санхүү");
  add("usr_dir", DIRECTOR_ROLE, "Захирал");
  const db = { users, shiftPlans: {}, leaves: [], attendance: { events: [], usedJti: [], people: {}, historyFrom: "2026-10-01" } };
  ensureMine(db);
  return db;
}

const add = (db, name, body, now = NOW) => createRecord(db, name, body, { by: "usr_eng", now });
const decide = (db, name, id, role, ok, note = "", now = NOW) => decideRequest(db, name, id, { role, me: role === DIRECTOR_ROLE ? director : finance, ok, note, now });
const capex = (db, body = {}) => add(db, "capex", { kind: "equipment", title: "CAT 793F", qty: 1, price: 4_000_000_000, reason: "Хүчин чадал нэмэх", ...body }).item;

function seededRandom() {
  let state = 11;
  return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
}

test("finance, director, shipment and environment managers are roles of their own", () => {
  for (const role of [FINANCE_ROLE, DIRECTOR_ROLE, SHIP_ROLE, ENV_ROLE]) assert.ok(ROLES.includes(role), role);
  assert.deepEqual(REQUEST_COLLECTIONS, ["capex", "disposals"]);
  assert.deepEqual(FIN_COLLECTIONS, ["assets", "costs", "budgets"]);
  assert.deepEqual(COAL_COLLECTIONS, ["labs", "sales", "shipments"]);
  assert.deepEqual(ENV_COLLECTIONS, ["envReadings", "rehab", "envAudits"]);
});

test("a purchase goes engineer → finance → director and only the server moves the stage", () => {
  const db = baseDb();
  const item = add(db, "capex", { kind: "tool", title: "Өрмийн хошуу", qty: 4, price: 2_500_000, reason: "Нөөц дууссан", stage: "approved" }).item;
  assert.equal(item.stage, "finance", "the requester cannot set the stage");
  assert.deepEqual(item.trail, []);
  assert.equal(requestInbox(db, FINANCE_ROLE), 1);
  assert.equal(requestInbox(db, DIRECTOR_ROLE), 0);

  assert.equal(decide(db, "capex", item.id, DIRECTOR_ROLE, true).status, 409, "the director waits for finance");
  assert.equal(decide(db, "capex", item.id, "engineer", true).status, 403);
  assert.match(decide(db, "capex", item.id, FINANCE_ROLE, false).error, /шалтгаан/);
  assert.match(decide(db, "capex", item.id, FINANCE_ROLE, true, "<b>").error, /< >/);

  assert.ok(decide(db, "capex", item.id, FINANCE_ROLE, true, "Төсөвт багтана").ok);
  assert.equal(item.stage, "director");
  assert.equal(item.decidedAt, undefined);
  assert.equal(requestInbox(db, DIRECTOR_ROLE), 1);
  assert.match(updateRecord(db, "capex", item.id, { ...item, qty: 40 }, { by: "usr_eng", now: NOW }).error, /засах боломжгүй/);
  assert.equal(deleteRecord(db, "capex", item.id).status, 409);
  assert.equal(decide(db, "capex", item.id, FINANCE_ROLE, true).status, 409, "finance has already passed it on");

  assert.ok(decide(db, "capex", item.id, DIRECTOR_ROLE, true).ok);
  assert.equal(item.stage, "approved");
  assert.ok(item.decidedAt);
  assert.deepEqual(item.trail.map((row) => [row.role, row.ok, row.by]), [[FINANCE_ROLE, true, "Санхүү"], [DIRECTOR_ROLE, true, "Захирал"]]);
  assert.equal(decide(db, "capex", item.id, DIRECTOR_ROLE, true).status, 409);
});

test("an approved machine or tool becomes a fixed asset, parts are booked as a cost", () => {
  const db = baseDb();
  const truck = capex(db);
  decide(db, "capex", truck.id, FINANCE_ROLE, true);
  decide(db, "capex", truck.id, DIRECTOR_ROLE, true);
  const asset = db.fin.assets.find((entry) => entry.id === truck.asset);
  assert.ok(asset, "the asset is linked back to the request");
  assert.equal(asset.cost, 4_000_000_000);
  assert.equal(asset.life, 8);
  assert.equal(asset.salvage, 200_000_000);
  assert.equal(asset.acquired, "2026-11-01");

  const tyres = capex(db, { kind: "part", title: "Дугуй", qty: 2, price: 90_000_000 });
  decide(db, "capex", tyres.id, FINANCE_ROLE, true);
  decide(db, "capex", tyres.id, DIRECTOR_ROLE, true);
  const cost = db.fin.costs.find((entry) => entry.id === tyres.costRecord);
  assert.deepEqual([cost.category, cost.amount, cost.date], ["parts", 180_000_000, "2026-11-01"]);
  assert.equal(db.fin.assets.length, 1);

  const rejected = capex(db, { title: "Land Cruiser", kind: "vehicle", price: 200_000_000 });
  decide(db, "capex", rejected.id, FINANCE_ROLE, false, "Төсөв хүрэлцэхгүй");
  assert.equal(rejected.stage, "rejected");
  assert.equal(rejected.trail.at(-1).note, "Төсөв хүрэлцэхгүй");
  assert.equal(db.fin.assets.length, 1, "nothing is booked for a refusal");
});

test("an approved write-off retires the machine and its asset at book value", () => {
  const db = baseDb();
  const bus = add(db, "equipment", { code: "BUS-01", type: "bus" }).item;
  const asset = createRecord(db, "assets", { name: "Автобус", category: "vehicle", equipment: bus.id, cost: 120_000_000, acquired: "2024-10-15", life: 5, salvage: 0 }, { by: "usr_fin", now: NOW }).item;
  const item = add(db, "disposals", { equipment: bus.id, method: "sell", value: 50_000_000, reason: "Хугацаа дууссан" }).item;
  assert.equal(item.stage, "finance");
  assert.match(add(db, "disposals", { equipment: bus.id, method: "scrap", reason: "Давхар" }).error, /шийдвэрлэгдээгүй/);

  decide(db, "disposals", item.id, FINANCE_ROLE, true);
  decide(db, "disposals", item.id, DIRECTOR_ROLE, true);
  const book = 120_000_000 - 2_000_000 * 25;
  assert.equal(item.book, book);
  assert.equal(bus.status, "retired");
  assert.deepEqual([asset.status, asset.disposedOn, asset.proceeds], ["disposed", "2026-11-01", 50_000_000]);
  assert.match(add(db, "disposals", { equipment: bus.id, method: "scrap", reason: "Дахин" }).error, /актлагдсан/);

  const summary = monthSummary(db, "2026-11", NOW);
  assert.equal(summary.fleet.retired, 1);
  assert.equal(summary.fleet.total, 0);
  assert.equal(summary.money.assetGain, 50_000_000 - book);
  assert.equal(summary.approvals.approved, 1);
});

test("straight-line depreciation starts the month after purchase and stops at the end of life", () => {
  const asset = { cost: 1200, salvage: 0, life: 1, acquired: "2026-01-15", status: "active" };
  assert.equal(depreciation(asset, "2026-01").months, 0);
  assert.deepEqual(depreciation(asset, "2026-02"), { monthly: 100, months: 1, life: 12, accumulated: 100, book: 1100 });
  assert.equal(depreciation(asset, "2027-06").book, 0);
  assert.equal(depreciation({ ...asset, salvage: 240 }, "2030-01").book, 240);
  assert.equal(depreciation({ ...asset, status: "disposed", disposedOn: "2026-04-10" }, "2026-12").months, 3);
  assert.equal(addMonth("2026-11", 3), "2027-02");
  assert.equal(addMonth("2026-01", -1), "2025-12");
});

test("coal grade, weighbridge net weight and monitoring limits", () => {
  assert.equal(coalGrade({ cv: 6100, ash: 14 }), "premium");
  assert.equal(coalGrade({ cv: 6100, ash: 18 }), "standard");
  assert.equal(coalGrade({ cv: 4800, ash: 10 }), "low");
  assert.equal(netOf({ gross: 120.55, tare: 40.2 }), 80.35);
  assert.equal(envState({ metric: "pm10", value: 101 }), "over");
  assert.equal(envState({ metric: "pm10", value: 95 }), "near");
  assert.equal(envState({ metric: "pm10", value: 50 }), "ok");
  assert.equal(envState({ metric: "ph", value: 5.9 }), "over");
  assert.equal(envState({ metric: "ph", value: 6.2 }), "near");
  assert.equal(envState({ metric: "ph", value: 7.4 }), "ok");
});

test("a shipment needs a real weighing, an open contract and coal good enough for it", () => {
  const db = baseDb();
  const by = { by: "usr_ship", now: NOW };
  const sale = createRecord(db, "sales", { date: "2026-10-01", buyer: "Хүннү Энержи", contract: "BG-1", tonnes: 100, price: 200_000, minCv: 5500 }, by).item;
  const weak = createRecord(db, "labs", { date: "2026-10-30", sample: "S-1", cv: 5200, ash: 14, moisture: 8 }, by).item;
  const good = createRecord(db, "labs", { date: "2026-10-31", sample: "S-2", cv: 5900, ash: 14, moisture: 8 }, by).item;
  const ship = (body) => createRecord(db, "shipments", { at: local(NOW - HOUR), sale: sale.id, vehicle: "1234 УБА", gross: 100, tare: 40, ...body }, by);

  assert.match(ship({ gross: 40, tare: 40 }).error, /Бохир жин/);
  assert.match(ship({ at: local(NOW + 2 * HOUR) }).error, /ирээдүй/);
  assert.match(ship({ lab: weak.id }).error, /доод хэмжээ 5500/);
  assert.ok(ship({ lab: good.id }).item);
  assert.equal(sale.status, "open");
  assert.ok(ship({ gross: 82 }).item);
  assert.equal(sale.status, "done", "a filled contract closes itself");
  assert.match(ship({}).error, /гэрээ/);
  assert.deepEqual(saleProgress(sale, db.coal.shipments), { shipped: 102, trucks: 2, left: 0, value: 20_400_000, share: 1 });
  assert.equal(deleteRecord(db, "sales", sale.id).status, 409);
});

test("one budget per month and category; months are written YYYY-MM", () => {
  const db = baseDb();
  const by = { by: "usr_fin", now: NOW };
  assert.ok(createRecord(db, "budgets", { month: "2026-11", category: "fuel", amount: 900_000_000 }, by).item);
  assert.match(createRecord(db, "budgets", { month: "2026-11", category: "fuel", amount: 1 }, by).error, /бүртгэлтэй/);
  assert.ok(createRecord(db, "budgets", { month: "2026-12", category: "fuel", amount: 1 }, by).item);
  assert.match(cleanRecord("budgets", { month: "2026-13", category: "fuel", amount: 1 }, {}).error, /сар/);
  assert.match(createRecord(db, "assets", { name: "X", cost: 100, salvage: 200, acquired: "2026-01-01", life: 3 }, by).error, /Үлдэх өртөг/);
  assert.match(createRecord(db, "rehab", { name: "Овоолго", planned: 5, done: 6 }, by).error, /Гүйцэтгэл/);
});

test("a month's money: coal revenue, costs, fuel from the log, depreciation and profit", () => {
  const month = "2026-10";
  const at = "2026-10-12T02:00:00.000Z";
  const money = financeMonth(
    {
      fin: {
        costs: [{ date: "2026-10-05", category: "repair", amount: 1_000_000 }, { date: "2026-09-30", category: "repair", amount: 9 }],
        budgets: [{ month, category: "repair", amount: 2_000_000 }, { month, category: "fuel", amount: 500_000 }],
        assets: [{ cost: 12_000_000, salvage: 0, life: 1, acquired: "2026-01-01", status: "active" }],
        disposals: [],
      },
      coal: { sales: [{ id: "s1", price: 100_000 }], shipments: [{ at, sale: "s1", gross: 100, tare: 40 }] },
      ops: { fuel: [{ at, liters: 200 }] },
      fuelPrice: 3500,
    },
    month,
  );
  assert.equal(money.revenue, 6_000_000);
  assert.equal(money.costs.fuel, 700_000);
  assert.equal(money.costs.repair, 1_000_000);
  assert.equal(money.costTotal, 1_700_000);
  assert.equal(money.depreciation, 1_000_000);
  assert.equal(money.profit, 3_300_000);
  assert.equal(money.budgetTotal, 2_500_000);
  assert.equal(money.margin, 0.55);
  const running = financeMonth({ fin: { assets: [{ cost: 12_000_000, salvage: 0, life: 1, acquired: "2026-01-01", status: "active" }] }, coal: {}, ops: {}, fuelPrice: 0, share: 0.25 }, month);
  assert.equal(running.depreciation, 250_000, "a running month carries depreciation for the days gone");
});

test("settings stay in range", () => {
  const db = baseDb();
  assert.match(saveFinSettings(db, { fuelPrice: 50 }).error, /Түлшний үнэ/);
  assert.ok(saveFinSettings(db, { fuelPrice: 3720 }).ok);
  assert.equal(db.fin.settings.fuelPrice, 3720);
  assert.match(saveCoalSettings(db, { opening: -1 }).error, /үлдэгдэл/);
  assert.ok(saveCoalSettings(db, { opening: 5000 }).ok);
  assert.equal(db.coal.settings.opening, 5000);
});

test("demo finance, coal and environment data come once, after the mine demo, and add up", () => {
  const db = baseDb();
  assert.equal(seedBiz(db, { now: NOW, random: seededRandom() }), null, "nothing before the mine demo exists");
  seedMine(db, { now: NOW, random: seededRandom() });
  const seeded = seedBiz(db, { now: NOW, random: seededRandom() });
  assert.ok(seeded.records > 500);
  assert.equal(seedBiz(db, { now: NOW, random: seededRandom() }), null);

  const stages = Object.fromEntries(["finance", "director", "approved", "rejected"].map((stage) => [stage, REQUEST_COLLECTIONS.flatMap((name) => db.fin[name]).filter((item) => item.stage === stage).length]));
  assert.deepEqual(stages, { finance: 2, director: 1, approved: 1, rejected: 1 });
  assert.equal(requestInbox(db, FINANCE_ROLE), 2);
  assert.equal(requestInbox(db, DIRECTOR_ROLE), 1);

  const summary = monthSummary(db, "2026-10", NOW);
  assert.ok(summary.production.tonnes > 0);
  assert.ok(summary.coal.shipped > 0 && summary.coal.revenue > 0);
  assert.ok(summary.coal.samples > 0);
  assert.ok(summary.money.costs.fuel > 0, "fuel is priced from the fuel log");
  assert.ok(summary.money.depreciation > 0);
  assert.ok(summary.env.readings > 0);
  assert.equal(summary.env.openAudits, 1);
  assert.equal(summary.days, 31);
  assert.equal(summary.elapsed, 31);

  const report = bizReport(db, "2026-10", NOW);
  assert.equal(report.trend.length, 6);
  assert.equal(report.trend.at(-1).month, "2026-10");
  assert.equal(report.contracts.length, 3);
  assert.ok(report.assets.count > 0 && report.assets.book < report.assets.cost);
});

test("each page carries only what its role needs, and no secrets", () => {
  const db = baseDb();
  seedMine(db, { now: NOW, random: seededRandom() });
  seedBiz(db, { now: NOW, random: seededRandom() });
  const fin = financeView(db, NOW);
  assert.ok(fin.fin.assets.length && fin.summary && fin.trend.length === 6);
  assert.equal(fin.hse, undefined);
  assert.ok(Object.keys(fin.actuals).length >= 6, "actual spend beside every budgeted month");
  const procure = procureView(db, NOW);
  assert.deepEqual(Object.keys(procure.fin).sort(), ["assets", "capex", "disposals"]);
  assert.equal(procure.coal, undefined);
  const env = envView(db, NOW);
  assert.ok(env.env.envReadings.length && !env.fin && !env.coal);
  const exec = execView(db, NOW);
  assert.ok(exec.hse && exec.ops && exec.fin && exec.coal && exec.env && exec.summary);
  for (const view of [fin, procure, env, exec]) {
    const text = JSON.stringify(view);
    assert.ok(!text.includes("passwordHash") && !text.includes('"secret"'));
  }
});

test("retired machines leave the working fleet", () => {
  const db = baseDb();
  const truck = add(db, "equipment", { code: "TR-09", type: "truck" }).item;
  const item = add(db, "disposals", { equipment: truck.id, method: "scrap", reason: "Ослын дараа сэргээх боломжгүй" }).item;
  decide(db, "disposals", item.id, FINANCE_ROLE, true, "", NOW - DAY);
  decide(db, "disposals", item.id, DIRECTOR_ROLE, true);
  assert.equal(item.book, 0, "no asset record means nothing left on the books");
  assert.equal(truck.status, "retired");
  assert.match(add(db, "assigns", { date: "2026-11-01", shift: "day", equipment: truck.id, operator: "usr_op" }).error, /актлагдсан/);
});
