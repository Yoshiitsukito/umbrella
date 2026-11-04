// Finance, the director, the shipment manager and the environment manager: what each page shows, the chief
// engineer's purchase and write-off requests (engineer → finance → director), the monthly figures behind the
// executive board and its printable report, the two settings, and the demo data.
import { STAFF_ROLES } from "./auth.mjs";
import { createRecord, ensureMine, masterView } from "./mine.mjs";
import { maintSummary } from "./maint.mjs";
import { CAPEX_KINDS, DISPOSE_METHODS, ENV_METRICS, collectionsOf, currentShift, localDay, localInput } from "../public/js/minecore.js";
import { addMonth, coalGrade, daysIn, depreciation, envState, financeMonth, momentMonth, monthOf, netOf, requestValue, saleProgress } from "../public/js/bizcore.js";
import { addDays, shiftDateOf } from "../public/js/workstats.js";

export const FINANCE_ROLE = "finance";
export const DIRECTOR_ROLE = "director";
export const SHIP_ROLE = "shipmgr";
export const ENV_ROLE = "envmgr";
export const ENGINEER_ROLE = "engineer";
export const REQUEST_COLLECTIONS = ["capex", "disposals"];
export const FIN_COLLECTIONS = collectionsOf("fin").filter((name) => !REQUEST_COLLECTIONS.includes(name));
export const COAL_COLLECTIONS = collectionsOf("coal");
export const ENV_COLLECTIONS = collectionsOf("env");
export const DEFAULT_FUEL_PRICE = 3500;
export const BIZ_SEED_VERSION = 1;
const NOTE_MAX = 300;
const DAY_MS = 24 * 3600 * 1000;
/** Useful life in years given to equipment bought through an approved request. */
const LIFE = { equipment: 8, vehicle: 5, tool: 4 };
const STAGE_OF = { [FINANCE_ROLE]: "finance", [DIRECTOR_ROLE]: "director" };

const round1 = (value) => Math.round(value * 10) / 10;
const sum = (list, get) => list.reduce((total, item) => total + (Number(get(item)) || 0), 0);

export function ensureBiz(db) {
  ensureMine(db);
  db.fin.settings = { fuelPrice: DEFAULT_FUEL_PRICE, ...(db.fin.settings || {}) };
  db.coal.settings = { opening: 0, ...(db.coal.settings || {}) };
  return db;
}

function frame(now) {
  const today = localDay(now);
  return { now: new Date(now).toISOString(), today, month: today.slice(0, 7), shiftDate: shiftDateOf(now), shift: currentShift(now), users: [] };
}

const pending = (db) => REQUEST_COLLECTIONS.flatMap((name) => db.fin[name].filter((item) => ["finance", "director"].includes(item.stage)).map((item) => ({ name, item })));

/** How many requests wait for this role's decision; the nav badge. */
export function requestInbox(db, role) {
  const stage = STAGE_OF[role];
  if (!stage || !db.fin) return 0;
  return REQUEST_COLLECTIONS.reduce((count, name) => count + (db.fin[name] || []).filter((item) => item.stage === stage).length, 0);
}

/** How much of `month` has gone by at `now`: all of a past month, none of a future one. */
function monthShare(month, now) {
  const today = localDay(now);
  if (month < today.slice(0, 7)) return 1;
  if (month > today.slice(0, 7)) return 0;
  return Number(today.slice(8)) / daysIn(month);
}

const moneyOf = (db, month, now) => financeMonth({ fin: db.fin, coal: db.coal, ops: db.ops, fuelPrice: db.fin.settings.fuelPrice, share: monthShare(month, now) }, month);

/** Coal on hand: the opening balance, plus everything produced, less everything shipped. */
function stockpile(db) {
  const produced = sum(db.ops.handovers, (item) => item.tonnes);
  const shipped = sum(db.coal.shipments, netOf);
  return Math.round((db.coal.settings.opening || 0) + produced - shipped);
}

