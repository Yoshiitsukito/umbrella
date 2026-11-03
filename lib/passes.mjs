// Movement permits on the server: a shift worker asks to leave the mine area, or to arrive or leave outside their
// rotation; HR and the chief mining engineer decide, security records the gate, and the camp plans beds around them.
import { randomBytes } from "node:crypto";
import { STAFF_ROLES } from "./auth.mjs";
import { personalOf, pushNotice } from "./personal.mjs";
import { localDay, localInput } from "../public/js/minecore.js";
import { APPROVER_LABEL, PASS_APPROVERS, PASS_KINDS, PASS_STATUS, awaits, canSee, checkPass, isLate, nextGate, passStatus } from "../public/js/passcore.js";
import { leaveOn, plannedKind } from "../public/js/workstats.js";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KEEP = 800;
const KEEP_DAYS = 60;
const SHOW_DAYS = 30;
const NOTE_MAX = 160;

const newId = () => `ps_${randomBytes(6).toString("hex")}`;
const endOf = (pass) => Date.parse(pass.until || pass.from);
const outNow = (pass) => Boolean(pass.gate?.out) && !pass.gate?.in && pass.kind === "exit";

export function ensurePasses(db) {
  if (!Array.isArray(db.passes)) db.passes = [];
  return db.passes;
}

function prune(db, now) {
  db.passes = db.passes.filter((pass) => outNow(pass) || endOf(pass) > now - KEEP_DAYS * DAY_MS).slice(-KEEP);
}

/** "11.05 08:00" for a stored moment. */
export function whenText(iso) {
  const local = localInput(Date.parse(iso));
  return `${local.slice(5, 10).replace("-", ".")} ${local.slice(11, 16)}`;
}

function sameTime(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "exit") return Date.parse(a.from) < Date.parse(b.until) && Date.parse(b.from) < Date.parse(a.until);
  return localDay(Date.parse(a.from)) === localDay(Date.parse(b.from));
}

/** A shift worker's new request; returns { pass } or { error, status }. */
export function requestPass(db, user, body, now = Date.now()) {
  if (!user || !STAFF_ROLES.includes(user.role)) return { error: "Зөвхөн ээлжийн ажилтан хүсэлт гаргана", status: 403 };
  const passes = ensurePasses(db);
  const { pass, error } = checkPass(body, now);
  if (error) return { error, status: 400 };
  const open = passes.find((other) => other.uid === user.id && sameTime(other, pass) && ["pending", "approved"].includes(passStatus(other, now)));
  if (open) return { error: `Энэ хугацаанд «${PASS_KINDS[pass.kind]}» хүсэлт бүртгэлтэй байна`, status: 409 };
  const item = { id: newId(), uid: user.id, ...pass, decisions: {}, gate: {}, at: new Date(now).toISOString() };
  passes.push(item);
  prune(db, now);
  return { pass: item };
}

/** A worker withdraws a request nobody has decided on yet. */
export function cancelPass(db, uid, id, now = Date.now()) {
  const passes = ensurePasses(db);
  const pass = passes.find((item) => item.id === id && item.uid === uid);
  if (!pass) return { error: "Хүсэлт олдсонгүй", status: 404 };
  if (Object.keys(pass.decisions || {}).length || passStatus(pass, now) !== "pending") return { error: "Шийдвэрлэж эхэлсэн хүсэлтийг цуцлах боломжгүй", status: 409 };
  db.passes = passes.filter((item) => item !== pass);
  return { ok: true };
}

/** HR's or the chief engineer's decision; the worker hears once the request is fully approved or refused. */
export function decidePass(db, id, { role, me, ok, note, now = Date.now() }) {
  const pass = ensurePasses(db).find((item) => item.id === id);
  if (!pass) return { error: "Хүсэлт олдсонгүй", status: 404 };
  if (!PASS_APPROVERS[pass.kind].includes(role)) return { error: "Энэ хүсэлтийг шийдвэрлэх эрхгүй", status: 403 };
  if (pass.uid === me.id) return { error: "Өөрийн хүсэлтийг өөрөө шийдвэрлэх боломжгүй", status: 403 };
  if (pass.decisions?.[role]) return { error: "Энэ хүсэлтийг аль хэдийн шийдвэрлэсэн", status: 409 };
  const status = passStatus(pass, now);
  if (status !== "pending") return { error: `Хүсэлт «${PASS_STATUS[status]}» төлөвтэй байна`, status: 409 };
  const text = String(note ?? "").replace(/\s+/g, " ").trim();
  if (text.length > NOTE_MAX || /[<>]/.test(text)) return { error: `Тайлбар ${NOTE_MAX}-аас ихгүй тэмдэгт, < > тэмдэггүй`, status: 400 };
  if (!ok && !text) return { error: "Татгалзах шалтгаанаа бичнэ үү", status: 400 };
  pass.decisions = { ...pass.decisions, [role]: { ok: Boolean(ok), by: me.displayName || "", uid: me.id, at: new Date(now).toISOString(), note: text || null } };
  const after = passStatus(pass, now);
  const what = `${PASS_KINDS[pass.kind]} (${whenText(pass.from)})`;
  if (after === "approved") notify(db, pass.uid, "pass-ok", `${what} хүсэлт зөвшөөрөгдлөө.`, now);
  if (after === "rejected") notify(db, pass.uid, "pass-no", `${what} хүсэлтийг ${APPROVER_LABEL[role]} татгалзлаа: ${text}`, now);
  return { ok: true, pass };
}

