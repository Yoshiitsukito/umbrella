// MASTER pages (mine board, safety, competency, operations), the camp manager's camp page, the security officers'
// violations page, and the safety strip on a worker's home page. Tables and forms are drawn from the shared schema in minecore.js, so the server checks exactly what is shown.
import {
  ALCOHOL_LIMIT,
  BLAST_STATUS,
  CAMERA_KINDS,
  CAMERA_ZONES,
  CAPA_STATUS,
  CERT_TYPES,
  COLLECTIONS,
  CONTRACT_STATUS,
  EQUIP_CERT,
  EQUIP_STATUS,
  EQUIP_TYPES,
  INCIDENT_KINDS,
  INCIDENT_STATUS,
  INDUCTION_ITEMS,
  MEASURES,
  MEDICAL_RESULTS,
  PERMIT_STATUS,
  PERMIT_TYPES,
  POSITIONS,
  PRESTART_LABELS,
  CRITICAL_ITEMS,
  PRIORITIES,
  SEVERITIES,
  SHIFTS,
  SOS_KINDS,
  SOS_STATUS,
  VIOLATION_KINDS,
  VIOLATION_STATUS,
  VIOLATORS,
  VISITOR_KINDS,
  WO_STATUS,
  WX_METRICS,
  crewChange,
  defaultValue,
  expiryState,
  fieldShown,
  localInput,
  needsBed,
  permitState,
  ppeDue,
  prestartFails,
  riskLevel,
  serviceDue,
  validCert,
  visitorReady,
  wxValue,
} from "./minecore.js";
import { addDays } from "./workstats.js";
import { mountFeeds, snapshotOf, stopFeeds } from "./campcams.js";

export const MASTER_VIEWS = ["mine", "hse", "skills", "ops"];
export const CAMP_VIEWS = ["camp"];
export const GUARD_VIEWS = ["guard"];
const MINE_VIEWS = [...MASTER_VIEWS, ...CAMP_VIEWS, ...GUARD_VIEWS];
export const CAMP_ROLE = "campmgr";
const GUARD_ROLE = "security";
const isCamp = () => ctx?.state.me?.role === CAMP_ROLE;
const isGuard = () => ctx?.state.me?.role === GUARD_ROLE;
const apiBase = () => (isCamp() ? "/api/camp" : isGuard() ? "/api/guard" : "/api/master");

const TABS = {
  hse: [
    ["incidents", "Осол, аюул", "alert"],
    ["violations", "Зөрчил", "shield"],
    ["capa", "CAPA", "clipboard"],
    ["talks", "Зааварчилгаа", "megaphone"],
    ["permits", "Зөвшөөрөл", "permit"],
    ["risks", "Эрсдэл", "gauge"],
    ["jsas", "JSA", "steps"],
    ["alcohol", "Согтуурал", "flask"],
    ["ppe", "ХХХ", "vest"],
    ["blasts", "Тэсэлгээ", "blast"],
    ["weather", "Цаг агаар", "cloud"],
    ["emergency", "SOS, цуглаан", "siren"],
  ],
  skills: [
    ["people", "Картын хориг", "lock"],
    ["certs", "Гэрчилгээ", "award"],
    ["medicals", "Эрүүл мэнд", "heart"],
    ["visitors", "Түр нэвтрэх", "visitor"],
  ],
  ops: [
    ["board", "Самбар", "grid"],
    ["equipment", "Техник", "truck"],
    ["assigns", "Хуваарилалт", "assign"],
    ["prestarts", "Pre-start", "checklist"],
    ["workorders", "Засвар", "wrench"],
    ["fuel", "Түлш", "fuel"],
    ["stock", "Агуулах", "box"],
    ["moves", "Орлого, зарлага", "swap"],
    ["handovers", "Ээлж хүлээлцэх", "repeat"],
    ["org", "Бүтэц", "sitemap"],
  ],
  camp: [
    ["cameras", "Камер", "cctv"],
    ["rooms", "Өрөө", "bed"],
    ["transport", "Ээлжийн тээвэр", "bus"],
    ["payroll", "Цалингийн тайлан", "wallet"],
    ["contractors", "Гэрээт", "briefcase"],
  ],
  guard: [["violations", "Зөрчил", "shield"]],
};

const PAGES = {
  mine: ["Уурхайн самбар", "mine"],
  hse: ["ХАБЭА", "helmet"],
  skills: ["Ур чадвар, эрүүл мэнд", "badge"],
  ops: ["Үйлдвэрлэл, техник", "truck"],
  camp: ["Кэмп, логистик", "camp"],
  guard: ["Хамгаалалт", "shield"],
};

const COL_ICON = {
  ...Object.fromEntries(Object.values(TABS).flat().map(([key, , icon]) => [key, icon])),
  wxRules: "sliders",
  depts: "sitemap",
  crews: "people",
  posts: "badge",
};

/** The one select field each table can be narrowed by, as chips; `get` reads a derived value instead. */
const FILTERS = {
  incidents: { key: "status" },
  capa: { key: "status" },
  talks: { key: "shift" },
  permits: { key: "status", get: (item) => permitState(item, Date.parse(m.data.now)), labels: () => PERMIT_STATUS },
  risks: { key: "status" },
  ppe: { key: "item" },
  blasts: { key: "status" },
  certs: { key: "expires", get: (item) => expiryState(item.expires, m.data.today).state, labels: () => ({ expired: "Дууссан", soon: "Дуусах дөхсөн", valid: "Хүчинтэй" }) },
  medicals: { key: "result" },
  visitors: { key: "kind" },
  equipment: { key: "status" },
  assigns: { key: "shift" },
  workorders: { key: "status" },
  fuel: { key: "equipment", get: (item) => recordOf("equipment", item.equipment)?.type || "", labels: () => EQUIP_TYPES },
  stock: { key: "category" },
  moves: { key: "kind" },
  handovers: { key: "shift" },
  posts: { key: "position" },
  transport: { key: "dir" },
  contractors: { key: "status" },
  violations: { key: "hseStatus", get: (item) => item.hseStatus || "new", labels: () => VIOLATION_STATUS },
};

const ICON = {
  add: `<path d="M12 5v14M5 12h14"/>`,
  edit: `<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>`,
  trash: `<path d="M4.5 7h15M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/>`,
  qr: `<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>`,
  check: `<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  cross: `<path d="M6 6l12 12M18 6 6 18"/>`,
  download: `<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>`,
  sos: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5.5M12 16.2v.1"/>`,
  people: `<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5a6 6 0 0 1 12 0M15.5 5a3.2 3.2 0 0 1 0 6M17.5 13.7a6 6 0 0 1 3.5 5.8"/>`,
  photo: `<rect x="3.5" y="6" width="17" height="13" rx="2"/><circle cx="12" cy="12.5" r="3.3"/><path d="M8.5 6 10 4h4l1.5 2"/>`,
  bed: `<path d="M3 18.5V7M3 14h18v4.5M21 14v-2.5a3 3 0 0 0-3-3h-7V14"/><circle cx="7" cy="11" r="1.8"/>`,
  play: `<path d="M8 5.5v13l10-6.5z"/>`,
  stop: `<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>`,
  bell: `<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>`,
  map: `<path d="M12 21s6.5-5.8 6.5-11a6.5 6.5 0 0 0-13 0C5.5 15.2 12 21 12 21z"/><circle cx="12" cy="10" r="2.3"/>`,
  wrench: `<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>`,
  list: `<path d="M8.5 6.5h11M8.5 12h11M8.5 17.5h11M4.5 6.5h.1M4.5 12h.1M4.5 17.5h.1"/>`,
  mine: `<path d="M2.5 20.5h19M4 20.5l5-9 3 4 3-6 5 11"/><path d="M14 4.5l3-1.5 1 2.5"/>`,
  helmet: `<path d="M4 15a8 8 0 0 1 16 0"/><path d="M12 7v4M2.5 15h19v2.5h-19z"/>`,
  badge: `<rect x="3.5" y="3.5" width="17" height="13" rx="2"/><path d="M7.5 8h9M7.5 11.5h5"/><circle cx="16" cy="17" r="3"/>`,
  truck: `<path d="M3 17.5h11.5V12H9.5L7.5 8H3z"/><path d="M14.5 13.5 18 6l3 1.5-2.5 6"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="12" cy="18.5" r="2"/>`,
  camp: `<path d="M3 20.5 12 4l9 16.5z"/><path d="M12 20.5 9 14.5h6z"/>`,
  cctv: `<path d="M3 8.5 15.5 5l1.6 5.6-12.5 3.5z"/><path d="m17 7.2 3.5-1v5.6l-3-.6M8 13l1 3.5H4.5V20"/><circle cx="13" cy="8.6" r=".6"/>`,
  expand: `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`,
  layout: `<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M12 3.5v17M3.5 12h17"/>`,
  refresh: `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>`,
  print: `<path d="M7 9V4h10v5M7 17H4.5v-7h15v7H17"/><rect x="7" y="14" width="10" height="6"/>`,
  alert: `<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>`,
  clipboard: `<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3h6v1.5M8.5 12.5l2.3 2.3 4.7-4.6"/>`,
  megaphone: `<path d="M3.5 10v4h3l7 4.5v-13l-7 4.5z"/><path d="M17 9a4 4 0 0 1 0 6M6.5 14l1.5 5.5h2.5L9.5 14"/>`,
  permit: `<path d="M14 3.5H6.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V9z"/><path d="M14 3.5V9h5.5M8 13h8M8 16.5h5"/>`,
  gauge: `<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="m12 17 4-5.5"/><circle cx="12" cy="17" r="1.3"/>`,
  steps: `<path d="m3.5 6 1.5 1.5L8 4.5M3.5 12.5 5 14l3-3M3.5 19 5 20.5l3-3M11 6h9.5M11 12.5h9.5M11 19h9.5"/>`,
  flask: `<path d="M9.5 3.5h5M10.5 3.5v5.5L5 19a1.5 1.5 0 0 0 1.3 2.2h11.4A1.5 1.5 0 0 0 19 19l-5.5-10V3.5"/><path d="M7.5 15h9"/>`,
  vest: `<path d="M8 3.5 4.5 6v14.5h6V13l1.5-2 1.5 2v7.5h6V6L16 3.5l-4 5z"/>`,
  blast: `<path d="m12 2.5 1.8 5 5-2-2.6 4.7 5 1.8-5 1.8 2.6 4.7-5-2-1.8 5-1.8-5-5 2 2.6-4.7-5-1.8 5-1.8-2.6-4.7 5 2z"/>`,
  cloud: `<path d="M7 18.5h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.4 9.3 4.6 4.6 0 0 0 7 18.5z"/>`,
  siren: `<path d="M6 18.5v-6a6 6 0 0 1 12 0v6"/><path d="M4 18.5h16v2H4zM12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4M12 11v4"/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2.5"/>`,
  award: `<circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5 7 21l5-2.5 5 2.5-1.5-7.5"/>`,
  heart: `<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/><path d="M4.5 12.5h4l1.5-2.5 2.5 5 1.5-2.5h5.5"/>`,
  visitor: `<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 11-4.7"/><rect x="15" y="14" width="6.5" height="6.5" rx="1"/>`,
  grid: `<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>`,
  assign: `<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 11.5h5.5M19 9l2.5 2.5L19 14"/>`,
  checklist: `<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 4.5V3h6v1.5M8.5 10h7M8.5 13.5h7M8.5 17h4"/>`,
  fuel: `<path d="M4.5 20.5V5a1.5 1.5 0 0 1 1.5-1.5h6A1.5 1.5 0 0 1 13.5 5v15.5M3 20.5h12M4.5 10h9"/><path d="M13.5 8.5h2a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 0 3 0V8l-2.5-2.5"/>`,
  box: `<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>`,
  swap: `<path d="M4 8h14M14.5 4.5 18 8l-3.5 3.5M20 16H6M9.5 12.5 6 16l3.5 3.5"/>`,
  repeat: `<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5"/>`,
  sitemap: `<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-4h12v4"/>`,
  bus: `<rect x="4" y="3.5" width="16" height="14" rx="2.5"/><path d="M4 11h16M8 17.5v2.5M16 17.5v2.5"/><circle cx="8" cy="14.3" r="1"/><circle cx="16" cy="14.3" r="1"/>`,
  wallet: `<rect x="3" y="6" width="18" height="14" rx="2.5"/><path d="M3 10h18M16 15h2M6 6l9-2.5 1 2.5"/>`,
  briefcase: `<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M3 12.5h18"/>`,
  sliders: `<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>`,
  chart: `<path d="M4 20.5h16M6.5 17v-6M11 17V6M15.5 17V9M20 17v-4"/>`,
  search: `<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>`,
  chevron: `<path d="m6 9 6 6 6-6"/>`,
  fold: `<path d="M8 3.5l4 4 4-4M8 20.5l4-4 4 4M4.5 12h15"/>`,
  unfold: `<path d="M12 3.5v17M8 7.5l4-4 4 4M8 16.5l4 4 4-4"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`,
  user: `<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>`,
  cog: `<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>`,
  shield: `<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>`,
  moon: `<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>`,
  gavel: `<path d="m13.5 4 6.5 6.5M10.5 7l6.5 6.5M12 5.5l-4 4 6.5 6.5 4-4z"/><path d="m9.5 13-6 6M3 21h9"/>`,
  gate: `<path d="M3.5 20.5V8l8.5-4.5L20.5 8v12.5"/><path d="M8 20.5v-8h8v8M8 16.5h8"/>`,
};

let ctx = null;
const m = {
  data: null,
  timer: 0,
  loading: false,
  tab: readStored("mine-tabs", {}),
  fold: new Set(readStored("mine-fold", [])),
  open: new Set(),
  query: {},
  filter: {},
  seenSos: new Set(),
  payroll: null,
  payMonth: null,
  camCols: [1, 2, 3, 4].includes(Number(localStorage.getItem("camp-cam-cols"))) ? Number(localStorage.getItem("camp-cam-cols")) : 3,
};