/** One month across the mine: production, coal sales and quality, money, safety, people, fleet, environment, approvals. */
export function monthSummary(db, month, now = Date.now()) {
  ensureBiz(db);
  const today = localDay(now);
  const days = daysIn(month);
  const elapsed = today.slice(0, 7) === month ? Number(today.slice(8)) : month < today.slice(0, 7) ? days : 0;
  const money = moneyOf(db, month, now);
  const handovers = db.ops.handovers.filter((item) => monthOf(item.date) === month);
  const daily = Array.from({ length: days }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const shipped = db.coal.shipments.filter((item) => localDay(Date.parse(item.at)) === date);
    return { date, tonnes: sum(handovers.filter((item) => item.date === date), (item) => item.tonnes), shipped: round1(sum(shipped, netOf)) };
  });
  const labs = db.coal.labs.filter((item) => monthOf(item.date) === month);
  const average = (key) => (labs.length ? round1(sum(labs, (item) => item[key]) / labs.length) : null);
  const grades = { premium: 0, standard: 0, low: 0 };
  for (const lab of labs) grades[coalGrade(lab)] += 1;
  const openSales = db.coal.sales.filter((item) => item.status === "open");
  const incidents = db.hse.incidents.filter((item) => momentMonth(item.at) === month);
  const ltis = db.hse.incidents.filter((item) => item.kind === "incident" && item.injury === "lti").map((item) => item.at).sort();
  const staff = (db.users || []).filter((user) => STAFF_ROLES.includes(user.role));
  const fleet = db.ops.equipment.filter((item) => item.status !== "retired");
  const down = fleet.filter((item) => ["down", "service"].includes(item.status)).length;
  const readings = db.env.envReadings.filter((item) => momentMonth(item.at) === month);
  const waiting = pending(db);
  const decided = REQUEST_COLLECTIONS.flatMap((name) => db.fin[name].filter((item) => ["approved", "rejected"].includes(item.stage) && momentMonth(item.decidedAt) === month).map((item) => ({ name, item })));
  const approved = decided.filter(({ item }) => item.stage === "approved");
  return {
    month,
    days,
    elapsed,
    production: { tonnes: sum(handovers, (item) => item.tonnes), plan: (db.ops.planTonnes || 0) * days, planToDate: (db.ops.planTonnes || 0) * elapsed, daily },
    coal: {
      shipped: money.tonnes,
      trucks: money.trucks,
      revenue: money.revenue,
      stockpile: stockpile(db),
      samples: labs.length,
      cv: average("cv"),
      ash: average("ash"),
      moisture: average("moisture"),
      grades,
      openSales: openSales.length,
      contractedLeft: Math.round(sum(openSales, (sale) => saleProgress(sale, db.coal.shipments).left)),
    },
    money,
    hse: {
      incidents: incidents.filter((item) => item.kind === "incident").length,
      nearmiss: incidents.filter((item) => item.kind !== "incident").length,
      lti: incidents.filter((item) => item.kind === "incident" && item.injury === "lti").length,
      open: db.hse.incidents.filter((item) => item.status !== "closed").length,
      violations: db.guard.violations.filter((item) => momentMonth(item.at) === month).length,
      daysSinceLti: ltis.length ? Math.max(0, Math.floor((now - Date.parse(ltis.at(-1))) / DAY_MS)) : null,
    },
    people: { staff: staff.length, onSite: staff.filter((user) => db.attendance?.people?.[user.id]?.state === "in").length },
    fleet: { total: fleet.length, down, ready: fleet.length - down, availability: fleet.length ? (fleet.length - down) / fleet.length : null, retired: db.ops.equipment.length - fleet.length },
    env: {
      readings: readings.length,
      over: readings.filter((item) => envState(item) === "over").length,
      near: readings.filter((item) => envState(item) === "near").length,
      rehabPlanned: round1(sum(db.env.rehab, (item) => item.planned)),
      rehabDone: round1(sum(db.env.rehab, (item) => item.done)),
      openAudits: db.env.envAudits.filter((item) => item.status === "open").length,
    },
    approvals: {
      finance: waiting.filter(({ item }) => item.stage === "finance").length,
      director: waiting.filter(({ item }) => item.stage === "director").length,
      pendingValue: sum(waiting, ({ name, item }) => requestValue(name, item)),
      approved: approved.length,
      approvedValue: sum(approved, ({ name, item }) => requestValue(name, item)),
      rejected: decided.length - approved.length,
    },
  };
}

