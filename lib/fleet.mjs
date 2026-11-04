// The fleet control centre for the chief mining engineer: the master's equipment records plus truck dispatch and repair orders.
import { createRecord, ensureMine } from "./mine.mjs";
import { maintSummary } from "./maint.mjs";
import { workforceOf } from "./workforce.mjs";
import { CRITICAL_ITEMS, PRESTART_LABELS, WO_KINDS, coalByType, currentShift, localDay, localInput, prestartFails, serviceDue } from "../public/js/minecore.js";
import { planFleet } from "../public/js/fleetcore.js";
import { addDays, shiftDateOf } from "../public/js/workstats.js";

export const ENGINEER_ROLE = "engineer";
export const FLEET_ROLES = [ENGINEER_ROLE, "master"];
export const FLEET_SEED_VERSION = 1;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

const EXTRA_FLEET = [
  ["EX-03", "excavator", "Liebherr R9800"],
  ["TR-06", "truck", "CAT 793F"],
  ["TR-07", "truck", "CAT 793F"],
  ["TR-08", "truck", "Komatsu 830E"],
  ["TR-09", "truck", "Komatsu 830E"],
];

const DIGGERS = ["excavator", "loader"];
const idle = (machine) => ["down", "service"].includes(machine.status);

/** Adds the overburden fleet once, after the mine demo data exists; returns how many machines it added, or null. */
export function seedFleet(db, now = Date.now()) {
  if (!db.mineSeed || db.fleetSeed?.version >= FLEET_SEED_VERSION) return null;
  ensureMine(db);
  let added = 0;
  EXTRA_FLEET.forEach(([code, type, model], index) => {
    if (db.ops.equipment.some((item) => item.code === code)) return;
    const hours = 4000 + index * 1730;
    const result = createRecord(db, "equipment", { code, type, model, hours, serviceEvery: 250, lastService: hours - 60 - index * 35, status: "ready" }, { by: "seed", now });
    if (result.error) return;
    added += 1;
    for (let back = 2; back >= 0; back -= 1) {
      createRecord(db, "fuel", { equipment: result.item.id, at: localInput(now - back * DAY_MS - (2 + index) * HOUR_MS), liters: type === "truck" ? 1400 + index * 40 : 3000, hours: null }, { by: "seed", now });
    }
  });
  db.fleetSeed = { version: FLEET_SEED_VERSION, at: new Date(now).toISOString(), added };
  return { added };
}

const records = (db, area, name) => db[area]?.[name] || [];
/** Machines still in the fleet; written-off ones stay in the records but leave the control centre. */
const fleetOf = (db) => db.ops.equipment.filter((item) => item.status !== "retired");

/** Dispatcher choices that still point at a working truck and a digger with a face. */
function liveDispatch(db) {
  const equipment = fleetOf(db);
  const faced = new Set(planFleet(equipment).diggers.map((item) => item.machine.id));
  return Object.fromEntries(Object.entries(db.ops.dispatch || {}).filter(([truck, digger]) => equipment.some((item) => item.id === truck && item.type === "truck") && faced.has(digger)));
}

export function fleetView(db, now = Date.now()) {
  ensureMine(db);
  const today = localDay(now);
  const shiftDate = shiftDateOf(now);
  const shift = currentShift(now);
  const names = new Map((db.users || []).map((user) => [user.id, user.displayName]));
  const assigns = db.ops.assigns.filter((item) => item.date === shiftDate && item.shift === shift);
  const prestarts = db.ops.prestarts.filter((item) => item.date === shiftDate && item.shift === shift);
  const equipment = fleetOf(db).map((item) => {
    const assign = assigns.find((row) => row.equipment === item.id);
    const check = prestarts.filter((row) => row.equipment === item.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
    const fails = check ? prestartFails(check) : [];
    const fuel = db.ops.fuel.filter((row) => row.equipment === item.id).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    return {
      id: item.id,
      code: item.code,
      type: item.type,
      model: item.model || "",
      status: item.status,
      hours: item.hours || 0,
      service: serviceDue(item),
      operator: assign ? { id: assign.operator, name: names.get(assign.operator) || "–" } : null,
      prestart: check ? { fails: fails.map((key) => PRESTART_LABELS[key]), critical: fails.some((key) => CRITICAL_ITEMS.includes(key)) } : null,
      orders: db.ops.workorders
        .filter((row) => row.equipment === item.id && row.status !== "done")
        .map(({ id, title, kind, priority, status, opened }) => ({ id, title, kind, priority, status, opened })),
      fuel: fuel ? { at: fuel.at, liters: fuel.liters } : null,
    };
  });
  const workforce = workforceOf(db, now);
  const incidents = db.hse?.incidents || [];
  const handovers = records(db, "ops", "handovers");
  return {
    now: new Date(now).toISOString(),
    today,
    shiftDate,
    shift,
    planTonnes: db.ops.planTonnes,
    equipment,
    dispatch: liveDispatch(db),
    personnel: { day: workforce.today.day, night: workforce.today.night, off: workforce.today.off + workforce.today.leave, onSite: workforce.onSite, total: workforce.total },
    departments: workforce.departments.filter((dept) => dept.name !== "Хэлтэсгүй"),
    workforce,
    maintenance: maintSummary(db, now),
    coal: {
      shift: coalByType(handovers, shiftDate, shiftDate),
      week: coalByType(handovers, addDays(shiftDate, -6), shiftDate),
      month: coalByType(handovers, `${shiftDate.slice(0, 8)}01`, shiftDate),
    },
    incidents: { today: incidents.filter((item) => localDay(Date.parse(item.at)) === today).length, open: incidents.filter((item) => item.status !== "closed").length },
  };
}

/** Sends a truck to a digger; no digger puts it back under automatic dispatch. */
export function setDispatch(db, truckId, diggerId) {
  ensureMine(db);
  const fleet = fleetOf(db);
  const truck = fleet.find((item) => item.id === truckId && item.type === "truck");
  if (!truck) return { error: "Самосвал олдсонгүй", status: 404 };
  const dispatch = { ...(db.ops.dispatch || {}) };
  if (!diggerId) {
    delete dispatch[truckId];
    db.ops.dispatch = dispatch;
    return { ok: true };
  }
  const digger = fleet.find((item) => item.id === diggerId && DIGGERS.includes(item.type));
  if (!digger) return { error: "Экскаватор олдсонгүй", status: 404 };
  if (idle(digger)) return { error: `${digger.code} засварт байгаа тул чиглүүлэх боломжгүй` };
  if (!planFleet(fleet).diggers.some((item) => item.machine.id === digger.id)) return { error: `${digger.code}-д ажлын талбай оноогоогүй` };
  dispatch[truckId] = digger.id;
  db.ops.dispatch = dispatch;
  return { ok: true };
}

/** A repair order from the control centre; the machine's status follows it as on the master's board. */
export function fleetWorkorder(db, body, by, now = Date.now()) {
  ensureMine(db);
  const machine = fleetOf(db).find((item) => item.id === body?.equipment);
  if (!machine) return { error: "Техник олдсонгүй", status: 404 };
  return createRecord(
    db,
    "workorders",
    { equipment: machine.id, kind: Object.hasOwn(WO_KINDS, body.kind) ? body.kind : "breakdown", title: body.title, description: body.description || null, priority: body.priority || "medium", mechanic: null, status: "open" },
    { by, now },
  );
}
