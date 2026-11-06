// The admin's change history (who changed what, with a restore for deleted records) and system page (notification
// channels, delivery log, backups), plus everyone's own notification settings and browser push on the profile page.
import { COLLECTIONS, localInput } from "./minecore.js";
import { enterStage } from "./motion.js";

export const SYSTEM_VIEWS = ["audit", "system"];

const ICON = {
  history: `<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4.5V9H8"/><path d="M12 7.5V12l3 2"/>`,
  server: `<rect x="3.5" y="4" width="17" height="6.5" rx="1.8"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.8"/><path d="M7 7.3h.01M7 16.8h.01M11 7.3h6M11 16.8h6"/>`,
  bell: `<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>`,
  push: `<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/><circle cx="17.5" cy="6" r="2.6" fill="currentColor" stroke="none"/>`,
  email: `<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6.5L20.5 7"/>`,
  sms: `<path d="M4 5.5h16v10.5H9.5L5 19.5V16H4z"/><path d="M8 10.8h.01M12 10.8h.01M16 10.8h.01"/>`,
  backup: `<path d="M12 3.5c4.7 0 8.5 1.3 8.5 3s-3.8 3-8.5 3-8.5-1.3-8.5-3 3.8-3 8.5-3z"/><path d="M3.5 6.5v5c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-5M3.5 11.5v6c0 1.7 3.8 3 8.5 3"/><path d="m15.5 18 2 2 3.5-3.5"/>`,
  cloud: `<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6-1.3A4.7 4.7 0 0 0 7 18.5z"/>`,
  download: `<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>`,
  upload: `<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 19.5h15"/>`,
  restore: `<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4.5 4.5V9H9"/>`,
  chev: `<path d="M6 9l6 6 6-6"/>`,
  search: `<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>`,
  check: `<path d="m5 12.5 4.5 4.5L19 7.5"/>`,
  cross: `<path d="M6 6l12 12M18 6 6 18"/>`,
  alert: `<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.1"/>`,
  send: `<path d="M20.5 3.5 3.5 10.5l7 2.5 2.5 7z"/><path d="m10.5 13 4-4"/>`,
  csv: `<path d="M6.5 3.5h8l4 4v13h-12z"/><path d="M14.5 3.5v4h4M9 12.5h6M9 16h6"/>`,
};

const ACTION = {
  create: ["Нэмсэн", "ok"],
  update: ["Зассан", "info"],
  delete: ["Устгасан", "bad"],
  restore: ["Сэргээсэн", "ok"],
  login: ["Нэвтэрсэн", ""],
  "login-fail": ["Нэвтрэлт амжилтгүй", "warn"],
  password: ["Нууц үг", "warn"],
  call: ["Үйлдэл", ""],
  backup: ["Нөөц хуулбар", "info"],
  "restore-db": ["Өгөгдөл сэргээсэн", "bad"],
};
const CHANNEL = { push: ["Push · утас, хөтөч", "push"], email: ["И-мэйл", "email"], sms: ["SMS", "sms"] };
const LEVELS = { off: "Унтраах", urgent: "Зөвхөн яаралтай", all: "Бүгд" };
const REASON = { auto: ["Автомат", "info"], manual: ["Гараар", ""], restore: ["Сэргээхийн өмнө", "warn"], upload: ["Оруулсан", ""] };
const FIELD_LABEL = {
  username: "Хэрэглэгчийн нэр",
  loginCode: "Нэвтрэх нэр",
  displayName: "Нэр",
  title: "Албан тушаал",
  email: "И-мэйл",
  phone: "Утас",
  birthday: "Төрсөн өдөр",
  role: "Эрх",
  password: "Нууц үг",
  "card.status": "Картын төлөв",
  "card.clearance": "Зэрэглэл",
  "card.idNumber": "ID дугаар",
  "card.classification": "Ангилал",
  "card.project": "Төсөл",
  "card.expires": "Хүчинтэй хугацаа",
  "card.issued": "Олгосон огноо",
  "card.signature": "Гарын үсэг",
  id: "ID",
  at: "Огноо",
  by: "Бүртгэсэн",
  uid: "Ажилтан",
  createdAt: "Бүртгэсэн огноо",
  status: "Төлөв",
  stage: "Шат",
  trail: "Батлалтын түүх",
  photo: "Зураг",
};
const ENV_HELP = {
  push: "Тусгай тохиргоо шаардлагагүй. Хэрэглэгч профайл хэсгээсээ «Энэ төхөөрөмж дээр асаах» дарна (HTTPS хаяг шаардлагатай).",
  email: "SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM-ийг .env (эсвэл Render-ийн Environment) дээр тохируулна. Gmail бол App Password ашиглана.",
  sms: "Twilio: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM. Эсвэл дотоодын SMS үйлчилгээ: SMS_GATEWAY_URL ({to}, {text} орлуулна), шаардлагатай бол SMS_GATEWAY_BODY, SMS_GATEWAY_AUTH.",
};