/** Income, cost and profit for the six months ending with `month`. */
export function moneyTrend(db, month, now = Date.now()) {
  ensureBiz(db);
  return Array.from({ length: 6 }, (_, index) => addMonth(month, index - 5)).map((key) => {
    const money = moneyOf(db, key, now);
    return { month: key, income: money.income, cost: money.costTotal + money.depreciation, profit: money.profit, tonnes: money.tonnes };
  });
}

/** The monthly report: the summary and trend, the requests decided that month, limit breaches and contract progress. */
export function bizReport(db, month, now = Date.now()) {
  ensureBiz(db);
  const equipment = new Map(db.ops.equipment.map((item) => [item.id, item.code]));
  const decided = REQUEST_COLLECTIONS.flatMap((name) =>
    db.fin[name]
      .filter((item) => ["approved", "rejected"].includes(item.stage) && momentMonth(item.decidedAt) === month)
      .map((item) => ({
        name,
        title: name === "capex" ? `${CAPEX_KINDS[item.kind]}: ${item.title}${item.qty > 1 ? ` × ${item.qty}` : ""}` : `${equipment.get(item.equipment) || "Техник"} · ${DISPOSE_METHODS[item.method]}`,
        value: requestValue(name, item),
        stage: item.stage,
        decidedAt: item.decidedAt,
      })),
  );
  const breaches = db.env.envReadings
    .filter((item) => momentMonth(item.at) === month && envState(item) === "over")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12)
    .map(({ at, point, metric, value }) => ({ at, point, metric, value, limit: ENV_METRICS[metric] }));
  const contracts = db.coal.sales
    .filter((item) => item.status !== "cancelled")
    .map((sale) => ({ buyer: sale.buyer, contract: sale.contract, tonnes: sale.tonnes, price: sale.price, status: sale.status, ...saleProgress(sale, db.coal.shipments) }));
  const assets = db.fin.assets.filter((item) => item.status === "active");
  return {
    generatedAt: new Date(now).toISOString(),
    summary: monthSummary(db, month, now),
    trend: moneyTrend(db, month, now),
    decided,
    breaches,
    contracts,
    assets: { count: assets.length, cost: sum(assets, (item) => item.cost), book: sum(assets, (item) => depreciation(item, month).book) },
    fuelPrice: db.fin.settings.fuelPrice,
  };
}

/** The board figures, plus actual spend per category for every month that has a budget. */
function boardOf(db, now) {
  const base = frame(now);
  const months = [...new Set(db.fin.budgets.map((item) => item.month))];
  const actuals = Object.fromEntries(months.map((key) => [key, financeMonth({ fin: db.fin, coal: db.coal, ops: db.ops, fuelPrice: db.fin.settings.fuelPrice }, key).costs]));
  return { summary: monthSummary(db, base.month, now), trend: moneyTrend(db, base.month, now), actuals };
}

/** Finance: its own records, the requests, coal contracts and shipments for revenue, and the machines they name. */
export function financeView(db, now = Date.now()) {
  ensureBiz(db);
  return { ...frame(now), ...boardOf(db, now), fin: db.fin, coal: db.coal, ops: { equipment: db.ops.equipment } };
}

export function coalView(db, now = Date.now()) {
  ensureBiz(db);
  return { ...frame(now), summary: monthSummary(db, frame(now).month, now), coal: db.coal };
}

export function envView(db, now = Date.now()) {
  ensureBiz(db);
  return { ...frame(now), summary: monthSummary(db, frame(now).month, now), env: db.env };
}

/** The chief engineer's requests, the machines a write-off can name, and their book values. */
export function procureView(db, now = Date.now()) {
  ensureBiz(db);
  return { ...frame(now), fin: { capex: db.fin.capex, disposals: db.fin.disposals, assets: db.fin.assets }, ops: { equipment: db.ops.equipment } };
}

