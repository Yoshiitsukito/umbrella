import { LAYERS, legendFor } from "./map2d.js";
import { createPlaceMap } from "./terrain3d.js";
import { createCore } from "./rkcore.js";
import { analyzeFrame } from "./vision.js";
import { CARD_TEXTS, idCard } from "./idcard.js";
import { exportCard } from "./cardexport.js";
import { cancelListening, isListening, listen, primeAudio, speak, stopListening, stopSpeaking } from "./voice.js";
import {
  addDays,
  CYCLE_WORK_DAYS,
  cycleRange,
  dayRecord,
  isWorkedDay,
  LEAVE_LABEL,
  leaveOn,
  nextShift,
  onTimeStreak,
  periodRange,
  periodSummary,
  isRotation,
  patternOf,
  PLAN_LABEL,
  ROTATION_LABEL,
  ROTATIONS,
  plannedKind,
  planOf,
  rotationFrom,
  rotationPhase,
  sessionsOf,
  SHIFT_CLOCK,
  shiftDateOf,
  shiftSpan,
  WEEK_ORDER,
  WEEKDAY_SHORT,
  weekdayOf,
} from "./workstats.js";
import {
  BP_HIGH,
  BREAK_EVERY_MS,
  BREATHING,
  MOODS,
  TRENDS,
  bpStats,
  breakIndex,
  briefingText,
  departureAdvice,
  moodLinks,
  shiftAdvice,
  sleepDebt,
  STEP_GOAL,
  parseHeartRate,
  pulseZone,
  spansAround,
  trendSeries,
  watchAdvice,
  workload,
} from "./wellstats.js";
import { MENU_CATEGORIES, MENU_CATEGORY_LABEL, MENU_MEALS, MENU_MEAL_LABEL } from "./menulabels.js";

// Google Map Tiles API is not enabled on the project yet; set to true once it is.
const TRAFFIC_ENABLED = false;

const stage = document.querySelector("#stage");
const nav = document.querySelector("#nav");
const state = {
  view: "home",
  live: null,
  camera: null,
  scanning: false,
  scanTimer: 0,
  mapMode: localStorage.getItem("holo-map-mode") === "terrain" ? "terrain" : "flat",
  placeMap: null,
  placeResults: [],
  terrainLayer: ["none", ...LAYERS.map((item) => item.id)].includes(localStorage.getItem("holo-terrain-layer"))
    ? localStorage.getItem("holo-terrain-layer")
    : "wind",
  precipMode: ["auto", "off"].includes(localStorage.getItem("holo-precip-mode"))
    ? localStorage.getItem("holo-precip-mode")
    : "auto",
  traffic: TRAFFIC_ENABLED && localStorage.getItem("holo-traffic") === "1",
  rk: { status: "", mode: null },
  me: null,
  admin: null,
  editUser: null,
  cardLevel: 5,
  attTimer: 0,
  flipped: new Set(),
  located: false,
  wk: null,
  wkTimer: 0,
  wkAdmin: null,
  wkAdminTimer: 0,
  wkFocus: null,
  wkTab: ["live", "plan", "config", "log"].includes(localStorage.getItem("wq-admin-tab")) ? localStorage.getItem("wq-admin-tab") : "live",
  wkOpen: new Set(["general"]),
  wkDirty: false,
  wkPainted: {},
  wkLogKind: "all",
  mePeriod: "week",
  meTimer: 0,
  trendMetric: "sleep",
  pulse: null,
  trendPeriod: "week",
  breathKey: "calm",
  breathMin: 1,
  breath: null,
  briefing: false,
};

const ROLE_LABEL = { admin: "Админ", hr: "Хүний нөөц", kitchen: "Гал тогоо", user: "Хэрэглэгч", whiteking: "White Queen" };
const ROLES = ["user", "hr", "kitchen", "admin", "whiteking"];
const STAFF_ROLES = ["user", "hr", "kitchen"];
const ADMIN_VIEWS = ["users", "account", "card", "whiteking"];
const HR_VIEWS = ["staff", "today"];
const KITCHEN_VIEWS = ["menu"];

function isAdmin() {
  return state.me?.role === "admin";
}

function isHr() {
  return state.me?.role === "hr";
}

function isKitchen() {
  return state.me?.role === "kitchen";
}

function isStation() {
  return state.me?.role === "whiteking";
}

function homeFor() {
  if (isStation()) return "station";
  return isAdmin() ? "users" : "home";
}

/** Views each role may open; everyone also has their profile, and HR and the kitchen keep every staff page on top of their own. */
function viewAllowed(view) {
  if (view === "profile") return true;
  if (isAdmin()) return ADMIN_VIEWS.includes(view);
  if (isHr() && HR_VIEWS.includes(view)) return true;
  if (isKitchen() && KITCHEN_VIEWS.includes(view)) return true;
  return ![...ADMIN_VIEWS, ...HR_VIEWS, ...KITCHEN_VIEWS, "station"].includes(view);
}

/** Staff who work shifts: regular users, HR and the kitchen alike. */
function worksShifts(user) {
  return STAFF_ROLES.includes(user.role);
}

/** The management data (users and attendance) behind the admin and HR pages. */
function managesData() {
  return ADMIN_VIEWS.includes(state.view) || HR_VIEWS.includes(state.view);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/api/auth/") && state.me) showLogin("Нэвтрэлтийн хугацаа дууссан. Дахин нэвтэрнэ үү.");
  if (!res.ok) throw new Error(data.error || "Хүсэлт амжилтгүй");
  return data;
}

function initials(user) {
  const name = String(user?.displayName || user?.username || "?").trim();
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function avatar(user, cls = "nav-avatar") {
  return `<span class="${cls}">${user?.photo ? `<img src="${esc(user.photo)}" alt="" />` : esc(initials(user))}</span>`;
}

function renderChrome() {
  const live = state.live;
  tickDigitalClock();
  const place = document.querySelector("#place");
  place.textContent = live?.location?.label || "Байршил";
  place.hidden = isAdmin() || isStation();
  shell.classList.toggle("is-station", isStation());
  const precip = live?.weather?.precip;
  const line = document.querySelector("#alert-line");
  line.textContent = precip?.status === "clear" ? "" : precip?.text || "";
  const providers = live?.providers;
  const note = document.querySelector("#provider-note");
  note.dataset.tip = providers
    ? `Цаг агаар: ${providers.weather}. Газрын зураг: ${providers.weatherMap ? "OpenWeatherMap" : "түлхүүргүй"}. Зам: ${providers.maps}. Нислэг: ${providers.flights ? "Amadeus" : "түлхүүргүй"}. Red King: ${(providers.ai || []).find((item) => item.id === "gemini" && item.configured)?.label || "дотоод"}.`
    : "";
  note.hidden = !providers;
  const role = ROLES.includes(state.me?.role) ? state.me.role : "user";
  for (const button of nav.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.view === (state.view === "account" ? "users" : state.view));
    if (button.dataset.role) button.hidden = !button.dataset.role.split(" ").includes(role);
  }
  const profileButton = nav.querySelector("[data-view='profile']");
  if (profileButton && state.me) {
    const tip = `${state.me.displayName} · ${ROLE_LABEL[state.me.role]}`;
    document.querySelector("#nav-avatar").outerHTML = avatar(state.me).replace('class="nav-avatar"', 'class="nav-avatar" id="nav-avatar"');
    profileButton.classList.toggle("is-admin", state.me.role === "admin");
    profileButton.dataset.tip = tip;
    profileButton.setAttribute("aria-label", `Профайл: ${tip}`);
  }
  maybeNotify(precip);
}

function maybeNotify(precip) {
  if (!precip || precip.status !== "approaching") return;
  const key = `${precip.text}`;
  if (sessionStorage.getItem("holo-precip") === key) return;
  sessionStorage.setItem("holo-precip", key);
  if (Notification.permission === "granted") {
    new Notification("UMBRELLA · хур тунадас", { body: precip.text });
  }
}

function bandLabel(band) {
  if (band === "low") return "бага эрч хүч";
  if (band === "high") return "өндөр эрч хүч";
  if (band === "steady") return "жигд эрч хүч";
  return "тодорхойгүй";
}

const ICONS = {
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>`,
  moon: `<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>`,
  partly: `<path d="M8 2.8v1.4M3.3 4.8l1 1M2 9.5h1.4M12.7 4.8l-1 1"/><path d="M5.3 11a3.5 3.5 0 0 1 6.3-2.8"/><path d="M9 20h8.5a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.4 1.6A2.7 2.7 0 0 0 9 20z"/>`,
  cloud: `<path d="M7 18.5h10.5a4.5 4.5 0 0 0 .5-9A6.5 6.5 0 0 0 5.8 11.1 3.8 3.8 0 0 0 7 18.5z"/>`,
  fog: `<path d="M7 12.5h10.5a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 6 3.3 3.3 0 0 0 7 12.5z"/><path d="M4 16h16M6 19.5h12"/>`,
  rain: `<path d="M7 14h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 7.6 3.2 3.2 0 0 0 7 14z"/><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>`,
  snow: `<path d="M7 14h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 7.6 3.2 3.2 0 0 0 7 14z"/><path d="M8 17.5v.01M12 17v.01M16 17.5v.01M10 20.5v.01M14 20.5v.01" stroke-width="2.6"/>`,
  storm: `<path d="M7 14h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 7.6 3.2 3.2 0 0 0 7 14z"/><path d="M12.5 14.5l-2.5 4h3.5l-2 3.5"/>`,
  thermo: `<path d="M14 14.6V5a2 2 0 0 0-4 0v9.6a4 4 0 1 0 4 0z"/><path d="M12 9.5v7"/>`,
  wind: `<path d="M3 8.5h10.5a3 3 0 1 0-3-3"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M3 16.5h7"/>`,
  arrow: `<path d="M12 3l5 16-5-3.5L7 19z"/>`,
  umbrella: `<path d="M3 12a9 9 0 0 1 18 0z"/><path d="M12 12v6.5a2 2 0 0 1-4 0"/><path d="M12 3v-.5"/>`,
  drop: `<path d="M12 3.2s6 6.4 6 10.8a6 6 0 0 1-12 0c0-4.4 6-10.8 6-10.8z"/><path d="M9.2 14.5a3 3 0 0 0 2.6 2.8"/>`,
  heart: `<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/><path d="M7.5 12.5h2.3l1.4-2.4 2 4.4 1.3-2h2"/>`,
  bolt: `<path d="M13 2.5L5 13.5h6l-1 8 8-11h-6z"/>`,
  badge: `<rect x="4" y="3.5" width="16" height="17" rx="2.5"/><circle cx="12" cy="10" r="2.6"/><path d="M8 16.5a4.3 4.3 0 0 1 8 0"/>`,
  air: `<path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 13h15a2.5 2.5 0 1 1-2.5 2.5"/><circle cx="19" cy="7.5" r=".6"/><circle cx="6" cy="17.5" r=".6"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`,
  bell: `<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>`,
  sunrise: `<path d="M5 17.5a7 7 0 0 1 14 0"/><path d="M2.5 20.5h19M12 3.5v4M9.5 6L12 3.5 14.5 6M4.2 10.7l1.4 1M19.8 10.7l-1.4 1"/>`,
  work: `<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2M3.5 12.5h17"/>`,
  rest: `<path d="M5 9.5h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H15.5M8 3.5v2.5M11 3.5v2.5"/>`,
  chevron: `<path d="M9 5l7 7-7 7"/>`,
  sunset: `<path d="M5 17.5a7 7 0 0 1 14 0"/><path d="M2.5 20.5h19M12 7.5v-4M9.5 5L12 7.5 14.5 5M4.2 10.7l1.4 1M19.8 10.7l-1.4 1"/>`,
  warn: `<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 9.5v4.5M12 16.8v.2"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  cross: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  trash: `<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.5 10.5v5.5M13.5 10.5v5.5"/>`,
  play: `<path d="M8 5.5v13l10-6.5z"/>`,
  stop: `<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  meal: `<path d="M6 3v7a2 2 0 0 0 4 0V3M8 10v11M16 21V3c-2.2 0-3.5 2.5-3.5 6.5S14 13 16 13"/>`,
  mask: `<path d="M4 9.5c2.5 0 4-1.5 8-1.5s5.5 1.5 8 1.5v3.5c0 3-3.5 5.5-8 5.5s-8-2.5-8-5.5z"/><path d="M4 10.5H2.5M20 10.5h1.5M8 12h8M8.5 15h7"/>`,
  megaphone: `<path d="M4 10v4h3l7 4.5v-13L7 10z"/><path d="M17.5 9a4 4 0 0 1 0 6M7.5 14l1.2 5h2.5l-1-4.4"/>`,
  gift: `<rect x="3.5" y="9" width="17" height="4" rx="1"/><path d="M5 13v7.5h14V13M12 9v11.5M12 9C10.5 5.5 6.5 5.5 7 8c.3 1 2.5 1 5 1zM12 9c1.5-3.5 5.5-3.5 5 -1-.3 1-2.5 1-5 1z"/>`,
  lungs: `<path d="M12 3.5v8M12 9.5l-2.5 2M12 9.5l2.5 2"/><path d="M8.5 7C6 7 3.5 11 3.5 16c0 2.5 1 3.5 2.5 3.5 2 0 3.5-1 3.5-3V9c0-1-.4-2-1-2zM15.5 7c2.5 0 5 4 5 9 0 2.5-1 3.5-2.5 3.5-2 0-3.5-1-3.5-3V9c0-1 .4-2 1-2z"/>`,
  scale: `<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M8 9a5 5 0 0 1 8 0l-3 2.5"/>`,
  steps: `<path d="M8 3.5c1.7 0 2.5 2 2.5 4.5S9.7 12 8 12s-2.5-1.5-2.5-4S6.3 3.5 8 3.5zM6 14.5h4v2a2 2 0 0 1-4 0zM16 8c1.7 0 2.5 2 2.5 4.5s-.8 4-2.5 4-2.5-1.5-2.5-4S14.3 8 16 8zM14 19h4v.5a2 2 0 0 1-4 0z"/>`,
  smile: `<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5v.5M15 9.5v.5"/>`,
  gauge: `<path d="M3.5 16.5a8.5 8.5 0 1 1 17 0"/><path d="M12 16.5l4-5"/><circle cx="12" cy="16.5" r="1.3"/><path d="M6 11.5l1 .7M12 7v1.2M18 11.5l-1 .7"/>`,
  watch: `<rect x="6.5" y="6" width="11" height="12" rx="2.8"/><path d="M8.8 6l.7-3h5l.7 3M8.8 18l.7 3h5l.7-3M12 9.5V12l1.8 1.2"/>`,
  chart: `<path d="M3.5 20.5h17M5 4v16.5"/><path d="M7.5 15l3.5-4.5 3 2.5 5-6.5"/>`,
};

function icon(name, cls = "ico") {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

function skyIcon(code, isDay, hour) {
  const night = isDay === undefined ? hour < 8 || hour >= 18 : !isDay;
  if (code === 0) return night ? "moon" : "sun";
  if (code === 1 || code === 2) return night ? "moon" : "partly";
  if (code === 45 || code === 48) return "fog";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51 && code <= 82) return "rain";
  return "cloud";
}

const WEEKDAYS = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

const SEGMENTS = {
  a: [[8, 6], [52, 6]],
  b: [[54, 8], [54, 48]],
  c: [[54, 52], [54, 92]],
  d: [[8, 94], [52, 94]],
  e: [[6, 52], [6, 92]],
  f: [[6, 8], [6, 48]],
  g: [[8, 50], [52, 50]],
};
const DIGIT_SEGMENTS = ["abcdef", "bc", "abged", "abgcd", "fgbc", "afgcd", "afgedc", "abc", "abcdefg", "abcdfg"];

function segment([[x1, y1], [x2, y2]], x0, lit) {
  const h = 4;
  const points =
    y1 === y2
      ? [[x1, y1], [x1 + h, y1 - h], [x2 - h, y1 - h], [x2, y1], [x2 - h, y1 + h], [x1 + h, y1 + h]]
      : [[x1, y1], [x1 + h, y1 + h], [x1 + h, y2 - h], [x1, y2], [x1 - h, y2 - h], [x1 - h, y1 + h]];
  return `<polygon class="${lit ? "on" : "off"}" points="${points.map(([x, y]) => `${x + x0},${y}`).join(" ")}"/>`;
}

function segText(text) {
  let x = 0;
  let body = "";
  for (const char of text) {
    if (/\d/.test(char)) {
      const lit = DIGIT_SEGMENTS[Number(char)];
      body += Object.entries(SEGMENTS).map(([name, line]) => segment(line, x, lit.includes(name))).join("");
      x += 72;
    } else if (char === ":") {
      body += `<rect class="on" x="${x + 4}" y="27" width="10" height="10" transform="rotate(45 ${x + 9} 32)"/><rect class="on" x="${x + 4}" y="63" width="10" height="10" transform="rotate(45 ${x + 9} 68)"/>`;
      x += 30;
    } else if (char === "/") {
      body += `<polygon class="on" points="${x + 14},58 ${x + 20},58 ${x + 8},96 ${x + 2},96"/>`;
      x += 30;
    }
  }
  return `<svg class="seg" viewBox="-2 0 ${x} 100" aria-hidden="true"><g transform="skewX(-7) translate(10 0)">${body}</g></svg>`;
}

function clockParts(now = new Date()) {
  const two = (value) => String(value).padStart(2, "0");
  return {
    time: `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`,
    date: `${two(now.getMonth() + 1)}/${two(now.getDate())}/${two(now.getFullYear() % 100)}`,
  };
}

function tickDigitalClock() {
  const timeNode = document.querySelector("#seg-time");
  if (!timeNode) return;
  const { time, date } = clockParts();
  if (timeNode.dataset.value === time) return;
  timeNode.dataset.value = time;
  timeNode.innerHTML = segText(time);
  const dateNode = document.querySelector("#seg-date");
  if (dateNode.dataset.value !== date) {
    dateNode.dataset.value = date;
    dateNode.innerHTML = segText(date);
  }
  timeNode.parentElement.setAttribute("aria-label", `${time}, ${date}`);
}

function greeting(hour) {
  if (hour >= 5 && hour < 12) return "Өглөөний мэнд";
  if (hour >= 12 && hour < 18) return "Өдрийн мэнд";
  if (hour >= 18 && hour < 23) return "Оройн мэнд";
  return "Шөнийн мэнд";
}

function ring(pct) {
  const value = Math.max(0, Math.min(100, Math.round(pct)));
  return `<div class="ring" style="--pct:${value}"><span>${value}%</span></div>`;
}

const NOTICE_ICON = { card: "warn", "leave-ok": "check", "leave-no": "cross", plan: "calendar" };
const LATE_GRACE_MS = 5 * 60 * 1000;

function agoLabel(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return "дөнгөж сая";
  if (minutes < 60) return `${minutes} мин өмнө`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} цагийн өмнө`;
  return `${shortDate(localDate(iso))} ${clockLabel(iso)}`;
}

/** Where the person stands against their real shifts right now. */
function shiftNow(live, now = Date.now()) {
  const ctx = wellCtx(live);
  const spans = spansAround({ ...ctx, before: 1, after: 16 });
  const current = spans.find((span) => span.start <= now && now < span.end);
  const next = spans.find((span) => span.start > now);
  const arrived = Boolean(current && sessionsOf(live.events || [], ctx.uid, now).some((item) => item.end > current.start - 2 * 3600000));
  return { ctx, current, next, inside: live.presence?.state === "in", arrived };
}

function countdownOf(info, now = Date.now()) {
  const { current, next, inside, arrived } = info;
  if (current && (arrived || inside)) {
    return { cls: inside ? "is-on" : "is-away", label: "Ээлж дуусахад", value: liveDuration(current.end - now), tail: inside ? "үлдлээ" : "үлдлээ · та гадуур байна" };
  }
  if (current && now - current.start > LATE_GRACE_MS) {
    return { cls: "is-late", label: `Ээлж ${clockLabel(current.start)}-д эхэлсэн`, value: liveDuration(now - current.start), tail: "хоцорч байна · ирцээ бүртгүүлнэ үү" };
  }
  if (current) return { cls: "is-soon", label: "Ээлж эхэллээ", value: liveDuration(current.start + LATE_GRACE_MS - now), tail: "дотор ирцээ бүртгүүлбэл цагтаа" };
  if (next) {
    const wait = next.start - now;
    const days = Math.floor(wait / 86400000);
    const value = days >= 2 ? `${days} хоног ${liveDuration(wait % 86400000)}` : liveDuration(wait);
    return { cls: wait < 3600000 ? "is-soon" : "is-next", label: "Ээлж эхлэхэд", value, tail: days >= 2 ? `үлдлээ · ${shortDate(next.date)} ${PLAN_LABEL[next.kind] || ""}`.trim() : "үлдлээ" };
  }
  return { cls: "is-off", label: "Ойрын 2 долоо хоногт ээлж алга", value: "", tail: "" };
}

function countdownHtml(count) {
  return `<small>${esc(count.label)}</small><b>${esc(count.value)}</b>${count.tail ? `<span>${esc(count.tail)}</span>` : ""}`;
}

function tickCountdown() {
  const node = stage.querySelector("[data-count]");
  if (!node || !state.live?.wellness) return;
  const count = countdownOf(shiftNow(state.live));
  node.className = `shift-count ${count.cls}`;
  node.innerHTML = countdownHtml(count);
}

/** Today's schedule line from the person's own plan and leave. */
function todayPlan(info) {
  const { ctx, current } = info;
  if (current && current.date !== ctx.today) return { icon: "moon", cls: "is-night", title: `${PLAN_LABEL.night} ${PLAN_HOURS.night}`, note: "Өчигдөр эхэлсэн ээлж" };
  const leave = leaveOn(ctx.leaves, ctx.uid, ctx.today);
  if (leave) return { icon: "rest", cls: "is-leave", title: `Чөлөөтэй · ${LEAVE_LABEL[leave.type]}`, note: "Ээлжгүй" };
  const kind = plannedKind(ctx.week, ctx.today);
  const phase = isRotation(ctx.week) && ctx.today >= rotationFrom(ctx.week) ? rotationPhase(ctx.week, ctx.today) : null;
  const step = phase ? `Эргэлт · ${PLAN_LABEL[kind]} ${phase.index}/${phase.length}` : "";
  if (kind === "off") return { icon: "rest", cls: "is-off", title: "Өнөөдөр амралт", note: step || "Хуваарийн дагуу" };
  return { icon: kind === "night" ? "moon" : "sun", cls: `is-${kind}`, title: `${PLAN_LABEL[kind]} ${PLAN_HOURS[kind]}`, note: step || "Өнөөдрийн ээлж" };
}

function weekLine(live) {
  const ctx = meContext(live);
  const sum = periodSummary({ ...ctx, ...cycleRange(ctx.week, ctx.today) });
  const streak = onTimeStreak(ctx);
  return [
    `Эргэлтэд <b>${sum.workedDays}</b> / ${sum.targetDays} өдөр`,
    `${sum.late} хоцролт`,
    streak ? `${streak} ээлж дараалан цагтаа` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function shiftCard(info, live) {
  const plan = todayPlan(info);
  const count = countdownOf(info);
  return `
    <section class="panel shift-card ${plan.cls}">
      <div class="shift-plan">
        <span class="shift-ico">${icon(plan.icon)}</span>
        <div><small>${esc(plan.note)}</small><b>${esc(plan.title)}</b></div>
      </div>
      <div class="shift-count ${count.cls}" data-count aria-live="off">${countdownHtml(count)}</div>
      <button class="shift-week" type="button" data-action="goto" data-target="attendance">
        ${icon("calendar", "ico tiny")}<span>Энэ 7 хоног: ${weekLine(live)}</span>${icon("chevron", "ico tiny")}
      </button>
    </section>`;
}

function todayNotices(live) {
  const items = [];
  const air = live.health?.air;
  const big = air?.aqi > 150
    ? `<div class="big-alert" role="alert">${icon("mask")}<div><b>Агаарын бохирдол өндөр · AQI ${air.aqi}</b><p>Маск зүү, цонхоо хаа. Гадаа удаан бүү бай, агаар цэвэршүүлэгчээ асаа.</p></div></div>`
    : "";
  for (const notice of [...(live.notices || [])].reverse()) {
    items.push(`<li class="notice is-${esc(notice.kind)}">
      <span class="notice-ico">${icon(NOTICE_ICON[notice.kind] || "bell")}</span>
      <div><b>${esc(notice.text)}</b><small>${agoLabel(notice.at)}</small></div>
      <button class="icon-btn" type="button" data-action="notice-seen" data-id="${esc(notice.id)}" aria-label="Хаах" title="Хаах">${icon("cross")}</button>
    </li>`);
  }
  for (const item of (live.announcements || []).filter((entry) => !entry.read)) {
    items.push(`<li class="notice is-announce">
      <span class="notice-ico">${icon("megaphone")}</span>
      <div><b>${esc(item.text)}</b><small>Зарлал · ${esc(item.by || "Админ")} · ${agoLabel(item.at)}</small></div>
      <button class="chip" type="button" data-action="announce-read" data-id="${esc(item.id)}">${icon("check", "ico tiny")}Уншсан</button>
    </li>`);
  }
  for (const person of live.birthdays || []) {
    const mine = person.id === state.me?.id;
    const when = person.inDays === 0 ? "Өнөөдөр" : person.inDays === 1 ? "Маргааш" : `${shortDate(person.date)} ${WEEKDAY_SHORT[weekdayOf(person.date)]}`;
    const text = mine
      ? person.inDays === 0
        ? `Төрсөн өдрийн баярын мэнд хүргэе, ${person.name}!`
        : `${when} таны төрсөн өдөр`
      : person.inDays === 0
        ? `Өнөөдөр ${person.name} төрсөн өдрөө тэмдэглэж байна`
        : `${when} ${person.name} төрсөн өдөртэй`;
    items.push(`<li class="notice is-birthday${person.inDays === 0 ? " is-today" : ""}">
      <span class="notice-ico">${icon("gift")}</span>
      <div><b>${esc(text)}</b><small>${person.inDays === 0 ? (mine ? "Сайхан өдөр болоорой" : "Мэндчилгээ дэвшүүлээрэй") : "Төрсөн өдөр"}</small></div>
    </li>`);
  }
  if (!big && !items.length) return "";
  const many = (live.notices || []).length > 1;
  return `
    <section class="notice-bar">
      ${big}
      ${items.length ? `<ul class="notices">${items.map((item, index) => item.replace("<li ", `<li style="--i:${index}" `)).join("")}</ul>` : ""}
      ${many ? `<button class="ghost notice-all" type="button" data-action="notice-seen">Бүх мэдэгдлийг хаах</button>` : ""}
    </section>`;
}

function todoPanel(live) {
  const nowClock = clockLabel(Date.now());
  const items = [...(live.reminders || [])].sort(
    (a, b) => Number(a.done) - Number(b.done) || (a.due || "99").localeCompare(b.due || "99") || a.at.localeCompare(b.at),
  );
  const open = items.filter((item) => !item.done).length;
  const list = items
    .map((item, index) => {
      const overdue = !item.done && item.due && item.due <= nowClock;
      return `<li class="todo${item.done ? " is-done" : ""}${overdue ? " is-overdue" : ""} row-in" style="--i:${index}">
        <button class="todo-check" type="button" data-action="todo-toggle" data-id="${esc(item.id)}" aria-pressed="${item.done}" aria-label="${item.done ? "Дуусаагүй болгох" : "Дууссан гэж тэмдэглэх"}">${icon("check")}</button>
        <span>${esc(item.title)}</span>
        ${item.due ? `<time>${esc(item.due)}</time>` : ""}
        <button class="icon-btn" type="button" data-action="todo-delete" data-id="${esc(item.id)}" aria-label="Устгах" title="Устгах">${icon("trash")}</button>
      </li>`;
    })
    .join("");
  return `
    <section class="panel todo-panel">
      <h2>${icon("bell", "ico h-ico")}Хувийн сануулга <small>${open ? `${open} хийх` : items.length ? "бүгд дууссан" : ""}</small></h2>
      <form class="todo-form" data-form="todo" autocomplete="off">
        <input name="title" maxlength="80" placeholder="Шинэ сануулга, хийх ажил…" aria-label="Сануулга" required />
        <input name="due" type="time" aria-label="Цаг, заавал биш" title="Цаг, заавал биш" />
        <button class="primary" type="submit" aria-label="Нэмэх">${icon("plus", "ico tiny")}Нэмэх</button>
      </form>
      ${list ? `<ul class="todos">${list}</ul>` : `<div class="empty">${icon("bell", "ico empty-ico")}<p>Сануулга алга. Цаг заавал биш; заасан цаг болоход мэдэгдэл ирнэ.</p></div>`}
    </section>`;
}

function prepPanel(info, live) {
  const weather = live.weather;
  const air = live.health?.air;
  const span = info.current || (info.next && info.next.start - Date.now() < 20 * 3600000 ? info.next : null);
  const leave = departureAdvice(weather?.hourly, span?.end);
  const sun = live.sun;
  const nightish = plannedOn(info.ctx, info.ctx.today) === "night" || plannedOn(info.ctx, addDays(info.ctx.today, -1)) === "night";
  const dayLength = sun?.rise && sun?.set ? Math.round((sun.set - sun.rise) / 60000) : 0;
  const depart = leave
    ? `<div class="depart">
        ${icon(skyIcon(leave.code, leave.isDay, Number(clockLabel(leave.at).slice(0, 2))), "ico depart-ico")}
        <div><small>Ээлж дуусах ${clockLabel(leave.at)}-ийн цаг агаар</small><b>${leave.tempC}° · салхи ${leave.windSpeedMs.toFixed(0)} м/с${leave.precipProb >= 30 ? ` · хур ${leave.precipProb}%` : ""}</b><p>${esc(leave.advice)}</p></div>
      </div>`
    : `<p class="muted">${span ? "Ээлж дуусах цагийн урьдчилсан мэдээ хараахан гараагүй байна." : "Өнөөдөр ээлжгүй тул гарах цагийн зөвлөгөө алга."}</p>`;
  const sunLine = sun?.rise
    ? `<div class="sun-row">
        <div>${icon("sunrise")}<small>Нар мандах</small><b>${clockLabel(sun.rise)}</b></div>
        <div>${icon("sunset")}<small>Нар жаргах</small><b>${clockLabel(sun.set)}</b></div>
        <div>${icon("sun")}<small>Өдрийн урт</small><b>${minutesLabel(dayLength)}</b></div>
      </div>
      <p class="muted">${
        nightish
          ? `Шөнийн ээлжийн дараа ${clockLabel(sun.rise)}-с хойш гэрэлтэй байх тул гэр рүүгээ нарны шил зүүж харь, унтлагын өрөөгөө харанхуй байлга.`
          : `Өдрийн ээлжийн өмнө эсвэл үдээр 10–20 минут гадаа нар үзвэл шөнө амархан унтна.`
      }</p>`
    : "";
  return `
    <section class="panel prep-panel">
      <h2>${icon("sunrise", "ico h-ico")}Гарах бэлтгэл</h2>
      ${depart}
      ${sunLine}
      ${air ? `<p class="tone-${TONE[air.band] || "good"}">${icon("air", "ico tiny")} Агаар: <b>${esc(air.label)}</b> · AQI ${air.aqi}</p>` : ""}
    </section>`;
}

function briefingFor(info, live) {
  const { ctx, current } = info;
  const today = spansAround({ ...ctx, before: 0, after: 0 })[0];
  return briefingText({
    name: state.me?.displayName,
    now: Date.now(),
    shift: current || today,
    leave: leaveOn(ctx.leaves, ctx.uid, ctx.today),
    weather: live.weather,
    air: live.health?.air,
    reminders: live.reminders,
    announcements: live.announcements,
    birthdays: live.birthdays,
    debt: sleepDebt(ctx),
  });
}

function briefButton() {
  return `<button class="chip rk-play${state.briefing ? " is-playing" : ""}" type="button" data-action="brief-play" aria-pressed="${state.briefing}">${icon(state.briefing ? "stop" : "play", "ico tiny")}${state.briefing ? "Зогсоох" : "Тоглуулах"}</button>`;
}

function setBriefing(on) {
  state.briefing = on;
  const node = stage.querySelector("[data-action='brief-play']");
  if (node) node.outerHTML = briefButton();
}

function playBriefing() {
  if (state.briefing) {
    stopSpeaking();
    setBriefing(false);
    return;
  }
  const text = briefingFor(shiftNow(state.live), state.live);
  primeAudio();
  setBriefing(true);
  speak(text, {
    serverTts: voiceSupport().tts.length > 0,
    onEnd: () => setBriefing(false),
    onError: () => setBriefing(false),
  });
}

function homeView() {
  const live = state.live;
  if (!live?.wellness) return `<section class="panel"><p class="muted">Ачаалж байна…</p></section>`;
  const info = shiftNow(live);
  const weather = live.weather;
  const briefing = live.briefing;
  const checked = live.presence?.state === "in";
  const menu = live.menu;
  const health = live.health;
  const energy = live.energy;
  const air = health?.air;
  const now = new Date();
  const hour = now.getHours();
  const name = state.me?.displayName || live.profile?.displayName;
  const dateLine = `${WEEKDAYS[now.getDay()]} гараг`;
  const precip = weather?.precip;
  const precipTone = precip?.status === "ongoing" || precip?.status === "approaching" ? "warn" : "";
  const hours = (weather?.hourly || []).slice(0, 8);

  const stats = weather
    ? `
      <div class="stat">${icon("thermo")}<span class="stat-label">Мэдрэмж</span><b>${Math.round(weather.feelsLikeC)}°</b></div>
      <div class="stat">${icon("wind")}<span class="stat-label">Салхи</span><b>${weather.windSpeedMs.toFixed(1)} <small>м/с</small></b></div>
      <div class="stat"><svg class="ico wind-arrow" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${(weather.windDirDeg + 180) % 360}deg)">${ICONS.arrow}</svg><span class="stat-label">Чиглэл</span><b>${esc(weather.windFrom)}</b></div>
      <div class="stat ${precipTone}">${icon("umbrella")}<span class="stat-label">20 минут</span><b>${precip?.status === "clear" ? "Хуурай" : precip?.kind === "snow" ? "Цас" : "Бороо"}</b></div>`
    : "";

  const hourly = hours.length
    ? `<div class="hourly" role="list">${hours
        .map((item, index) => {
          const h = Number(item.label.slice(0, 2));
          return `<div class="hour${index === 0 ? " now" : ""}" role="listitem">
            <span class="hour-time">${index === 0 ? "Одоо" : esc(item.label)}</span>
            ${icon(skyIcon(item.code, item.isDay, h), "ico hour-ico")}
            <b>${Math.round(item.tempC)}°</b>
            <span class="hour-rain${item.precipProb >= 50 ? " wet" : ""}">${icon("drop", "ico tiny")}${item.precipProb}%</span>
          </div>`;
        })
        .join("")}</div>`
    : "";

  const presenceSince = live.presence?.since ? clockLabel(live.presence.since) : "";
  const tiles = `
    <button class="tile tile-link" type="button" data-action="goto" data-target="health">
      <span class="tile-head">${icon("meal", "ico tile-ico")}<span>Өнөөдрийн хоол</span>${icon("chevron", "ico tile-go")}</span>
      <span class="tile-body">${ring(menu?.targetKcal ? (menu.eatenKcal / menu.targetKcal) * 100 : 0)}<span><b>${menu?.eatenKcal || 0}</b><span class="muted"> / ${menu?.targetKcal || "–"} ккал</span></span></span>
      <span class="tile-note">${menu?.items?.length ? `Цэсэнд ${menu.items.length} хоол · ${menu.totals?.total || 0} ккал` : "Гал тогоо цэсээ оруулаагүй байна"}</span>
    </button>
    <button class="tile tile-link" type="button" data-action="goto" data-target="health">
      <span class="tile-head">${icon("heart", "ico tile-ico")}<span>Эрүүл мэнд</span>${icon("chevron", "ico tile-go")}</span>
      <span class="tile-body"><b class="tile-num">${health?.summary?.score ?? "–"}</b><span class="muted">/100 оноо</span></span>
      <span class="tile-note">${air ? `${icon("air", "ico tiny")}Агаар: ${esc(air.label)} · AQI ${air.aqi}` : "Агаарын мэдээлэл ачаалж байна"}</span>
    </button>
    <button class="tile tile-link" type="button" data-action="goto" data-target="health">
      <span class="tile-head">${icon("bolt", "ico tile-ico")}<span>Эрч хүч</span>${icon("chevron", "ico tile-go")}</span>
      <span class="tile-body"><b class="tile-num">${energy?.score ?? "–"}</b><span class="muted">${energy ? esc(bandLabel(energy.band)) : "нойроо оруулна уу"}</span></span>
      <span class="tile-note">${energy ? `${minutesLabel(energy.durationMin)} нойр` : "Эрүүл мэнд хэсэгт нойрны цаг"}</span>
    </button>
    <button class="tile tile-link${checked ? " is-in" : ""}" type="button" data-action="goto" data-target="attendance">
      <span class="tile-head">${icon("badge", "ico tile-ico")}<span>Ирц</span>${icon("chevron", "ico tile-go")}</span>
      <span class="tile-body"><span class="status-dot"></span><b>${checked ? "Ажил дээр" : "Гадуур"}</b></span>
      <span class="tile-note">${checked && presenceSince ? `${presenceSince}-с хойш` : "Картаа White Queen-д уншуулна"}</span>
    </button>`;

  return `
    <div class="today">
      ${todayNotices(live)}
      ${shiftCard(info, live)}

      <section class="today-hero panel">
        <div class="hero-main">
          <p class="hello">${greeting(hour)}${name ? `, <b>${esc(name)}</b>` : ""}</p>
          <p class="date-line">${esc(dateLine)}${live.sun?.rise ? ` · ${icon("sunrise", "ico tiny")}${clockLabel(live.sun.rise)} ${icon("sunset", "ico tiny")}${clockLabel(live.sun.set)}` : ""}</p>
          <div class="now-temp">
            ${icon(weather ? skyIcon(weather.code, weather.isDay, hour) : "cloud", "ico sky-ico")}
            <p class="temp">${weather ? Math.round(weather.tempC) : "–"}<span>°C</span></p>
          </div>
          <p class="condition">${weather ? esc(weather.condition) : "Цаг агаар ачаалж байна"}</p>
        </div>
        <div class="stats">${stats}</div>
        ${hourly}
      </section>

      <section class="brief-card panel">
        <div class="brief-ico">${icon("sunrise")}</div>
        <div class="brief-body">
          <h2>${briefing?.auto ? "06:00 танилцуулга" : briefing ? "Өнөөдрийн танилцуулга" : "Танилцуулга хүлээгдэж байна"}</h2>
          <p>${esc(briefing?.summary || "Өглөө 06:00-д градус, салхины хурд, чиглэл автоматаар гарна. Сервер тэр үед ассан байх ёстой.")}</p>
          ${precip?.text ? `<p class="brief-precip ${precipTone}">${icon("umbrella", "ico tiny")}${esc(precip.text)}</p>` : ""}
        </div>
        <div class="brief-voice">
          <small>Red King · дуут танилцуулга</small>
          ${briefButton()}
          <span class="muted">Ээлж, цаг агаар, сануулга, зарлал</span>
        </div>
      </section>

      <section class="tiles">${tiles}</section>

      <div class="split">
        ${todoPanel(live)}
        ${prepPanel(info, live)}
      </div>
    </div>`;
}

const PRECIP_MODES = [
  {
    id: "auto",
    label: "3D бороо, цас: бодит",
    icon: `<path d="M7 13h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 6.6 3.2 3.2 0 0 0 7 13z"/><path d="M8.5 16.5l-1 3M12.5 16.5l-1 3"/><path d="M17 16v4.5M15 17.1l4 2.3M19 17.1l-4 2.3"/>`,
  },
  {
    id: "off",
    label: "3D бороо, цас: унтраах",
    icon: `<path d="M7 13h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 6.6 3.2 3.2 0 0 0 7 13z"/><path d="M8.5 16.5l-1 3M12.5 16.5l-1 3M16.5 16.5l-1 3"/><path d="M3.5 3.5l17 17"/>`,
  },
];

const MAP_MODES = [
  {
    id: "flat",
    label: "2D газрын зураг",
    icon: `<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>`,
  },
  {
    id: "terrain",
    label: "3D газар",
    icon: `<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M4 7.4l8 4.6 8-4.6M12 12v9.2"/>`,
  },
];

