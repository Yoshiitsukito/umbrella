import { randomBytes } from "node:crypto";
import { STAFF_ROLES } from "./auth.mjs";
import { ROTATIONS, addDays, isRotation, plannedKind, rotationFrom, shiftDateOf, shiftSpan } from "../public/js/workstats.js";

export const LEAVE_TYPES = ["leave", "sick", "trip"];
export const SHIFT_KINDS = ["off", "day", "night"];
export const ATTEMPT_REASONS = ["mismatch", "timeout"];

const DAY_MS = 24 * 3600 * 1000;
const ATTEMPT_KEEP_MS = 30 * DAY_MS;
const LEAVE_KEEP_DAYS = 120;
const MAX_LEAVE_DAYS = 31;
const PAST_LIMIT_DAYS = 30;
const FUTURE_LIMIT_DAYS = 180;

export function ensureWorkplan(db) {
  let changed = false;
  if (!db.shiftPlans || typeof db.shiftPlans !== "object") {
    db.shiftPlans = {};
    changed = true;
  }
  if (!Array.isArray(db.leaves)) {
    db.leaves = [];
    changed = true;
  }
  if (!Array.isArray(db.cardAttempts)) {
    db.cardAttempts = [];
    changed = true;
  }
  return changed;
}

/** A week is seven shift kinds indexed by weekday, Sunday first. */
export function cleanWeek(days) {
  if (!Array.isArray(days) || days.length !== 7 || !days.every((day) => SHIFT_KINDS.includes(day))) return null;
  return [...days];
}

const PLAN_HISTORY = 4;

/**
 * A plan body is either { days: [7 kinds] } for a repeating week, or { rotation: { start, from?, pattern? } }
 * for a 28-day cycle (see ROTATIONS) anchored at `start` and in force from `from`. A rotation keeps the plan
 * it replaced so attendance before `from` is still judged against it. A rotation that took effect `today`
 * and is replaced the same day counts as a correction and is dropped from that history.
 * `patterns` lists the cycles this person may work; the first one is used when none is given.
 */
export function cleanPlan(body, previous, today, patterns = ["dn", "nd"]) {
  if (body?.rotation === undefined) return cleanWeek(body?.days);
  const start = String(body.rotation?.start ?? "");
  const from = body.rotation?.from === undefined ? start : String(body.rotation.from);
  const pattern = body.rotation?.pattern === undefined ? patterns[0] : String(body.rotation.pattern);
  if (!isoDate(start) || !isoDate(from) || from < start || !patterns.includes(pattern) || !ROTATIONS[pattern]) return null;
  const cutoff = today && today < from ? today : from;
  let before = previous;
  while (before && !Array.isArray(before) && (before.from || before.start) >= cutoff) before = before.before;
  const history = trimPlan(before, PLAN_HISTORY);
  return { type: "rotation", start, ...(from !== start ? { from } : {}), ...patternField(pattern), ...(history ? { before: history } : {}) };
}

const patternField = (pattern) => (pattern && pattern !== "dn" && ROTATIONS[pattern] ? { pattern } : {});

function trimPlan(plan, depth) {
  if (cleanWeek(plan)) return [...plan];
  if (!plan || plan.type !== "rotation" || !isoDate(plan.start)) return null;
  const before = depth > 1 ? trimPlan(plan.before, depth - 1) : null;
  return { type: "rotation", start: plan.start, ...(plan.from ? { from: plan.from } : {}), ...patternField(plan.pattern), ...(before ? { before } : {}) };
}

/** Human resources works day shifts only; everyone else rotates through days and nights. */
export function patternsFor(role) {
  return role === "hr" ? ["dd"] : ["dn", "nd"];
}