function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Hands the module the app's helpers: { stage, state, api, render, openModal, closeModal, toast }. */
export function initMine(context) {
  ctx = context;
  ctx.stage.addEventListener("click", onClick);
  ctx.stage.addEventListener("submit", onSubmit);
  ctx.stage.addEventListener("change", onChange);
  ctx.stage.addEventListener("input", onInput);
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const ico = (name, cls = "m-ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ""}</svg>`;
const badge = (text, tone = "") => `<span class="m-badge${tone ? ` is-${tone}` : ""}">${esc(text)}</span>`;
const records = (name) => m.data?.[COLLECTIONS[name].area]?.[name] || [];
const recordOf = (name, id) => records(name).find((item) => item.id === id) || null;
const userOf = (uid) => m.data?.users.find((user) => user.id === uid) || null;
const nameOf = (uid) => userOf(uid)?.displayName || "–";
const staffUsers = () => (m.data?.users || []).filter((user) => user.role !== "master");
const num = (value) => (Number.isFinite(Number(value)) ? Number(value).toLocaleString("en-US") : "–");
const pct = (value) => (value == null || !Number.isFinite(value) ? "–" : `${Math.round(value * 100)}%`);
const positionOf = (uid) => records("posts").find((item) => item.uid === uid)?.position || null;

function fmtDate(date) {
  if (!date) return "–";
  const [year, month, day] = String(date).split("-");
  return year === (m.data?.today || "").slice(0, 4) ? `${month}.${day}` : `${year}.${month}.${day}`;
}

function fmtMoment(iso) {
  if (!iso) return "–";
  const local = localInput(Date.parse(iso));
  return `${fmtDate(local.slice(0, 10))} ${local.slice(11)}`;
}

const clockOf = (iso) => (iso ? localInput(Date.parse(iso)).slice(11) : "–");

function untilText(ms) {
  const minutes = Math.round(ms / 60000);
  if (Math.abs(minutes) < 60) return `${minutes} мин`;
  const hours = Math.floor(Math.abs(minutes) / 60);
  return `${minutes < 0 ? "-" : ""}${hours} ц ${Math.abs(minutes) % 60} мин`;
}

const REF_LABEL = {
  incidents: (item) => item.title,
  equipment: (item) => `${item.code} · ${EQUIP_TYPES[item.type] || ""}`,
  crews: (item) => item.name,
  depts: (item) => item.name,
  stock: (item) => `${item.code} · ${item.name}`,
  rooms: (item) => item.number,
};

function refLabel(collection, id) {
  const item = recordOf(collection, id);
  return item ? REF_LABEL[collection]?.(item) || item.name || item.title || id : "–";
}

/* ---------- data and polling ---------- */

export async function masterStart() {
  if (!m.timer) m.timer = setInterval(() => refresh(), 15000);
  if (!m.data) await refresh();
  else paint();
  mountCams();
}

export function masterStop() {
  clearInterval(m.timer);
  m.timer = 0;
  stopFeeds();
}

export function masterReset() {
  masterStop();
  Object.assign(m, { data: null, payroll: null, payMonth: null, query: {}, filter: {} });
  m.open.clear();
  m.seenSos.clear();
}

async function refresh() {
  if (m.loading || !ctx.state.me) return;
  m.loading = true;
  try {
    setData(await ctx.api(apiBase()));
  } catch (error) {
    if (!m.data) ctx.stage.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  } finally {
    m.loading = false;
  }
}

function setData(data) {
  m.data = data;
  alertSos();
  m.modalRepaint?.();
  paint();
}

function busy() {
  const active = document.activeElement;
  return Boolean(document.querySelector(".modal:not(.is-closing)")) || (ctx.stage.contains(active) && ["INPUT", "TEXTAREA", "SELECT"].includes(active?.tagName));
}

function paint(force = false) {
  if (!MINE_VIEWS.includes(ctx.state.view)) return;
  if (!force && busy()) return;
  if (!force && ctx.stage.querySelector(".cam-wall")?.dataset.sig === camSig()) {
    mountCams();
    return;
  }
  const scroll = ctx.stage.querySelector(".m-tabs")?.scrollLeft || 0;
  ctx.stage.classList.add("is-quiet");
  ctx.stage.innerHTML = masterView(ctx.state.view);
  const tabs = ctx.stage.querySelector(".m-tabs");
  if (tabs) tabs.scrollLeft = scroll;
  mountCams();
}

/** Starts the camera feeds the page shows and stops the rest; called after every paint of a camp page. */
function mountCams() {
  if (m.data?.camp?.cameras && ctx.stage.querySelector("[data-feed]")) mountFeeds(ctx.stage, m.data.camp.cameras);
  else stopFeeds();
}

async function send(path, method = "POST", body = {}) {
  const data = await ctx.api(path, { method, body: method === "DELETE" ? undefined : JSON.stringify(body) });
  if (data.view) setData(data.view);
  return data;
}

async function attempt(work) {
  try {
    return await work();
  } catch (error) {
    ctx.toast("Амжилтгүй", error.message);
    return null;
  }
}

function beep() {
  try {
    const audio = new AudioContext();
    for (let index = 0; index < 3; index += 1) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(audio.destination);
      osc.start(audio.currentTime + index * 0.35);
      osc.stop(audio.currentTime + index * 0.35 + 0.2);
    }
  } catch {
    /* no audio before the first click */
  }
}

function alertSos() {
  for (const sos of m.data.hse?.sos || []) {
    if (sos.status !== "open" || m.seenSos.has(sos.id)) continue;
    m.seenSos.add(sos.id);
    const text = `${nameOf(sos.uid)} · ${SOS_KINDS[sos.kind]} · ${clockOf(sos.at)}`;
    ctx.toast("SOS · яаралтай", text);
    beep();
    if (window.Notification?.permission === "granted") new Notification("SOS · яаралтай", { body: text, tag: sos.id });
  }
}

/* ---------- page frame ---------- */

export function masterView(view) {
  if (!m.data) return `<div class="admin-page m-page"><section class="panel"><p class="muted">Ачаалж байна…</p></section></div>`;
  const body = view === "mine" ? dashboard() : tabbed(view);
  return `<div class="admin-page m-page">${hero(view)}${m.data.hse ? alertStrip() : ""}${body}</div>`;
}

function hero(view) {
  const [title, icon] = PAGES[view];
  const stat = (value, label, tone = "") => `<div class="m-stat${tone ? ` is-${tone}` : ""}"><b>${value}</b><span>${label}</span></div>`;
  return `
    <section class="panel m-hero">
      <div class="m-hero-top">
        <div class="admin-shield">${ico(icon)}</div>
        <h1>${esc(title)}</h1>
        <span class="m-pill">${ico("calendar")}${fmtDate(m.data.today)}</span>
        <span class="m-pill">${ico("clock")}${SHIFTS[m.data.shift]} ээлж</span>
        ${view === "guard" ? `<button class="chip m-hero-link" type="button" data-m="goto" data-view="passes">${ico("gate")}Хаалга, хөдөлгөөний зөвшөөрөл</button>` : ""}
        <button class="icon-btn m-foldall" type="button" data-m="fold-all" title="Бүгдийг хураах / дэлгэх" aria-label="Бүгдийг хураах / дэлгэх">${ico("fold")}</button>
      </div>
      <div class="m-stats">${heroStats(view).map(([value, label, tone]) => stat(value, label, tone)).join("")}</div>
    </section>`;
}

/** A section that folds to its header; the folded ones are remembered across visits. */
function panel({ key, icon, title, count, tools = "", body, cls = "" }) {
  const folded = m.fold.has(key);
  return `<section class="panel m-panel${folded ? " is-folded" : ""}${cls ? ` ${cls}` : ""}" data-fold-key="${esc(key)}">
    <header class="m-panel-head">
      <button type="button" class="m-fold" data-m="fold" aria-expanded="${!folded}">
        <span class="m-head-ico">${ico(icon)}</span><h2>${esc(title)}</h2>${count != null ? `<span class="m-count">${count}</span>` : ""}${ico("chevron", "m-ico m-chev")}
      </button>
      ${tools ? `<div class="m-tools">${tools}</div>` : ""}
    </header>
    <div class="m-panel-body">${body}</div>
  </section>`;
}

const toolBtn = (action, icon, title, extra = "") => `<button class="icon-btn" type="button" data-m="${action}" title="${esc(title)}" aria-label="${esc(title)}"${extra}>${ico(icon)}</button>`;
const addBtn = (name, preset) => `<button class="primary m-add" type="button" data-m="new" data-name="${name}"${preset ? ` data-preset='${esc(JSON.stringify(preset))}'` : ""} title="Нэмэх" aria-label="Нэмэх">${ico("add")}<span>Нэмэх</span></button>`;

function heroStats(view) {
  const d = m.data;
  if (view === "guard") {
    const list = d.guard.violations;
    const today = list.filter((item) => localInput(Date.parse(item.at)).slice(0, 10) === d.today).length;
    const waiting = list.filter((item) => ["new", "review"].includes(item.hseStatus || "new")).length;
    return [[today, "Өнөөдрийн зөрчил"], [waiting, "ХАБЭА шийдвэрлээгүй"], [d.gate.ready, "Хаалгаар гарах, орох"], [d.gate.out, "Бүсээс гарсан"], [d.gate.late, "Хугацаа хэтэрсэн", d.gate.late ? "neg" : ""]];
  }
  if (view === "camp") {
    const beds = d.camp.rooms.reduce((sum, item) => sum + item.beds, 0);
    const used = Object.keys(d.camp.beds).length;
    const change = crewChange(staffUsers(), d.plans, d.leaves, d.today);
    const offRota = (kind) => (d.passes || []).filter((item) => item.kind === kind && item.date === d.today).map((item) => item.uid);
    const arrive = new Set([...change.arrive, ...offRota("arrive")]).size;
    const depart = new Set([...change.depart, ...offRota("depart")]).size;
    const cams = d.camp.cameras || [];
    return [[`${cams.filter((item) => item.enabled).length}/${cams.length}`, "Камер идэвхтэй"], [`${used}/${beds}`, "Ор эзэлсэн"], [arrive, "Өнөөдөр ирэх"], [depart, "Өнөөдөр буцах"], [d.camp.contractors.filter((item) => item.status === "active").length, "Идэвхтэй гэрээт"]];
  }
  const now = Date.parse(d.now);
  const onSite = Object.values(d.people).filter((item) => item.state === "in").length;
  const held = Object.values(d.holds).filter((list) => list.length).length;
  const openSos = d.hse.sos.filter((item) => item.status === "open" || item.status === "ack").length;
  const activePermits = d.hse.permits.filter((item) => permitState(item, now) === "active").length;
  const openIncidents = d.hse.incidents.filter((item) => item.status !== "closed").length;
  const down = d.ops.equipment.filter((item) => item.status === "down" || item.status === "service").length;
  if (view === "mine") return [[onSite, "Талбай дээр"], [openSos, "SOS", openSos ? "neg" : ""], [held, "Карт хаагдсан", held ? "neg" : ""], [activePermits, "Идэвхтэй зөвшөөрөл"], [down, "Зогссон техник", down ? "neg" : ""]];
  if (view === "hse") {
    const overdue = d.hse.capa.filter((item) => item.status !== "done" && item.due && item.due < d.today).length;
    const talks = d.hse.talks.filter((item) => item.date === d.shiftDate);
    const audience = talks.reduce((sum, item) => sum + (d.audience[item.id] || []).length, 0);
    const acked = talks.reduce((sum, item) => sum + item.acks.filter((ack) => (d.audience[item.id] || []).includes(ack.uid)).length, 0);
    const newViolations = (d.guard?.violations || []).filter((item) => (item.hseStatus || "new") === "new").length;
    return [[openIncidents, "Нээлттэй осол, аюул", openIncidents ? "neg" : ""], [newViolations, "Шинэ зөрчил (хамгаалалт)", newViolations ? "neg" : ""], [overdue, "Хэтэрсэн CAPA", overdue ? "neg" : ""], [activePermits, "Идэвхтэй зөвшөөрөл"], [audience ? `${acked}/${audience}` : "–", "Зааварчилгаа танилцсан"]];
  }
  if (view === "skills") {
    const soon = d.skills.certs.filter((item) => expiryState(item.expires, d.today).state === "soon").length;
    const expired = d.skills.certs.filter((item) => expiryState(item.expires, d.today).state === "expired").length;
    const onSiteVisitors = d.skills.visitors.filter((item) => item.onSite).length;
    return [[held, "Карт хаагдсан", held ? "neg" : ""], [soon, "30 хоногт дуусах"], [expired, "Хугацаа дууссан", expired ? "neg" : ""], [onSiteVisitors, "Зочин талбайд"], [d.skills.rules.enforce ? "Асаалттай" : "Унтраалттай", "Автомат хориг"]];
  }
  if (view === "ops") {
    const today = d.kpi.production.at(-1);
    const yesterday = d.kpi.production.at(-2);
    const lowStock = d.ops.stock.filter((item) => item.qty <= item.min).length;
    const openWo = d.ops.workorders.filter((item) => item.status !== "done").length;
    return [[num(yesterday?.tonnes), "Өчигдөр, тонн"], [num(today?.tonnes), "Өнөөдөр, тонн"], [pct(d.kpi.availability), "Бэлэн байдал"], [openWo, "Нээлттэй засвар", openWo ? "neg" : ""], [lowStock, "Дутагдаж буй бараа", lowStock ? "neg" : ""]];
  }
  return [];
}

/** Live emergencies shown on every MASTER page. */
function alertStrip() {
  const d = m.data;
  const now = Date.parse(d.now);
  const items = [];
  for (const sos of d.hse.sos.filter((item) => item.status === "open" || item.status === "ack")) {
    items.push(`<div class="m-alert is-sos">${ico("sos")}<div><b>${esc(nameOf(sos.uid))} · ${esc(SOS_KINDS[sos.kind])}</b><span>${clockOf(sos.at)} · ${esc(SOS_STATUS[sos.status])}${sos.geo ? ` · <a href="https://www.openstreetmap.org/?mlat=${sos.geo.lat}&mlon=${sos.geo.lng}#map=17/${sos.geo.lat}/${sos.geo.lng}" target="_blank" rel="noopener">байршил</a>` : " · байршилгүй"}${sos.note ? ` · ${esc(sos.note)}` : ""}</span></div>
      <div class="m-acts">${sos.status === "open" ? `<button class="chip" type="button" data-m="sos" data-id="${sos.id}" data-status="ack">Хүлээн авлаа</button>` : ""}<button class="chip" type="button" data-m="sos" data-id="${sos.id}" data-status="resolved">Шийдвэрлэсэн</button></div></div>`);
  }
  const muster = d.hse.musters.find((item) => !item.end);
  if (muster) {
    const checked = Object.keys(muster.checked).length;
    items.push(`<div class="m-alert is-muster">${ico("people")}<div><b>Цуглаан · ${esc(muster.reason)}</b><span>${clockOf(muster.at)}-с · ${checked}/${muster.expected.length} хүн бүртгэгдсэн · ${muster.expected.length - checked} дутуу</span></div><div class="m-acts"><button class="primary" type="button" data-m="muster-open">Нээх</button></div></div>`);
  }
  for (const event of d.hse.wxEvents.filter((item) => !item.end)) {
    items.push(`<div class="m-alert is-stop">${ico("bell")}<div><b>Ажил зогсоох · ${esc(event.name)}</b><span>${clockOf(event.start)}-с · ${esc(event.action)}${event.simulated ? " · туршилт" : ""}</span></div></div>`);
  }
  for (const blast of d.hse.blasts.filter((item) => item.status === "planned" && Date.parse(item.at) - now < 60 * 60000 && Date.parse(item.at) > now - 15 * 60000)) {
    const left = Date.parse(blast.at) - now;
    items.push(`<div class="m-alert is-blast">${ico("bell")}<div><b>Тэсэлгээ ${clockOf(blast.at)} · ${esc(blast.place)}</b><span>${left > 0 ? `${untilText(left)}-ын дараа` : "Явагдаж байна"} · ${blast.radius} м аюултай бүс</span></div></div>`);
  }
  return items.length ? `<div class="m-alerts">${items.join("")}</div>` : "";
}

/** How many things on a tab need the master's attention, shown as a red count on the tab. */
function tabAlert(tab) {
  const d = m.data;
  const now = Date.parse(d.now);
  const count = {
    incidents: () => d.hse.incidents.filter((item) => item.status === "open").length,
    violations: () => (d.guard?.violations || []).filter((item) => (item.hseStatus || "new") === "new").length,
    capa: () => d.hse.capa.filter((item) => item.status !== "done" && item.due && item.due < d.today).length,
    permits: () => d.hse.permits.filter((item) => permitState(item, now) === "expired").length,
    weather: () => d.hse.wxEvents.filter((item) => !item.end).length,
    emergency: () => d.hse.sos.filter((item) => item.status === "open" || item.status === "ack").length + d.hse.musters.filter((item) => !item.end).length,
    people: () => Object.values(d.holds).filter((list) => list.length).length,
    certs: () => d.skills.certs.filter((item) => expiryState(item.expires, d.today).state === "expired").length,
    medicals: () => d.skills.medicals.filter((item) => item.next && item.next < d.today).length,
    equipment: () => d.ops.equipment.filter((item) => item.status === "down").length,
    workorders: () => d.ops.workorders.filter((item) => item.status === "open").length,
    stock: () => d.ops.stock.filter((item) => item.qty <= item.min).length,
  }[tab];
  return count ? count() : 0;
}

function tabbed(view) {
  const tabs = TABS[view];
  const current = tabs.some(([key]) => key === m.tab[view]) ? m.tab[view] : tabs[0][0];
  if (tabs.length === 1) return tabBody(view, current);
  return `
    <div class="m-tabbar">
      <nav class="m-tabs" role="tablist">${tabs
        .map(([key, label, icon]) => {
          const alert = tabAlert(key);
          return `<button type="button" role="tab" class="m-tab${key === current ? " is-on" : ""}" aria-selected="${key === current}" data-m="tab" data-page="${view}" data-tab="${key}">${ico(icon)}<span>${esc(label)}</span>${alert ? `<i class="m-tab-alert">${alert}</i>` : ""}</button>`;
        })
        .join("")}</nav>
    </div>
    ${tabBody(view, current)}`;
}

function tabBody(view, tab) {
  const special = {
    weather: weatherTab,
    emergency: emergencyTab,
    people: peopleTab,
    board: boardTab,
    org: () => `<div class="m-grid">${collectionPanel("depts")}${collectionPanel("crews")}</div>${collectionPanel("posts")}`,
    rooms: roomsTab,
    transport: transportTab,
    payroll: payrollTab,
    cameras: camerasTab,
  };
  return special[tab] ? special[tab]() : collectionPanel(tab);
}

/* ---------- generic tables ---------- */

const TONE = {
  severity: { low: "", medium: "warn", high: "bad", critical: "bad" },
  incident: { open: "bad", investigating: "warn", closed: "ok" },
  capa: { open: "warn", done: "ok" },
  permit: { requested: "warn", active: "ok", expired: "bad", closed: "", cancelled: "" },
  equip: { ready: "ok", running: "ok", down: "bad", service: "warn" },
  wo: { open: "bad", progress: "warn", done: "ok" },
  priority: { low: "", medium: "", high: "bad" },
  medical: { fit: "ok", restricted: "warn", unfit: "bad" },
};

function expiryBadge(date, soonDays = 30) {
  if (!date) return "–";
  const { state, days } = expiryState(date, m.data.today, soonDays);
  if (state === "expired") return badge(`${fmtDate(date)} · ${-days} хоног өнгөрсөн`, "bad");
  if (state === "soon") return badge(`${fmtDate(date)} · ${days} хоног`, "warn");
  return badge(fmtDate(date), "ok");
}

const DECOR = {
  incidents: {
    kind: (item) => badge(INCIDENT_KINDS[item.kind], item.kind === "incident" ? "bad" : item.kind === "nearmiss" ? "warn" : "info"),
    title: (item) => `${esc(item.title)}${item.photo ? ` ${ico("photo", "m-ico tiny")}` : ""}`,
    severity: (item) => badge(SEVERITIES[item.severity], TONE.severity[item.severity]),
    status: (item) => badge(INCIDENT_STATUS[item.status], TONE.incident[item.status]),
  },
  capa: {
    due: (item) => (item.status !== "done" && item.due && item.due < m.data.today ? badge(`${fmtDate(item.due)} · хэтэрсэн`, "bad") : esc(fmtDate(item.due))),
    status: (item) => badge(CAPA_STATUS[item.status], TONE.capa[item.status]),
  },
  permits: {
    status: (item) => {
      const state = permitState(item, Date.parse(m.data.now));
      return badge(PERMIT_STATUS[state], TONE.permit[state]);
    },
  },
  alcohol: { value: (item) => (item.value > ALCOHOL_LIMIT ? badge(`${item.value}‰ · эерэг`, "bad") : badge(`${Number(item.value).toFixed(2)}‰`, "ok")) },
  blasts: { status: (item) => badge(BLAST_STATUS[item.status], item.status === "planned" ? "warn" : item.status === "done" ? "ok" : "") },
  certs: { expires: (item) => expiryBadge(item.expires) },
  medicals: { next: (item) => expiryBadge(item.next, 14), result: (item) => badge(MEDICAL_RESULTS[item.result], TONE.medical[item.result]) },
  equipment: { status: (item) => badge(EQUIP_STATUS[item.status], TONE.equip[item.status]), hours: (item) => num(item.hours) },
  workorders: { status: (item) => badge(WO_STATUS[item.status], TONE.wo[item.status]), priority: (item) => badge(PRIORITIES[item.priority] || "–", TONE.priority[item.priority]) },
  stock: { qty: (item) => (item.qty <= item.min ? badge(`${num(item.qty)} · дутуу`, "bad") : num(item.qty)) },
  handovers: { tonnes: (item) => num(item.tonnes) },
  contractors: { until: (item) => (item.status === "active" ? expiryBadge(item.until) : esc(fmtDate(item.until))), status: (item) => badge(CONTRACT_STATUS[item.status], item.status === "active" ? "ok" : "") },
  wxRules: {
    threshold: (item) => (WX_METRICS[item.metric]?.op === "flag" ? "Илэрвэл" : `${WX_METRICS[item.metric]?.op === "lte" ? "≤" : "≥"} ${item.threshold} ${WX_METRICS[item.metric]?.unit || ""}`),
    enabled: (item) => (item.enabled ? badge("Идэвхтэй", "ok") : badge("Унтраалттай")),
  },
  visitors: { induction: (item) => `${(item.induction || []).length}/${Object.keys(INDUCTION_ITEMS).length}` },
  violations: {
    party: (item) => `<span class="m-who"><b>${esc(violatorOf(item))}</b><small>${esc(VIOLATORS[item.party] || "")}</small></span>`,
    kind: (item) => `${esc(VIOLATION_KINDS[item.kind] || item.kind)}${item.photo ? ` ${ico("photo", "m-ico tiny")}` : ""}`,
    severity: (item) => badge(SEVERITIES[item.severity], TONE.severity[item.severity]),
  },
};

const violatorOf = (item) => (item.party === "staff" ? nameOf(item.uid) : item.person || "–");
const HSE_TONE = { new: "bad", review: "warn", acted: "ok", dismissed: "" };

const EXTRA_COLS = {
  talks: [["Танилцсан", (item) => {
    const audience = m.data.audience[item.id] || [];
    const acked = item.acks.filter((ack) => audience.includes(ack.uid)).length;
    return audience.length ? badge(`${acked}/${audience.length}`, acked === audience.length ? "ok" : "warn") : `${item.acks.length}`;
  }]],
  risks: [["Эрсдэл", (item) => {
    const risk = riskLevel(item.likelihood, item.severity);
    return badge(`${risk.score} · ${risk.label}`, { low: "ok", medium: "warn", high: "bad", extreme: "bad" }[risk.level]);
  }]],
  ppe: [["Солих", (item) => expiryBadge(ppeDue(item))]],
  visitors: [["Төлөв", (item) => (item.onSite ? badge("Талбай дээр", "ok") : visitorReady(item, m.data.today) ? badge("Нэвтрэхэд бэлэн", "info") : badge("Сургалт / хугацаа дутуу", "warn"))]],
  equipment: [["Засвар хүртэл", (item) => {
    const service = serviceDue(item);
    return service.due ? badge(`${num(-service.left)} ц хэтэрсэн`, "bad") : service.left < 50 ? badge(`${num(service.left)} ц`, "warn") : `${num(service.left)} ц`;
  }], ["Оператор", (item) => {
    const assign = records("assigns").find((row) => row.equipment === item.id && row.date === m.data.shiftDate && row.shift === m.data.shift);
    return assign ? esc(nameOf(assign.operator)) : `<span class="muted">–</span>`;
  }]],
  assigns: [["Шалгалт", (item) => assignCheck(item)]],
  prestarts: [["Үр дүн", (item) => {
    const fails = prestartFails(item);
    if (!fails.length) return badge("Хэвийн", "ok");
    const critical = fails.some((key) => CRITICAL_ITEMS.includes(key));
    return badge(fails.map((key) => PRESTART_LABELS[key]).join(", "), critical ? "bad" : "warn");
  }]],
  workorders: [["Зогсолт", (item) => {
    if (!item.opened || item.kind === "inspection") return "–";
    const end = item.closed ? Date.parse(item.closed) : Date.parse(m.data.now);
    return `${Math.max(0, (end - Date.parse(item.opened)) / 3600000).toFixed(1)} ц`;
  }]],
  posts: [["Төлөв", (item) => ((m.data.holds[item.uid] || []).length ? badge("Карт хаагдсан", "bad") : badge("Хэвийн", "ok"))]],
  wxRules: [["Одоо", (item) => {
    const value = wxValue(m.data.weather, item.metric);
    const on = m.data.hse.wxEvents.some((event) => !event.end && event.rule === item.id);
    const shown = value == null ? "–" : WX_METRICS[item.metric]?.op === "flag" ? (value ? "Илэрсэн" : "Үгүй") : `${Math.round(value * 10) / 10} ${WX_METRICS[item.metric]?.unit || ""}`;
    return on ? badge(`${shown} · зогсоосон`, "bad") : esc(shown);
  }]],
  rooms: [["Сул ор", (item) => {
    const used = Array.from({ length: item.beds }, (_, index) => m.data.camp.beds[`${item.id}:${index}`]).filter(Boolean).length;
    return `${item.beds - used}/${item.beds}`;
  }]],
  transport: [["Зорчигч", (item) => `${manifest(item).length}`]],
  violations: [["ХАБЭА", (item) => {
    const status = item.hseStatus || "new";
    const label = status === "acted" && item.measure ? `${VIOLATION_STATUS.acted} · ${MEASURES[item.measure]}` : VIOLATION_STATUS[status];
    const note = item.hseNote || (item.hseBy ? `${item.hseBy} · ${fmtMoment(item.hseAt)}` : "");
    return `<span class="m-who">${badge(label, HSE_TONE[status])}${note ? `<small title="${esc(item.hseBy ? `${item.hseBy} · ${fmtMoment(item.hseAt)}` : "")}">${esc(note)}</small>` : ""}</span>`;
  }]],
};

function assignCheck(item) {
  const machine = recordOf("equipment", item.equipment);
  const problems = [];
  const need = machine ? EQUIP_CERT[machine.type] : null;
  if (need && !validCert(m.data.skills.certs, item.operator, need, item.date)) problems.push(`${CERT_TYPES[need]} хүчингүй`);
  if ((m.data.holds[item.operator] || []).length) problems.push("Картын хориг");
  if (item.date === m.data.shiftDate && m.data.fatigue[item.operator]?.state === "unfit") problems.push("Ядаргаа");
  if (problems.length) return badge(problems.join(", "), "bad");
  const done = records("prestarts").some((row) => row.equipment === item.equipment && row.date === item.date && row.shift === item.shift);
  return done ? badge("Pre-start хийсэн", "ok") : badge("Pre-start хүлээгдэж байна", "warn");
}

function cellOf(name, field, item) {
  const decor = DECOR[name]?.[field.key];
  if (decor) return decor(item);
  const value = item[field.key];
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return `<span class="muted">–</span>`;
  switch (field.type) {
    case "select":
      return esc(field.options[value] || value);
    case "user":
      return esc(nameOf(value));
    case "users":
      return value.length > 2 ? `${esc(value.slice(0, 2).map(nameOf).join(", "))} +${value.length - 2}` : esc(value.map(nameOf).join(", "));
    case "ref":
      return esc(refLabel(field.ref, value));
    case "date":
      return esc(fmtDate(value));
    case "datetime":
      return esc(fmtMoment(value));
    case "bool":
      return value ? ico("check", "m-ico tiny") : "";
    case "checks":
      return `${value.length}/${Object.keys(field.options).length}`;
    case "number":
      return num(value);
    default:
      return esc(value);
  }
}

function sortKey(name) {
  const fields = COLLECTIONS[name].fields;
  const when = fields.find((field) => field.list && (field.type === "datetime" || field.type === "date"));
  if (when) return (a, b) => String(b[when.key] || "").localeCompare(String(a[when.key] || "")) || String(b.createdAt).localeCompare(String(a.createdAt));
  const text = fields.find((field) => field.type === "text");
  return (a, b) => String(a[text?.key] || "").localeCompare(String(b[text?.key] || ""), "mn", { numeric: true });
}

function searchText(name, item) {
  return COLLECTIONS[name].fields
    .filter((field) => field.list)
    .map((field) => {
      const value = item[field.key];
      if (field.type === "user") return nameOf(value);
      if (field.type === "users") return (value || []).map(nameOf).join(" ");
      if (field.type === "select") return field.options[value] || "";
      if (field.type === "ref") return refLabel(field.ref, value);
      return typeof value === "object" ? "" : String(value ?? "");
    })
    .concat(name === "violations" ? [violatorOf(item), item.hseNote || ""] : [])
    .join(" ")
    .toLowerCase();
}

function rowActions(name, item) {
  const schema = COLLECTIONS[name];
  const buttons = [];
  const button = (action, icon, title, extra = "") => `<button class="icon-btn" type="button" data-m="${action}" data-name="${name}" data-id="${item.id}" title="${esc(title)}" aria-label="${esc(title)}"${extra}>${ico(icon)}</button>`;
  const quick = (patch, icon, title) => button("quick", icon, title, ` data-patch='${esc(JSON.stringify(patch))}'`);
  if (name === "incidents") {
    if (item.photo) buttons.push(button("photo", "photo", "Зураг харах"));
    buttons.push(`<button class="icon-btn" type="button" data-m="new" data-name="capa" data-preset='${esc(JSON.stringify({ incident: item.id }))}' title="CAPA нэмэх" aria-label="CAPA нэмэх">${ico("list")}</button>`);
  }
  if (name === "capa" && item.status !== "done") buttons.push(quick({ status: "done" }, "check", "Хийгдсэн"));
  if (name === "talks") buttons.push(button("talk-acks", "people", "Танилцсан бүртгэл, карт уншуулах"));
  if (name === "permits") {
    if (item.status === "requested") buttons.push(quick({ status: "active" }, "play", "Идэвхжүүлэх"));
    if (item.status === "active") buttons.push(quick({ status: "closed" }, "stop", "Хаах"));
  }
  if (name === "visitors") {
    buttons.push(button("pass", "qr", "Түр нэвтрэх QR"));
    buttons.push(button("site", item.onSite ? "stop" : "play", item.onSite ? "Талбайгаас гарсан" : "Талбайд нэвтрүүлэх", ` data-on="${item.onSite ? "" : "1"}"`));
  }
  if (name === "equipment") buttons.push(`<button class="icon-btn" type="button" data-m="new" data-name="workorders" data-preset='${esc(JSON.stringify({ equipment: item.id }))}' title="Засварын захиалга" aria-label="Засварын захиалга">${ico("wrench")}</button>`);
  if (name === "assigns" && !records("prestarts").some((row) => row.equipment === item.equipment && row.date === item.date && row.shift === item.shift)) {
    const hours = recordOf("equipment", item.equipment)?.hours ?? "";
    buttons.push(`<button class="icon-btn" type="button" data-m="new" data-name="prestarts" data-preset='${esc(JSON.stringify({ equipment: item.equipment, operator: item.operator, date: item.date, shift: item.shift, hours }))}' title="Pre-start бөглөх" aria-label="Pre-start бөглөх">${ico("check")}</button>`);
  }
  if (name === "workorders" && item.status !== "done") buttons.push(quick({ status: "done" }, "check", "Дууссан"));
  if (name === "transport") buttons.push(button("manifest", "people", "Зорчигчийн жагсаалт"));
  if (name === "violations") {
    if (item.photo) buttons.push(button("photo", "photo", "Нотлох зураг"));
    if (!isGuard()) {
      buttons.push(button("vio-decide", "gavel", "Арга хэмжээ авах"));
      return `<div class="acts">${buttons.join("")}</div>`;
    }
    if ((item.hseStatus || "new") !== "new") return `<div class="acts">${buttons.join("")}</div>`;
  }
  if (!schema.immutable) buttons.push(button("edit", "edit", "Засах"));
  if (!schema.immutable) buttons.push(`<button class="icon-btn danger" type="button" data-m="delete" data-name="${name}" data-id="${item.id}" title="Устгах" aria-label="Устгах">${ico("trash")}</button>`);
  return `<div class="acts">${buttons.join("")}</div>`;
}

function filterOf(name) {
  const spec = FILTERS[name];
  if (!spec) return null;
  const field = COLLECTIONS[name].fields.find((item) => item.key === spec.key);
  return { get: spec.get || ((item) => item[spec.key] ?? ""), labels: spec.labels ? spec.labels() : field?.options || {} };
}

function chipsHtml(key, list, spec) {
  const counts = new Map();
  for (const item of list) counts.set(spec.get(item), (counts.get(spec.get(item)) || 0) + 1);
  const shown = Object.entries(spec.labels).filter(([value]) => counts.get(value));
  if (shown.length < 2) return "";
  const current = m.filter[key] || "";
  const chip = (value, label, count) => `<button type="button" class="m-chip${current === value ? " is-on" : ""}" data-m="filter" data-key="${esc(key)}" data-value="${esc(value)}">${esc(label)}<i>${count}</i></button>`;
  return `<div class="m-chips" role="group" aria-label="Шүүлтүүр">${ico("sliders")}${chip("", "Бүгд", list.length)}${shown.map(([value, label]) => chip(value, label, counts.get(value))).join("")}</div>`;
}

/** Form fields left out of the table, shown when a row is opened. */
function detailFields(name, item) {
  return COLLECTIONS[name].fields.filter((field) => {
    if (field.list) return false;
    const value = item[field.key];
    if (field.type === "photo") return Boolean(item.photo);
    return !(value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length));
  });
}