const MAP_ICONS = {
  home: `<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>`,
  full: `<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>`,
};

function iconChip(action, label, icon, extra = "") {
  return `<button type="button" class="chip icon-chip" data-action="${action}" aria-label="${esc(label)}" data-tip="${esc(label)}"${extra}><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></button>`;
}

const WX_ICONS = {
  none: `<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>`,
  wind: `<path d="M3 8.5h10.5a3 3 0 1 0-3-3"/><path d="M3 12.5h15a3 3 0 1 1-3 3"/><path d="M3 16.5h7"/>`,
  precipitation: `<path d="M7 14h10a4 4 0 0 0 .4-8A6 6 0 0 0 6.3 7.6 3.2 3.2 0 0 0 7 14z"/><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3"/>`,
  clouds: `<path d="M7 18.5h10.5a4.5 4.5 0 0 0 .5-9A6.5 6.5 0 0 0 5.8 11.1 3.8 3.8 0 0 0 7 18.5z"/>`,
  temp_new: `<path d="M14 14.6V5a2 2 0 0 0-4 0v9.6a4 4 0 1 0 4 0z"/><path d="M12 9.5v7"/>`,
  pressure_new: `<path d="M4.4 18a8.5 8.5 0 1 1 15.2 0"/><path d="M12 14.5l4-5"/><circle cx="12" cy="14.5" r="1.3"/>`,
  traffic: `<rect x="7.5" y="2.5" width="9" height="19" rx="3.5"/><circle cx="12" cy="7.2" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="16.8" r="1.6"/>`,
};

function trafficButton() {
  if (!TRAFFIC_ENABLED) return "";
  return `<span class="wx-sep" aria-hidden="true"></span><button type="button" class="chip icon-chip${state.traffic ? " on" : ""}" data-action="traffic" aria-pressed="${state.traffic}" aria-label="Замын түгжрэл" data-tip="Замын түгжрэл"><svg viewBox="0 0 24 24" aria-hidden="true">${WX_ICONS.traffic}</svg></button>`;
}

async function trafficStatus(status) {
  const node = document.querySelector("#traffic-info");
  if (!node) return;
  node.hidden = status.state === "off" || !state.traffic;
  node.classList.toggle("is-error", status.state === "error" || status.state === "unsupported");
  node.removeAttribute("title");
  if (status.state === "loading") {
    node.innerHTML = `<span class="muted">Түгжрэл ачаалж байна…</span>`;
    return;
  }
  if (status.state === "ready") {
    node.innerHTML = `<i class="tl tl-free"></i>Чөлөөтэй<i class="tl tl-slow"></i>Удаан<i class="tl tl-jam"></i>Түгжрэл`;
    return;
  }
  if (status.state === "unsupported") {
    node.textContent = "Google 3D дээр түгжрэл харагдахгүй";
    return;
  }
  if (status.state !== "error") return;
  let message = state.live?.providers?.traffic ? "Түгжрэлийн тайл ачаалагдсангүй" : "Google түлхүүр алга";
  if (status.url) {
    try {
      const body = await (await fetch(status.url)).json();
      if (body.error) message = body.error;
    } catch {
      /* keep the short message */
    }
  }
  if (!state.traffic) return;
  node.textContent = message;
  node.title = message;
}

function layerButton(item, active, action) {
  const icon = WX_ICONS[item.id];
  const body = icon ? `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` : esc(item.label);
  return `<button type="button" class="chip icon-chip${active ? " on" : ""}" data-action="${action}" data-layer="${item.id}" aria-label="${esc(item.label)}" data-tip="${esc(item.label)}">${body}</button>`;
}

function weatherView() {
  const hours = state.live?.weather?.hourly?.slice(0, 8) || [];
  const terrain = state.mapMode === "terrain";
  const modes = MAP_MODES.map(
    (mode) =>
      `<button type="button" class="chip icon-chip${mode.id === state.mapMode ? " on" : ""}" data-action="map-mode" data-mode="${mode.id}" aria-pressed="${mode.id === state.mapMode}" aria-label="${esc(mode.label)}" data-tip="${esc(mode.label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${mode.icon}</svg></button>`,
  ).join("");
  const layers = [{ id: "none", label: "Цаг агааргүй" }, ...LAYERS];
  const layerIcons = layers.map((item) => layerButton(item, item.id === state.terrainLayer, "terrain-layer")).join("");
  const precipModes = terrain
    ? `<div class="row precip-modes" role="group" aria-label="3D бороо, цас">${PRECIP_MODES.map(
        (item) =>
          `<button type="button" class="chip icon-chip${item.id === state.precipMode ? " on" : ""}" data-action="precip-mode" data-mode="${item.id}" aria-pressed="${item.id === state.precipMode}" aria-label="${esc(item.label)}" data-tip="${esc(item.label)}"><svg viewBox="0 0 24 24" aria-hidden="true">${item.icon}</svg></button>`,
      ).join("")}</div>`
    : "";
  const tools = `<form class="place-search" data-form="place-search">
        <input name="q" placeholder="Газар хайх: Сүхбаатарын талбай, кафе, эмнэлэг…" autocomplete="off" />
        <button class="chip icon-chip" type="submit" aria-label="Хайх" data-tip="Хайх"><svg viewBox="0 0 24 24" aria-hidden="true">${MAP_ICONS.search}</svg></button>
      </form>
      ${precipModes}`;
  const surface = `<div class="terrain" id="terrain"></div>
        <p class="map-status" id="map-status">${terrain ? "3D газрын зураг" : "Дэлхийн газрын зураг"} ачаалж байна…</p>
        <div class="map-legend" id="map-legend" hidden></div>`;
  return `
    <div class="weather-layout">
      <div class="row map-tools">
        ${tools}
        <span class="spacer"></span>
        ${modes}
        <span class="wx-sep" aria-hidden="true"></span>
        ${iconChip("map-home", "Байршил", MAP_ICONS.home)}
        ${iconChip("map-full", "Бүтэн дэлгэц", MAP_ICONS.full)}
      </div>
      <div class="map-wrap is-terrain">
        ${surface}
        <div class="map-topleft">
          <div class="wx-icons" role="toolbar" aria-label="Газрын зургийн давхарга">${layerIcons}${trafficButton()}</div>
          <p class="traffic-info" id="traffic-info" role="status" hidden></p>
          <div class="place-card" id="place-card" hidden></div>
        </div>
      </div>
      <div class="hours">
        ${hours.map((hour) => `<div class="hour"><span class="muted">${esc(hour.label)}</span><b>${Math.round(hour.tempC)}°</b><span class="muted">${hour.precipProb}%</span></div>`).join("")}
      </div>
      ${
        terrain
          ? ""
          : `<p class="muted">Дэлхийн газрын зураг: чирж хөдөлгөнө, дугуй болон хоёр хуруугаар томруулна. Хур тунадас, салхи, үүл, өдөр шөнийн сүүдэр 3D горимтой ижил NOAA GFS өгөгдлөөр зурагдана. Цагаан урсгал нь салхины чиглэл; газрын зураг дээр заагч аваачвал тухайн цэгийн цаг агаар гарна. Температур, даралт © OpenWeatherMap · хиймэл дагуулын зураг © EOX Sentinel-2 · нэрс © OpenStreetMap contributors.</p>`
      }
    </div>`;
}

function patchLegend(layerId, note = "", override = undefined) {
  const node = document.querySelector("#map-legend");
  if (!node) return;
  const legend = override !== undefined ? override : legendFor(layerId);
  node.hidden = !legend && !note;
  node.innerHTML = `${
    legend
      ? `<div class="legend-bar" style="background:${legend.css}"></div><div class="legend-labels">${legend.labels.map((value) => `<span>${value}</span>`).join("")}<span class="muted">${esc(legend.unit)}</span></div>`
      : ""
  }${note ? `<p class="legend-note">${note}</p>` : ""}`;
}

function terrainWeatherStatus(status) {
  const label = LAYERS.find((item) => item.id === status.layer)?.label || "";
  if (status.state === "off") return patchLegend("none");
  if (status.state === "unsupported") {
    return patchLegend("none", `<span class="warn">Google 3D дээр цаг агаарын давхарга дэмжигдэхгүй. 2D горимыг ашиглана уу.</span>`);
  }
  if (status.state === "loading") return patchLegend(status.layer, `<span class="muted">${esc(label)} ачаалж байна…</span>`);
  if (status.state === "error") return patchLegend(status.layer, `<span class="warn">${esc(status.message)}</span>`);
  const source = LAYERS.find((item) => item.id === status.layer)?.kind === "field"
    ? `NOAA GFS${status.time ? ` ${esc(status.time.slice(11, 16))} UTC` : ""}`
    : "OpenWeatherMap";
  patchLegend(status.layer, `<span class="muted">${esc(label)} · ${source}</span>`, status.legend);
}

const MY_PERIODS = { cycle: "Энэ эргэлт (28 хоног)", lastcycle: "Өмнөх эргэлт", month: "Энэ сар", lastmonth: "Өмнөх сар" };

/** Dates behind a period picker value; cycles follow each person's own 7-7-14 rotation. */
function rangeOf(kind, plan, today) {
  if (kind === "cycle" || kind === "lastcycle") return cycleRange(plan, today, kind === "lastcycle" ? 1 : 0);
  return periodRange(kind, today);
}

function workedDaysLabel(sum) {
  return `${sum.workedDays} / ${sum.targetDays} өдөр`;
}

function shiftSplit(sum) {
  return [`Өдөр ${sum.dayShifts}`, `Шөнө ${sum.nightShifts}`, sum.extra ? `Илүү цаг ${sum.extra}` : ""].filter(Boolean).join(" · ");
}
const DAY_STATUS = {
  ontime: ["Цагтаа", "is-ok"],
  late: ["Хоцорсон", "is-late"],
  absent: ["Тасалсан", "is-absent"],
  missing: ["Ирээгүй байна", "is-absent"],
  untracked: ["Бүртгэл эхлээгүй", "is-off"],
  upcoming: ["Удахгүй", "is-soon"],
  off: ["Амралт", "is-off"],
  extra: ["Илүү цаг", "is-extra"],
  leave: ["Чөлөөтэй", "is-leave"],
};
const LEAVE_STATUS = { pending: ["Хүлээгдэж буй", "is-soon"], approved: ["Зөвшөөрсөн", "is-ok"], rejected: ["Татгалзсан", "is-absent"] };
const PLAN_HOURS = { day: SHIFT_CLOCK.day.join("–"), night: SHIFT_CLOCK.night.join("–"), off: "" };
const LOCAL_MS = 8 * 3600 * 1000;

const shortDate = (date) => date.slice(5).replace("-", ".");
const localDate = (iso) => new Date(Date.parse(iso) + LOCAL_MS).toISOString().slice(0, 10);

function relativeDay(today, date) {
  const ahead = Math.round((Date.parse(date) - Date.parse(today)) / DAY_MS);
  if (ahead === 0) return "Өнөөдөр";
  if (ahead === 1) return "Маргааш";
  if (ahead === -1) return "Өчигдөр";
  return `${shortDate(date)} ${WEEKDAY_SHORT[weekdayOf(date)]}`;
}

function liveDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (value) => String(value).padStart(2, "0");
  return `${Math.floor(seconds / 3600)} цаг ${pad(Math.floor(seconds / 60) % 60)} мин ${pad(seconds % 60)} сек`;
}

function meContext(live) {
  const now = Date.now();
  const uid = state.me.id;
  return { uid, now, today: live.shifts.date, since: live.trackFrom || null, sinceAt: live.trackAt ? Date.parse(live.trackAt) : null, sessions: sessionsOf(live.events || [], uid, now), week: live.shiftPlan, leaves: live.leaves || [] };
}

function meHero(ctx, live) {
  const day = dayRecord({ ...ctx, date: ctx.today });
  const inside = live.presence?.state === "in";
  const next = nextShift(ctx);
  const streak = onTimeStreak(ctx);
  const cycle = periodSummary({ ...ctx, ...cycleRange(ctx.week, ctx.today) });
  const arrival = day.firstIn
    ? `${clockLabel(day.firstIn)}${day.late ? ` <em class="tag is-late">+${day.late} мин</em>` : day.span ? ` <em class="tag is-ok">Цагтаа</em>` : ""}`
    : "–";
  const nextText = next
    ? `${next.ongoing ? "Одоо" : relativeDay(ctx.today, next.date)} · ${PLAN_LABEL[next.shift]} <small>${clockLabel(next.start)}–${clockLabel(next.end)}</small>`
    : "Хуваарьт ээлж алга";
  const fact = (icon, label, value, extra = "", index = 0) =>
    `<div class="me-fact row-in" style="--i:${index}"><span class="att-ico">${adminIcon(icon)}</span><div><small>${label}</small><b${extra}>${value}</b></div></div>`;
  return `
    <section class="panel me-hero">
      <div class="me-status ${inside ? "is-in" : "is-out"}">
        <span class="me-pulse" aria-hidden="true"></span>
        <div>
          <small>Одоогийн төлөв</small>
          <b>${inside ? "Ажил дээр" : "Гадуур"}</b>
          <span>${
            inside ? `${relativeDay(ctx.today, localDate(live.presence.since))} ${clockLabel(live.presence.since)}-аас хойш` : day.lastOut ? `Өнөөдөр ${clockLabel(day.lastOut)}-д гарсан` : "Өнөөдөр бүртгэлгүй"
          }</span>
        </div>
      </div>
      <div class="me-facts">
        ${fact("in", "Өнөөдөр ирсэн", arrival, "", 0)}
        ${fact("today", "Энэ эргэлтэд ажилласан", `${cycle.workedDays} / ${cycle.targetDays} өдөр <small class="me-fact-sub">${shiftSplit(cycle)}</small>`, "", 1)}
        ${fact(next?.shift === "night" ? "moon" : "sun", "Дараагийн ээлж", nextText, "", 2)}
        ${fact("flame", "Цагтаа ирсэн", streak ? `${streak} ээлж дараалан` : "Шинээр эхэлнэ", "", 3)}
      </div>
    </section>`;
}

function meAlerts(live) {
  const attempts = live.cardAttempts || [];
  if (!attempts.length) return "";
  const items = [...attempts]
    .reverse()
    .map(
      (item, index) => `<li class="row-in" style="--i:${index}">
        <span class="att-ico">${adminIcon("warn")}</span>
        <div><b>Таны картаар ${shortDate(localDate(item.at))} ${clockLabel(item.at)}-д оролдлого хийгдсэн</b>
        <small>${item.reason === "mismatch" ? "Нүүр ID картын зурагтай таараагүй" : "Нүүр шалгалт дуусаагүй"} тул ирц бүртгэгдээгүй. Та биш бол админд даруй мэдэгдэнэ үү.</small></div>
      </li>`,
    )
    .join("");
  return `<section class="panel me-alert"><h2>Картын анхааруулга</h2><ul>${items}</ul></section>`;
}

