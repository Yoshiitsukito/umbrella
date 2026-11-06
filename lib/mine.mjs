// Mine-site records for the MASTER role (safety, competency, operations), the camp manager (camp), security
// (violations, which the MASTER's HSE page decides on), finance with the chief engineer's purchase and write-off
// requests, the shipment manager (coal quality, contracts, weighbridge) and the environment manager.
// Records are checked against the shared schema in public/js/minecore.js; side effects between them
// (stock, machine status, work orders) live in the hooks below, and timed alerts in mineTick().
import { randomBytes } from "node:crypto";
import { CARD_QR_PREFIX, STAFF_ROLES, findByCardQr } from "./auth.mjs";
import { personalKey, personalOf, pushNotice } from "./personal.mjs";
import { enqueue } from "./whiteking.mjs";
import {
  ALCOHOL_LIMIT,
  AREAS,
  BLAST_CLEAR_MIN,
  BLAST_WARN_MIN,
  BUDGET_CATS,
  CAMERA_KINDS,
  CAMERA_URL_KINDS,
  CERT_TYPES,
  COAL_TYPES,
  COLLECTIONS,
  CRITICAL_ITEMS,
  DEFAULT_RULES,
  EQUIP_CERT,
  EQUIP_TYPES,
  INCIDENT_KINDS,
  PERMIT_TYPES,
  PRESTART_LABELS,
  SALE_STATUS,
  VIOLATION_KINDS,
  WX_METRICS,
  allocateBeds,
  cleanRecord,
  currentShift,
  expiryState,
  fatigueOf,
  holdReasons,
  localDay,
  localInput,
  mineKpis,
  prestartFails,
  serviceDue,
  validCert,
  visitorReady,
  wxTriggered,
  wxValue,
} from "../public/js/minecore.js";
import { addDays, leaveOn, plannedKind, sessionsOf, shiftDateOf } from "../public/js/workstats.js";
import { saleProgress } from "../public/js/bizcore.js";

export const MASTER_ROLE = "master";
export const HSE_ROLE = "hsemgr";
export const VISITOR_QR_PREFIX = "UMBV:";
const PHOTOS = "hsePhotos";
const PHOTO_KEEP = 40;
const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const LONE_GRACE_MS = 5 * MIN_MS;
const KEEP_MUSTERS = 20;
const KEEP_SOS = 200;
const KEEP_LONE = 200;
const KEEP_WX_EVENTS = 100;
const WEATHER_STALE_MS = 3 * HOUR_MS;
/** Checked in for longer than this means a missed check-out, not a long shift. */
const STALE_PRESENCE_MS = 20 * HOUR_MS;

const newId = (prefix) => `${prefix}_${randomBytes(6).toString("hex")}`;
const recordsOf = (db, name) => db[COLLECTIONS[name].area][name];
const nameOf = (db, uid) => db.users?.find((user) => user.id === uid)?.displayName || "Тодорхойгүй";
const dotDate = (date) => date.slice(5).replace("-", ".");
const clock = (ms) => localInput(ms).slice(11, 16);

export function ensureMine(db) {
  for (const area of AREAS) if (!db[area] || typeof db[area] !== "object" || Array.isArray(db[area])) db[area] = {};
  for (const [name, schema] of Object.entries(COLLECTIONS)) if (!Array.isArray(db[schema.area][name])) db[schema.area][name] = [];
  for (const key of ["musters", "sos", "lone", "wxEvents"]) if (!Array.isArray(db.hse[key])) db.hse[key] = [];
  db.skills.rules = { ...DEFAULT_RULES, ...(db.skills.rules || {}) };
  db.skills.reminded ||= {};
  db.ops.planTonnes ??= 12000;
  db.camp.beds ||= {};
  db[PHOTOS] ||= {};
}

/** People mine records may point at: shift staff, masters and HSE managers. */
export function mineUsers(db) {
  return (db.users || []).filter((user) => STAFF_ROLES.includes(user.role) || user.role === MASTER_ROLE || user.role === HSE_ROLE);
}

const staffOf = (db) => (db.users || []).filter((user) => STAFF_ROLES.includes(user.role));

function contextFor(db, name, id) {
  const ids = new Set(mineUsers(db).map((user) => user.id));
  return {
    user: (uid) => ids.has(uid),
    ref: (collection, ref) => recordsOf(db, collection).some((item) => item.id === ref),
    others: recordsOf(db, name).filter((item) => item.id !== id),
  };
}

function trim(db, name) {
  const { keep } = COLLECTIONS[name];
  const list = recordsOf(db, name);
  if (list.length > keep) list.splice(0, list.length - keep);
}

const PHOTO_COLLECTIONS = ["incidents", "violations"];

function prunePhotos(db) {
  const photos = db[PHOTOS];
  const owners = PHOTO_COLLECTIONS.flatMap((name) => recordsOf(db, name));
  const live = new Set(owners.map((item) => item.id));
  for (const id of Object.keys(photos)) if (!live.has(id)) delete photos[id];
  const ids = Object.keys(photos);
  for (const id of ids.slice(0, Math.max(0, ids.length - PHOTO_KEEP))) {
    delete photos[id];
    const owner = owners.find((item) => item.id === id);
    if (owner) owner.photo = null;
  }
}

/** Moves a photo out of the record (one Firestore document holds all of them, capped). */
function storePhoto(db, item, previous) {
  if (typeof item.photo === "string") {
    db[PHOTOS][item.id] = item.photo;
    item.photo = true;
  } else if (item.photo === undefined) item.photo = previous?.photo || null;
  else if (!item.photo) delete db[PHOTOS][item.id];
}

export function photoOf(db, id) {
  return db[PHOTOS]?.[id] || null;
}

const equipmentOf = (db, id) => recordsOf(db, "equipment").find((item) => item.id === id) || null;

/** Latest sleep within two days and hours already on shift, as fitness for duty. */
export function fatigueFor(db, uid, now) {
  const record = db[personalKey(uid)];
  const today = localDay(now);
  const date = Object.keys(record?.days || {})
    .filter((key) => key <= today && key >= addDays(today, -1) && record.days[key].sleep)
    .sort()
    .at(-1);
  const sleepMin = date ? record.days[date].sleep.min : null;
  const presence = db.attendance?.people?.[uid];
  const inFor = presence?.state === "in" && presence.since ? now - Date.parse(presence.since) : 0;
  const onShiftMs = inFor < STALE_PRESENCE_MS ? inFor : 0;
  return { ...fatigueOf({ sleepMin, onShiftMs }), sleepMin, sleepDate: date || null, onShiftMs };
}

function holdsOf(db, uid, now) {
  const { certs, medicals } = db.skills;
  return holdReasons({ uid, certs, medicals, alcohol: db.hse.alcohol, rules: db.skills.rules, today: localDay(now), now });
}