function detailValue(name, field, item) {
  const value = item[field.key];
  if (field.type === "long") return `<p class="m-pre">${esc(value)}</p>`;
  if (field.type === "photo") return `<button type="button" class="m-thumb" data-m="photo" data-name="${name}" data-id="${item.id}"><img src="${apiBase()}/photo/${item.id}" alt="" loading="lazy" /></button>`;
  if (field.type === "geo") return `<a href="https://www.openstreetmap.org/?mlat=${value.lat}&mlon=${value.lng}#map=17/${value.lat}/${value.lng}" target="_blank" rel="noopener">${ico("map", "m-ico tiny")} ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}</a>`;
  if (field.type === "users") return value.map((uid) => badge(nameOf(uid))).join(" ");
  if (field.type === "checks") {
    const missing = Object.keys(field.options).filter((key) => !value.includes(key));
    return name === "prestarts" && missing.length ? missing.map((key) => badge(field.options[key], CRITICAL_ITEMS.includes(key) ? "bad" : "warn")).join(" ") : value.map((key) => badge(field.options[key] || key, "ok")).join(" ");
  }
  return cellOf(name, field, item);
}

function collectionPanel(name, { title, filter, key = name } = {}) {
  const schema = COLLECTIONS[name];
  const columns = schema.fields.filter((field) => field.list);
  const extras = EXTRA_COLS[name] || [];
  const span = columns.length + extras.length + 2;
  const query = (m.query[key] || "").toLowerCase();
  const base = records(name).filter(filter || (() => true)).sort(sortKey(name));
  const spec = filterOf(name);
  const chosen = spec && m.filter[key] && base.some((item) => spec.get(item) === m.filter[key]) ? m.filter[key] : "";
  const list = chosen ? base.filter((item) => spec.get(item) === chosen) : base;
  const rows = list
    .map((item) => {
      const text = searchText(name, item);
      const hide = query && !text.includes(query);
      const details = detailFields(name, item);
      const open = details.length && m.open.has(item.id);
      const toggle = details.length ? `<button type="button" class="m-row-toggle" data-m="row" data-id="${item.id}" aria-expanded="${Boolean(open)}" aria-label="Дэлгэрэнгүй">${ico("chevron")}</button>` : "";
      const main = `<tr class="m-row${open ? " is-open" : ""}${details.length ? " has-detail" : ""}" data-row="${item.id}" data-search="${esc(text)}"${hide ? " hidden" : ""}><td class="m-tcell">${toggle}</td>${columns.map((field) => `<td data-label="${esc(field.label)}">${cellOf(name, field, item)}</td>`).join("")}${extras.map(([label, render]) => `<td data-label="${esc(label)}">${render(item)}</td>`).join("")}<td>${rowActions(name, item)}</td></tr>`;
      const detail = details.length ? `<tr class="m-detail" data-for="${item.id}"${open && !hide ? "" : " hidden"}><td colspan="${span}"><dl class="m-dl">${details.map((field) => `<div class="${["long", "users", "checks", "photo"].includes(field.type) ? "is-wide" : ""}"><dt>${esc(field.label)}</dt><dd>${detailValue(name, field, item)}</dd></div>`).join("")}</dl></td></tr>` : "";
      return main + detail;
    })
    .join("");
  const tools = `
    <label class="m-searchbox">${ico("search")}<input type="search" class="m-search" data-mq="${esc(key)}" value="${esc(m.query[key] || "")}" placeholder="Хайх" aria-label="${esc(schema.label)} хайх" /></label>
    <button class="icon-btn" type="button" data-m="csv" data-name="${name}" title="CSV татах" aria-label="CSV татах">${ico("download")}</button>
    ${name === "violations" && !isGuard() ? "" : addBtn(name)}`;
  const body = `
    ${spec ? chipsHtml(key, base, spec) : ""}
    <div class="m-scroll"><table class="m-table">
      <thead><tr><th class="m-tcell"></th>${columns.map((field) => `<th>${esc(field.label)}</th>`).join("")}${extras.map(([label]) => `<th>${esc(label)}</th>`).join("")}<th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${span}" class="m-empty">${ico(COL_ICON[name] || "list")}<span>Бүртгэл алга</span></td></tr>`}</tbody>
    </table></div>`;
  return panel({ key, icon: COL_ICON[name] || "list", title: title || schema.label, count: list.length === base.length ? base.length : `${list.length}/${base.length}`, tools, body });
}

function csvCell(name, field, item) {
  const value = item[field.key];
  if (value == null) return "";
  if (field.type === "select") return field.options[value] || value;
  if (field.type === "user") return nameOf(value);
  if (field.type === "users") return value.map(nameOf).join("; ");
  if (field.type === "ref") return refLabel(field.ref, value);
  if (field.type === "datetime") return localInput(Date.parse(value)).replace("T", " ");
  if (field.type === "checks") return value.map((key) => field.options[key]).join("; ");
  if (field.type === "bool") return value ? "Тийм" : "Үгүй";
  if (field.type === "geo") return `${value.lat}, ${value.lng}`;
  if (field.type === "photo") return value ? "Тийм" : "";
  return String(value);
}

function downloadCsv(filename, rows) {
  const text = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([`\ufeff${text}`], { type: "text/csv;charset=utf-8" }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/** Columns a CSV adds after the schema's own fields. */
const CSV_EXTRA = {
  violations: [
    ["ХАБЭА төлөв", (item) => VIOLATION_STATUS[item.hseStatus || "new"]],
    ["Арга хэмжээ", (item) => MEASURES[item.measure] || ""],
    ["ХАБЭА тайлбар", (item) => item.hseNote || ""],
    ["Шийдсэн", (item) => (item.hseBy ? `${item.hseBy} ${localInput(Date.parse(item.hseAt)).replace("T", " ")}` : "")],
  ],
};

function exportCollection(name) {
  const fields = COLLECTIONS[name].fields;
  const extra = CSV_EXTRA[name] || [];
  const rows = [
    [...fields.map((field) => field.label), ...extra.map(([label]) => label)],
    ...records(name).sort(sortKey(name)).map((item) => [...fields.map((field) => csvCell(name, field, item)), ...extra.map(([, get]) => get(item))]),
  ];
  downloadCsv(`${name}-${m.data.today}.csv`, rows);
}

/* ---------- forms ---------- */

function inputValue(field, value) {
  if (value === null || value === undefined) return "";
  if (field.type === "datetime") return /Z$|[+-]\d{2}:\d{2}$/.test(value) ? localInput(Date.parse(value)) : value;
  return value;
}

function options(entries, current, blank) {
  return `${blank ? `<option value="">${esc(blank)}</option>` : ""}${entries.map(([value, label]) => `<option value="${esc(value)}"${String(value) === String(current ?? "") ? " selected" : ""}>${esc(label)}</option>`).join("")}`;
}

function userEntries() {
  return (m.data.users || []).map((user) => [user.id, `${user.displayName}${positionOf(user.id) ? ` · ${POSITIONS[positionOf(user.id)]}` : ""}`]).sort((a, b) => a[1].localeCompare(b[1], "mn"));
}

function fieldHtml(name, field, values, item) {
  const value = values[field.key];
  const required = field.required ? " required" : "";
  const label = `<span>${esc(field.label)}${field.required ? " *" : ""}</span>`;
  const show = field.show ? ` data-show='${esc(JSON.stringify(field.show))}'` : "";
  const wide = ["long", "users", "checks", "photo", "geo"].includes(field.type);
  const wrap = (inner, tag = "label") => `<${tag} class="m-field${wide ? " is-wide" : ""}" data-key="${field.key}"${show}>${label}${inner}</${tag}>`;
  switch (field.type) {
    case "text":
      return wrap(`<input name="${field.key}" maxlength="${field.max}" value="${esc(value)}"${required} />`);
    case "long":
      return wrap(`<textarea name="${field.key}" maxlength="${field.max}" rows="${field.max > 900 ? 5 : 3}"${required}>${esc(value)}</textarea>`);
    case "number":
      return wrap(`<input type="number" name="${field.key}" value="${esc(value)}" min="${field.min}" max="${field.max}" step="${field.step || 1}"${required} />`);
    case "date":
      return wrap(`<input type="date" name="${field.key}" value="${esc(value)}"${required} />`);
    case "datetime":
      return wrap(`<input type="datetime-local" name="${field.key}" value="${esc(inputValue(field, value))}"${required} />`);
    case "time":
      return wrap(`<input type="time" name="${field.key}" value="${esc(value)}" />`);
    case "url":
      return `<label class="m-field is-wide" data-key="${field.key}"${show}>${label}<input type="url" inputmode="url" name="${field.key}" maxlength="${field.max}" placeholder="https://" value="${esc(value)}" spellcheck="false" autocomplete="off" /></label>`;
    case "select":
      return wrap(`<select name="${field.key}"${required}>${options(Object.entries(field.options), value, field.required ? "" : "—")}</select>`);
    case "user":
      return wrap(`<select name="${field.key}"${required}>${options(userEntries(), value, field.required ? "Сонгоно уу" : "—")}</select>`);
    case "ref":
      return wrap(`<select name="${field.key}"${required}>${options(records(field.ref).map((row) => [row.id, REF_LABEL[field.ref]?.(row) || row.name || row.title || row.id]), value, field.required ? "Сонгоно уу" : "—")}</select>`);
    case "bool":
      return `<label class="m-field m-check" data-key="${field.key}"${show}><input type="checkbox" name="${field.key}"${value ? " checked" : ""} /> <span>${esc(field.label)}</span></label>`;
    case "users": {
      const chosen = new Set(value || []);
      return wrap(`<div class="m-checks">${userEntries().map(([uid, text]) => `<label><input type="checkbox" name="${field.key}" value="${uid}"${chosen.has(uid) ? " checked" : ""} /> ${esc(text)}</label>`).join("")}</div>`, "div");
    }
    case "checks": {
      const chosen = new Set(value || []);
      return wrap(`<div class="m-checks">${Object.entries(field.options).map(([key, text]) => `<label><input type="checkbox" name="${field.key}" value="${key}"${chosen.has(key) ? " checked" : ""} /> ${esc(text)}</label>`).join("")}</div>`, "div");
    }
    case "photo": {
      const has = Boolean(item?.photo);
      return wrap(`<div class="m-photo">
          <input type="hidden" name="${field.key}" value="${has ? "keep" : ""}" />
          <img class="m-photo-img" alt=""${has ? ` src="${apiBase()}/photo/${item.id}"` : " hidden"} />
          <span class="m-acts"><label class="chip m-file">${ico("photo")}Зураг сонгох<input type="file" accept="image/*" capture="environment" data-photo="${field.key}" hidden /></label>
          <button class="chip" type="button" data-photo-clear="${field.key}"${has ? "" : " hidden"}>Зураг хасах</button></span>
        </div>`, "div");
    }
    case "geo":
      return wrap(`<div class="m-geo"><input type="number" step="0.000001" name="${field.key}_lat" placeholder="Өргөрөг" value="${esc(value?.lat ?? "")}" /><input type="number" step="0.000001" name="${field.key}_lng" placeholder="Уртраг" value="${esc(value?.lng ?? "")}" /><button class="chip" type="button" data-locate="${field.key}">${ico("map")}Одоогийн байршил</button></div>`, "div");
    default:
      return "";
  }
}

function formValues(form, fields) {
  const out = {};
  for (const field of fields) {
    if (field.type === "users" || field.type === "checks") out[field.key] = [...form.querySelectorAll(`[name="${field.key}"]:checked`)].map((input) => input.value);
    else if (field.type === "bool") out[field.key] = form.elements[field.key].checked;
    else if (field.type === "geo") {
      const lat = form.elements[`${field.key}_lat`].value;
      const lng = form.elements[`${field.key}_lng`].value;
      out[field.key] = lat !== "" && lng !== "" ? { lat: Number(lat), lng: Number(lng) } : null;
    } else if (field.type === "photo") {
      const value = form.elements[field.key].value;
      if (value !== "keep") out[field.key] = value || null;
    } else out[field.key] = form.elements[field.key]?.value ?? "";
  }
  return out;
}

function applyShow(form) {
  const values = Object.fromEntries([...form.querySelectorAll("select")].map((select) => [select.name, select.value]));
  for (const node of form.querySelectorAll("[data-show]")) node.hidden = !fieldShown({ show: JSON.parse(node.dataset.show) }, values);
}

async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let quality = 0.8;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length > 440_000 && quality > 0.35) {
    quality -= 0.15;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  return data;
}

/** Photo picking, clearing and "use my location" inside any form. */
function wireFormExtras(root) {
  root.addEventListener("change", async (event) => {
    const input = event.target.closest("[data-photo]");
    if (!input?.files?.[0]) return;
    const box = input.closest(".m-photo");
    try {
      const data = await shrinkPhoto(input.files[0]);
      box.querySelector(`[name="${input.dataset.photo}"]`).value = data;
      const img = box.querySelector("img");
      img.src = data;
      img.hidden = false;
      box.querySelector("[data-photo-clear]").hidden = false;
    } catch {
      ctx.toast("Зураг", "Зургийг уншиж чадсангүй");
    }
  });
  root.addEventListener("click", (event) => {
    const clear = event.target.closest("[data-photo-clear]");
    if (clear) {
      const box = clear.closest(".m-photo");
      box.querySelector(`[name="${clear.dataset.photoClear}"]`).value = "";
      box.querySelector("img").hidden = true;
      clear.hidden = true;
    }
    const locate = event.target.closest("[data-locate]");
    if (locate && navigator.geolocation) {
      locate.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const form = locate.closest("form");
          form.elements[`${locate.dataset.locate}_lat`].value = position.coords.latitude.toFixed(6);
          form.elements[`${locate.dataset.locate}_lng`].value = position.coords.longitude.toFixed(6);
          locate.disabled = false;
        },
        () => {
          locate.disabled = false;
          ctx.toast("Байршил", "Байршил авах зөвшөөрөл олгогдоогүй");
        },
        { timeout: 8000 },
      );
    }
  });
}

function formError(form, text) {
  const node = form.querySelector(".m-form-error");
  node.textContent = text;
  node.hidden = !text;
}

function openForm(name, item = null, preset = {}) {
  const schema = COLLECTIONS[name];
  const now = Date.now();
  const values = item ? { ...item } : Object.fromEntries(schema.fields.map((field) => [field.key, defaultValue(field, now)]));
  Object.assign(values, preset);
  const hint = name === "cameras" ? `<p class="m-hint">${ico("cctv")}<span>IP камер ихэвчлэн RTSP урсгал гаргадаг бөгөөд хөтөч үүнийг шууд тоглуулахгүй. NVR эсвэл камерын <b>MJPEG</b>, <b>snapshot</b> (JPEG) хаяг, эсвэл go2rtc / MediaMTX зэрэг хөрвүүлэгчийн <b>https</b> хаягийг оруулна уу. Туршихдаа «Туршилтын» эсвэл «Энэ төхөөрөмжийн камер»-ыг сонгоно.</span></p>` : "";
  const body = `<form class="m-form" novalidate>${hint}
      <div class="m-form-grid">${schema.fields.map((field) => fieldHtml(name, field, values, item)).join("")}</div>
      <p class="form-error m-form-error" role="alert" hidden></p>
      <div class="modal-actions"><button class="chip" type="button" data-close>Болих</button><button class="primary" type="submit">${ico(item ? "check" : "add")}${item ? "Хадгалах" : "Нэмэх"}</button></div>
    </form>`;
  const wrap = ctx.openModal({ shield: ico(item ? "edit" : "add"), title: esc(schema.label), sub: item ? "Бүртгэл засах" : "Шинэ бүртгэл", body, className: "m-modal" });
  if (!wrap) return;
  const form = wrap.querySelector("form");
  applyShow(form);
  wireFormExtras(form);
  form.addEventListener("change", () => applyShow(form));
  form.addEventListener("input", () => (form.dataset.dirty = "1"), { once: true });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    formError(form, "");
    try {
      const data = formValues(form, schema.fields);
      await send(item ? `${apiBase()}/c/${name}/${item.id}` : `${apiBase()}/c/${name}`, item ? "PUT" : "POST", data);
      ctx.closeModal(true);
      setTimeout(() => paint(true), 260);
    } catch (error) {
      formError(form, error.message);
      button.disabled = false;
    }
  });
  requestAnimationFrame(() => form.querySelector("input:not([type=hidden]), select, textarea")?.focus({ preventScroll: true }));
}

async function quickPatch(name, id, patch) {
  const item = recordOf(name, id);
  if (!item) return;
  const body = { ...item, ...patch };
  delete body.photo;
  await attempt(() => send(`${apiBase()}/c/${name}/${id}`, "PUT", body));
}

/* ---------- QR scanning ---------- */

/** Camera QR reading inside an open modal until it closes; `onCode` returns the line to show. */
async function startScan(wrap, onCode) {
  const box = wrap.querySelector(".m-scan");
  const video = box.querySelector("video");
  const status = box.querySelector(".m-scan-msg");
  box.hidden = false;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch {
    status.textContent = "Камер нээгдсэнгүй. Зөвшөөрөл олгоно уу.";
    return;
  }
  video.srcObject = stream;
  await video.play().catch(() => {});
  const canvas = document.createElement("canvas");
  const draw = canvas.getContext("2d", { willReadFrequently: true });
  let last = "";
  let lastAt = 0;
  let working = false;
  const timer = setInterval(async () => {
    if (!wrap.isConnected || wrap.classList.contains("is-closing")) {
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    if (working || video.readyState < 2 || !window.jsQR) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    draw.drawImage(video, 0, 0);
    const code = window.jsQR(draw.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (!code?.data || (code.data === last && Date.now() - lastAt < 4000)) return;
    last = code.data;
    lastAt = Date.now();
    working = true;
    try {
      status.textContent = await onCode(code.data);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      working = false;
    }
  }, 300);
}

const SCAN_BOX = `<div class="m-scan" hidden><video playsinline muted></video><p class="m-scan-msg" role="status">${ico("qr", "m-ico tiny")} QR</p></div>`;

/* ---------- toolbox talk acknowledgement ---------- */

function talkAckBody(id) {
  const talk = recordOf("talks", id);
  if (!talk) return `<p class="muted">Зааварчилгаа олдсонгүй</p>`;
  const audience = m.data.audience[id] || [];
  const ids = [...new Set([...audience, ...talk.acks.map((ack) => ack.uid)])];
  const rows = ids
    .map((uid) => {
      const ack = talk.acks.find((item) => item.uid === uid);
      return `<li><b>${esc(nameOf(uid))}</b>${audience.includes(uid) ? "" : ` <small class="muted">(жагсаалтаас гадуур)</small>`}<span>${ack ? badge(`${clockOf(ack.at)} · ${ack.via === "qr" ? "карт" : ack.via === "app" ? "апп" : "мастер"}`, "ok") : `<button class="chip" type="button" data-ack="${uid}">${ico("check")}Танилцсан</button>`}</span></li>`;
    })
    .join("");
  return `<div class="m-talk"><p class="m-talk-text">${esc(talk.content)}</p>
    <div class="m-acts"><button class="primary" type="button" data-scan>${ico("qr")}Карт уншуулж бүртгэх</button></div>
    ${SCAN_BOX}
    <ul class="m-roll">${rows || `<li class="m-none">${ico("people", "m-ico tiny")}Ажилтан алга</li>`}</ul></div>`;
}

function openTalkAcks(id) {
  const talk = recordOf("talks", id);
  if (!talk) return;
  const wrap = ctx.openModal({ shield: ico("people"), title: esc(talk.topic), sub: `${fmtDate(talk.date)} · ${SHIFTS[talk.shift]} ээлж`, body: talkAckBody(id), className: "m-modal" });
  if (!wrap) return;
  const body = wrap.querySelector(".modal-body");
  const repaint = () => {
    const holder = document.createElement("div");
    holder.innerHTML = talkAckBody(id);
    const fresh = holder.querySelector(".m-roll");
    if (fresh) body.querySelector(".m-roll")?.replaceWith(fresh);
  };
  watchModal(wrap, repaint);
  body.addEventListener("click", async (event) => {
    const ack = event.target.closest("[data-ack]");
    if (ack) {
      ack.disabled = true;
      await attempt(() => send(`/api/master/talks/${id}/ack`, "POST", { uid: ack.dataset.ack }));
      repaint();
    }
    const scan = event.target.closest("[data-scan]");
    if (scan) {
      scan.hidden = true;
      startScan(wrap, async (text) => {
        const result = await send(`/api/master/talks/${id}/ack`, "POST", { qr: text });
        repaint();
        return result.already ? `${result.name}: өмнө нь бүртгэгдсэн` : `${result.name}: танилцсан гэж бүртгэлээ`;
      });
    }
  });
}

/* ---------- muster ---------- */

function musterBody() {
  const muster = m.data.hse.musters.find((item) => !item.end);
  if (!muster) return `<p class="muted">Цуглаан дууссан.</p>`;
  const label = (key) => (key.startsWith("v:") ? `${recordOf("visitors", key.slice(2))?.name || "Зочин"} (зочин)` : nameOf(key));
  const missing = muster.expected.filter((key) => !muster.checked[key]);
  const present = muster.expected.filter((key) => muster.checked[key]);
  return `<div class="m-muster">
    <div class="m-muster-count"><div class="is-bad"><b>${missing.length}</b><span>Дутуу</span></div><div class="is-ok"><b>${present.length}</b><span>Цугласан</span></div><div><b>${muster.expected.length}</b><span>Нийт</span></div></div>
    <div class="m-acts"><button class="primary" type="button" data-scan>${ico("qr")}Карт / зочны QR уншуулах</button><button class="chip danger" type="button" data-end>${ico("stop")}Цуглааныг дуусгах</button></div>
    ${SCAN_BOX}
    <div class="m-muster-lists">
      <h3>Дутуу</h3>
      <ul class="m-roll">${missing.map((key) => `<li><b>${esc(label(key))}</b><span><button class="chip" type="button" data-here="${esc(key)}">${ico("check")}Ирсэн</button></span></li>`).join("") || `<li class="m-none">${ico("check", "m-ico tiny")}Бүгд цугласан</li>`}</ul>
      <h3>Цугласан</h3>
      <ul class="m-roll">${present.map((key) => `<li><b>${esc(label(key))}</b><span>${badge(`${clockOf(muster.checked[key].at)} · ${muster.checked[key].via === "qr" ? "QR" : muster.checked[key].via === "app" ? "апп" : "мастер"}`, "ok")}</span></li>`).join("")}</ul>
    </div>
  </div>`;
}

/** Keeps an open popup's lists current as polling brings new data; forgotten once it closes. */
function watchModal(wrap, repaint) {
  m.modalRepaint = () => {
    if (!wrap.isConnected || wrap.classList.contains("is-closing")) {
      m.modalRepaint = null;
      return;
    }
    repaint();
  };
}

function openMuster() {
  const muster = m.data.hse.musters.find((item) => !item.end);
  if (!muster) return;
  const wrap = ctx.openModal({ shield: ico("people"), title: `Цуглаан · ${esc(muster.reason)}`, sub: `${clockOf(muster.at)}-с`, body: musterBody(), className: "m-modal" });
  if (!wrap) return;
  const body = wrap.querySelector(".modal-body");
  const repaint = () => {
    const holder = document.createElement("div");
    holder.innerHTML = musterBody();
    for (const selector of [".m-muster-count", ".m-muster-lists"]) {
      const fresh = holder.querySelector(selector);
      if (fresh) body.querySelector(selector)?.replaceWith(fresh);
    }
  };
  watchModal(wrap, repaint);
  body.addEventListener("click", async (event) => {
    const here = event.target.closest("[data-here]");
    if (here) {
      here.disabled = true;
      const key = here.dataset.here;
      await attempt(() => send("/api/master/muster/check", "POST", key.startsWith("v:") ? { visitor: key.slice(2) } : { uid: key }));
      repaint();
    }
    if (event.target.closest("[data-scan]")) {
      event.target.closest("[data-scan]").hidden = true;
      startScan(wrap, async (text) => {
        const result = await send("/api/master/muster/check", "POST", { qr: text });
        repaint();
        return result.already ? `${result.name}: өмнө нь бүртгэгдсэн` : `${result.name}: цуглах цэгт ирсэн`;
      });
    }
    if (event.target.closest("[data-end]")) {
      const missing = (m.data.hse.musters.find((item) => !item.end)?.expected.length || 0) - Object.keys(m.data.hse.musters.find((item) => !item.end)?.checked || {}).length;
      if (missing > 0 && !confirm(`${missing} хүн бүртгэгдээгүй байна. Цуглааныг дуусгах уу?`)) return;
      if (await attempt(() => send("/api/master/muster/end"))) {
        ctx.closeModal(true);
        setTimeout(() => paint(true), 260);
      }
    }
  });
}

/* ---------- visitor pass and photo ---------- */

function passSvg(item) {
  if (!window.qrcode || !item.key) return "";
  const qr = window.qrcode(0, "M");
  qr.addData(`UMBV:${item.key}`);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

function passHtml(item) {
  const ready = visitorReady(item, m.data.today);
  return `<div class="m-pass">
    <div class="m-pass-qr">${passSvg(item)}</div>
    <div class="m-pass-info">
      <b>${esc(item.name)}</b>
      <span>${esc(VISITOR_KINDS[item.kind])}${item.company ? ` · ${esc(item.company)}` : ""}</span>
      <span>Хүчинтэй: ${fmtDate(item.from)} – ${fmtDate(item.to)}</span>
      <span>Хүлээн авагч: ${esc(nameOf(item.host))}</span>
      <span>${ready ? badge("Танилцуулга бүрэн", "ok") : badge(`Танилцуулга ${(item.induction || []).length}/${Object.keys(INDUCTION_ITEMS).length}`, "warn")}</span>
    </div>
  </div>`;
}

function openPass(id) {
  const item = recordOf("visitors", id);
  if (!item) return;
  const wrap = ctx.openModal({
    shield: ico("qr"),
    title: "Түр нэвтрэх эрх",
    sub: `${fmtDate(item.from)} – ${fmtDate(item.to)}`,
    body: `${passHtml(item)}<div class="modal-actions"><button class="chip" type="button" data-close>Хаах</button><button class="primary" type="button" data-print>${ico("print")}Хэвлэх</button></div>`,
    className: "m-modal",
  });
  wrap?.querySelector("[data-print]").addEventListener("click", () => {
    const page = window.open("", "_blank", "width=480,height=640");
    if (!page) return;
    page.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(item.name)}</title><style>body{font:14px sans-serif;text-align:center;padding:24px}svg{width:240px;height:240px}b{display:block;font-size:20px;margin:12px 0 4px}span{display:block;margin:2px 0}</style>${passSvg(item)}<b>${esc(item.name)}</b><span>${esc(item.company || "")}</span><span>${fmtDate(item.from)} – ${fmtDate(item.to)}</span><span>UMBRELLA · түр нэвтрэх эрх</span><script>onload=()=>print()</script>`);
    page.document.close();
  });
}