/** Summary pieces that change with the period picker. */
function meSummaryParts(ctx) {
  const kind = MY_PERIODS[state.mePeriod] ? state.mePeriod : "cycle";
  const { from, to } = rangeOf(kind, ctx.week, ctx.today);
  const sum = periodSummary({ ...ctx, from, to });
  const progress = sum.targetDays ? Math.min(1, sum.workedDays / sum.targetDays) : 0;
  const stat = (value, label, cls = "", index = 0) => `<div class="row-in ${cls}" style="--i:${index}"><b>${value}</b><span>${label}</span></div>`;
  const cells = (filled, total, cls) =>
    `<div class="me-cells ${cls}" style="--n:${Math.max(total, 1)}">${Array.from({ length: total }, (_, index) => `<i class="${index < filled ? "is-on" : ""}" style="--i:${index}"></i>`).join("")}</div>`;
  const stats = `
    <div class="me-worked me-fill row-in">
      <span>Ажилласан хоног</span>
      <b>${workedDaysLabel(sum)}</b>
      <small>${shiftSplit(sum)} · ${Math.round(progress * 100)}%</small>
      ${cells(Math.min(sum.workedDays, sum.targetDays), sum.targetDays, "is-work")}
    </div>
    <div class="me-worked me-fill is-rest row-in" style="--i:1">
      <span>Амарсан хоног</span>
      <b>${sum.restedDays} / ${sum.restTarget} өдөр</b>
      <small>${sum.restTarget ? `${Math.round((sum.restedDays / sum.restTarget) * 100)}% · ${sum.restTarget - sum.restedDays} өдөр үлдсэн` : "Энэ хугацаанд амралтын өдөр алга"}</small>
      ${cells(sum.restedDays, sum.restTarget, "is-rest")}
    </div>
    ${stat(`${sum.leftDays} өдөр`, "Үлдсэн ээлж", "", 1)}
    ${stat(sum.late, "Хоцорсон", sum.late ? "is-late" : "", 2)}
    ${stat(sum.early, "Эрт гарсан", sum.early ? "is-late" : "", 3)}
    ${stat(sum.absent, "Тасалсан", sum.absent ? "is-neg" : "", 4)}
    ${stat(`${sum.leave} өдөр`, "Чөлөө", "", 5)}`;
  const bars = sum.days
    .map((day, index) => {
      const [label, cls] = DAY_STATUS[day.status];
      const tip = [
        `${shortDate(day.date)} ${WEEKDAY_SHORT[weekdayOf(day.date)]}`,
        PLAN_LABEL[day.planned],
        day.leave ? LEAVE_LABEL[day.leave.type] : label,
        day.late ? `${day.late} мин хоцорсон` : "",
        day.early ? `${day.early} мин эрт гарсан` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const height = isWorkedDay(day) ? 1 : day.span ? 0.45 : 0;
      return `<div class="bar ${cls}${day.date === ctx.today ? " is-today" : ""}" style="--h:${height};--i:${index}" title="${esc(tip)}" role="img" aria-label="${esc(tip)}"><span></span></div>`;
    })
    .join("");
  const labels = sum.days
    .map(
      (day) =>
        `<span class="${day.date === ctx.today ? "is-today" : ""}"><b>${Number(day.date.slice(8))}</b><small class="plan-${day.planned}">${PLAN_LETTER[day.planned]}</small></span>`,
    )
    .join("");
  const started = ctx.since && ctx.since > from;
  const chart = sum.days.length
    ? `
    <div class="me-chart is-days" style="--n:${sum.days.length}">
      <div class="me-bars">${bars}</div>
      <div class="me-days">${labels}</div>
    </div>`
    : `<p class="muted">Ирцийн бүртгэл ${shortDate(ctx.since)}-аас эхэлсэн тул энэ хугацаанд мэдээлэл алга.</p>`;
  const range = sum.days.length ? `${shortDate(sum.from)} – ${shortDate(to)}${started ? " · бүртгэл эхэлснээс" : ""}` : `${shortDate(from)} – ${shortDate(to)}`;
  return { kind, from: sum.from, to, sum, stats, chart, range };
}

function meSummary(ctx) {
  const parts = meSummaryParts(ctx);
  const periods = Object.entries(MY_PERIODS)
    .map(([value, label]) => `<option value="${value}"${value === parts.kind ? " selected" : ""}>${label}</option>`)
    .join("");
  const legend = ["ontime", "late", "extra", "leave", "absent"].map((key) => `<span class="${DAY_STATUS[key][1]}"><i></i>${DAY_STATUS[key][0]}</span>`).join("");
  return `
    <section class="panel me-summary">
      <div class="admin-users-head">
        <h2>Ажилласан өдрийн дүн <small data-me="range">${parts.range}</small></h2>
        <div class="user-filters">
          <select class="user-filter" data-filter="me-period" aria-label="Хугацаа сонгох">${periods}</select>
          <button class="chip" type="button" data-action="me-csv">${adminIcon("download")}CSV</button>
          <button class="chip" type="button" data-action="me-pdf">${adminIcon("print")}PDF</button>
        </div>
      </div>
      <div class="me-stats" data-me="stats">${parts.stats}</div>
      <div data-me="chart">${parts.chart}</div>
      <div class="me-legend">${legend}</div>
    </section>`;
}

function planCell(kind, label, today, index) {
  return `<li class="plan-day is-${kind}${today ? " is-today" : ""} row-in" style="--i:${index}">
        <small>${label}</small>
        ${adminIcon(kind === "night" ? "moon" : kind === "day" ? "sun" : "rest")}
        <b>${PLAN_LABEL[kind]}</b>
        <span>${PLAN_HOURS[kind]}</span>
      </li>`;
}

/** One-line summary of where a rotation stands on a date. */
function rotationText(plan, date) {
  if (date < rotationFrom(plan)) return `Эргэлт ${shortDate(rotationFrom(plan))}-аас ${PLAN_LABEL[plannedKind(plan, rotationFrom(plan))]} ээлжээр эхэлнэ`;
  const phase = rotationPhase(plan, date);
  return `Одоо: ${PLAN_LABEL[phase.kind]} ${phase.index}/${phase.length} · ${shortDate(phase.next.date)}-аас ${PLAN_LABEL[phase.next.kind]}`;
}

function mePlan(ctx) {
  if (isRotation(ctx.week)) {
    const cells = Array.from({ length: 14 }, (_, index) => {
      const date = addDays(ctx.today, index);
      return planCell(plannedKind(ctx.week, date), `${WEEKDAY_SHORT[weekdayOf(date)]} ${Number(date.slice(8))}`, index === 0, index);
    }).join("");
    return `
    <section class="panel me-plan">
      <h2>Ээлжийн хуваарь</h2>
      <p class="plan-rotation-note">${adminIcon("today")}<span><b>28 хоногийн эргэлт:</b> ${ROTATION_LABEL[patternOf(ctx.week)]}<small>${esc(rotationText(ctx.week, ctx.today))}</small></span></p>
      <ol class="plan-week is-rotation">${cells}</ol>
    </section>`;
  }
  const week = planOf(ctx.week);
  const todayWeekday = weekdayOf(ctx.today);
  const cells = WEEK_ORDER.map((weekday, index) => planCell(week[weekday], WEEKDAY_SHORT[weekday], weekday === todayWeekday, index)).join("");
  return `
    <section class="panel me-plan">
      <h2>Ээлжийн хуваарь</h2>
      <ol class="plan-week">${cells}</ol>
      <p class="muted">${ctx.week ? "Хуваарийг админ тохируулсан." : "Админ тусгай хуваарь тохируулаагүй тул үндсэн хуваарь (Да–Ба өдрийн ээлж) харагдаж байна."} Хоцролтыг ээлж эхэлснээс хойш 5 минутаас тоолно.</p>
    </section>`;
}

function meLeaves(ctx) {
  const types = Object.entries(LEAVE_LABEL)
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
  const list = [...ctx.leaves]
    .sort((a, b) => b.from.localeCompare(a.from))
    .map((leave, index) => {
      const [label, cls] = LEAVE_STATUS[leave.status];
      const days = Math.round((Date.parse(leave.to) - Date.parse(leave.from)) / DAY_MS) + 1;
      return `<li class="leave-item row-in" style="--i:${index}">
          <span class="leave-type is-${leave.type}">${LEAVE_LABEL[leave.type]}</span>
          <div><b>${shortDate(leave.from)}${leave.to !== leave.from ? ` – ${shortDate(leave.to)}` : ""} · ${days} өдөр</b>${leave.note ? `<small>${esc(leave.note)}</small>` : ""}</div>
          <span class="tag ${cls}">${label}</span>
          ${leave.status === "pending" ? `<button class="icon-btn" type="button" data-action="leave-cancel" data-id="${esc(leave.id)}" aria-label="Хүсэлт цуцлах" title="Цуцлах">${adminIcon("trash")}</button>` : ""}
        </li>`;
    })
    .join("");
  return `
    <section class="panel me-leaves">
      <h2>Чөлөөний хүсэлт</h2>
      <form class="leave-form" data-form="leave">
        <label>Төрөл<select class="user-filter leave-select" name="type">${types}</select></label>
        <label>Эхлэх<input type="date" name="from" value="${ctx.today}" min="${addDays(ctx.today, -30)}" required /></label>
        <label>Дуусах<input type="date" name="to" value="${ctx.today}" min="${addDays(ctx.today, -30)}" required /></label>
        <label class="leave-note">Тайлбар<input name="note" maxlength="200" placeholder="Заавал биш" autocomplete="off" /></label>
        <button class="primary" type="submit">Хүсэлт илгээх</button>
      </form>
      <ul class="leave-list">${list || `<li class="muted">Хүсэлт байхгүй.</li>`}</ul>
    </section>`;
}

function meHistory(live) {
  const events = live.events || [];
  const list = events.length
    ? [...events]
        .reverse()
        .slice(0, 20)
        .map(
          (event, index) => `<li class="row-in ${event.state === "in" ? "is-in" : "is-out"}" style="--i:${Math.min(index, 12)}">
            <span class="att-ico">${adminIcon(event.state === "in" ? "in" : "out")}</span>
            <div><b>${event.state === "in" ? "Ирсэн" : "Гарсан"}</b><small>${shortDate(localDate(event.at))} · ${WEEKDAYS[weekdayOf(localDate(event.at))]}</small></div>
            <time datetime="${esc(event.at)}">${clockLabel(event.at)}</time>
          </li>`,
        )
        .join("")
    : `<li class="muted">Сүүлийн 2 сард ирц бүртгэгдээгүй байна.</li>`;
  return `<section class="panel me-history"><h2>Сүүлийн бүртгэл</h2><ol class="att-timeline">${list}</ol></section>`;
}

function attendanceView() {
  const live = state.live;
  if (!live?.shifts) return `<section class="panel"><p class="muted">Ачаалж байна…</p></section>`;
  const ctx = meContext(live);
  return `
    <div class="me-page">
      ${meHero(ctx, live)}
      ${meAlerts(live)}
      ${meSummary(ctx)}
      <div class="me-grid">${mePlan(ctx)}${meLeaves(ctx)}</div>
      ${meHistory(live)}
    </div>`;
}

function attendanceSignature(live) {
  return JSON.stringify([
    live?.shifts?.date,
    live?.presence?.state,
    live?.events?.length,
    live?.events?.at(-1)?.at,
    live?.leaves?.map((item) => item.status),
    live?.cardAttempts?.length,
    live?.shiftPlan,
  ]);
}

function paintMeSummary() {
  if (!state.live?.shifts) return;
  stage.classList.remove("is-quiet");
  const parts = meSummaryParts(meContext(state.live));
  for (const node of stage.querySelectorAll("[data-me]")) node.innerHTML = parts[node.dataset.me];
}

function tickMe() {
  tickCountdown();
}

function meReportRows() {
  const ctx = meContext(state.live);
  const { sum, from, to } = meSummaryParts(ctx);
  const rows = sum.days.map((day) => [
    day.date,
    WEEKDAY_SHORT[weekdayOf(day.date)],
    PLAN_LABEL[day.planned],
    day.leave ? LEAVE_LABEL[day.leave.type] : DAY_STATUS[day.status][0],
    day.firstIn ? clockLabel(day.firstIn) : "",
    day.lastOut ? clockLabel(day.lastOut) : "",
    isWorkedDay(day) ? 1 : 0,
    day.late || "",
    day.early || "",
  ]);
  return { ctx, sum, from, to, header: ["Огноо", "Гараг", "Хуваарь", "Төлөв", "Ирсэн", "Гарсан", "Ажилласан өдөр", "Хоцорсон (мин)", "Эрт гарсан (мин)"], rows };
}

function downloadMeCsv() {
  const { header, rows, from, to } = meReportRows();
  const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  link.download = `irts-${state.me.username}-${from}_${to}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function printMeReport() {
  const { header, rows, from, to, sum } = meReportRows();
  const report = window.open("", "_blank", "width=900,height=700");
  if (!report) return;
  const table = `<table><thead><tr>${header.map((item) => `<th>${esc(item)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((row) => `<tr>${row.map((item) => `<td>${esc(item)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
  report.document.write(`<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>Ирцийн тайлан ${from} – ${to}</title>
    <style>body{font:13px system-ui,sans-serif;margin:28px;color:#111}h1{font-size:20px;margin:0 0 4px}p{margin:0 0 16px;color:#555}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f2f2f2}
    .sum{display:flex;gap:24px;margin:0 0 16px}.sum b{display:block;font-size:18px}</style></head><body>
    <h1>Ирцийн тайлан · ${esc(state.me.displayName)}</h1>
    <p>${from} – ${to} · ID ${esc(state.me.card?.idNumber || "")}</p>
    <div class="sum"><div><b>${workedDaysLabel(sum)}</b>Ажилласан</div><div><b>${sum.dayShifts} / ${sum.nightShifts}</b>Өдөр / шөнө</div>
    <div><b>${sum.late}</b>Хоцорсон</div><div><b>${sum.early}</b>Эрт гарсан</div><div><b>${sum.absent}</b>Тасалсан</div><div><b>${sum.leave}</b>Чөлөө</div></div>
    ${table}</body></html>`);
  report.document.close();
  report.focus();
  report.print();
}

function visionView() {
  const last = state.live?.vision;
  return `
    <div class="grid-2">
      <div class="panel stack">
        <h2>Камер</h2>
        <video id="face-video" class="preview" playsinline muted></video>
        <div class="row">
          <button class="chip" type="button" data-action="open-face">Камер нээх</button>
          <button class="primary" type="button" data-action="analyze">Шинжилгээ хийх</button>
        </div>
        <p id="vision-status" class="muted">Товч дарсны дараа л нэг кадр уншина. Энэ нь эмнэлгийн онош биш.</p>
      </div>
      <div class="panel" id="vision-result">
        <h2>Сүүлийн тэмдэглэл</h2>
        ${last ? visionHtml(last) : "<p class=\"muted\">Одоогоор шинжилгээ байхгүй.</p>"}
      </div>
    </div>`;
}

function visionHtml(reading) {
  if (reading.withheld) {
    return `<p class="quote">${esc(reading.quote)}</p><p>${esc(reading.advice)}</p><p class="muted">${esc(reading.skinAdvice)}</p>`;
  }
  const bar = (value) => `<div class="meter"><span style="width:${Math.round(value * 100)}%"></span></div>`;
  return `
    <p>Ядаргаа ${Math.round(reading.fatigue * 100)}%</p>${bar(reading.fatigue)}
    <p>Стресс ${Math.round(reading.stress * 100)}%</p>${bar(reading.stress)}
    <p>Арьсны чийг ${Math.round(reading.hydration * 100)}% · цочрол ${Math.round(reading.irritation * 100)}%</p>${bar(reading.irritation)}
    <p class="quote">${esc(reading.quote)}</p>
    <p>${esc(reading.advice)}</p>
    <p>${esc(reading.skinAdvice)}</p>
    <div class="row"><div id="breath" class="breath"></div><button class="chip" type="button" data-action="breathe">60 секунд амьсгал</button></div>
    <p class="muted">Итгэлцүүр ${Math.round(reading.confidence * 100)}%. Нүүрний цэг дээрх ойролцоо үнэлгээ.</p>`;
}

const TONE = {
  good: "good",
  normal: "good",
  ok: "good",
  moderate: "warn",
  elevated: "warn",
  low: "warn",
  stage1: "warn",
  sensitive: "warn",
  warn: "warn",
  high: "danger",
  stage2: "danger",
  crisis: "danger",
  bad: "danger",
  "very-bad": "danger",
  hazard: "danger",
  danger: "danger",
};

function meter(pct) {
  return `<div class="meter"><span style="width:${Math.max(0, Math.min(100, Math.round(pct)))}%"></span></div>`;
}

function timeLabel(iso) {
  return iso ? new Date(iso).toLocaleString("mn-MN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

const TREND_PERIODS = { week: ["7 хоног", 7], month: ["30 хоног", 30] };
const TREND_LEGEND = {
  sleep: [["is-ok", "7.5+ цаг"], ["is-late", "Дутуу"]],
  steps: [["is-ok", "8000+ алхам"], ["is-late", "Дутуу"]],
  bp: [["is-ok", "Хэвийн"], ["is-high", "140/90 ба түүнээс дээш"]],
  weight: [["is-extra", "Жин"]],
  mood: [["is-ok", "Сайн"], ["is-late", "Дунд"], ["is-high", "Муу"]],
};
const BREATH_PHASE = { "Амьсгал ав": "in", Гаргах: "out", Барих: "hold" };

const minutesLabel = (min) => `${Math.floor(min / 60)} ц${min % 60 ? ` ${min % 60} мин` : ""}`;

function wellCtx(live) {
  const now = Date.now();
  const uid = state.me.id;
  return {
    uid,
    now,
    today: live.wellness?.today || live.shifts?.date,
    week: live.shiftPlan,
    leaves: live.leaves || [],
    sessions: sessionsOf(live.events || [], uid, now),
    days: live.wellness?.days || {},
    vitals: live.wellness?.vitals || [],
  };
}

/** Planned shift kind for a calendar date, with approved leave counted as off. */
function plannedOn(ctx, date) {
  return leaveOn(ctx.leaves, ctx.uid, date) ? "off" : plannedKind(ctx.week, date);
}

function healthShift(ctx) {
  const tips = shiftAdvice(ctx);
  const load = workload(ctx);
  const tone = load.workStreak > CYCLE_WORK_DAYS ? "danger" : load.extraDays ? "warn" : "good";
  const advice = tips
    .map(
      (tip, index) => `<li class="advice tone-${TONE[tip.level] || "info"} row-in" style="--i:${index}">
        <span class="advice-ico">${icon(tip.icon)}</span>
        <div><b>${esc(tip.title)}</b><p>${esc(tip.text)}</p></div>
      </li>`,
    )
    .join("");
  const warnings = load.warnings.map((item) => `<li class="tone-${TONE[item.level]}">${icon("warn", "ico tiny")}<span>${esc(item.text)}</span></li>`).join("");
  return `
    <section class="panel hl-shift">
      <div class="stack">
        <h2>Ээлжид тохирсон зөвлөгөө</h2>
        <ul class="advice-list">${advice}</ul>
      </div>
      <div class="hl-load tone-${tone}">
        <h3>Ажлын ачаалал</h3>
        <p class="hl-load-num"><b>${load.workStreak}</b><span>/ ${CYCLE_WORK_DAYS} өдөр · амралтгүй дараалан</span></p>
        <div class="me-progress hl-load-bar" style="--p:${Math.min(1, load.workStreak / CYCLE_WORK_DAYS).toFixed(3)}"><span></span></div>
        <p class="muted">Шөнийн ээлж дараалсан: <b>${load.nightStreak || 0}</b></p>
        ${warnings ? `<ul class="hl-warn">${warnings}</ul>` : `<p class="hl-ok">${icon("check", "ico tiny")}Ачаалал хэвийн. ${CYCLE_WORK_DAYS}-өөс олон өдөр амралтгүй, амралтын өдөр ажиллах эсвэл 3+ шөнө дараалвал энд анхааруулна.</p>`}
      </div>
    </section>`;
}

function trendParts(ctx, live) {
  const metric = TRENDS[state.trendMetric] ? state.trendMetric : "sleep";
  const [periodLabel, span] = TREND_PERIODS[state.trendPeriod] || TREND_PERIODS.week;
  const from = addDays(ctx.today, 1 - span);
  const series = trendSeries(metric, { days: ctx.days, vitals: ctx.vitals, from, to: ctx.today });
  const target = TRENDS[metric].target();
  const logged = series.filter((point) => point.value != null);
  const values = logged.map((point) => point.value);
  let lo = 0;
  let hi = 5;
  if (metric === "sleep") hi = Math.max(10, ...values);
  if (metric === "steps") hi = Math.max(target * 1.25, ...values);
  if (metric === "bp") [lo, hi] = [50, Math.max(170, ...values) + 5];
  if (metric === "weight") [lo, hi] = values.length ? [Math.floor(Math.min(...values)) - 3, Math.ceil(Math.max(...values)) + 2] : [0, 100];
  const norm = (value) => Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  const face = (value) => MOODS.find((item) => item.value === value)?.face || "";
  const full = (point) =>
    ({
      sleep: `${point.value} цаг`,
      steps: `${point.value} алхам`,
      bp: `${point.value}/${point.low} мм МУБ`,
      weight: `${point.value} кг`,
      mood: `${face(point.value)} ${point.value}/5`,
    })[metric];
  const short = (point) =>
    ({
      sleep: `${point.value}`,
      steps: `${(point.value / 1000).toFixed(1)}k`,
      bp: `${point.value}/${point.low}`,
      weight: `${point.value}`,
      mood: face(point.value),
    })[metric];
  const tone = (point) => {
    if (point.value == null) return "is-empty";
    if (metric === "bp") return point.value >= BP_HIGH.sys || point.low >= BP_HIGH.dia ? "is-high" : "is-ok";
    if (metric === "weight") return "is-extra";
    if (metric === "mood") return point.value >= 4 ? "is-ok" : point.value === 3 ? "is-late" : "is-high";
    return point.value >= target ? "is-ok" : "is-late";
  };
  const bars = series
    .map((point, index) => {
      const tip = `${shortDate(point.date)} ${WEEKDAY_SHORT[weekdayOf(point.date)]} · ${point.value == null ? "бүртгэлгүй" : full(point)}`;
      const range = metric === "bp" && point.value != null;
      const style = `--h:${point.value == null ? 0 : norm(point.value).toFixed(3)};--i:${index}${range ? `;--lo:${norm(point.low).toFixed(3)}` : ""}`;
      const label = span <= 7 && point.value != null ? `<em class="bar-val">${short(point)}</em>` : "";
      return `<div class="bar ${tone(point)}${range ? " is-range" : ""}${point.date === ctx.today ? " is-today" : ""}" style="${style}" title="${esc(tip)}" role="img" aria-label="${esc(tip)}"><span>${label}</span></div>`;
    })
    .join("");
  const labels = series
    .map((point) => `<span class="${point.date === ctx.today ? "is-today" : ""}"><b>${Number(point.date.slice(8))}</b>${span <= 7 ? `<small>${WEEKDAY_SHORT[weekdayOf(point.date)]}</small>` : ""}</span>`)
    .join("");
  const targetLabel = { sleep: "7.5 цаг", steps: "8000", bp: "140" }[metric];
  const line = target != null && targetLabel ? `<i class="me-target" style="--t:${norm(target).toFixed(3)}"><em>${targetLabel}</em></i>` : "";
  const avg = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  const hit = values.filter((value) => value >= target).length;
  let note = "Энэ хугацаанд бүртгэл алга. Доорх хэсгүүдэд өдөр бүр тэмдэглээрэй.";
  if (logged.length) {
    const count = `${logged.length}/${span} өдөр бүртгэлтэй`;
    if (metric === "sleep") note = `Дундаж <b>${(Math.round(avg(values) * 10) / 10).toFixed(1)} цаг</b> · 7.5+ цаг унтсан ${hit} шөнө · ${count}`;
    if (metric === "steps") note = `Дундаж <b>${Math.round(avg(values))} алхам</b> · 8000-д хүрсэн ${hit} өдөр · ${count}`;
    if (metric === "bp") {
      const high = logged.filter((point) => tone(point) === "is-high").length;
      note = `Дундаж <b>${Math.round(avg(values))}/${Math.round(avg(logged.map((point) => point.low)))}</b> · 140/90+ өдөр ${high} · ${count}`;
    }
    if (metric === "weight") {
      const delta = Math.round((values.at(-1) - values[0]) * 10) / 10;
      note = `${values[0]} кг → <b>${values.at(-1)} кг</b> (${delta > 0 ? "+" : ""}${delta} кг) · ${count}`;
    }
    if (metric === "mood") note = `Дундаж <b>${(Math.round(avg(values) * 10) / 10).toFixed(1)}/5</b> ${face(Math.round(avg(values)))} · ${count}`;
  }
  return {
    metric,
    range: `${periodLabel} · ${shortDate(from)} – ${shortDate(ctx.today)}`,
    chart: `
      <div class="me-chart hl-chart" style="--n:${span}">
        <div class="me-bars">${bars}${line}</div>
        <div class="me-days">${labels}</div>
      </div>`,
    note,
    legend: TREND_LEGEND[metric].map(([cls, label]) => `<span class="${cls}"><i></i>${label}</span>`).join(""),
  };
}

function healthTrends(ctx, live) {
  const parts = trendParts(ctx, live);
  const periods = Object.entries(TREND_PERIODS)
    .map(([value, [label]]) => `<option value="${value}"${value === state.trendPeriod ? " selected" : ""}>${label}</option>`)
    .join("");
  const tabs = Object.entries(TRENDS)
    .map(
      ([key, meta]) =>
        `<button type="button" role="tab" class="seg-tab${key === parts.metric ? " is-active" : ""}" aria-selected="${key === parts.metric}" data-action="trend-metric" data-metric="${key}">${meta.label}</button>`,
    )
    .join("");
  return `
    <section class="panel hl-trends">
      <div class="admin-users-head">
        <h2>Өдөр тутмын хяналт <small data-trend="range">${parts.range}</small></h2>
        <div class="user-filters"><select class="user-filter" data-filter="trend-period" aria-label="Хугацаа">${periods}</select></div>
      </div>
      <div class="seg-tabs" role="tablist" aria-label="Үзүүлэлт">${tabs}</div>
      <div data-trend="chart">${parts.chart}</div>
      <p class="trend-note" data-trend="note">${parts.note}</p>
      <div class="me-legend" data-trend="legend">${parts.legend}</div>
    </section>`;
}

function paintTrends() {
  if (!state.live?.wellness) return;
  stage.classList.remove("is-quiet");
  const parts = trendParts(wellCtx(state.live), state.live);
  for (const node of stage.querySelectorAll("[data-trend]")) node.innerHTML = parts[node.dataset.trend];
  for (const tab of stage.querySelectorAll(".seg-tab[data-metric]")) {
    const active = tab.dataset.metric === parts.metric;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  }
}

/** Why live Bluetooth heart rate cannot run here, or "" when it can. */
function bluetoothBlock() {
  if (!window.isSecureContext) return "Bluetooth зөвхөн HTTPS эсвэл localhost хаягаар ажиллана.";
  if (!navigator.bluetooth) return "Энэ хөтөч Bluetooth дэмжихгүй. Android дээр Chrome, компьютер дээр Chrome эсвэл Edge ашиглана уу. iPhone дэмжихгүй.";
  return "";
}

function pulseBox() {
  const pulse = state.pulse;
  const block = bluetoothBlock();
  if (pulse?.status === "live" || pulse?.status === "lost") {
    const zone = pulseZone(pulse.bpm);
    const avg = pulse.n ? Math.round(pulse.sum / pulse.n) : null;
    return `
      <div class="pulse-live is-${zone.key}${pulse.status === "lost" ? " is-lost" : ""}">
        <span class="pulse-heart">${icon("heart")}</span>
        <b>${pulse.bpm ?? "–"}</b><small>цохилт/мин · ${esc(zone.label)}</small>
      </div>
      <p class="muted">${esc(pulse.name)} ${pulse.status === "lost" ? "салсан байна." : "холбогдсон."} ${avg ? `Дундаж ${avg} · бага ${pulse.min} · их ${pulse.max}` : "Хэмжилт хүлээж байна…"}</p>
      <div class="row">
        <button class="primary" type="button" data-action="pulse-save"${avg ? "" : " disabled"}>Дундажийг хадгалах</button>
        <button class="chip" type="button" data-action="pulse-stop">Салгах</button>
      </div>`;
  }
  return `
    <div class="pulse-live is-none"><span class="pulse-heart">${icon("heart")}</span><b>–</b><small>цохилт/мин</small></div>
    ${pulse?.status === "error" ? `<p class="error">${esc(pulse.error)}</p>` : ""}
    ${block ? `<p class="muted">${esc(block)}</p>` : ""}
    <button class="primary" type="button" data-action="pulse-connect"${block || pulse?.status === "connecting" ? " disabled" : ""}>${pulse?.status === "connecting" ? "Холбогдож байна…" : "Цаг холбох (Bluetooth)"}</button>`;
}

function paintPulse() {
  const box = stage.querySelector("[data-pulse-box]");
  if (box) box.innerHTML = pulseBox();
}

async function connectWatch() {
  if (bluetoothBlock()) return;
  state.pulse = { status: "connecting" };
  paintPulse();
  try {
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
    device.addEventListener("gattserverdisconnected", () => {
      if (state.pulse?.device === device) {
        state.pulse.status = "lost";
        paintPulse();
      }
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService("heart_rate");
    const reading = await service.getCharacteristic("heart_rate_measurement");
    state.pulse = { status: "live", device, reading, name: device.name || "Ухаалаг цаг", bpm: null, min: null, max: null, sum: 0, n: 0 };
    reading.addEventListener("characteristicvaluechanged", onPulse);
    await reading.startNotifications();
    paintPulse();
  } catch (error) {
    const cancelled = error?.name === "NotFoundError";
    state.pulse = cancelled ? null : { status: "error", error: `Холбогдсонгүй: ${error?.message || error}. Цаг ойрхон, HR broadcast асаалттай эсэхийг шалгана уу.` };
    paintPulse();
  }
}

function onPulse(event) {
  const pulse = state.pulse;
  if (!pulse) return;
  const bpm = parseHeartRate(event.target.value);
  if (!(bpm >= 30 && bpm <= 220)) return;
  Object.assign(pulse, { status: "live", bpm, min: Math.min(pulse.min ?? bpm, bpm), max: Math.max(pulse.max ?? bpm, bpm), sum: pulse.sum + bpm, n: pulse.n + 1 });
  paintPulse();
}

function disconnectWatch() {
  const pulse = state.pulse;
  state.pulse = null;
  pulse?.reading?.removeEventListener("characteristicvaluechanged", onPulse);
  if (pulse?.device?.gatt?.connected) pulse.device.gatt.disconnect();
  paintPulse();
}

function watchPanel(ctx) {
  const { tips, stats } = watchAdvice(ctx);
  const hours = (min) => (min == null ? "–" : `${Math.round((min / 60) * 10) / 10} ц`);
  const tiles = [
    ["moon", "Сүүлийн нойр", hours(stats.lastSleepMin)],
    ["moon", "7 хоногийн дундаж", hours(stats.sleepAvgMin)],
    ["steps", "Дундаж алхам", stats.stepsAvg == null ? "–" : stats.stepsAvg.toLocaleString("mn-MN")],
    ["steps", "Идэвхтэй / 7 хоног", `${stats.activeWeek} мин`],
    ["heart", "Тайван цохилт", stats.hrAvg ?? "–"],
    ["heart", "Даралт", stats.bp ? `${stats.bp.sys}/${stats.bp.dia}` : "–"],
  ]
    .map(([name, label, value]) => `<div class="watch-tile">${icon(name, "ico tiny")}<small>${label}</small><b>${esc(String(value))}</b></div>`)
    .join("");
  const advice = tips.length
    ? tips
        .map(
          (tip, index) => `<li class="advice tone-${TONE[tip.level] || "info"} row-in" style="--i:${index}">
            <span class="advice-ico">${icon(tip.icon)}</span>
            <div><b>${esc(tip.title)}</b><p>${esc(tip.text)}</p></div>
          </li>`,
        )
        .join("")
    : `<li class="advice tone-good"><span class="advice-ico">${icon("check")}</span><div><b>Бүх үзүүлэлт хэвийн</b><p>Нойр, хөдөлгөөн, даралт зорилтдоо байна. Ингээд үргэлжлүүл.</p></div></li>`;
  return `
    <section class="panel watch-panel">
      <div class="watch-head">
        <h2>Ухаалаг цаг</h2>
      </div>
      <div class="watch-tiles">${tiles}</div>
      <div class="watch-grid">
        <div class="stack watch-pulse" data-pulse-box>${pulseBox()}</div>
        <form class="stack watch-form" data-form="watch" autocomplete="off">
          <h3>Цагны апп-аас харж оруулах</h3>
          <div class="watch-fields">
            <label>Унтсан<input name="start" type="time" /></label>
            <label>Сэрсэн<input name="end" type="time" /></label>
            <label>Нойрны оноо<input name="score" type="number" min="0" max="100" placeholder="0–100" /></label>
            <label>Өнөөдрийн алхам<input name="steps" type="number" min="0" max="100000" placeholder="${STEP_GOAL}" /></label>
            <label>Идэвхтэй минут<input name="active" type="number" min="0" max="1440" placeholder="30" /></label>
            <label>Даралт дээд<input name="sys" type="number" min="70" max="260" placeholder="120" /></label>
            <label>Даралт доод<input name="dia" type="number" min="40" max="160" placeholder="80" /></label>
            <label>Зүрхний цохилт<input name="hr" type="number" min="30" max="220" placeholder="70" /></label>
          </div>          <button class="primary" type="submit">Цагны мэдээлэл хадгалах</button>
        </form>
      </div>
      <h3>Ухаалаг зөвлөгөө</h3>
      <ul class="advice-list">${advice}</ul>
    </section>`;
}

function foodPanel(ctx, live) {
  const menu = live.menu || { date: ctx.today, shift: plannedOn(ctx, ctx.today) === "night" ? "night" : "day", items: [], eaten: [] };
  const items = menu.items || [];
  const eaten = new Set(menu.eaten || []);
  const target = menu.targetKcal || 0;
  const got = menu.eatenKcal || 0;
  const pct = target ? Math.min(100, (got / target) * 100) : 0;
  const tone = !got ? "" : got > target * 1.1 ? " is-over" : got >= target * 0.8 ? " is-ok" : "";
  const meals = shiftMeals(menu);
  const now = mealNow(menu);
  const slots = meals
    .map((meal) => {
      const dishes = mealDishes(menu, meal);
      const total = dishes.reduce((sum, item) => sum + (item.kcal || 0), 0);
      const mine = dishes.filter((item) => eaten.has(item.id)).reduce((sum, item) => sum + (item.kcal || 0), 0);
      const names = dishes.map((item) => item.name);
      const preview = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
      const [label, iconName] = MEAL_SLOT[meal];
      return `<button class="meal-slot${dishes.length ? "" : " is-empty"}${mine ? " is-eaten" : ""}${meal === now ? " is-now" : ""}" type="button" data-action="meal-open" data-meal="${meal}" aria-haspopup="dialog">
          <span class="meal-slot-head"><span class="meal-slot-ico">${icon(iconName)}</span><b>${label}</b>${meal === now ? `<em>Одоо</em>` : ""}</span>
          <span class="meal-slot-kcal">${dishes.length ? `<b>${total}</b> ккал` : "Цэс ороогүй"}</span>
          <small>${dishes.length ? esc(preview) : "Гал тогоо оруулаагүй байна"}</small>
          <span class="meal-slot-foot">${mine ? `${icon("check", "ico tiny")}${mine} ккал идсэн` : dishes.length ? `${dishes.length} хоол · дарж үзэх` : ""}</span>
        </button>`;
    })
    .join("");
  return `
    <div class="panel stack food-panel">
      <h2>Хоол <small>${menu.shift === "night" ? "шөнийн ээлж" : "өдрийн ээлж"} · ${shortDate(menu.date)}</small></h2>      <div class="meal-slots">${slots}</div>
      ${!items.length && isKitchen() ? `<button class="primary" type="button" data-action="goto" data-target="menu">${icon("plus")}Хоолны цэс оруулах</button>` : ""}
      <div class="food-sum${tone}">
        <div><b>${got}</b><span>/ ${target} ккал идсэн</span></div>
        <div class="me-progress" style="--p:${(pct / 100).toFixed(3)}"><span></span></div>
        ${got ? `<p class="muted">${got > target * 1.1 ? "Өдрийн хэрэгцээнээс илүү гарлаа. Дараагийн хоолоо хөнгөн, ногоотой сонго." : `Өдрийн хэрэгцээнээс ${Math.max(0, target - got)} ккал үлдлээ.`}</p>` : ""}
      </div>
    </div>`;
}

const MEAL_SLOT = { breakfast: ["Өглөө", "sunrise"], lunch: ["Өдөр", "sun"], dinner: ["Орой", "sunset"], night: ["Шөнө", "moon"] };

function shiftMeals(menu) {
  return menu?.meals || (menu?.shift === "night" ? ["dinner", "night", "breakfast"] : ["breakfast", "lunch", "dinner"]);
}

function mealDishes(menu, meal) {
  return (menu?.items || []).filter((item) => item.meal === meal);
}

/** The meal closest in time on this shift, so its card can be marked "now". */
function mealNow(menu) {
  const hour = new Date().getHours();
  if (menu?.shift === "night") return hour >= 18 && hour < 22 ? "dinner" : hour >= 22 || hour < 4 ? "night" : "breakfast";
  return hour < 10 ? "breakfast" : hour < 16 ? "lunch" : "dinner";
}

function mealModalBody(meal) {
  const menu = state.live?.menu;
  const dishes = mealDishes(menu, meal);
  if (!dishes.length) return `<p class="meal-empty">${icon("meal")}<span>Гал тогоо ${esc(MENU_MEAL_LABEL[meal].toLowerCase())}ны цэсээ хараахан оруулаагүй байна.</span></p>${isKitchen() ? `<div class="modal-actions"><button class="primary" type="button" data-action="goto" data-target="menu">${icon("plus")}Цэс оруулах</button></div>` : ""}`;
  const eaten = new Set(menu.eaten || []);
  const total = dishes.reduce((sum, item) => sum + (item.kcal || 0), 0);
  const mine = dishes.filter((item) => eaten.has(item.id)).reduce((sum, item) => sum + (item.kcal || 0), 0);
  const rows = dishes
    .map((item) => {
      const on = eaten.has(item.id);
      const sub = [item.portion ? `${item.portion} ${item.unit}` : "", macroLine(item), item.note || ""].filter(Boolean).join(" · ");
      return `<li>
          <button class="food-item${on ? " is-on" : ""}" type="button" data-action="eat" data-id="${esc(item.id)}" aria-pressed="${on}">
            <span class="food-tick">${icon(on ? "check" : "plus", "ico tiny")}</span>
            <span class="food-what"><small class="menu-cat is-${esc(item.category)}">${esc(MENU_CATEGORY_LABEL[item.category] || "")}</small><b>${esc(item.name)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
            <span class="food-kcal">${item.kcal == null ? `<small class="muted">тооцоогүй</small>` : `<b>${item.kcal}</b><small>ккал</small>`}</span>
          </button>
        </li>`;
    })
    .join("");
  return `<div class="meal-modal-sum">
      <div><b>${total}</b><span>ккал нийт</span></div>
      <div class="${mine ? "is-on" : ""}"><b>${mine}</b><span>ккал идсэн</span></div>
      <div><b>${dishes.length}</b><span>хоол</span></div>
    </div>
    <ul class="food-list">${rows}</ul>
    <p class="muted">Идсэн хоолоо дарж тэмдэглэнэ үү, калори өдрийн дүнд автоматаар нэмэгдэнэ. Калорийг AI нэг порцоор ойролцоогоор тооцсон.</p>`;
}

function openMealModal(meal) {
  const menu = state.live?.menu;
  if (!menu || !MEAL_SLOT[meal]) return;
  const date = meal === "breakfast" && menu.shift === "night" ? menu.morning : menu.date;
  const wrap = openModal({
    shield: icon(MEAL_SLOT[meal][1]),
    title: esc(MENU_MEAL_LABEL[meal]),
    sub: `${esc(shortDate(date))} · гал тогооны цэс${meal === "breakfast" && menu.shift === "night" ? " · ээлж дуусах үеийн" : ""}`,
    body: mealModalBody(meal),
    className: "meal-modal",
  });
  if (!wrap) return;
  wrap.addEventListener("click", async (event) => {
    if (event.target.closest("[data-action='goto']")) {
      closeModal(true);
      Object.assign(state, { view: "menu", menuDate: date, menuEdit: null, kitchen: null });
      render();
      return;
    }
    const button = event.target.closest("[data-action='eat']");
    if (!button) return;
    if (!(await liveAction("/api/health/eat", "POST", { id: button.dataset.id }, button))) return;
    const body = wrap.querySelector(".modal-body");
    body.classList.add("is-static");
    body.innerHTML = mealModalBody(meal);
    body.querySelector(`[data-id="${CSS.escape(button.dataset.id)}"]`)?.focus({ preventScroll: true });
  });
  requestAnimationFrame(() => wrap.querySelector(".modal-x").focus({ preventScroll: true }));
}

function moodPanel(ctx, live) {
  const mood = ctx.days[ctx.today]?.mood;
  const vision = live.vision;
  const picks = MOODS.map(
    (item) => `<button class="mood${item.value === mood ? " is-on" : ""}" type="button" data-action="mood" data-mood="${item.value}" aria-pressed="${item.value === mood}" title="${item.label}">
      <span>${item.face}</span><small>${item.label}</small>
    </button>`,
  ).join("");
  const links = moodLinks({ ...ctx, from: addDays(ctx.today, -29), to: ctx.today });
  const rows = (list) =>
    list
      .map(
        (row) => `<div class="ml-row">
          <span>${esc(row.label)}</span>
          <div class="ml-track"><i class="tone-${row.avg == null ? "none" : row.avg >= 4 ? "good" : row.avg >= 3 ? "warn" : "danger"}" style="--w:${row.avg ? (row.avg / 5).toFixed(3) : 0}"></i></div>
          <b>${row.avg ?? "–"}</b><small>${row.n} өдөр</small>
        </div>`,
      )
      .join("");
  return `
    <div class="panel stack">
      <h2>Сэтгэл санаа</h2>
      <div class="mood-row" role="group" aria-label="Өнөөдрийн сэтгэл санаа">${picks}</div>
      <p class="muted">${mood ? `Өнөөдөр: <b>${MOODS.find((item) => item.value === mood).label}</b>. Дахин дарвал арилна.` : "Өдөрт нэг удаа товшиж тэмдэглэнэ."}</p>
      <div class="ml">
        <h3>Ээлжээс хамаарах нь <small>сүүлийн 30 хоног</small></h3>
        ${rows(links.shifts)}
        <h3>Нойроос хамаарах нь</h3>
        ${rows(links.sleep)}      </div>
      ${vision && !vision.withheld ? `<p class="muted">Камер: стресс ${Math.round(vision.stress * 100)}% · ядаргаа ${Math.round(vision.fatigue * 100)}% · ${esc(timeLabel(vision.at))}</p>` : ""}
      <button class="ghost" type="button" data-action="goto" data-target="vision">Камераар шалгах</button>
    </div>`;
}

function breathLeft(run) {
  const left = Math.max(0, Math.ceil((run.end - Date.now()) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} үлдлээ`;
}

function breathPanel() {
  const run = state.breath;
  const key = run?.key || state.breathKey;
  const minutes = run?.minutes || state.breathMin;
  const patterns = Object.entries(BREATHING)
    .map(([value, item]) => `<button class="chip${value === key ? " is-active" : ""}" type="button" data-action="breath-pattern" data-key="${value}"${run ? " disabled" : ""}>${item.label}</button>`)
    .join("");
  const lengths = [1, 3, 5]
    .map((value) => `<button class="chip${value === minutes ? " is-active" : ""}" type="button" data-action="breath-min" data-min="${value}"${run ? " disabled" : ""}>${value} мин</button>`)
    .join("");
  return `
    <div class="panel stack hl-breath">
      <h2>Амьсгалын дасгал</h2>
      <div class="breath-stage">
        <div id="breath" class="breath" data-phase="${run?.phase || ""}" style="--dur:${run?.dur || 1}s"></div>
        <span class="breath-cue" id="breath-cue">${esc(run?.cue || "Бэлэн")}</span>
      </div>
      <p class="breath-left" id="breath-left">${run ? breathLeft(run) : `${minutes} минут`}</p>
      <div class="chip-row" role="group" aria-label="Амьсгалын арга">${patterns}</div>
      <div class="chip-row" role="group" aria-label="Хугацаа">${lengths}</div>
      <button class="${run ? "ghost" : "primary"}" type="button" data-action="breathe">${icon(run ? "stop" : "play", "ico tiny")}${run ? "Зогсоох" : "Эхлэх"}</button>    </div>`;
}

function stopBreath() {
  const run = state.breath;
  if (!run) return;
  clearTimeout(run.timer);
  clearInterval(run.clock);
  run.audio?.close().catch(() => {});
  state.breath = null;
}

function startBreath() {
  stopBreath();
  const pattern = BREATHING[state.breathKey];
  const run = { key: state.breathKey, minutes: state.breathMin, end: Date.now() + state.breathMin * 60000, step: 0, phase: "", cue: "", dur: 1 };
  try {
    run.audio = new AudioContext();
    const osc = run.audio.createOscillator();
    run.gain = run.audio.createGain();
    osc.type = "sine";
    osc.frequency.value = 196;
    run.gain.gain.value = 0.0001;
    osc.connect(run.gain).connect(run.audio.destination);
    osc.start();
  } catch {
    run.audio = null;
  }
  state.breath = run;
  const step = () => {
    if (state.breath !== run) return;
    if (Date.now() >= run.end - 400) {
      stopBreath();
      if (state.view === "health") render();
      return;
    }
    const [cue, seconds] = pattern.steps[run.step % pattern.steps.length];
    const kind = BREATH_PHASE[cue];
    run.step += 1;
    run.phase = kind === "hold" ? (run.phase === "in" || run.phase === "hold-in" ? "hold-in" : "hold-out") : kind;
    run.cue = cue;
    run.dur = seconds;
    const node = document.querySelector("#breath");
    if (node) {
      node.style.setProperty("--dur", `${seconds}s`);
      node.dataset.phase = run.phase;
      document.querySelector("#breath-cue").textContent = cue;
    }
    if (run.gain && kind !== "hold") {
      const now = run.audio.currentTime;
      run.gain.gain.cancelScheduledValues(now);
      run.gain.gain.setValueAtTime(run.gain.gain.value, now);
      run.gain.gain.linearRampToValueAtTime(kind === "in" ? 0.03 : 0.0001, now + seconds);
    }
    run.timer = setTimeout(step, seconds * 1000);
  };
  run.clock = setInterval(() => {
    const node = document.querySelector("#breath-left");
    if (node && state.breath === run) node.textContent = breathLeft(run);
  }, 1000);
  render();
  step();
}

function healthView() {
  const live = state.live;
  if (!live?.wellness) return `<section class="panel"><p class="muted">Ачаалж байна…</p></section>`;
  const ctx = wellCtx(live);
  const energy = live.energy;
  const health = live.health;
  const summary = health?.summary;
  const vitals = health?.vitals;
  const air = health?.air;
  const debt = sleepDebt(ctx);
  const bp = bpStats(ctx.vitals, ctx.now);
  const tone = summary?.band === "good" ? "good" : summary?.band === "ok" ? "warn" : "danger";
  const tips = summary?.tips?.length
    ? `<ul class="tips">${summary.tips.map((tip) => `<li class="tone-${TONE[tip.level] || "info"}">${esc(tip.text)}</li>`).join("")}</ul>`
    : `<p class="muted">Өнөөдөр онцгой анхааруулга алга. Ингээд үргэлжлүүлээрэй.</p>`;
  const history = vitals?.history?.length
    ? `<ul class="list">${vitals.history
        .map((item) => {
          const high = item.sys && (item.sys >= BP_HIGH.sys || item.dia >= BP_HIGH.dia);
          return `<li${high ? ` class="is-high"` : ""}><span>${item.sys ? `${item.sys}/${item.dia}` : "–"}${item.hr ? ` · ${item.hr} цохилт` : ""}</span><span class="muted">${esc(timeLabel(item.at))}</span></li>`;
        })
        .join("")}</ul>`
    : "";
  const top = `
      <div class="panel health-top">
        <div class="score tone-${tone}" style="--pct:${summary?.score || 0}"><b>${summary?.score ?? "–"}</b><span>/100</span></div>
        <div class="stack">
          <h2>Өнөөдрийн эрүүл мэнд</h2>
          <div class="parts">${(summary?.parts || [])
            .map((part) => `<div><span class="muted">${esc(part.label)}</span>${meter(part.pct)}<b>${part.pct}%</b></div>`)
            .join("")}</div>
          ${tips}
        </div>
      </div>`;
  const sleep = `
        <form class="panel stack" data-form="sleep">
          <h2>Нойр</h2>
          <div class="row">
            <label>Унтсан<input name="start" type="time" value="${esc(live.sleep?.start || "23:00")}" /></label>
            <label>Сэрсэн<input name="end" type="time" value="${esc(live.sleep?.end || "07:00")}" /></label>
          </div>
          <label>Цагны нойрны оноо, байвал<input name="score" type="number" min="0" max="100" placeholder="хоосон" /></label>
          <button class="primary" type="submit">Өнөөдрийн нойр хадгалах</button>
          ${energy ? `<p><b>${bandLabel(energy.band)}</b> · оноо ${energy.score} · ${minutesLabel(energy.durationMin)}</p><p>${esc(energy.advice)}</p>` : ""}
          <div class="debt${debt.debtMin >= 60 ? " is-owed" : ""}">
            <div><small>7 хоногийн нойрны өр</small><b>${debt.nights ? minutesLabel(debt.debtMin) : "–"}</b></div>
            <div><small>Дундаж</small><b>${debt.nights ? minutesLabel(debt.avgMin) : "–"}</b></div>
            <div><small>Бүртгэсэн</small><b>${debt.nights}/7</b></div>
          </div>
          ${debt.advice ? `<p class="muted">${esc(debt.advice)}</p>` : ""}
        </form>`;
  const move = `
        <form class="panel stack" data-form="activity">
          <h2>Хөдөлгөөн${ctx.days[ctx.today]?.phone ? ` <small>утаснаас · ${esc(timeLabel(ctx.days[ctx.today].phone.at))}</small>` : ""}</h2>
          <p><b>${health?.steps ?? 0}</b> / ${health?.stepGoal ?? 8000} алхам</p>
          ${meter(health ? (health.steps / health.stepGoal) * 100 : 0)}
          <div class="row">
            <button class="chip" type="button" data-action="steps" data-add="1000">+1000</button>
            <button class="chip" type="button" data-action="steps" data-add="2500">+2500</button>
            <input name="steps" type="number" min="0" max="100000" placeholder="Нийт алхам" class="short" />
            <button class="chip" type="submit">Тохируулах</button>
          </div>
          <p><b>${health?.activeMin ?? 0}</b> / ${health?.activeGoal ?? 30} идэвхтэй минут</p>
          ${meter(health ? (health.activeMin / health.activeGoal) * 100 : 0)}
          <div class="row">
            <button class="chip" type="button" data-action="active" data-min="10">+10 мин</button>
            <button class="chip" type="button" data-action="active" data-min="30">+30 мин</button>
          </div>
        </form>`;
  const heart = `
        <form class="panel stack" data-form="vitals">
          <h2>Даралт ба зүрх</h2>
          ${bp.alert ? `<div class="hl-alert" role="alert">${icon("warn")}<div><b>Эмчид үзүүлээрэй</b><small>Сүүлийн ${bp.highStreak} хэмжилт дараалан 140/90 ба түүнээс дээш гарсан. Ойрын хугацаанд эмчид үзүүлж, даралтаа хянуулаарай.</small></div></div>` : ""}
          ${vitals?.bp ? `<p class="tone-${TONE[vitals.bp.band]}"><b>${vitals.bp.sys}/${vitals.bp.dia}</b> мм МУБ · ${esc(vitals.bp.label)}</p><p class="muted">${esc(vitals.bp.advice)}</p>` : `<p class="muted">Даралт оруулаагүй байна.</p>`}
          ${bp.avg7 ? `<p>7 хоногийн дундаж <b>${bp.avg7.sys}/${bp.avg7.dia}</b> · ${bp.avg7.n} хэмжилт</p>` : ""}
          ${vitals?.hr ? `<p class="tone-${TONE[vitals.hr.band]}"><b>${vitals.hr.bpm}</b> цохилт/мин · ${esc(vitals.hr.label)}</p>` : ""}
          <div class="row">
            <input name="sys" type="number" min="70" max="260" placeholder="Дээд" class="short" />
            <span class="muted">/</span>
            <input name="dia" type="number" min="40" max="160" placeholder="Доод" class="short" />
            <input name="hr" type="number" min="30" max="220" placeholder="Цохилт" class="short" />
            <button class="chip" type="submit">Хадгалах</button>
          </div>
          ${history}
        </form>`;
  const body = `
        <form class="panel stack" data-form="body">
          <h2>Биеийн жин</h2>
          ${health?.bmi ? `<p class="tone-${TONE[health.bmi.band]}">BMI <b>${health.bmi.value}</b> · ${esc(health.bmi.label)}</p>` : `<p class="muted">BMI тооцохын тулд жин, өндрөө оруулна уу.</p>`}
          <div class="row">
            <label>Жин, кг<input name="weightKg" type="number" min="35" max="220" step="0.1" value="${esc(live.wellness.weightKg ?? "")}" class="short" /></label>
            <label>Өндөр, см<input name="heightCm" type="number" min="120" max="230" value="${esc(live.wellness.heightCm ?? "")}" class="short" /></label>
          </div>
          <button class="chip" type="submit">Хадгалах</button>        </form>`;
  const airPanel = `
        <div class="panel stack">
          <h2>Агаар ба цаг агаар</h2>
          ${air ? `<p class="tone-${TONE[air.band]}">Агаарын чанар <b>${esc(air.label)}</b> · AQI ${air.aqi}</p><p class="muted">PM2.5 ${air.pm25 ?? "–"} µg/м³ · PM10 ${air.pm10 ?? "–"} µg/м³</p><p>${esc(air.advice)}</p>${air.uvAdvice ? `<p>UV ${air.uv?.toFixed(1)} · ${esc(air.uvAdvice)}</p>` : ""}` : `<p class="muted">Агаарын чанарын мэдээлэл ачаалж байна.</p>`}
          ${health?.climate ? `<p class="tone-${TONE[health.climate.band] || "good"}">${esc(health.climate.text)}</p>` : ""}        </div>`;
  const sections = {
    today: top,
    watch: watchPanel(ctx),
    shift: healthShift(ctx),
    trends: healthTrends(ctx, live),
    food: foodPanel(ctx, live),
    sleep,
    move,
    heart,
    body,
    mood: moodPanel(ctx, live),
    breath: breathPanel(),
    air: airPanel,
  };
  if (document.documentElement.classList.contains("is-app")) return healthTabs(sections);
  const { today, watch, shift, trends, ...grid } = sections;
  return `
    <div class="health">
      ${today}${watch}${shift}${trends}
      <div class="health-grid">${Object.values(grid).join("")}</div>
    </div>`;
}

const HEALTH_TABS = [
  ["today", "Өнөөдөр", "gauge"],
  ["watch", "Ухаалаг цаг", "watch"],
  ["shift", "Зөвлөгөө", "work"],
  ["trends", "Хяналт", "chart"],
  ["food", "Хоол", "meal"],
  ["sleep", "Нойр", "moon"],
  ["move", "Хөдөлгөөн", "steps"],
  ["heart", "Даралт, зүрх", "heart"],
  ["body", "Жин", "scale"],
  ["mood", "Сэтгэл санаа", "smile"],
  ["breath", "Амьсгал", "lungs"],
  ["air", "Агаар", "partly"],
];

function healthTabs(sections) {
  const active = sections[state.healthSec] ? state.healthSec : "today";
  const tabs = HEALTH_TABS.map(
    ([key, label, name]) => `<button type="button" role="tab" class="hsec-tab${key === active ? " is-on" : ""}" aria-selected="${key === active}" data-action="hsec" data-sec="${key}">
        <span class="hsec-ico">${icon(name)}</span><span>${label}</span>
      </button>`,
  ).join("");
  const panes = HEALTH_TABS.map(([key]) => `<div class="hsec${key === active ? " is-on" : ""}" role="tabpanel" data-hsec="${key}">${sections[key]}</div>`).join("");
  return `
    <div class="health is-tabbed">
      <nav class="hsec-bar" role="tablist" aria-label="Эрүүл мэндийн ангилал">${tabs}</nav>
      <div class="hsec-stage health-grid">${panes}</div>
    </div>`;
}

function centerHealthTab(smooth) {
  const bar = stage.querySelector(".hsec-bar");
  const tab = bar?.querySelector(".hsec-tab.is-on");
  if (!tab) return;
  const left = tab.offsetLeft - (bar.clientWidth - tab.offsetWidth) / 2;
  bar.scrollTo({ left: Math.max(0, left), behavior: smooth ? "smooth" : "instant" });
}

function switchHealthTab(button) {
  const key = button.dataset.sec;
  if (key === state.healthSec || (!state.healthSec && key === "today")) return;
  const order = HEALTH_TABS.map(([name]) => name);
  const back = order.indexOf(key) < order.indexOf(state.healthSec || "today");
  state.healthSec = key;
  for (const tab of stage.querySelectorAll(".hsec-tab")) {
    const on = tab === button;
    tab.classList.toggle("is-on", on);
    tab.setAttribute("aria-selected", String(on));
  }
  centerHealthTab(true);
  for (const pane of stage.querySelectorAll(".hsec")) {
    const on = pane.dataset.hsec === key;
    pane.classList.remove("is-enter", "from-left");
    pane.classList.toggle("is-on", on);
    if (!on) continue;
    void pane.offsetWidth;
    pane.classList.add("is-enter");
    if (back) pane.classList.add("from-left");
  }
}

function voiceSupport() {
  return state.live?.providers?.voice || { tts: [], stt: [] };
}

const RK_NOTHING = "Юу ч сонсогдсонгүй. Дахиад хэлнэ үү.";
const RK_SORRY = "Уучлаарай. Сайн ойлгосонгүй. Дахиад хэлнэ үү. Эсвэл бичиж өгнө үү.";

function askView() {
  const rk = state.rk;
  return `
    <div class="rk ${rk.mode ? `rk-${rk.mode}` : ""}">
      <button type="button" class="rk-core" data-action="rk-mic" aria-label="Red King-ээс дуугаар асуух"><canvas id="rk-core" aria-hidden="true"></canvas></button>
      <form class="rk-write${rk.write ? " open" : ""}" data-form="rk-write" autocomplete="off"${rk.write ? "" : " inert"}>
        <input name="q" maxlength="1000" placeholder="Red King-д бичих…" aria-label="Red King-д бичих" />
        <button type="submit" class="rk-send" aria-label="Илгээх"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button>
      </form>
      <p id="rk-status" class="rk-status" role="status"${rk.status ? "" : " hidden"}>${esc(rk.status)}</p>
    </div>`;
}

function rkWrite(open) {
  state.rk.write = open;
  const form = document.querySelector(".rk-write");
  if (!form) return;
  form.classList.toggle("open", open);
  form.inert = !open;
  if (open) setTimeout(() => state.rk.write && form.querySelector("input")?.focus({ preventScroll: true }), 450);
  else form.querySelector("input")?.blur();
}

function rkUnclear() {
  rkWrite(true);
  rkStatus("", "thinking");
  rkSpeak(RK_SORRY);
}

function rkStatus(text, mode = state.rk.mode) {
  state.rk.status = text;
  state.rk.mode = mode;
  const node = document.querySelector("#rk-status");
  if (node) {
    node.textContent = text;
    node.hidden = !text;
  }
  document.querySelector(".rk")?.classList.remove("rk-listening", "rk-thinking", "rk-speaking");
  if (mode) document.querySelector(".rk")?.classList.add(`rk-${mode}`);
  state.rkCore?.setMode(mode || "idle");
}

function rkSpeak(text) {
  speak(text, {
    serverTts: voiceSupport().tts.length > 0,
    onStart: (source) => rkStatus(source === "fallback" ? "Монгол хоолой суугаагүй тул ойролцоо дуудлагаар уншиж байна." : "", "speaking"),
    onEnd: () => rkStatus("", null),
    onLevel: (level) => state.rkCore?.setLevel(level),
    onError: (message) => rkStatus(message.startsWith("Монгол хоолой") ? message : `Дуу гаргах: ${message}`, null),
  });
}

async function askRedKing(message) {
  rkStatus("", "thinking");
  try {
    state.live = await api("/api/ask", { method: "POST", body: JSON.stringify({ message, provider: "auto" }) });
    if (state.view !== "ask") {
      state.rk = { status: "", mode: null };
      return;
    }
    const last = state.live.messages.at(-1);
    const reply = last?.answers?.find((item) => !item.error)?.text || last?.text;
    rkWrite(Boolean(last?.unclear));
    if (reply) rkSpeak(reply);
    else rkStatus("Хариу ирсэнгүй.", null);
  } catch (error) {
    rkStatus(error.message, null);
  }
}

function voiceError(code) {
  const map = {
    "not-allowed": "Микрофоны зөвшөөрөл өгөгдөөгүй байна.",
    "audio-capture": "Микрофон олдсонгүй.",
    network: "Хөтчийн дуу таних үйлчилгээ холбогдсонгүй. Chrome эсвэл Edge-ээр нээх, эсвэл OPENAI_API_KEY / GEMINI_API_KEY нэмнэ үү.",
    "language-not-supported": "Энэ хөтөч монгол яриа танихгүй байна. Chrome ашиглах эсвэл OPENAI_API_KEY / GEMINI_API_KEY нэмнэ үү.",
    "service-not-allowed": "Хөтөч дуу таних үйлчилгээг хаасан байна.",
    unsupported: "Энэ хөтөч дуу таних боломжгүй. Chrome/Edge ашиглах эсвэл OPENAI_API_KEY / GEMINI_API_KEY нэмнэ үү.",
  };
  return map[code] || `Дуу таних: ${code}`;
}

const RK_LISTENING = "Сонсож байна… Асуултаа хэлээд цөмийг дахин дарна уу.";

function rkMic() {
  primeAudio();
  if (isListening()) {
    rkStatus("", "thinking");
    stopListening();
    return;
  }
  if (state.rk.mode === "speaking") {
    stopSpeaking();
    rkStatus("", null);
    return;
  }
  if (state.rk.mode === "thinking") return;
  stopSpeaking();
  rkWrite(false);
  rkStatus(RK_LISTENING, "listening");
  let settled = false;
  const here = () => state.view === "ask";
  listen(
    {
      onInterim: () => {},
      onFallback: () => rkStatus(RK_LISTENING, "listening"),
      onFinal: (text) => {
        settled = true;
        askRedKing(text);
      },
      onUnclear: () => {
        settled = true;
        if (here()) rkUnclear();
      },
      onError: (code) => {
        settled = true;
        rkStatus(voiceError(code), null);
      },
      onEnd: () => {
        if (settled || !here()) return;
        rkStatus("", "thinking");
        rkSpeak(RK_NOTHING);
      },
    },
    { serverStt: voiceSupport().stt.length > 0, manual: true },
  );
}

const PROFILE_ICONS = {
  shield: `<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.4-7.5 9.5-4.3-1.1-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.4-4.6"/>`,
  flip: `<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 20v-4.5h4.5"/>`,
};
const CARD_STATUSES = ["ACTIVE", "SUSPENDED", "REVOKED"];

function flipHint() {
  return `<p class="muted idcard-hint"><svg viewBox="0 0 24 24" aria-hidden="true">${PROFILE_ICONS.flip}</svg>Карт дээр дарж нөгөө талыг харна</p>`;
}

function roleBadge(role) {
  return `<span class="role-badge${role === "admin" ? " is-admin" : role === "whiteking" ? " is-wk" : role === "hr" ? " is-hr" : role === "kitchen" ? " is-kitchen" : ""}">${ROLE_LABEL[role] || role}</span>`;
}

function statusBadge(status) {
  return `<span class="role-badge${status === "ACTIVE" ? "" : " is-blocked"}">${esc(status)}</span>`;
}

function options(values, current, label = (value) => value) {
  return values.map((value) => `<option value="${esc(value)}"${String(value) === String(current) ? " selected" : ""}>${esc(label(value))}</option>`).join("");
}

function meForm(user) {
  return `<form class="panel stack" data-form="me">
      <h2>Хувийн мэдээлэл</h2>
      <label>Нэр (картан дээр гарна)<input name="displayName" maxlength="40" required value="${esc(user.displayName)}" /></label>
      <label>Албан тушаал<input name="title" maxlength="60" value="${esc(user.title)}" /></label>
      <label>И-мэйл<input name="email" type="email" maxlength="80" value="${esc(user.email)}" /></label>
      <button class="primary" type="submit">Хадгалах</button>
    </form>`;
}

function passwordForm() {
  return `<form class="panel stack" data-form="password">
      <h2>Нууц үг солих</h2>
      <label>Одоогийн нууц үг<input name="current" type="password" autocomplete="current-password" required /></label>
      <label>Шинэ нууц үг<input name="next" type="password" autocomplete="new-password" minlength="6" required /></label>
      <label>Шинэ нууц үг давтах<input name="confirm" type="password" autocomplete="new-password" minlength="6" required /></label>
      <button class="chip" type="submit">Солих</button>
    </form>`;
}

function userProfileView() {
  const me = state.me;
  const card = me.card;
  return `
    <div class="profile">
      <section class="panel profile-card-panel">
        <h2>Umbrella ID карт</h2>
        ${idCard(me, { flipped: state.flipped.has(me.id) })}
        ${flipHint()}
      </section>
      <div class="stack">
        <section class="panel profile-head">
          <h2>Миний бүртгэл</h2>
          ${avatar(me, "profile-avatar")}
          <div class="profile-who">
            <b>${esc(me.displayName)}</b>
            <span>@${esc(me.username)}${me.title ? ` · ${esc(me.title)}` : ""}</span><br />
            ${roleBadge(me.role)}
          </div>
          <dl class="facts">
            <div><dt>Нэвтрэх нэр</dt><dd class="mono">${esc(me.loginCode || "–")}</dd></div>
            <div><dt>Зэрэглэл</dt><dd>Level ${card.clearance}</dd></div>
            <div><dt>Төлөв</dt><dd>${esc(card.status)}</dd></div>
            <div><dt>Ангилал</dt><dd>${esc(card.classification)}</dd></div>
            <div><dt>Карт хүчинтэй</dt><dd>${esc(card.expires)}</dd></div>
          </dl>
          <p class="muted profile-note">Нэр, албан тушаал, и-мэйл, зураг болон картын мэдээллийг зөвхөн админ өөрчилнө.</p>
        </section>
        ${appLinkPanel()}
        ${passwordForm()}
      </div>
    </div>`;
}

function isoDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || ""));
  return match ? `${match[3]}-${match[1]}-${match[2]}` : "";
}

function cardDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  return match ? `${match[2]}/${match[3]}/${match[1]}` : "";
}

function createdDate(user) {
  const date = user.createdAt ? new Date(user.createdAt) : new Date();
  const two = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

function templateTexts(level) {
  return state.admin?.cardTemplates?.[level] || {};
}

function templateFields(texts) {
  const field = (item) => {
    const value = esc(texts[item.key] || item.value);
    const attrs = `name="t.${item.key}" maxlength="${item.max}" placeholder="${esc(item.value)}"`;
    return item.long
      ? `<label class="wide">${esc(item.label)}<textarea ${attrs} rows="4">${value}</textarea></label>`
      : `<label>${esc(item.label)}<input ${attrs} value="${value}" /></label>`;
  };
  const side = (name) => CARD_TEXTS.filter((item) => item.side === name).map(field).join("");
  return `<h3>Нүүр тал</h3>
      <div class="form-grid">${side("front")}</div>
      <h3>Ар тал</h3>
      <div class="form-grid">${side("back")}</div>`;
}

function templateData(form) {
  const data = new FormData(form);
  const texts = {};
  for (const item of CARD_TEXTS) {
    const value = String(data.get(`t.${item.key}`) ?? "").trim();
    if (value && value !== item.value) texts[item.key] = value;
  }
  return texts;
}

function sampleUser(level, texts = templateTexts(level)) {
  return {
    id: `tpl-${level}`,
    displayName: "Нэр Овог",
    createdAt: new Date().toISOString(),
    card: {
      classification: "АЖИЛТАН",
      project: "UMBRELLA ХӨТӨЛБӨР",
      idNumber: `000${level}-LV0${level}`,
      status: "ACTIVE",
      clearance: level,
      expires: "12/31/2030",
      texts,
    },
  };
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newLoginCode() {
  const taken = new Set((state.admin?.users || []).map((user) => user.loginCode));
  for (;;) {
    const code = [...crypto.getRandomValues(new Uint32Array(4))].map((value) => CODE_CHARS[value % CODE_CHARS.length]).join("");
    if (/[A-Z]/.test(code) && /\d/.test(code) && !taken.has(code)) return code;
  }
}

function adminCardData(form) {
  const data = Object.fromEntries(new FormData(form));
  data.expires = cardDate(data.expires);
  data.issued = cardDate(data.issued);
  if (!data.password) delete data.password;
  return data;
}

function adminPreview(form) {
  const user = state.admin?.users.find((item) => item.id === form.dataset.id);
  const node = stage.querySelector("#admin-editor .idcard");
  if (!user || !node) return;
  const data = adminCardData(form);
  const card = {
    ...user.card,
    classification: String(data.classification || "").toUpperCase(),
    project: String(data.project || "").toUpperCase(),
    idNumber: String(data.idNumber || "").toUpperCase(),
    status: data.status,
    clearance: Number(data.clearance),
    expires: data.expires || user.card.expires,
    issued: data.issued || undefined,
    signature: data.signature || undefined,
    texts: templateTexts(data.clearance),
  };
  node.outerHTML = idCard({ ...user, displayName: data.displayName || user.displayName, card }, { flipped: node.classList.contains("is-flipped") });
}

function adminEditor(user) {
  const card = user.card;
  return `<section class="panel admin-editor" id="admin-editor">
      <div class="stack">
        <h2>${esc(user.displayName)} · ID карт</h2>
        ${idCard(user, { flipped: state.flipped.has(user.id) })}
        ${flipHint()}
        <div class="row card-export">
          <span class="muted">${adminIcon("download")}Татах</span>
          <button class="chip" type="button" data-action="card-export" data-format="png" data-id="${esc(user.id)}" title="Харагдаж буй талыг PNG-ээр">PNG</button>
          <button class="chip" type="button" data-action="card-export" data-format="jpg" data-id="${esc(user.id)}" title="Харагдаж буй талыг JPG-ээр">JPG</button>
          <button class="chip" type="button" data-action="card-export" data-format="pdf" data-id="${esc(user.id)}" title="Нүүр, ар хоёр тал, картын бодит хэмжээгээр">PDF</button>
        </div>
        <div class="row admin-photo">
          <span class="chip photo-pick">Зураг солих<input type="file" accept="image/jpeg,image/png,image/webp" data-admin-photo="${esc(user.id)}" aria-label="Картын зураг солих" /></span>
          ${user.photo ? `<button class="ghost" type="button" data-action="admin-photo-remove" data-id="${esc(user.id)}">Зураг устгах</button>` : ""}
        </div>
      </div>
      <form class="stack" data-form="admin-user" data-id="${esc(user.id)}">
        <h2>Хэрэглэгч засах · @${esc(user.username)}</h2>
        <div class="form-grid">
          <label class="wide">Нэвтрэх нэр
            <span class="code-field">
              <input class="code-input" name="loginCode" pattern="[A-Za-z0-9]{4}" minlength="4" maxlength="4" autocomplete="off" spellcheck="false" required value="${esc(user.loginCode || "")}" />
              <button class="chip" type="button" data-action="code-new">Шинэ код</button>
            </span>
          </label>
          <label class="wide">Нэр (картан дээр гарна)<input name="displayName" maxlength="40" required value="${esc(user.displayName)}" /></label>
          <label>Албан тушаал<input name="title" maxlength="60" value="${esc(user.title)}" /></label>
          <label>И-мэйл<input name="email" type="email" maxlength="80" value="${esc(user.email)}" /></label>
          <label>Төрсөн өдөр<input name="birthday" type="date" max="${localDate(new Date().toISOString())}" value="${esc(user.birthday || "")}" /></label>
          <label>Эрх<select name="role">${options(ROLES, user.role, (value) => ROLE_LABEL[value])}</select></label>
          <label>Төлөв<select name="status">${options(CARD_STATUSES, card.status)}</select></label>
          <label>Ангилал<input name="classification" maxlength="32" required value="${esc(card.classification)}" /></label>
          <label>Төсөл<input name="project" maxlength="32" required value="${esc(card.project)}" /></label>
          <label>ID дугаар<input name="idNumber" pattern="[A-Za-z0-9\\-]{3,16}" maxlength="16" required value="${esc(card.idNumber)}" /></label>
          <label>Зэрэглэл<select name="clearance">${options([1, 2, 3, 4, 5], card.clearance, (value) => `Level ${value}`)}</select></label>
          <label>Олгосон огноо<input name="issued" type="date" value="${esc(isoDate(card.issued) || createdDate(user))}" /></label>
          <label>Хүчинтэй хугацаа<input name="expires" type="date" required value="${esc(isoDate(card.expires))}" /></label>
          <label class="wide">Гарын үсэг<input name="signature" maxlength="40" placeholder="${esc(user.displayName)}" value="${esc(card.signature || "")}" /></label>
        </div>
        <p class="muted profile-note">Нэвтрэх нэр нь үсэг, тоо холилдсон, хэрэглэгч бүрд давтагдашгүй 4 оронтой код. Картын бичвэр нь зэрэглэлийн загвараас автоматаар авагдана. SUSPENDED эсвэл REVOKED төлөвтэй хэрэглэгч нэвтэрч чадахгүй.</p>
        <div class="row">
          <button class="primary" type="submit">Хадгалах</button>
        </div>
      </form>
    </section>`;
}

const ADMIN_ICONS = {
  key: `<circle cx="8" cy="15.5" r="4.3"/><path d="M11.1 12.4L20 3.5M16.2 7.3l2.6 2.6M13.9 9.6l2.1 2.1"/>`,
  card: `<rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="8.5" cy="10.8" r="2.3"/><path d="M5 16.2a3.7 3.7 0 0 1 7 0M14.5 10h4.5M14.5 13.5h4.5"/>`,
  trash: `<path d="M4.5 6.5h15M9.5 6.5V4.5h5v2M6.5 6.5l1 13h9l1-13M10.5 10.5v5.5M13.5 10.5v5.5"/>`,
  edit: `<path d="M4.5 19.5h4l10.5-10.5-4-4L4.5 15.5z"/><path d="M13 7l4 4"/>`,
  qr: `<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M18.5 14h2"/>`,
  renew: `<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1L4.5 15"/><path d="M4.5 19.5V15H9"/><path d="M4.5 12a7.5 7.5 0 0 1 13-5.1L19.5 9"/><path d="M19.5 4.5V9H15"/>`,
  add: `<circle cx="10" cy="8" r="3.4"/><path d="M3.5 19.5a6.5 6.5 0 0 1 13 0"/><path d="M19 7.5v6M16 10.5h6"/>`,
  users: `<circle cx="9" cy="8" r="3.3"/><path d="M2.8 19.5a6.2 6.2 0 0 1 12.4 0"/><path d="M15.2 4.9a3.3 3.3 0 0 1 0 6.2M17.6 13.6a6.2 6.2 0 0 1 3.6 5.9"/>`,
  today: `<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8.5 15l2.3 2.3 4.7-4.6"/>`,
  in: `<path d="M10 4.5h7.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H10"/><path d="M3.5 12H14M10.5 8l4 4-4 4"/>`,
  out: `<path d="M14 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14"/><path d="M10 12h10M16.5 8l4 4-4 4"/>`,
  clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  back: `<path d="M19 12H5M11 6l-6 6 6 6"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>`,
  moon: `<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>`,
  rest: `<path d="M4 18.5h16M6 18.5v-6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v6M8.5 10.5V7.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v3"/>`,
  flame: `<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.1 0-3.4 2.6-5.3 3.6-8.9 2.4 1.3 3.4 3.4 3.4 5.4 1-.6 1.8-1.7 2.1-3 1.9 1.6 3.9 4 3.9 6.5 0 3.5-2.6 6.1-6.5 6.1z"/>`,
  warn: `<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 9.5v4.5M12 16.8v.2"/>`,
  download: `<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>`,
  print: `<path d="M7 9V3.5h10V9M7 17H4.5v-6.5a1.5 1.5 0 0 1 1.5-1.5h12a1.5 1.5 0 0 1 1.5 1.5V17H17"/><rect x="7" y="14" width="10" height="6.5" rx="1"/>`,
  check: `<path d="M5 12.5l4.5 4.5L19 7.5"/>`,
  cross: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
};

function adminIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ADMIN_ICONS[name]}</svg>`;
}

function adminHead(iconName, title, note) {
  return `<section class="panel admin-head">
      <div class="admin-shield">${adminIcon(iconName)}</div>
      <div class="profile-who"><b>${esc(title)}</b><span>${esc(note)}</span></div>
    </section>`;
}

function downloadCardQr(user) {
  const qr = window.qrcode(0, "M");
  qr.addData(user.cardQr);
  qr.make();
  const count = qr.getModuleCount();
  const cell = Math.floor(560 / (count + 8));
  const side = cell * (count + 8);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side + 120;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) if (qr.isDark(row, col)) ctx.fillRect((col + 4) * cell, (row + 4) * cell, cell, cell);
  }
  ctx.textAlign = "center";
  ctx.font = "700 30px system-ui, sans-serif";
  ctx.fillText(user.displayName, side / 2, side + 40);
  ctx.font = "22px system-ui, sans-serif";
  ctx.fillStyle = "#555";
  ctx.fillText(`ID ${user.card.idNumber} · Ирцийн QR`, side / 2, side + 80);
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = `${user.loginCode || user.username}-irts-qr.png`;
  link.click();
}

function adminLoading() {
  return `<section class="panel"><p class="muted">Ачаалж байна…</p></section>`;
}

function selectedUser() {
  const users = state.admin?.users || [];
  const user = users.find((item) => item.id === state.editUser) || users.find((item) => item.id === state.me.id) || users[0];
  state.editUser = user?.id || null;
  return user;
}

const searchFold = (text) =>
  String(text ?? "")
    .toLocaleLowerCase("mn")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

function userSearchKey(user) {
  return searchFold([user.displayName, user.card?.idNumber, user.loginCode, user.username].join(" "));
}

/** Every word of the query must appear in the name or ID; an ID typed without its dashes still matches. */
function userMatches(key, query) {
  const compact = key.replace(/ /g, "");
  return searchFold(query)
    .split(" ")
    .filter(Boolean)
    .every((token) => key.includes(token) || compact.includes(token));
}

/** Search words plus the clearance level and card status dropdowns. */
function userShown(key, level, status) {
  return (
    userMatches(key, state.userQuery) &&
    (!state.userLevel || String(level) === state.userLevel) &&
    (!state.userStatus || status === state.userStatus)
  );
}

function userFiltering() {
  return Boolean(state.userQuery?.trim() || state.userLevel || state.userStatus);
}

function userEmptyText() {
  const query = (state.userQuery || "").trim();
  return query ? `«${query}» — илэрц олдсонгүй.` : "Энэ ангилалд хэрэглэгч алга.";
}

function filterUsers() {
  const rows = [...document.querySelectorAll(".user-table tr[data-search]")];
  let shown = 0;
  for (const row of rows) {
    const hidden = !userShown(row.dataset.search, row.dataset.level, row.dataset.status);
    if (row.hidden && !hidden) {
      row.classList.remove("row-in");
      void row.offsetWidth;
      row.classList.add("row-in");
    }
    row.hidden = hidden;
    if (!hidden) shown += 1;
  }
  const empty = document.querySelector(".user-empty");
  if (empty) {
    empty.hidden = shown > 0;
    empty.cells[0].textContent = userEmptyText();
  }
  const count = document.querySelector(".user-count");
  if (count) count.textContent = userFiltering() ? `${shown} / ${rows.length}` : "";
}

function userFilterSelects(users) {
  const tally = (pick, value) => users.filter((user) => String(pick(user)) === String(value)).length;
  const levels = [1, 2, 3, 4, 5]
    .map((level) => `<option value="${level}"${state.userLevel === String(level) ? " selected" : ""}>Level ${level} (${tally((user) => user.card.clearance, level)})</option>`)
    .join("");
  const statuses = CARD_STATUSES.map(
    (status) => `<option value="${status}"${state.userStatus === status ? " selected" : ""}>${status} (${tally((user) => user.card.status, status)})</option>`,
  ).join("");
  return `
    <select class="user-filter" data-filter="users-level" aria-label="Зэрэглэлээр ангилах"><option value="">Бүх зэрэглэл</option>${levels}</select>
    <select class="user-filter" data-filter="users-status" aria-label="Төлөвөөр ангилах"><option value="">Бүх төлөв</option>${statuses}</select>`;
}

function adminUsersView() {
  const me = state.me;
  const data = state.admin;
  const people = data ? data.users.filter((user) => user.role !== "admin") : [];
  const stats = data && {
    total: people.length,
    active: people.filter((user) => user.card.status === "ACTIVE").length,
    blocked: people.filter((user) => user.card.status !== "ACTIVE").length,
    scansToday: data.stats.scansToday,
  };
  const stat = (value, label) => `<div><b>${value ?? "–"}</b><span>${label}</span></div>`;
  const query = state.userQuery || "";
  const visible = (user) => userShown(userSearchKey(user), user.card.clearance, user.card.status);
  const shown = people.filter(visible).length;
  const rows = data
    ? people
        .map(
          (user) => `<tr data-search="${esc(userSearchKey(user))}" data-level="${esc(user.card.clearance)}" data-status="${esc(user.card.status)}"${visible(user) ? "" : " hidden"}>
            <td><div class="who">${avatar(user)}<div><b>${esc(user.displayName)}</b><small><span class="code-tag" title="Нэвтрэх нэр">${esc(user.loginCode || "–")}</span> @${esc(user.username)}${user.id === me.id ? " · та" : ""}</small></div></div></td>
            <td>${roleBadge(user.role)}</td>
            <td class="mono">${esc(user.card.idNumber)}</td>
            <td><select class="inline-select lv-select lv-${user.card.clearance}" data-inline="clearance" data-id="${esc(user.id)}" aria-label="${esc(user.displayName)} · зэрэглэл">${options([1, 2, 3, 4, 5], user.card.clearance, (value) => `Level ${value}`)}</select></td>
            <td><select class="inline-select status-select is-${user.card.status.toLowerCase()}" data-inline="status" data-id="${esc(user.id)}" aria-label="${esc(user.displayName)} · төлөв">${options(CARD_STATUSES, user.card.status)}</select></td>
            <td class="muted">${esc(timeLabel(user.lastLoginAt) || "–")}</td>
            <td><div class="acts">
              <button class="icon-btn" type="button" data-action="admin-open" data-target="account" data-id="${esc(user.id)}" aria-label="Засах (нууц үг)" title="Засах (нууц үг)">${adminIcon("key")}</button>
              ${
                user.cardQr
                  ? `<button class="icon-btn" type="button" data-action="card-qr-download" data-id="${esc(user.id)}" aria-label="${esc(user.displayName)} · ирцийн QR татах" title="Ирцийн QR татах">${adminIcon("qr")}</button>
              <button class="icon-btn" type="button" data-action="card-qr-renew" data-id="${esc(user.id)}" aria-label="${esc(user.displayName)} · ирцийн QR шинэчлэх" title="Ирцийн QR шинэчлэх">${adminIcon("renew")}</button>`
                  : ""
              }
              <button class="icon-btn danger" type="button" data-action="admin-delete" data-id="${esc(user.id)}" aria-label="Устгах" title="Устгах"${user.id === me.id ? " disabled" : ""}>${adminIcon("trash")}</button>
            </div></td>
          </tr>`,
        )
        .join("") + `<tr class="user-empty"${shown ? " hidden" : ""}><td colspan="7" class="muted">${esc(userEmptyText())}</td></tr>`
    : `<tr><td colspan="7" class="muted">Ачаалж байна…</td></tr>`;
  return `
    <div class="admin-page">
      <section class="panel admin-hero">
        <div class="admin-shield">${adminIcon("users")}</div>
        <div class="profile-who">
          <b>Бүх хэрэглэгч</b>
          <span>Зэрэглэл, төлөвийг хүснэгтээс шууд солино. Бусад мэдээллийг түлхүүр товчоор засна.</span>
        </div>
        <div class="admin-stats users-stats">
          ${stat(stats?.total, "Нийт хэрэглэгч")}
          ${stat(stats?.active, "Идэвхтэй")}
          ${stat(stats?.blocked, "Түдгэлзсэн")}
          ${stat(stats?.scansToday, "Өнөөдрийн ирц")}
        </div>
      </section>
      <section class="panel admin-users">
        <div class="admin-users-head">
          <h2>Хэрэглэгчид</h2>
          <div class="user-filters">
            <label class="user-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
              <input type="search" data-filter="users" value="${esc(query)}" placeholder="ID дугаар, овог нэрээр хайх" aria-label="Хэрэглэгч хайх: ID дугаар эсвэл овог нэр" autocomplete="off" spellcheck="false" />
              <span class="user-count" aria-live="polite">${data && userFiltering() ? `${shown} / ${people.length}` : ""}</span>
            </label>
            ${data ? userFilterSelects(people) : ""}
          </div>
          <button class="chip" type="button" data-action="create-user" aria-haspopup="dialog">${adminIcon("add")}Шинэ хэрэглэгч</button>
        </div>
        <table class="user-table">
          <thead><tr><th>Хэрэглэгч · нэвтрэх нэр</th><th>Эрх</th><th>ID дугаар</th><th>Зэрэглэл</th><th>Төлөв</th><th>Сүүлд нэвтэрсэн</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    </div>`;
}

function adminAccountView() {
  if (!state.admin) return adminLoading();
  const user = selectedUser();
  if (!user) return adminLoading();
  const self = user.id === state.me.id;
  const password = self
    ? `<section class="panel stack">
        <h2>Нууц үг</h2>
        <p class="muted">Өөрийн нууц үгийг профайл хэсгээс одоогийн нууц үгээ оруулж солино.</p>
        <button class="chip" type="button" data-action="goto" data-target="profile">Профайл руу очих</button>
      </section>`
    : `<form class="panel stack" data-form="admin-password" data-id="${esc(user.id)}">
        <h2>Нууц үг шинэчлэх</h2>
        <label>Шинэ нууц үг<input name="password" type="password" autocomplete="new-password" minlength="6" required /></label>
        <label>Шинэ нууц үг давтах<input name="confirm" type="password" autocomplete="new-password" minlength="6" required /></label>
        <p class="muted profile-note">Солигдсоны дараа хэрэглэгчийн одоогийн нэвтрэлт хүчингүй болно.</p>
        <button class="primary" type="submit">Нууц үг солих</button>
      </form>`;
  return `
    <div class="admin-page">
      <section class="panel admin-head">
        <div class="admin-shield">${adminIcon("key")}</div>
        <div class="profile-who"><b>${esc(user.displayName)} · @${esc(user.username)}</b><span>Нэр, зэрэглэл, картын мэдээлэл, зураг, эрх болон нууц үг</span></div>
        <button class="chip admin-back" type="button" data-action="goto" data-target="users">${adminIcon("back")}Бүх хэрэглэгч</button>
      </section>
      ${adminEditor(user)}
      ${password}
    </div>`;
}

function adminCardView() {
  if (!state.admin) return adminLoading();
  const level = state.cardLevel;
  const texts = templateTexts(level);
  const counts = (lv) => state.admin.users.filter((user) => Number(user.card.clearance) === lv).length;
  const thumbs = [5, 4, 3, 2, 1]
    .map(
      (lv) => `<button type="button" class="tpl-thumb${lv === level ? " on" : ""}" data-action="tpl-pick" data-level="${lv}" aria-pressed="${lv === level}">
        <div class="tpl-card" inert>${idCard(sampleUser(lv))}</div>
        <span><b>Түвшин ${lv}</b><small>${counts(lv)} хэрэглэгч${Object.keys(templateTexts(lv)).length ? " · өөрчилсөн" : ""}</small></span>
      </button>`,
    )
    .join("");
  return `
    <div class="admin-page">
      ${adminHead("card", "Карт засах", "Түвшин бүрийн картын үндсэн бичвэрүүд. Тухайн зэрэглэлийн бүх хэрэглэгчийн картад шууд үйлчилнэ.")}
      <section class="panel tpl-grid" aria-label="Түвшний картууд">${thumbs}</section>
      <section class="panel admin-editor tpl-editor">
        <div class="stack">
          <h2>Түвшин ${level} · урьдчилан харах</h2>
          <div id="tpl-preview">${idCard(sampleUser(level), { flipped: state.flipped.has(`tpl-${level}`) })}</div>
          ${flipHint()}
        </div>
        <form class="stack card-texts" data-form="card-template" data-level="${level}">
          <h2>Түвшин ${level} · картын бичвэрүүд</h2>
          ${templateFields(texts)}
          <div class="row">
            <button class="primary" type="submit">Хадгалах</button>
            <button class="ghost" type="button" data-action="card-texts-reset">Анхны бичвэр рүү буцаах</button>
          </div>
        </form>
      </section>
    </div>`;
}

function templatePreview(form) {
  const level = Number(form.dataset.level);
  const user = sampleUser(level, templateData(form));
  const node = stage.querySelector("#tpl-preview .idcard");
  if (node) node.outerHTML = idCard(user, { flipped: node.classList.contains("is-flipped") });
  const thumb = stage.querySelector(`.tpl-thumb[data-level="${level}"] .tpl-card`);
  if (thumb) thumb.innerHTML = idCard(user);
}

function adminCreateForm() {
  return `
      <form class="stack admin-create" data-form="admin-create" autocomplete="off">
        <div class="form-grid">
          <label>Хэрэглэгчийн нэр (@)<input name="username" pattern="[a-zA-Z0-9._\\-]{3,24}" autocomplete="off" required /></label>
          <label>Нууц үг<input name="password" type="password" minlength="6" autocomplete="new-password" required /></label>
          <label>Нэр<input name="displayName" maxlength="40" required /></label>
          <label>Албан тушаал<input name="title" maxlength="60" /></label>
          <label>И-мэйл<input name="email" type="email" maxlength="80" /></label>
          <label>Төрсөн өдөр<input name="birthday" type="date" max="${localDate(new Date().toISOString())}" /></label>
          <label>Эрх<select name="role">${options(ROLES, "user", (value) => ROLE_LABEL[value])}</select></label>
          <label>Ангилал<input name="classification" maxlength="32" value="АЖИЛТАН" required /></label>
          <label>Төсөл<input name="project" maxlength="32" value="UMBRELLA ХӨТӨЛБӨР" required /></label>
          <label>Зэрэглэл<select name="clearance">${options([1, 2, 3, 4, 5], 1, (value) => `Level ${value}`)}</select></label>
        </div>
        <div class="modal-actions">
          <button class="chip" type="button" data-close>Болих</button>
          <button class="primary" type="submit">${adminIcon("add")}Нэмэх</button>
        </div>
      </form>`;
}

const MODAL_MS = 240;

/** Opens a popup card over the page; `title` and `sub` are HTML. Returns null if one is already open. */
function openModal({ shield, title, sub, body, className = "" }) {
  if (document.querySelector(".modal")) return null;
  const wrap = document.createElement("div");
  wrap.className = `modal${className ? ` ${className}` : ""}`;
  wrap.innerHTML = `
    <div class="modal-backdrop" data-close></div>
    <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header class="modal-head">
        <div class="admin-shield">${shield}</div>
        <div class="profile-who"><b id="modal-title">${title}</b><span>${sub}</span></div>
        <button class="icon-btn modal-x" type="button" data-close aria-label="Хаах">${icon("cross")}</button>
      </header>
      <div class="modal-body">${body}</div>
    </div>`;
  state.modalReturn = document.activeElement;
  document.body.append(wrap);
  document.body.classList.add("has-modal");
  wrap.addEventListener("click", (event) => {
    if (event.target.closest("[data-close]")) closeModal();
  });
  wrap.addEventListener("keydown", modalKeys);
  requestAnimationFrame(() => wrap.classList.add("is-open"));
  return wrap;
}

function openCreateUser() {
  const wrap = openModal({ shield: adminIcon("add"), title: "Шинэ хэрэглэгч нэмэх", sub: "Нэмсний дараа хэрэглэгчийн засвар руу шилжинэ", body: adminCreateForm() });
  if (!wrap) return;
  const form = wrap.querySelector("form");
  form.addEventListener("submit", createUserSubmit);
  form.addEventListener("input", () => (form.dataset.dirty = "1"), { once: true });
  requestAnimationFrame(() => form.elements.username.focus({ preventScroll: true }));
}

/** Closes the popup; asks first if the admin already typed something, unless the user was just created. */
function closeModal(force = false) {
  const wrap = document.querySelector(".modal");
  if (!wrap || wrap.classList.contains("is-closing")) return;
  if (!force && wrap.querySelector("form")?.dataset.dirty && !confirm("Оруулсан мэдээлэл хадгалагдахгүй. Цонхыг хаах уу?")) return;
  wrap.classList.remove("is-open");
  wrap.classList.add("is-closing");
  setTimeout(() => {
    wrap.remove();
    document.body.classList.remove("has-modal");
    if (state.modalReturn?.isConnected) state.modalReturn.focus({ preventScroll: true });
    state.modalReturn = null;
  }, MODAL_MS);
}

function modalKeys(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key !== "Tab") return;
  const items = [...event.currentTarget.querySelectorAll(".modal-card :is(input, select, button, textarea):not([disabled])")];
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function createUserSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  form.querySelector(".form-error")?.remove();
  button.disabled = true;
  try {
    const result = await api("/api/admin/users", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    state.admin = result;
    const created = result.users.at(-1);
    state.editUser = created?.id || null;
    state.view = "account";
    closeModal(true);
    render();
    flash(`[data-form="admin-user"]`, `Хэрэглэгч нэмэгдлээ. Нэвтрэх нэр: ${created?.loginCode || "–"}`);
  } catch (error) {
    form.querySelector(".modal-actions").insertAdjacentHTML("beforebegin", `<p class="form-error" role="alert">${esc(error.message)}</p>`);
    button.disabled = false;
  }
}

const SHIFT_LABEL = { day: "Өдрийн ээлж", night: "Шөнийн ээлж" };
const SHIFTS = ["day", "night"];
const DAY_MS = 24 * 3600 * 1000;
const EARLY_IN_MS = 3 * 3600 * 1000;
const HISTORY_DAYS = 30;
const HISTORY_PREVIEW = 5;
const HISTORY_LIMIT = 400;
const CREW_STATE = {
  in: ["Ажил дээр", "is-in"],
  out: ["Гарсан", "is-out"],
  upcoming: ["Хүлээгдэж байна", ""],
  missing: ["Ирээгүй", "is-absent"],
  absent: ["Тасалсан", "is-absent"],
  leave: ["Чөлөөтэй", "is-leave"],
};
const CREW_ORDER = { in: 0, out: 1, missing: 2, absent: 2, upcoming: 3, leave: 4 };
const HISTORY_STATUS = {
  ontime: ["Цагтаа", (record) => record.status === "ontime"],
  late: ["Хоцорсон", (record) => record.late > 0],
  early: ["Эрт гарсан", (record) => record.early > 0],
  absent: ["Ирээгүй", (record) => record.status === "absent" || record.status === "missing"],
  leave: ["Чөлөөтэй", (record) => record.status === "leave"],
  extra: ["Илүү цаг", (record) => record.status === "extra"],
  forgot: ["Гаралт бүртгээгүй", (record) => record.forgot],
};

function clockLabel(time) {
  return time ? new Date(time).toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "–";
}

function stampLabel(time) {
  return time ? `${localDate(new Date(time).toISOString())} ${clockLabel(time)}` : "";
}

function spanLabel(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ц ${minutes % 60} мин` : `${minutes} мин`;
}

function daysAgo(today, date) {
  const back = Math.round((Date.parse(today) - Date.parse(date)) / DAY_MS);
  return back === 0 ? "Өнөөдөр" : back === 1 ? "Өчигдөр" : `${back} хоногийн өмнө`;
}

function shiftDateLabel(date, kind) {
  return `${shortDate(date)} ${WEEKDAY_SHORT[weekdayOf(date)]} · ${PLAN_HOURS[kind]}`;
}

/** The shift running now and the one after it, read from the clock so the board rolls over on time. */
function liveShifts(now = Date.now()) {
  const date = shiftDateOf(now);
  const kind = now < shiftSpan(date, "day").end ? "day" : "night";
  const next = kind === "day" ? { date, kind: "night" } : { date: addDays(date, 1), kind: "day" };
  return [
    { date, kind, ...shiftSpan(date, kind) },
    { ...next, ...shiftSpan(next.date, next.kind) },
  ];
}

function crewPeople(data, users, now) {
  return users.map((user) => ({ user, week: weekOf(data, user), sessions: sessionsOf(data.events, user.id, now) }));
}

function sessionKind(session, date) {
  return session.start + EARLY_IN_MS >= shiftSpan(date, "night").start ? "night" : "day";
}

/**
 * Everyone planned for a date's shifts (including those on leave) and anyone who came in on a day off,
 * each with arrival, departure, lateness and early leave.
 */
function crewOn(data, people, date, now) {
  const crew = [];
  for (const { user, week, sessions } of people) {
    const record = dayRecord({ sessions, week, leaves: data.leaves, uid: user.id, date, now });
    if (record.planned !== "off") {
      crew.push({ user, date, kind: record.planned, record });
      continue;
    }
    for (const kind of SHIFTS) {
      const mine = sessions.filter((item) => item.date === date && sessionKind(item, date) === kind);
      if (!mine.length) continue;
      const last = mine.at(-1);
      const extra = { ...record, status: "extra", leave: null, firstIn: mine[0].start, lastOut: last.live ? null : last.end, live: Boolean(last.live), forgot: mine.some((item) => item.forgot) };
      crew.push({ user, date, kind, record: extra });
    }
  }
  return crew;
}

function crewState(record) {
  if (record.status === "leave") return "leave";
  if (record.live) return "in";
  if (record.firstIn) return "out";
  return record.status;
}

function crewBadge(record) {
  const key = crewState(record);
  const [label, cls] = CREW_STATE[key];
  return `<span class="att-state ${cls}">${label}${key === "leave" && record.leave ? ` · ${LEAVE_LABEL[record.leave.type]}` : ""}</span>`;
}

function crewTags(record) {
  return [
    record.status === "extra" ? `<em class="tag">Илүү цаг</em>` : "",
    record.late ? `<em class="tag is-late">+${record.late} мин хоцорсон</em>` : "",
    record.early ? `<em class="tag is-late">${record.early} мин эрт гарсан</em>` : "",
    record.forgot ? `<em class="tag is-late">Гаралт бүртгээгүй</em>` : "",
  ].join("");
}

function byName(a, b) {
  return a.user.displayName.localeCompare(b.user.displayName, "mn");
}

function shiftColumn(crew, shift, now, live) {
  const list = crew
    .filter((item) => item.kind === shift.kind)
    .sort((a, b) => CREW_ORDER[crewState(a.record)] - CREW_ORDER[crewState(b.record)] || byName(a, b));
  const expected = list.filter((item) => item.record.status !== "leave" && item.record.status !== "extra").length;
  const came = list.filter((item) => item.record.firstIn).length;
  const note = live ? `Одоо явж байна · дуусахад ${spanLabel(shift.end - now)}` : `Дараагийн ээлж · эхлэхэд ${spanLabel(shift.start - now)}`;
  const rows = list
    .map(
      (item, index) => `<li class="crew row-in" style="--i:${Math.min(index, 14)}">
          ${avatar(item.user)}
          <div class="crew-who">
            <b>${esc(item.user.displayName)}</b>
            <small>@${esc(item.user.username)}${item.user.title ? ` · ${esc(item.user.title)}` : ""}</small>
            <span class="crew-tags">${crewBadge(item.record)}${crewTags(item.record)}</span>
          </div>
          <dl class="crew-times">
            <div><dt>Ирсэн</dt><dd>${clockLabel(item.record.firstIn)}</dd></div>
            <div><dt>Гарсан</dt><dd>${clockLabel(item.record.lastOut)}</dd></div>
          </dl>
        </li>`,
    )
    .join("");
  return `<section class="panel shift-col is-${shift.kind}${live ? " is-live" : ""}">
      <header class="shift-col-head">
        <span class="att-ico">${adminIcon(shift.kind === "day" ? "sun" : "moon")}</span>
        <div><small>${note}</small><b>${SHIFT_LABEL[shift.kind]}</b><span>${shiftDateLabel(shift.date, shift.kind)}</span></div>
        <div class="shift-col-count"><b>${came}/${expected}</b><span>ирсэн</span></div>
      </header>
      <ul class="crew-list">${rows || `<li class="muted">Энэ ээлжид төлөвлөгдсөн ажилтан алга.</li>`}</ul>
    </section>`;
}

function historyFilter() {
  state.attHistory ||= { open: false, day: "", shift: "", status: "", query: "" };
  return state.attHistory;
}

/** History runs from the day it was introduced, at most the last 30 days. */
function historyBounds(data, now) {
  const max = shiftDateOf(now);
  const floor = addDays(max, -(HISTORY_DAYS - 1));
  const start = /^\d{4}-\d{2}-\d{2}$/.test(data.historyFrom || "") ? data.historyFrom : max;
  return { min: start > floor ? (start > max ? max : start) : floor, max };
}

function historyDay(data, now) {
  const { min, max } = historyBounds(data, now);
  const day = historyFilter().day;
  return day >= min && day <= max ? day : "";
}

function historyLabel(record) {
  if (record.status === "leave") return `Чөлөөтэй${record.leave ? ` · ${LEAVE_LABEL[record.leave.type]}` : ""}`;
  if (record.status === "extra") return "Илүү цаг";
  if (record.status === "absent") return "Тасалсан";
  if (record.status === "missing") return "Ирээгүй";
  if (record.live) return record.late ? "Ажил дээр · хоцорсон" : "Ажил дээр";
  return record.late ? "Хоцорсон" : "Цагтаа";
}

/** Shifts that have begun, one row per person and shift, newest first: the picked day, or the whole history. */
function historyRecords(data, people, now) {
  const { min, max } = historyBounds(data, now);
  const filter = historyFilter();
  const day = historyDay(data, now);
  const from = day || min;
  const to = day || max;
  const rows = [];
  for (let date = to; date >= from; date = addDays(date, -1)) {
    const crew = crewOn(data, people, date, now).filter(
      (item) => item.record.status !== "upcoming" && !(data.trackAt && item.record.status === "absent" && item.record.span.end <= Date.parse(data.trackAt)),
    );
    crew.sort((a, b) => (a.kind === b.kind ? byName(a, b) : a.kind === "night" ? -1 : 1));
    rows.push(...crew);
  }
  const test = HISTORY_STATUS[filter.status]?.[1];
  const shown = rows.filter(
    (item) =>
      (!filter.shift || item.kind === filter.shift) &&
      (!test || test(item.record)) &&
      userMatches(searchFold([item.user.displayName, item.user.username, item.user.card?.idNumber, item.user.title].join(" ")), filter.query),
  );
  return { rows, shown, from, to };
}

function historyRows(shown) {
  if (!shown.length) return `<tr><td colspan="7" class="muted">Шүүлтэд тохирох бичлэг алга.</td></tr>`;
  return shown
    .slice(0, HISTORY_LIMIT)
    .map((item, index) => {
      const { record, user } = item;
      const tone = record.status === "absent" || record.status === "missing" ? "is-bad" : record.late || record.early || record.forgot ? "is-warn" : "";
      return `<tr class="row-in" style="--i:${Math.min(index, 14)}">
        <td><span class="staff-today is-${item.kind}">${PLAN_LABEL[item.kind]}</span><small class="staff-sub">${PLAN_HOURS[item.kind]}</small></td>
        <td><div class="who">${avatar(user)}<div><b>${esc(user.displayName)}</b><small>@${esc(user.username)}${user.title ? ` · ${esc(user.title)}` : ""}</small></div></div></td>
        <td class="${tone}">${esc(historyLabel(record))}${record.forgot ? `<small class="staff-sub">Гаралт бүртгээгүй</small>` : ""}</td>
        <td class="mono">${clockLabel(record.firstIn)}</td>
        <td class="mono">${clockLabel(record.lastOut)}</td>
        <td class="${record.late ? "is-warn" : ""}">${record.late ? `${record.late} мин` : "–"}</td>
        <td class="${record.early ? "is-warn" : ""}">${record.early ? `${record.early} мин` : "–"}</td>
      </tr>`;
    })
    .join("");
}

function shiftTally(crew, kind, now, date) {
  const list = crew.filter((item) => item.kind === kind);
  const planned = list.filter((item) => item.record.status !== "leave" && item.record.status !== "extra");
  const came = list.filter((item) => item.record.firstIn).length;
  const count = (key) => list.filter((item) => HISTORY_STATUS[key][1](item.record)).length;
  const started = now >= shiftSpan(date, kind).start;
  const notes = started
    ? [count("late") && `хоцорсон ${count("late")}`, count("absent") && `ирээгүй ${count("absent")}`, count("early") && `эрт гарсан ${count("early")}`, count("leave") && `чөлөө ${count("leave")}`, count("extra") && `илүү цаг ${count("extra")}`].filter(Boolean)
    : ["Эхлээгүй"];
  const issues = started && count("late") + count("absent") + count("early") > 0;
  return `<div class="hist-shift is-${kind}${issues ? " has-issue" : ""}">
      <span>${adminIcon(kind === "day" ? "sun" : "moon")}${SHIFT_LABEL[kind]}</span>
      <b>${started ? `${came}/${planned.length}` : `– /${planned.length}`}</b>
      <small>${notes.join(" · ") || "Бүгд цагтаа"}</small>
    </div>`;
}

/** One card per day for the last few days; picking a day opens its full list. */
function historyDays(data, people, now) {
  const { min, max } = historyBounds(data, now);
  const cards = [];
  for (let date = max; date >= min && cards.length < HISTORY_PREVIEW; date = addDays(date, -1)) {
    const crew = crewOn(data, people, date, now);
    cards.push(`<li class="hist-day row-in" style="--i:${cards.length}">
        <div class="hist-date"><b>${shortDate(date)}</b><small>${WEEKDAY_SHORT[weekdayOf(date)]} · ${daysAgo(max, date)}</small></div>
        ${shiftTally(crew, "day", now, date)}
        ${shiftTally(crew, "night", now, date)}
        <button class="chip" type="button" data-action="hist-day" data-date="${date}">Дэлгэрэнгүй</button>
      </li>`);
  }
  const older = Math.round((Date.parse(addDays(max, -cards.length)) - Date.parse(min)) / DAY_MS) + 1;
  return `<ul class="hist-days">${cards.join("")}</ul>
    ${older > 0 ? `<p class="hist-summary">Өмнөх ${older} хоногийг дээрх «Өдөр» жагсаалтаас сонгож үзнэ.</p>` : ""}`;
}

/** The body under the history controls: day cards, or the picked day in detail. */
function historyBody(data, people, now) {
  if (!historyFilter().open) return "";
  const day = historyDay(data, now);
  if (!day) return historyDays(data, people, now);
  const { shown, rows } = historyRecords(data, people, now);
  const count = (key) => shown.filter((item) => HISTORY_STATUS[key][1](item.record)).length;
  const more = shown.length > HISTORY_LIMIT ? ` · эхний ${HISTORY_LIMIT}-г харуулав, бүгд CSV-д` : "";
  return `
    <p class="hist-summary">${shortDate(day)} ${WEEKDAY_SHORT[weekdayOf(day)]} · ${shown.length}${shown.length !== rows.length ? ` / ${rows.length}` : ""} бичлэг · хоцорсон ${count("late")} · эрт гарсан ${count("early")} · ирээгүй ${count("absent")}${more}</p>
    <div class="staff-scroll">
      <table class="user-table staff-table hist-table">
        <thead><tr><th>Ээлж</th><th>Ажилтан</th><th>Төлөв</th><th>Ирсэн</th><th>Гарсан</th><th>Хоцорсон</th><th>Эрт гарсан</th></tr></thead>
        <tbody>${historyRows(shown)}</tbody>
      </table>
    </div>`;
}

function historyControls(data, now) {
  const filter = historyFilter();
  if (!filter.open) return "";
  const { min, max } = historyBounds(data, now);
  const day = historyDay(data, now);
  const days = [];
  for (let date = max; date >= min; date = addDays(date, -1)) days.push([date, `${shortDate(date)} ${WEEKDAY_SHORT[weekdayOf(date)]} · ${daysAgo(max, date)}`]);
  const pick = (name, label, entries, current) =>
    `<select class="user-filter" data-filter="hist-${name}" aria-label="${label}">${entries
      .map(([value, text]) => `<option value="${value}"${value === current ? " selected" : ""}>${esc(text)}</option>`)
      .join("")}</select>`;
  const dayPick = pick("day", "Өдрөөр шүүх", [["", `Сүүлийн ${HISTORY_PREVIEW} хоног`], ...days], day);
  if (!day) return dayPick;
  return `
    <button class="chip" type="button" data-action="hist-day" data-date="">${adminIcon("back")}Бүх өдөр</button>
    ${dayPick}
    <label class="user-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
      <input type="search" data-filter="hist-query" value="${esc(filter.query)}" placeholder="Нэр, ID, албан тушаал" aria-label="Ажилтан хайх" autocomplete="off" spellcheck="false" />
    </label>
    ${pick("shift", "Ээлжээр шүүх", [["", "Бүх ээлж"], ...SHIFTS.map((kind) => [kind, `${SHIFT_LABEL[kind]} ${PLAN_HOURS[kind]}`])], filter.shift)}
    ${pick("status", "Төлөвөөр шүүх", [["", "Бүх төлөв"], ...Object.entries(HISTORY_STATUS).map(([key, [label]]) => [key, label])], filter.status)}`;
}

function historyPanel(data, people, now) {
  const filter = historyFilter();
  const { min, max } = historyBounds(data, now);
  return `<section class="panel admin-users att-history${filter.open ? " is-open" : ""}">
      <div class="admin-users-head">
        <h2>Ирцийн түүх <small>${shortDate(min)}-аас хойш · ${HISTORY_DAYS} хоног хадгална</small></h2>
        <div class="hist-actions">
          ${filter.open ? `<button class="chip" type="button" data-action="hist-csv">${adminIcon("download")}CSV</button>` : ""}
          <button class="chip" type="button" data-action="hist-toggle" aria-expanded="${filter.open}">${filter.open ? "Хураах" : "Ирцийн түүх харах"}</button>
        </div>
      </div>
      ${filter.open ? `<div class="user-filters hist-filters">${historyControls(data, now)}</div>` : `<p class="hist-summary">${shortDate(min)} – ${shortDate(max)} хооронд өдөр бүрийн ирц, ирсэн гарсан цаг.</p>`}
      <div class="hist-body" data-att="hist-body">${historyBody(data, people, now)}</div>
    </section>`;
}

/** Redraws the whole history panel when its layout changes (opened, closed, another day picked). */
function repaintHistoryPanel() {
  const panel = stage.querySelector(".att-history");
  const data = state.admin?.attendance;
  if (!panel || !data) return;
  const now = Date.now();
  panel.outerHTML = historyPanel(data, crewPeople(data, staffOf(state.admin.users), now), now);
}

function downloadHistoryCsv() {
  const data = state.admin?.attendance;
  if (!data) return;
  const now = Date.now();
  const { shown, from, to } = historyRecords(data, crewPeople(data, staffOf(state.admin.users), now), now);
  const header = ["Огноо", "Гараг", "Ээлж", "Ээлжийн цаг", "Овог нэр", "Нэвтрэх нэр", "ID дугаар", "Албан тушаал", "Төлөв", "Ирсэн", "Гарсан", "Хоцорсон (мин)", "Эрт гарсан (мин)", "Гаралт бүртгээгүй"];
  const rows = shown.map(({ user, record, date, kind }) => [
    date,
    WEEKDAY_SHORT[weekdayOf(date)],
    PLAN_LABEL[kind],
    PLAN_HOURS[kind],
    user.displayName,
    user.username,
    user.card?.idNumber || "",
    user.title || "",
    historyLabel(record),
    stampLabel(record.firstIn),
    stampLabel(record.lastOut),
    record.late || 0,
    record.early || 0,
    record.forgot ? "Тийм" : "",
  ]);
  const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  link.download = from === to ? `irts-${from}.csv` : `irts-${from}_${to}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

const OFF_WEEK = Array(7).fill("off");

/** Admins have no shifts unless one is set for them explicitly. */
function weekOf(data, user) {
  return data.plans?.[user.id] || (user.role === "admin" ? OFF_WEEK : null);
}

/** Who should work in the filtered shift, and who is on approved leave. */
function dutyOf(data, user, date, shift) {
  const planned = plannedKind(weekOf(data, user), date);
  const leave = planned === "off" ? null : leaveOn(data.leaves, user.id, date);
  return { planned, leave, expected: planned !== "off" && !leave && (shift === "all" || shift === planned) };
}

function staffOf(users) {
  return users.filter(worksShifts);
}

/** Pieces of the attendance page that change with the clock, new scans and the history filter. */
function attendanceParts(data) {
  const now = Date.now();
  const users = staffOf(state.admin.users);
  const userById = new Map(state.admin.users.map((user) => [user.id, user]));
  const people = crewPeople(data, users, now);
  const [current, next] = liveShifts(now);
  const crews = new Map();
  const crewFor = (date) => crews.get(date) || crews.set(date, crewOn(data, people, date, now)).get(date);
  const nowCrew = crewFor(current.date).filter((item) => item.kind === current.kind);
  const nextCrew = crewFor(next.date).filter((item) => item.kind === next.kind);
  const planned = nowCrew.filter((item) => item.record.status !== "leave" && item.record.status !== "extra");
  const stat = (value, label, cls = "") => `<div class="${cls}"><b>${value}</b><span>${label}</span></div>`;
  const missing = planned.filter((item) => !item.record.firstIn).length;
  return {
    head: `
      <b>Ирц · ${SHIFT_LABEL[current.kind]}</b>
      <span>${shiftDateLabel(current.date, current.kind)} · дараа нь ${SHIFT_LABEL[next.kind].toLowerCase()} ${shortDate(next.date)} ${PLAN_HOURS[next.kind]}</span>`,
    stats: `
      ${stat(`${planned.filter((item) => item.record.firstIn).length} / ${planned.length}`, "Ирсэн / Ирэх ёстой")}
      ${stat(nowCrew.filter((item) => item.record.live).length, "Ажил дээр байгаа", "is-pos")}
      ${stat(missing, "Ирээгүй", missing ? "is-neg" : "")}
      ${stat(nowCrew.filter((item) => item.record.status === "leave").length, "Чөлөөтэй")}
      ${stat(nextCrew.filter((item) => item.record.status !== "leave").length, "Дараагийн ээлжид")}`,
    board: shiftColumn(nowCrew, current, now, true) + shiftColumn(nextCrew, next, now, false),
    leaves: leaveRequests(data, userById),
    "hist-body": historyBody(data, people, now),
  };
}

function leaveRequests(data, userById) {
  const order = { pending: 0, approved: 1, rejected: 2 };
  const leaves = (data.leaves || [])
    .filter((leave) => userById.has(leave.uid))
    .sort((a, b) => order[a.status] - order[b.status] || b.at.localeCompare(a.at))
    .slice(0, 30);
  if (!leaves.length) return `<li class="muted row-in">Чөлөөний хүсэлт алга.</li>`;
  return leaves
    .map((leave, index) => {
      const user = userById.get(leave.uid);
      const [label, cls] = LEAVE_STATUS[leave.status];
      const days = Math.round((Date.parse(leave.to) - Date.parse(leave.from)) / DAY_MS) + 1;
      const actions =
        leave.status === "pending"
          ? `<div class="leave-actions">
              <button class="chip is-approve" type="button" data-action="leave-decide" data-status="approved" data-id="${esc(leave.id)}">${adminIcon("check")}Зөвшөөрөх</button>
              <button class="chip is-reject" type="button" data-action="leave-decide" data-status="rejected" data-id="${esc(leave.id)}">${adminIcon("cross")}Татгалзах</button>
            </div>`
          : `<span class="tag ${cls}">${label}</span>`;
      return `<li class="leave-item row-in${leave.status === "pending" ? " is-pending" : ""}" style="--i:${Math.min(index, 12)}">
          ${avatar(user)}
          <div><b>${esc(user.displayName)} · <span class="leave-type is-${leave.type}">${LEAVE_LABEL[leave.type]}</span></b>
          <small>${shortDate(leave.from)}${leave.to !== leave.from ? ` – ${shortDate(leave.to)}` : ""} · ${days} өдөр${leave.note ? ` · ${esc(leave.note)}` : ""}</small></div>
          ${actions}
        </li>`;
    })
    .join("");
}

const PLAN_LETTER = { day: "Ө", night: "Ш", off: "А" };
const ROSTER_DAYS = 28;

function planSummary(plan, today) {
  if (!isRotation(plan)) return "7 хоногоор";
  const from = rotationFrom(plan);
  if (today < from) return `Эргэлт · ${shortDate(from)}-аас ${PLAN_LABEL[plannedKind(plan, from)]}`;
  const phase = rotationPhase(plan, today);
  return `Эргэлт · ${PLAN_LABEL[phase.kind]} ${phase.index}/${phase.length}`;
}

function restTag(user) {
  return user.card?.restUntil ? `<em class="rest-tag">ID карт ${shortDate(user.card.restUntil)} хүртэл түдгэлзсэн</em>` : "";
}

/** Today and the next 27 days, one row per user, with dated columns grouped by month. */
function rosterTable(data, users, today) {
  const dates = Array.from({ length: ROSTER_DAYS }, (_, index) => addDays(today, index));
  const months = [];
  for (const date of dates) {
    const key = date.slice(0, 7);
    if (months.at(-1)?.key === key) months.at(-1).span += 1;
    else months.push({ key, span: 1 });
  }
  const monthRow = months.map((month) => `<th colspan="${month.span}" class="roster-month">${month.key.slice(0, 4)} оны ${Number(month.key.slice(5))}-р сар</th>`).join("");
  const dayRow = dates
    .map((date) => {
      const weekday = weekdayOf(date);
      return `<th class="roster-day${date === today ? " is-today" : ""}${weekday === 0 || weekday === 6 ? " is-weekend" : ""}"><b>${Number(date.slice(8))}</b><small>${WEEKDAY_SHORT[weekday]}</small></th>`;
    })
    .join("");
  const rows = users
    .map((user, index) => {
      const plan = weekOf(data, user);
      const cells = dates
        .map((date) => {
          const leave = leaveOn(data.leaves, user.id, date);
          const kind = plannedKind(plan, date);
          const label = leave ? LEAVE_LABEL[leave.type] : `${PLAN_LABEL[kind]} ${PLAN_HOURS[kind]}`.trim();
          return `<td class="${leave ? "is-leave" : `is-${kind}`}${date === today ? " is-today" : ""}" title="${esc(`${shortDate(date)} ${WEEKDAY_SHORT[weekdayOf(date)]} · ${label}`)}">${leave ? "Ч" : PLAN_LETTER[kind]}</td>`;
        })
        .join("");
      return `<tr class="row-in" style="--i:${index}">
          <th class="roster-who">${avatar(user)}<div><b>${esc(user.displayName)}</b><small>${esc(planSummary(plan, today))}</small>${restTag(user)}</div></th>
          ${cells}
        </tr>`;
    })
    .join("");
  return `
      <div class="roster-scroll">
        <table class="roster">
          <thead><tr><th rowspan="2" class="roster-who">Хэрэглэгч</th>${monthRow}</tr><tr>${dayRow}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${ROSTER_DAYS + 1}" class="muted">Хэрэглэгч алга.</td></tr>`}</tbody>
        </table>
      </div>
      <p class="roster-legend"><span class="is-day">Ө</span>Өдөр ${PLAN_HOURS.day}<span class="is-night">Ш</span>Шөнө ${PLAN_HOURS.night}<span class="is-off">А</span>Амралт · эргэлтийн амралтад ID карт түдгэлзэнэ<span class="is-leave">Ч</span>Чөлөө</p>`;
}

function weekPicker(user, week) {
  const cells = WEEK_ORDER.map(
    (weekday) => `<label><small>${WEEKDAY_SHORT[weekday]}</small><select class="inline-select plan-select is-${week[weekday]}" data-plan="${esc(user.id)}" data-weekday="${weekday}" aria-label="${esc(user.displayName)} · ${WEEKDAY_SHORT[weekday]}">
            ${["day", "night", "off"].map((kind) => `<option value="${kind}"${kind === week[weekday] ? " selected" : ""}>${PLAN_LABEL[kind]}</option>`).join("")}
          </select></label>`,
  ).join("");
  return `<div class="plan-week-pick">${cells}</div>`;
}

/** A start option is "pattern:day of the cycle", e.g. "nd:0" starts a night-first cycle on its first night. */
function parseStart(value) {
  const [pattern, offset] = String(value).split(":");
  const day = Number(offset);
  return ROTATIONS[pattern] && Number.isInteger(day) && day >= 0 && day < ROTATIONS[pattern].length ? { pattern, offset: day } : null;
}

function startKind(value) {
  const start = parseStart(value);
  return start ? ROTATIONS[start.pattern][start.offset] : "off";
}

/** The cycles a person can start: HR works 14 days in a row, everyone else day-first or night-first. */
function rotationStarts(user, plan) {
  if (user.role === "hr") return [["dd:0", "Өдөр · 14 өдөр → 14 амралт"], ["dd:14", "Амралт · 14 хоног"]];
  const current = isRotation(plan) && patternOf(plan) !== "dd" ? patternOf(plan) : "dn";
  return [
    ["dn:0", "Өдөр · 7 өдөр → 7 шөнө → 14 амралт"],
    ["nd:0", "Шөнө · 7 шөнө → 7 өдөр → 14 амралт"],
    [`${current}:14`, "Амралт · 14 хоног"],
  ];
}

function cycleDay(plan, date) {
  const offset = Math.round((Date.parse(date) - Date.parse(plan.start)) / DAY_MS);
  return ((offset % ROSTER_DAYS) + ROSTER_DAYS) % ROSTER_DAYS;
}

/**
 * Start date and starting shift for a rotation. An existing rotation is prefilled with its next phase
 * boundary, so saving without changes keeps the cycle as it is.
 */
function rotationForm(user, plan, today) {
  const starts = rotationStarts(user, plan);
  const existing = isRotation(plan) && starts.some(([value]) => value.startsWith(`${patternOf(plan)}:`));
  let from = addDays(today, 1);
  let value = starts[0][0];
  if (existing) {
    from = rotationFrom(plan) >= today ? rotationFrom(plan) : rotationPhase(plan, today).next.date;
    value = `${patternOf(plan)}:${cycleDay(plan, from)}`;
    if (!starts.some(([option]) => option === value)) starts.push([value, `${PLAN_LABEL[startKind(value)]} · эргэлтийн үргэлжлэл`]);
  }
  const options = starts.map(([option, label]) => `<option value="${option}"${option === value ? " selected" : ""}>${label}</option>`).join("");
  return `<form class="plan-rotation" data-form="plan-rotation" data-id="${esc(user.id)}">
          <label class="plan-field"><small>Эхлэх огноо</small><input type="date" name="from" value="${from}" min="${today}" required /></label>
          <label class="plan-field"><small>Эхлэх ээлж</small><select class="inline-select plan-phase is-${startKind(value)}" name="phase">${options}</select></label>
          <button class="chip" type="submit">Хадгалах</button>
          <small class="rotation-phase">${existing ? esc(rotationText(plan, today)) : "Хадгалаагүй · огноо, ээлжээ сонгоод Хадгалах дарна уу"}</small>
        </form>`;
}

function planSettings(data, users, today) {
  const rows = users
    .map((user, index) => {
      const plan = weekOf(data, user);
      const hr = user.role === "hr";
      const rotating = hr || isRotation(plan) || Boolean(state.planDraft?.[user.id]);
      const saved = isRotation(plan) && (!hr || patternOf(plan) === "dd");
      const note = saved ? `Эргэлт · ${ROTATION_LABEL[patternOf(plan)]}` : rotating ? "Эргэлт · хадгалаагүй" : data.plans?.[user.id] ? "Тусгай хуваарь" : "Үндсэн хуваарь";
      const mode = hr
        ? `<span class="plan-mode-fixed">Эргэлт 14·14 · зөвхөн өдөр</span>`
        : `<select class="inline-select plan-mode" data-plan-mode="${esc(user.id)}" aria-label="${esc(user.displayName)} · хуваарийн төрөл">
            <option value="week"${rotating ? "" : " selected"}>7 хоногоор</option>
            <option value="rotation"${rotating ? " selected" : ""}>Эргэлт 7·7·14</option>
          </select>`;
      return `<tr class="row-in" style="--i:${index}">
          <td><div class="who">${avatar(user)}<div><b>${esc(user.displayName)}</b><small>${note}${hr ? " · Хүний нөөц" : ""}</small></div></div></td>
          <td>${mode}</td>
          <td>${rotating ? rotationForm(user, plan, today) : weekPicker(user, planOf(plan))}</td>
        </tr>`;
    })
    .join("");
  return `
      <h3 class="plan-sub">Хуваарь тохируулах</h3>
      <div class="plan-scroll"><table class="user-table plan-table"><thead><tr><th>Хэрэглэгч</th><th>Төрөл</th><th>Тохиргоо</th></tr></thead><tbody>${rows || `<tr><td colspan="3" class="muted">Хэрэглэгч алга.</td></tr>`}</tbody></table></div>`;
}

function planEditor(data) {
  const users = (state.admin?.users || []).filter(worksShifts);
  const today = localDate(new Date().toISOString());
  const tally = { day: 0, night: 0, off: 0 };
  for (const user of users) {
    const duty = dutyOf(data, user, today, "all");
    tally[duty.leave ? "off" : duty.planned] += 1;
  }
  return `
    <section class="panel admin-users att-plans">
      <h2>Ээлжийн хуваарь <small>Эргэлт: 7 өдөр → 7 шөнө → 14 амралт, шөнөөр эхэлбэл 7 шөнө → 7 өдөр → 14 амралт, хүний нөөц 14 өдөр → 14 амралт. Автоматаар давтагдана</small></h2>
      <p class="plan-tally">Өнөөдөр: <span class="is-day">${PLAN_LABEL.day} ${tally.day}</span><span class="is-night">${PLAN_LABEL.night} ${tally.night}</span><span class="is-off">${PLAN_LABEL.off} ${tally.off}</span></p>
      ${rosterTable(data, users, today)}
      ${planSettings(data, users, today)}
    </section>`;
}

async function putPlan(uid, body) {
  try {
    state.admin = await api(`/api/hr/shift-plans/${encodeURIComponent(uid)}`, { method: "PUT", body: JSON.stringify(body) });
    paintStaff();
    return true;
  } catch (error) {
    flash(".att-plans", error.message, false);
    return false;
  }
}

/** Redraws the plan panel after a change that alters a row's shape. */
function repaintPlans(message) {
  const section = stage.querySelector(".att-plans");
  if (!section || !state.admin?.attendance) return render();
  section.outerHTML = planEditor(state.admin.attendance);
  if (message) flash(".att-plans", message);
}

async function savePlan(select) {
  const uid = select.dataset.plan;
  const days = Array(7).fill("off");
  for (const node of stage.querySelectorAll(`select[data-plan="${CSS.escape(uid)}"]`)) days[Number(node.dataset.weekday)] = node.value;
  if (await putPlan(uid, { days })) repaintPlans("Хуваарь хадгалагдлаа");
}

async function savePlanMode(select) {
  const uid = select.dataset.planMode;
  const user = state.admin.users.find((item) => item.id === uid);
  const current = user && weekOf(state.admin.attendance, user);
  state.planDraft ||= {};
  if (select.value === "rotation") {
    state.planDraft[uid] = true;
    repaintPlans("Эхлэх огноо, эхлэх ээлжийг сонгоод Хадгалах дарна уу");
    return;
  }
  delete state.planDraft[uid];
  if (!isRotation(current)) return repaintPlans();
  let week = current;
  while (isRotation(week)) week = week.before;
  if (await putPlan(uid, { days: [...planOf(week)] })) repaintPlans("7 хоногийн хуваарь руу шилжлээ");
}

async function saveRotation(form, data) {
  const uid = form.dataset.id;
  const today = localDate(new Date().toISOString());
  const begin = parseStart(data.phase);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.from) || data.from < today || !begin) {
    flash(".att-plans", "Өнөөдрөөс хойших огноо сонгоно уу", false);
    return;
  }
  const start = addDays(data.from, -begin.offset);
  if (!(await putPlan(uid, { rotation: { start, from: data.from, pattern: begin.pattern } }))) return;
  delete state.planDraft?.[uid];
  const name = state.admin.users.find((item) => item.id === uid)?.displayName || "Хэрэглэгч";
  const plan = { type: "rotation", start, from: data.from, pattern: begin.pattern };
  const next = rotationPhase(plan, data.from).next;
  repaintPlans(`${name}: ${shortDate(data.from)}-аас ${PLAN_LABEL[plannedKind(plan, data.from)]}, ${shortDate(next.date)}-аас ${PLAN_LABEL[next.kind]}`);
}

function announcePanel() {
  const all = state.admin?.users || [];
  const audience = all.filter(worksShifts);
  const names = (list) => list.map((user) => esc(user.displayName)).join(", ") || "–";
  const items = (state.admin?.announcements || [])
    .map((item, index) => {
      const readers = audience.filter((user) => item.readBy.includes(user.id));
      const waiting = audience.filter((user) => !item.readBy.includes(user.id));
      const share = audience.length ? readers.length / audience.length : 0;
      return `<li class="announce row-in" style="--i:${index}">
        <span class="att-ico">${adminIcon("today")}</span>
        <div class="announce-body">
          <b>${esc(item.text)}</b>
          <small>${esc(item.by || "Админ")} · ${agoLabel(item.at)}</small>
          <div class="announce-read">
            <div class="me-progress" style="--p:${share.toFixed(3)}"><span></span></div>
            <span>Уншсан ${readers.length}/${audience.length}</span>
          </div>
          <details><summary>Хэн уншсан бэ</summary><p><b>Уншсан:</b> ${names(readers)}</p><p><b>Уншаагүй:</b> ${names(waiting)}</p></details>
        </div>
        <button class="icon-btn" type="button" data-action="announce-delete" data-id="${esc(item.id)}" aria-label="Зарлал устгах" title="Устгах">${adminIcon("trash")}</button>
      </li>`;
    })
    .join("");
  return `
    <section class="panel announce-panel">
      <h2>Зарлал <small>бүх хүний Нүүр хуудсанд гарна</small></h2>
      <form class="announce-form" data-form="announce" autocomplete="off">
        <input name="text" maxlength="300" placeholder="Жишээ нь: Маргааш 10:00-д хурал" aria-label="Зарлалын текст" required />
        <button class="primary" type="submit">Нийтлэх</button>
      </form>
      <ul class="announce-list">${items || `<li class="muted">Зарлал алга. Нийтэлсэн зарлал 14 хоног хадгалагдана.</li>`}</ul>
    </section>`;
}

function adminTodayView() {
  const data = state.admin?.attendance;
  if (!data) return adminLoading();
  const parts = attendanceParts(data);
  return `
    <div class="admin-page att-page">
      <section class="panel admin-hero att-hero">
        <div class="admin-shield">${adminIcon("today")}</div>
        <div class="profile-who" data-att="head">${parts.head}</div>
        <div class="admin-stats att-stats" data-att="stats">${parts.stats}</div>
      </section>
      <div class="shift-board" data-att="board">${parts.board}</div>
      ${historyPanel(data, crewPeople(data, staffOf(state.admin.users), Date.now()), Date.now())}
      <div class="me-grid">
        <section class="panel att-leaves">
          <h2>Чөлөөний хүсэлт</h2>
          <ul class="leave-list" data-att="leaves">${parts.leaves}</ul>
        </section>
        ${announcePanel()}
      </div>
    </div>`;
}

/** Swaps only the changing pieces so the history filters keep their focus. */
function paintToday() {
  const page = stage.querySelector(".att-page");
  const data = state.admin?.attendance;
  if (!page || !data) return render();
  const parts = attendanceParts(data);
  for (const node of page.querySelectorAll("[data-att]")) node.innerHTML = parts[node.dataset.att];
}

function paintHistory() {
  const page = stage.querySelector(".att-page");
  const data = state.admin?.attendance;
  if (!page || !data) return;
  const now = Date.now();
  page.querySelector("[data-att='hist-body']").innerHTML = historyBody(data, crewPeople(data, staffOf(state.admin.users), now), now);
}

async function refreshToday() {
  if (state.view !== "today" || document.hidden) return;
  try {
    state.admin = await api("/api/hr");
  } catch {
    /* keep the last good board; the clock still rolls the shifts over */
  }
  if (state.view !== "today") return;
  stage.classList.add("is-quiet");
  paintToday();
}

const STAFF_TODAY = { day: "Өдрийн ээлж", night: "Шөнийн ээлж", off: "Амралт", leave: "Чөлөөтэй" };

function staffFilter() {
  state.staff ||= { query: "", today: "", presence: "", status: "", title: "", period: "cycle" };
  return state.staff;
}

/** One line per employee: today's duty, presence and the picked period's totals. */
function staffRecords(data, now = Date.now()) {
  const att = data.attendance;
  const filter = staffFilter();
  const kind = MY_PERIODS[filter.period] ? filter.period : "cycle";
  const { from, to } = rangeOf(kind, null, att.date);
  const records = data.users.map((user) => {
    const duty = dutyOf(att, user, att.date, "all");
    const presence = att.people?.[user.id] || { state: "out", since: null };
    const range = rangeOf(kind, weekOf(att, user), att.date);
    const sum = periodSummary({ sessions: sessionsOf(att.events, user.id, now), week: weekOf(att, user), leaves: att.leaves, uid: user.id, ...range, now, since: att.historyFrom, sinceAt: att.trackAt ? Date.parse(att.trackAt) : null });
    return {
      user,
      range,
      today: duty.leave ? "leave" : duty.planned,
      leave: duty.leave,
      presence,
      status: user.card?.restUntil ? "REST" : user.card?.status || "",
      sum,
      key: searchFold([user.displayName, user.username, user.card?.idNumber, user.title, user.email].join(" ")),
    };
  });
  const shown = records.filter(
    (item) =>
      userMatches(item.key, filter.query) &&
      (!filter.today || item.today === filter.today) &&
      (!filter.presence || item.presence.state === filter.presence) &&
      (!filter.status || item.status === filter.status) &&
      (!filter.title || (item.user.title || "") === filter.title),
  );
  return { records, shown, from, to, kind };
}

function staffFiltering() {
  const filter = staffFilter();
  return Boolean(filter.query.trim() || filter.today || filter.presence || filter.status || filter.title);
}

function staffRows(list) {
  if (!list.length) return `<tr><td colspan="9" class="muted">${staffFiltering() ? "Шүүлтэд тохирох ажилтан алга" : "Ажилтан бүртгэгдээгүй байна"}</td></tr>`;
  return list
    .map((item, index) => {
      const { user, sum, presence } = item;
      const todayLabel = item.leave ? LEAVE_LABEL[item.leave.type] : `${PLAN_LABEL[item.today]} ${PLAN_HOURS[item.today]}`.trim();
      const here = presence.state === "in";
      return `<tr class="row-in" style="--i:${Math.min(index, 14)}">
        <td><div class="who">${avatar(user)}<div><b>${esc(user.displayName)}</b><small>@${esc(user.username)}${user.title ? ` · ${esc(user.title)}` : ""}${user.role === "user" ? "" : ` · ${ROLE_LABEL[user.role]}`}</small></div></div></td>
        <td class="mono">${esc(user.card?.idNumber || "–")}<small class="staff-sub">Level ${esc(user.card?.clearance ?? "–")}</small></td>
        <td>${statusBadge(user.card?.status || "–")}${restTag(user)}</td>
        <td><span class="staff-today is-${item.today}">${esc(todayLabel)}</span></td>
        <td><span class="staff-here${here ? " is-in" : ""}"><i></i>${here ? "Ажил дээр" : "Гарсан"}</span>${presence.since ? `<small class="staff-sub">${shortDate(localDate(presence.since))} ${clockLabel(presence.since)}</small>` : ""}</td>
        <td>${workedDaysLabel(sum)}<small class="staff-sub">${shiftSplit(sum)}</small><small class="staff-sub">${shortDate(item.range.from)} – ${shortDate(item.range.to)}</small></td>
        <td class="${sum.late || sum.early ? "is-warn" : ""}">${sum.late} / ${sum.early}</td>
        <td class="${sum.absent ? "is-bad" : ""}">${sum.absent}<small class="staff-sub">чөлөө ${sum.leave}</small></td>
        <td>${user.email ? `<a href="mailto:${esc(user.email)}">${esc(user.email)}</a>` : "–"}${user.birthday ? `<small class="staff-sub">Төрсөн ${esc(user.birthday)}</small>` : ""}</td>
      </tr>`;
    })
    .join("");
}

function staffParts(data) {
  const { records, shown, from, to, kind } = staffRecords(data);
  const count = (pick) => records.filter(pick).length;
  const stat = (value, label, cls = "") => `<div class="${cls}"><b>${value}</b><span>${label}</span></div>`;
  return {
    stats: [
      stat(records.length, "Нийт ажилтан"),
      stat(count((item) => item.presence.state === "in"), "Одоо ажил дээр", "is-pos"),
      stat(count((item) => item.today === "day" || item.today === "night"), "Өнөөдөр ээлжтэй"),
      stat(count((item) => item.today === "leave"), "Чөлөөтэй"),
      stat(count((item) => item.status !== "ACTIVE"), "Карт түдгэлзсэн", "is-neg"),
    ].join(""),
    rows: staffRows(shown),
    count: staffFiltering() ? `${shown.length} / ${records.length}` : "",
    range: kind === "cycle" || kind === "lastcycle" ? `${MY_PERIODS[kind]} · ажилтан бүрийн 7-7-14 эргэлтээр` : `${shortDate(from)} – ${shortDate(to)}`,
  };
}

function staffSelects(data) {
  const filter = staffFilter();
  const { records } = staffRecords(data);
  const pick = (name, label, entries, current) =>
    `<select class="user-filter" data-filter="staff-${name}" aria-label="${label}">${entries
      .map(([value, text]) => `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(text)}</option>`)
      .join("")}</select>`;
  const tally = (test) => records.filter(test).length;
  const titles = [...new Set(records.map((item) => item.user.title || "").filter(Boolean))].sort((a, b) => a.localeCompare(b, "mn"));
  const statuses = [...CARD_STATUSES, "REST"];
  return [
    pick("today", "Өнөөдрийн ээлжээр шүүх", [["", "Өнөөдөр: бүгд"], ...Object.entries(STAFF_TODAY).map(([value, text]) => [value, `${text} (${tally((item) => item.today === value)})`])], filter.today),
    pick("presence", "Байршлаар шүүх", [["", "Байршил: бүгд"], ["in", `Ажил дээр (${tally((item) => item.presence.state === "in")})`], ["out", `Гарсан (${tally((item) => item.presence.state !== "in")})`]], filter.presence),
    pick("status", "Картын төлөвөөр шүүх", [["", "Карт: бүгд"], ...statuses.map((value) => [value, `${value === "REST" ? "Амралтаар түдгэлзсэн" : value} (${tally((item) => item.status === value)})`])], filter.status),
    titles.length ? pick("title", "Албан тушаалаар шүүх", [["", "Албан тушаал: бүгд"], ...titles.map((title) => [title, `${title} (${tally((item) => item.user.title === title)})`])], filter.title) : "",
    pick("period", "Хугацаа сонгох", Object.entries(MY_PERIODS), filter.period),
  ].join("");
}

function hrStaffView() {
  const data = state.admin;
  if (!data?.attendance) return adminLoading();
  const parts = staffParts(data);
  return `
    <div class="admin-page staff-page">
      <section class="panel admin-hero">
        <div class="admin-shield">${adminIcon("users")}</div>
        <div class="profile-who">
          <b>Ажилтнуудын мэдээлэл</b>
          <span>Ээлж, ирц, ажилласан өдөр, картын төлөвийг нэг дор шүүж харна. Ээлжийн хуваарь, тохиргоо доор байна.</span>
        </div>
        <div class="admin-stats staff-stats" data-staff="stats">${parts.stats}</div>
      </section>
      <section class="panel admin-users">
        <div class="admin-users-head">
          <h2>Ажилтнууд <small data-staff="range">${parts.range}</small></h2>
          <button class="chip" type="button" data-action="staff-csv">${adminIcon("download")}CSV</button>
        </div>
        <div class="user-filters staff-filters">
          <label class="user-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
            <input type="search" data-filter="staff-query" value="${esc(staffFilter().query)}" placeholder="Нэр, ID, албан тушаал, и-мэйл" aria-label="Ажилтан хайх" autocomplete="off" spellcheck="false" />
            <span class="user-count" data-staff="count" aria-live="polite">${parts.count}</span>
          </label>
          ${staffSelects(data)}
        </div>
        <div class="staff-scroll">
          <table class="user-table staff-table">
            <thead><tr><th>Ажилтан</th><th>ID · зэрэглэл</th><th>Карт</th><th>Өнөөдөр</th><th>Байршил</th><th>Ажилласан</th><th>Хоцорсон / эрт</th><th>Тасалсан</th><th>Холбоо барих</th></tr></thead>
            <tbody data-staff="rows">${parts.rows}</tbody>
          </table>
        </div>
      </section>
      ${planEditor(data.attendance)}
    </div>`;
}

function paintStaff() {
  const page = stage.querySelector(".staff-page");
  if (!page || !state.admin?.attendance) return render();
  const parts = staffParts(state.admin);
  for (const node of page.querySelectorAll("[data-staff]")) node.innerHTML = parts[node.dataset.staff];
}

function downloadStaffCsv() {
  const data = state.admin;
  if (!data?.attendance) return;
  const { shown, from, to } = staffRecords(data);
  const header = ["Овог нэр", "Нэвтрэх нэр", "Албан тушаал", "ID дугаар", "Зэрэглэл", "Картын төлөв", "Өнөөдөр", "Байршил", "Хугацаа", "Ажилласан өдөр", "Ажлын өдөр (хуваарь)", "Өдрийн ээлж", "Шөнийн ээлж", "Илүү цаг (өдөр)", "Хоцорсон", "Эрт гарсан", "Тасалсан", "Чөлөө (өдөр)", "И-мэйл", "Төрсөн өдөр"];
  const rows = shown.map(({ user, sum, presence, today, leave, status, range }) => [
    user.displayName,
    user.username,
    user.title || "",
    user.card?.idNumber || "",
    user.card?.clearance ?? "",
    status === "REST" ? `Амралтаар түдгэлзсэн (${user.card.restUntil.slice(0, 10)} хүртэл)` : status,
    leave ? LEAVE_LABEL[leave.type] : STAFF_TODAY[today],
    presence.state === "in" ? "Ажил дээр" : "Гарсан",
    `${range.from} – ${range.to}`,
    sum.workedDays,
    sum.targetDays,
    sum.dayShifts,
    sum.nightShifts,
    sum.extra,
    sum.late,
    sum.early,
    sum.absent,
    sum.leave,
    user.email || "",
    user.birthday || "",
  ]);
  const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  link.download = `ajiltnuud-${from}_${to}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function adminProfileView() {
  const me = state.me;
  return `
    <div class="profile">
      <section class="panel admin-hero">
        <div class="admin-shield"><svg viewBox="0 0 24 24" aria-hidden="true">${PROFILE_ICONS.shield}</svg></div>
        <div class="profile-who">
          <b>${esc(me.displayName)}</b>
          <span>@${esc(me.username)}${me.title ? ` · ${esc(me.title)}` : ""} · нэвтрэх нэр <b class="mono">${esc(me.loginCode || "–")}</b> · сүүлд нэвтэрсэн ${esc(timeLabel(me.lastLoginAt) || "–")}</span><br />
          ${roleBadge("admin")}
        </div>
      </section>
      ${meForm(me)}
      ${appLinkPanel()}
      ${passwordForm()}
    </div>`;
}

/** The server's public address as a QR for the UMBRELLA phone app's first start; hidden inside the app itself. */
function appLinkPanel() {
  if (window.UmbrellaApp) return "";
  if (state.appLink === undefined) {
    state.appLink = null;
    api("/api/mobile/link")
      .then(({ url }) => {
        state.appLink = url || "";
        if (state.view === "profile") render();
      })
      .catch(() => {
        state.appLink = "";
      });
  }
  const url = state.appLink;
  if (!url) return "";
  let code = "";
  if (window.qrcode) {
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    code = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }
  return `<section class="panel app-link">
      <h2>UMBRELLA апп</h2>
      <div class="app-link-row">
        <div class="app-link-qr">${code}</div>
        <div>
          <p>Утсан дээрх UMBRELLA апп-ыг анх нээхэд энэ кодыг уншуулна.</p>
          <p class="mono app-link-url">${esc(url)}</p>
        </div>
      </div>
    </section>`;
}

const WK_ICONS = {
  crown: `<circle cx="12" cy="3.6" r="1.3"/><path d="M5.5 7.5l2.6 6h7.8l2.6-6-3.4 2.6L12 5.6l-3.1 4.5z"/><path d="M8.6 13.5L7.8 18h8.4l-.8-4.5"/><path d="M6.5 21h11M7.5 18h9"/>`,
  bulb: `<path d="M9 17.5h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.4 1.1 2.2v1.5h5V16c0-.8.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>`,
  speaker: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>`,
  mute: `<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>`,
  qr: `<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1"/><path d="M14 14h2.5v2.5H14zM18 18h2.5v2.5H18zM14 18.5v2M18.5 14h2"/>`,
  station: `<rect x="3" y="4" width="18" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/><circle cx="12" cy="10.2" r="2.4"/>`,
  log: `<path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M14.5 3.5V7h4M9 11.5h6.5M9 15h6.5M9 18h4"/>`,
  play: `<path d="M8 5.5v13l10-6.5z"/>`,
  plus: `<path d="M12 5v14M5 12h14"/>`,
  config: `<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>`,
  flip: `<path d="M4 8.5h3l1.6-2.5h6.8L17 8.5h3V19H4z"/><path d="M9.2 13.5a2.8 2.8 0 0 1 5-1.7M14.8 13.5a2.8 2.8 0 0 1-5 1.7"/><path d="M14.4 10.2V12h-1.8M9.6 16.8V15h1.8"/>`,
  exit: `<path d="M14 4.5h4.5v15H14"/><path d="M10.5 8l-4 4 4 4M6.5 12h9"/>`,
};

function wkIcon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${WK_ICONS[name] || ADMIN_ICONS[name] || ICONS[name] || ""}</svg>`;
}

const WK_LOG_LABEL = { say: "Мэдэгдэл", light: "Гэрэл", scan: "Ирц", face: "Татгалзсан ирц", config: "Тохиргоо", error: "Алдаа" };
const WK_LOG_ICON = { say: "speaker", light: "bulb", scan: "qr", face: "mute", config: "config", error: "mute" };
const FACE_REASON = {
  nophoto: "ID карт дээр нүүрний зураг алга. Админд хандаж зургаа оруулна уу.",
  noface: "Нүүр камерт харагдсангүй. Камер луу ойртож харна уу.",
  mismatch: "Нүүр ID картын зурагтай таарсангүй.",
  still: "Толгойгоо бага зэрэг эргүүлээгүй тул баталгаажсангүй. Дахин уншуулна уу.",
  timeout: "Нүүр шалгах хугацаа дууссан. QR-ээ дахин уншуулна уу.",
};
const WK_SCAN_REASON = {
  expired: "QR-ийн хугацаа дууссан. Утсан дээрх кодоо шинэчилнэ үү.",
  replay: "Энэ QR аль хэдийн уншигдсан. Шинэ код гарахыг хүлээнэ үү.",
  unknown: "QR танигдсангүй эсвэл эрх түдгэлзсэн.",
  invalid: "QR буруу байна.",
  bad: "QR буруу байна.",
  cooldown: "Саяхан бүртгэгдсэн. 1 минутын дараа дахин уншуулна уу.",
  rest: "Амралтын хугацаа. ID карт түдгэлзсэн байна.",
  ...FACE_REASON,
};

const wkVoice = { queue: [], busy: false, ctx: null };

function wkMinutes(time) {
  const [hh, mm] = String(time).split(":").map(Number);
  return hh * 60 + mm;
}

function wkNowMinute(clock) {
  return clock ? clock.hh * 60 + clock.mm : new Date().getHours() * 60 + new Date().getMinutes();
}

function wkUntil(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return "одоо";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ц ${minutes % 60} мин`;
}

function wkLightsHtml(lights, controls = false) {
  return (lights || [])
    .map((zone) => {
      const on = zone.state === "on";
      const next = zone.next ? `${zone.next.state === "on" ? "Асна" : "Унтарна"} · ${clockLabel(zone.next.at)} (${wkUntil(zone.next.at)})` : "";
      const buttons = controls
        ? `<div class="wk-light-ctl" role="group" aria-label="${esc(zone.name)} гэрэл">
            ${[
              ["on", "Асаах"],
              ["off", "Унтраах"],
              ["auto", "Автомат"],
            ]
              .map(([mode, label]) => {
                const active = mode === "auto" ? zone.mode === "auto" : zone.mode === "manual" && zone.state === mode;
                return `<button type="button" class="chip${active ? " on" : ""}" data-action="wk-light" data-zone="${esc(zone.id)}" data-mode="${mode}" aria-pressed="${active}">${label}</button>`;
              })
              .join("")}
          </div>`
        : "";
      return `<article class="wk-lamp${on ? " is-on" : ""}">
          <span class="wk-bulb">${wkIcon("bulb")}</span>
          <div class="wk-lamp-body">
            <b>${esc(zone.name)}</b>
            <span class="wk-lamp-state">${on ? "Асаалттай" : "Унтраалттай"}${zone.mode === "manual" ? " · гараар" : " · автомат"}</span>
            <small>Хуваарь ${esc(zone.on)} – ${esc(zone.off)}${next ? ` · ${esc(next)}` : ""}</small>
          </div>
          ${buttons}
        </article>`;
    })
    .join("");
}

function wkUpcoming(plan, clock, limit) {
  const minute = wkNowMinute(clock);
  const items = (plan || []).filter((item) => item.text);
  const later = items.filter((item) => wkMinutes(item.time) > minute);
  return [...later, ...items.filter((item) => wkMinutes(item.time) <= minute)].slice(0, limit);
}

function stationView() {
  const wk = state.wk;
  return `
    <div class="wq${wk?.facing === "environment" ? " is-rear" : ""}">
      <video id="scan-video" playsinline muted></video>
      <div class="wq-frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="wk-result" id="wk-result" hidden></div>
      <p class="wq-error" id="wk-status" role="alert">${esc(wk?.error || "")}</p>
      <div class="wq-bar">
        <p id="scan-status" role="status">Камер асааж байна…</p>
        <button type="button" class="wq-btn" data-action="wk-flip" aria-label="Камер солих">${wkIcon("flip")}</button>
        <button type="button" class="wq-btn" data-action="wk-logout" aria-label="Гарах">${wkIcon("exit")}</button>
      </div>
      ${
        wk?.audio
          ? ""
          : `<button type="button" class="wq-unlock" id="wk-unlock" data-action="wk-unlock">${wkIcon("qr")}<b>Эхлүүлэх</b><span>Дэлгэц дээр дарж ирц бүртгэл болон дуут мэдэгдлийг идэвхжүүлнэ үү.</span></button>`
      }
    </div>`;
}

function paintStation() {
  const status = document.querySelector("#wk-status");
  if (status && state.view === "station") status.textContent = state.wk?.error || "";
}

async function keepAwake() {
  if (!state.wk?.audio || document.visibilityState !== "visible" || state.wk.wakeLock) return;
  try {
    const lock = await navigator.wakeLock?.request("screen");
    if (!lock) return;
    state.wk.wakeLock = lock;
    lock.addEventListener("release", () => {
      if (state.wk?.wakeLock === lock) state.wk.wakeLock = null;
    });
  } catch {
    /* the screen may still dim; scanning resumes on wake */
  }
}

function wkChime() {
  const ctx = wkVoice.ctx;
  if (!ctx || !state.wk?.data?.chime) return Promise.resolve();
  const now = ctx.currentTime;
  for (const [freq, at] of [
    [659.25, 0],
    [987.77, 0.24],
    [1318.5, 0.48],
  ]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(0.22, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + 1.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + at);
    osc.stop(now + at + 1.2);
  }
  return new Promise((resolve) => setTimeout(resolve, 1500));
}

function wkSay(item) {
  if (!item?.text) return;
  wkVoice.queue.push(item);
  wkPump();
}

async function wkPump() {
  if (wkVoice.busy || !state.wk?.audio) return;
  const item = wkVoice.queue.shift();
  if (!item) return;
  wkVoice.busy = true;
  wkVoice.current = item;
  paintStation();
  try {
    await wkChime();
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, 10000 + item.text.length * 160);
      speak(item.text, {
        serverTts: Boolean(state.wk?.data?.tts),
        voice: "queen",
        onEnd: done,
        onError(message) {
          if (state.wk) state.wk.error = message;
          done();
        },
      });
    });
  } finally {
    wkVoice.busy = false;
    wkVoice.current = null;
    paintStation();
    wkPump();
  }
}