/** Reasons a scanned card must be refused, or null; only shift staff, only while the rule is on. */
export function mineHold(db, person, now = Date.now()) {
  if (!person || !STAFF_ROLES.includes(person.role) || !db.skills?.rules?.enforce) return null;
  const reasons = holdsOf(db, person.id, now);
  return reasons.length ? reasons : null;
}

/** What stops a person from running a machine on a shift: licence, card hold, fatigue. */
export function operatorProblems(db, uid, equipment, date, now) {
  const problems = [];
  const need = EQUIP_CERT[equipment.type];
  if (need && !validCert(db.skills.certs, uid, need, date)) problems.push(`${CERT_TYPES[need]} үнэмлэх хүчингүй`);
  problems.push(...holdsOf(db, uid, now));
  if (date === shiftDateOf(now)) {
    const fatigue = fatigueFor(db, uid, now);
    if (fatigue.state === "unfit") problems.push(`Ядаргаа: ${fatigue.reasons.join(", ")}`);
  }
  return problems;
}

function announce(db, text, label, now) {
  if (db.whiteking) enqueue(db.whiteking, text, label, "mine", now);
}

function notifyUsers(db, uids, text, now, level = "normal") {
  for (const uid of new Set(uids)) if (db.users.some((user) => user.id === uid)) pushNotice(personalOf(db, uid), "hse", text, now, level);
}

/** Tells every HSE manager, except the one who just recorded it. */
function notifyHse(db, text, by, now) {
  notifyUsers(db, (db.users || []).filter((user) => user.role === HSE_ROLE && user.id !== by).map((user) => user.id), text, now);
}

function onSiteStaff(db) {
  const people = db.attendance?.people || {};
  return staffOf(db).filter((user) => people[user.id]?.state === "in").map((user) => user.id);
}

const BEFORE = {
  permits(db, item) {
    if (Date.parse(item.to) <= Date.parse(item.from)) return "Дуусах цаг эхлэхээс хойш байна";
    if (Date.parse(item.to) - Date.parse(item.from) > DAY_MS) return "Зөвшөөрөл 24 цагаас урт байж болохгүй";
    if (item.status === "active" && (!item.issuerSign || !item.holderSign)) return "Идэвхжүүлэхэд олгогч, хүлээн авагч хоёулаа гарын үсэг зурна";
    return null;
  },
  visitors(db, item) {
    return item.to < item.from ? "Дуусах огноо эхлэхээс өмнө байна" : null;
  },
  blasts(db, item, previous, now) {
    if (item.blaster && !validCert(db.skills.certs, item.blaster, "blaster", localDay(Date.parse(item.at)))) return `${nameOf(db, item.blaster)}: тэсэлгээчний үнэмлэх хүчингүй`;
    if (!previous && item.status === "planned" && Date.parse(item.at) < now) return "Тэсэлгээний цаг өнгөрсөн байна";
    return null;
  },
  assigns(db, item, previous, now) {
    const machine = equipmentOf(db, item.equipment);
    if (machine.status === "retired") return `${machine.code} актлагдсан техник`;
    if (["down", "service"].includes(machine.status)) return `${machine.code} засварт байгаа тул хуваарилах боломжгүй`;
    const same = recordsOf(db, "assigns").filter((other) => other.id !== item.id && other.date === item.date && other.shift === item.shift);
    if (same.some((other) => other.equipment === item.equipment)) return `${machine.code} энэ ээлжид өөр хүнд хуваарилагдсан`;
    if (same.some((other) => other.operator === item.operator)) return `${nameOf(db, item.operator)} энэ ээлжид өөр техникт хуваарилагдсан`;
    const problems = operatorProblems(db, item.operator, machine, item.date, now);
    return problems.length ? `${nameOf(db, item.operator)}: ${problems.join("; ")}` : null;
  },
  moves(db, item) {
    const stock = recordsOf(db, "stock").find((entry) => entry.id === item.stock);
    if (item.kind === "out" && stock.qty < item.qty) return `${stock.name}: үлдэгдэл ${stock.qty} ${stock.unit || ""} хүрэлцэхгүй`;
    return null;
  },
  cameras(db, item) {
    return CAMERA_URL_KINDS.includes(item.kind) && !item.url ? `${CAMERA_KINDS[item.kind]}: урсгалын хаягаа оруулна уу` : null;
  },
  violations(db, item, previous, now) {
    if (previous && (previous.hseStatus || "new") !== "new") return "ХАБЭА шийдвэрлэж эхэлсэн зөрчлийг засах боломжгүй";
    if (item.party === "staff" && !item.uid) return "Ажилтнаа сонгоно уу";
    if (item.party !== "staff" && !item.person) return "Зөрчил гаргасан хүний нэрийг бичнэ үү";
    if (Date.parse(item.at) > now + 10 * MIN_MS) return "Зөрчлийн цаг ирээдүйд байж болохгүй";
    return null;
  },
  capex(db, item, previous) {
    return previous && previous.stage !== "finance" ? "Санхүү хянасан хүсэлтийг засах боломжгүй" : null;
  },
  disposals(db, item, previous) {
    if (previous && previous.stage !== "finance") return "Санхүү хянасан хүсэлтийг засах боломжгүй";
    const machine = equipmentOf(db, item.equipment);
    if (machine.status === "retired") return `${machine.code} аль хэдийн актлагдсан`;
    const open = recordsOf(db, "disposals").some((other) => other.id !== item.id && other.equipment === item.equipment && ["finance", "director"].includes(other.stage));
    return open ? `${machine.code}-ийн өөр хүсэлт шийдвэрлэгдээгүй байна` : null;
  },
  assets(db, item) {
    return item.salvage > item.cost ? "Үлдэх өртөг анхны өртгөөс их байж болохгүй" : null;
  },
  budgets(db, item) {
    const same = recordsOf(db, "budgets").some((other) => other.id !== item.id && other.month === item.month && other.category === item.category);
    return same ? `${item.month}-ийн «${BUDGET_CATS[item.category]}» төсөв бүртгэлтэй байна` : null;
  },
  shipments(db, item, previous, now) {
    if (item.tare >= item.gross) return "Бохир жин хоосон жингээс их байх ёстой";
    if (Date.parse(item.at) > now + 10 * MIN_MS) return "Ачилтын цаг ирээдүйд байж болохгүй";
    const sale = recordsOf(db, "sales").find((entry) => entry.id === item.sale);
    if (sale.status !== "open" && previous?.sale !== item.sale) return `«${sale.buyer}» гэрээ ${SALE_STATUS[sale.status].toLowerCase()} байна`;
    const lab = item.lab ? recordsOf(db, "labs").find((entry) => entry.id === item.lab) : null;
    if (lab && sale.minCv && lab.cv < sale.minCv) return `Дээж ${lab.sample}: илчлэг ${lab.cv} нь гэрээний доод хэмжээ ${sale.minCv} ккал/кг-аас бага`;
    return null;
  },
  rehab(db, item) {
    return item.done > item.planned ? "Гүйцэтгэл төлөвлөсөн талбайгаас их байж болохгүй" : null;
  },
  handovers(db, item) {
    const split = Object.keys(COAL_TYPES).reduce((sum, key) => sum + (item[key] || 0), 0);
    if (split > 0) item.tonnes = split;
    return null;
  },
  meters(db, item, previous, now) {
    const machine = equipmentOf(db, item.equipment);
    if (machine.status === "retired") return `${machine.code} актлагдсан техник`;
    const at = Date.parse(item.at);
    if (at > now + 10 * MIN_MS) return "Заалтын цаг ирээдүйд байж болохгүй";
    const others = recordsOf(db, "meters").filter((other) => other.id !== item.id && other.equipment === item.equipment);
    const before = others.filter((other) => Date.parse(other.at) <= at).sort((a, b) => b.at.localeCompare(a.at))[0];
    const after = others.filter((other) => Date.parse(other.at) > at).sort((a, b) => a.at.localeCompare(b.at))[0];
    if (before && item.hours < before.hours) return `${machine.code}: заалт өмнөх ${before.hours} мото цагаас бага байж болохгүй`;
    if (after && item.hours > after.hours) return `${machine.code}: заалт дараагийн ${after.hours} мото цагаас их байж болохгүй`;
    const ran = (from, to, gain) => gain > (to - from) / HOUR_MS + 1;
    if (before && ran(Date.parse(before.at), at, item.hours - before.hours)) return `${machine.code}: ${Math.round((at - Date.parse(before.at)) / HOUR_MS)} цагийн дотор ${Math.round((item.hours - before.hours) * 10) / 10} мото цаг нэмэгдэх боломжгүй`;
    if (after && ran(at, Date.parse(after.at), after.hours - item.hours)) return `${machine.code}: дараагийн заалттай зөрж байна`;
    return null;
  },
};