function openPhoto(name, id) {
  const item = recordOf(name, id);
  const title = name === "violations" && item ? `${VIOLATION_KINDS[item.kind]} · ${violatorOf(item)}` : item?.title || "Зураг";
  ctx.openModal({ shield: ico("photo"), title: esc(title), sub: item ? fmtMoment(item.at) : "", body: `<img class="m-photo-full" src="${apiBase()}/photo/${esc(id)}" alt="" />`, className: "m-modal" });
}

/* ---------- HSE decision on a security violation ---------- */

function openViolationDecide(id) {
  const item = recordOf("violations", id);
  if (!item) return;
  const status = item.hseStatus && item.hseStatus !== "new" ? item.hseStatus : "acted";
  const choice = (value, label, hint) => `<label class="m-choice"><input type="radio" name="status" value="${value}"${status === value ? " checked" : ""} /><span><b>${esc(label)}</b><small>${esc(hint)}</small></span></label>`;
  const body = `<form class="m-form m-vio-form" novalidate>
      <div class="m-vio-sum">
        ${badge(SEVERITIES[item.severity], TONE.severity[item.severity])}
        <b>${esc(VIOLATION_KINDS[item.kind])}</b>
        <span>${esc(violatorOf(item))} · ${esc(VIOLATORS[item.party])}${item.place ? ` · ${esc(item.place)}` : ""}</span>
        <p class="m-pre">${esc(item.detail)}</p>
        ${item.photo ? `<img class="m-vio-photo" src="${apiBase()}/photo/${esc(id)}" alt="Нотлох зураг" />` : ""}
      </div>
      <div class="m-choices">
        ${choice("review", VIOLATION_STATUS.review, "Шалгаж байгааг хамгаалалтад мэдэгдэнэ")}
        ${choice("acted", VIOLATION_STATUS.acted, "Арга хэмжээ сонгож бүртгэнэ")}
        ${choice("dismissed", VIOLATION_STATUS.dismissed, "Шалтгаанаа заавал бичнэ")}
      </div>
      <div class="m-form-grid">
        <label class="m-field" data-vio="acted"><span>Арга хэмжээ *</span><select name="measure">${options(Object.entries(MEASURES), item.measure, "Сонгоно уу")}</select></label>
        <label class="m-field is-wide"><span>Тайлбар</span><textarea name="note" maxlength="300" rows="3">${esc(item.hseNote || "")}</textarea></label>
      </div>
      ${item.party === "staff" ? `<p class="m-hint">${ico("bell")}<span>Арга хэмжээ авбал ажилтанд мэдэгдэл очно.</span></p>` : ""}
      <p class="form-error m-form-error" role="alert" hidden></p>
      <div class="modal-actions"><button class="chip" type="button" data-close>Болих</button><button class="primary" type="submit">${ico("check")}Хадгалах</button></div>
    </form>`;
  const wrap = ctx.openModal({ shield: ico("gavel"), title: "ХАБЭА · зөрчил", sub: `${fmtMoment(item.at)} · хамгаалалтаас`, body, className: "m-modal" });
  if (!wrap) return;
  const form = wrap.querySelector("form");
  const sync = () => {
    const acted = form.elements.status.value === "acted";
    form.querySelector("[data-vio='acted']").hidden = !acted;
  };
  sync();
  form.addEventListener("change", sync);
  form.addEventListener("input", () => (form.dataset.dirty = "1"), { once: true });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    formError(form, "");
    try {
      await send(`/api/master/violations/${encodeURIComponent(id)}/decide`, "POST", { status: form.elements.status.value, measure: form.elements.measure.value, note: form.elements.note.value });
      ctx.closeModal(true);
      setTimeout(() => paint(true), 260);
      ctx.toast("ХАБЭА", "Шийдвэр хадгалагдлаа");
    } catch (error) {
      formError(form, error.message);
      button.disabled = false;
    }
  });
}

