// The security officers' records: violations they report, which the HSE manager reviews, acts on and sends on,
// and the gate counts from movement permits.
import { STAFF_ROLES } from "./auth.mjs";
import { ensureMine } from "./mine.mjs";
import { ensurePasses } from "./passes.mjs";
import { personalOf, pushNotice } from "./personal.mjs";
import { COLLECTIONS, HSE_ROUTES, MEASURES, VIOLATION_KINDS, VIOLATION_STATUS, VIOLATORS, currentShift, localDay } from "../public/js/minecore.js";
import { isLate, nextGate, passStatus } from "../public/js/passcore.js";
import { shiftDateOf } from "../public/js/workstats.js";

export const GUARD_ROLE = "security";
export const GUARD_COLLECTIONS = Object.keys(COLLECTIONS).filter((name) => COLLECTIONS[name].area === "guard");
const NOTE_MAX = 300;

/** What the security page shows: shift staff to name in a report, the violations, and who is out at the gate. */
export function guardView(db, now = Date.now()) {
  ensureMine(db);
  const passes = ensurePasses(db);
  const staff = (db.users || []).filter((user) => STAFF_ROLES.includes(user.role));
  return {
    now: new Date(now).toISOString(),
    today: localDay(now),
    shiftDate: shiftDateOf(now),
    shift: currentShift(now),
    users: staff.map((user) => ({ id: user.id, displayName: user.displayName, title: user.title || "", role: user.role, card: { idNumber: user.card?.idNumber || "" } })),
    guard: db.guard,
    gate: {
      out: passes.filter((pass) => pass.kind === "exit" && pass.gate?.out && !pass.gate?.in).length,
      late: passes.filter((pass) => isLate(pass, now)).length,
      ready: passes.filter((pass) => nextGate(pass, now)).length,
      pending: passes.filter((pass) => passStatus(pass, now) === "pending").length,
    },
  };
}

/** The people one route reaches: everyone holding that role, or the head of the violator's department. */
function routeUsers(db, item, route) {
  if (route !== "head") return (db.users || []).filter((user) => user.role === route).map((user) => user.id);
  const post = item.party === "staff" ? (db.ops?.posts || []).find((entry) => entry.uid === item.uid) : null;
  const head = post && (db.ops?.depts || []).find((dept) => dept.id === post.dept)?.head;
  return head ? [head] : [];
}

/**
 * HSE's decision on a reported violation: taken up for review, acted on with a measure, or dismissed. A worker
 * who is acted against is told which measure was taken, and each chosen route hears the decision once: again only
 * when the decision itself changes.
 */
export function decideViolation(db, id, body, me, now = Date.now()) {
  ensureMine(db);
  const item = db.guard.violations.find((entry) => entry.id === id);
  if (!item) return { error: "Зөрчил олдсонгүй", status: 404 };
  const status = String(body?.status || "");
  if (!Object.hasOwn(VIOLATION_STATUS, status) || status === "new") return { error: "Шийдвэр буруу байна" };
  const measure = status === "acted" ? String(body.measure || "") : null;
  if (status === "acted" && !Object.hasOwn(MEASURES, measure)) return { error: "Авах арга хэмжээгээ сонгоно уу" };
  const note = String(body.note ?? "").replace(/\s+/g, " ").trim();
  if (note.length > NOTE_MAX || /[<>]/.test(note)) return { error: `Тайлбар ${NOTE_MAX}-аас ихгүй тэмдэгт, < > тэмдэггүй` };
  if (status === "dismissed" && !note) return { error: "Үндэслэлгүй гэж үзсэн шалтгаанаа бичнэ үү" };
  const routes = [...new Set(Array.isArray(body.routes) ? body.routes.map(String) : [])];
  if (routes.some((route) => !Object.hasOwn(HSE_ROUTES, route))) return { error: "Илгээх хэсэг буруу байна" };
  const informed = item.hseStatus === "acted" && item.measure === measure;
  const same = item.hseStatus === status && item.measure === measure;
  const heard = same ? new Set(item.routes || []) : new Set();
  Object.assign(item, { hseStatus: status, measure, hseNote: note || null, hseBy: me.displayName || "", hseAt: new Date(now).toISOString(), routes });
  const date = item.at ? localDay(Date.parse(item.at)).slice(5).replace("-", ".") : "";
  if (status === "acted" && !informed && item.party === "staff" && db.users.some((user) => user.id === item.uid)) {
    pushNotice(personalOf(db, item.uid), "hse", `Хамгаалалтын зөрчил (${VIOLATION_KINDS[item.kind]}, ${date}): ХАБЭА «${MEASURES[measure]}» арга хэмжээ авлаа.${note ? ` ${note}` : ""}`, now);
  }
  const who = item.party === "staff" ? db.users.find((user) => user.id === item.uid)?.displayName || VIOLATORS.staff : item.person || VIOLATORS[item.party];
  const verdict = measure ? `${VIOLATION_STATUS[status]} · ${MEASURES[measure]}` : VIOLATION_STATUS[status];
  const text = `ХАБЭА-ын шийдвэр: ${VIOLATION_KINDS[item.kind]}, ${who} (${date}) — ${verdict}.${note ? ` ${note}` : ""}`;
  const recipients = new Set(routes.filter((route) => !heard.has(route)).flatMap((route) => routeUsers(db, item, route)));
  recipients.delete(me.id);
  if (item.party === "staff") recipients.delete(item.uid);
  for (const uid of recipients) pushNotice(personalOf(db, uid), "hse", text, now);
  return { ok: true, item, sent: recipients.size };
}