function openWorkorder(db, machine, title, description, by, now, { kind = "breakdown", priority = "high" } = {}) {
  const order = { id: newId("wo"), equipment: machine.id, kind, title, description, priority, mechanic: null, status: "open", by, createdAt: new Date(now).toISOString(), opened: new Date(now).toISOString(), closed: null };
  recordsOf(db, "workorders").push(order);
  trim(db, "workorders");
  return order;
}

/**
 * Sends a machine whose hour meter has reached its service interval into planned service: opens the planned work
 * order (once) and takes the machine off work and dispatch until the order is done. Returns the order, or null.
 */
export function planService(db, machine, now = Date.now()) {
  if (!machine || machine.status === "retired" || !serviceDue(machine).due) return null;
  if (recordsOf(db, "workorders").some((order) => order.equipment === machine.id && order.kind === "planned" && order.status !== "done")) return null;
  const used = Math.round((machine.hours || 0) - (machine.lastService || 0));
  const order = openWorkorder(db, machine, `Төлөвлөгөөт засвар · ${machine.serviceEvery} мото цагийн`, `Мото цагийн заалт ${machine.hours}: сүүлийн засвараас хойш ${used} ц ажилласан (давтамж ${machine.serviceEvery} ц). Автоматаар нээгдсэн.`, "system", now, { kind: "planned", priority: "medium" });
  settleMachine(db, machine.id);
  if (db.ops.dispatch?.[machine.id]) delete db.ops.dispatch[machine.id];
  return order;
}

/** Planned service for every machine already past its interval; returns how many orders it opened. */
export function sweepService(db, now = Date.now()) {
  ensureMine(db);
  return db.ops.equipment.reduce((count, machine) => count + (planService(db, machine, now) ? 1 : 0), 0);
}

function settleMachine(db, machineId) {
  const machine = equipmentOf(db, machineId);
  if (!machine || machine.status === "retired") return;
  const open = recordsOf(db, "workorders").filter((item) => item.equipment === machineId && item.status !== "done" && item.kind !== "inspection");
  if (open.some((item) => item.kind === "breakdown")) machine.status = "down";
  else if (open.length) machine.status = "service";
  else if (["down", "service"].includes(machine.status)) machine.status = "ready";
}