/* ---------- transport manifests ---------- */

function manifest(item) {
  const change = crewChange(staffUsers(), m.data.plans, m.data.leaves, item.date);
  const crew = item.vehicle === "bus" ? (item.dir === "in" ? change.arrive : change.depart) : [];
  return [...new Set([...crew, ...(item.extra || [])])];
}

function openManifest(id) {
  const item = recordOf("transport", id);
  if (!item) return;
  const people = manifest(item);
  const rows = people.map((uid, index) => `<li><b>${index + 1}. ${esc(nameOf(uid))}</b><span class="muted">${esc(userOf(uid)?.card?.idNumber || "")}${positionOf(uid) ? ` · ${esc(POSITIONS[positionOf(uid)])}` : ""}</span></li>`).join("");
  const wrap = ctx.openModal({
    shield: ico("people"),
    title: `${esc(item.route || "Ээлжийн тээвэр")}`,
    sub: `${fmtDate(item.date)} ${item.depart || ""} · ${item.dir === "in" ? "Ирэх" : "Буцах"} · ${esc(item.ref || "")}`,
    body: `<ul class="m-roll">${rows || `<li class="muted">Зорчигч алга</li>`}</ul><div class="modal-actions"><button class="chip" type="button" data-close>Хаах</button><button class="primary" type="button" data-csv>${ico("download")}CSV</button></div>`,
    className: "m-modal",
  });
  wrap?.querySelector("[data-csv]").addEventListener("click", () =>
    downloadCsv(`manifest-${item.date}-${item.dir}.csv`, [["#", "Нэр", "ID", "Албан тушаал"], ...people.map((uid, index) => [index + 1, nameOf(uid), userOf(uid)?.card?.idNumber || "", POSITIONS[positionOf(uid)] || ""])]),
  );
}

/* ---------- special tabs ---------- */

function productionChart(kpi) {
  const top = Math.max(1, ...kpi.production.map((item) => Math.max(item.tonnes, item.plan))) * 1.1;
  return `<div class="m-chart" role="img" aria-label="7 хоногийн олборлолт">${kpi.production
    .map((item) => {
      const pct = item.plan ? Math.round((item.tonnes / item.plan) * 100) : 0;
      return `<div class="m-bar-col" title="${fmtDate(item.date)}: ${num(item.tonnes)} / ${num(item.plan)} т">
        <div class="m-bar-area"><i class="m-plan" style="bottom:${(item.plan / top) * 100}%"></i><b class="m-bar${pct >= 100 ? " is-ok" : pct >= 90 ? " is-warn" : " is-bad"}" style="height:${(item.tonnes / top) * 100}%"></b></div>
        <span>${fmtDate(item.date)}</span><small>${item.tonnes ? `${pct}%` : "–"}</small></div>`;
    })
    .join("")}</div>`;
}