/** The director sees every page the MASTER does plus finance, coal and environment, read-only. */
export function execView(db, now = Date.now()) {
  ensureBiz(db);
  return { ...masterView(db, now), month: frame(now).month, ...boardOf(db, now), fin: db.fin, coal: db.coal, env: db.env, maintSum: maintSummary(db, now) };
}

/** An approved purchase becomes a fixed asset; parts and other items are booked as a cost instead. */
function acquire(db, item, me, now) {
  const amount = requestValue("capex", item);
  const today = localDay(now);
  if (Object.hasOwn(LIFE, item.kind)) {
    const name = `${item.title}${item.qty > 1 ? ` × ${item.qty}` : ""}`.slice(0, 100);
    const result = createRecord(db, "assets", { name, category: item.kind, cost: amount, acquired: today, life: LIFE[item.kind], salvage: Math.round(amount * 0.05), status: "active" }, { by: me.id, now });
    if (result.error) return result;
    item.asset = result.item.id;
    return { ok: true };
  }
  const result = createRecord(db, "costs", { date: today, category: "parts", amount, note: `Худалдан авалт: ${item.title}`.slice(0, 120) }, { by: me.id, now });
  if (result.error) return result;
  item.costRecord = result.item.id;
  return { ok: true };
}

/** An approved write-off retires the machine and its asset, keeping the book value it left at for the gain or loss. */
function dispose(db, item, now) {
  const machine = db.ops.equipment.find((entry) => entry.id === item.equipment);
  const asset = db.fin.assets.find((entry) => entry.equipment === item.equipment && entry.status === "active");
  const today = localDay(now);
  item.book = asset ? depreciation(asset, today.slice(0, 7)).book : 0;
  if (asset) Object.assign(asset, { status: "disposed", disposedOn: today, proceeds: item.value });
  if (machine) machine.status = "retired";
  if (db.ops.dispatch) delete db.ops.dispatch[item.equipment];
  return { ok: true };
}

/**
 * Finance's review or the director's final word on a purchase or write-off. Finance passes a request on to the
 * director or turns it down; the director approves or turns it down. Turning down needs a reason.
 */
export function decideRequest(db, name, id, { role, me, ok, note, now = Date.now() }) {
  if (!REQUEST_COLLECTIONS.includes(name)) return { error: "Хүсэлт олдсонгүй", status: 404 };
  ensureBiz(db);
  const item = db.fin[name].find((entry) => entry.id === id);
  if (!item) return { error: "Хүсэлт олдсонгүй", status: 404 };
  const stage = STAGE_OF[role];
  if (!stage) return { error: "Хүсэлтийг санхүү, захирал шийдвэрлэнэ", status: 403 };
  if (item.stage !== stage) {
    if (["approved", "rejected"].includes(item.stage)) return { error: "Хүсэлт аль хэдийн шийдвэрлэгдсэн", status: 409 };
    return { error: stage === "director" ? "Санхүү хянаагүй хүсэлт байна" : "Хүсэлт захиралд шилжсэн", status: 409 };
  }
  const text = String(note ?? "").replace(/\s+/g, " ").trim();
  if (text.length > NOTE_MAX || /[<>]/.test(text)) return { error: `Тайлбар ${NOTE_MAX}-аас ихгүй тэмдэгт, < > тэмдэггүй` };
  if (!ok && !text) return { error: "Татгалзсан шалтгаанаа бичнэ үү" };
  const final = ok && stage === "director";
  if (final) {
    const effect = name === "capex" ? acquire(db, item, me, now) : dispose(db, item, now);
    if (effect.error) return effect;
  }
  const at = new Date(now).toISOString();
  item.trail = [...(item.trail || []), { role, by: me.displayName || "", ok: Boolean(ok), note: text || null, at }];
  item.stage = !ok ? "rejected" : final ? "approved" : "director";
  if (item.stage !== "director") item.decidedAt = at;
  return { ok: true, item };
}