const AFTER = {
  alcohol(db, item, previous, { now }) {
    if (previous || item.value <= ALCOHOL_LIMIT) return;
    const hours = db.skills.rules.alcoholHours;
    notifyUsers(db, [item.uid], `Согтууруулах ундааны шалгалт эерэг (${item.value}‰). ${hours ? `ID карт ${hours} цаг хаагдлаа, ` : ""}хүнд техник барихыг хориглоно.`, now, "urgent");
  },
  ppe(db, item, previous, { by, now }) {
    if (previous || !item.stock) return;
    const stock = recordsOf(db, "stock").find((entry) => entry.id === item.stock);
    if (!stock || stock.qty < 1) return;
    stock.qty -= 1;
    recordsOf(db, "moves").push({ id: newId("mv"), stock: stock.id, kind: "out", qty: 1, at: new Date(now).toISOString(), note: `ХХХ олголт: ${nameOf(db, item.uid)}`, by, createdAt: new Date(now).toISOString() });
    trim(db, "moves");
  },
  prestarts(db, item, previous, { by, now }) {
    const machine = equipmentOf(db, item.equipment);
    if (!machine) return;
    if (item.hours > (machine.hours || 0)) machine.hours = item.hours;
    const critical = prestartFails(item).filter((key) => CRITICAL_ITEMS.includes(key));
    if (critical.length && machine.status !== "retired") {
      machine.status = "down";
      const labels = critical.map((key) => PRESTART_LABELS[key]).join(", ");
      const open = recordsOf(db, "workorders").some((order) => order.equipment === machine.id && order.kind === "breakdown" && order.status !== "done");
      if (!open) openWorkorder(db, machine, `Pre-start: ${labels}`, `${nameOf(db, item.operator)} ажлын өмнөх үзлэгээр илрүүлсэн. ${item.note || ""}`.trim(), by, now);
    }
    planService(db, machine, now);
  },
  workorders(db, item, previous, { now }) {
    if (!previous) item.opened = new Date(now).toISOString();
    if (item.status === "done" && !item.closed) {
      item.closed = new Date(now).toISOString();
      const machine = equipmentOf(db, item.equipment);
      if (machine && item.kind === "planned") machine.lastService = machine.hours || 0;
    }
    if (item.status !== "done") item.closed = null;
    settleMachine(db, item.equipment);
  },
  fuel(db, item, previous, { now }) {
    const machine = equipmentOf(db, item.equipment);
    if (machine && item.hours > (machine.hours || 0)) machine.hours = item.hours;
    planService(db, machine, now);
  },
  meters(db, item, previous, { now }) {
    const machine = equipmentOf(db, item.equipment);
    const latest = recordsOf(db, "meters").filter((other) => other.equipment === item.equipment).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (latest?.id === item.id) machine.hours = previous ? item.hours : Math.max(machine.hours || 0, item.hours);
    planService(db, machine, now);
  },
  equipment(db, item, previous, { now }) {
    planService(db, item, now);
  },
  moves(db, item, previous) {
    if (previous) return;
    const stock = recordsOf(db, "stock").find((entry) => entry.id === item.stock);
    stock.qty = Math.round((stock.qty + (item.kind === "in" ? item.qty : -item.qty)) * 100) / 100;
  },
  talks(db, item, previous) {
    item.acks = previous?.acks || [];
  },
  blasts(db, item, previous) {
    item.fired = previous && previous.at === item.at ? previous.fired || {} : {};
  },
  visitors(db, item, previous) {
    item.key = previous?.key || randomBytes(9).toString("base64url");
    item.onSite = Boolean(previous?.onSite);
  },
  violations(db, item, previous, { by, now }) {
    if (previous) return;
    item.hseStatus = "new";
    const who = item.party === "staff" ? nameOf(db, item.uid) : item.person;
    notifyHse(db, `Хамгаалалтаас шинэ зөрчил ирлээ: ${VIOLATION_KINDS[item.kind]}, ${who}${item.place ? ` · ${item.place}` : ""}. Шийдвэрлэнэ үү.`, by, now);
  },
  incidents(db, item, previous, { by, now }) {
    if (!previous) notifyHse(db, `${INCIDENT_KINDS[item.kind]} бүртгэгдлээ: ${item.title}${item.place ? ` · ${item.place}` : ""} (${nameOf(db, by)}).`, by, now);
  },
  capex(db, item, previous) {
    if (!previous) Object.assign(item, { stage: "finance", trail: [] });
  },
  assets(db, item, previous, { now }) {
    if (item.status === "disposed") item.disposedOn ||= localDay(now);
    else delete item.disposedOn;
  },
  disposals(db, item, previous) {
    if (!previous) Object.assign(item, { stage: "finance", trail: [] });
  },
  shipments(db, item) {
    const sale = recordsOf(db, "sales").find((entry) => entry.id === item.sale);
    if (sale?.status === "open" && saleProgress(sale, recordsOf(db, "shipments")).left <= 0) sale.status = "done";
  },
};

/** Adds a record; returns { item } or { error }. */
export function createRecord(db, name, body, { by, now = Date.now() }) {
  const schema = COLLECTIONS[name];
  if (!schema) return { error: "Бүртгэлийн төрөл буруу" };
  const { record, error } = cleanRecord(name, body, contextFor(db, name, null));
  if (error) return { error };
  const item = { id: newId(schema.prefix), ...record, by, createdAt: new Date(now).toISOString() };
  const problem = BEFORE[name]?.(db, item, null, now);
  if (problem) return { error: problem };
  if (schema.fields.some((field) => field.type === "photo")) storePhoto(db, item, null);
  recordsOf(db, name).push(item);
  AFTER[name]?.(db, item, null, { by, now });
  trim(db, name);
  prunePhotos(db);
  return { item };
}

/** Replaces a record's fields; a photo left out of the body stays as it was. */
export function updateRecord(db, name, id, body, { by, now = Date.now() }) {
  const schema = COLLECTIONS[name];
  if (!schema) return { error: "Бүртгэлийн төрөл буруу" };
  if (schema.immutable) return { error: "Энэ бүртгэлийг засах боломжгүй" };
  const list = recordsOf(db, name);
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return { error: "Бүртгэл олдсонгүй", status: 404 };
  const previous = list[index];
  const keepPhoto = body?.photo === undefined;
  const { record, error } = cleanRecord(name, keepPhoto ? { ...body, photo: undefined } : body, contextFor(db, name, id));
  if (error) return { error };
  const item = { ...previous, ...record, updatedBy: by, updatedAt: new Date(now).toISOString() };
  if (keepPhoto && schema.fields.some((field) => field.type === "photo")) item.photo = undefined;
  const problem = BEFORE[name]?.(db, item, previous, now);
  if (problem) return { error: problem };
  if (schema.fields.some((field) => field.type === "photo")) storePhoto(db, item, previous);
  list[index] = item;
  AFTER[name]?.(db, item, previous, { by, now });
  prunePhotos(db);
  return { item };
}

export function deleteRecord(db, name, id) {
  const schema = COLLECTIONS[name];
  if (!schema) return { error: "Бүртгэлийн төрөл буруу" };
  if (schema.immutable) return { error: "Энэ бүртгэлийг устгах боломжгүй" };
  const list = recordsOf(db, name);
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) return { error: "Бүртгэл олдсонгүй", status: 404 };
  if (name === "violations" && (list[index].hseStatus || "new") !== "new") return { error: "ХАБЭА шийдвэрлэж эхэлсэн зөрчлийг устгах боломжгүй", status: 409 };
  if (["capex", "disposals"].includes(name) && list[index].stage !== "finance") return { error: "Санхүү хянасан хүсэлтийг устгах боломжгүй", status: 409 };
  if (name === "sales" && recordsOf(db, "shipments").some((item) => item.sale === id)) return { error: "Ачилт бүртгэгдсэн гэрээг устгах боломжгүй", status: 409 };
  const [removed] = list.splice(index, 1);
  if (name === "incidents") db.hse.capa = db.hse.capa.filter((item) => item.incident !== id);
  if (PHOTO_COLLECTIONS.includes(name)) delete db[PHOTOS][id];
  if (name === "rooms") for (const slot of Object.keys(db.camp.beds)) if (slot.startsWith(`${id}:`)) delete db.camp.beds[slot];
  if (name === "workorders") settleMachine(db, removed.equipment);
  return { item: removed };
}

/** Puts a deleted record back as it was, without its photo; the side effects of the original save are not replayed. */
export function restoreRecord(db, name, snapshot) {
  const schema = COLLECTIONS[name];
  if (!schema || schema.immutable || !snapshot?.id) return { error: "Энэ бүртгэлийг сэргээх боломжгүй" };
  ensureMine(db);
  const list = recordsOf(db, name);
  if (list.some((item) => item.id === snapshot.id)) return { error: "Энэ бүртгэл аль хэдийн байна", status: 409 };
  const item = structuredClone(snapshot);
  if (schema.fields.some((field) => field.type === "photo")) item.photo = null;
  list.push(item);
  if (name === "workorders") settleMachine(db, item.equipment);
  return { item };
}

