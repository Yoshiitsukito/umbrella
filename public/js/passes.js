// Movement permit board for HR, the chief mining engineer, the camp manager and security, plus the pieces the
// worker's own request list shares with it. Rules (who approves, who sees, status) live in passcore.js.
import { localInput } from "./minecore.js";
import { APPROVER_LABEL, GATE_STEPS, PASS_APPROVERS, PASS_KINDS, PASS_SHORT, PASS_STATUS, awaits, nextGate } from "./passcore.js";
import { PLAN_LABEL } from "./workstats.js";

export const PASS_VIEWS = ["passes"];

const ROLE_TITLE = { hr: "Хүний нөөц", engineer: "Уулын ахлах инженер", campmgr: "Кэмп менежер", security: "Хамгаалалт" };
const TABS = {
  hr: [["todo", "Шийдвэрлэх"], ["active", "Идэвхтэй"], ["all", "Бүгд"]],
  engineer: [["todo", "Шийдвэрлэх"], ["active", "Идэвхтэй"], ["all", "Бүгд"]],
  security: [["gate", "Хаалга"], ["pending", "Хүлээгдэж буй"], ["all", "Бүгд"]],
  campmgr: [["upcoming", "Ирэх, буух"], ["pending", "Хүлээгдэж буй"], ["all", "Бүгд"]],
};
const STATUS_TONE = { pending: "warn", approved: "ok", rejected: "bad", expired: "", done: "info" };
const GATE_TEXT = { exit: { out: "Бүсээс гарсан", in: "Буцаж орсон" }, arrive: { in: "Ирж орсон" }, depart: { out: "Гарч явсан" } };
const GATE_BUTTON = { exit: { out: "Гарсныг бүртгэх", in: "Буцаж орсныг бүртгэх" }, arrive: { in: "Ирснийг бүртгэх" }, depart: { out: "Гарсныг бүртгэх" } };

const ICON = {
  pass: `<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 11.5h8M8 15h4.5"/><path d="m14.5 16 1.5 1.5 3-3"/>`,
  exit: `<path d="M14 4.5h4.5v15H14"/><path d="M10 8l-4 4 4 4M6 12h10"/>`,
  arrive: `<path d="M10 4.5H5.5v15H10"/><path d="M14 8l4 4-4 4M18 12H8"/>`,
  depart: `<path d="M3 17.5h11.5V12H9.5L7.5 8H3z"/><circle cx="6.5" cy="18.5" r="2"/><circle cx="12" cy="18.5" r="2"/><path d="M16 9h5.5M19 6.5 21.5 9 19 11.5"/>`,
  check: `<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  cross: `<path d="M6 6l12 12M18 6 6 18"/>`,
  wait: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>`,
  gate: `<path d="M3.5 20.5V8l8.5-4.5L20.5 8v12.5"/><path d="M8 20.5v-8h8v8M8 16.5h8"/>`,
  search: `<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`,
  alert: `<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>`,
  empty: `<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 9h8M8 13h5"/>`,
};