export function saveFinSettings(db, body) {
  ensureBiz(db);
  const price = Number(body?.fuelPrice);
  if (!Number.isFinite(price) || price < 100 || price > 20000) return { error: "Түлшний үнэ 100–20,000 ₮/л хооронд" };
  db.fin.settings.fuelPrice = Math.round(price);
  return { ok: true };
}

export function saveCoalSettings(db, body) {
  ensureBiz(db);
  const opening = Number(body?.opening);
  if (!Number.isFinite(opening) || opening < 0 || opening > 100_000_000) return { error: "Эхний үлдэгдэл 0–100,000,000 тонн хооронд" };
  db.coal.settings.opening = Math.round(opening);
  return { ok: true };
}

const ASSET_PRICE = { excavator: 7_500_000_000, truck: 4_200_000_000, dozer: 1_900_000_000, loader: 1_600_000_000, drill: 2_400_000_000, crane: 1_200_000_000, grader: 950_000_000, lv: 160_000_000, bus: 380_000_000 };
const BUYERS = [
  ["Хүннү Энержи ХХК", "BG-2026/014", 150000, 245000, 5500],
  ["Гоби Транс Трейд ХХК", "BG-2026/021", 90000, 232000, 5200],
  ["Дорнод Дулааны Станц ТӨК", "DS-2026/03", 50000, 98000, null],
];
const POINTS = { pm10: ["Хойд хил", "Бутлах цех", "Кэмп"], pm25: ["Кэмп"], noise: ["Хойд хил", "Кэмп"], ph: ["Ус зайлуулах цэг"], tss: ["Ус зайлуулах цэг"], water: ["Гүний худаг №2"] };
const RANGE = { pm10: [38, 112], pm25: [14, 54], noise: [52, 73], ph: [6.7, 8.3], tss: [12, 58], water: [880, 1460] };