/** Who a toolbox talk is for: staff planned on that shift (and in its crew, if one is set), not on leave. */
export function talkAudience(db, talk) {
  const crew = talk.crew ? recordsOf(db, "crews").find((item) => item.id === talk.crew) : null;
  return staffOf(db)
    .filter((user) => !crew || crew.members.includes(user.id) || crew.leader === user.id)
    .filter((user) => !leaveOn(db.leaves, user.id, talk.date) && plannedKind(db.shiftPlans?.[user.id], talk.date) === talk.shift)
    .map((user) => user.id);
}

/** A person from an id or a scanned card QR. */
function personFrom(db, { uid, qr }) {
  if (qr) return String(qr).startsWith(CARD_QR_PREFIX) ? findByCardQr(db.users, qr) : null;
  return mineUsers(db).find((user) => user.id === uid) || null;
}

export function ackTalk(db, talkId, { uid, qr, via, now = Date.now() }) {
  const talk = recordsOf(db, "talks").find((item) => item.id === talkId);
  if (!talk) return { error: "Зааварчилгаа олдсонгүй" };
  const person = personFrom(db, { uid, qr });
  if (!person || !STAFF_ROLES.includes(person.role)) return { error: qr ? "Карт танигдсангүй" : "Ажилтан олдсонгүй" };
  if (talk.acks.some((item) => item.uid === person.id)) return { name: person.displayName, already: true };
  talk.acks.push({ uid: person.id, at: new Date(now).toISOString(), via });
  return { name: person.displayName };
}

export function activeMuster(db) {
  return db.hse?.musters?.find((item) => !item.end) || null;
}

export function startMuster(db, { reason, announceIt = true, by, now = Date.now() }) {
  if (activeMuster(db)) return { error: "Цуглаан аль хэдийн явагдаж байна" };
  const text = String(reason || "").replace(/\s+/g, " ").trim().slice(0, 120) || "Онцгой байдал";
  if (/[<>]/.test(text)) return { error: "Шалтгаан < > тэмдэггүй байна" };
  const staff = onSiteStaff(db);
  const visitors = recordsOf(db, "visitors").filter((item) => item.onSite).map((item) => `v:${item.id}`);
  const muster = { id: newId("mst"), at: new Date(now).toISOString(), by, reason: text, expected: [...staff, ...visitors], checked: {}, end: null };
  db.hse.musters.push(muster);
  db.hse.musters = db.hse.musters.slice(-KEEP_MUSTERS);
  if (announceIt) announce(db, `Онцгой байдал! ${text}. Бүх ажилтан, зочид цуглах цэг рүү яаралтай очно уу.`, "Цуглаан", now);
  notifyUsers(db, staff, `ОНЦГОЙ БАЙДАЛ: ${text}. Цуглах цэг рүү яаралтай оч, апп дээр «Цуглах цэгт ирлээ» дарна уу.`, now, "urgent");
  return { muster };
}

/** Marks someone present at the muster point: a staff id, a card QR, a visitor id or a visitor pass QR. */
export function checkMuster(db, { uid, visitor, qr, via, now = Date.now() }) {
  const muster = activeMuster(db);
  if (!muster) return { error: "Идэвхтэй цуглаан алга" };
  let key = null;
  let name = "";
  if (visitor || String(qr || "").startsWith(VISITOR_QR_PREFIX)) {
    const found = recordsOf(db, "visitors").find((item) => (visitor ? item.id === visitor : `${VISITOR_QR_PREFIX}${item.key}` === qr));
    if (!found) return { error: "Түр нэвтрэх эрх танигдсангүй" };
    key = `v:${found.id}`;
    name = found.name;
  } else {
    const person = personFrom(db, { uid, qr });
    if (!person) return { error: qr ? "Карт танигдсангүй" : "Ажилтан олдсонгүй" };
    key = person.id;
    name = person.displayName;
  }
  if (!muster.expected.includes(key)) muster.expected.push(key);
  if (muster.checked[key]) return { name, already: true };
  muster.checked[key] = { at: new Date(now).toISOString(), via };
  return { name };
}

export function endMuster(db, by, now = Date.now()) {
  const muster = activeMuster(db);
  if (!muster) return { error: "Идэвхтэй цуглаан алга" };
  muster.end = new Date(now).toISOString();
  muster.endBy = by;
  const missing = muster.expected.filter((key) => !muster.checked[key]).length;
  announce(db, missing ? "Цуглаан дууслаа." : "Цуглаан дууслаа. Бүх хүн бүртгэгдсэн. Ажлаа үргэлжлүүлж болно.", "Цуглаан", now);
  return { muster };
}

const openSos = (db, uid) => db.hse.sos.find((item) => item.uid === uid && (item.status === "open" || item.status === "ack")) || null;

export function raiseSos(db, uid, { lat, lng, kind = "sos", note = "", now = Date.now() }) {
  const existing = openSos(db, uid);
  if (existing) return { sos: existing };
  const phone = db[personalKey(uid)]?.place;
  const given = lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
  const geo = given ? { lat: Number(lat), lng: Number(lng), source: "browser" } : phone ? { lat: phone.lat, lng: phone.lng, source: "phone", at: phone.at } : null;
  const sos = { id: newId("sos"), uid, kind, at: new Date(now).toISOString(), geo, note: String(note || "").slice(0, 160), status: "open" };
  db.hse.sos.push(sos);
  db.hse.sos = db.hse.sos.slice(-KEEP_SOS);
  const name = nameOf(db, uid);
  const text = kind === "lone" ? `Анхаар! ${name} ганцаар ажиллаж байгаа бөгөөд хариу өгөхгүй байна. Шалгана уу.` : `Яаралтай тусламж! ${name} SOS дохио өглөө.`;
  announce(db, text, "SOS", now);
  const responders = (db.users || []).filter((user) => (user.role === HSE_ROLE || user.role === MASTER_ROLE) && user.id !== uid).map((user) => user.id);
  notifyUsers(db, responders, `${text}${note ? ` (${String(note).slice(0, 80)})` : ""}`, now, "urgent");
  return { sos };
}

export function cancelSos(db, uid, now = Date.now()) {
  const sos = openSos(db, uid);
  if (!sos) return { error: "Идэвхтэй SOS алга" };
  Object.assign(sos, { status: "cancelled", closedAt: new Date(now).toISOString() });
  return { sos };
}