function notify(db, uid, kind, text, now) {
  if (db.users.some((user) => user.id === uid)) pushNotice(personalOf(db, uid), kind, text, now);
}

/** Security records the next gate step of an approved request: out, then back in for a short exit. */
export function gatePass(db, id, { step, me, now = Date.now() }) {
  const pass = ensurePasses(db).find((item) => item.id === id);
  if (!pass) return { error: "Хүсэлт олдсонгүй", status: 404 };
  const status = passStatus(pass, now);
  if (status !== "approved") return { error: status === "pending" ? "Зөвшөөрөл хараахан олгогдоогүй байна" : `Хүсэлт «${PASS_STATUS[status]}» төлөвтэй байна`, status: 409 };
  const next = nextGate(pass, now);
  if (step !== next) return { error: "Хаалганы бүртгэлийн дараалал буруу", status: 409 };
  pass.gate = { ...pass.gate, [step]: { at: new Date(now).toISOString(), by: me.displayName || "" } };
  return { ok: true, pass };
}

function plannedOn(db, uid, iso) {
  const date = localDay(Date.parse(iso));
  const user = db.users.find((item) => item.id === uid);
  if (!user || !STAFF_ROLES.includes(user.role)) return null;
  return leaveOn(db.leaves, uid, date) ? "leave" : plannedKind(db.shiftPlans?.[uid], date);
}

const shown = (db, pass, now) => ({ ...pass, status: passStatus(pass, now), late: isLate(pass, now), planned: plannedOn(db, pass.uid, pass.from) });

/** The board for HR, the chief engineer, the camp manager and security: the kinds their role sees, recent first. */
export function passesView(db, role, now = Date.now()) {
  const passes = ensurePasses(db)
    .filter((pass) => canSee(pass, role) && (passStatus(pass, now) === "pending" || outNow(pass) || endOf(pass) > now - SHOW_DAYS * DAY_MS))
    .map((pass) => shown(db, pass, now));
  const ids = new Set(passes.map((pass) => pass.uid));
  const users = db.users
    .filter((user) => ids.has(user.id))
    .map((user) => ({ id: user.id, displayName: user.displayName, title: user.title || "", role: user.role, idNumber: user.card?.idNumber || "" }));
  return { now: new Date(now).toISOString(), today: localDay(now), role, users, passes, inbox: passInbox(db, role, now) };
}

/** A worker's own requests, newest first. */
export function ownPasses(db, uid, now = Date.now()) {
  return ensurePasses(db)
    .filter((pass) => pass.uid === uid)
    .map((pass) => shown(db, pass, now))
    .sort((a, b) => b.from.localeCompare(a.from));
}

/** The count on a role's menu button: decisions it owes, gate steps due soon, or arrivals and departures to plan for. */
export function passInbox(db, role, now = Date.now()) {
  const passes = ensurePasses(db).filter((pass) => canSee(pass, role));
  if (role === "engineer" || role === "hr") return passes.filter((pass) => awaits(pass, role, now)).length;
  if (role === "security") return passes.filter((pass) => isLate(pass, now) || (nextGate(pass, now) && Date.parse(pass.from) < now + 12 * HOUR_MS)).length;
  if (role === "campmgr") return passes.filter((pass) => passStatus(pass, now) === "approved" && Date.parse(pass.from) < now + 2 * DAY_MS).length;
  return 0;
}

/** Approved off-rotation arrivals and departures around a date, for the camp's bed planning. */
export function campPasses(db, now = Date.now()) {
  return ensurePasses(db)
    .filter((pass) => pass.kind !== "exit" && ["approved", "done"].includes(passStatus(pass, now)) && Math.abs(Date.parse(pass.from) - now) < 8 * DAY_MS)
    .map(({ id, uid, kind, from }) => ({ id, uid, kind, from, date: localDay(Date.parse(from)) }));
}
