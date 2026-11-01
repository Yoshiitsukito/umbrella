// MASTER pages (mine board, safety, competency, operations, camp) and the safety strip on a worker's home page.
// Tables and forms are drawn from the shared schema in minecore.js, so the server checks exactly what is shown.
import {
  ALCOHOL_LIMIT,
  BLAST_STATUS,
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

export const MASTER_VIEWS = ["mine", "hse", "skills", "ops", "camp"];

const TABS = {
  hse: [
    ["incidents", "Осол, аюул"],
    ["capa", "CAPA"],
    ["talks", "Зааварчилгаа"],
    ["permits", "Зөвшөөрөл"],
    ["risks", "Эрсдэл"],
    ["jsas", "JSA"],
    ["alcohol", "Согтуурал"],
    ["ppe", "ХХХ"],
    ["blasts", "Тэсэлгээ"],
    ["weather", "Цаг агаар"],
    ["emergency", "SOS, цуглаан"],
  ],
  skills: [
    ["people", "Картын хориг"],
    ["certs", "Гэрчилгээ"],
    ["medicals", "Эрүүл мэнд"],
    ["visitors", "Түр нэвтрэх"],
  ],
  ops: [
    ["board", "Самбар"],
    ["equipment", "Техник"],
    ["assigns", "Хуваарилалт"],
    ["prestarts", "Pre-start"],
    ["workorders", "Засвар"],
    ["fuel", "Түлш"],
    ["stock", "Агуулах"],
    ["moves", "Орлого, зарлага"],
    ["handovers", "Ээлж хүлээлцэх"],
    ["org", "Бүтэц"],
  ],
  camp: [
    ["rooms", "Өрөө"],
    ["transport", "Ээлжийн тээвэр"],
    ["payroll", "Цалингийн тайлан"],
    ["contractors", "Гэрээт"],
  ],
};

const PAGES = {
  mine: ["Уурхайн самбар", "Онцгой байдал, үйлдвэрлэл, техник, хүмүүсийн байдал нэг дор.", "mine"],
  hse: ["ХАБЭА · аюулгүй ажиллагаа", "Осол, зөвшөөрөл, зааварчилгаа, тэсэлгээ, цаг агаарын босго, SOS.", "helmet"],
  skills: ["Ур чадвар, эрүүл мэнд", "Гэрчилгээ, үзлэг, картын автомат хориг, түр нэвтрэх эрх.", "badge"],
  ops: ["Үйлдвэрлэл, техник", "Техник, оператор, засвар, түлш, агуулах, ээлжийн тайлан.", "truck"],
  camp: ["Кэмп, логистик", "Өрөө, ээлжийн тээвэр, цалингийн тайлан, гэрээт гүйцэтгэгч.", "camp"],
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
  refresh: `<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>`,
  print: `<path d="M7 9V4h10v5M7 17H4.5v-7h15v7H17"/><rect x="7" y="14" width="10" height="6"/>`,
};

let ctx = null;
const m = {
  data: null,
  timer: 0,
  loading: false,
  tab: readTabs(),
  query: {},
  seenSos: new Set(),
  payroll: null,
  payMonth: null,
};

function readTabs() {
  try {
    return JSON.parse(localStorage.getItem("mine-tabs") || "{}");
  } catch {
    return {};
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
}

export function masterStop() {
  clearInterval(m.timer);
  m.timer = 0;
}

export function masterReset() {
  masterStop();
  Object.assign(m, { data: null, payroll: null, payMonth: null, query: {} });
  m.seenSos.clear();
}

async function refresh() {
  if (m.loading || !ctx.state.me) return;
  m.loading = true;
  try {
    setData(await ctx.api("/api/master"));
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
  if (!MASTER_VIEWS.includes(ctx.state.view)) return;
  if (!force && busy()) return;
  const scroll = ctx.stage.querySelector(".m-tabs")?.scrollLeft || 0;
  ctx.stage.classList.add("is-quiet");
  ctx.stage.innerHTML = masterView(ctx.state.view);
  const tabs = ctx.stage.querySelector(".m-tabs");
  if (tabs) tabs.scrollLeft = scroll;
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
  for (const sos of m.data.hse.sos || []) {
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
  return `<div class="admin-page m-page">${hero(view)}${alertStrip()}${body}</div>`;
}

function hero(view) {
  const [title, sub, icon] = PAGES[view];
  const stat = (value, label, tone = "") => `<div class="${tone ? `is-${tone}` : ""}"><b>${value}</b><span>${label}</span></div>`;
  return `
    <section class="panel admin-hero m-hero">
      <div class="admin-shield">${ico(icon)}</div>
      <div class="profile-who"><b>${esc(title)}</b><span>${esc(sub)} ${m.data.today ? `· ${fmtDate(m.data.today)} · ${SHIFTS[m.data.shift]} ээлж` : ""}</span></div>
      <div class="admin-stats">${heroStats(view).map(([value, label, tone]) => stat(value, label, tone)).join("")}</div>
    </section>`;
}

function heroStats(view) {
  const d = m.data;
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
    return [[openIncidents, "Нээлттэй осол, аюул", openIncidents ? "neg" : ""], [overdue, "Хэтэрсэн CAPA", overdue ? "neg" : ""], [activePermits, "Идэвхтэй зөвшөөрөл"], [audience ? `${acked}/${audience}` : "–", "Зааварчилгаа танилцсан"]];
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
  const beds = d.camp.rooms.reduce((sum, item) => sum + item.beds, 0);
  const used = Object.keys(d.camp.beds).length;
  const change = crewChange(staffUsers(), d.plans, d.leaves, d.today);
  return [[`${used}/${beds}`, "Ор эзэлсэн"], [change.arrive.length, "Өнөөдөр ирэх"], [change.depart.length, "Өнөөдөр буцах"], [d.camp.contractors.filter((item) => item.status === "active").length, "Идэвхтэй гэрээт"]];
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

function tabbed(view) {
  const tabs = TABS[view];
  const current = tabs.some(([key]) => key === m.tab[view]) ? m.tab[view] : tabs[0][0];
  return `
    <nav class="m-tabs" role="tablist">${tabs.map(([key, label]) => `<button type="button" role="tab" class="m-tab${key === current ? " is-on" : ""}" aria-selected="${key === current}" data-m="tab" data-page="${view}" data-tab="${key}">${esc(label)}</button>`).join("")}</nav>
    ${tabBody(view, current)}`;
}

function tabBody(view, tab) {
  const special = {
    weather: weatherTab,
    emergency: emergencyTab,
    people: peopleTab,
    board: boardTab,
    org: () => ["depts", "crews", "posts"].map((name) => collectionPanel(name)).join(""),
    rooms: roomsTab,
    transport: transportTab,
    payroll: payrollTab,
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
};

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
  if (!schema.immutable) buttons.push(button("edit", "edit", "Засах"));
  if (!schema.immutable) buttons.push(`<button class="icon-btn danger" type="button" data-m="delete" data-name="${name}" data-id="${item.id}" title="Устгах" aria-label="Устгах">${ico("trash")}</button>`);
  return `<div class="acts">${buttons.join("")}</div>`;
}

function collectionPanel(name, { title, filter, note = "" } = {}) {
  const schema = COLLECTIONS[name];
  const columns = schema.fields.filter((field) => field.list);
  const extras = EXTRA_COLS[name] || [];
  const query = (m.query[name] || "").toLowerCase();
  const list = records(name).filter(filter || (() => true)).sort(sortKey(name));
  const rows = list
    .map((item) => {
      const text = searchText(name, item);
      return `<tr data-search="${esc(text)}"${query && !text.includes(query) ? " hidden" : ""}>${columns.map((field) => `<td>${cellOf(name, field, item)}</td>`).join("")}${extras.map(([, render]) => `<td>${render(item)}</td>`).join("")}<td>${rowActions(name, item)}</td></tr>`;
    })
    .join("");
  return `
    <section class="panel m-panel">
      <div class="m-panel-head">
        <h2>${esc(title || schema.label)} <small>${list.length}</small></h2>
        <div class="m-tools">
          <input type="search" class="m-search" data-mq="${name}" value="${esc(m.query[name] || "")}" placeholder="Хайх" aria-label="${esc(schema.label)} хайх" />
          <button class="icon-btn" type="button" data-m="csv" data-name="${name}" title="CSV татах" aria-label="CSV татах">${ico("download")}</button>
          <button class="primary" type="button" data-m="new" data-name="${name}">${ico("add")}Нэмэх</button>
        </div>
      </div>
      ${note}
      <div class="m-scroll"><table class="user-table m-table">
        <thead><tr>${columns.map((field) => `<th>${esc(field.label)}</th>`).join("")}${extras.map(([label]) => `<th>${esc(label)}</th>`).join("")}<th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${columns.length + extras.length + 1}" class="muted">Бүртгэл алга</td></tr>`}</tbody>
      </table></div>
    </section>`;
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

function exportCollection(name) {
  const fields = COLLECTIONS[name].fields;
  const rows = [fields.map((field) => field.label), ...records(name).sort(sortKey(name)).map((item) => fields.map((field) => csvCell(name, field, item)))];
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
          <img class="m-photo-img" alt=""${has ? ` src="/api/master/photo/${item.id}"` : " hidden"} />
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
  const body = `<form class="m-form" novalidate>
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
      await send(item ? `/api/master/c/${name}/${item.id}` : `/api/master/c/${name}`, item ? "PUT" : "POST", data);
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
  await attempt(() => send(`/api/master/c/${name}/${id}`, "PUT", body));
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

const SCAN_BOX = `<div class="m-scan" hidden><video playsinline muted></video><p class="m-scan-msg" role="status">ID карт эсвэл түр нэвтрэх QR-ийг камерт харуулна уу.</p></div>`;

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
    <ul class="m-roll">${rows || `<li class="muted">Энэ ээлжид төлөвлөгдсөн ажилтан алга</li>`}</ul></div>`;
}

function openTalkAcks(id) {
  const talk = recordOf("talks", id);
  if (!talk) return;
  const wrap = ctx.openModal({ shield: ico("people"), title: esc(talk.topic), sub: `${fmtDate(talk.date)} · ${SHIFTS[talk.shift]} ээлж · «Уншиж ойлгосон» бүртгэл`, body: talkAckBody(id), className: "m-modal" });
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
      <ul class="m-roll">${missing.map((key) => `<li><b>${esc(label(key))}</b><span><button class="chip" type="button" data-here="${esc(key)}">${ico("check")}Ирсэн</button></span></li>`).join("") || `<li class="muted">Бүгд цугласан</li>`}</ul>
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
  const wrap = ctx.openModal({ shield: ico("people"), title: `Цуглаан · ${esc(muster.reason)}`, sub: `${clockOf(muster.at)}-с эхэлсэн · ирцээр талбай дээр байгаа хүмүүсээр тоолно`, body: musterBody(), className: "m-modal" });
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
    sub: "Цуглаанд энэ QR-ээр бүртгэгдэнэ",
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

function openPhoto(id) {
  const item = recordOf("incidents", id);
  ctx.openModal({ shield: ico("photo"), title: esc(item?.title || "Зураг"), sub: item ? fmtMoment(item.at) : "", body: `<img class="m-photo-full" src="/api/master/photo/${esc(id)}" alt="" />`, className: "m-modal" });
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
  const card = (value, label, note = "", tone = "") => `<div class="m-kpi${tone ? ` is-${tone}` : ""}"><b>${value}</b><span>${label}</span>${note ? `<small>${note}</small>` : ""}</div>`;
  return `<section class="panel m-panel">
    <div class="m-panel-head"><h2>Гүйцэтгэлийн үзүүлэлт <small>7 хоног</small></h2>
      <form class="m-inline" data-mform="plan"><label>Өдрийн төлөвлөгөө <input type="number" name="planTonnes" min="0" step="100" value="${m.data.ops.planTonnes}" /> т</label><button class="chip" type="submit">Хадгалах</button></form></div>
    <div class="m-kpis">
      ${card(`${num(kpi.prodTotal)} т`, "Олборлолт", `Төлөвлөгөө ${num(kpi.prodPlan)} т · ${kpi.prodPlan ? Math.round((kpi.prodTotal / kpi.prodPlan) * 100) : 0}%`, kpi.prodTotal >= kpi.prodPlan ? "ok" : "warn")}
      ${card(pct(kpi.availability), "Техникийн бэлэн байдал", "Эвдрэл, засварын зогсолтыг хассан")}
      ${card(pct(kpi.utilization), "Ашиглалт", "Хуваарилсан ээлж / бэлэн цаг")}
      ${card(kpi.ltifr, "LTIFR", `${kpi.lti} LTI · ${kpi.windowDays} хоног · ${num(kpi.hoursWorked)} хүн-цаг`, kpi.lti ? "bad" : "ok")}
      ${card(kpi.trifr, "TRIFR", `${kpi.recordable} бүртгэгдэх гэмтэл`, kpi.recordable ? "warn" : "ok")}
    </div>
    ${productionChart(kpi)}
  </section>`;
}

function fleetPanel() {
  const machines = [...m.data.ops.equipment].sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  return `<section class="panel m-panel">
    <div class="m-panel-head"><h2>Техникийн байдал <small>${SHIFTS[m.data.shift]} ээлж</small></h2></div>
    <div class="m-fleet">${machines
      .map((item) => {
        const assign = records("assigns").find((row) => row.equipment === item.id && row.date === m.data.shiftDate && row.shift === m.data.shift);
        const service = serviceDue(item);
        return `<button type="button" class="m-machine is-${item.status}" data-m="edit" data-name="equipment" data-id="${item.id}">
          <b>${esc(item.code)}</b><span>${esc(EQUIP_TYPES[item.type])}</span>
          <small>${assign ? esc(nameOf(assign.operator)) : esc(EQUIP_STATUS[item.status])}</small>
          ${service.due ? `<i class="m-dot" title="Засварын хугацаа болсон"></i>` : ""}
        </button>`;
      })
      .join("")}</div>
  </section>`;
}

function peopleSummary() {
  const d = m.data;
  const unfit = Object.entries(d.fatigue).filter(([, item]) => item.state === "unfit" || item.state === "caution");
  const held = Object.entries(d.holds).filter(([, list]) => list.length);
  return `<section class="panel m-panel">
    <div class="m-panel-head"><h2>Хүмүүс</h2></div>
    <h3 class="m-sub">Картын хориг</h3>
    <ul class="m-roll">${held.map(([uid, list]) => `<li><b>${esc(nameOf(uid))}</b><span>${list.map((text) => badge(text, "bad")).join(" ")}</span></li>`).join("") || `<li class="muted">Хоригтой ажилтан алга</li>`}</ul>
    <h3 class="m-sub">Ядаргаа (нойр, ажилласан цаг)</h3>
    <ul class="m-roll">${unfit.map(([uid, item]) => `<li><b>${esc(nameOf(uid))}</b><span>${badge(item.label, item.state === "unfit" ? "bad" : "warn")} <small class="muted">${esc(item.reasons.join(", "))}</small></span></li>`).join("") || `<li class="muted">Бүгд тэнцсэн эсвэл мэдээлэлгүй</li>`}</ul>
  </section>`;
}

function todaySafety() {
  const d = m.data;
  const now = Date.parse(d.now);
  const talks = d.hse.talks.filter((item) => item.date === d.shiftDate);
  const permits = d.hse.permits.filter((item) => ["active", "expired"].includes(permitState(item, now)));
  const blasts = d.hse.blasts.filter((item) => item.status === "planned").sort((a, b) => a.at.localeCompare(b.at));
  return `<section class="panel m-panel">
    <div class="m-panel-head"><h2>Өнөөдрийн аюулгүй ажиллагаа</h2></div>
    <h3 class="m-sub">Ээлжийн өмнөх зааварчилгаа</h3>
    <ul class="m-roll">${talks.map((item) => {
      const audience = d.audience[item.id] || [];
      const acked = item.acks.filter((ack) => audience.includes(ack.uid)).length;
      return `<li><b>${SHIFTS[item.shift]} · ${esc(item.topic)}</b><span>${badge(`${acked}/${audience.length}`, acked === audience.length ? "ok" : "warn")} <button class="chip" type="button" data-m="talk-acks" data-id="${item.id}">Бүртгэх</button></span></li>`;
    }).join("") || `<li class="muted">Өнөөдөр зааварчилгаа оруулаагүй · <button class="chip" type="button" data-m="new" data-name="talks">Нэмэх</button></li>`}</ul>
    <h3 class="m-sub">Ажлын зөвшөөрөл</h3>
    <ul class="m-roll">${permits.map((item) => {
      const state = permitState(item, now);
      return `<li><b>${esc(PERMIT_TYPES[item.type])} · ${esc(item.title)}</b><span>${badge(state === "expired" ? `${clockOf(item.to)}-д дууссан` : `${clockOf(item.to)} хүртэл`, state === "expired" ? "bad" : "ok")} <small class="muted">${esc(nameOf(item.holder))}</small></span></li>`;
    }).join("") || `<li class="muted">Идэвхтэй зөвшөөрөл алга</li>`}</ul>
    <h3 class="m-sub">Тэсэлгээ</h3>
    <ul class="m-roll">${blasts.map((item) => `<li><b>${fmtMoment(item.at)} · ${esc(item.place)}</b><span>${badge(`${item.radius} м`, "warn")} <small class="muted">${esc(nameOf(item.blaster))}</small></span></li>`).join("") || `<li class="muted">Төлөвлөсөн тэсэлгээ алга</li>`}</ul>
  </section>`;
}

function weatherCard() {
  const weather = m.data.weather;
  const rules = m.data.hse.wxRules.filter((item) => item.enabled);
  const cells = Object.entries(WX_METRICS).map(([key, spec]) => {
    const value = wxValue(weather, key);
    return `<div><b>${value == null ? "–" : spec.op === "flag" ? (value ? "Тийм" : "Үгүй") : `${Math.round(value * 10) / 10}`}</b><span>${esc(spec.label)}${spec.unit && spec.op !== "flag" ? `, ${esc(spec.unit)}` : ""}</span></div>`;
  });
  return `<section class="panel m-panel">
    <div class="m-panel-head"><h2>Цаг агаар <small>${weather ? `${weather.simulated ? "туршилтын утга · " : ""}${esc(weather.condition || "")}` : "мэдээлэлгүй"}</small></h2></div>
    <div class="m-wx">${cells.join("")}</div>
    <p class="muted m-note">${rules.length} босго хянагдаж байна. Босго давахад White Queen станц ажил зогсоохыг зарлаж, талбай дээрх ажилчдын утсанд мэдэгдэл очно.</p>
  </section>`;
}

function emergencyPanel() {
  const muster = m.data.hse.musters.find((item) => !item.end);
  return `<section class="panel m-panel m-emergency">
    <div class="m-panel-head"><h2>Онцгой байдал</h2></div>
    ${
      muster
        ? `<p>Цуглаан явагдаж байна: <b>${esc(muster.reason)}</b></p><button class="primary" type="button" data-m="muster-open">${ico("people")}Цуглааны жагсаалт</button>`
        : `<form class="m-form m-muster-form" data-mform="muster-start">
            <label class="m-field is-wide"><span>Шалтгаан</span><input name="reason" maxlength="120" placeholder="Жишээ: Гал гарсан, хийн алдагдал, сургуулилт" /></label>
            <label class="m-field m-check"><input type="checkbox" name="announce" checked /> <span>White Queen станцаар зарлах</span></label>
            <button class="primary danger" type="submit">${ico("bell")}Цуглаан зарлах</button>
          </form>
          <p class="muted m-note">Ирцээр талбай дээр байгаа бүх ажилтан болон талбайд нэвтэрсэн зочдыг жагсааж, цуглах цэгт QR-ээр тоолно.</p>`
    }
  </section>`;
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
  return `<div class="m-grid">
    ${weatherCard()}
    <section class="panel m-panel">
      <div class="m-panel-head"><h2>Туршилт · цаг агаар дуурайх</h2></div>
      <form class="m-form" data-mform="wxsim">
        <div class="m-form-grid">
          <label class="m-field"><span>Салхи, м/с</span><input type="number" name="windSpeedMs" min="0" max="60" step="0.1" value="${esc(sim?.windSpeedMs ?? "")}" placeholder="бодит" /></label>
          <label class="m-field"><span>Мэдрэгдэх темп., °C</span><input type="number" name="feelsLikeC" min="-70" max="60" step="0.1" value="${esc(sim?.feelsLikeC ?? "")}" placeholder="бодит" /></label>
          <label class="m-field"><span>Хур тунадас, мм</span><input type="number" name="precipNowMm" min="0" max="50" step="0.1" value="${esc(sim?.precipNowMm ?? "")}" placeholder="бодит" /></label>
          <label class="m-field"><span>Хугацаа, минут</span><input type="number" name="minutes" min="1" max="120" value="15" /></label>
          <label class="m-field m-check"><input type="checkbox" name="thunder"${sim?.code ? " checked" : ""} /> <span>Аянга, аадар</span></label>
        </div>
        <div class="modal-actions">${sim ? `<button class="chip" type="button" data-m="wxsim-clear">Туршилтыг зогсоох · ${clockOf(sim.until)} хүртэл</button>` : ""}<button class="primary" type="submit">${ico("play")}Туршилт эхлүүлэх</button></div>
      </form>
      <p class="muted m-note">Танилцуулгын зорилгоор бодит утгын оронд түр утга тавьж, ажил зогсоох дохиог шалгана. Хугацаа дуусахад автоматаар бодит цаг агаарт шилжинэ.</p>
    </section>
  </div>
  ${collectionPanel("wxRules")}
  <section class="panel m-panel">
    <div class="m-panel-head"><h2>Ажил зогсоосон түүх <small>${events.length}</small></h2></div>
    <div class="m-scroll"><table class="user-table m-table"><thead><tr><th>Босго</th><th>Эхэлсэн</th><th>Дууссан</th><th>Утга</th><th>Арга хэмжээ</th></tr></thead>
    <tbody>${events.map((item) => `<tr><td>${esc(item.name)}${item.simulated ? ` ${badge("туршилт", "info")}` : ""}</td><td>${fmtMoment(item.start)}</td><td>${item.end ? fmtMoment(item.end) : badge("Үргэлжилж байна", "bad")}</td><td>${item.value == null ? "–" : Math.round(item.value * 10) / 10}</td><td>${esc(item.action)}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">Түүх алга</td></tr>`}</tbody></table></div>
  </section>`;
}

function emergencyTab() {
  const d = m.data;
  const now = Date.parse(d.now);
  const sos = [...d.hse.sos].reverse().slice(0, 40);
  const lone = d.hse.lone.filter((item) => item.active);
  const musters = [...d.hse.musters].reverse().slice(0, 10);
  return `<div class="m-grid">${emergencyPanel()}
    <section class="panel m-panel">
      <div class="m-panel-head"><h2>Ганцаар ажиллагч <small>${lone.length}</small></h2></div>
      <ul class="m-roll">${lone.map((item) => {
        const due = Date.parse(item.lastCheck) + item.interval * 60000;
        return `<li><b>${esc(nameOf(item.uid))}${item.place ? ` · ${esc(item.place)}` : ""}</b><span>${due < now ? badge(`${untilText(now - due)} хоцорсон`, "bad") : badge(`${untilText(due - now)}-д хариу өгнө`, "ok")} <small class="muted">${item.interval} мин тутам</small></span></li>`;
      }).join("") || `<li class="muted">Идэвхтэй ганцаар ажиллагч алга</li>`}</ul>
      <p class="muted m-note">Ажилтан апп дээр «Ганцаар ажиллаж байна» горим асаана. Хугацаандаа «Би зүгээр» дарахгүй бол автоматаар SOS үүсч, станц зарлана.</p>
    </section></div>
    <section class="panel m-panel">
      <div class="m-panel-head"><h2>SOS дохио <small>${sos.length}</small></h2></div>
      <div class="m-scroll"><table class="user-table m-table"><thead><tr><th>Хэзээ</th><th>Ажилтан</th><th>Төрөл</th><th>Байршил</th><th>Төлөв</th><th></th></tr></thead>
      <tbody>${sos.map((item) => `<tr><td>${fmtMoment(item.at)}</td><td>${esc(nameOf(item.uid))}</td><td>${esc(SOS_KINDS[item.kind])}</td><td>${item.geo ? `<a href="https://www.openstreetmap.org/?mlat=${item.geo.lat}&mlon=${item.geo.lng}#map=17/${item.geo.lat}/${item.geo.lng}" target="_blank" rel="noopener">${item.geo.lat.toFixed(4)}, ${item.geo.lng.toFixed(4)}</a>` : "–"}</td><td>${badge(SOS_STATUS[item.status], item.status === "open" ? "bad" : item.status === "ack" ? "warn" : "ok")}${item.ackBy ? ` <small class="muted">${esc(nameOf(item.ackBy))}</small>` : ""}</td>
        <td><div class="acts">${item.status === "open" ? `<button class="chip" type="button" data-m="sos" data-id="${item.id}" data-status="ack">Хүлээн авлаа</button>` : ""}${item.status === "open" || item.status === "ack" ? `<button class="chip" type="button" data-m="sos" data-id="${item.id}" data-status="resolved">Шийдвэрлэсэн</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="6" class="muted">SOS дохио ирээгүй</td></tr>`}</tbody></table></div>
    </section>
    <section class="panel m-panel">
      <div class="m-panel-head"><h2>Цуглааны түүх</h2></div>
      <div class="m-scroll"><table class="user-table m-table"><thead><tr><th>Эхэлсэн</th><th>Шалтгаан</th><th>Дууссан</th><th>Цугласан</th></tr></thead>
      <tbody>${musters.map((item) => `<tr><td>${fmtMoment(item.at)}</td><td>${esc(item.reason)}</td><td>${item.end ? fmtMoment(item.end) : badge("Явагдаж байна", "bad")}</td><td>${Object.keys(item.checked).length}/${item.expected.length}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Цуглаан зарлагдаагүй</td></tr>`}</tbody></table></div>
    </section>`;
}

function peopleTab() {
  const d = m.data;
  const rules = d.skills.rules;
  const rows = staffUsers()
    .map((user) => {
      const holds = d.holds[user.id] || [];
      const fatigue = d.fatigue[user.id];
      const certs = d.skills.certs.filter((item) => item.uid === user.id);
      const states = certs.map((item) => expiryState(item.expires, d.today).state);
      const exam = d.skills.medicals.filter((item) => item.uid === user.id).sort((a, b) => b.date.localeCompare(a.date))[0];
      return `<tr>
        <td><b>${esc(user.displayName)}</b><small class="staff-sub">${esc(user.card.idNumber)}${positionOf(user.id) ? ` · ${esc(POSITIONS[positionOf(user.id)])}` : ""}</small></td>
        <td>${holds.length ? holds.map((text) => badge(text, "bad")).join(" ") : badge("Нэвтрэх эрхтэй", "ok")}</td>
        <td>${badge(fatigue?.label || "–", { unfit: "bad", caution: "warn", fit: "ok" }[fatigue?.state] || "")}<small class="staff-sub">${esc(fatigue?.reasons.join(", ") || "")}</small></td>
        <td>${certs.length} гэрчилгээ${states.includes("expired") ? ` ${badge(`${states.filter((s) => s === "expired").length} дууссан`, "bad")}` : ""}${states.includes("soon") ? ` ${badge(`${states.filter((s) => s === "soon").length} дуусах дөхсөн`, "warn")}` : ""}</td>
        <td>${exam ? expiryBadge(exam.next, 14) : badge("Үзлэггүй", "bad")}</td>
      </tr>`;
    })
    .join("");
  return `<section class="panel m-panel">
      <div class="m-panel-head"><h2>Картын автомат хориг</h2></div>
      <form class="m-form" data-mform="settings">
        <div class="m-form-grid">
          <label class="m-field m-check"><input type="checkbox" name="enforce"${rules.enforce ? " checked" : ""} /> <span>Шаардлага хангаагүй бол White Queen-д ирц бүртгүүлэхийг хориглох</span></label>
          <label class="m-field m-check"><input type="checkbox" name="medical"${rules.medical ? " checked" : ""} /> <span>Эрүүл мэндийн үзлэгийн хугацааг шалгах</span></label>
          <label class="m-field"><span>Согтуурал эерэг гарвал хаах (цаг)</span><input type="number" name="alcoholHours" min="0" max="72" value="${rules.alcoholHours}" /></label>
          <div class="m-field is-wide"><span>Заавал байх гэрчилгээ</span><div class="m-checks">${Object.entries(CERT_TYPES).map(([key, label]) => `<label><input type="checkbox" name="required" value="${key}"${rules.required.includes(key) ? " checked" : ""} /> ${esc(label)}</label>`).join("")}</div></div>
        </div>
        <div class="modal-actions"><button class="primary" type="submit">${ico("check")}Хадгалах</button></div>
      </form>
      <p class="muted m-note">Амралтын үеийн түдгэлзүүлэлттэй адил: хугацаа дууссан гэрчилгээ, үзлэг, эерэг шалгалттай ажилтны карт ирц бүртгэхэд татгалзагдана (гарах бүртгэлийг хаахгүй). Шалтгааныг станц болон ажилтны апп-д харуулна.</p>
    </section>
    <section class="panel m-panel">
      <div class="m-panel-head"><h2>Ажилтан бүрийн байдал <small>${staffUsers().length}</small></h2></div>
      <div class="m-scroll"><table class="user-table m-table"><thead><tr><th>Ажилтан</th><th>Нэвтрэх эрх</th><th>Ядаргаа</th><th>Гэрчилгээ</th><th>Дараагийн үзлэг</th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="muted">Ажилтан алга</td></tr>`}</tbody></table></div>
    </section>`;
}

function boardTab() {
  const d = m.data;
  const assigns = d.ops.assigns.filter((item) => item.date === d.shiftDate && item.shift === d.shift);
  const lowStock = d.ops.stock.filter((item) => item.qty <= item.min);
  return `${kpiPanel()}${fleetPanel()}
    ${collectionPanel("assigns", { title: `Энэ ээлжийн хуваарилалт · ${fmtDate(d.shiftDate)} ${SHIFTS[d.shift]}`, filter: (item) => assigns.includes(item) })}
    ${collectionPanel("workorders", { title: "Нээлттэй засвар", filter: (item) => item.status !== "done" })}
    ${lowStock.length ? collectionPanel("stock", { title: "Доод үлдэгдлээс бага бараа", filter: (item) => item.qty <= item.min }) : ""}`;
}

function roomsTab() {
  const d = m.data;
  const staff = staffUsers();
  const placed = new Set(Object.values(d.camp.beds));
  const waiting = staff.filter((user) => d.plans[user.id] && needsBed(d.plans[user.id], d.leaves, user.id, d.today) && !placed.has(user.id));
  const rooms = [...d.camp.rooms].sort((a, b) => `${a.block}${a.number}`.localeCompare(`${b.block}${b.number}`, "mn", { numeric: true }));
  const choices = (current) => options(staff.map((user) => [user.id, user.displayName]).sort((a, b) => a[1].localeCompare(b[1], "mn")), current, "— сул —");
  return `<section class="panel m-panel">
      <div class="m-panel-head"><h2>Орны хуваарилалт <small>${placed.size} хүн байрласан</small></h2>
        <div class="m-tools"><button class="primary" type="button" data-m="beds-auto">${ico("refresh")}Ротацаар автоматаар хуваарилах</button></div></div>
      ${waiting.length ? `<p class="m-note">${badge(`${waiting.length} хүн оргүй`, "warn")} ${esc(waiting.map((user) => user.displayName).join(", "))}</p>` : ""}
      <div class="m-rooms">${rooms
        .map(
          (room) => `<div class="m-room"><b>${esc(room.number)}</b><small>${esc(room.block)} байр${room.note ? ` · ${esc(room.note)}` : ""}</small>
          ${Array.from({ length: room.beds }, (_, index) => `<label class="m-bed">${ico("bed")}<select data-mchange="bed" data-room="${room.id}" data-index="${index}" aria-label="${esc(room.number)} · ${index + 1}-р ор">${choices(d.camp.beds[`${room.id}:${index}`])}</select></label>`).join("")}</div>`,
        )
        .join("")}</div>
      <p class="muted m-note">Автомат хуваарилалт ажилтны 14/14, 7/7 ротацыг харж өнөөдөр болон маргааш ажиллах хүмүүст ор олгож, амралтад гарсан хүмүүсийн орыг чөлөөлнө.</p>
    </section>
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
  return `<section class="panel m-panel">
      <div class="m-panel-head"><h2>Ээлж солих хуваарь <small>7 хоног · ротацаас</small></h2></div>
      <div class="m-scroll"><table class="user-table m-table"><thead><tr><th>Огноо</th><th>Ирэх</th><th>Буцах</th><th>Тээвэр</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="muted m-note">Автобусны зорчигчийн жагсаалт ротацаар автоматаар бүрдэнэ; нислэг, нэмэлт зорчигчийг тээврийн бүртгэлд гараар нэмнэ.</p>
    </section>
    ${collectionPanel("transport")}`;
}

function payrollTab() {
  const month = m.payMonth || m.data.today.slice(0, 7);
  const data = m.payroll?.month === month ? m.payroll : null;
  if (!data) loadPayroll(month);
  const rows = data?.rows || [];
  const total = (key) => Math.round(rows.reduce((sum, row) => sum + (row[key] || 0), 0) * 10) / 10;
  return `<section class="panel m-panel">
    <div class="m-panel-head"><h2>Цалингийн тайлан <small>ирцийн бүртгэлээс</small></h2>
      <div class="m-tools"><input type="month" data-mchange="paymonth" value="${month}" aria-label="Сар" /><button class="icon-btn" type="button" data-m="payroll-csv" title="CSV татах" aria-label="CSV татах"${rows.length ? "" : " disabled"}>${ico("download")}</button></div></div>
    <div class="m-scroll"><table class="user-table m-table">
      <thead><tr><th>Ажилтан</th><th>ID</th><th>Ажилласан өдөр</th><th>Өдөр / шөнө</th><th>Нийт цаг</th><th>Шөнийн цаг (22–06)</th><th>Илүү цаг (&gt;12ц)</th><th>Хээрийн өдөр</th><th>Чөлөө</th><th>Тасалсан</th><th>Хоцорсон</th></tr></thead>
      <tbody>${
        data
          ? rows.map((row) => `<tr><td><b>${esc(row.name)}</b><small class="staff-sub">${esc(row.title)}</small></td><td class="mono">${esc(row.idNumber)}</td><td>${row.workedDays}</td><td>${row.dayShifts} / ${row.nightShifts}</td><td>${row.hours}</td><td>${row.nightHours}</td><td>${row.overtime ? badge(String(row.overtime), "warn") : 0}</td><td>${row.fieldDays}</td><td>${row.leave}</td><td>${row.absent ? badge(String(row.absent), "bad") : 0}</td><td>${row.late}</td></tr>`).join("") +
            `<tr class="m-total"><td colspan="4"><b>Нийт</b></td><td><b>${total("hours")}</b></td><td><b>${total("nightHours")}</b></td><td><b>${total("overtime")}</b></td><td><b>${total("fieldDays")}</b></td><td colspan="3"></td></tr>`
          : `<tr><td colspan="11" class="muted">Ачаалж байна…</td></tr>`
      }</tbody>
    </table></div>
    <p class="muted m-note">Нийт цаг, шөнийн цаг, илүү цаг, хээрийн нэмэгдлийн өдрийг White Queen-ий ирцээс тооцно. CSV-г цалингийн програм руу шууд оруулж болно.</p>
  </section>`;
}

async function loadPayroll(month) {
  if (m.payLoading === month) return;
  m.payLoading = month;
  try {
    m.payroll = await ctx.api(`/api/master/payroll?month=${encodeURIComponent(month)}`);
    paint(true);
  } catch (error) {
    ctx.toast("Цалингийн тайлан", error.message);
  } finally {
    m.payLoading = null;
  }
}

/* ---------- events ---------- */

async function onClick(event) {
  const button = event.target.closest("[data-m]");
  if (!button) return;
  const { m: action, name, id } = button.dataset;
  if (action.startsWith("w-")) return workerClick(button);
  if (!m.data) return;
  if (action === "tab") {
    m.tab[button.dataset.page] = button.dataset.tab;
    localStorage.setItem("mine-tabs", JSON.stringify(m.tab));
    paint(true);
  }
  if (action === "new") openForm(name, null, button.dataset.preset ? JSON.parse(button.dataset.preset) : {});
  if (action === "edit") openForm(name, recordOf(name, id));
  if (action === "delete") {
    if (!confirm("Энэ бүртгэлийг устгах уу?")) return;
    await attempt(() => send(`/api/master/c/${name}/${id}`, "DELETE"));
  }
  if (action === "quick") await quickPatch(name, id, JSON.parse(button.dataset.patch));
  if (action === "csv") exportCollection(name);
  if (action === "talk-acks") openTalkAcks(id);
  if (action === "muster-open") openMuster();
  if (action === "pass") openPass(id);
  if (action === "photo") openPhoto(id);
  if (action === "manifest") openManifest(id);
  if (action === "site") await attempt(() => send(`/api/master/visitors/${id}/site`, "POST", { on: Boolean(button.dataset.on) }));
  if (action === "sos") await attempt(() => send(`/api/master/sos/${id}`, "POST", { status: button.dataset.status }));
  if (action === "beds-auto") {
    const result = await attempt(() => send("/api/master/camp/auto"));
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
    await attempt(() => send("/api/master/camp/bed", "POST", { room: input.dataset.room, index: Number(input.dataset.index), uid: input.value || null }));
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
  for (const row of input.closest(".m-panel").querySelectorAll("tbody tr[data-search]")) row.hidden = Boolean(query) && !row.dataset.search.includes(query);
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
