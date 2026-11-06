// Copies of the whole database as gzip JSON: one automatically every day, manual ones from the admin page and one
// before every restore. BACKUP_DIR can point at a persistent disk; Firestore's own managed backups live in firebase.mjs.
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { AUDIT_PREFIX } from "./audit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REASONS = ["auto", "manual", "restore", "upload"];
const NAME = /^umbrella-(\d{8})-(\d{6})-(auto|manual|restore|upload)\.json\.gz$/;
export const MAX_UPLOAD = 80 * 1024 * 1024;

export function backupDir(env = process.env) {
  return path.resolve(root, env.BACKUP_DIR || path.join("data", "backups"));
}

export function backupSettings(env = process.env) {
  const hours = Number(env.BACKUP_EVERY_HOURS);
  const keep = Number(env.BACKUP_KEEP);
  return { everyMs: (Number.isFinite(hours) && hours >= 1 ? hours : 24) * 3600 * 1000, keep: Number.isInteger(keep) && keep >= 1 ? keep : 14 };
}

export function backupName(now, reason) {
  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `umbrella-${stamp}-${reason}.json.gz`;
}

export function parseName(name) {
  const match = NAME.exec(String(name || ""));
  if (!match) return null;
  const [, date, time, reason] = match;
  const at = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4)}Z`);
  return { name, reason, at };
}

/** `db` may already be its JSON text, taken under the store lock so the copy is consistent. */
export async function writeBackup(db, { dir = backupDir(), reason = "manual", now = Date.now() } = {}) {
  await mkdir(dir, { recursive: true });
  const data = gzipSync(typeof db === "string" ? db : JSON.stringify(db));
  let name = backupName(now, reason);
  for (let bump = 1; await stat(path.join(dir, name)).then(() => true, () => false); bump += 1) name = backupName(now + bump * 1000, reason);
  await writeFile(path.join(dir, name), data);
  return { name, size: data.length, at: parseName(name).at, reason };
}

export async function listBackups(dir = backupDir()) {
  const names = await readdir(dir).catch(() => []);
  const list = [];
  for (const name of names) {
    const info = parseName(name);
    if (!info) continue;
    const size = await stat(path.join(dir, name)).then((item) => item.size, () => 0);
    list.push({ ...info, size });
  }
  return list.sort((a, b) => b.at - a.at);
}

/** Keeps the newest `keep` copies of each kind. */
export async function pruneBackups(dir = backupDir(), keep = 14) {
  const list = await listBackups(dir);
  let removed = 0;
  for (const reason of REASONS) {
    for (const item of list.filter((entry) => entry.reason === reason).slice(keep)) {
      await unlink(path.join(dir, item.name)).catch(() => {});
      removed += 1;
    }
  }
  return removed;
}

export function backupDue(list, everyMs, now = Date.now()) {
  return !list.some((item) => item.reason === "auto" && now - item.at < everyMs);
}

/** The file's bytes; only names this module writes are accepted, so no path can escape the folder. */
export async function readBackup(name, dir = backupDir()) {
  if (!parseName(name)) return null;
  return readFile(path.join(dir, name)).catch(() => null);
}

/** A backup file's database, or an error: gzip or plain JSON with users (an admin among them) and a secret. */
export function parseBackup(buffer) {
  let db;
  try {
    const raw = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer, { maxOutputLength: MAX_UPLOAD * 8 }) : buffer;
    db = JSON.parse(raw.toString("utf8"));
  } catch {
    return { error: "Нөөцийн файл уншигдсангүй (gzip эсвэл JSON биш)" };
  }
  if (!db || typeof db !== "object" || Array.isArray(db)) return { error: "Нөөцийн файлын бүтэц буруу" };
  if (!Array.isArray(db.users) || !db.users.some((user) => user?.role === "admin")) return { error: "Нөөцөд админ хэрэглэгч алга" };
  if (typeof db.secret !== "string" || !db.secret) return { error: "Нөөцийн файл дутуу байна" };
  return { db };
}

/**
 * The database to switch to: the backup's data, but this server's session secret and push keys (so nobody is
 * logged out), the full change history from both, and the current delivery log.
 */
export function mergeRestore(current, incoming) {
  const next = structuredClone(incoming);
  next.secret = current.secret;
  if (current.vapid) next.vapid = current.vapid;
  for (const key of Object.keys(current)) if (key.startsWith(AUDIT_PREFIX)) next[key] = current[key];
  if (current.deliveries) next.deliveries = current.deliveries;
  return next;
}
