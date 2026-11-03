// Movement permits shared by the server and the pages: leaving the mine area during a rotation, and arriving or
// leaving outside one's rotation. Who approves and who sees each kind, and the status every page derives from it.

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const PASS_KINDS = { exit: "Уурхайн бүсээс гарах", arrive: "Ээлжийн бусаар ирэх", depart: "Ээлжийн бусаар буух" };
export const PASS_SHORT = { exit: "Бүсээс гарах", arrive: "Ээлжийн бус ирэх", depart: "Ээлжийн бус буух" };
export const APPROVER_LABEL = { hr: "Хүний нөөц", engineer: "Уулын ахлах" };
/** Everyone listed must approve; one refusal refuses the request. */
export const PASS_APPROVERS = { exit: ["engineer"], arrive: ["hr", "engineer"], depart: ["hr", "engineer"] };
export const PASS_VIEWERS = {
  exit: ["engineer", "security"],
  arrive: ["hr", "engineer", "campmgr", "security"],
  depart: ["hr", "engineer", "campmgr", "security"],
};
export const PASS_ROLES = ["engineer", "hr", "campmgr", "security"];
export const PASS_STATUS = { pending: "Хүлээгдэж байна", approved: "Зөвшөөрсөн", rejected: "Татгалзсан", expired: "Хугацаа дууссан", done: "Дууссан" };
/** What the gate records for each kind, in order. */
export const GATE_STEPS = { exit: ["out", "in"], arrive: ["in"], depart: ["out"] };
export const GATE_LABEL = { out: "Гарсан", in: "Орсон" };
export const EXIT_MAX_HOURS = 72;
export const PASS_AHEAD_DAYS = 60;
export const PASS_REASON_MAX = 200;

const PLAIN = /[<>\u0000-\u001f\u007f]/;

function moment(value) {
  const text = String(value ?? "").trim();
  const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? Date.parse(`${text}:00+08:00`) : Date.parse(text);
  return Number.isFinite(ms) && text ? ms : null;
}

function cleanText(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max && !PLAIN.test(text) ? text : null;
}

/** Checks a worker's request; returns { pass } with the fields to store, or { error }. */
export function checkPass(body, now = Date.now()) {
  const kind = String(body?.kind || "");
  if (!Object.hasOwn(PASS_KINDS, kind)) return { error: "Хүсэлтийн төрөл буруу" };
  const from = moment(body.from);
  if (from == null) return { error: kind === "exit" ? "Гарах цагаа оруулна уу" : kind === "arrive" ? "Ирэх цагаа оруулна уу" : "Буух цагаа оруулна уу" };
  if (from < now - HOUR_MS) return { error: "Өнгөрсөн цагт хүсэлт гаргах боломжгүй" };
  if (from > now + PASS_AHEAD_DAYS * DAY_MS) return { error: `${PASS_AHEAD_DAYS} хоногоос хэтэрсэн хугацаанд хүсэлт гаргах боломжгүй` };
  let until = null;
  if (kind === "exit") {
    until = moment(body.until);
    if (until == null) return { error: "Буцаж ирэх цагаа оруулна уу" };
    if (until <= from) return { error: "Буцаж ирэх цаг гарах цагаас хойш байна" };
    if (until - from > EXIT_MAX_HOURS * HOUR_MS) return { error: `Бүсээс ${EXIT_MAX_HOURS} цагаас удаан гарах бол ээлжийн бусаар буух хүсэлт гаргана уу` };
  }
  const reason = cleanText(body.reason, PASS_REASON_MAX);
  if (reason === null) return { error: `Шалтгаан ${PASS_REASON_MAX}-аас ихгүй тэмдэгт, < > тэмдэггүй` };
  if (reason.length < 3) return { error: "Шалтгаанаа бичнэ үү" };
  const place = kind === "exit" ? cleanText(body.place, 80) : "";
  if (place === null) return { error: "Очих газар 80-аас ихгүй тэмдэгт" };
  return { pass: { kind, from: new Date(from).toISOString(), until: until == null ? null : new Date(until).toISOString(), reason, place: place || null } };
}

export const isRefused = (pass) => Object.values(pass.decisions || {}).some((item) => item && !item.ok);
export const isApproved = (pass) => !isRefused(pass) && PASS_APPROVERS[pass.kind].every((role) => pass.decisions?.[role]?.ok);

/** pending → approved → done (every gate step recorded); refused, or expired when its time passed unused. */
export function passStatus(pass, now = Date.now()) {
  if (isRefused(pass)) return "rejected";
  if (isApproved(pass)) {
    if (GATE_STEPS[pass.kind].every((step) => pass.gate?.[step])) return "done";
    if (pass.kind === "exit" && !pass.gate?.out && Date.parse(pass.until) < now) return "expired";
    return "approved";
  }
  const end = pass.kind === "exit" ? Date.parse(pass.until) : Date.parse(pass.from) + DAY_MS;
  return end < now ? "expired" : "pending";
}

/** The gate step security records next, or null when the pass is not usable at the gate. */
export function nextGate(pass, now = Date.now()) {
  if (passStatus(pass, now) !== "approved") return null;
  return GATE_STEPS[pass.kind].find((step) => !pass.gate?.[step]) || null;
}

/** Out of the mine area past the time they said they would be back. */
export const isLate = (pass, now = Date.now()) => pass.kind === "exit" && Boolean(pass.gate?.out) && !pass.gate?.in && Date.parse(pass.until) < now;

/** Waiting for this role's decision. */
export const awaits = (pass, role, now = Date.now()) => PASS_APPROVERS[pass.kind].includes(role) && !pass.decisions?.[role] && passStatus(pass, now) === "pending";

export const canSee = (pass, role) => PASS_VIEWERS[pass.kind].includes(role);