export function updateSos(db, id, status, by, now = Date.now()) {
  const sos = db.hse.sos.find((item) => item.id === id);
  if (!sos) return { error: "SOS олдсонгүй" };
  if (!["ack", "resolved"].includes(status)) return { error: "Төлөв буруу" };
  if (status === "ack") {
    Object.assign(sos, { status, ackBy: by, ackAt: new Date(now).toISOString() });
    notifyUsers(db, [sos.uid], `Таны дохиог ${nameOf(db, by)} хүлээн авлаа. Тусламж явж байна, байгаа газраа үлдэнэ үү.`, now, "urgent");
  } else Object.assign(sos, { status, closedBy: by, closedAt: new Date(now).toISOString() });
  return { sos };
}

const activeLone = (db, uid) => db.hse.lone.find((item) => item.uid === uid && item.active) || null;

export function startLone(db, uid, { minutes, place, now = Date.now() }) {
  const interval = Number(minutes);
  if (!Number.isInteger(interval) || interval < 10 || interval > 180) return { error: "Хугацаа 10–180 минут" };
  const where = String(place || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (/[<>]/.test(where)) return { error: "Байршил < > тэмдэггүй байна" };
  const current = activeLone(db, uid);
  if (current) Object.assign(current, { active: false, end: new Date(now).toISOString() });
  const session = { id: newId("lw"), uid, start: new Date(now).toISOString(), interval, lastCheck: new Date(now).toISOString(), place: where, active: true, alerted: false };
  db.hse.lone.push(session);
  db.hse.lone = db.hse.lone.slice(-KEEP_LONE);
  return { session };
}

export function okLone(db, uid, now = Date.now()) {
  const session = activeLone(db, uid);
  if (!session) return { error: "Ганцаар ажиллах горим идэвхгүй" };
  Object.assign(session, { lastCheck: new Date(now).toISOString(), alerted: false });
  const sos = openSos(db, uid);
  if (sos?.kind === "lone") Object.assign(sos, { status: "resolved", closedAt: new Date(now).toISOString(), note: "Ажилтан өөрөө хариу өглөө" });
  return { session };
}

export function stopLone(db, uid, now = Date.now()) {
  const session = activeLone(db, uid);
  if (!session) return { error: "Ганцаар ажиллах горим идэвхгүй" };
  Object.assign(session, { active: false, end: new Date(now).toISOString() });
  const sos = openSos(db, uid);
  if (sos?.kind === "lone") Object.assign(sos, { status: "resolved", closedAt: new Date(now).toISOString(), note: "Ажилтан горимыг дуусгалаа" });
  return { session };
}

export const loneDue = (session) => Date.parse(session.lastCheck) + session.interval * MIN_MS;

export function setVisitorSite(db, id, on, now = Date.now()) {
  const visitor = recordsOf(db, "visitors").find((item) => item.id === id);
  if (!visitor) return { error: "Бүртгэл олдсонгүй" };
  if (on && !visitorReady(visitor, localDay(now))) return { error: "Танилцуулга сургалт бүрэн биш эсвэл эрхийн хугацаа таарахгүй байна" };
  visitor.onSite = Boolean(on);
  if (on) visitor.inAt = new Date(now).toISOString();
  else visitor.outAt = new Date(now).toISOString();
  return { visitor };
}

export function autoBeds(db, now = Date.now()) {
  const result = allocateBeds({ rooms: recordsOf(db, "rooms"), beds: db.camp.beds, users: staffOf(db), plans: db.shiftPlans, leaves: db.leaves, date: localDay(now) });
  db.camp.beds = result.beds;
  return result;
}

export function setBed(db, roomId, index, uid) {
  const room = recordsOf(db, "rooms").find((item) => item.id === roomId);
  const bed = Number(index);
  if (!room || !Number.isInteger(bed) || bed < 0 || bed >= room.beds) return { error: "Ор олдсонгүй" };
  const slot = `${roomId}:${bed}`;
  if (!uid) {
    delete db.camp.beds[slot];
    return { ok: true };
  }
  if (!staffOf(db).some((user) => user.id === uid)) return { error: "Ажилтан олдсонгүй" };
  for (const [key, value] of Object.entries(db.camp.beds)) if (value === uid) delete db.camp.beds[key];
  db.camp.beds[slot] = uid;
  return { ok: true };
}

export function saveSettings(db, body) {
  const rules = { ...db.skills.rules };
  if (body.enforce !== undefined) rules.enforce = Boolean(body.enforce);
  if (body.medical !== undefined) rules.medical = Boolean(body.medical);
  if (body.required !== undefined) {
    const list = Array.isArray(body.required) ? body.required : [];
    if (!list.every((type) => CERT_TYPES[type])) return { error: "Гэрчилгээний төрөл буруу" };
    rules.required = [...new Set(list)];
  }
  if (body.alcoholHours !== undefined) {
    const hours = Number(body.alcoholHours);
    if (!Number.isInteger(hours) || hours < 0 || hours > 72) return { error: "Хаах хугацаа 0–72 цаг" };
    rules.alcoholHours = hours;
  }
  if (body.planTonnes !== undefined) {
    const tonnes = Number(body.planTonnes);
    if (!Number.isFinite(tonnes) || tonnes < 0 || tonnes > 10_000_000) return { error: "Төлөвлөгөө 0–10,000,000 тонн" };
    db.ops.planTonnes = Math.round(tonnes);
  }
  db.skills.rules = rules;
  return { ok: true };
}

/** A temporary weather override for demonstrations; it stops by itself. */
export function setWxSim(db, body, now = Date.now()) {
  if (body.clear) {
    delete db.hse.wxSim;
    return { ok: true };
  }
  const minutes = Number(body.minutes ?? 15);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) return { error: "Хугацаа 1–120 минут" };
  const number = (value, min, max) => (value === "" || value == null ? null : Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : NaN);
  const wind = number(body.windSpeedMs, 0, 60);
  const feels = number(body.feelsLikeC, -70, 60);
  const precip = number(body.precipNowMm, 0, 50);
  if ([wind, feels, precip].some(Number.isNaN)) return { error: "Утга буруу" };
  db.hse.wxSim = { windSpeedMs: wind, feelsLikeC: feels, precipNowMm: precip, code: body.thunder ? 95 : null, until: new Date(now + minutes * MIN_MS).toISOString() };
  return { ok: true };
}

/** Live weather with a demonstration override laid over it; null when the reading is too old to act on. */
export function effectiveWeather(db, now) {
  const base = db.weather && now - Date.parse(db.weather.fetchedAt || 0) < WEATHER_STALE_MS ? db.weather : null;
  const sim = db.hse?.wxSim && Date.parse(db.hse.wxSim.until) > now ? db.hse.wxSim : null;
  if (!sim) return base;
  const pick = (key) => (sim[key] ?? base?.[key] ?? null);
  return { ...(base || {}), windSpeedMs: pick("windSpeedMs"), feelsLikeC: pick("feelsLikeC"), precipNowMm: pick("precipNowMm"), code: sim.code ?? base?.code ?? 0, simulated: true };
}

