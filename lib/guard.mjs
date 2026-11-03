// The security officers' records: violations they report, which the MASTER's HSE page reviews and acts on,
// and the gate counts from movement permits.
import { STAFF_ROLES } from "./auth.mjs";
import { ensureMine } from "./mine.mjs";
import { ensurePasses } from "./passes.mjs";
import { personalOf, pushNotice } from "./personal.mjs";
import { COLLECTIONS, MEASURES, VIOLATION_KINDS, VIOLATION_STATUS, currentShift, localDay } from "../public/js/minecore.js";
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

/**
 * HSE's decision on a reported violation: taken up for review, acted on with a measure, or dismissed. A worker
 * who is acted against is told which measure was taken.
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
  const informed = item.hseStatus === "acted" && item.measure === measure;
  Object.assign(item, { hseStatus: status, measure, hseNote: note || null, hseBy: me.displayName || "", hseAt: new Date(now).toISOString() });
  if (status === "acted" && !informed && item.party === "staff" && db.users.some((user) => user.id === item.uid)) {
    const date = item.at ? localDay(Date.parse(item.at)).slice(5).replace("-", ".") : "";
    pushNotice(personalOf(db, item.uid), "hse", `Хамгаалалтын зөрчил (${VIOLATION_KINDS[item.kind]}, ${date}): ХАБЭА «${MEASURES[measure]}» арга хэмжээ авлаа.${note ? ` ${note}` : ""}`, now);
  }
  return { ok: true, item };
}