async function stationPoll() {
  const wk = state.wk;
  if (!wk || !isStation()) return;
  try {
    const data = await api(`/api/whiteking/state${wk.seq === null ? "" : `?after=${wk.seq}`}`);
    if (state.wk !== wk) return;
    wk.data = data;
    wk.seq = data.seq;
    if (data.voice) data.announcements.forEach(wkSay);
    wk.error = "";
  } catch (error) {
    wk.error = `Сервертэй холбогдож чадсангүй: ${error.message}`;
  }
  paintStation();
}

function startStation() {
  clearInterval(state.wkTimer);
  state.wk = { data: null, seq: null, audio: false, error: "", facing: localStorage.getItem("wq-facing") || "user", wakeLock: null, lastToken: "", lastTokenAt: 0 };
  state.view = "station";
  render();
  stationPoll();
  state.wkTimer = setInterval(stationPoll, 4000);
}

function unlockStation() {
  if (!state.wk) return;
  primeAudio();
  try {
    wkVoice.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    wkVoice.ctx.resume();
  } catch {
    /* chime unavailable; speech still plays */
  }
  state.wk.audio = true;
  document.querySelector("#wk-unlock")?.remove();
  document.documentElement.requestFullscreen?.().catch(() => {});
  keepAwake();
  wkPump();
}

