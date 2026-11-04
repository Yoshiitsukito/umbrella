// The maintenance master's board: hour-meter readings, planned service that opens itself at the interval, and
// machines pulled off work by a breakdown. The control centre shows the same summary.
import { randomBytes } from "node:crypto";
import { createRecord, ensureMine, mineUsers } from "./mine.mjs";
import { COAL_TYPES, EQUIP_TYPES, PRIORITIES, SERVICE_SOON_HOURS as SOON_HOURS, WO_KINDS, WO_STATUS, currentShift, localDay, localInput, serviceDue } from "../public/js/minecore.js";
import { shiftDateOf } from "../public/js/workstats.js";

export const MAINT_ROLE = "maint";
export const MAINT_COLLECTIONS = ["meters", "workorders", "equipment"];
export const MAINT_SEED_VERSION = 1;
const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SEED_DAYS = 30;
const DAILY_HOURS = { truck: 19, excavator: 18, loader: 16, dozer: 14, drill: 13, grader: 11, crane: 6, lv: 8, bus: 6 };

const fleetOf = (db) => db.ops.equipment.filter((item) => item.status !== "retired");

/** Machines in planned and unplanned repair, those nearing service, and the last 30 days of repairs. */
export function maintSummary(db, now = Date.now()) {
  ensureMine(db);
  const fleet = fleetOf(db);
  const names = new Map((db.users || []).map((user) => [user.id, user.displayName]));
  const open = db.ops.workorders.filter((order) => order.status !== "done");
  const latest = new Map();
  for (const reading of db.maint.meters) if (!latest.has(reading.equipment) || reading.at > latest.get(reading.equipment).at) latest.set(reading.equipment, reading);
  const row = (machine, order) => ({
    id: machine.id,
    code: machine.code,
    type: machine.type,
    model: machine.model || "",
    status: machine.status,
    hours: machine.hours || 0,
    serviceEvery: machine.serviceEvery,
    service: serviceDue(machine),
    meter: latest.has(machine.id) ? { at: latest.get(machine.id).at, hours: latest.get(machine.id).hours } : null,
    order: order
      ? { id: order.id, title: order.title, priority: order.priority, status: order.status, opened: order.opened, mechanic: names.get(order.mechanic) || null, auto: order.by === "system", hours: Math.max(0, Math.round(((now - Date.parse(order.opened)) / HOUR_MS) * 10) / 10) }
      : null,
  });
  const inRepair = (kind) =>
    fleet
      .flatMap((machine) => {
        const order = open.filter((item) => item.equipment === machine.id && item.kind === kind).sort((a, b) => a.opened.localeCompare(b.opened))[0];
        return order ? [row(machine, order)] : [];
      })
      .sort((a, b) => b.order.hours - a.order.hours);
  const unplanned = inRepair("breakdown");
  const planned = inRepair("planned");
  const busy = new Set([...planned, ...unplanned].map((item) => item.id));
  const soon = fleet
    .filter((machine) => !busy.has(machine.id) && serviceDue(machine).left <= SOON_HOURS)
    .map((machine) => row(machine))
    .sort((a, b) => a.service.left - b.service.left);
  const since = now - SEED_DAYS * DAY_MS;
  const recent = db.ops.workorders.filter((order) => Date.parse(order.opened) >= since || (order.closed && Date.parse(order.closed) >= since));
  const spent = (order) => (Math.min(order.closed ? Date.parse(order.closed) : now, now) - Math.max(Date.parse(order.opened), since)) / HOUR_MS;
  const stale = fleet.filter((machine) => !latest.has(machine.id) || now - Date.parse(latest.get(machine.id).at) > 2 * DAY_MS).length;
  return {
    counts: {
      total: fleet.length,
      ready: fleet.filter((item) => !["down", "service"].includes(item.status)).length,
      service: fleet.filter((item) => item.status === "service").length,
      down: fleet.filter((item) => item.status === "down").length,
      soon: soon.length,
      stale,
    },
    unplanned,
    planned,
    soon,
    month: {
      planned: recent.filter((order) => order.kind === "planned" && order.status === "done").length,
      breakdowns: recent.filter((order) => order.kind === "breakdown").length,
      downHours: Math.round(recent.filter((order) => order.kind === "breakdown").reduce((sum, order) => sum + Math.max(0, spent(order)), 0)),
    },
  };
}