/** Adds the finance, coal and environment demo data once, after the mine demo data exists; returns counts, or null. */
export function seedBiz(db, { now = Date.now(), random = Math.random } = {}) {
  if (!db.mineSeed || db.bizSeed?.version >= BIZ_SEED_VERSION) return null;
  ensureBiz(db);
  const engineer = (db.users || []).find((user) => user.role === ENGINEER_ROLE)?.id || "seed";
  const today = localDay(now);
  const month = today.slice(0, 7);
  const between = (min, max) => min + random() * (max - min);
  const whole = (min, max) => Math.round(between(min, max));
  let count = 0;
  const add = (name, body, by = "seed", when = now) => {
    const result = createRecord(db, name, body, { by, now: when });
    if (result.error) return null;
    count += 1;
    return result.item;
  };
  const fleet = db.ops.equipment.filter((item) => item.status !== "retired");
  fleet.forEach((machine, index) => {
    const cost = ASSET_PRICE[machine.type] || 500_000_000;
    add("assets", { name: `${machine.code} · ${machine.model || machine.type}`, category: ["lv", "bus"].includes(machine.type) ? "vehicle" : "equipment", equipment: machine.id, cost, acquired: addDays(today, -(220 + index * 97)), life: ["lv", "bus"].includes(machine.type) ? 5 : 8, salvage: Math.round(cost * 0.05), status: "active" });
    for (let week = 25; week >= 1; week -= 1) {
      const at = now - week * 7 * DAY_MS - index * 3600 * 1000;
      add("fuel", { equipment: machine.id, at: localInput(at), liters: whole(["lv", "bus"].includes(machine.type) ? 300 : 3200, ["lv", "bus"].includes(machine.type) ? 600 : 5000), hours: null }, "seed", at);
    }
  });
  add("assets", { name: "Шатахуун түгээх станц", category: "building", cost: 1_250_000_000, acquired: addDays(today, -900), life: 20, salvage: 0, status: "active" });
  const budgets = { fuel: 900_000_000, repair: 260_000_000, parts: 210_000_000, salary: 1_150_000_000, transport: 120_000_000, energy: 140_000_000, other: 50_000_000 };
  for (let back = 5; back >= 0; back -= 1) {
    const key = addMonth(month, -back);
    for (const [category, amount] of Object.entries(budgets)) add("budgets", { month: key, category, amount });
    const day = (n) => `${key}-${String(n).padStart(2, "0")}`;
    const last = back === 0 ? Number(today.slice(8)) : daysIn(key);
    const spend = [
      ["salary", 1_080_000_000, 1_140_000_000, 5, "Сарын цалин"],
      ["energy", 105_000_000, 150_000_000, 10, "Цахилгаан, дулаан"],
      ["repair", 70_000_000, 120_000_000, 8, "Хөдөлгүүрийн их засвар"],
      ["repair", 60_000_000, 140_000_000, 21, "Гидравлик системийн засвар"],
      ["parts", 80_000_000, 130_000_000, 12, "Дугуй, шүүлтүүр"],
      ["parts", 50_000_000, 110_000_000, 25, "Хувин, шүд"],
      ["transport", 70_000_000, 125_000_000, 18, "Ээлжийн тээвэр, ачаа"],
      ["other", 10_000_000, 45_000_000, 15, "Албан томилолт, бичиг хэрэг"],
    ];
    for (const [category, min, max, date, note] of spend) {
      if (date > last) continue;
      add("costs", { date: day(date), category, amount: whole(min, max), equipment: ["repair", "parts"].includes(category) && fleet.length ? fleet[whole(0, fleet.length - 1)].id : null, note });
    }
  }
  const sales = BUYERS.map(([buyer, contract, tonnes, price, minCv], index) => add("sales", { date: addDays(today, -170 + index * 20), buyer, contract, tonnes, price, minCv, status: "open" }));
  const labs = [];
  for (let back = 180; back >= 0; back -= 6) {
    const date = addDays(today, -back);
    const lab = add("labs", { date, sample: `S-${date.replace(/-/g, "").slice(2)}`, source: ["rom", "stock", "pit"][whole(0, 2)], cv: whole(5350, 6350), ash: Math.round(between(10, 21) * 100) / 100, moisture: Math.round(between(6, 11.5) * 100) / 100, sulfur: Math.round(between(0.4, 0.9) * 100) / 100, volatile: Math.round(between(26, 34) * 100) / 100 });
    if (lab) labs.push(lab);
  }
  for (let back = 168; back >= 0; back -= 1) {
    const date = addDays(today, -back);
    const lab = [...labs].reverse().find((item) => item.date <= date) || null;
    for (let truck = 0; truck < 9; truck += 1) {
      const at = Date.parse(`${date}T07:00:00+08:00`) + truck * 75 * 60 * 1000;
      if (at > now) break;
      const sale = sales[truck < 5 ? 0 : truck < 8 ? 1 : 2];
      if (!sale || sale.status !== "open" || date < sale.date) continue;
      const gross = Math.round(between(118, 128) * 100) / 100;
      add("shipments", { at: localInput(at), sale: sale.id, vehicle: `${whole(1000, 9999)} УБ${"АБВГДЕ"[whole(0, 5)]}`, gross, tare: Math.round(between(38, 42) * 100) / 100, lab: lab && (!sale.minCv || lab.cv >= sale.minCv) ? lab.id : null }, "seed", at);
    }
  }
  db.coal.settings.opening = 180_000;
  for (let back = 27; back >= 0; back -= 1) {
    for (const [metric, points] of Object.entries(POINTS)) {
      for (const point of points) {
        if (metric !== "pm10" && back % 2) continue;
        const at = Date.parse(`${addDays(today, -back)}T11:00:00+08:00`);
        if (at > now) continue;
        const [min, max] = RANGE[metric];
        add("envReadings", { at: localInput(at), point, metric, value: Math.round(between(min, max) * 100) / 100 }, "seed", at);
      }
    }
  }
  add("rehab", { name: "Хойд овоолго №1", stage: "technical", planned: 42.5, done: 30.2, due: addDays(today, 120), cost: 680_000_000 });
  add("rehab", { name: "Баруун овоолго", stage: "biological", planned: 28, done: 21.4, due: addDays(today, 200), cost: 410_000_000 });
  add("rehab", { name: "Зүүн далан", stage: "handed", planned: 15, done: 15, due: addDays(today, -60), cost: 230_000_000 });
  add("rehab", { name: "Хуучин тээврийн зам", stage: "planned", planned: 6.4, done: 0, due: addDays(today, 300) });
  add("envAudits", { date: addDays(today, -12), agency: "Мэргэжлийн хяналтын байгууллага", finding: "Бутлах цехийн орчимд тоосжилт зөвшөөрөгдөх хэмжээнээс давсан. Ус шүрших систем бүрэн ажиллаагүй.", action: "Ус шүрших 2 цэг нэмж суурилуулах", due: addDays(today, 18), status: "open" });
  add("envAudits", { date: addDays(today, -75), agency: "Аймгийн Байгаль орчны газар", finding: "Нөхөн сэргээлтийн тайлан хугацаандаа ирүүлээгүй.", action: "Жилийн тайланг хүргүүлэх", due: addDays(today, -60), status: "done" });
  const finance = { id: "seed", displayName: "Санхүүгийн алба" };
  const director = { id: "seed", displayName: "Гүйцэтгэх захирал" };
  const request = (body, when) => add("capex", body, engineer, now - when * DAY_MS);
  const tyres = request({ kind: "part", title: "Самосвалын дугуй 40.00R57", qty: 6, price: 95_000_000, vendor: "Майнинг Тайр ХХК", needBy: addDays(today, -10), reason: "TR-02, TR-04-ийн дугуй элэгдлийн хязгаартаа хүрсэн." }, 24);
  if (tyres) {
    decideRequest(db, "capex", tyres.id, { role: FINANCE_ROLE, me: finance, ok: true, note: "Сэлбэгийн төсөвт багтана", now: now - 22 * DAY_MS });
    decideRequest(db, "capex", tyres.id, { role: DIRECTOR_ROLE, me: director, ok: true, note: null, now: now - 21 * DAY_MS });
  }
  const light = request({ kind: "vehicle", title: "Toyota Land Cruiser 79", qty: 2, price: 210_000_000, vendor: "Тоёота Монголия", reason: "Ээлжийн ахлагч нарын талбайн хяналтад." }, 15);
  if (light) decideRequest(db, "capex", light.id, { role: FINANCE_ROLE, me: finance, ok: false, note: "Энэ улиралд тээврийн төсөв хүрэлцэхгүй, 2027 онд дахин авч үзнэ.", now: now - 13 * DAY_MS });
  const bits = request({ kind: "tool", title: "Өрмийн хошуу, коронка (Ø251 мм)", qty: 40, price: 2_400_000, vendor: "Дрилл Сервис ХХК", needBy: addDays(today, 14), reason: "Өрмийн машины хошууны нөөц 5 ширхэг үлдсэн." }, 4);
  if (bits) decideRequest(db, "capex", bits.id, { role: FINANCE_ROLE, me: finance, ok: true, note: "Үнийн санал 3 нийлүүлэгчээс авч харьцуулсан.", now: now - 2 * DAY_MS });
  request({ kind: "equipment", title: "CAT 793F самосвал", qty: 1, price: 4_350_000_000, vendor: "Барловорлд Монголия", needBy: addDays(today, 90), reason: "Хөрс хуулалтын төлөвлөгөө 2027 онд 18%-иар өснө; одоогийн 9 самосвал хүрэлцэхгүй." }, 1);
  const old = fleet.find((item) => item.type === "bus") || fleet.find((item) => item.type === "lv");
  if (old) add("disposals", { equipment: old.id, method: "sell", value: 45_000_000, reason: "Ашиглалтын хугацаа дууссан, засварын зардал жилд 30 сая ₮ давсан." }, engineer, now - DAY_MS);
  db.bizSeed = { version: BIZ_SEED_VERSION, at: new Date(now).toISOString(), records: count };
  return { records: count };
}