async function startStationCamera() {
  const video = document.querySelector("#scan-video");
  const status = document.querySelector("#scan-status");
  if (!video) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    if (status) status.textContent = "Камер нээгдсэнгүй: аппыг HTTPS эсвэл localhost хаягаар нээнэ үү.";
    return;
  }
  try {
    await openCamera(video, { facingMode: state.wk?.facing || "user" });
    if (status) status.textContent = "QR кодоо камерт үзүүлнэ үү";
    cancelAnimationFrame(state.scanTimer);
    state.scanning = true;
    loopScan();
  } catch (error) {
    const reason =
      { NotFoundError: "камер олдсонгүй", NotAllowedError: "камерын зөвшөөрөл олгоогүй байна", NotReadableError: "камерыг өөр программ ашиглаж байна" }[error.name] ||
      error.message;
    if (status) status.innerHTML = `Камер нээгдсэнгүй: ${esc(reason)} <button type="button" class="chip" data-action="wk-camera">Дахин оролдох</button>`;
  }
}

function showScanResult(result) {
  const node = document.querySelector("#wk-result");
  if (!node) return;
  clearTimeout(showScanResult.timer);
  delete node.dataset.prompt;
  if (result.ok) {
    const person = result.person;
    const photo = person.photo ? `<img src="${esc(person.photo)}" alt="" />` : esc(initials({ displayName: person.name }));
    node.className = `wk-result ${result.state === "in" ? "is-in" : "is-out"}`;
    node.innerHTML = `<span class="wk-result-photo">${photo}</span>
      <div><small>${result.state === "in" ? "Ирц бүртгэгдлээ" : "Гарсан цаг бүртгэгдлээ"} · ${clockLabel(new Date().toISOString())}</small><b>${esc(person.name)}</b><span>${esc(person.title || person.idNumber || "")}</span></div>`;
  } else {
    node.className = "wk-result is-error";
    node.innerHTML = `<div><small>Бүртгэгдсэнгүй${result.name ? ` · ${esc(result.name)}` : ""}</small><b>${esc(result.error || WK_SCAN_REASON[result.reason] || "Татгалзсан")}</b></div>`;
  }
  node.hidden = false;
  showScanResult.timer = setTimeout(() => {
    node.hidden = true;
  }, 4500);
}