function blastActions(db, now) {
  const actions = [];
  for (const blast of db.hse?.blasts || []) {
    if (blast.status !== "planned") continue;
    const at = Date.parse(blast.at);
    const fired = blast.fired || {};
    if (now >= at + 2 * HOUR_MS) actions.push({ blast, kind: "expire" });
    else if (now >= at + BLAST_CLEAR_MIN * MIN_MS) actions.push({ blast, kind: "clear" });
    else if (now >= at) {
      if (!fired.go) actions.push({ blast, kind: "go" });
    } else {
      const passed = BLAST_WARN_MIN.filter((minutes) => now >= at - minutes * MIN_MS);
      if (passed.length && !fired[`w${Math.min(...passed)}`]) actions.push({ blast, kind: "warn", minutes: Math.min(...passed), marks: passed });
    }
  }
  return actions;
}

function wxChanges(db, now) {
  const weather = effectiveWeather(db, now);
  const changes = [];
  const rules = db.hse?.wxRules || [];
  for (const event of (db.hse?.wxEvents || []).filter((item) => !item.end)) {
    const rule = rules.find((item) => item.id === event.rule);
    if (!rule || !rule.enabled) changes.push({ event, kind: "stop", rule, value: null });
  }
  for (const rule of rules.filter((item) => item.enabled)) {
    const active = (db.hse.wxEvents || []).find((item) => item.rule === rule.id && !item.end);
    const value = wxValue(weather, rule.metric);
    const fires = wxTriggered(rule, value, Boolean(active));
    if (fires && !active) changes.push({ rule, kind: "start", value });
    if (!fires && active) changes.push({ rule, kind: "stop", event: active, value });
  }
  return changes;
}

function loneOverdue(db, now) {
  return (db.hse?.lone || []).filter((item) => item.active && !item.alerted && now > loneDue(item) + LONE_GRACE_MS);
}

function remindersDue(db, now) {
  return Boolean(db.skills) && db.skills.remindedOn !== localDay(now);
}

/** Whether mineTick has anything to do; cheap enough to run every few seconds. */
export function mineDue(db, now = Date.now()) {
  if (!db.hse) return false;
  return blastActions(db, now).length > 0 || wxChanges(db, now).length > 0 || loneOverdue(db, now).length > 0 || remindersDue(db, now) || Boolean(db.hse.wxSim && Date.parse(db.hse.wxSim.until) <= now);
}

function valueText(rule, value) {
  const spec = WX_METRICS[rule.metric];
  if (spec.op === "flag" || value == null) return "";
  return ` (${Math.round(value * 10) / 10}${spec.unit ? ` ${spec.unit}` : ""})`;
}

function sendReminders(db, now) {
  const today = localDay(now);
  const reminded = db.skills.reminded;
  const live = new Set();
  const remind = (key, uid, text) => {
    live.add(key);
    if (reminded[key]) return;
    reminded[key] = today;
    notifyUsers(db, [uid], text, now, key.endsWith(":x") ? "urgent" : "normal");
  };
  for (const cert of db.skills.certs) {
    const { state, days } = expiryState(cert.expires, today);
    if (state === "valid" || state === "none") continue;
    const label = CERT_TYPES[cert.type] || cert.type;
    const step = days < 0 ? "x" : days <= 7 ? "7" : "30";
    remind(`${cert.id}:${step}`, cert.uid, days < 0 ? `${label} гэрчилгээний хугацаа ${dotDate(cert.expires)}-нд дууссан. Сунгуулна уу.` : `${label} гэрчилгээ ${days} хоногийн дараа (${dotDate(cert.expires)}) дуусна.`);
  }
  for (const exam of db.skills.medicals) {
    const { state, days } = expiryState(exam.next, today, 14);
    if (state === "valid" || state === "none") continue;
    remind(`${exam.id}:${days < 0 ? "x" : "14"}`, exam.uid, days < 0 ? `Үечилсэн эрүүл мэндийн үзлэгийн хугацаа ${dotDate(exam.next)}-нд дууссан.` : `Эрүүл мэндийн үзлэг ${days} хоногийн дараа (${dotDate(exam.next)}) товлогдсон.`);
  }
  for (const key of Object.keys(reminded)) if (!live.has(key)) delete reminded[key];
  db.skills.remindedOn = today;
}

/** Blast warnings, weather stop-work signals, overdue lone workers and daily expiry reminders. */
export function mineTick(db, now = Date.now()) {
  ensureMine(db);
  let count = 0;
  for (const action of blastActions(db, now)) {
    const { blast } = action;
    blast.fired ||= {};
    const where = `${blast.place}-д`;
    if (action.kind === "warn") {
      for (const minutes of action.marks) blast.fired[`w${minutes}`] = new Date(now).toISOString();
      announce(db, `Анхааруулга! ${where} ${action.minutes} минутын дараа тэсэлгээ хийгдэнэ. ${blast.radius} метрийн аюултай бүсээс гарна уу.`, "Тэсэлгээ", now);
      if (action.minutes >= 5) notifyUsers(db, onSiteStaff(db), `Тэсэлгээ ${clock(Date.parse(blast.at))}-д, ${blast.place}. ${blast.radius} м аюултай бүсэд бүү ор.`, now, "urgent");
    } else if (action.kind === "go") {
      blast.fired.go = new Date(now).toISOString();
      announce(db, `Тэсэлгээ! ${where} тэсэлгээ хийгдэж байна. Аюултай бүсэд хэн ч бүү ор.`, "Тэсэлгээ", now);
    } else {
      blast.fired.clear = new Date(now).toISOString();
      blast.status = "done";
      if (action.kind === "clear") {
        announce(db, `${where} тэсэлгээ дууслаа. Аюултай бүс нээгдлээ.`, "Тэсэлгээ", now);
        notifyUsers(db, onSiteStaff(db), `${blast.place}: тэсэлгээ дууслаа, бүс нээгдлээ.`, now);
      }
    }
    count += 1;
  }
  for (const change of wxChanges(db, now)) {
    if (change.kind === "start") {
      db.hse.wxEvents.push({ id: newId("wxe"), rule: change.rule.id, name: change.rule.name, action: change.rule.action, metric: change.rule.metric, value: change.value, start: new Date(now).toISOString(), end: null, simulated: Boolean(effectiveWeather(db, now)?.simulated) });
      db.hse.wxEvents = db.hse.wxEvents.slice(-KEEP_WX_EVENTS);
      const text = `Ажил зогсоох дохио! ${change.rule.name}${valueText(change.rule, change.value)}. ${change.rule.action}`;
      announce(db, text, "Цаг агаар", now);
      notifyUsers(db, onSiteStaff(db), text, now, "urgent");
    } else {
      Object.assign(change.event, { end: new Date(now).toISOString(), endValue: change.value });
      const name = change.rule?.name || change.event.name;
      announce(db, `${name}: нөхцөл хэвийн боллоо. Ажлаа аюулгүй үргэлжлүүлж болно.`, "Цаг агаар", now);
    }
    count += 1;
  }
  for (const session of loneOverdue(db, now)) {
    session.alerted = true;
    raiseSos(db, session.uid, { kind: "lone", note: session.place, now });
    count += 1;
  }
  if (remindersDue(db, now)) {
    sendReminders(db, now);
    count += 1;
  }
  if (db.hse.wxSim && Date.parse(db.hse.wxSim.until) <= now) delete db.hse.wxSim;
  return count;
}

