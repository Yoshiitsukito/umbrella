// Who changed what and when: before/after values of every edit, full copies of deleted records, logins and the
// other actions people take. Kept under one top-level key per day (a further shard when a day fills up), so each
// Firestore document stays well under its 1 MB limit.
import { randomBytes } from "node:crypto";
import { localDay } from "../public/js/minecore.js";

export const AUDIT_PREFIX = "audit_";
export const KEEP_DAYS = 400;
export const ACTIONS = ["create", "update", "delete", "restore", "login", "login-fail", "password", "call", "backup", "restore-db"];
const SHARD_ENTRIES = 300;
const SHARD_BYTES = 600_000;
const SNAPSHOT_BYTES = 12_000;
const MAX_STRING = 300;
const MAX_ITEMS = 30;
const MAX_KEYS = 40;
const MAX_DEPTH = 4;
const DAY_MS = 24 * 3600 * 1000;
/** Field names whose values never go into the log. */
const SECRET = /^(pass|password|secret|token|cardKey|apiKey|privateKey|p256dh|auth|keys)$/i;
const SKIP_FIELDS = new Set(["updatedAt", "updatedBy"]);
const SHARD = /^audit_(\d{4}-\d{2}-\d{2})(?:_(\d+))?$/;

const newId = () => `aud_${randomBytes(6).toString("hex")}`;
const shardKey = (day, n) => `${AUDIT_PREFIX}${day}${n > 1 ? `_${n}` : ""}`;

/** A short copy for the log: long text cut, files and secrets hidden, deep or long structures trimmed. */
export function compact(value, depth = 0) {
  if (typeof value === "string") {
    if (value.startsWith("data:")) return "[файл]";
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `[${value.length}]`;
    const list = value.slice(0, MAX_ITEMS).map((item) => compact(item, depth + 1));
    if (value.length > MAX_ITEMS) list.push(`… +${value.length - MAX_ITEMS}`);
    return list;
  }
  if (value && typeof value === "object") {
    if (depth >= MAX_DEPTH) return "{…}";
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_KEYS)
        .map(([key, item]) => [key, SECRET.test(key) ? "•••" : compact(item, depth + 1)]),
    );
  }
  return value ?? null;
}

/** The record without secrets and embedded files, otherwise whole, so it can be put back. */
function scrub(value) {
  if (typeof value === "string") return value.startsWith("data:") ? null : value;
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET.test(key)).map(([key, item]) => [key, scrub(item)]));
  return value;
}

/** A deleted record kept whole when small enough to restore, otherwise trimmed and marked partial. */
export function snapshotOf(record) {
  const clean = scrub(record);
  return JSON.stringify(clean).length <= SNAPSHOT_BYTES ? { snapshot: clean } : { snapshot: compact(clean), partial: true };
}

/** Field by field what changed: { field: [before, after] }, secrets shown only as changed. */
export function diffRecords(before, after) {
  const changes = {};
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (SKIP_FIELDS.has(key)) continue;
    const old = before?.[key] ?? null;
    const now = after?.[key] ?? null;
    if (JSON.stringify(old) === JSON.stringify(now)) continue;
    changes[key] = SECRET.test(key) ? ["•••", "•••"] : [compact(old), compact(now)];
  }
  return changes;
}

function shardsOf(db) {
  return Object.keys(db)
    .map((key) => {
      const match = SHARD.exec(key);
      return match && Array.isArray(db[key]) ? { key, day: match[1], n: Number(match[2] || 1) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.day.localeCompare(a.day) || b.n - a.n);
}

export function pruneAudit(db, now = Date.now()) {
  const cutoff = localDay(now - KEEP_DAYS * DAY_MS);
  let removed = 0;
  for (const shard of shardsOf(db)) {
    if (shard.day >= cutoff) continue;
    delete db[shard.key];
    removed += 1;
  }
  return removed;
}

let prunedOn = "";

/**
 * Appends one entry: { by, who, role, action, area, collection, target, label, changes, snapshot, partial,
 * method, path, body, ip, note }. Missing fields are left out. Returns the stored entry.
 */
export function auditLog(db, entry, now = Date.now()) {
  const day = localDay(now);
  if (prunedOn !== day) {
    pruneAudit(db, now);
    prunedOn = day;
  }
  const item = { id: newId(), at: new Date(now).toISOString() };
  for (const [key, value] of Object.entries(entry)) if (value !== undefined && value !== null && value !== "") item[key] = value;
  let n = 1;
  while (Array.isArray(db[shardKey(day, n + 1)])) n += 1;
  const current = db[shardKey(day, n)];
  if (Array.isArray(current) && (current.length >= SHARD_ENTRIES || JSON.stringify(current).length > SHARD_BYTES)) n += 1;
  const key = shardKey(day, n);
  if (!Array.isArray(db[key])) db[key] = [];
  db[key].push(item);
  return item;
}

/** Entries newest first between two local days (inclusive), filtered by person, action and free text. */
export function auditList(db, { from, to, by = "", action = "", q = "", limit = 500 } = {}) {
  const query = String(q || "").trim().toLowerCase();
  const out = [];
  for (const shard of shardsOf(db)) {
    if ((to && shard.day > to) || (from && shard.day < from)) continue;
    for (let index = db[shard.key].length - 1; index >= 0; index -= 1) {
      const item = db[shard.key][index];
      if (by && item.by !== by) continue;
      if (action && item.action !== action) continue;
      if (query && !JSON.stringify(item).toLowerCase().includes(query)) continue;
      out.push(item);
      if (out.length >= limit) return { entries: out, more: true };
    }
  }
  out.sort((a, b) => b.at.localeCompare(a.at));
  return { entries: out, more: false };
}

export function auditDays(db) {
  return [...new Set(shardsOf(db).map((shard) => shard.day))];
}

export function findAudit(db, id) {
  for (const shard of shardsOf(db)) {
    const item = db[shard.key].find((entry) => entry.id === id);
    if (item) return item;
  }
  return null;
}

/** A request body made safe for the log: no passwords, tokens or embedded files. */
export function bodySummary(body) {
  if (!body || typeof body !== "object" || !Object.keys(body).length) return undefined;
  return compact(body);
}