function showFacePrompt(name, text) {
  const node = document.querySelector("#wk-result");
  if (!node || node.dataset.prompt === text) return;
  clearTimeout(showScanResult.timer);
  node.className = "wk-result is-face";
  node.dataset.prompt = text;
  node.innerHTML = `<div><small>Нүүр шалгалт · ${esc(name)}</small><b>${esc(text)}</b></div>
    <button type="button" class="ghost wk-face-cancel" data-action="face-cancel">Цуцлах</button>`;
  node.hidden = false;
}

function grabFrame(video) {
  const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const faceRun = { cancel: null };

/**
 * Sends front-camera frames until the server has seen the card owner look at the
 * camera and turn their head (or the check is cancelled); resolves with the final result.
 */
async function runFaceCheck(video, path, check, prompt) {
  let cancelled = false;
  faceRun.cancel = () => {
    cancelled = true;
    prompt("Цуцалж байна…");
  };
  const send = (body) => api(path, { method: "POST", body: JSON.stringify({ challenge: check.challenge, ...body }) });
  try {
    if (!video?.videoWidth) throw new Error("Камер ажиллахгүй байна");
    prompt("Нүүрээ камерт харуулна уу");
    while (!cancelled) {
      const result = await send({ frame: grabFrame(video) });
      if (cancelled) break;
      if (!result.pending) return result;
      prompt(result.hint === "turn" ? "Толгойгоо зүүн, баруун тийш аажуухан эргүүлнэ үү" : result.face ? "Камер луу шууд харна уу" : "Нүүрээ камерт харуулна уу");
      await pause(250);
    }
    return await send({ cancel: true }).catch(() => ({ ok: false, reason: "cancelled" }));
  } finally {
    faceRun.cancel = null;
  }
}

/** The QR may come from either camera; the face is always checked on the front one. */
async function stationFace(check) {
  const video = document.querySelector("#scan-video");
  const stage = document.querySelector(".wq");
  const rear = state.wk?.facing === "environment";
  if (rear) {
    await openCamera(video, { facingMode: "user" });
    stage?.classList.remove("is-rear");
  }
  try {
    return await runFaceCheck(video, "/api/whiteking/face", check, (text) => showFacePrompt(check.name, text));
  } finally {
    if (rear && state.view === "station") {
      stage?.classList.add("is-rear");
      await openCamera(video, { facingMode: "environment" }).catch(() => startStationCamera());
    }
  }
}

async function stationScan(token) {
  const wk = state.wk;
  const resume = (delay) =>
    setTimeout(() => {
      if (state.wk === wk && state.camera && state.view === "station") {
        state.scanning = true;
        loopScan();
      }
    }, delay);
  if (!wk) return;
  if (token === wk.lastToken && Date.now() - wk.lastTokenAt < 30000) {
    resume(600);
    return;
  }
  wk.lastToken = token;
  wk.lastTokenAt = Date.now();
  const status = document.querySelector("#scan-status");
  if (status) status.textContent = "Шалгаж байна…";
  try {
    let result = await api("/api/whiteking/scan", { method: "POST", body: JSON.stringify({ token }) });
    if (result.step === "face") result = await stationFace(result);
    if (!result.ok) wk.lastToken = "";
    if (result.reason === "cancelled") {
      const node = document.querySelector("#wk-result");
      node.hidden = true;
      delete node.dataset.prompt;
      if (status) status.textContent = "QR кодоо камерт үзүүлнэ үү";
      resume(600);
      return;
    }
    showScanResult(result);
    if (wk.data && result.scans) wk.data.scans = result.scans;
    paintStation();
    if (result.ok && result.speech) wkSay({ text: result.speech, label: "Ирц", at: new Date().toISOString() });
  } catch (error) {
    showScanResult({ ok: false, error: error.message });
  }
  if (status) status.textContent = "QR кодоо камерт үзүүлнэ үү";
  resume(2500);
}

function wkPlanHtml(data) {
  const minute = wkNowMinute(data.clock);
  return data.plan
    .map((item) => {
      const past = wkMinutes(item.time) <= minute;
      const badge = item.fired
        ? `<span class="wk-tag done">${item.kind === "light" && !item.text ? "Хийгдсэн" : "Хэлсэн"}</span>`
        : past
          ? `<span class="wk-tag">Өнгөрсөн</span>`
          : `<span class="wk-tag next">Хүлээгдэж буй</span>`;
      const kindIcon = item.kind === "light" ? "bulb" : "speaker";
      return `<li class="${past ? "is-past" : ""}">
          <time>${esc(item.time)}</time>
          <span class="wk-plan-ico">${wkIcon(kindIcon)}</span>
          <div><b>${esc(item.label)}</b>${item.text ? `<small>${esc(item.text)}</small>` : `<small class="muted">Хоолойгоор хэлэхгүй</small>`}</div>
          ${badge}
          ${item.text ? `<button type="button" class="ghost wk-play" data-action="wk-preview" data-text="${esc(item.text)}" aria-label="Сонсох">${wkIcon("play")}</button>` : ""}
        </li>`;
    })
    .join("");
}

const WK_LOG_FILTERS = [
  ["all", "Бүгд", null],
  ["say", "Мэдэгдэл", ["say"]],
  ["light", "Гэрэл", ["light"]],
  ["scan", "Ирц", ["scan", "face"]],
  ["config", "Тохиргоо", ["config"]],
  ["error", "Алдаа", ["error"]],
];

function wkLogFilterHtml() {
  return WK_LOG_FILTERS.map(
    ([key, label]) => `<button type="button" class="chip${state.wkLogKind === key ? " on" : ""}" aria-pressed="${state.wkLogKind === key}" data-action="wk-log-filter" data-kind="${key}">${label}</button>`,
  ).join("");
}

function wkLogHtml(data) {
  const kinds = WK_LOG_FILTERS.find(([key]) => key === state.wkLogKind)?.[2];
  const log = kinds ? data.log.filter((item) => kinds.includes(item.kind)) : data.log;
  if (!log.length) return `<li class="muted">${data.log.length ? "Энэ төрлийн бичлэг алга." : "Бүртгэл хоосон байна."}</li>`;
  return log
    .slice(0, 60)
    .map(
      (item) => `<li class="wk-log-${esc(item.kind)}">
        <span class="wk-plan-ico">${wkIcon(WK_LOG_ICON[item.kind] || "log")}</span>
        <div><b>${esc(WK_LOG_LABEL[item.kind] || item.kind)}</b><small>${esc(item.text)}</small></div>
        <time datetime="${esc(item.at)}">${esc(timeLabel(item.at) || clockLabel(item.at))}</time>
      </li>`,
    )
    .join("");
}

function wkStationsHtml(data) {
  if (!data.stations.length) return `<p class="muted">Станц холбогдоогүй байна. White Queen эрхээр нэвтэрсэн төхөөрөмж энд харагдана.</p>`;
  return `<ul class="wk-stations">${data.stations
    .map((item) => `<li class="${item.online ? "is-online" : ""}"><i></i><b>${esc(item.name)}</b><span>${esc(item.ip)} · ${item.online ? "Онлайн" : `сүүлд ${esc(timeLabel(item.seen) || clockLabel(item.seen))}`}</span></li>`)
    .join("")}</ul>`;
}

function wkStatsHtml(data) {
  const online = data.stations.filter((item) => item.online).length;
  const next = wkUpcoming(data.plan, data.clock, 1)[0];
  const said = data.plan.filter((item) => item.fired && item.text).length;
  const stat = (value, label) => `<div><b>${value}</b><span>${label}</span></div>`;
  return `${stat(online, "Онлайн станц")}${stat(said, "Өнөөдөр хэлсэн")}${stat(data.scans.length, "Ирцийн уншуулалт")}${stat(next ? esc(next.time) : "–", "Дараагийн мэдэгдэл")}`;
}

function wkLiveHtml(data) {
  return `<div class="wk-lamps">${wkLightsHtml(data.lights, true)}</div>`;
}

function wkConnHtml(data) {
  return `<h3>${wkIcon("station")}Станцууд</h3>
    ${wkStationsHtml(data)}
    <h3>${wkIcon("qr")}Станцын төхөөрөмж</h3>
    ${wkDevicesHtml(data)}`;
}

function wkDevicesHtml(data) {
  const devices = data.devices || [];
  if (!devices.length) return `<p class="muted">Зөвшөөрсөн төхөөрөмж алга. White Queen аппыг утсан дээр нээхэд холбогдох хүсэлт энд гарна.</p>`;
  return `<ul class="wk-stations wk-devices">${devices
    .map((device) => {
      const id = esc(device.id);
      if (device.status === "pending") {
        return `<li class="is-pending"><i></i><b>${esc(device.name)}</b><span>Код <b>${esc(device.code)}</b> · зөвшөөрөл хүлээж байна</span>
          <button type="button" class="chip on" data-action="wk-device-approve" data-id="${id}">Зөвшөөрөх</button>
          <button type="button" class="chip" data-action="wk-device-remove" data-id="${id}">Татгалзах</button></li>`;
      }
      const seen = device.lastSeen ? `сүүлд нэвтэрсэн ${esc(timeLabel(device.lastSeen) || clockLabel(device.lastSeen))}` : "хараахан нэвтрээгүй";
      return `<li class="is-online"><i></i><b>${esc(device.name)}</b><span>Код ${esc(device.code)} · ${seen}</span>
        <button type="button" class="chip" data-action="wk-device-remove" data-id="${id}" data-approved="1">Хасах</button></li>`;
    })
    .join("")}</ul>`;
}

function wkField(label, name, value, attrs = "", hint = "") {
  return `<label><span>${label}${hint ? `<small class="wk-hint-inline">${hint}</small>` : ""}</span><input name="${name}" value="${esc(value)}" ${attrs} /></label>`;
}

function wkText(label, name, value, { rows = 2, max = 300, hint = "" } = {}) {
  const text = String(value ?? "");
  return `<div class="wk-text">
      <label><span>${label}${hint ? `<small class="wk-hint-inline">${hint}</small>` : ""}</span><textarea name="${name}" rows="${rows}" maxlength="${max}" data-wk-text>${esc(text)}</textarea></label>
      <div class="wk-text-tools">
        <button type="button" class="chip wk-try" data-action="wk-try" data-tip="Орлуулах үгсийг одоогийн утгаар бөглөж сонсгоно">${wkIcon("play")}Сонсох</button>
        <small class="wk-count" data-count>${text.length}/${max}</small>
      </div>
    </div>`;
}

function wkSwitch(label, name, checked, hint = "") {
  return `<label class="wk-switch"><input type="checkbox" role="switch" name="${name}"${checked ? " checked" : ""} /><i aria-hidden="true"></i><span>${label}${hint ? `<small>${hint}</small>` : ""}</span></label>`;
}

function wkValidTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ""));
}