function kpiPanel() {
  const kpi = m.data.kpi;
  const card = (icon, value, label, note = "", tone = "") => `<div class="m-kpi${tone ? ` is-${tone}` : ""}">${ico(icon)}<b>${value}</b><span>${label}</span>${note ? `<small>${note}</small>` : ""}</div>`;
  const tools = `<form class="m-inline" data-mform="plan"><label title="Өдрийн төлөвлөгөө, тонн">${ico("calendar")}<input type="number" name="planTonnes" min="0" step="100" value="${m.data.ops.planTonnes}" aria-label="Өдрийн төлөвлөгөө, тонн" /><span>т</span></label><button class="icon-btn" type="submit" title="Хадгалах" aria-label="Хадгалах">${ico("check")}</button></form>`;
  return panel({
    key: "kpi",
    icon: "chart",
    title: "Гүйцэтгэл · 7 хоног",
    tools,
    body: `<div class="m-kpis">
      ${card("mine", `${num(kpi.prodTotal)} т`, "Олборлолт", `${num(kpi.prodPlan)} т · ${kpi.prodPlan ? Math.round((kpi.prodTotal / kpi.prodPlan) * 100) : 0}%`, kpi.prodTotal >= kpi.prodPlan ? "ok" : "warn")}
      ${card("truck", pct(kpi.availability), "Бэлэн байдал")}
      ${card("gauge", pct(kpi.utilization), "Ашиглалт")}
      ${card("shield", kpi.ltifr, "LTIFR", `${kpi.lti} LTI · ${num(kpi.hoursWorked)} хүн-цаг`, kpi.lti ? "bad" : "ok")}
      ${card("heart", kpi.trifr, "TRIFR", `${kpi.recordable} гэмтэл`, kpi.recordable ? "warn" : "ok")}
    </div>
    ${productionChart(kpi)}`,
  });
}

function fleetPanel() {
  const machines = [...m.data.ops.equipment].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  const chosen = m.filter.fleet || "";
  const counts = machines.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  const chip = (value, label, count) => `<button type="button" class="m-chip${chosen === value ? " is-on" : ""}" data-m="filter" data-key="fleet" data-value="${value}">${esc(label)}<i>${count}</i></button>`;
  const chips = `<div class="m-chips">${ico("sliders")}${chip("", "Бүгд", machines.length)}${Object.entries(EQUIP_STATUS).filter(([key]) => counts[key]).map(([key, label]) => chip(key, label, counts[key])).join("")}</div>`;
  return panel({
    key: "fleet",
    icon: "truck",
    title: `Техник · ${SHIFTS[m.data.shift]} ээлж`,
    count: machines.length,
    body: `${chips}<div class="m-fleet">${machines
      .filter((item) => !chosen || item.status === chosen)
      .map((item) => {
        const assign = records("assigns").find((row) => row.equipment === item.id && row.date === m.data.shiftDate && row.shift === m.data.shift);
        const service = serviceDue(item);
        return `<button type="button" class="m-machine is-${item.status}" data-m="edit" data-name="equipment" data-id="${item.id}">
          <span class="m-machine-top"><b>${esc(item.code)}</b>${badge(EQUIP_STATUS[item.status], TONE.equip[item.status])}</span>
          <span>${esc(EQUIP_TYPES[item.type])}</span>
          <small>${assign ? `${ico("user", "m-ico tiny")} ${esc(nameOf(assign.operator))}` : "–"}</small>
          ${service.due ? `<i class="m-dot" title="Засварын хугацаа болсон"></i>` : ""}
        </button>`;
      })
      .join("")}</div>`,
  });
}

const subHead = (icon, text, count) => `<h3 class="m-sub">${ico(icon, "m-ico tiny")}${esc(text)}${count != null ? `<span>${count}</span>` : ""}</h3>`;

function peopleSummary() {
  const d = m.data;
  const unfit = Object.entries(d.fatigue).filter(([, item]) => item.state === "unfit" || item.state === "caution");
  const held = Object.entries(d.holds).filter(([, list]) => list.length);
  return panel({
    key: "people-sum",
    icon: "people",
    title: "Хүмүүс",
    body: `${subHead("lock", "Картын хориг", held.length)}
    <ul class="m-roll">${held.map(([uid, list]) => `<li><b>${esc(nameOf(uid))}</b><span>${list.map((text) => badge(text, "bad")).join(" ")}</span></li>`).join("") || `<li class="m-none">${ico("check", "m-ico tiny")}Хориггүй</li>`}</ul>
    ${subHead("clock", "Ядаргаа", unfit.length)}
    <ul class="m-roll">${unfit.map(([uid, item]) => `<li><b>${esc(nameOf(uid))}</b><span>${badge(item.label, item.state === "unfit" ? "bad" : "warn")} <small class="muted">${esc(item.reasons.join(", "))}</small></span></li>`).join("") || `<li class="m-none">${ico("check", "m-ico tiny")}Хэвийн</li>`}</ul>`,
  });
}

function todaySafety() {
  const d = m.data;
  const now = Date.parse(d.now);
  const talks = d.hse.talks.filter((item) => item.date === d.shiftDate);
  const permits = d.hse.permits.filter((item) => ["active", "expired"].includes(permitState(item, now)));
  const blasts = d.hse.blasts.filter((item) => item.status === "planned").sort((a, b) => a.at.localeCompare(b.at));
  return panel({
    key: "today-safety",
    icon: "shield",
    title: "Өнөөдрийн аюулгүй ажиллагаа",
    body: `${subHead("megaphone", "Зааварчилгаа", talks.length)}
    <ul class="m-roll">${talks.map((item) => {
      const audience = d.audience[item.id] || [];
      const acked = item.acks.filter((ack) => audience.includes(ack.uid)).length;
      return `<li><b>${SHIFTS[item.shift]} · ${esc(item.topic)}</b><span>${badge(`${acked}/${audience.length}`, acked === audience.length ? "ok" : "warn")}${toolBtn("talk-acks", "people", "Танилцсан бүртгэл", ` data-id="${item.id}"`)}</span></li>`;
    }).join("") || `<li class="m-none">${ico("megaphone", "m-ico tiny")}Алга <button class="icon-btn" type="button" data-m="new" data-name="talks" title="Нэмэх" aria-label="Нэмэх">${ico("add")}</button></li>`}</ul>
    ${subHead("permit", "Ажлын зөвшөөрөл", permits.length)}
    <ul class="m-roll">${permits.map((item) => {
      const state = permitState(item, now);
      return `<li><b>${esc(PERMIT_TYPES[item.type])} · ${esc(item.title)}</b><span>${badge(state === "expired" ? `${clockOf(item.to)}-д дууссан` : `${clockOf(item.to)} хүртэл`, state === "expired" ? "bad" : "ok")} <small class="muted">${esc(nameOf(item.holder))}</small></span></li>`;
    }).join("") || `<li class="m-none">${ico("permit", "m-ico tiny")}Алга</li>`}</ul>
    ${subHead("blast", "Тэсэлгээ", blasts.length)}
    <ul class="m-roll">${blasts.map((item) => `<li><b>${fmtMoment(item.at)} · ${esc(item.place)}</b><span>${badge(`${item.radius} м`, "warn")} <small class="muted">${esc(nameOf(item.blaster))}</small></span></li>`).join("") || `<li class="m-none">${ico("blast", "m-ico tiny")}Алга</li>`}</ul>`,
  });
}

const WX_ICON = { wind: "sliders", cold: "cloud", heat: "cloud", thunder: "blast", precip: "cloud" };

function weatherCard() {
  const weather = m.data.weather;
  const cells = Object.entries(WX_METRICS).map(([key, spec]) => {
    const value = wxValue(weather, key);
    return `<div>${ico(WX_ICON[key] || "cloud")}<b>${value == null ? "–" : spec.op === "flag" ? (value ? "Тийм" : "Үгүй") : `${Math.round(value * 10) / 10}`}</b><span>${esc(spec.label)}${spec.unit && spec.op !== "flag" ? `, ${esc(spec.unit)}` : ""}</span></div>`;
  });
  const tag = weather ? `${weather.simulated ? badge("туршилт", "info") : ""} ${esc(weather.condition || "")}` : "–";
  return panel({ key: "weather-now", icon: "cloud", title: "Цаг агаар", tools: `<span class="m-head-note">${tag}</span>`, body: `<div class="m-wx">${cells.join("")}</div>` });
}

function emergencyPanel() {
  const muster = m.data.hse.musters.find((item) => !item.end);
  const body = muster
    ? `<div class="m-live">${ico("people")}<b>${esc(muster.reason)}</b><button class="primary" type="button" data-m="muster-open">${ico("list")}Жагсаалт</button></div>`
    : `<form class="m-muster-form" data-mform="muster-start">
        <input name="reason" maxlength="120" placeholder="Шалтгаан" aria-label="Шалтгаан" />
        <label class="m-switch" title="White Queen станцаар зарлах"><input type="checkbox" name="announce" checked /><span>${ico("megaphone", "m-ico tiny")}Станц</span></label>
        <button class="primary danger" type="submit">${ico("siren")}Цуглаан зарлах</button>
      </form>`;
  return panel({ key: "emergency", icon: "siren", title: "Онцгой байдал", body, cls: "m-emergency" });
}

function dashboard() {
  return `<div class="m-grid">
    ${emergencyPanel()}
    ${weatherCard()}
    ${todaySafety()}
    ${peopleSummary()}
  </div>
  ${kpiPanel()}
  ${fleetPanel()}`;
}

function weatherTab() {
  const sim = m.data.wxSim;
  const events = [...m.data.hse.wxEvents].reverse().slice(0, 20);
  const simForm = `<form class="m-form" data-mform="wxsim">
        <div class="m-form-grid">
          <label class="m-field"><span>Салхи, м/с</span><input type="number" name="windSpeedMs" min="0" max="60" step="0.1" value="${esc(sim?.windSpeedMs ?? "")}" placeholder="бодит" /></label>
          <label class="m-field"><span>Мэдрэгдэх темп., °C</span><input type="number" name="feelsLikeC" min="-70" max="60" step="0.1" value="${esc(sim?.feelsLikeC ?? "")}" placeholder="бодит" /></label>
          <label class="m-field"><span>Хур тунадас, мм</span><input type="number" name="precipNowMm" min="0" max="50" step="0.1" value="${esc(sim?.precipNowMm ?? "")}" placeholder="бодит" /></label>
          <label class="m-field"><span>Хугацаа, минут</span><input type="number" name="minutes" min="1" max="120" value="15" /></label>
          <label class="m-field m-check"><input type="checkbox" name="thunder"${sim?.code ? " checked" : ""} /> <span>Аянга, аадар</span></label>
        </div>
        <div class="modal-actions">${sim ? `<button class="chip" type="button" data-m="wxsim-clear">${ico("stop")}${clockOf(sim.until)} хүртэл</button>` : ""}<button class="primary" type="submit">${ico("play")}Эхлүүлэх</button></div>
      </form>`;
  const history = `<div class="m-scroll"><table class="m-table"><thead><tr><th>Босго</th><th>Эхэлсэн</th><th>Дууссан</th><th>Утга</th><th>Арга хэмжээ</th></tr></thead>
    <tbody>${events.map((item) => `<tr><td>${esc(item.name)}${item.simulated ? ` ${badge("туршилт", "info")}` : ""}</td><td>${fmtMoment(item.start)}</td><td>${item.end ? fmtMoment(item.end) : badge("Үргэлжилж байна", "bad")}</td><td>${item.value == null ? "–" : Math.round(item.value * 10) / 10}</td><td>${esc(item.action)}</td></tr>`).join("") || `<tr><td colspan="5" class="m-empty">${ico("clock")}<span>Түүх алга</span></td></tr>`}</tbody></table></div>`;
  return `<div class="m-grid">
    ${weatherCard()}
    ${panel({ key: "wx-sim", icon: "play", title: "Цаг агаар дуурайх", tools: sim ? badge("идэвхтэй", "info") : "", body: simForm })}
  </div>
  ${collectionPanel("wxRules")}
  ${panel({ key: "wx-history", icon: "clock", title: "Ажил зогсоосон түүх", count: events.length, body: history })}`;
}

function emergencyTab() {
  const d = m.data;
  const now = Date.parse(d.now);
  const sos = [...d.hse.sos].reverse().slice(0, 40);
  const lone = d.hse.lone.filter((item) => item.active);
  const musters = [...d.hse.musters].reverse().slice(0, 10);
  const loneList = `<ul class="m-roll">${lone.map((item) => {
        const due = Date.parse(item.lastCheck) + item.interval * 60000;
        return `<li><b>${esc(nameOf(item.uid))}${item.place ? ` · ${esc(item.place)}` : ""}</b><span>${due < now ? badge(`${untilText(now - due)} хоцорсон`, "bad") : badge(`${untilText(due - now)}`, "ok")} <small class="muted">${item.interval} мин</small></span></li>`;
      }).join("") || `<li class="m-none">${ico("user", "m-ico tiny")}Алга</li>`}</ul>`;
  const sosChosen = m.filter.sos || "";
  const sosCounts = sos.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {});
  const sosChip = (value, label, count) => `<button type="button" class="m-chip${sosChosen === value ? " is-on" : ""}" data-m="filter" data-key="sos" data-value="${value}">${esc(label)}<i>${count}</i></button>`;
  const sosChips = Object.keys(sosCounts).length > 1 ? `<div class="m-chips">${ico("sliders")}${sosChip("", "Бүгд", sos.length)}${Object.entries(SOS_STATUS).filter(([key]) => sosCounts[key]).map(([key, label]) => sosChip(key, label, sosCounts[key])).join("")}</div>` : "";
  const sosTable = `${sosChips}<div class="m-scroll"><table class="m-table"><thead><tr><th>Хэзээ</th><th>Ажилтан</th><th>Төрөл</th><th>Байршил</th><th>Төлөв</th><th></th></tr></thead>
      <tbody>${sos.filter((item) => !sosChosen || item.status === sosChosen).map((item) => `<tr><td>${fmtMoment(item.at)}</td><td>${esc(nameOf(item.uid))}</td><td>${esc(SOS_KINDS[item.kind])}</td><td>${item.geo ? `<a href="https://www.openstreetmap.org/?mlat=${item.geo.lat}&mlon=${item.geo.lng}#map=17/${item.geo.lat}/${item.geo.lng}" target="_blank" rel="noopener">${ico("map", "m-ico tiny")} ${item.geo.lat.toFixed(4)}, ${item.geo.lng.toFixed(4)}</a>` : "–"}</td><td>${badge(SOS_STATUS[item.status], item.status === "open" ? "bad" : item.status === "ack" ? "warn" : "ok")}${item.ackBy ? ` <small class="muted">${esc(nameOf(item.ackBy))}</small>` : ""}</td>
        <td><div class="acts">${item.status === "open" ? `<button class="chip" type="button" data-m="sos" data-id="${item.id}" data-status="ack">${ico("check")}Хүлээн авлаа</button>` : ""}${item.status === "open" || item.status === "ack" ? `<button class="chip" type="button" data-m="sos" data-id="${item.id}" data-status="resolved">${ico("shield")}Шийдвэрлэсэн</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="6" class="m-empty">${ico("sos")}<span>SOS алга</span></td></tr>`}</tbody></table></div>`;
  const musterTable = `<div class="m-scroll"><table class="m-table"><thead><tr><th>Эхэлсэн</th><th>Шалтгаан</th><th>Дууссан</th><th>Цугласан</th></tr></thead>
      <tbody>${musters.map((item) => `<tr><td>${fmtMoment(item.at)}</td><td>${esc(item.reason)}</td><td>${item.end ? fmtMoment(item.end) : badge("Явагдаж байна", "bad")}</td><td>${Object.keys(item.checked).length}/${item.expected.length}</td></tr>`).join("") || `<tr><td colspan="4" class="m-empty">${ico("people")}<span>Цуглаан алга</span></td></tr>`}</tbody></table></div>`;
  return `<div class="m-grid">${emergencyPanel()}${panel({ key: "lone", icon: "user", title: "Ганцаар ажиллагч", count: lone.length, body: loneList })}</div>
    ${panel({ key: "sos-list", icon: "sos", title: "SOS дохио", count: sos.length, body: sosTable })}
    ${panel({ key: "muster-history", icon: "people", title: "Цуглааны түүх", count: musters.length, body: musterTable })}`;
}

function peopleTab() {
  const d = m.data;
  const rules = d.skills.rules;
  const query = (m.query.staff || "").trim().toLowerCase();
  const rows = staffUsers()
    .filter((user) => !m.filter.staff || (m.filter.staff === "held") === Boolean((d.holds[user.id] || []).length))
    .map((user) => {
      const holds = d.holds[user.id] || [];
      const fatigue = d.fatigue[user.id];
      const certs = d.skills.certs.filter((item) => item.uid === user.id);
      const states = certs.map((item) => expiryState(item.expires, d.today).state);
      const exam = d.skills.medicals.filter((item) => item.uid === user.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      const search = `${user.displayName} ${user.card.idNumber} ${POSITIONS[positionOf(user.id)] || ""}`.toLowerCase();
      return `<tr data-search="${esc(search)}"${query && !search.includes(query) ? " hidden" : ""}>
        <td><b>${esc(user.displayName)}</b><small class="staff-sub">${esc(user.card.idNumber)}${positionOf(user.id) ? ` · ${esc(POSITIONS[positionOf(user.id)])}` : ""}</small></td>
        <td>${holds.length ? holds.map((text) => badge(text, "bad")).join(" ") : badge("Нэвтрэх эрхтэй", "ok")}</td>
        <td>${badge(fatigue?.label || "–", { unfit: "bad", caution: "warn", fit: "ok" }[fatigue?.state] || "")}<small class="staff-sub">${esc(fatigue?.reasons.join(", ") || "")}</small></td>
        <td>${certs.length} гэрчилгээ${states.includes("expired") ? ` ${badge(`${states.filter((s) => s === "expired").length} дууссан`, "bad")}` : ""}${states.includes("soon") ? ` ${badge(`${states.filter((s) => s === "soon").length} дуусах дөхсөн`, "warn")}` : ""}</td>
        <td>${exam ? expiryBadge(exam.next, 14) : badge("Үзлэггүй", "bad")}</td>
      </tr>`;
    })
    .join("");
  const heldCount = staffUsers().filter((user) => (d.holds[user.id] || []).length).length;
  const chosen = m.filter.staff || "";
  const chip = (value, label, count) => `<button type="button" class="m-chip${chosen === value ? " is-on" : ""}" data-m="filter" data-key="staff" data-value="${value}">${esc(label)}<i>${count}</i></button>`;
  const settings = `<form class="m-form" data-mform="settings">
        <div class="m-form-grid">
          <label class="m-field m-check"><input type="checkbox" name="enforce"${rules.enforce ? " checked" : ""} /> <span>Ирц хориглох</span></label>
          <label class="m-field m-check"><input type="checkbox" name="medical"${rules.medical ? " checked" : ""} /> <span>Эрүүл мэндийн үзлэг шалгах</span></label>
          <label class="m-field"><span>Согтуурал · хориг, цаг</span><input type="number" name="alcoholHours" min="0" max="72" value="${rules.alcoholHours}" /></label>
          <div class="m-field is-wide"><span>Заавал байх гэрчилгээ</span><div class="m-checks">${Object.entries(CERT_TYPES).map(([key, label]) => `<label><input type="checkbox" name="required" value="${key}"${rules.required.includes(key) ? " checked" : ""} /> ${esc(label)}</label>`).join("")}</div></div>
        </div>
        <div class="modal-actions"><button class="primary" type="submit">${ico("check")}Хадгалах</button></div>
      </form>`;
  const table = `<div class="m-chips">${ico("sliders")}${chip("", "Бүгд", staffUsers().length)}${chip("held", "Хоригтой", heldCount)}${chip("ok", "Нэвтрэх эрхтэй", staffUsers().length - heldCount)}</div>
      <div class="m-scroll"><table class="m-table"><thead><tr><th>Ажилтан</th><th>Нэвтрэх эрх</th><th>Ядаргаа</th><th>Гэрчилгээ</th><th>Дараагийн үзлэг</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="m-empty">${ico("people")}<span>Ажилтан алга</span></td></tr>`}</tbody></table></div>`;
  const search = `<label class="m-searchbox">${ico("search")}<input type="search" class="m-search" data-mq="staff" value="${esc(m.query.staff || "")}" placeholder="Хайх" aria-label="Ажилтан хайх" /></label>`;
  return `${panel({ key: "hold-rules", icon: "cog", title: "Картын автомат хориг", tools: badge(rules.enforce ? "Асаалттай" : "Унтраалттай", rules.enforce ? "ok" : ""), body: settings })}
    ${panel({ key: "staff", icon: "people", title: "Ажилтан бүрийн байдал", count: staffUsers().length, tools: search, body: table })}`;
}