/** A worker hazard report from the phone or web app. */
export function reportHazard(db, uid, body, now = Date.now()) {
  return createRecord(
    db,
    "incidents",
    { kind: "hazard", title: body.title, severity: body.severity || "medium", injury: "none", at: localInput(now), place: body.place, geo: body.geo || null, description: body.description, people: [], photo: body.photo || null, status: "open" },
    { by: uid, now },
  );
}

function hoursWorked(db, staff, from, now) {
  let total = 0;
  for (const user of staff) {
    for (const session of sessionsOf(db.attendance?.events || [], user.id, now)) total += Math.max(0, session.end - Math.max(session.start, from));
  }
  return total / HOUR_MS;
}

function briefWeather(db, now) {
  const weather = effectiveWeather(db, now);
  if (!weather) return null;
  const { tempC, feelsLikeC, windSpeedMs, windFrom, code, condition, precipNowMm, fetchedAt, simulated } = weather;
  return { tempC, feelsLikeC, windSpeedMs, windFrom, code, condition, precipNowMm, fetchedAt, simulated: Boolean(simulated) };
}

/** Everything the MASTER pages show, without login secrets, card keys or photos. */
export function masterView(db, now = Date.now()) {
  ensureMine(db);
  const today = localDay(now);
  const staff = staffOf(db);
  const users = mineUsers(db).map((user) => ({
    id: user.id,
    displayName: user.displayName,
    title: user.title || "",
    role: user.role,
    card: { idNumber: user.card?.idNumber || "", status: user.card?.status || "", clearance: user.card?.clearance || 1, restUntil: user.card?.restUntil || null },
  }));
  const ids = new Set(staff.map((user) => user.id));
  const people = Object.fromEntries(Object.entries(db.attendance?.people || {}).filter(([uid]) => ids.has(uid)));
  const since = db.attendance?.historyFrom ? Date.parse(`${db.attendance.historyFrom}T00:00:00+08:00`) : now - 30 * DAY_MS;
  const windowDays = Math.max(1, Math.min(90, Math.round((now - since) / DAY_MS)));
  return {
    now: new Date(now).toISOString(),
    today,
    shiftDate: shiftDateOf(now),
    shift: currentShift(now),
    users,
    people,
    plans: Object.fromEntries(Object.entries(db.shiftPlans || {}).filter(([uid]) => ids.has(uid))),
    leaves: (db.leaves || []).filter((item) => item.status === "approved" && ids.has(item.uid)),
    fatigue: Object.fromEntries(staff.map((user) => [user.id, fatigueFor(db, user.id, now)])),
    holds: Object.fromEntries(staff.map((user) => [user.id, holdsOf(db, user.id, now)])),
    audience: Object.fromEntries(db.hse.talks.map((talk) => [talk.id, talkAudience(db, talk)])),
    photos: Object.keys(db[PHOTOS] || {}),
    hse: db.hse,
    skills: db.skills,
    ops: db.ops,
    maint: db.maint,
    guard: { violations: db.guard.violations },
    weather: briefWeather(db, now),
    wxSim: db.hse.wxSim && Date.parse(db.hse.wxSim.until) > now ? db.hse.wxSim : null,
    kpi: mineKpis({
      handovers: db.ops.handovers,
      planTonnes: db.ops.planTonnes,
      incidents: db.hse.incidents,
      workorders: db.ops.workorders,
      equipment: db.ops.equipment,
      assigns: db.ops.assigns,
      hoursWorked: hoursWorked(db, staff, now - windowDays * DAY_MS, now),
      windowDays,
      today: shiftDateOf(now),
      now,
    }),
    labels: { equip: EQUIP_TYPES, permit: PERMIT_TYPES },
  };
}

/** The safety strip on a worker's home page. */
export function workerMine(db, uid, now = Date.now()) {
  const user = db.users?.find((item) => item.id === uid);
  if (!user || !STAFF_ROLES.includes(user.role) || !db.hse) return null;
  const shiftDate = shiftDateOf(now);
  const talks = db.hse.talks
    .filter((talk) => talk.date === shiftDate && talkAudience(db, talk).includes(uid))
    .map((talk) => ({ id: talk.id, topic: talk.topic, content: talk.content, shift: talk.shift, acked: talk.acks.some((item) => item.uid === uid) }));
  const muster = activeMuster(db);
  const sos = openSos(db, uid);
  const lone = activeLone(db, uid);
  const rules = db.skills.rules;
  return {
    talks,
    stopWork: db.hse.wxEvents.filter((item) => !item.end).map(({ id, name, action, start, value, metric }) => ({ id, name, action, start, value, unit: WX_METRICS[metric]?.unit || "" })),
    blasts: db.hse.blasts
      .filter((item) => item.status === "planned" && Date.parse(item.at) > now - BLAST_CLEAR_MIN * MIN_MS && Date.parse(item.at) - now < 12 * HOUR_MS)
      .map(({ id, at, place, radius }) => ({ id, at, place, radius })),
    muster: muster ? { id: muster.id, reason: muster.reason, at: muster.at, checked: Boolean(muster.checked[uid]) } : null,
    sos: sos ? { id: sos.id, status: sos.status, kind: sos.kind, at: sos.at, ackBy: sos.ackBy ? nameOf(db, sos.ackBy) : null } : null,
    lone: lone ? { start: lone.start, interval: lone.interval, lastCheck: lone.lastCheck, due: new Date(loneDue(lone)).toISOString(), place: lone.place } : null,
    holds: rules.enforce ? holdsOf(db, uid, now) : [],
    fatigue: fatigueFor(db, uid, now),
    permits: db.hse.permits
      .filter((item) => item.status === "active" && Date.parse(item.to) > now && (item.holder === uid || item.members.includes(uid)))
      .map(({ id, type, title, place, to }) => ({ id, type: PERMIT_TYPES[type], title, place, to })),
  };
}