/** The 24-hour strip of a lighting zone, lit while the lights are scheduled on (wrapping past midnight). */
function wkDayBar(on, off) {
  if (!wkValidTime(on) || !wkValidTime(off)) return "";
  const start = wkMinutes(on) / 14.4;
  const end = wkMinutes(off) / 14.4;
  const parts = start === end ? [] : start < end ? [[start, end]] : [[start, 100], [0, end]];
  return `<span class="wk-day" aria-hidden="true">${parts.map(([from, to]) => `<i style="left:${from}%;width:${to - from}%"></i>`).join("")}</span>`;
}

function wkWarnMinutes(before, every) {
  const list = [];
  for (let minutes = Number(before) || 0; minutes > 0 && Number(every) > 0 && list.length < 60; minutes -= Number(every)) list.push(minutes);
  return list;
}

function wkWarnHint(zone) {
  const list = wkWarnMinutes(zone.warnBefore, zone.warnEvery);
  if (!list.length) return "Сануулга унтраалттай.";
  if (!String(zone.warnText || "").trim()) return "Сануулах үг хоосон тул сануулахгүй.";
  const at = wkValidTime(zone.off) ? list.map((minutes) => `${clockOf(wkMinutes(zone.off) - minutes)}`) : [];
  return `Унтрахаас ${list.join(", ")} минутын өмнө, нийт ${list.length} удаа сануулна${at.length ? ` (${at.join(", ")})` : ""}.`;
}

function clockOf(minute) {
  const value = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

/** One-line summaries shown on the folded settings sections, from saved or in-progress form values. */
function wkSummaries(config) {
  const off = `<span class="wk-pill">Унтраалттай</span>`;
  const on = (text) => `<span class="wk-pill is-on">${text}</span>`;
  const sums = {
    general: `${config.voice ? on("Хоолойтой") : off}${config.chime ? on("Хонхтой") : ""}`,
    morning: config.morning?.enabled ? on(esc(config.morning.time || "–")) : off,
    scan: config.scan?.enabled ? on("Идэвхтэй") : off,
  };
  (config.zones || []).forEach((zone, index) => {
    const warns = String(zone.warnText || "").trim() ? wkWarnMinutes(zone.warnBefore, zone.warnEvery).length : 0;
    sums[`zone${index}`] = `${on(`${esc(zone.on)}–${esc(zone.off)}`)}${warns ? `<span class="wk-pill">${warns} сануулга</span>` : ""}${wkDayBar(zone.on, zone.off)}`;
  });
  const custom = (config.custom || []).filter((item) => String(item.text || "").trim());
  const active = custom.filter((item) => item.enabled !== false);
  sums.custom = custom.length ? `${on(`${active.length} идэвхтэй`)}${custom.length > active.length ? `<span class="wk-pill">${custom.length - active.length} унтраалттай</span>` : ""}` : `<span class="wk-pill">Хоосон</span>`;
  return sums;
}

function wkSection(key, iconName, title, body, sums, open) {
  return `<details class="wk-sec" data-sec="${key}"${open.has(key) ? " open" : ""}>
      <summary><span class="wk-sec-ico">${wkIcon(iconName)}</span><b>${title}</b><span class="wk-sum" data-sum="${key}">${sums[key] || ""}</span><span class="wk-chev">${wkIcon("chevron")}</span></summary>
      <div class="wk-sec-body">${body}</div>
    </details>`;
}

function wkCustomRow(item, index) {
  return `<div class="wk-custom" data-wk-custom>
      <input type="hidden" name="custom.${index}.id" value="${esc(item.id || "")}" />
      ${wkSwitch("Идэвхтэй", `custom.${index}.enabled`, item.enabled !== false)}
      ${wkField("Цаг", `custom.${index}.time`, item.time || "12:00", 'type="time" required')}
      ${wkText("Хэлэх үг", `custom.${index}.text`, item.text || "", { rows: 2 })}
      <button type="button" class="ghost wk-del" data-action="wk-custom-remove" aria-label="Мэдэгдэл устгах" data-tip="Устгах">${adminIcon("trash")}</button>
    </div>`;
}

function wkConfigForm(data, open = state.wkOpen) {
  const config = data.config;
  const sums = wkSummaries(config);
  const zones = config.zones
    .map((zone, index) =>
      wkSection(
        `zone${index}`,
        "bulb",
        esc(zone.name),
        `<div data-zone-index="${index}" class="stack">
          <input type="hidden" name="zones.${index}.id" value="${esc(zone.id)}" />
          <div class="wk-grid3">
            ${wkField("Бүсийн нэр", `zones.${index}.name`, zone.name, 'maxlength="40" required')}
            ${wkField("Гэрэл асах", `zones.${index}.on`, zone.on, 'type="time" required')}
            ${wkField("Гэрэл унтрах", `zones.${index}.off`, zone.off, 'type="time" required')}
          </div>
          <div class="wk-sub">
            <h4>${wkIcon("bell")}Унтрахаас өмнөх сануулга</h4>
            <div class="form-grid">
              ${wkField("Хэдэн минутын өмнөөс", `zones.${index}.warnBefore`, zone.warnBefore, 'type="number" min="0" max="60" required', "0 = сануулахгүй")}
              ${wkField("Хэдэн минут тутам", `zones.${index}.warnEvery`, zone.warnEvery, 'type="number" min="1" max="30" required')}
            </div>
            <p class="wk-hint" data-warn="${index}">${esc(wkWarnHint(zone))}</p>
            ${wkText("Сануулах үг", `zones.${index}.warnText`, zone.warnText, { hint: "{minutes} — үлдсэн минут" })}
          </div>
          <div class="form-grid wk-pair">
            ${wkText("Гэрэл асахад хэлэх үг", `zones.${index}.onText`, zone.onText, { hint: "Хоосон бол хэлэхгүй" })}
            ${wkText("Гэрэл унтрахад хэлэх үг", `zones.${index}.offText`, zone.offText, { hint: "Хоосон бол хэлэхгүй" })}
          </div>
          <details class="wk-adv" data-sec="adv${index}"${open.has(`adv${index}`) ? " open" : ""}>
            <summary>Бодит гэрлийн реле холбох (webhook) · нарийвчилсан</summary>
            <div class="form-grid">
              ${wkField("Асаах холбоос", `zones.${index}.webhookOn`, zone.webhookOn, 'type="url" placeholder="http://192.168.1.50/relay/0?turn=on"')}
              ${wkField("Унтраах холбоос", `zones.${index}.webhookOff`, zone.webhookOff, 'type="url" placeholder="http://192.168.1.50/relay/0?turn=off"')}
            </div>
          </details>
        </div>`,
        sums,
        open,
      ),
    )
    .join("");
  const chips = Object.entries(data.placeholders)
    .map(([key, label]) => `<button type="button" class="chip wk-ph" data-action="wk-insert" data-token="{${esc(key)}}" data-tip="${esc(label)}">{${esc(key)}}<small>${esc(label)}</small></button>`)
    .join("");
  const dirty = state.wkDirty;
  return `<form class="wk-config${dirty ? " is-dirty" : ""}" data-form="wk-config" autocomplete="off" novalidate>
      ${wkSection(
        "general",
        "speaker",
        "Ерөнхий",
        `<div class="wk-switches">
          ${wkSwitch("Станц хоолойгоор хэлнэ", "voice", config.voice, "Унтраавал бүх мэдэгдэл зөвхөн дэлгэцэнд гарна")}
          ${wkSwitch("Мэдэгдлийн өмнө хонх дуугарна", "chime", config.chime)}
        </div>`,
        sums,
        open,
      )}
      ${wkSection(
        "morning",
        "sunrise",
        "Өглөөний мэндчилгээ",
        `<div class="wk-row">
          ${wkSwitch("Идэвхтэй", "morning.enabled", config.morning.enabled)}
          ${wkField("Цаг", "morning.time", config.morning.time, 'type="time" required')}
        </div>
        ${wkText("Хэлэх үг", "morning.text", config.morning.text, { rows: 4, max: 400, hint: "{temp}, {windDir}, {precip} зэрэг цаг агаарын үгс ашиглаж болно" })}`,
        sums,
        open,
      )}
      ${zones}
      ${wkSection(
        "scan",
        "qr",
        "Ирц бүртгэхэд хэлэх үг",
        `${wkSwitch("Идэвхтэй", "scan.enabled", config.scan.enabled)}
        <div class="form-grid wk-pair">
          ${wkText("Ирэхэд", "scan.inText", config.scan.inText, { max: 200, hint: "{name} — ажилтны нэр" })}
          ${wkText("Гарахад", "scan.outText", config.scan.outText, { max: 200, hint: "{name} — ажилтны нэр" })}
        </div>`,
        sums,
        open,
      )}
      ${wkSection(
        "custom",
        "megaphone",
        "Нэмэлт цагийн мэдэгдэл",
        `<div id="wk-custom-list">${config.custom.map(wkCustomRow).join("")}</div>
        <p class="muted wk-empty">Өдөр бүр тогтсон цагт хэлүүлэх мэдэгдэл алга.</p>
        <button type="button" class="chip" data-action="wk-custom-add">${wkIcon("plus")}Мэдэгдэл нэмэх</button>`,
        sums,
        open,
      )}
      <div class="wk-ph-list" id="wk-ph" hidden><span>Орлуулах үг нэмэх:</span>${chips}</div>
      <div class="wk-savebar" role="region" aria-label="Хадгалах">
        <span class="wk-save-msg" role="status">${dirty ? "Хадгалаагүй өөрчлөлт байна" : "Бүх өөрчлөлт хадгалагдсан"}</span>
        <button type="button" class="chip" data-action="wk-config-reset"${dirty ? "" : " disabled"}>Буцаах</button>
        <button class="primary" type="submit"${dirty ? "" : " disabled"}>Хадгалах</button>
      </div>
    </form>`;
}

const WK_TABS = [
  ["live", "Хяналт", "bulb"],
  ["plan", "Өнөөдрийн хуваарь", "clock"],
  ["config", "Тохиргоо", "config"],
  ["log", "Бүртгэл", "log"],
];

const WK_SAY_PRESETS = [
  "10 минутын дараа хурал эхэлнэ.",
  "Үдийн цайны цаг боллоо.",
  "Ажлын цаг дууслаа. Сайхан амраарай.",
  "Анхааруулга! Галын аюулгүй байдлын сургуулилт эхэлж байна.",
];

function wkPending(data) {
  return (data.devices || []).filter((device) => device.status === "pending").length;
}

function wkTabsHtml(data) {
  const pending = wkPending(data);
  return WK_TABS.map(([key, label, iconName]) => {
    const active = state.wkTab === key;
    const extra =
      key === "live"
        ? `<em class="wk-badge" id="wka-pending" data-tip="Зөвшөөрөл хүлээж буй төхөөрөмж"${pending ? "" : " hidden"}>${pending}</em>`
        : key === "config"
          ? `<i class="wk-dirty-dot" id="wka-dirty" data-tip="Хадгалаагүй өөрчлөлт"${state.wkDirty ? "" : " hidden"}></i>`
          : "";
    return `<button type="button" role="tab" class="seg-tab wk-tab${active ? " is-active" : ""}" aria-selected="${active}" data-action="wk-tab" data-tab="${key}">${wkIcon(iconName)}<span>${label}</span>${extra}</button>`;
  }).join("");
}

function wkAdminView() {
  const data = state.wkAdmin;
  if (!data) {
    return `<div class="admin-page">
        <section class="panel admin-head">
          <div class="admin-shield wk-shield">${wkIcon("crown")}</div>
          <div class="profile-who"><b>White Queen</b><span>Станц · гэрэлтүүлэг · хоолойн мэдэгдэл</span></div>
        </section>
        ${adminLoading()}
      </div>`;
  }
  const pane = (key) => `class="wk-pane" data-pane="${key}" role="tabpanel"${state.wkTab === key ? "" : " hidden"}`;
  return `
    <div class="admin-page wk-admin">
      <section class="panel admin-hero">
        <div class="admin-shield wk-shield">${wkIcon("crown")}</div>
        <div class="profile-who">
          <b>White Queen</b>
          <span>Ирц бүртгэх станц · гэрэлтүүлгийн хуваарь · цагийн хоолойн мэдэгдэл</span>
        </div>
        <div class="admin-stats" id="wka-stats">${wkStatsHtml(data)}</div>
      </section>
      <div class="seg-tabs wk-tabs" role="tablist" aria-label="White Queen">${wkTabsHtml(data)}</div>
      <div ${pane("live")}>
        <section class="panel">
          <h2>${wkIcon("bulb")}Гэрэлтүүлэг</h2>
          <div id="wka-live">${wkLiveHtml(data)}</div>
          <p class="muted wk-note">Гараар асаасан/унтраасан төлөв дараагийн хуваарийн цаг хүртэл үйлчилнэ. Хуваарийг "Тохиргоо" хэсгээс өөрчилнө.</p>
        </section>
        <form class="panel stack" data-form="wk-say">
          <h2>${wkIcon("speaker")}Шууд хэлүүлэх</h2>
          <div class="wk-presets">${WK_SAY_PRESETS.map((text) => `<button type="button" class="chip" data-action="wk-say-preset" data-text="${esc(text)}">${esc(text)}</button>`).join("")}</div>
          <label>Станцаар одоо хэлүүлэх үг<textarea name="text" rows="2" maxlength="400" required placeholder="Бэлэн загвараас сонгох эсвэл өөрөө бичнэ үү"></textarea></label>
          <div class="wk-actions">
            <button class="primary" type="submit">${wkIcon("speaker")}Станцаар хэлүүлэх</button>
            <button type="button" class="chip" data-action="wk-say-local">${wkIcon("play")}Энд сонсох</button>
          </div>
        </form>
        <section class="panel">
          <h2>${wkIcon("station")}Станц ба төхөөрөмж</h2>
          <div id="wka-conn">${wkConnHtml(data)}</div>
        </section>
      </div>
      <div ${pane("plan")}>
        <section class="panel">
          <div class="wk-head-row">
            <h2>${adminIcon("clock")}Өнөөдрийн хуваарь</h2>
            <button type="button" class="chip" data-action="wk-tab" data-tab="config">${wkIcon("config")}Хуваарь өөрчлөх</button>
          </div>
          <ol class="wk-plan wk-plan-admin" id="wka-plan">${wkPlanHtml(data)}</ol>
        </section>
      </div>
      <div ${pane("config")}>${wkConfigForm(data)}</div>
      <div ${pane("log")}>
        <section class="panel">
          <h2>${wkIcon("log")}Үйл явдлын бүртгэл</h2>
          <div class="wk-filter" id="wka-log-filter" role="group" aria-label="Төрлөөр шүүх">${wkLogFilterHtml()}</div>
          <ol class="wk-log" id="wka-log">${wkLogHtml(data)}</ol>
        </section>
      </div>
    </div>`;
}

function paintWkAdmin() {
  const data = state.wkAdmin;
  if (state.view !== "whiteking" || !data) return;
  for (const [id, html] of [
    ["#wka-stats", wkStatsHtml(data)],
    ["#wka-live", wkLiveHtml(data)],
    ["#wka-conn", wkConnHtml(data)],
    ["#wka-plan", wkPlanHtml(data)],
    ["#wka-log", wkLogHtml(data)],
  ]) {
    const node = stage.querySelector(id);
    if (!node || state.wkPainted[id] === html) continue;
    const scroll = node.scrollTop;
    node.innerHTML = html;
    node.scrollTop = scroll;
    state.wkPainted[id] = html;
  }
  const badge = stage.querySelector("#wka-pending");
  if (badge) {
    const pending = wkPending(data);
    badge.textContent = pending;
    badge.hidden = !pending;
  }
}

function wkSetTab(tab) {
  if (!WK_TABS.some(([key]) => key === tab)) return;
  state.wkTab = tab;
  localStorage.setItem("wq-admin-tab", tab);
  for (const pane of stage.querySelectorAll(".wk-pane")) pane.hidden = pane.dataset.pane !== tab;
  for (const button of stage.querySelectorAll(".wk-tab")) {
    const active = button.dataset.tab === tab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

function wkConfigFormNode() {
  return stage.querySelector("[data-form='wk-config']");
}

/** Rebuilds the settings form from the saved config, keeping folded/unfolded sections as they were. */
function paintWkConfig() {
  const form = wkConfigFormNode();
  if (!form || !state.wkAdmin) return;
  state.wkOpen = new Set([...form.querySelectorAll("details[open]")].map((node) => node.dataset.sec));
  form.outerHTML = wkConfigForm(state.wkAdmin);
}

function wkSaveState(text, tone = "") {
  const form = wkConfigFormNode();
  if (!form) return;
  const dirty = state.wkDirty;
  form.classList.toggle("is-dirty", dirty);
  form.querySelector("[data-action='wk-config-reset']").disabled = !dirty;
  form.querySelector("button[type='submit']").disabled = !dirty;
  const message = form.querySelector(".wk-save-msg");
  message.textContent = text || (dirty ? "Хадгалаагүй өөрчлөлт байна" : "Бүх өөрчлөлт хадгалагдсан");
  message.className = `wk-save-msg${tone ? ` is-${tone}` : ""}`;
  const dot = stage.querySelector("#wka-dirty");
  if (dot) dot.hidden = !dirty;
}

/** Marks the settings as edited and refreshes the live hints: section summaries, warning times, character counts. */
function wkConfigChanged(form, field) {
  if (!state.wkDirty) {
    state.wkDirty = true;
    wkSaveState();
  }
  const values = wkConfigData(form);
  const sums = wkSummaries(values);
  for (const node of form.querySelectorAll("[data-sum]")) {
    const html = sums[node.dataset.sum] || "";
    if (node.innerHTML !== html) node.innerHTML = html;
  }
  values.zones.forEach((zone, index) => {
    const hint = form.querySelector(`[data-warn="${index}"]`);
    if (hint) hint.textContent = wkWarnHint(zone);
    const title = form.querySelector(`[data-sec="zone${index}"] > summary b`);
    if (title && zone.name) title.textContent = zone.name;
  });
  if (field?.matches?.("textarea")) {
    const count = field.closest(".wk-text")?.querySelector("[data-count]");
    if (count) count.textContent = `${field.value.length}/${field.maxLength}`;
  }
}

/** Fills placeholders with today's values so the admin hears roughly what the station will say. */
function wkSampleText(field) {
  const data = state.wkAdmin || {};
  const weather = data.weather;
  const zone = field.closest("[data-zone-index]");
  const now = new Date();
  const two = (value) => String(value).padStart(2, "0");
  const signed = (value) => {
    const rounded = Math.round(value);
    return rounded < 0 ? `хасах ${Math.abs(rounded)}` : String(rounded);
  };
  const unknown = "тодорхойгүй";
  const context = {
    time: `${two(now.getHours())} цаг ${two(now.getMinutes())} минут`,
    weekday: `${["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"][now.getDay()]} гараг`,
    date: `${now.getMonth() + 1} сарын ${now.getDate()}`,
    temp: weather ? signed(weather.tempC) : unknown,
    feels: weather ? signed(weather.feelsLikeC) : unknown,
    wind: weather ? String(Math.round(weather.windSpeedMs)) : unknown,
    windDir: weather?.windFrom || "",
    condition: String(weather?.condition || "").toLowerCase(),
    precip: "",
    name: state.me?.displayName || "Бат",
    zone: zone?.querySelector("[name$='.name']")?.value || "",
    minutes: String(Number(zone?.querySelector("[name$='.warnBefore']")?.value) || 10),
  };
  return field.value
    .replace(/\{(\w+)\}/g, (match, key) => context[key] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

function wkShowTokens(field) {
  const bar = stage.querySelector("#wk-ph");
  const host = field.closest("[data-wk-custom]") || field.closest(".wk-pair") || field.closest(".wk-text");
  if (!bar || !host) return;
  if (bar.previousElementSibling !== host) host.after(bar);
  bar.hidden = false;
}

function wkInvalidText(field) {
  const label = field.closest("label")?.querySelector("span")?.firstChild?.textContent?.trim() || "Талбар";
  const section = field.closest(".wk-sec")?.querySelector("summary b")?.textContent;
  const { validity } = field;
  const reason = validity.valueMissing
    ? "бөглөнө үү"
    : validity.rangeUnderflow || validity.rangeOverflow || validity.stepMismatch
      ? `${field.min}–${field.max} хооронд бүхэл тоо оруулна уу`
      : validity.typeMismatch
        ? "http:// эсвэл https://-ээр эхэлсэн хаяг оруулна уу"
        : "утга буруу байна";
  return `${section ? `${section} · ` : ""}${label}: ${reason}`;
}

function wkReveal(field) {
  wkSetTab("config");
  for (let node = field.closest("details"); node; node = node.parentElement?.closest("details")) node.open = true;
  field.scrollIntoView({ block: "center", behavior: "smooth" });
  field.focus({ preventScroll: true });
}

function wkLeaveConfig() {
  if (!state.wkDirty) return true;
  if (!confirm("White Queen-ийн тохиргоонд хадгалаагүй өөрчлөлт байна. Хадгалахгүйгээр гарах уу?")) return false;
  state.wkDirty = false;
  return true;
}

async function loadWkAdmin() {
  try {
    const first = !state.wkAdmin;
    state.wkAdmin = await api("/api/admin/whiteking");
    if (state.view !== "whiteking") return;
    if (first) render();
    else paintWkAdmin();
  } catch (error) {
    stage.insertAdjacentHTML("afterbegin", `<p class="error">${esc(error.message)}</p>`);
  }
}

async function refreshWkAdmin() {
  if (state.view !== "whiteking" || !state.wkAdmin) return;
  try {
    state.wkAdmin = await api("/api/admin/whiteking");
    paintWkAdmin();
  } catch {
    /* keep the last good screen */
  }
}

function wkConfigData(form) {
  const data = {};
  for (const element of form.elements) {
    if (!element.name) continue;
    const value = element.type === "checkbox" ? element.checked : element.value;
    const path = element.name.split(".");
    let node = data;
    for (const key of path.slice(0, -1)) node = node[key] ||= {};
    node[path.at(-1)] = value;
  }
  data.zones = Object.values(data.zones || {});
  data.custom = Object.values(data.custom || {});
  return data;
}

function wkPreview(text) {
  if (!text) return;
  primeAudio();
  speak(text, { serverTts: Boolean(state.wkAdmin?.tts), voice: "queen", onError: (message) => flash("[data-form='wk-say']", message, false) });
}

function kcalLabel(value) {
  return value == null ? "–" : `${Math.round(value).toLocaleString("mn-MN")} ккал`;
}

function macroLine(item) {
  const parts = [["Уураг", item.protein], ["Өөх", item.fat], ["Нүүрс ус", item.carbs]].filter(([, value]) => value != null);
  return parts.length ? parts.map(([label, value]) => `${label} ${value} г`).join(" · ") : "";
}

function menuSelect(name, values, labels, current) {
  return `<select class="inline-select" name="${name}" required>${values.map((value) => `<option value="${value}"${value === current ? " selected" : ""}>${labels[value]}</option>`).join("")}</select>`;
}

/** The dish form, empty for a new dish or filled in to edit one; blank calories mean "let AI estimate". */
function menuForm(item = null) {
  const manual = item?.source === "manual";
  return `<form class="menu-form${item ? " is-edit" : ""}" data-form="${item ? "menu-edit" : "menu-add"}"${item ? ` data-id="${esc(item.id)}"` : ""} autocomplete="off">
      <label class="plan-field"><small>Хоолны цаг</small>${menuSelect("meal", MENU_MEALS, MENU_MEAL_LABEL, item?.meal || state.menuMeal || "lunch")}</label>
      <label class="plan-field"><small>Төрөл</small>${menuSelect("category", MENU_CATEGORIES, MENU_CATEGORY_LABEL, item?.category || "main")}</label>
      <label class="plan-field menu-name"><small>Хоолны нэр</small><input name="name" maxlength="80" required value="${esc(item?.name || "")}" placeholder="Жишээ нь: Гурилтай шөл" /></label>
      <label class="plan-field"><small>Порц (г/мл)</small><input name="portion" type="number" min="1" max="2000" value="${item?.portion ?? ""}" placeholder="Заавал биш" /></label>
      <label class="plan-field"><small>Калори</small><input name="kcal" type="number" min="0" max="5000" value="${manual ? item.kcal : ""}" placeholder="${item?.kcal != null && !manual ? `AI: ${item.kcal}` : "AI тооцно"}" /></label>
      <label class="plan-field menu-note"><small>Тайлбар</small><input name="note" maxlength="120" value="${esc(item?.note || "")}" placeholder="Заавал биш" /></label>
      <div class="menu-form-actions">
        <button class="primary" type="submit">${item ? "Хадгалах" : "Нэмэх"}</button>
        ${item ? `<button class="chip" type="button" data-action="menu-cancel">Болих</button>` : ""}
      </div>
    </form>`;
}

function menuRow(item, index) {
  if (state.menuEdit === item.id) return `<li class="menu-item is-editing">${menuForm(item)}</li>`;
  const kcal =
    item.kcal == null
      ? `<span class="menu-kcal is-pending" title="${esc(item.kcalError || "")}">Тооцоогүй</span>`
      : `<span class="menu-kcal">${kcalLabel(item.kcal)}<small>${item.source === "manual" ? "гараар" : "AI"}</small></span>`;
  const sub = [item.portion ? `${item.portion} ${item.unit}` : "", macroLine(item), item.note ? esc(item.note) : "", item.aiNote ? `AI: ${esc(item.aiNote)}` : ""].filter(Boolean).join(" · ");
  return `<li class="menu-item row-in" style="--i:${Math.min(index, 14)}">
      <span class="menu-cat is-${item.category}">${MENU_CATEGORY_LABEL[item.category]}</span>
      <div class="menu-what"><b>${esc(item.name)}</b>${sub ? `<small>${sub}</small>` : ""}</div>
      ${kcal}
      <div class="menu-actions">
        <button class="icon-btn" type="button" data-action="menu-estimate" data-id="${esc(item.id)}" title="AI-аар дахин тооцох" aria-label="AI-аар дахин тооцох">${adminIcon("renew")}</button>
        <button class="icon-btn" type="button" data-action="menu-edit" data-id="${esc(item.id)}" title="Засах" aria-label="Засах">${adminIcon("edit")}</button>
        <button class="icon-btn" type="button" data-action="menu-delete" data-id="${esc(item.id)}" title="Устгах" aria-label="Устгах">${adminIcon("trash")}</button>
      </div>
    </li>`;
}

function menuDays(data) {
  return data.days
    .map((day) => {
      const weekday = weekdayOf(day.date);
      return `<button type="button" class="menu-day${day.date === data.date ? " is-active" : ""}${day.date === data.today ? " is-today" : ""}${day.count ? "" : " is-empty"}" data-action="menu-day" data-date="${day.date}">
          <small>${WEEKDAY_SHORT[weekday]}</small><b>${Number(day.date.slice(8))}</b><span>${day.count ? `${day.count} хоол` : "–"}</span>
        </button>`;
    })
    .join("");
}

function kitchenMenuView() {
  const data = state.kitchen;
  if (!data) return adminLoading();
  const byMeal = MENU_MEALS.map((meal) => {
    const items = data.items.filter((item) => item.meal === meal);
    return `<section class="menu-meal">
        <h3>${MENU_MEAL_LABEL[meal]} <span>${items.length ? kcalLabel(data.totals.meals[meal]) : "хоол ороогүй"}</span></h3>
        ${items.length ? `<ul class="menu-list">${items.map(menuRow).join("")}</ul>` : ""}
      </section>`;
  }).join("");
  const day = data.date === data.today ? "Өнөөдөр" : relativeDay(data.today, data.date);
  return `
    <div class="admin-page kitchen-page">
      <section class="panel admin-hero">
        <div class="admin-shield">${icon("meal")}</div>
        <div class="profile-who">
          <b>Хоолны цэс · ${esc(day)}</b>
          <span>${shortDate(data.date)} ${WEEKDAY_SHORT[weekdayOf(data.date)]} · калорийг AI автоматаар тооцно, хүссэн үедээ гараар засна.</span>
        </div>
        <div class="admin-stats menu-stats">
          <div><b>${data.items.length}</b><span>Хоол</span></div>
          <div><b>${kcalLabel(data.totals.total)}</b><span>Нийт калори</span></div>
          ${MENU_MEALS.filter((meal) => data.totals.meals[meal]).map((meal) => `<div><b>${kcalLabel(data.totals.meals[meal])}</b><span>${MENU_MEAL_LABEL[meal]}</span></div>`).join("")}
          ${data.totals.pending ? `<div class="is-neg"><b>${data.totals.pending}</b><span>Калори тооцоогүй</span></div>` : ""}
        </div>
      </section>
      <section class="panel">
        <div class="menu-days">${menuDays(data)}</div>
        <h2 class="menu-add-title">Хоол нэмэх</h2>
        ${menuForm()}
      </section>
      <section class="panel menu-board">${byMeal}</section>
    </div>`;
}

async function loadKitchen(date = state.menuDate) {
  try {
    state.kitchen = await api(`/api/kitchen/menu${date ? `?date=${encodeURIComponent(date)}` : ""}`);
    state.menuDate = state.kitchen.date;
    if (state.view === "menu") render();
  } catch (error) {
    stage.insertAdjacentHTML("afterbegin", `<p class="error">${esc(error.message)}</p>`);
  }
}

async function kitchenAction(path, method, body, button, okText) {
  if (button) button.disabled = true;
  try {
    const result = await api(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    state.kitchen = result;
    state.menuEdit = null;
    render();
    flash(".menu-form:not(.is-edit)", result.warning || okText, !result.warning);
    return true;
  } catch (error) {
    flash(button?.closest("form") ? `[data-form="${button.closest("form").dataset.form}"]` : ".menu-form", error.message, false);
    if (button) button.disabled = false;
    return false;
  }
}

const ADMIN_RENDER = {
  users: adminUsersView,
  account: adminAccountView,
  card: adminCardView,
  today: adminTodayView,
  staff: hrStaffView,
};

async function loadAdmin() {
  try {
    state.admin = await api(isHr() ? "/api/hr" : "/api/admin/users");
    if (managesData()) render();
  } catch (error) {
    stage.insertAdjacentHTML("afterbegin", `<p class="error">${esc(error.message)}</p>`);
  }
}

function flash(selector, text, ok = true) {
  const form = stage.querySelector(selector);
  if (!form) return;
  form.querySelector(".form-error, .form-ok")?.remove();
  form.insertAdjacentHTML("beforeend", `<p class="${ok ? "form-ok" : "form-error"}" role="status">${esc(text)}</p>`);
}

async function photoData(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 480;
  canvas.height = 608;
  const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  canvas.getContext("2d").drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.86);
}

function flipCard(node) {
  const flipped = node.classList.toggle("is-flipped");
  node.setAttribute("aria-pressed", String(flipped));
  if (flipped) state.flipped.add(node.dataset.user);
  else state.flipped.delete(node.dataset.user);
}

function render() {
  stopHardware();
  clearInterval(state.wkAdminTimer);
  clearInterval(state.meTimer);
  clearInterval(state.attTimer);
  if (isStation()) state.view = "station";
  else if (!viewAllowed(state.view)) state.view = homeFor();
  if (state.view !== "health") stopBreath();
  if (state.view !== "home" && state.briefing) {
    stopSpeaking();
    state.briefing = false;
  }
  stage.classList.toggle("is-quiet", state.view === state.renderedView);
  state.renderedView = state.view;
  renderChrome();
  if (state.view === "station") {
    stage.innerHTML = stationView();
    startStationCamera();
    return;
  }
  if (state.view === "profile") stage.innerHTML = isAdmin() ? adminProfileView() : userProfileView();
  if (state.view === "whiteking") {
    state.wkPainted = {};
    stage.innerHTML = wkAdminView();
    if (!state.wkAdmin) loadWkAdmin();
    state.wkAdminTimer = setInterval(refreshWkAdmin, 5000);
    return;
  }
  if (ADMIN_RENDER[state.view]) {
    stage.innerHTML = ADMIN_RENDER[state.view]();
    if (!state.admin) loadAdmin();
    if (state.view === "today") state.attTimer = setInterval(refreshToday, 30000);
  }
  if (state.view === "home") {
    stage.innerHTML = homeView();
    state.meTimer = setInterval(tickMe, 1000);
  }
  if (state.view === "weather") {
    stage.innerHTML = weatherView();
    openPlaceMap();
  }
  if (state.view === "attendance") {
    stage.innerHTML = attendanceView();
    state.meTimer = setInterval(tickMe, 1000);
  }
  if (state.view === "menu") {
    stage.innerHTML = kitchenMenuView();
    if (!state.kitchen) loadKitchen();
  }
  if (state.view === "vision") stage.innerHTML = visionView();
  if (state.view === "health") {
    stage.innerHTML = healthView();
    centerHealthTab(false);
  }
  if (state.view === "ask") {
    stage.innerHTML = askView();
    state.rkCore = createCore(document.querySelector("#rk-core"));
    state.rkCore.setMode(state.rk.mode || "idle");
  }
}

function openPlaceMap() {
  const container = document.querySelector("#terrain");
  const center = state.live?.location || { lat: 47.9184, lng: 106.9177 };
  let fallbackNote = "";
  const flat = state.mapMode === "flat";
  const pending = createPlaceMap(container, {
    center,
    flat,
    weatherLayer: state.terrainLayer,
    onWeather: terrainWeatherStatus,
    precipMode: flat ? "off" : state.precipMode,
    traffic: state.traffic,
    onTraffic: trafficStatus,
    onPlace(place) {
      if (!place.loading) state.placeResults = [];
      showPlace(place);
    },
    onStatus(status) {
      const node = document.querySelector("#map-status");
      if (!node) return;
      if (status.state === "fallback") {
        fallbackNote = `Google 3D ажилласангүй: ${status.message}`;
        node.className = "map-status error";
        node.textContent = `${fallbackNote}. OpenStreetMap 3D руу шилжлээ.`;
        return;
      }
      if (status.state === "error") {
        node.className = "map-status error";
        node.textContent = status.message;
        return;
      }
      if (status.provider === "google" && state.terrainLayer !== "none") terrainWeatherStatus({ state: "unsupported" });
      if (fallbackNote) return;
      node.className = "map-status";
      node.textContent =
        status.provider === "google"
          ? "Google 3D · газрын мэдээлэл Google Places"
          : status.flat
            ? "Дэлхийн газрын зураг · Sentinel-2 хиймэл дагуул"
            : "Overture Maps 3D барилга · Mapzen өндөр · Google түлхүүргүй";
    },
  });
  state.placeMap = pending;
  pending
    .then((handle) => {
      if (state.placeMap === pending) state.placeMap = handle;
      else handle.destroy();
    })
    .catch((error) => {
      const node = document.querySelector("#map-status");
      if (node) {
        node.className = "map-status error";
        node.textContent = error.message;
      }
    });
}

function showPlace(place) {
  const card = document.querySelector("#place-card");
  if (!card) return;
  card.hidden = false;
  if (place.loading) {
    card.innerHTML = `<p class="muted">${esc(place.name || "Газрын мэдээлэл")} хайж байна…</p>`;
    return;
  }
  if (place.error) {
    card.innerHTML = `<button type="button" class="card-close" data-action="place-close" aria-label="Хаах">×</button><p class="warn">${esc(place.error)}</p>`;
    return;
  }
  const rating = place.rating != null ? `<p><b>★ ${place.rating.toFixed(1)}</b> <span class="muted">${place.ratings ? `${place.ratings} үнэлгээ` : ""}</span></p>` : "";
  const today = place.hours?.length
    ? `<details><summary>Цагийн хуваарь</summary><ul class="list">${place.hours.map((line) => `<li><span>${esc(line)}</span></li>`).join("")}</ul></details>`
    : "";
  const web = /^https?:\/\//i.test(place.website || "") ? place.website : null;
  const link = /^https?:\/\//i.test(place.link || "") ? place.link : null;
  const others = state.placeResults.filter((item) => item !== place).slice(0, 5);
  const more = others.length
    ? `<div class="place-more"><span class="muted">Бусад илэрц</span>${others
        .map((item) => `<button type="button" class="link" data-action="place-pick" data-index="${state.placeResults.indexOf(item)}">${esc(item.name)}</button>`)
        .join("")}</div>`
    : "";
  card.innerHTML = `
    <button type="button" class="card-close" data-action="place-close" aria-label="Хаах">×</button>
    <h2>${esc(place.name)}</h2>
    ${place.type ? `<p class="muted">${esc(place.type)}</p>` : ""}
    ${rating}
    ${place.summary ? `<p>${esc(place.summary)}</p>` : ""}
    ${place.address ? `<p>${esc(place.address)}</p>` : ""}
    ${place.phone ? `<p>Утас: <a href="tel:${esc(place.phone)}">${esc(place.phone)}</a></p>` : ""}
    ${web ? `<p><a href="${esc(web)}" target="_blank" rel="noopener">Вэб сайт</a></p>` : ""}
    ${today}
    <p class="muted">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">${esc(place.source)} дээр нээх</a>` : esc(place.source || "")}</p>
    ${more}`;
}

function stopHardware() {
  if (state.placeMap && typeof state.placeMap.destroy === "function") state.placeMap.destroy();
  state.placeMap = null;
  state.placeResults = [];
  state.scanning = false;
  stopStream(state.camera);
  state.camera = null;
  state.rkCore?.destroy();
  state.rkCore = null;
}

function stopStream(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

async function openCamera(video, constraints = true) {
  stopStream(state.camera);
  const stream = await navigator.mediaDevices.getUserMedia({ video: constraints, audio: false });
  state.camera = stream;
  video.srcObject = stream;
  await video.play();
}

function loopScan() {
  const video = document.querySelector("#scan-video");
  if (!state.scanning || !video) return;
  if (video.readyState >= 2 && window.jsQR) {
    const canvas = loopScan.canvas || (loopScan.canvas = document.createElement("canvas"));
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(video, 0, 0);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(image.data, image.width, image.height);
    if (code?.data) {
      state.scanning = false;
      stationScan(code.data);
      return;
    }
  }
  state.scanTimer = requestAnimationFrame(loopScan);
}

async function drink(amount) {
  state.live = await api("/api/hydration", { method: "POST", body: JSON.stringify({ amountMl: amount }) });
  render();
}

nav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) return;
  if (state.view === "whiteking" && button.dataset.view !== state.view && !wkLeaveConfig()) return;
  if (button.dataset.view !== state.view) {
    cancelListening();
    stopSpeaking();
    state.rk = { status: "", mode: null };
  }
  state.view = button.dataset.view;
  render();
  if (state.view === "today") refreshToday();
  if (state.view === "whiteking") {
    if (state.wkAdmin) loadWkAdmin();
  } else if (state.admin && managesData()) loadAdmin();
});

stage.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "goto") {
    state.view = button.dataset.target;
    render();
  }
  if (action === "create-user") openCreateUser();
  if (action === "meal-open") openMealModal(button.dataset.meal);
  if (action === "flip-card") flipCard(button);
  if (action === "wk-unlock") unlockStation();
  if (action === "wk-camera") startStationCamera();
  if (action === "wk-flip" && state.wk) {
    state.wk.facing = state.wk.facing === "user" ? "environment" : "user";
    localStorage.setItem("wq-facing", state.wk.facing);
    document.querySelector(".wq")?.classList.toggle("is-rear", state.wk.facing === "environment");
    startStationCamera();
  }
  if (action === "wk-logout") document.querySelector("#logout-btn").click();
  if (action === "wk-preview") wkPreview(button.dataset.text);
  if (action === "wk-say-local") wkPreview(String(button.closest("form").elements.text.value || "").trim());
  if (action === "wk-device-approve" || action === "wk-device-remove") {
    const approve = action === "wk-device-approve";
    if (!approve && button.dataset.approved && !confirm("Энэ төхөөрөмжийг хасах уу? Утас дахин зөвшөөрөл авах хүртэл нэвтэрч чадахгүй.")) return;
    try {
      state.wkAdmin = await api(`/api/admin/whiteking/devices/${encodeURIComponent(button.dataset.id)}${approve ? "/approve" : ""}`, { method: approve ? "POST" : "DELETE", body: approve ? "{}" : undefined });
      paintWkAdmin();
    } catch (error) {
      stage.insertAdjacentHTML("afterbegin", `<p class="error">${esc(error.message)}</p>`);
    }
  }
  if (action === "wk-light") {
    try {
      state.wkAdmin = await api(`/api/admin/whiteking/lights/${encodeURIComponent(button.dataset.zone)}`, {
        method: "POST",
        body: JSON.stringify({ mode: button.dataset.mode }),
      });
      paintWkAdmin();
    } catch (error) {
      stage.insertAdjacentHTML("afterbegin", `<p class="error">${esc(error.message)}</p>`);
    }
  }
  if (action === "wk-tab") {
    wkSetTab(button.dataset.tab);
    stage.querySelector(".wk-tabs")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  if (action === "wk-log-filter") {
    state.wkLogKind = button.dataset.kind;
    stage.querySelector("#wka-log-filter").innerHTML = wkLogFilterHtml();
    const html = wkLogHtml(state.wkAdmin);
    stage.querySelector("#wka-log").innerHTML = html;
    state.wkPainted["#wka-log"] = html;
  }
  if (action === "wk-say-preset") {
    const field = button.closest("form").elements.text;
    field.value = button.dataset.text;
    field.focus();
  }
  if (action === "wk-try") {
    const field = button.closest(".wk-text")?.querySelector("textarea");
    const text = field ? wkSampleText(field) : "";
    if (text) wkPreview(text);
    else if (field) field.focus();
  }
  if (action === "wk-custom-add") {
    const list = stage.querySelector("#wk-custom-list");
    const index = Math.max(-1, ...[...list.querySelectorAll("[name$='.id']")].map((input) => Number(input.name.split(".")[1]))) + 1;
    list.insertAdjacentHTML("beforeend", wkCustomRow({ time: "12:00", text: "", enabled: true }, index));
    list.lastElementChild.querySelector("textarea").focus();
    wkConfigChanged(wkConfigFormNode());
  }
  if (action === "wk-custom-remove") {
    const row = button.closest("[data-wk-custom]");
    const bar = stage.querySelector("#wk-ph");
    if (bar && row.contains(bar)) row.after(bar);
    row.classList.add("is-leaving");
    setTimeout(() => {
      row.remove();
      wkConfigChanged(wkConfigFormNode());
    }, 180);
  }
  if (action === "wk-config-reset") {
    state.wkDirty = false;
    paintWkConfig();
    wkSaveState();
  }
  if (action === "wk-insert") {
    const field = state.wkFocus?.isConnected ? state.wkFocus : null;
    if (!field) return;
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? start;
    field.setRangeText(button.dataset.token, start, end, "end");
    field.focus();
    wkConfigChanged(field.form, field);
  }
  if (action === "admin-open") {
    state.editUser = button.dataset.id;
    state.view = button.dataset.target;
    render();
    window.scrollTo({ top: 0 });
  }
  if (action === "me-csv") downloadMeCsv();
  if (action === "staff-csv") downloadStaffCsv();
  if (action === "hist-csv") downloadHistoryCsv();
  if (action === "menu-day") {
    state.menuEdit = null;
    await loadKitchen(button.dataset.date);
  }
  if (action === "menu-edit") {
    state.menuEdit = button.dataset.id;
    render();
    stage.querySelector(".menu-form.is-edit input[name='name']")?.focus();
  }
  if (action === "menu-cancel") {
    state.menuEdit = null;
    render();
  }
  if (action === "menu-estimate") {
    button.classList.add("is-busy");
    await kitchenAction(`/api/kitchen/menu/${encodeURIComponent(button.dataset.id)}/estimate`, "POST", null, button, "Калори дахин тооцоологдлоо");
  }
  if (action === "menu-delete") {
    const item = state.kitchen?.items.find((entry) => entry.id === button.dataset.id);
    if (!confirm(`«${item?.name || "Энэ хоол"}»-ыг цэснээс хасах уу?`)) return;
    await kitchenAction(`/api/kitchen/menu/${encodeURIComponent(button.dataset.id)}`, "DELETE", null, button, "Хоол цэснээс хасагдлаа");
  }
  if (action === "hist-toggle") {
    historyFilter().open = !historyFilter().open;
    repaintHistoryPanel();
  }
  if (action === "hist-day") {
    Object.assign(historyFilter(), { day: button.dataset.date, shift: "", status: "", query: "" });
    repaintHistoryPanel();
    stage.querySelector(".att-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (action === "me-pdf") printMeReport();
  if (action === "leave-cancel") {
    if (!confirm("Энэ хүсэлтийг цуцлах уу?")) return;
    try {
      state.live = await api(`/api/leaves/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" });
      render();
      flash(".me-leaves", "Хүсэлт цуцлагдлаа");
    } catch (error) {
      flash(".me-leaves", error.message, false);
    }
  }
  if (action === "leave-decide") {
    try {
      state.admin = await api(`/api/hr/leaves/${encodeURIComponent(button.dataset.id)}`, {
        method: "POST",
        body: JSON.stringify({ status: button.dataset.status }),
      });
      paintToday();
      flash(".att-leaves", button.dataset.status === "approved" ? "Зөвшөөрлөө" : "Татгалзлаа");
    } catch (error) {
      flash(".att-leaves", error.message, false);
    }
  }
  if (action === "code-new") {
    const input = button.closest("form").elements.loginCode;
    input.value = newLoginCode();
    input.focus();
  }
  if (action === "tpl-pick") {
    state.cardLevel = Number(button.dataset.level);
    render();
  }
  if (action === "admin-delete") {
    const user = state.admin?.users.find((item) => item.id === button.dataset.id);
    if (!user || !confirm(`${user.displayName} (@${user.username}) хэрэглэгчийг устгах уу?`)) return;
    try {
      state.admin = await api(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" });
      if (state.editUser === user.id) state.editUser = null;
      render();
    } catch (error) {
      flash(".admin-users", error.message, false);
    }
  }
  if (action === "hsec") switchHealthTab(button);
  if (action === "card-export") {
    const user = state.admin?.users.find((item) => item.id === button.dataset.id);
    if (!user || !isAdmin() || button.disabled) return;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "…";
    try {
      await exportCard(user, button.dataset.format, state.flipped.has(user.id) ? "back" : "front");
    } catch (error) {
      alert(`Татаж чадсангүй: ${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }
  if (action === "card-qr-download") {
    const user = state.admin?.users.find((item) => item.id === button.dataset.id);
    if (user?.cardQr) downloadCardQr(user);
  }
  if (action === "card-qr-renew") {
    const user = state.admin?.users.find((item) => item.id === button.dataset.id);
    if (!user || !confirm(`${user.displayName}-ийн ирцийн QR-ийг шинэчлэх үү? Хуучин карт, хэвлэсэн QR шууд хүчингүй болно.`)) return;
    try {
      const result = await api(`/api/admin/users/${encodeURIComponent(user.id)}/card-qr`, { method: "POST", body: "{}" });
      state.admin = result;
      if (result.self) state.me = result.self;
      render();
      flash(".admin-users", `${user.displayName}-ийн ирцийн QR шинэчлэгдлээ`);
    } catch (error) {
      flash(".admin-users", error.message, false);
    }
  }
  if (action === "admin-photo-remove") {
    try {
      await adminPhoto(button.dataset.id, null);
      flash("#admin-editor .admin-photo", "Зураг устгагдлаа");
    } catch (error) {
      flash("#admin-editor .admin-photo", error.message, false);
    }
  }
  if (action === "card-texts-reset") {
    const form = button.closest("form");
    for (const item of CARD_TEXTS) form.elements[`t.${item.key}`].value = item.value;
    templatePreview(form);
  }
  if (action === "traffic") {
    state.traffic = !state.traffic;
    localStorage.setItem("holo-traffic", state.traffic ? "1" : "0");
    button.classList.toggle("on", state.traffic);
    button.setAttribute("aria-pressed", String(state.traffic));
    if (!state.traffic) trafficStatus({ state: "off" });
    if (typeof state.placeMap?.setTraffic === "function") state.placeMap.setTraffic(state.traffic);
  }
  if (action === "map-home") {
    if (typeof state.placeMap?.home === "function") state.placeMap.home();
  }
  if (action === "map-mode" && button.dataset.mode !== state.mapMode) {
    state.mapMode = button.dataset.mode;
    localStorage.setItem("holo-map-mode", state.mapMode);
    render();
  }
  if (action === "terrain-layer") {
    state.terrainLayer = button.dataset.layer;
    localStorage.setItem("holo-terrain-layer", state.terrainLayer);
    for (const chip of stage.querySelectorAll("[data-action='terrain-layer']")) {
      chip.classList.toggle("on", chip.dataset.layer === state.terrainLayer);
    }
    if (typeof state.placeMap?.setWeatherLayer === "function") {
      const supported = state.placeMap.setWeatherLayer(state.terrainLayer);
      if (!supported) terrainWeatherStatus({ state: state.terrainLayer === "none" ? "off" : "unsupported" });
    }
  }
  if (action === "precip-mode") {
    state.precipMode = button.dataset.mode;
    localStorage.setItem("holo-precip-mode", state.precipMode);
    for (const chip of stage.querySelectorAll("[data-action='precip-mode']")) {
      chip.classList.toggle("on", chip.dataset.mode === state.precipMode);
      chip.setAttribute("aria-pressed", String(chip.dataset.mode === state.precipMode));
    }
    state.placeMap?.setPrecipMode?.(state.precipMode);
  }
  if (action === "rk-mic") rkMic();
  if (action === "place-close") {
    const card = document.querySelector("#place-card");
    if (card) card.hidden = true;
  }
  if (action === "place-pick") {
    const place = state.placeResults[Number(button.dataset.index)];
    if (place && typeof state.placeMap?.show === "function") {
      state.placeMap.show(place);
      showPlace(place);
    }
  }
  if (action === "map-full") {
    const wrap = document.querySelector(".map-wrap");
    if (document.fullscreenElement) document.exitFullscreen();
    else wrap?.requestFullscreen?.();
  }
  if (action === "drink") drink(Number(button.dataset.ml));
  if (action === "steps" || action === "active") {
    const body = action === "steps" ? { addSteps: Number(button.dataset.add) } : { addMinutes: Number(button.dataset.min) };
    state.live = await api("/api/health/activity", { method: "POST", body: JSON.stringify(body) });
    render();
  }
  if (action === "face-cancel") {
    faceRun.cancel?.();
    return;
  }
  if (action === "open-face") {
    const video = document.querySelector("#face-video");
    const status = document.querySelector("#vision-status");
    try {
      await openCamera(video);
      status.textContent = "Камер нээлттэй. Шинжилгээ нэг удаагийн кадр авна.";
    } catch {
      status.textContent = "Камерын зөвшөөрөл өгөгдөөгүй.";
    }
  }
  if (action === "analyze") {
    const video = document.querySelector("#face-video");
    const status = document.querySelector("#vision-status");
    if (!video?.srcObject) {
      status.textContent = "Эхлээд камераа нээнэ үү.";
      return;
    }
    status.textContent = "Нүүрийг уншиж байна…";
    try {
      const reading = await analyzeFrame(video);
      if (reading.error) {
        status.textContent = reading.error;
        return;
      }
      state.live = await api("/api/vision", { method: "POST", body: JSON.stringify(reading) });
      document.querySelector("#vision-result").innerHTML = `<h2>Үр дүн</h2>${visionHtml(state.live.vision)}`;
      status.textContent = reading.withheld ? "Тоон үнэлгээ нуугдлаа." : "Зөвлөмж гарлаа.";
    } catch (error) {
      status.textContent = error.message;
    }
  }
  if (action === "breathe") {
    if (state.breath) {
      stopBreath();
      render();
    } else startBreath();
  }
  if (action === "breath-pattern" || action === "breath-min") {
    if (action === "breath-pattern") state.breathKey = button.dataset.key;
    else state.breathMin = Number(button.dataset.min);
    const panel = button.closest(".hl-breath");
    panel.outerHTML = breathPanel();
  }
  if (action === "trend-metric") {
    state.trendMetric = button.dataset.metric;
    paintTrends();
  }
  if (action === "eat") await liveAction("/api/health/eat", "POST", { id: button.dataset.id }, button);
  if (action === "pulse-connect") await connectWatch();
  if (action === "pulse-stop") disconnectWatch();
  if (action === "pulse-save" && state.pulse?.n) await liveAction("/api/health/watch", "POST", { hr: Math.round(state.pulse.sum / state.pulse.n), source: "ble" }, button);
  if (action === "mood") await liveAction("/api/health/mood", "PUT", { mood: Number(button.dataset.mood) }, button);
  if (action === "notice-seen") await liveAction("/api/notices/seen", "POST", button.dataset.id ? { id: button.dataset.id } : {}, button);
  if (action === "announce-read") await liveAction(`/api/announcements/${encodeURIComponent(button.dataset.id)}/read`, "POST", {}, button);
  if (action === "todo-toggle") await liveAction(`/api/reminders/${encodeURIComponent(button.dataset.id)}`, "POST", {}, button);
  if (action === "todo-delete") await liveAction(`/api/reminders/${encodeURIComponent(button.dataset.id)}`, "DELETE", null, button);
  if (action === "brief-play") playBriefing();
  if (action === "announce-delete") {
    if (!confirm("Энэ зарлалыг устгах уу?")) return;
    try {
      state.admin = await api(`/api/hr/announcements/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" });
      render();
    } catch (error) {
      flash(".announce-panel", error.message, false);
    }
  }
});

/** Sends a personal update and re-renders with the fresh view; errors show next to the control. */
async function liveAction(path, method, body, button) {
  if (button) button.disabled = true;
  try {
    state.live = await api(path, { method, body: body ? JSON.stringify(body) : undefined });
    render();
    return true;
  } catch (error) {
    if (button?.isConnected) button.disabled = false;
    const panel = button?.closest(".panel, .notice-bar, .modal-body");
    panel?.querySelector(".form-error")?.remove();
    panel?.insertAdjacentHTML("beforeend", `<p class="error form-error">${esc(error.message)}</p>`);
    return false;
  }
}

stage.addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (form.dataset.form === "wk-say" || form.dataset.form === "wk-config") {
    const kind = form.dataset.form;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      if (kind === "wk-say") {
        state.wkAdmin = await api("/api/admin/whiteking/say", { method: "POST", body: JSON.stringify({ text: data.text }) });
        form.reset();
        paintWkAdmin();
        flash("[data-form='wk-say']", "Станц руу илгээгдлээ. Хэдэн секундийн дотор хэлнэ.");
      } else {
        const invalid = [...form.elements].find((element) => element.willValidate && !element.checkValidity());
        if (invalid) {
          wkReveal(invalid);
          wkSaveState(wkInvalidText(invalid), "error");
          return;
        }
        wkSaveState("Хадгалж байна…");
        state.wkAdmin = await api("/api/admin/whiteking", { method: "PUT", body: JSON.stringify(wkConfigData(form)) });
        state.wkDirty = false;
        paintWkAdmin();
        paintWkConfig();
        wkSaveState("Хадгалагдлаа. Станц шинэ тохиргоог шууд ашиглана.", "ok");
      }
    } catch (error) {
      if (kind === "wk-config") wkSaveState(error.message, "error");
      else flash(`[data-form='${kind}']`, error.message, false);
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (form.dataset.form === "rk-write") {
    const text = String(data.q || "").trim();
    if (!text || state.rk.mode === "thinking") return;
    form.reset();
    stopSpeaking();
    rkWrite(false);
    askRedKing(text);
    return;
  }
  if (form.dataset.form === "place-search") {
    const query = String(data.q || "").trim();
    if (!query || typeof state.placeMap?.search !== "function") return;
    showPlace({ loading: true, name: query });
    try {
      state.placeResults = await state.placeMap.search(query);
      if (state.placeResults[0]) showPlace(state.placeResults[0]);
      else showPlace({ error: `«${query}» олдсонгүй` });
    } catch (error) {
      showPlace({ error: error.message });
    }
    return;
  }
  if (["me", "password", "admin-user", "admin-password", "card-template"].includes(form.dataset.form)) {
    const kind = form.dataset.form;
    const selector = `[data-form="${kind}"]`;
    try {
      let message = "Хадгалагдлаа";
      if (kind === "me") {
        state.me = (await api("/api/me", { method: "PUT", body: JSON.stringify(data) })).user;
      }
      if (kind === "password") {
        if (data.next !== data.confirm) throw new Error("Шинэ нууц үг хоорондоо таарахгүй байна");
        state.me = (await api("/api/me/password", { method: "PUT", body: JSON.stringify({ current: data.current, next: data.next }) })).user;
        linkPhoneApp();
        message = "Нууц үг солигдлоо";
      }
      if (kind === "admin-user") {
        const body = adminCardData(form);
        const result = await api(`/api/admin/users/${encodeURIComponent(form.dataset.id)}`, { method: "PUT", body: JSON.stringify(body) });
        state.admin = result;
        if (result.self) state.me = result.self;
      }
      if (kind === "admin-password") {
        if (data.password !== data.confirm) throw new Error("Шинэ нууц үг хоорондоо таарахгүй байна");
        state.admin = await api(`/api/admin/users/${encodeURIComponent(form.dataset.id)}`, { method: "PUT", body: JSON.stringify({ password: data.password }) });
        message = "Нууц үг шинэчлэгдлээ";
      }
      if (kind === "card-template") {
        const result = await api(`/api/admin/card-templates/${form.dataset.level}`, { method: "PUT", body: JSON.stringify({ texts: templateData(form) }) });
        state.admin = result;
        if (result.self) state.me = result.self;
        message = `Түвшин ${form.dataset.level}-ийн карт шинэчлэгдлээ`;
      }
      render();
      flash(selector, message);
    } catch (error) {
      flash(selector, error.message, false);
    }
    return;
  }
  if (form.dataset.form === "leave") {
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      state.live = await api("/api/leaves", { method: "POST", body: JSON.stringify(data) });
      render();
      flash(".me-leaves", "Хүсэлт илгээгдлээ. Админ шийдвэрлэнэ.");
    } catch (error) {
      flash(".me-leaves", error.message, false);
    } finally {
      button.disabled = false;
    }
    return;
  }
  if (form.dataset.form === "todo") {
    const button = form.querySelector("button[type='submit']");
    await liveAction("/api/reminders", "POST", { title: data.title, due: data.due }, button);
    stage.querySelector("[data-form='todo'] input[name='title']")?.focus();
    return;
  }
  if (form.dataset.form === "menu-add" || form.dataset.form === "menu-edit") {
    const button = form.querySelector("button[type='submit']");
    const adding = form.dataset.form === "menu-add";
    if (!data.kcal) button.textContent = "AI калори тооцож байна…";
    state.menuMeal = data.meal;
    const body = { ...data, date: state.kitchen?.date };
    const done = adding
      ? await kitchenAction("/api/kitchen/menu", "POST", body, button, `«${data.name}» нэмэгдлээ`)
      : await kitchenAction(`/api/kitchen/menu/${encodeURIComponent(form.dataset.id)}`, "PUT", body, button, "Хадгалагдлаа");
    if (!done) button.textContent = adding ? "Нэмэх" : "Хадгалах";
    if (done && adding) stage.querySelector(".menu-form:not(.is-edit) input[name='name']")?.focus();
    return;
  }
  if (form.dataset.form === "plan-rotation") {
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    await saveRotation(form, data);
    button.disabled = false;
    return;
  }
  if (form.dataset.form === "announce") {
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      state.admin = await api("/api/hr/announcements", { method: "POST", body: JSON.stringify({ text: data.text }) });
      render();
      flash(".announce-panel", "Зарлал бүх хүний Нүүр хуудсанд гарлаа");
    } catch (error) {
      flash(".announce-panel", error.message, false);
      button.disabled = false;
    }
    return;
  }
  if (form.dataset.form === "sleep") {
    try {
      state.live = await api("/api/sleep", { method: "PUT", body: JSON.stringify(data) });
      render();
    } catch (error) {
      form.querySelector(".form-error")?.remove();
      form.insertAdjacentHTML("beforeend", `<p class="error form-error">${esc(error.message)}</p>`);
    }
    return;
  }
  const healthForms = {
    activity: ["/api/health/activity", "POST"],
    vitals: ["/api/health/vitals", "POST"],
    watch: ["/api/health/watch", "POST"],
    body: ["/api/health/body", "PUT"],
  };
  if (healthForms[form.dataset.form]) {
    const [path, method] = healthForms[form.dataset.form];
    try {
      state.live = await api(path, { method, body: JSON.stringify(data) });
      render();
    } catch (error) {
      form.querySelector(".form-error")?.remove();
      form.insertAdjacentHTML("beforeend", `<p class="error form-error">${esc(error.message)}</p>`);
    }
  }
});