export function isoDate(value) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(text);
}

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export function leaveRequest(body, { uid, today, leaves = [], now = Date.now() }) {
  const type = String(body?.type ?? "");
  const from = String(body?.from ?? "");
  const to = String(body?.to ?? "");
  const note = String(body?.note ?? "").replace(/\s+/g, " ").trim();
  if (!LEAVE_TYPES.includes(type)) return { error: "Хүсэлтийн төрөл буруу" };
  if (!isoDate(from) || !isoDate(to)) return { error: "Огноо буруу" };
  if (to < from) return { error: "Дуусах огноо эхлэх огнооноос өмнө байна" };
  if (daysBetween(from, to) + 1 > MAX_LEAVE_DAYS) return { error: `Нэг хүсэлт ${MAX_LEAVE_DAYS} хоногоос урт байж болохгүй` };
  if (daysBetween(from, today) > PAST_LIMIT_DAYS) return { error: `${PAST_LIMIT_DAYS} хоногоос өмнөх өдөрт хүсэлт гаргах боломжгүй` };
  if (daysBetween(today, to) > FUTURE_LIMIT_DAYS) return { error: "Хэт хол хугацаанд хүсэлт гаргах боломжгүй" };
  if (note.length > 200 || /[<>\p{Cc}]/u.test(note)) return { error: "Тайлбар 200 тэмдэгтээс ихгүй, < > тэмдэггүй байна" };
  if (leaves.some((item) => item.uid === uid && item.status !== "rejected" && item.from <= to && from <= item.to)) {
    return { error: "Энэ хугацаанд өөр хүсэлт бүртгэлтэй байна" };
  }
  return { leave: { id: `lv_${randomBytes(6).toString("hex")}`, uid, type, from, to, note, status: "pending", at: new Date(now).toISOString() } };
}

export function pruneLeaves(leaves, today) {
  return leaves.filter((item) => daysBetween(item.to, today) <= LEAVE_KEEP_DAYS).slice(-500);
}

// Cards stay usable this long after the last shift ends (to check out) and before the next one starts.
const REST_GRACE_MS = 3 * 3600 * 1000;
// Gaps longer than this are a rest block, not the ordinary break between shifts or the day→night switch.
const REST_GAP_MS = 36 * 3600 * 1000;

/** The rest block a rotation user is in right now, or null while they are working or near a shift. */
export function restBlock(plan, now) {
  if (!isRotation(plan)) return null;
  const today = shiftDateOf(now);
  if (today < rotationFrom(plan)) return null;
  let previous = null;
  let next = null;
  for (let ahead = -3; ahead <= 30 && !next; ahead += 1) {
    const date = addDays(today, ahead);
    const kind = plannedKind(plan, date);
    if (kind === "off") continue;
    const span = shiftSpan(date, kind);
    if (span.end <= now) previous = span;
    else next = { ...span, date, kind };
  }
  if (!next || next.start - now <= REST_GRACE_MS) return null;
  if (previous && now - previous.end < REST_GRACE_MS) return null;
  if (previous && next.start - previous.end < REST_GAP_MS) return null;
  return { until: next.date, kind: next.kind, resumeAt: next.start - REST_GRACE_MS };
}

/**
 * Card changes the rotation implies: suspend at the start of a rest block, resume before the next shift.
 * Only cards suspended this way are resumed; an admin's manual status wins until the block ends.
 */
export function restUpdates(users, plans, now) {
  const changes = [];
  for (const user of users || []) {
    if (!STAFF_ROLES.includes(user.role) || !user.card) continue;
    const { card } = user;
    const block = restBlock(plans?.[user.id], now);
    if (block) {
      if (card.status === "ACTIVE" && card.restHold !== block.until) changes.push({ id: user.id, type: "suspend", ...block });
      else if (card.status === "SUSPENDED" && card.restUntil && card.restUntil !== block.until) changes.push({ id: user.id, type: "extend", ...block });
    } else if (card.restUntil) {
      changes.push({ id: user.id, type: "resume" });
    } else if (card.restHold) {
      changes.push({ id: user.id, type: "release" });
    }
  }
  return changes;
}

export function applyRestUpdate(card, change) {
  if (change.type === "suspend" || change.type === "extend") {
    card.status = "SUSPENDED";
    card.restUntil = change.until;
    delete card.restHold;
  } else if (change.type === "resume") {
    if (card.status === "SUSPENDED") card.status = "ACTIVE";
    delete card.restUntil;
    delete card.restHold;
  } else if (change.type === "release") {
    delete card.restHold;
  }
}

export function noteAttempt(attempts, uid, verdict, now = Date.now()) {
  if (!ATTEMPT_REASONS.includes(verdict.reason)) return attempts;
  const next = [...attempts, { uid, at: new Date(now).toISOString(), reason: verdict.reason }];
  return next.filter((item) => now - Date.parse(item.at) < ATTEMPT_KEEP_MS).slice(-300);
}