let ctx = null;
const s = { audit: null, query: null, open: new Set(), system: null, alerts: null, loading: {}, endpoint: undefined, note: "" };

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const ico = (name, cls = "m-ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ""}</svg>`;
const badge = (text, tone = "") => `<span class="m-badge${tone ? ` is-${tone}` : ""}">${esc(text)}</span>`;
const moment = (iso) => {
  const local = localInput(Date.parse(iso));
  return `${local.slice(5, 10).replace("-", ".")} ${local.slice(11, 16)}`;
};
const today = () => localInput(Date.now()).slice(0, 10);
const daysBefore = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const kb = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`);
const loading = (text = "Ачаалж байна…") => `<div class="admin-page m-page"><section class="panel is-loading"><p class="muted">${esc(text)}</p></section></div>`;

/** Hands the module the app's helpers: { stage, state, api, render, toast }. */
export function initSystem(context) {
  ctx = context;
  ctx.stage.addEventListener("click", onClick);
  ctx.stage.addEventListener("change", onChange);
  ctx.stage.addEventListener("submit", onSubmit);
}

export function systemReset() {
  Object.assign(s, { audit: null, query: null, open: new Set(), system: null, alerts: null, loading: {}, endpoint: undefined, note: "" });
}

/** Loads what the page needs; called after the page skeleton is on screen. */
export function systemStart(view) {
  if (view === "audit" && !s.audit) loadAudit();
  if (view === "system") loadSystem();
}

function repaint(view) {
  if (ctx.state.view !== view) return;
  if (ctx.stage.querySelector(".is-loading")) enterStage(ctx.stage);
  ctx.stage.classList.add("is-quiet");
  ctx.stage.innerHTML = view === "audit" ? auditView() : systemView();
}

async function load(key, task) {
  if (s.loading[key]) return;
  s.loading[key] = true;
  try {
    await task();
  } catch (error) {
    ctx.toast?.("Алдаа", error.message);
  } finally {
    s.loading[key] = false;
  }
}

/* ---------- change history ---------- */

function auditPath() {
  const query = s.query || { from: daysBefore(today(), 6), to: today(), by: "", action: "", q: "" };
  s.query = query;
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value));
  return `/api/admin/audit?${params}`;
}

function loadAudit() {
  return load("audit", async () => {
    s.audit = await ctx.api(auditPath());
    repaint("audit");
  });
}

const userName = (uid) => s.audit?.users.find((user) => user.id === uid)?.name || "";
const PERSON_KEYS = ["by", "uid", "updatedBy", "createdBy"];
const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d/;

function fieldLabel(collection, key) {
  const field = COLLECTIONS[collection]?.fields.find((item) => item.key === key);
  return field?.label || FIELD_LABEL[key] || key;
}

/** A logged value as text: select options and people by name, lists joined, empty as a dash. */
function valueText(collection, key, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Тийм" : "Үгүй";
  const field = COLLECTIONS[collection]?.fields.find((item) => item.key === key);
  if (field?.options && typeof value === "string" && field.options[value]) return field.options[value];
  if (field?.type === "user" && typeof value === "string") return userName(value) || value;
  if (field?.type === "users" && Array.isArray(value)) return value.map((uid) => userName(uid) || uid).join(", ");
  if (key === "role" && ctx.roleLabel?.[value]) return ctx.roleLabel[value];
  if (PERSON_KEYS.includes(key) && typeof value === "string") return userName(value) || value;
  if (typeof value === "string" && ISO_TIME.test(value)) return localInput(Date.parse(value)).replace("T", " ");
  if (Array.isArray(value)) return value.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function whatOf(entry) {
  if (entry.area || entry.label) return `${entry.area ? `<b>${esc(entry.area)}</b>` : ""}${entry.label ? ` · ${esc(entry.label)}` : ""}`;
  if (entry.path) return `<span class="mono sys-path">${esc(entry.method || "")} ${esc(entry.path)}</span>`;
  return esc(entry.note || "");
}

function detailOf(entry) {
  const parts = [];
  if (entry.note) parts.push(`<p class="sys-note">${esc(entry.note)}</p>`);
  if (entry.changes && Object.keys(entry.changes).length) {
    const rows = Object.entries(entry.changes)
      .map(([key, [before, after]]) => `<tr><th>${esc(fieldLabel(entry.collection, key))}</th><td class="sys-old">${esc(valueText(entry.collection, key, before))}</td><td class="sys-new">${esc(valueText(entry.collection, key, after))}</td></tr>`)
      .join("");
    parts.push(`<table class="sys-diff"><thead><tr><th>Талбар</th><th>${entry.action === "create" ? "" : "Өмнө"}</th><th>${entry.action === "create" ? "Утга" : "Дараа"}</th></tr></thead><tbody>${rows}</tbody></table>`);
  }
  if (entry.snapshot) {
    const rows = Object.entries(entry.snapshot)
      .filter(([key, value]) => value !== null && value !== "" && !["updatedAt", "updatedBy"].includes(key))
      .map(([key, value]) => `<tr><th>${esc(fieldLabel(entry.collection, key))}</th><td colspan="2">${esc(valueText(entry.collection, key, value))}</td></tr>`)
      .join("");
    parts.push(`<p class="sys-note">Устгагдсан бүртгэлийн хуулбар${entry.partial ? " (товчилсон)" : ""}:</p><table class="sys-diff"><tbody>${rows}</tbody></table>`);
  }
  if (entry.body) parts.push(`<pre class="sys-body">${esc(JSON.stringify(entry.body, null, 2))}</pre>`);
  if (entry.ip) parts.push(`<p class="sys-note muted">IP: <span class="mono">${esc(entry.ip)}</span></p>`);
  if (entry.restoredAt) parts.push(`<p class="sys-note">${badge("Сэргээсэн", "ok")} ${esc(moment(entry.restoredAt))} · ${esc(entry.restoredBy || "")}</p>`);
  else if (entry.action === "delete" && entry.snapshot && !entry.partial && COLLECTIONS[entry.collection]) {
    parts.push(`<div class="row"><button class="primary" type="button" data-sys="restore-record" data-id="${esc(entry.id)}">${ico("restore")}Энэ бүртгэлийг сэргээх</button></div>`);
  }
  return parts.join("") || `<p class="muted">Нэмэлт мэдээлэл алга</p>`;
}

export function auditView() {
  if (!s.audit) return loading();
  const { entries, more, from, to, by, action, q, users } = s.audit;
  const count = (test) => entries.filter(test).length;
  const stat = (value, label, tone = "") => `<div class="m-stat${tone ? ` is-${tone}` : ""}"><b>${value}</b><span>${esc(label)}</span></div>`;
  const fails = count((item) => item.action === "login-fail");
  const rows = entries
    .map((entry) => {
      const [label, tone] = ACTION[entry.action] || [entry.action, ""];
      const open = s.open.has(entry.id);
      return `<tr class="has-detail${open ? " is-open" : ""}" data-sys="toggle" data-id="${esc(entry.id)}">
        <td class="m-tcell"><span class="m-row-toggle">${ico("chev")}</span></td>
        <td class="mono">${esc(moment(entry.at))}</td>
        <td>${esc(entry.who || (entry.action === "login-fail" ? "Тодорхойгүй" : "Систем"))}${entry.role && ctx.roleLabel?.[entry.role] ? `<small class="staff-sub">${esc(ctx.roleLabel[entry.role])}</small>` : ""}</td>
        <td>${badge(label, tone)}</td>
        <td class="sys-what">${whatOf(entry)}</td>
      </tr>${open ? `<tr class="m-detail"><td></td><td colspan="4">${detailOf(entry)}</td></tr>` : ""}`;
    })
    .join("");
  const userOptions = users
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((user) => `<option value="${esc(user.id)}"${user.id === by ? " selected" : ""}>${esc(user.name)}</option>`)
    .join("");
  const actionOptions = Object.entries(ACTION)
    .map(([key, [label]]) => `<option value="${key}"${key === action ? " selected" : ""}>${esc(label)}</option>`)
    .join("");
  return `<div class="admin-page m-page sys-page">
    <section class="panel m-hero">
      <div class="m-hero-top">
        <div class="admin-shield">${ico("history")}</div>
        <h1>Өөрчлөлтийн түүх</h1>
        <span class="m-pill">${esc(from.slice(5).replace("-", "."))} – ${esc(to.slice(5).replace("-", "."))}</span>
      </div>
      <p class="ps-intro">Хэн, хэзээ, юуг өөрчилснийг өмнөх ба шинэ утгатай нь хадгална. Устгасан бүртгэлийн бүтэн хуулбар үлдэх тул эндээс сэргээж болно. Нууц үг, зураг түүхэнд хадгалагдахгүй.</p>
      <div class="m-stats">
        ${stat(entries.length + (more ? "+" : ""), "Бүртгэл")}
        ${stat(count((item) => item.action === "update"), "Засвар")}
        ${stat(count((item) => item.action === "delete"), "Устгал", count((item) => item.action === "delete") ? "neg" : "")}
        ${stat(fails, "Амжилтгүй нэвтрэлт", fails ? "neg" : "")}
      </div>
    </section>
    <section class="panel m-panel">
      <form class="sys-filters" data-sys-form="audit-filter">
        <label>Эхлэх<input type="date" name="from" value="${esc(from)}" max="${esc(today())}" /></label>
        <label>Дуусах<input type="date" name="to" value="${esc(to)}" max="${esc(today())}" /></label>
        <label>Хэн<select name="by"><option value="">Бүгд</option>${userOptions}</select></label>
        <label>Үйлдэл<select name="action"><option value="">Бүгд</option>${actionOptions}</select></label>
        <label class="m-searchbox sys-q">${ico("search")}<input type="search" name="q" value="${esc(q)}" placeholder="Нэр, бүртгэл, утга" aria-label="Хайх" /></label>
        <button class="primary" type="submit">Шүүх</button>
        <button class="chip" type="button" data-sys="audit-csv">${ico("csv")}CSV</button>
      </form>
      <div class="m-panel-body">
        <div class="m-scroll"><table class="m-table sys-table">
          <thead><tr><th></th><th>Цаг</th><th>Хэн</th><th>Үйлдэл</th><th>Юу</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="m-empty">${ico("history")}<span>Энэ хугацаанд бүртгэл алга</span></td></tr>`}</tbody>
        </table></div>
        ${more ? `<p class="muted">Эхний ${entries.length} бүртгэлийг харууллаа. Хугацаа эсвэл шүүлтүүрээ нарийсгана уу.</p>` : ""}
      </div>
    </section>
  </div>`;
}