stage.addEventListener("focusin", (event) => {
  if (event.target.matches("[data-wk-text]")) {
    state.wkFocus = event.target;
    wkShowTokens(event.target);
  }
});

stage.addEventListener("focusout", (event) => {
  const bar = stage.querySelector("#wk-ph");
  if (!bar || bar.hidden || !event.target.matches?.("[data-wk-text]")) return;
  const next = event.relatedTarget;
  if (next && (bar.contains(next) || next.matches?.("[data-wk-text]") || next.closest?.(".wk-text"))) return;
  bar.hidden = true;
});

stage.addEventListener("mousedown", (event) => {
  if (event.target.closest(".wk-ph")) event.preventDefault();
});

stage.addEventListener("toggle", (event) => {
  if (event.target.matches?.(".wk-config details[data-sec]")) {
    if (event.target.open) state.wkOpen.add(event.target.dataset.sec);
    else state.wkOpen.delete(event.target.dataset.sec);
  }
}, true);

stage.addEventListener("change", (event) => {
  const form = event.target.closest?.("[data-form='wk-config']");
  if (form && event.target.type === "checkbox") wkConfigChanged(form, event.target);
});

window.addEventListener("beforeunload", (event) => {
  if (state.view === "whiteking" && state.wkDirty) event.preventDefault();
});

stage.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && event.target.closest(".rk-write")) rkWrite(false);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && event.target.closest?.("[data-form='wk-config']")) {
    event.preventDefault();
    if (state.wkDirty) wkConfigFormNode()?.requestSubmit();
  }
  if ((event.key === "Enter" || event.key === " ") && event.target.matches?.("[data-action='flip-card']")) {
    event.preventDefault();
    flipCard(event.target);
  }
});

async function adminPhoto(id, photo) {
  const result = await api(`/api/admin/users/${encodeURIComponent(id)}/photo`, { method: "PUT", body: JSON.stringify({ photo }) });
  state.admin = result;
  if (result.self) state.me = result.self;
  render();
}

stage.addEventListener("input", (event) => {
  const wkForm = event.target.closest?.("[data-form='wk-config']");
  if (wkForm && event.target.type !== "checkbox") {
    wkConfigChanged(wkForm, event.target);
    return;
  }
  const filter = event.target.dataset?.filter;
  if (filter === "users" || filter === "users-level" || filter === "users-status") {
    if (filter === "users") state.userQuery = event.target.value;
    if (filter === "users-level") state.userLevel = event.target.value;
    if (filter === "users-status") state.userStatus = event.target.value;
    filterUsers();
    return;
  }
  if (filter?.startsWith("hist-")) {
    historyFilter()[filter.slice(5)] = event.target.value;
    if (filter === "hist-day") repaintHistoryPanel();
    else paintHistory();
    return;
  }
  if (filter?.startsWith("staff-")) {
    staffFilter()[filter.slice(6)] = event.target.value;
    paintStaff();
    return;
  }
  if (filter === "me-period") {
    state.mePeriod = event.target.value;
    paintMeSummary();
    return;
  }
  if (filter === "trend-period") {
    state.trendPeriod = event.target.value;
    paintTrends();
    return;
  }
  if (event.target.matches("[data-form='leave'] input[type='date']")) {
    const form = event.target.form;
    if (form.elements.to.value < form.elements.from.value) form.elements.to.value = form.elements.from.value;
    form.elements.to.min = form.elements.from.value;
  }
  const form = event.target.closest("[data-form='admin-user']");
  if (form && event.target.name !== "password") adminPreview(form);
  const template = event.target.closest("[data-form='card-template']");
  if (template) templatePreview(template);
});

async function inlineUpdate(select) {
  try {
    const result = await api(`/api/admin/users/${encodeURIComponent(select.dataset.id)}`, { method: "PUT", body: JSON.stringify({ [select.dataset.inline]: select.value }) });
    state.admin = result;
    if (result.self) state.me = result.self;
    render();
    flash(".admin-users", "Хадгалагдлаа");
  } catch (error) {
    render();
    flash(".admin-users", error.message, false);
  }
}

stage.addEventListener("change", async (event) => {
  const inline = event.target.closest("select[data-inline]");
  if (inline) {
    await inlineUpdate(inline);
    return;
  }
  const plan = event.target.closest("select[data-plan]");
  if (plan) {
    await savePlan(plan);
    return;
  }
  const planMode = event.target.closest("select[data-plan-mode]");
  if (planMode) {
    await savePlanMode(planMode);
    return;
  }
  const planPhase = event.target.closest("select.plan-phase");
  if (planPhase) {
    planPhase.className = `inline-select plan-phase is-${startKind(planPhase.value)}`;
    return;
  }
  const adminInput = event.target.closest("[data-admin-photo]");
  if (adminInput?.files?.[0]) {
    const file = adminInput.files[0];
    try {
      if (file.size > 15_000_000) throw new Error("Зураг 15 МБ-аас бага байх ёстой");
      await adminPhoto(adminInput.dataset.adminPhoto, await photoData(file));
      flash("#admin-editor .admin-photo", "Зураг шинэчлэгдлээ");
    } catch (error) {
      flash("#admin-editor .admin-photo", error.message || "Зураг уншигдсангүй", false);
    }
  }
});

const notifyBtn = document.querySelector("#notify-btn");
const BELL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>`;
const BELL_OFF = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5V11a6 6 0 0 1 9.6-4.8M18 10.5v6l1.5 2h-12"/><path d="M10 20.5a2 2 0 0 0 4 0M3.5 3.5l17 17"/></svg>`;

function applyNotify(permission) {
  const label = permission === "granted" ? "Мэдэгдэл нээлттэй" : permission === "denied" ? "Мэдэгдэл хаалттай" : "Мэдэгдэл нээх";
  notifyBtn.innerHTML = permission === "denied" ? BELL_OFF : BELL;
  notifyBtn.classList.toggle("on", permission === "granted");
  notifyBtn.setAttribute("aria-label", label);
  notifyBtn.dataset.tip = label;
}

applyNotify(window.Notification?.permission ?? "denied");
notifyBtn.addEventListener("click", async () => {
  if (window.Notification) applyNotify(await Notification.requestPermission());
});

const NUDGE_PREFIX = "holo-nudge:";

function toast(title, body) {
  let box = document.querySelector("#toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    box.className = "toasts";
    box.setAttribute("role", "status");
    document.body.append(box);
  }
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<div><b>${esc(title)}</b><span>${esc(body)}</span></div><button type="button" aria-label="Хаах">${icon("cross", "ico tiny")}</button>`;
  const close = () => {
    node.classList.add("is-out");
    setTimeout(() => node.remove(), 300);
  };
  node.querySelector("button").addEventListener("click", close);
  box.append(node);
  setTimeout(close, 12000);
}

/** One nudge per key: a system notification when allowed, plus an in-app toast. */
function nudge(key, title, body) {
  if (localStorage.getItem(NUDGE_PREFIX + key)) return;
  localStorage.setItem(NUDGE_PREFIX + key, String(Date.now()));
  if (window.Notification?.permission === "granted") new Notification(title, { body, tag: key });
  toast(title, body);
}

/** Break and to-do reminders, checked once a minute. */
function checkNudges() {
  const live = state.live;
  if (!live?.wellness || !state.me || isAdmin() || isStation()) return;
  const now = Date.now();
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(NUDGE_PREFIX) && now - Number(localStorage.getItem(key)) > 2 * DAY_MS) localStorage.removeItem(key);
  }
  if (live.presence?.state === "in") {
    const since = Date.parse(live.presence.since);
    const block = breakIndex(since, now);
    if (block >= 1 && now - since - block * BREAK_EVERY_MS < 10 * 60000) {
      nudge(`break:${since}:${block}`, "Завсарлагын цаг", `${block * 2} цаг ажиллалаа. 5 минут алхаж, нүдээ амраа.`);
    }
  }
  for (const item of live.reminders || []) {
    if (item.done || !item.due) continue;
    const at = Date.parse(`${live.wellness.today}T${item.due}:00+08:00`);
    if (now >= at && now - at < 15 * 60000) nudge(`todo:${item.id}:${live.wellness.today}`, "Сануулга", `${item.due} · ${item.title}`);
  }
}

setInterval(checkNudges, 60000);

const SUN = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></svg>`;
const MOON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7z"/></svg>`;
const themeBtn = document.querySelector("#theme-btn");

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("holo-theme", theme);
  const light = theme === "light";
  const label = light ? "Хар горим" : "Цагаан горим";
  themeBtn.innerHTML = light ? MOON : SUN;
  themeBtn.setAttribute("aria-pressed", String(light));
  themeBtn.setAttribute("aria-label", label);
  themeBtn.dataset.tip = label;
}

applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
themeBtn.addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));

const shell = document.querySelector("#shell");
const loginScreen = document.querySelector("#login");
const loginForm = document.querySelector("#login-form");
const loginError = document.querySelector("#login-error");
function showLogin(message = "") {
  cancelListening();
  stopSpeaking();
  clearInterval(state.wkTimer);
  clearInterval(state.wkAdminTimer);
  clearInterval(state.meTimer);
  clearInterval(state.attTimer);
  disconnectWatch();
  wkVoice.queue.length = 0;
  closeModal(true);
  state.wk?.wakeLock?.release().catch(() => {});
  stopHardware();
  stopBreath();
  Object.assign(state, { me: null, live: null, admin: null, staff: null, kitchen: null, menuDate: null, menuEdit: null, attHistory: null, editUser: null, view: "home", rk: { status: "", mode: null }, wk: null, wkAdmin: null, renderedView: null, briefing: false });
  shell.classList.remove("is-station");
  state.flipped.clear();
  stage.innerHTML = "";
  shell.hidden = true;
  loginScreen.hidden = false;
  loginError.textContent = message;
  loginForm.querySelector("[name='username']").focus();
}

async function enterApp(user) {
  state.me = user;
  loginForm.reset();
  loginError.textContent = "";
  loginScreen.hidden = true;
  shell.hidden = false;
  linkPhoneApp();
  await startApp();
}

/** Inside the UMBRELLA phone app: hands its background service (steps, location, sleep button) a token of its own. */
async function linkPhoneApp() {
  if (!window.UmbrellaApp?.postMessage || !state.me || isStation()) return;
  try {
    const { token, user } = await api("/api/mobile/token", { method: "POST", body: "{}" });
    window.UmbrellaApp.postMessage(JSON.stringify({ type: "session", token, user }));
  } catch {
    /* the app keeps its previous token and retries on the next start */
  }
}

function unlinkPhoneApp() {
  window.UmbrellaApp?.postMessage?.(JSON.stringify({ type: "logout" }));
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type='submit']");
  button.disabled = true;
  loginError.textContent = "";
  try {
    const { user } = await api("/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(loginForm))) });
    await enterApp(user);
  } catch (error) {
    loginError.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-btn").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
  } catch {
    /* the cookie is cleared server-side; still leave locally */
  }
  unlinkPhoneApp();
  showLogin();
});

function setupAppMenu() {
  const root = document.documentElement;
  if (!root.classList.contains("is-app")) return;
  const rail = document.querySelector(".rail");
  const menuBtn = document.querySelector("#menu-btn");
  const head = document.createElement("div");
  head.className = "drawer-head";
  head.append(document.querySelector("#place"));
  const foot = document.createElement("div");
  foot.className = "drawer-foot";
  foot.append(themeBtn, document.querySelector("#logout-btn"));
  rail.prepend(head);
  rail.append(foot);
  const backdrop = document.createElement("div");
  backdrop.className = "menu-backdrop";
  shell.append(backdrop);
  const toggle = (open) => {
    if (open) [...nav.querySelectorAll("button:not([hidden])")].forEach((button, index) => button.style.setProperty("--i", index));
    root.classList.toggle("menu-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
  };
  menuBtn.addEventListener("click", () => toggle(!root.classList.contains("menu-open")));
  backdrop.addEventListener("click", () => toggle(false));
  rail.addEventListener("click", (event) => {
    if (!event.target.closest("#nav button, #logout-btn")) return;
    toggle(false);
    window.scrollTo({ top: 0 });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") toggle(false);
  });
}

setupAppMenu();

if (location.pathname === "/queen" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

async function boot() {
  let user;
  try {
    user = (await api("/api/auth/me")).user;
  } catch {
    showLogin();
    return;
  }
  await enterApp(user);
}

async function startApp() {
  if (isStation()) {
    startStation();
    return;
  }
  try {
    state.live = await api("/api/live");
  } catch (error) {
    stage.innerHTML = `<p class="error">${esc(error.message)}</p>`;
    return;
  }
  render();
  checkNudges();
  if (navigator.geolocation && !state.located) {
    state.located = true;
    navigator.geolocation.getCurrentPosition(async (position) => {
      if (!state.me) {
        state.located = false;
        return;
      }
      try {
        state.live = await api("/api/location", {
          method: "POST",
          body: JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude }),
        });
        renderChrome();
        if (state.view === "home" || state.view === "weather" || state.view === "health") render();
      } catch {
        /* keep the city default */
      }
    });
  }
}

setInterval(tickDigitalClock, 1000);

document.addEventListener("visibilitychange", () => {
  if (isStation()) keepAwake();
});

setInterval(async () => {
  if (!state.me || isStation()) return;
  if (document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (state.scanning || state.camera) return;
  try {
    const before = attendanceSignature(state.live);
    state.live = await api("/api/live");
    renderChrome();
    if (state.view === "home") {
      stage.classList.add("is-quiet");
      stage.innerHTML = homeView();
    }
    if (state.view === "attendance" && attendanceSignature(state.live) !== before && document.activeElement?.tagName !== "SELECT") render();
  } catch {
    /* keep the last good screen */
  }
}, 60000);

boot();
