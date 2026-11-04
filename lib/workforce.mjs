// The workforce at a glance for human resources and the control centre: who is on which shift, on leave or on site.
import { STAFF_ROLES } from "./auth.mjs";
import { POSITIONS } from "../public/js/minecore.js";
import { LEAVE_LABEL, addDays, leaveOn, plannedKind, shiftDateOf } from "../public/js/workstats.js";

const FORECAST_DAYS = 7;

/** Today's staff split by shift, leave and on-site presence, by department and position, and the next week's planned crews. */
export function workforceOf(db, now = Date.now()) {
  const staff = (db.users || []).filter((user) => STAFF_ROLES.includes(user.role));
  const date = shiftDateOf(now);
  const people = db.attendance?.people || {};
  const inside = (uid) => people[uid]?.state === "in";
  const kindOn = (uid, day) => (leaveOn(db.leaves, uid, day) ? "leave" : plannedKind(db.shiftPlans?.[uid], day));
  const today = { day: 0, night: 0, off: 0, leave: 0 };
  const leave = Object.fromEntries(Object.keys(LEAVE_LABEL).map((key) => [key, 0]));
  for (const user of staff) {
    const kind = kindOn(user.id, date);
    today[kind in today ? kind : "off"] += 1;
    const away = leaveOn(db.leaves, user.id, date);
    if (away && away.type in leave) leave[away.type] += 1;
  }
  const posts = db.ops?.posts || [];
  const postOf = new Map(posts.map((post) => [post.uid, post]));
  const ids = new Set(staff.map((user) => user.id));
  const tally = (groups) =>
    [...groups.entries()]
      .map(([name, members]) => ({ name, total: members.length, onSite: members.filter(inside).length }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "mn"));
  const byDept = new Map((db.ops?.depts || []).map((dept) => [dept.id, { name: dept.name, members: [] }]));
  const byPosition = new Map();
  const unplaced = [];
  for (const uid of ids) {
    const post = postOf.get(uid);
    const dept = post?.dept && byDept.get(post.dept);
    if (dept) dept.members.push(uid);
    else unplaced.push(uid);
    const position = POSITIONS[post?.position] || "Тодорхойгүй";
    byPosition.set(position, [...(byPosition.get(position) || []), uid]);
  }
  const deptGroups = new Map([...byDept.values()].filter((dept) => dept.members.length).map((dept) => [dept.name, dept.members]));
  if (unplaced.length) deptGroups.set("Хэлтэсгүй", unplaced);
  const forecast = Array.from({ length: FORECAST_DAYS }, (_, index) => {
    const day = addDays(date, index);
    const counts = { date: day, day: 0, night: 0, off: 0, leave: 0 };
    for (const user of staff) {
      const kind = kindOn(user.id, day);
      counts[kind in counts ? kind : "off"] += 1;
    }
    return counts;
  });
  return {
    date,
    total: staff.length,
    onSite: staff.filter((user) => inside(user.id)).length,
    today,
    leave,
    departments: tally(deptGroups),
    positions: tally(byPosition),
    forecast,
  };
}
