// The camp manager's records: rooms and beds, crew transport, contractors, payroll hours and camp cameras.
import { STAFF_ROLES } from "./auth.mjs";
import { createRecord, ensureMine } from "./mine.mjs";
import { COLLECTIONS, currentShift, localDay } from "../public/js/minecore.js";
import { shiftDateOf } from "../public/js/workstats.js";

export const CAMP_ROLE = "campmgr";
export const CAMP_COLLECTIONS = Object.keys(COLLECTIONS).filter((name) => COLLECTIONS[name].area === "camp");
export const CAMP_SEED_VERSION = 1;

const DEMO_CAMERAS = [
  ["Гол хаалга · КПП", "gate", "Орох, гарах хяналт"],
  ["А байрны орц", "dorm", ""],
  ["Б байрны коридор", "dorm", ""],
  ["Хоолны танхим", "canteen", ""],
  ["Автобусны зогсоол", "parking", "Ээлж солих тээвэр"],
  ["Баруун хашаа", "perimeter", "Шөнийн хөдөлгөөн"],
];

/** Adds the demo cameras once, after the mine demo data exists; returns how many it added, or null. */
export function seedCamp(db, now = Date.now()) {
  if (!db.mineSeed || db.campSeed?.version >= CAMP_SEED_VERSION) return null;
  ensureMine(db);
  let added = 0;
  for (const [name, zone, note] of DEMO_CAMERAS) {
    if (db.camp.cameras.some((item) => item.name === name)) continue;
    if (!createRecord(db, "cameras", { name, zone, kind: "demo", enabled: true, note }, { by: "seed", now }).error) added += 1;
  }
  db.campSeed = { version: CAMP_SEED_VERSION, at: new Date(now).toISOString(), added };
  return { added };
}

/** What the camp pages show: shift staff with their rotations and leave, the camp records and job titles. */
export function campView(db, now = Date.now()) {
  ensureMine(db);
  const staff = (db.users || []).filter((user) => STAFF_ROLES.includes(user.role));
  const ids = new Set(staff.map((user) => user.id));
  return {
    now: new Date(now).toISOString(),
    today: localDay(now),
    shiftDate: shiftDateOf(now),
    shift: currentShift(now),
    users: staff.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      title: user.title || "",
      role: user.role,
      card: { idNumber: user.card?.idNumber || "", status: user.card?.status || "", clearance: user.card?.clearance || 1, restUntil: user.card?.restUntil || null },
    })),
    people: Object.fromEntries(Object.entries(db.attendance?.people || {}).filter(([uid]) => ids.has(uid))),
    plans: Object.fromEntries(Object.entries(db.shiftPlans || {}).filter(([uid]) => ids.has(uid))),
    leaves: (db.leaves || []).filter((item) => item.status === "approved" && ids.has(item.uid)),
    camp: db.camp,
    ops: { posts: db.ops.posts },
  };
}