let ctx = null;
const p = { data: null, timer: 0, loading: false, tab: {}, kind: "", query: "" };

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export const passIco = (name, cls = "m-ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ""}</svg>`;
const badge = (text, tone = "") => `<span class="m-badge${tone ? ` is-${tone}` : ""}">${esc(text)}</span>`;

function moment(iso) {
  const local = localInput(Date.parse(iso));
  return `${local.slice(5, 10).replace("-", ".")} ${local.slice(11, 16)}`;
}

/** "11.05 08:00 → 14:00" for a short exit, or the single moment of an arrival or departure. */
export function passWhen(pass) {
  if (pass.kind !== "exit" || !pass.until) return moment(pass.from);
  const from = moment(pass.from);
  const until = moment(pass.until);
  return `${from} → ${from.slice(0, 5) === until.slice(0, 5) ? until.slice(6) : until}`;
}

function since(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  return minutes < 60 ? `${minutes} мин` : `${Math.floor(minutes / 60)} ц ${minutes % 60} мин`;
}

/** Each approver's decision, then the gate steps, as a row of small chips. */
export function passTrail(pass) {
  const closed = pass.status !== "pending";
  const steps = PASS_APPROVERS[pass.kind].map((role) => {
    const decision = pass.decisions?.[role];
    const state = decision ? (decision.ok ? "ok" : "no") : closed ? "skip" : "wait";
    const label = { ok: "зөвшөөрсөн", no: "татгалзсан", skip: "шийдээгүй", wait: "хүлээгдэж байна" }[state];
    const title = decision ? `${decision.by} · ${moment(decision.at)}${decision.note ? ` · ${decision.note}` : ""}` : "";
    return `<span class="ps-step is-${state}" title="${esc(title)}">${passIco({ ok: "check", no: "cross" }[state] || "wait", "m-ico tiny")}${esc(APPROVER_LABEL[role])}: ${label}</span>`;
  });
  for (const step of GATE_STEPS[pass.kind]) {
    const mark = pass.gate?.[step];
    if (mark) steps.push(`<span class="ps-step is-gate" title="${esc(mark.by)}">${passIco("gate", "m-ico tiny")}${esc(GATE_TEXT[pass.kind][step])} ${moment(mark.at).slice(6)}</span>`);
  }
  const refusal = Object.entries(pass.decisions || {}).find(([, decision]) => decision && !decision.ok);
  const note = refusal ? `<p class="ps-note is-bad">${esc(APPROVER_LABEL[refusal[0]])}: ${esc(refusal[1].note || "")}</p>` : "";
  return `<div class="ps-trail">${steps.join("")}</div>${note}`;
}

export const passStatusBadge = (pass) => (pass.late ? badge(`Хоцорч байна · ${since(Date.now() - Date.parse(pass.until))}`, "bad") : badge(PASS_STATUS[pass.status], STATUS_TONE[pass.status]));

/* ---------- data ---------- */

/** Hands the module the app's helpers: { stage, state, api, render, openModal, closeModal, toast }. */
export function initPasses(context) {
  ctx = context;
  ctx.stage.addEventListener("click", onClick);
  ctx.stage.addEventListener("input", onInput);
}

export async function passesStart() {
  if (!p.timer) p.timer = setInterval(() => refresh(), 20000);
  if (!p.data) await refresh();
  else paint();
}

export function passesStop() {
  clearInterval(p.timer);
  p.timer = 0;
}

export function passesReset() {
  passesStop();
  Object.assign(p, { data: null, tab: {}, kind: "", query: "" });
}

async function refresh() {
  if (p.loading || !ctx.state.me) return;
  p.loading = true;
  try {
    p.data = await ctx.api("/api/passes");
    paint();
  } catch (error) {
    if (!p.data && PASS_VIEWS.includes(ctx.state.view)) ctx.stage.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  } finally {
    p.loading = false;
  }
}

function busy() {
  const active = document.activeElement;
  return Boolean(document.querySelector(".modal:not(.is-closing)")) || (ctx.stage.contains(active) && active?.tagName === "TEXTAREA");
}

function syncCount() {
  if (!p.data) return;
  if (ctx.state.live) ctx.state.live.passInbox = p.data.inbox;
  const badge = document.querySelector("[data-view='passes'] .nav-count");
  if (!badge) return;
  badge.textContent = p.data.inbox > 99 ? "99+" : String(p.data.inbox || "");
  badge.hidden = !p.data.inbox;
}

function paint(force = false) {
  syncCount();
  if (!PASS_VIEWS.includes(ctx.state.view) || (!force && busy())) return;
  const search = ctx.stage.querySelector(".ps-search");
  const focused = search && document.activeElement === search;
  ctx.stage.classList.add("is-quiet");
  ctx.stage.innerHTML = passesView();
  if (focused) {
    const input = ctx.stage.querySelector(".ps-search");
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }
}

/* ---------- page ---------- */

const userOf = (uid) => p.data.users.find((user) => user.id === uid) || { displayName: "Тодорхойгүй", title: "", idNumber: "" };
const initials = (name) => String(name || "?").trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
const soonMs = (pass) => Date.parse(pass.from) - Date.now();

/** The passes a tab lists, in the order the role works through them. */
function tabList(tab) {
  const role = p.data.role;
  const list = p.data.passes;
  const byFrom = (a, b) => a.from.localeCompare(b.from);
  const newest = (a, b) => b.at.localeCompare(a.at);
  if (tab === "todo") return list.filter((pass) => awaits(pass, role)).sort(byFrom);
  if (tab === "active") return list.filter((pass) => pass.status === "approved" || pass.late).sort(byFrom);
  if (tab === "gate") return list.filter((pass) => pass.late || nextGate(pass)).sort((a, b) => Number(b.late) - Number(a.late) || byFrom(a, b));
  if (tab === "pending") return list.filter((pass) => pass.status === "pending").sort(byFrom);
  if (tab === "upcoming") return list.filter((pass) => ["approved", "done"].includes(pass.status) && soonMs(pass) > -24 * 3600 * 1000).sort(byFrom);
  return [...list].sort(newest);
}

function heroStats() {
  const { role, passes } = p.data;
  const count = (test) => passes.filter(test).length;
  const outNow = count((pass) => pass.kind === "exit" && pass.gate?.out && !pass.gate?.in);
  const late = count((pass) => pass.late);
  const upcoming = (kind) => count((pass) => pass.kind === kind && pass.status === "approved" && soonMs(pass) > -12 * 3600 * 1000 && soonMs(pass) < 7 * 86400000);
  const mine = count((pass) => awaits(pass, role));
  if (role === "security") return [[count((pass) => nextGate(pass)), "Хаалгаар гарах, орох"], [outNow, "Бүсээс гарсан"], [late, "Хугацаа хэтэрсэн", late ? "neg" : ""], [count((pass) => pass.status === "pending"), "Зөвшөөрөл хүлээж буй"]];
  if (role === "campmgr") return [[upcoming("arrive"), "Зөвшөөрсөн ирэлт · 7 хоног"], [upcoming("depart"), "Зөвшөөрсөн буулт · 7 хоног"], [count((pass) => pass.status === "pending"), "Шийдвэр хүлээж буй"]];
  return [[mine, "Таны шийдвэр хүлээж буй", mine ? "neg" : ""], [upcoming("arrive"), "Зөвшөөрсөн ирэлт · 7 хоног"], [upcoming("depart"), "Зөвшөөрсөн буулт · 7 хоног"], ...(role === "engineer" ? [[outNow, "Бүсээс гарсан"], [late, "Хугацаа хэтэрсэн", late ? "neg" : ""]] : [])];
}

const ROLE_NOTE = {
  engineer: "Бүсээс гарах хүсэлтийг та зөвшөөрнө; ээлжийн бусаар ирэх, буух хүсэлтэд хүний нөөц бас зөвшөөрнө. Шийдвэр хамгаалалт, кэмпт шууд харагдана.",
  hr: "Ээлжийн бусаар ирэх, буух хүсэлтийг та болон уулын ахлах хоёулаа зөвшөөрснөөр хүчинтэй болно.",
  security: "Уулын ахлах (ээлжийн бус бол хүний нөөц ч) зөвшөөрсөн хүсэлтийг хаалган дээр шалгаж гарсан, орсныг бүртгэнэ.",
  campmgr: "Зөвшөөрөгдсөн ээлжийн бус ирэлт, буултаар орны хуваарилалтаа төлөвлөнө.",
};

export function passesView() {
  if (!p.data) return `<div class="admin-page m-page"><section class="panel"><p class="muted">Ачаалж байна…</p></section></div>`;
  const role = p.data.role;
  const tabs = TABS[role] || TABS.engineer;
  const tab = tabs.some(([key]) => key === p.tab[role]) ? p.tab[role] : tabs[0][0];
  const base = tabList(tab);
  const kinds = Object.keys(PASS_KINDS).filter((kind) => base.some((pass) => pass.kind === kind));
  const kind = kinds.includes(p.kind) ? p.kind : "";
  const query = p.query.trim().toLowerCase();
  const list = base.filter((pass) => (!kind || pass.kind === kind) && (!query || searchText(pass).includes(query)));
  const stat = ([value, label, tone]) => `<div class="m-stat${tone ? ` is-${tone}` : ""}"><b>${value}</b><span>${esc(label)}</span></div>`;
  const chip = (value, label, n) => `<button type="button" class="m-chip${kind === value ? " is-on" : ""}" data-ps="kind" data-kind="${value}">${esc(label)}<i>${n}</i></button>`;
  const chips = kinds.length > 1 ? `<div class="m-chips" role="group" aria-label="Төрөл">${chip("", "Бүгд", base.length)}${kinds.map((key) => chip(key, PASS_SHORT[key], base.filter((pass) => pass.kind === key).length)).join("")}</div>` : "";
  const counts = Object.fromEntries(tabs.map(([key]) => [key, key === "all" ? 0 : tabList(key).length]));
  return `<div class="admin-page m-page ps-page">
    <section class="panel m-hero">
      <div class="m-hero-top">
        <div class="admin-shield">${passIco("pass")}</div>
        <h1>Хөдөлгөөний зөвшөөрөл</h1>
        <span class="m-pill">${esc(ROLE_TITLE[role] || "")}</span>
        <span class="m-pill">${passIco("calendar")}${esc(p.data.today.slice(5).replace("-", "."))}</span>
      </div>
      <p class="ps-intro">${esc(ROLE_NOTE[role] || "")}</p>
      <div class="m-stats">${heroStats().map(stat).join("")}</div>
    </section>
    <div class="m-tabbar"><nav class="m-tabs" role="tablist">${tabs
      .map(([key, label]) => `<button type="button" role="tab" class="m-tab${key === tab ? " is-on" : ""}" aria-selected="${key === tab}" data-ps="tab" data-tab="${key}"><span>${esc(label)}</span>${counts[key] ? `<i class="m-tab-alert">${counts[key]}</i>` : ""}</button>`)
      .join("")}</nav></div>
    <section class="panel m-panel ps-panel">
      <header class="m-panel-head ps-head">
        <h2>${esc(tabs.find(([key]) => key === tab)[1])}<span class="m-count">${list.length}</span></h2>
        <label class="m-searchbox">${passIco("search")}<input type="search" class="ps-search" value="${esc(p.query)}" placeholder="Нэр, ID, шалтгаан" aria-label="Хайх" /></label>
      </header>
      <div class="m-panel-body">${chips}<div class="ps-list">${list.map(card).join("") || `<p class="m-empty ps-empty">${passIco("empty")}<span>Хүсэлт алга</span></p>`}</div></div>
    </section>
  </div>`;
}

function searchText(pass) {
  const user = userOf(pass.uid);
  return `${user.displayName} ${user.idNumber} ${user.title} ${pass.reason} ${pass.place || ""} ${PASS_KINDS[pass.kind]}`.toLowerCase();
}

function card(pass) {
  const role = p.data.role;
  const user = userOf(pass.uid);
  const acts = [];
  if (awaits(pass, role)) {
    acts.push(`<button class="primary" type="button" data-ps="approve" data-id="${pass.id}">${passIco("check")}Зөвшөөрөх</button>`);
    acts.push(`<button class="chip is-reject" type="button" data-ps="reject" data-id="${pass.id}">${passIco("cross")}Татгалзах</button>`);
  }
  const step = role === "security" ? nextGate(pass) : null;
  if (step) acts.push(`<button class="primary" type="button" data-ps="gate" data-id="${pass.id}" data-step="${step}">${passIco("gate")}${esc(GATE_BUTTON[pass.kind][step])}</button>`);
  const planned = pass.planned ? `<span class="ps-plan is-${pass.planned}" title="Ажилтны хуваарьт тухайн өдөр">${pass.planned === "leave" ? "Чөлөөтэй" : `Хуваарь: ${PLAN_LABEL[pass.planned]}`}</span>` : "";
  const due = pass.status === "approved" && !Object.keys(pass.gate || {}).length && soonMs(pass) > 0 && soonMs(pass) < 12 * 3600 * 1000 ? `<span class="ps-soon">${since(soonMs(pass))}-ын дараа</span>` : "";
  return `<article class="ps-card is-${pass.status}${pass.late ? " is-late" : ""}">
    <div class="ps-who"><span class="ps-avatar">${esc(initials(user.displayName))}</span><div><b>${esc(user.displayName)}</b><small>${esc([user.title, user.idNumber && `ID ${user.idNumber}`].filter(Boolean).join(" · ") || "Ажилтан")}</small></div></div>
    <div class="ps-what">
      <div class="ps-line"><span class="ps-kind is-${pass.kind}">${passIco(pass.kind)}${esc(PASS_SHORT[pass.kind])}</span><b class="ps-when">${esc(passWhen(pass))}</b>${due}${planned}</div>
      <p class="ps-reason">${esc(pass.reason)}${pass.place ? ` <span class="muted">· ${esc(pass.place)}</span>` : ""}</p>
      ${passTrail(pass)}
    </div>
    <div class="ps-side">${passStatusBadge(pass)}${acts.length ? `<div class="ps-acts">${acts.join("")}</div>` : ""}</div>
  </article>`;
}

/* ---------- actions ---------- */

async function send(id, action, body) {
  const data = await ctx.api(`/api/passes/${encodeURIComponent(id)}/${action}`, { method: "POST", body: JSON.stringify(body) });
  p.data = data.view;
  return data;
}

function openReject(id) {
  const pass = p.data.passes.find((item) => item.id === id);
  if (!pass) return;
  const user = userOf(pass.uid);
  const body = `<form class="m-form ps-reject" novalidate>
      <p class="muted">${esc(user.displayName)} · ${esc(PASS_KINDS[pass.kind])} · ${esc(passWhen(pass))}</p>
      <label class="m-field is-wide"><span>Татгалзах шалтгаан *</span><textarea name="note" maxlength="160" rows="3" required></textarea></label>
      <p class="form-error m-form-error" role="alert" hidden></p>
      <div class="modal-actions"><button class="chip" type="button" data-close>Болих</button><button class="primary danger" type="submit">${passIco("cross")}Татгалзах</button></div>
    </form>`;
  const wrap = ctx.openModal({ shield: passIco("cross"), title: "Хүсэлт татгалзах", sub: esc(PASS_SHORT[pass.kind]), body, className: "m-modal" });
  if (!wrap) return;
  const form = wrap.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = form.querySelector(".m-form-error");
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await send(id, "decide", { ok: false, note: form.elements.note.value });
      ctx.closeModal(true);
      setTimeout(() => paint(true), 260);
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
  requestAnimationFrame(() => form.elements.note.focus());
}

async function onClick(event) {
  if (!PASS_VIEWS.includes(ctx.state.view)) return;
  const button = event.target.closest("[data-ps]");
  if (!button || !p.data) return;
  const action = button.dataset.ps;
  if (action === "tab") {
    p.tab[p.data.role] = button.dataset.tab;
    p.kind = "";
    paint(true);
  }
  if (action === "kind") {
    p.kind = button.dataset.kind;
    paint(true);
  }
  if (action === "reject") openReject(button.dataset.id);
  if (action === "approve" || action === "gate") {
    button.disabled = true;
    try {
      if (action === "approve") await send(button.dataset.id, "decide", { ok: true });
      else await send(button.dataset.id, "gate", { step: button.dataset.step });
      ctx.toast("Хөдөлгөөний зөвшөөрөл", action === "approve" ? "Зөвшөөрлөө" : "Хаалганы бүртгэл хийгдлээ");
      paint(true);
    } catch (error) {
      ctx.toast("Амжилтгүй", error.message);
      button.disabled = false;
    }
  }
}

function onInput(event) {
  if (!PASS_VIEWS.includes(ctx.state.view) || !event.target.matches(".ps-search")) return;
  p.query = event.target.value;
  paint(true);
}