/** What the maintenance master reads: the fleet, its work orders, hour-meter readings and the board summary. */
export function maintView(db, now = Date.now()) {
  ensureMine(db);
  return {
    now: new Date(now).toISOString(),
    today: localDay(now),
    shiftDate: shiftDateOf(now),
    shift: currentShift(now),
    users: mineUsers(db).map((user) => ({ id: user.id, displayName: user.displayName, title: user.title || "", role: user.role, card: { idNumber: "", status: user.card?.status || "", clearance: user.card?.clearance || 1, restUntil: null } })),
    ops: { equipment: db.ops.equipment, workorders: db.ops.workorders, posts: db.ops.posts, depts: db.ops.depts },
    maint: db.maint,
    maintSum: maintSummary(db, now),
    labels: { equip: EQUIP_TYPES, kinds: WO_KINDS, status: WO_STATUS, priority: PRIORITIES },
  };
}

/** Deterministic 0–1 noise so the demo looks the same on every start. */
const noise = (seed) => {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Demo data once the mine demo exists: a month of daily hour-meter readings per machine ending at today's hours,
 * the finished planned service behind each machine's last-service reading, and a coal-type split of shift reports
 * that only carry a total. Returns what it added, or null.
 */
export function seedMaint(db, now = Date.now()) {
  if (!db.mineSeed || db.maintSeed?.version >= MAINT_SEED_VERSION) return null;
  ensureMine(db);
  let readings = 0;
  fleetOf(db).forEach((machine, index) => {
    if (db.maint.meters.some((item) => item.equipment === machine.id)) return;
    const daily = (DAILY_HOURS[machine.type] || 10) * (machine.status === "down" ? 0.6 : 1);
    let hours = machine.hours || 0;
    const series = [];
    for (let back = 0; back < SEED_DAYS && hours > 0; back += 1) {
      series.push({ back, hours: Math.round(hours * 10) / 10 });
      hours -= daily * (0.75 + noise(index * 97 + back) * 0.4);
    }
    for (const { back, hours: value } of series.reverse()) {
      const at = localInput(now - back * DAY_MS - (1 + (index % 3)) * HOUR_MS);
      const result = createRecord(db, "meters", { equipment: machine.id, at, hours: value, note: back === 0 ? "Ээлжийн заалт" : null }, { by: "seed", now });
      if (!result.error) readings += 1;
    }
  });
  let services = 0;
  for (const machine of fleetOf(db)) {
    const daily = DAILY_HOURS[machine.type] || 10;
    const since = (machine.hours || 0) - (machine.lastService || 0);
    const back = (since / daily) * DAY_MS;
    if (since < 0 || back > SEED_DAYS * DAY_MS || db.ops.workorders.some((order) => order.equipment === machine.id && order.kind === "planned" && order.status === "done")) continue;
    const closed = now - back;
    const opened = closed - (5 + (services % 4)) * HOUR_MS;
    db.ops.workorders.push({
      id: `wo_${randomBytes(6).toString("hex")}`,
      equipment: machine.id,
      kind: "planned",
      title: `Төлөвлөгөөт засвар · ${machine.serviceEvery} мото цагийн`,
      description: `Мото цагийн заалт ${machine.lastService}: давтамжид хүрч автоматаар нээгдсэн.`,
      priority: "medium",
      mechanic: null,
      status: "done",
      by: "system",
      createdAt: new Date(opened).toISOString(),
      opened: new Date(opened).toISOString(),
      closed: new Date(closed).toISOString(),
    });
    services += 1;
  }
  let split = 0;
  db.ops.handovers.forEach((item, index) => {
    const total = Number(item.tonnes) || 0;
    if (total <= 0 || Object.keys(COAL_TYPES).some((key) => Number(item[key]) > 0)) return;
    item.coking = Math.round(total * (0.35 + noise(index + 7) * 0.1));
    item.thermal = Math.round(total * (0.45 + noise(index + 31) * 0.08));
    item.oxidized = Math.max(0, total - item.coking - item.thermal);
    split += 1;
  });
  db.maintSeed = { version: MAINT_SEED_VERSION, at: new Date(now).toISOString(), readings, services, split };
  return { readings, services, split };
}