function boardTab() {
  const d = m.data;
  const assigns = d.ops.assigns.filter((item) => item.date === d.shiftDate && item.shift === d.shift);
  const lowStock = d.ops.stock.filter((item) => item.qty <= item.min);
  return `${kpiPanel()}${fleetPanel()}
    ${collectionPanel("assigns", { key: "board-assigns", title: `Энэ ээлжийн хуваарилалт · ${fmtDate(d.shiftDate)} ${SHIFTS[d.shift]}`, filter: (item) => assigns.includes(item) })}
    ${collectionPanel("workorders", { key: "board-wo", title: "Нээлттэй засвар", filter: (item) => item.status !== "done" })}
    ${lowStock.length ? collectionPanel("stock", { key: "board-stock", title: "Дутагдаж буй бараа", filter: (item) => item.qty <= item.min }) : ""}`;
}

function roomsTab() {
  const d = m.data;
  const staff = staffUsers();
  const placed = new Set(Object.values(d.camp.beds));
  const waiting = staff.filter((user) => d.plans[user.id] && needsBed(d.plans[user.id], d.leaves, user.id, d.today) && !placed.has(user.id));
  const rooms = [...d.camp.rooms].sort((a, b) => `${a.block}${a.number}`.localeCompare(`${b.block}${b.number}`, "mn", { numeric: true }));
  const choices = (current) => options(staff.map((user) => [user.id, user.displayName]).sort((a, b) => a[1].localeCompare(b[1], "mn")), current, "— сул —");
  const blocks = [...new Set(rooms.map((room) => room.block))];
  const chosen = m.filter.rooms || "";
  const chip = (value, label, count) => `<button type="button" class="m-chip${chosen === value ? " is-on" : ""}" data-m="filter" data-key="rooms" data-value="${esc(value)}">${esc(label)}<i>${count}</i></button>`;
  const chips = blocks.length > 1 ? `<div class="m-chips">${ico("sliders")}${chip("", "Бүгд", rooms.length)}${blocks.map((block) => chip(block, `${block} байр`, rooms.filter((room) => room.block === block).length)).join("")}</div>` : "";
  const body = `${waiting.length ? `<div class="m-alert is-warn">${ico("bed")}<b>${waiting.length} хүн оргүй</b><span>${esc(waiting.map((user) => user.displayName).join(", "))}</span></div>` : ""}
      ${chips}
      <div class="m-rooms">${rooms
        .filter((room) => !chosen || room.block === chosen)
        .map((room) => {
          const used = Array.from({ length: room.beds }, (_, index) => d.camp.beds[`${room.id}:${index}`]).filter(Boolean).length;
          return `<div class="m-room"><div class="m-room-head"><b>${esc(room.number)}</b>${badge(`${used}/${room.beds}`, used === room.beds ? "info" : used ? "" : "ok")}</div><small>${esc(room.block)} байр${room.note ? ` · ${esc(room.note)}` : ""}</small>
          ${Array.from({ length: room.beds }, (_, index) => `<label class="m-bed">${ico("bed")}<select data-mchange="bed" data-room="${room.id}" data-index="${index}" aria-label="${esc(room.number)} · ${index + 1}-р ор">${choices(d.camp.beds[`${room.id}:${index}`])}</select></label>`).join("")}</div>`;
        })
        .join("")}</div>`;
  const tools = `<button class="primary" type="button" data-m="beds-auto">${ico("refresh")}<span>Автомат</span></button>`;
  return `${panel({ key: "beds", icon: "bed", title: "Орны хуваарилалт", count: placed.size, tools, body })}
    ${collectionPanel("rooms")}`;
}