function auditCsv() {
  const header = ["Цаг", "Хэн", "Эрх", "Үйлдэл", "Хэсэг", "Бүртгэл", "Өөрчлөлт", "Тайлбар", "IP"];
  const rows = s.audit.entries.map((entry) => [
    localInput(Date.parse(entry.at)).replace("T", " "),
    entry.who || "",
    ctx.roleLabel?.[entry.role] || entry.role || "",
    ACTION[entry.action]?.[0] || entry.action,
    entry.area || entry.path || "",
    entry.label || "",
    Object.entries(entry.changes || {})
      .map(([key, [before, after]]) => `${fieldLabel(entry.collection, key)}: ${valueText(entry.collection, key, before)} → ${valueText(entry.collection, key, after)}`)
      .join("; "),
    entry.note || "",
    entry.ip || "",
  ]);
  const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  link.download = `oorchlolt-${s.audit.from}_${s.audit.to}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

/* ---------- system: channels, deliveries, backups ---------- */

function loadSystem() {
  return load("system", async () => {
    s.system = await ctx.api("/api/admin/system");
    repaint("system");
  });
}

function channelCard(key, info) {
  const [label, icon] = CHANNEL[key];
  return `<article class="sys-channel${info.ready ? " is-ready" : ""}">
    <div class="m-head-ico">${ico(icon)}</div>
    <div><b>${esc(label)}</b> ${info.ready ? badge("Бэлэн", "ok") : badge("Тохируулаагүй", "warn")}<small>${esc(info.detail)}</small>${info.ready ? "" : `<p class="muted">${esc(ENV_HELP[key])}</p>`}</div>
  </article>`;
}

function deliveryRow(item) {
  const results = item.results.map((result) => `<span title="${esc(result.error || result.to)}">${badge(`${CHANNEL[result.channel]?.[0].split(" ")[0] || result.channel}${result.ok ? "" : " ✕"}`, result.ok ? "ok" : "bad")}</span>`).join(" ");
  return `<tr><td class="mono">${esc(moment(item.at))}</td><td>${esc(item.name)}</td><td class="sys-what">${item.level === "urgent" ? `${badge("Яаралтай", "bad")} ` : ""}${esc(item.text)}</td><td class="sys-results">${results}${item.tries > 1 ? ` <small class="muted">${item.tries}-р оролдлого</small>` : ""}</td></tr>`;
}

function backupRow(item) {
  const [label, tone] = REASON[item.reason] || [item.reason, ""];
  return `<tr><td class="mono">${esc(moment(new Date(item.at).toISOString()))}</td><td>${badge(label, tone)}</td><td>${esc(kb(item.size))}</td><td><div class="acts">
    <a class="icon-btn" href="/api/admin/backups/${encodeURIComponent(item.name)}" download="${esc(item.name)}" title="Татах" aria-label="Татах">${ico("download")}</a>
    <button class="icon-btn" type="button" data-sys="restore-backup" data-name="${esc(item.name)}" title="Энэ хуулбараас сэргээх" aria-label="Сэргээх">${ico("restore")}</button>
  </div></td></tr>`;
}

function firestoreBlock(firestore) {
  if (!firestore.configured) return `<p class="muted">Энэ сервер Firestore ашиглаагүй, өгөгдөл дотоод файлд хадгалагдаж байна. Дээрх автомат нөөц хуулбар хангалттай.</p>`;
  if (firestore.error) return `<p class="error">${esc(firestore.error)}</p><div class="row"><button class="chip" type="button" data-sys="firestore-enable">${ico("cloud")}Дахин оролдох</button></div>`;
  const schedules = firestore.schedules || [];
  const list = (firestore.backups || []).slice(0, 7);
  const days = (retention) => Math.round(Number(String(retention || "0").replace("s", "")) / 86400);
  return `${
    schedules.length
      ? `<p>${badge("Идэвхтэй", "ok")} ${schedules.map((item) => `${item.daily ? "Өдөр бүр" : `Долоо хоног бүр (${esc(item.weekly)})`}, ${days(item.retention)} хоног хадгална`).join("; ")}</p>`
      : `<p class="muted">Firestore-ийн автомат нөөцлөлт идэвхжээгүй байна. Идэвхжүүлбэл Google өдөр бүр бүтэн хуулбар авч 7 хоног хадгална (Blaze багц шаардлагатай).</p>
         <div class="row"><button class="primary" type="button" data-sys="firestore-enable">${ico("cloud")}Өдөр бүр нөөцлөхийг идэвхжүүлэх</button></div>`
  }${list.length ? `<ul class="sys-list">${list.map((item) => `<li><span class="mono">${esc(moment(item.snapshotTime))}</span> ${badge(item.state === "READY" ? "Бэлэн" : item.state, item.state === "READY" ? "ok" : "info")} <small class="muted">${esc(moment(item.expireTime))} хүртэл</small></li>`).join("")}</ul>` : ""}`;
}

export function systemView() {
  if (!s.system) return loading();
  const { channels, deliveries, contacts, backups, firestore } = s.system;
  const stat = (value, label, tone = "") => `<div class="m-stat${tone ? ` is-${tone}` : ""}"><b>${value}</b><span>${esc(label)}</span></div>`;
  const last = backups.list[0];
  const lastAge = last ? Math.round((Date.now() - last.at) / 3600000) : null;
  return `<div class="admin-page m-page sys-page">
    <section class="panel m-hero">
      <div class="m-hero-top">
        <div class="admin-shield">${ico("server")}</div>
        <h1>Мэдэгдэл ба нөөцлөлт</h1>
        <span class="m-pill">${esc(backups.storage)}</span>
      </div>
      <p class="ps-intro">Системийн мэдэгдлийг утас (push), и-мэйл, SMS-ээр илгээх тохиргоо, илгээлтийн бүртгэл, өгөгдлийн нөөц хуулбар.</p>
      <div class="m-stats">
        ${stat(`${contacts.push}/${contacts.users}`, "Push асаасан хүн")}
        ${stat(`${contacts.email}/${contacts.users}`, "И-мэйлтэй хүн")}
        ${stat(`${contacts.phone}/${contacts.users}`, "Утастай хүн")}
        ${stat(last ? (lastAge < 1 ? "Саяхан" : `${lastAge} ц`) : "Алга", "Сүүлийн нөөц хуулбар", !last || lastAge > backups.everyHours * 2 ? "neg" : "")}
      </div>
    </section>
    <section class="panel m-panel">
      <header class="m-panel-head"><div class="m-fold"><span class="m-head-ico">${ico("bell")}</span><h2>Мэдэгдлийн сувгууд</h2></div></header>
      <div class="m-panel-body">
        <div class="sys-channels">${["push", "email", "sms"].map((key) => channelCard(key, channels[key])).join("")}</div>
        <p class="muted">Ажил зогсоох дохио, SOS, цуглаан, тэсэлгээ, согтууруулах ундааны эерэг шалгалт, хугацаа хэтэрсэн гэрчилгээ, эрүүл мэндийн үзлэг «яаралтай» тул SMS-ээр ч явна. Утас, и-мэйлийг хэрэглэгч засах хэсэгт оруулна. Хүн бүр профайл хэсгээсээ суваг тус бүрийг тохируулна.</p>
      </div>
    </section>
    <section class="panel m-panel">
      <header class="m-panel-head"><div class="m-fold"><span class="m-head-ico">${ico("send")}</span><h2>Илгээлтийн бүртгэл</h2><span class="m-count">${deliveries.length}</span></div></header>
      <div class="m-panel-body"><div class="m-scroll"><table class="m-table">
        <thead><tr><th>Цаг</th><th>Хэнд</th><th>Мэдэгдэл</th><th>Суваг</th></tr></thead>
        <tbody>${deliveries.map(deliveryRow).join("") || `<tr><td colspan="4" class="m-empty">${ico("send")}<span>Гадагш илгээсэн мэдэгдэл алга</span></td></tr>`}</tbody>
      </table></div></div>
    </section>
    <section class="panel m-panel">
      <header class="m-panel-head">
        <div class="m-fold"><span class="m-head-ico">${ico("backup")}</span><h2>Нөөц хуулбар</h2><span class="m-count">${backups.list.length}</span></div>
        <div class="m-tools">
          <button class="primary" type="button" data-sys="backup-now">${ico("backup")}Одоо нөөцлөх</button>
          <label class="chip sys-upload">${ico("upload")}Файлаас сэргээх<input type="file" accept=".gz,.json,application/gzip,application/json" data-sys-upload hidden /></label>
        </div>
      </header>
      <div class="m-panel-body">
        <p class="muted">${backups.everyHours} цаг тутам автоматаар хадгалж, төрөл бүрийн сүүлийн ${backups.keep}-г үлдээнэ · хавтас <span class="mono">${esc(backups.dir)}</span>. Сэргээхийн өмнө одоогийн төлөвийг автоматаар хуулбарлана.</p>
        ${backups.persistent ? "" : `<p class="sys-warn">${ico("alert")}Сервер Render дээр ажиллаж байгаа тул энэ хавтас дахин байршуулахад устна. BACKUP_DIR-ийг байнгын диск (Persistent Disk) рүү заах, эсвэл хуулбарыг тогтмол татаж авна уу.</p>`}
        <div class="m-scroll"><table class="m-table">
          <thead><tr><th>Хэзээ</th><th>Төрөл</th><th>Хэмжээ</th><th></th></tr></thead>
          <tbody>${backups.list.map(backupRow).join("") || `<tr><td colspan="4" class="m-empty">${ico("backup")}<span>Нөөц хуулбар алга</span></td></tr>`}</tbody>
        </table></div>
      </div>
    </section>
    <section class="panel m-panel">
      <header class="m-panel-head"><div class="m-fold"><span class="m-head-ico">${ico("cloud")}</span><h2>Firestore автомат нөөцлөлт</h2></div></header>
      <div class="m-panel-body">${firestoreBlock(firestore)}</div>
    </section>
  </div>`;
}

/* ---------- profile: own notification settings ---------- */

function pushSupport() {
  if (window.UmbrellaApp) return "app";
  if (!window.isSecureContext) return "insecure";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "none";
  return "ok";
}

async function deviceEndpoint() {
  if (pushSupport() !== "ok") return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  return subscription?.endpoint || null;
}

function loadAlerts() {
  return load("alerts", async () => {
    const [view, endpoint] = await Promise.all([ctx.api("/api/me/alerts"), deviceEndpoint().catch(() => null)]);
    s.alerts = view;
    s.endpoint = endpoint;
    paintAlerts();
  });
}

function paintAlerts() {
  const node = ctx.stage.querySelector("#sys-alerts");
  if (node) node.outerHTML = alertsPanel();
}

function channelRow(key) {
  const view = s.alerts;
  const [label, icon] = CHANNEL[key];
  const level = view.prefs[key];
  let where = "";
  let problem = "";
  if (key === "push") {
    const support = pushSupport();
    const here = s.endpoint && view.devices.some((device) => device.endpoint === s.endpoint);
    const others = view.devices.length - (here ? 1 : 0);
    where = `${here ? "Энэ төхөөрөмж дээр асаалттай" : "Энэ төхөөрөмж дээр асаагаагүй"}${others > 0 ? ` · өөр ${others} төхөөрөмж` : ""}`;
    if (support === "app") problem = "UMBRELLA апп дотор мэдэгдэл аппаараа автоматаар ирнэ.";
    else if (support === "insecure") problem = "Push зөвхөн HTTPS хаягаар нээсэн үед ажиллана.";
    else if (support === "none") problem = "Энэ хөтөч push дэмжихгүй. iPhone дээр сайтыг «Home Screen»-д нэмж нээнэ.";
    else if (!view.ready.push) problem = "Сервер дээр push тохируулагдаагүй.";
    const button = support === "ok" && view.ready.push ? `<button class="chip" type="button" data-sys="${here ? "push-off" : "push-on"}">${here ? "Энэ төхөөрөмж дээр унтраах" : "Энэ төхөөрөмж дээр асаах"}</button>` : "";
    return row(label, icon, where, problem, level, key, button);
  }
  const address = key === "email" ? view.email : view.phone;
  where = address || "Хаяг бүртгээгүй";
  if (!view.ready[key]) problem = "Админ энэ сувгийг хараахан тохируулаагүй.";
  else if (!address) problem = `${key === "email" ? "И-мэйл" : "Утасны дугаар"}аа оруулахыг админаас хүснэ үү.`;
  return row(label, icon, where, problem, level, key, "");
}

function row(label, icon, where, problem, level, key, extra) {
  const options = Object.entries(LEVELS)
    .map(([value, text]) => `<option value="${value}"${value === level ? " selected" : ""}>${esc(text)}</option>`)
    .join("");
  return `<div class="sys-pref">
    <span class="m-head-ico">${ico(icon)}</span>
    <div class="sys-pref-main"><b>${esc(label)}</b><small>${esc(where)}</small>${problem ? `<small class="sys-pref-warn">${esc(problem)}</small>` : ""}${extra ? `<div class="row">${extra}</div>` : ""}</div>
    <select data-sys-pref="${key}" aria-label="${esc(label)} · хэзээ илгээх">${options}</select>
  </div>`;
}

export function alertsPanel() {
  if (!s.alerts) {
    loadAlerts();
    return `<section class="panel stack sys-alerts is-loading" id="sys-alerts"><h2>Мэдэгдэл хүлээн авах</h2><p class="muted">Ачаалж байна…</p></section>`;
  }
  const recent = s.alerts.recent
    .map((item) => `<li><span class="mono">${esc(moment(item.at))}</span> ${item.results.map((result) => badge(`${CHANNEL[result.channel]?.[0].split(" ")[0] || result.channel}${result.ok ? "" : " ✕"}`, result.ok ? "ok" : "bad")).join(" ")} <span class="muted">${esc(item.text)}</span></li>`)
    .join("");
  return `<section class="panel stack sys-alerts" id="sys-alerts">
    <h2>Мэдэгдэл хүлээн авах</h2>
    <p class="muted">Системийн мэдэгдэл апп дотор харагдахаас гадна сонгосон сувгаар тань ирнэ. «Яаралтай» нь ажил зогсоох дохио, SOS, цуглаан, тэсэлгээ, хугацаа хэтэрсэн гэрчилгээ, үзлэг.</p>
    ${["push", "email", "sms"].map(channelRow).join("")}
    <div class="row"><button class="chip" type="button" data-sys="alerts-test">${ico("send")}Туршилтын мэдэгдэл илгээх</button>${s.note ? `<span class="form-ok" role="status">${esc(s.note)}</span>` : ""}</div>
    ${recent ? `<ul class="sys-list">${recent}</ul>` : ""}
  </section>`;
}

function keyBytes(base64) {
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function pushOn() {
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Хөтөч мэдэгдэл харуулах зөвшөөрөл өгөөгүй байна. Хаягийн мөрний түгжээ дээр дарж зөвшөөрнө үү.");
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const key = keyBytes(s.alerts.vapidKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && subscription.options?.applicationServerKey && new Uint8Array(subscription.options.applicationServerKey).join() !== key.join()) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  s.alerts = await ctx.api("/api/me/push", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON() }) });
  s.endpoint = subscription.endpoint;
}

async function pushOff() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (subscription) {
    s.alerts = await ctx.api("/api/me/push", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
    await subscription.unsubscribe();
  }
  s.endpoint = null;
}

/* ---------- events ---------- */

async function busy(button, task) {
  if (button) button.disabled = true;
  try {
    await task();
  } catch (error) {
    ctx.toast?.("Алдаа", error.message);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

async function restoreFrom(body, label) {
  const res = await fetch(`/api/admin/backups/restore${typeof body === "string" ? `?name=${encodeURIComponent(body)}` : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: typeof body === "string" ? undefined : body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Сэргээж чадсангүй");
  alert(`Өгөгдлийг ${label}-аас сэргээлээ. Өмнөх төлөв «${data.before}» нэрээр хадгалагдсан. Хуудас дахин ачаалагдана.`);
  location.reload();
}

const RESTORE_WARNING = "Одоогийн бүх өгөгдөл (хэрэглэгч, бүртгэл, тохиргоо) энэ хуулбарын төлөв рүү буцна. Хуулбараас хойш хийсэн өөрчлөлт алга болно (одоогийн төлөвийг урьдчилан автоматаар хадгална). Үргэлжлүүлэх үү?";

async function onClick(event) {
  const target = event.target.closest("[data-sys]");
  if (!target || !ctx.stage.contains(target)) return;
  const action = target.dataset.sys;
  if (action === "toggle") {
    if (event.target.closest("button, a, input, select")) return;
    const id = target.dataset.id;
    if (s.open.has(id)) s.open.delete(id);
    else s.open.add(id);
    repaint("audit");
    return;
  }
  if (action === "audit-csv") auditCsv();
  if (action === "restore-record") {
    if (!confirm("Устгасан бүртгэлийг буцааж нэмэх үү? Зураг сэргэхгүй.")) return;
    await busy(target, async () => {
      await ctx.api(`/api/admin/audit/${encodeURIComponent(target.dataset.id)}/restore`, { method: "POST", body: "{}" });
      ctx.toast?.("Сэргээлээ", "Бүртгэл буцаж нэмэгдлээ.");
      s.audit = null;
      await loadAudit();
    });
  }
  if (action === "backup-now") {
    await busy(target, async () => {
      const result = await ctx.api("/api/admin/backups", { method: "POST", body: "{}" });
      s.system = result.view;
      repaint("system");
      ctx.toast?.("Нөөц хуулбар", `${result.item.name} (${kb(result.item.size)}) хадгалагдлаа.`);
    });
  }
  if (action === "restore-backup") {
    if (!confirm(RESTORE_WARNING)) return;
    await busy(target, () => restoreFrom(target.dataset.name, target.dataset.name));
  }
  if (action === "firestore-enable") {
    await busy(target, async () => {
      s.system = (await ctx.api("/api/admin/backups/firestore", { method: "POST", body: "{}" })).view;
      repaint("system");
      ctx.toast?.("Firestore", "Өдөр бүрийн автомат нөөцлөлт идэвхжлээ.");
    });
  }
  if (action === "push-on" || action === "push-off") {
    await busy(target, async () => {
      if (action === "push-on") await pushOn();
      else await pushOff();
      s.note = action === "push-on" ? "Энэ төхөөрөмж дээр push асаалаа." : "Энэ төхөөрөмж дээр push унтарлаа.";
      paintAlerts();
    });
  }
  if (action === "alerts-test") {
    await busy(target, async () => {
      s.alerts = await ctx.api("/api/me/alerts/test", { method: "POST", body: "{}" });
      s.note = "Илгээлээ. Хэдэн секундийн дотор ирнэ.";
      paintAlerts();
      setTimeout(() => {
        s.alerts = null;
        s.note = "";
        if (ctx.stage.querySelector("#sys-alerts")) loadAlerts();
      }, 8000);
    });
  }
}

async function onChange(event) {
  const pref = event.target.closest("[data-sys-pref]");
  if (pref) {
    await busy(pref, async () => {
      s.alerts = await ctx.api("/api/me/alerts", { method: "PUT", body: JSON.stringify({ [pref.dataset.sysPref]: pref.value }) });
      s.note = "Хадгалагдлаа";
      paintAlerts();
    });
    return;
  }
  const upload = event.target.closest("[data-sys-upload]");
  if (upload?.files?.[0]) {
    const file = upload.files[0];
    upload.value = "";
    if (!confirm(`«${file.name}» файлаас сэргээх үү?\n\n${RESTORE_WARNING}`)) return;
    await busy(null, () => restoreFrom(file, file.name));
    return;
  }
  const filter = event.target.closest("[data-sys-form='audit-filter'] select");
  if (filter) filter.form.requestSubmit();
}

function onSubmit(event) {
  const form = event.target.closest("[data-sys-form='audit-filter']");
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const to = data.to || today();
  s.query = { from: data.from && data.from <= to ? data.from : daysBefore(to, 6), to, by: data.by || "", action: data.action || "", q: String(data.q || "").trim() };
  s.open.clear();
  loadAudit();
}