function transportTab() {
  const d = m.data;
  const staff = staffUsers();
  const days = Array.from({ length: 7 }, (_, index) => addDays(d.today, index));
  const rows = days
    .map((date) => {
      const change = crewChange(staff, d.plans, d.leaves, date);
      const trips = d.camp.transport.filter((item) => item.date === date);
      const names = (list) => (list.length ? esc(list.map(nameOf).join(", ")) : `<span class="muted">–</span>`);
      return `<tr><td><b>${fmtDate(date)}</b></td><td>${badge(String(change.arrive.length), change.arrive.length ? "info" : "")} ${names(change.arrive)}</td><td>${badge(String(change.depart.length), change.depart.length ? "info" : "")} ${names(change.depart)}</td>
        <td>${trips.map((item) => `<button class="chip" type="button" data-m="manifest" data-id="${item.id}">${item.dir === "in" ? "↓" : "↑"} ${esc(item.ref || item.vehicle)} ${esc(item.depart || "")} · ${manifest(item).length}</button>`).join(" ") || `<button class="chip" type="button" data-m="new" data-name="transport" data-preset='${esc(JSON.stringify({ date }))}'>${ico("add")}Тээвэр</button>`}</td></tr>`;
    })
    .join("");
  const body = `<div class="m-scroll"><table class="m-table"><thead><tr><th>${ico("calendar", "m-ico tiny")} Огноо</th><th>↓ Ирэх</th><th>↑ Буцах</th><th>${ico("bus", "m-ico tiny")} Тээвэр</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  return `${panel({ key: "crew-change", icon: "swap", title: "Ээлж солих · 7 хоног", body })}
    ${collectionPanel("transport")}`;
}

function payrollTab() {
  const month = m.payMonth || m.data.today.slice(0, 7);
  const data = m.payroll?.month === month ? m.payroll : null;
  if (!data) loadPayroll(month);
  const rows = data?.rows || [];
  const total = (key) => Math.round(rows.reduce((sum, row) => sum + (row[key] || 0), 0) * 10) / 10;
  const tools = `<label class="m-searchbox">${ico("calendar")}<input type="month" data-mchange="paymonth" value="${month}" aria-label="Сар" /></label><label class="m-searchbox">${ico("search")}<input type="search" class="m-search" data-mq="payroll" value="${esc(m.query.payroll || "")}" placeholder="Хайх" aria-label="Хайх" /></label><button class="icon-btn" type="button" data-m="payroll-csv" title="CSV татах" aria-label="CSV татах"${rows.length ? "" : " disabled"}>${ico("download")}</button>`;
  const query = (m.query.payroll || "").trim().toLowerCase();
  const stats = data
    ? `<div class="m-kpis">
        <div class="m-kpi">${ico("people")}<b>${rows.length}</b><span>Ажилтан</span></div>
        <div class="m-kpi">${ico("clock")}<b>${num(total("hours"))}</b><span>Нийт цаг</span></div>
        <div class="m-kpi">${ico("moon")}<b>${num(total("nightHours"))}</b><span>Шөнийн цаг</span></div>
        <div class="m-kpi${total("overtime") ? " is-warn" : ""}">${ico("alert")}<b>${num(total("overtime"))}</b><span>Илүү цаг</span></div>
        <div class="m-kpi">${ico("mine")}<b>${num(total("fieldDays"))}</b><span>Хээрийн өдөр</span></div>
      </div>`
    : "";
  return panel({
    key: "payroll",
    icon: "wallet",
    title: "Цалингийн тайлан",
    count: rows.length,
    tools,
    body: `${stats}<div class="m-scroll"><table class="m-table">
      <thead><tr><th>Ажилтан</th><th>ID</th><th>Ажилласан өдөр</th><th>Өдөр / шөнө</th><th>Нийт цаг</th><th>Шөнийн цаг (22–06)</th><th>Илүү цаг (&gt;12ц)</th><th>Хээрийн өдөр</th><th>Чөлөө</th><th>Тасалсан</th><th>Хоцорсон</th></tr></thead>
      <tbody>${
        data
          ? rows.map((row) => `<tr data-search="${esc(`${row.name} ${row.idNumber} ${row.title || ""}`.toLowerCase())}"${query && !`${row.name} ${row.idNumber} ${row.title || ""}`.toLowerCase().includes(query) ? " hidden" : ""}><td><b>${esc(row.name)}</b><small class="staff-sub">${esc(row.title)}</small></td><td class="mono">${esc(row.idNumber)}</td><td>${row.workedDays}</td><td>${row.dayShifts} / ${row.nightShifts}</td><td>${row.hours}</td><td>${row.nightHours}</td><td>${row.overtime ? badge(String(row.overtime), "warn") : 0}</td><td>${row.fieldDays}</td><td>${row.leave}</td><td>${row.absent ? badge(String(row.absent), "bad") : 0}</td><td>${row.late}</td></tr>`).join("") +
            `<tr class="m-total"><td colspan="4"><b>Нийт</b></td><td><b>${total("hours")}</b></td><td><b>${total("nightHours")}</b></td><td><b>${total("overtime")}</b></td><td><b>${total("fieldDays")}</b></td><td colspan="3"></td></tr>`
          : `<tr><td colspan="11" class="m-empty">${ico("clock")}<span>Ачаалж байна…</span></td></tr>`
      }</tbody>
    </table></div>`,
  });
}

async function loadPayroll(month) {
  if (m.payLoading === month) return;
  m.payLoading = month;
  try {
    m.payroll = await ctx.api(`/api/camp/payroll?month=${encodeURIComponent(month)}`);
    paint(true);
  } catch (error) {
    ctx.toast("Цалингийн тайлан", error.message);
  } finally {
    m.payLoading = null;
  }
}

/** What the camera wall depends on; a data refresh that leaves it unchanged keeps the live feeds as they are. */
function camSig() {
  const cams = m.data?.camp?.cameras || [];
  return JSON.stringify([m.camCols, m.filter.camzone || "", cams.map((cam) => [cam.id, cam.name, cam.zone, cam.kind, cam.url, cam.every, cam.enabled, cam.note])]);
}

function camerasTab() {
  const cams = [...(m.data.camp.cameras || [])].sort((a, b) => a.name.localeCompare(b.name, "mn", { numeric: true }));
  const zone = cams.some((cam) => cam.zone === m.filter.camzone) ? m.filter.camzone : "";
  const shown = cams.filter((cam) => !zone || cam.zone === zone);
  const zones = Object.entries(CAMERA_ZONES).filter(([key]) => cams.some((cam) => cam.zone === key));
  const chip = (value, label, count) => `<button type="button" class="m-chip${zone === value ? " is-on" : ""}" data-m="filter" data-key="camzone" data-value="${esc(value)}">${esc(label)}<i>${count}</i></button>`;
  const chips = zones.length > 1 ? `<div class="m-chips" role="group" aria-label="Байршил">${ico("sliders")}${chip("", "Бүгд", cams.length)}${zones.map(([key, label]) => chip(key, label, cams.filter((cam) => cam.zone === key).length)).join("")}</div>` : "";
  const cols = [1, 2, 3, 4].map((count) => `<button type="button" class="m-chip${m.camCols === count ? " is-on" : ""}" data-m="cam-cols" data-cols="${count}" title="${count} багана" aria-label="${count} багана">${count}</button>`).join("");
  const tools = `<div class="cam-cols" role="group" aria-label="Дэлгэцийн хуваалт">${ico("layout")}${cols}</div>${addBtn("cameras")}`;
  const tiles = shown
    .map(
      (cam) => `<figure class="cam-tile" data-m="cam-open" data-id="${cam.id}">
        <div class="cam-slot" data-feed="${cam.id}"></div>
        <figcaption><i class="cam-dot" aria-hidden="true"></i><b>${esc(cam.name)}</b><small>${esc(CAMERA_ZONES[cam.zone] || "")}</small><span class="cam-kind">${esc(CAMERA_KINDS[cam.kind] || "")}</span>${ico("expand")}</figcaption>
      </figure>`,
    )
    .join("");
  const body = `${chips}${
    shown.length
      ? `<div class="cam-wall" data-cols="${m.camCols}" data-sig="${esc(camSig())}" style="--cam-cols:${m.camCols}">${tiles}</div>`
      : `<p class="m-empty cam-empty">${ico("cctv")}<span>Камер бүртгэгдээгүй. «Нэмэх» дарж кэмпийн камераа холбоно уу.</span></p>`
  }`;
  return `${panel({ key: "cam-wall", icon: "cctv", title: "Камерын хяналт", count: shown.length, tools, body, cls: "cam-panel" })}
    ${collectionPanel("cameras")}`;
}

function openCamera(id) {
  const cam = recordOf("cameras", id);
  if (!cam) return;
  const wrap = ctx.openModal({
    shield: ico("cctv"),
    title: esc(cam.name),
    sub: `${esc(CAMERA_ZONES[cam.zone] || "")} · ${esc(CAMERA_KINDS[cam.kind] || "")}${cam.note ? ` · ${esc(cam.note)}` : ""}`,
    body: `<div class="cam-big"><div class="cam-slot" data-feed="${cam.id}:big"></div></div>
      <div class="modal-actions">
        <button class="chip" type="button" data-cam-edit>${ico("cog")}Тохиргоо</button>
        <button class="chip" type="button" data-cam-full>${ico("expand")}Бүтэн дэлгэц</button>
        <button class="primary" type="button" data-cam-shot>${ico("photo")}Зураг авах</button>
      </div>`,
    className: "m-modal cam-modal",
  });
  if (!wrap) return;
  mountFeeds(wrap, m.data.camp.cameras);
  wrap.querySelector("[data-cam-full]").addEventListener("click", () => wrap.querySelector(".cam-feed")?.requestFullscreen?.().catch(() => {}));
  wrap.querySelector("[data-cam-shot]").addEventListener("click", () => {
    const data = snapshotOf(`${cam.id}:big`);
    if (!data) {
      ctx.toast("Зураг авах", "Энэ урсгал өөр серверээс ирж байгаа тул хөтөч зураг хадгалахыг хориглож байна.");
      return;
    }
    const link = document.createElement("a");
    link.href = data;
    link.download = `${cam.name}-${localInput(Date.now()).replace(/[:T]/g, "-")}.png`;
    link.click();
  });
  wrap.querySelector("[data-cam-edit]").addEventListener("click", () => {
    ctx.closeModal(true);
    setTimeout(() => openForm("cameras", recordOf("cameras", id)), 260);
  });
}

/* ---------- events ---------- */

function toggleRow(row) {
  const id = row.dataset.row;
  const open = !m.open.has(id);
  if (open) m.open.add(id);
  else m.open.delete(id);
  row.classList.toggle("is-open", open);
  row.querySelector(".m-row-toggle")?.setAttribute("aria-expanded", String(open));
  const detail = row.nextElementSibling;
  if (detail?.classList.contains("m-detail")) detail.hidden = !open;
}

function setFolded(section, folded) {
  section.classList.toggle("is-folded", folded);
  section.querySelector(".m-fold")?.setAttribute("aria-expanded", String(!folded));
  if (folded) m.fold.add(section.dataset.foldKey);
  else m.fold.delete(section.dataset.foldKey);
}

const saveFold = () => localStorage.setItem("mine-fold", JSON.stringify([...m.fold]));

async function onClick(event) {
  const button = event.target.closest("[data-m]");
  if (!button) {
    const row = event.target.closest("tr.m-row.has-detail");
    if (row && !event.target.closest("a, button, input, select, label, textarea")) toggleRow(row);
    return;
  }
  const { m: action, name, id } = button.dataset;
  if (action.startsWith("w-")) return workerClick(button);
  if (!m.data) return;
  if (action === "fold") {
    const section = button.closest("[data-fold-key]");
    setFolded(section, !section.classList.contains("is-folded"));
    saveFold();
  }
  if (action === "fold-all") {
    const sections = [...ctx.stage.querySelectorAll("[data-fold-key]")];
    const fold = sections.some((section) => !section.classList.contains("is-folded"));
    for (const section of sections) setFolded(section, fold);
    saveFold();
    button.innerHTML = ico(fold ? "unfold" : "fold");
  }
  if (action === "row") toggleRow(button.closest("tr.m-row"));
  if (action === "filter") {
    m.filter[button.dataset.key] = button.dataset.value;
    paint(true);
  }
  if (action === "tab") {
    m.tab[button.dataset.page] = button.dataset.tab;
    localStorage.setItem("mine-tabs", JSON.stringify(m.tab));
    paint(true);
  }
  if (action === "new") openForm(name, null, button.dataset.preset ? JSON.parse(button.dataset.preset) : {});
  if (action === "edit") openForm(name, recordOf(name, id));
  if (action === "delete") {
    if (!confirm("Энэ бүртгэлийг устгах уу?")) return;
    await attempt(() => send(`${apiBase()}/c/${name}/${id}`, "DELETE"));
  }
  if (action === "quick") await quickPatch(name, id, JSON.parse(button.dataset.patch));
  if (action === "csv") exportCollection(name);
  if (action === "talk-acks") openTalkAcks(id);
  if (action === "muster-open") openMuster();
  if (action === "pass") openPass(id);
  if (action === "photo") openPhoto(name || "incidents", id);
  if (action === "vio-decide") openViolationDecide(id);
  if (action === "goto") {
    ctx.state.view = button.dataset.view;
    ctx.render();
  }
  if (action === "manifest") openManifest(id);
  if (action === "cam-open") openCamera(id);
  if (action === "cam-cols") {
    m.camCols = Number(button.dataset.cols);
    localStorage.setItem("camp-cam-cols", String(m.camCols));
    paint(true);
  }
  if (action === "site") await attempt(() => send(`/api/master/visitors/${id}/site`, "POST", { on: Boolean(button.dataset.on) }));
  if (action === "sos") await attempt(() => send(`/api/master/sos/${id}`, "POST", { status: button.dataset.status }));
  if (action === "beds-auto") {
    const result = await attempt(() => send("/api/camp/beds/auto"));
    if (result) ctx.toast("Орны хуваарилалт", `${result.added} хүн шинээр байрлаж, ${result.freed} ор чөлөөлөгдлөө${result.unplaced?.length ? ` · ${result.unplaced.length} хүнд ор хүрэлцсэнгүй` : ""}.`);
  }
  if (action === "wxsim-clear") await attempt(() => send("/api/master/wx-sim", "POST", { clear: true }));
  if (action === "payroll-csv" && m.payroll) {
    const head = ["Нэр", "ID", "Албан тушаал", "Ажилласан өдөр", "Өдрийн ээлж", "Шөнийн ээлж", "Нийт цаг", "Шөнийн цаг", "Илүү цаг", "Хээрийн өдөр", "Чөлөө", "Тасалсан", "Хоцорсон"];
    downloadCsv(`payroll-${m.payroll.month}.csv`, [head, ...m.payroll.rows.map((row) => [row.name, row.idNumber, row.title, row.workedDays, row.dayShifts, row.nightShifts, row.hours, row.nightHours, row.overtime, row.fieldDays, row.leave, row.absent, row.late])]);
  }
}

async function onSubmit(event) {
  const form = event.target.closest("[data-mform]");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.mform;
  const data = Object.fromEntries(new FormData(form));
  const button = form.querySelector("button[type='submit']");
  if (button) button.disabled = true;
  try {
    if (kind.startsWith("w-")) return await workerSubmit(kind, form, data);
    if (kind === "settings") {
      await send("/api/master/settings", "POST", { enforce: form.elements.enforce.checked, medical: form.elements.medical.checked, alcoholHours: data.alcoholHours, required: [...form.querySelectorAll("[name=required]:checked")].map((input) => input.value) });
      ctx.toast("Картын хориг", "Тохиргоо хадгалагдлаа");
    }
    if (kind === "plan") await send("/api/master/settings", "POST", { planTonnes: data.planTonnes });
    if (kind === "wxsim") await send("/api/master/wx-sim", "POST", { windSpeedMs: data.windSpeedMs, feelsLikeC: data.feelsLikeC, precipNowMm: data.precipNowMm, minutes: Number(data.minutes || 15), thunder: form.elements.thunder.checked });
    if (kind === "muster-start") {
      if (!confirm("Онцгой байдлын цуглаан зарлах уу? Бүх ажилтны утсанд мэдэгдэл очиж, станц зарлана.")) return;
      await send("/api/master/muster/start", "POST", { reason: data.reason, announce: form.elements.announce.checked });
      openMuster();
    }
  } catch (error) {
    ctx.toast("Амжилтгүй", error.message);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
  if (document.activeElement && ctx.stage.contains(document.activeElement)) document.activeElement.blur();
  paint(true);
}

async function onChange(event) {
  const input = event.target.closest("[data-mchange]");
  if (!input) return;
  if (input.dataset.mchange === "bed") {
    await attempt(() => send("/api/camp/beds", "POST", { room: input.dataset.room, index: Number(input.dataset.index), uid: input.value || null }));
    input.blur();
    paint(true);
  }
  if (input.dataset.mchange === "paymonth" && /^\d{4}-\d{2}$/.test(input.value)) {
    m.payMonth = input.value;
    input.blur();
    paint(true);
  }
}

function onInput(event) {
  const input = event.target.closest("[data-mq]");
  if (!input) return;
  const query = input.value.trim().toLowerCase();
  m.query[input.dataset.mq] = query;
  for (const row of input.closest(".m-panel").querySelectorAll("tbody tr[data-search]")) {
    row.hidden = Boolean(query) && !row.dataset.search.includes(query);
    const detail = row.nextElementSibling;
    if (detail?.classList.contains("m-detail")) detail.hidden = row.hidden || !m.open.has(row.dataset.row);
  }
}

/* ---------- worker safety strip ---------- */

/** The worker's safety strip for the home page: emergencies, talks, permits, SOS, lone work and hazard reports. */
export function workerPanel(live) {
  const mine = live?.mine;
  if (!mine) return "";
  const now = Date.now();
  const parts = [];
  if (mine.muster) {
    parts.push(
      mine.muster.checked
        ? `<div class="m-alert is-muster">${ico("people")}<div><b>Цуглаан · ${esc(mine.muster.reason)}</b><span>Та цуглах цэгт бүртгэгдсэн. Зааварчилгаа хүлээнэ үү.</span></div></div>`
        : `<div class="m-alert is-sos">${ico("people")}<div><b>ОНЦГОЙ БАЙДАЛ · ${esc(mine.muster.reason)}</b><span>Цуглах цэг рүү яаралтай оч.</span></div><div class="m-acts"><button class="primary" type="button" data-m="w-muster">Цуглах цэгт ирлээ</button></div></div>`,
    );
  }
  for (const item of mine.stopWork) parts.push(`<div class="m-alert is-stop">${ico("bell")}<div><b>Ажил зогсоох · ${esc(item.name)}</b><span>${esc(item.action)}</span></div></div>`);
  for (const blast of mine.blasts) {
    const left = Date.parse(blast.at) - now;
    parts.push(`<div class="m-alert is-blast">${ico("bell")}<div><b>Тэсэлгээ ${clockOf(blast.at)} · ${esc(blast.place)}</b><span>${left > 0 ? `${untilText(left)}-ын дараа` : "Явагдаж байна"} · ${blast.radius} м аюултай бүсэд бүү ор.</span></div></div>`);
  }
  if (mine.holds.length) parts.push(`<div class="m-alert is-sos">${ico("badge")}<div><b>Таны карт ирцэд хаагдсан</b><span>${esc(mine.holds.join("; "))}. Мастер эсвэл ХАБ-ын инженерт хандана уу.</span></div></div>`);
  if (mine.fatigue && (mine.fatigue.state === "unfit" || mine.fatigue.state === "caution")) parts.push(`<div class="m-alert is-blast">${ico("bell")}<div><b>Ядаргаа: ${esc(mine.fatigue.label)}</b><span>${esc(mine.fatigue.reasons.join(", "))}</span></div></div>`);
  const sos = mine.sos
    ? `<div class="m-sos-state"><b>${ico("sos")}SOS илгээгдсэн · ${clockOf(mine.sos.at)}</b><span>${mine.sos.status === "ack" ? `${esc(mine.sos.ackBy || "Мастер")} хүлээн авлаа. Тусламж явж байна.` : "Мастерт мэдэгдэж байна…"}</span><button class="chip" type="button" data-m="w-sos-cancel">Цуцлах (андуурсан)</button></div>`
    : `<button class="m-sos-btn" type="button" data-m="w-sos">${ico("sos")}<b>SOS</b><span>Яаралтай тусламж</span></button>`;
  const talks = mine.talks
    .map((talk) => `<details class="m-wtalk"${talk.acked ? "" : " open"}><summary><b>${esc(talk.topic)}</b>${talk.acked ? badge("Танилцсан", "ok") : badge("Уншаад баталгаажуулна уу", "warn")}</summary><p>${esc(talk.content)}</p>${talk.acked ? "" : `<button class="primary" type="button" data-m="w-ack" data-id="${talk.id}">${ico("check")}Уншиж ойлгосон</button>`}</details>`)
    .join("");
  const lone = mine.lone
    ? (() => {
        const left = Date.parse(mine.lone.due) - now;
        return `<div class="m-lone is-on"><b>Ганцаар ажиллаж байна${mine.lone.place ? ` · ${esc(mine.lone.place)}` : ""}</b><span>${left > 0 ? `${untilText(left)}-ын дотор «Би зүгээр» дарна уу` : "Хугацаа хэтэрсэн! Одоо дарна уу"}</span><div class="m-acts"><button class="primary" type="button" data-m="w-lone-ok">${ico("check")}Би зүгээр</button><button class="chip" type="button" data-m="w-lone-stop">Дуусгах</button></div></div>`;
      })()
    : `<form class="m-lone" data-mform="w-lone"><b>Ганцаар ажиллах горим</b><span>Хугацаандаа хариу өгөхгүй бол мастерт автоматаар SOS очно.</span><div class="m-acts"><select name="minutes" aria-label="Шалгах давтамж">${[15, 30, 45, 60, 90].map((value) => `<option value="${value}"${value === 30 ? " selected" : ""}>${value} мин тутам</option>`).join("")}</select><input name="place" maxlength="80" placeholder="Байршил" aria-label="Байршил" /><button class="chip" type="submit">${ico("play")}Эхлүүлэх</button></div></form>`;
  const permits = mine.permits.length ? `<ul class="m-roll">${mine.permits.map((item) => `<li><b>${esc(item.type)} · ${esc(item.title)}</b><span>${badge(`${clockOf(item.to)} хүртэл`, "ok")}</span></li>`).join("")}</ul>` : "";
  return `<section class="panel m-worker">
    ${parts.length ? `<div class="m-alerts">${parts.join("")}</div>` : ""}
    <div class="m-worker-grid">
      ${sos}
      <div class="m-worker-main">
        <div class="m-worker-head"><h2>Аюулгүй ажиллагаа</h2><button class="chip" type="button" data-m="w-hazard">${ico("photo")}Аюул мэдээлэх</button></div>
        ${talks || `<p class="muted">Энэ ээлжид зааварчилгаа алга.</p>`}
        ${permits ? `<h3 class="m-sub">Миний ажлын зөвшөөрөл</h3>${permits}` : ""}
        ${lone}
      </div>
    </div>
  </section>`;
}

async function workerSend(path, body = {}) {
  try {
    ctx.state.live = await ctx.api(path, { method: "POST", body: JSON.stringify(body) });
    ctx.render();
    return true;
  } catch (error) {
    ctx.toast("Амжилтгүй", error.message);
    return false;
  }
}

function position(timeout = 4000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout, enableHighAccuracy: true },
    );
  });
}

async function workerClick(button) {
  const action = button.dataset.m;
  if (action === "w-sos") {
    if (!confirm("Яаралтай тусламжийн SOS дохио илгээх үү? Мастер болон White Queen станцад шууд мэдэгдэнэ.")) return;
    button.disabled = true;
    const geo = await position();
    if (await workerSend("/api/mine/sos", geo || {})) ctx.toast("SOS илгээгдлээ", "Байгаа газраа үлдэж, утсаа ойрхон байлгана уу.");
    button.disabled = false;
  }
  if (action === "w-sos-cancel" && confirm("SOS дохиог цуцлах уу?")) await workerSend("/api/mine/sos/cancel");
  if (action === "w-ack") await workerSend(`/api/mine/talks/${button.dataset.id}/ack`);
  if (action === "w-muster") await workerSend("/api/mine/muster/here");
  if (action === "w-lone-ok") await workerSend("/api/mine/lone/ok");
  if (action === "w-lone-stop") await workerSend("/api/mine/lone/stop");
  if (action === "w-hazard") openHazard();
}

async function workerSubmit(kind, form, data) {
  if (kind === "w-lone") await workerSend("/api/mine/lone/start", { minutes: Number(data.minutes), place: data.place });
}

function openHazard() {
  const fields = COLLECTIONS.incidents.fields.filter((field) => ["title", "severity", "place", "description", "photo", "geo"].includes(field.key));
  const values = { severity: "medium" };
  const wrap = ctx.openModal({
    shield: ico("photo"),
    title: "Аюул мэдээлэх",
    sub: "Мастер, ХАБ-ын инженерт шууд очно",
    body: `<form class="m-form" novalidate><div class="m-form-grid">${fields.map((field) => fieldHtml("incidents", { ...field, required: field.key === "title" }, values, null)).join("")}</div><p class="form-error m-form-error" role="alert" hidden></p>
      <div class="modal-actions"><button class="chip" type="button" data-close>Болих</button><button class="primary" type="submit">${ico("bell")}Илгээх</button></div></form>`,
    className: "m-modal",
  });
  if (!wrap) return;
  const form = wrap.querySelector("form");
  wireFormExtras(form);
  position(6000).then((geo) => {
    if (!geo || !form.isConnected || form.elements.geo_lat.value) return;
    form.elements.geo_lat.value = geo.lat.toFixed(6);
    form.elements.geo_lng.value = geo.lng.toFixed(6);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      ctx.state.live = await ctx.api("/api/mine/hazard", { method: "POST", body: JSON.stringify(formValues(form, fields)) });
      ctx.closeModal(true);
      ctx.toast("Баярлалаа", "Аюулын мэдээлэл мастерт илгээгдлээ.");
      setTimeout(() => ctx.render(), 260);
    } catch (error) {
      formError(form, error.message);
      button.disabled = false;
    }
  });
}
