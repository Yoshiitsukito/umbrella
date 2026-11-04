// The finance, executive, coal and environment boards, the purchase and write-off decision window, and the
// printable monthly report. master.js owns the page frame and hands over its drawing helpers through bindBiz().
import { BUDGET_CATS, CAPEX_KINDS, DISPOSE_METHODS, ENV_METRICS, REHAB_STAGES, REQUEST_STAGES, SALE_STATUS } from "./minecore.js";
import { COAL_GRADES, depreciation, envState, momentMonth, monthLabel, netOf, requestValue, saleProgress } from "./bizcore.js";

let k = null;

/** { m, ctx, esc, ico, badge, panel, num, pct, fmtDate, fmtMoment, records, recordOf, refLabel, send, paint, apiBase, role, formError } */
export function bindBiz(kit) {
  k = kit;
}

export const REQUESTS = ["capex", "disposals"];
/** The request stage each role decides. */
export const STAGE_FOR = { finance: "finance", director: "director" };
export const STAGE_TONE = { finance: "warn", director: "info", approved: "ok", rejected: "bad" };
const ENV_TONE = { ok: "ok", near: "warn", over: "bad" };

export function money(value, { short = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "–";
  const size = Math.abs(number);
  if (short && size >= 1e9) return `${(number / 1e9).toFixed(size >= 1e11 ? 0 : 2)} тэрбум ₮`;
  if (short && size >= 1e6) return `${(number / 1e6).toFixed(size >= 1e8 ? 0 : 1)} сая ₮`;
  return `${(Math.round(number) || 0).toLocaleString("en-US")} ₮`;
}

const monthShort = (month) => `${Number(String(month).slice(5))}-р сар`;
const share = (part, whole) => (whole > 0 ? part / whole : null);

function requestTitle(name, item) {
  if (name === "capex") return `${item.title}${item.qty > 1 ? ` × ${item.qty}` : ""}`;
  return `${k.refLabel("equipment", item.equipment)} · ${DISPOSE_METHODS[item.method] || ""}`;
}

/** The book value a write-off leaves at: fixed at approval, otherwise the linked asset's current value. */
export function disposalBook(item) {
  if (item.stage === "approved") return item.book ?? null;
  const asset = k.records("assets").find((entry) => entry.equipment === item.equipment && entry.status === "active");
  return asset ? depreciation(asset, k.m.data.month).book : null;
}

export function stageCell(item) {
  const last = (item.trail || []).at(-1);
  const sub = item.stage === "rejected" && last?.note ? last.note : last ? `${last.by} · ${k.fmtMoment(last.at)}` : `Илгээсэн ${k.fmtMoment(item.createdAt)}`;
  return `<span class="m-who">${k.badge(REQUEST_STAGES[item.stage] || "–", STAGE_TONE[item.stage])}<small>${k.esc(sub)}</small></span>`;
}

/* ---------- small charts ---------- */

function cards(list) {
  return `<div class="m-kpis bz-kpis">${list
    .map(([icon, value, label, note = "", tone = ""]) => `<div class="m-kpi${tone ? ` is-${tone}` : ""}">${k.ico(icon)}<b>${value}</b><span>${k.esc(label)}</span>${note ? `<small>${note}</small>` : ""}</div>`)
    .join("")}</div>`;
}

function meter(part, whole, { invert = false } = {}) {
  const ratio = share(part, whole);
  const tone = ratio == null ? "" : invert ? (ratio > 1 ? "bad" : ratio > 0.9 ? "warn" : "ok") : ratio >= 1 ? "ok" : ratio >= 0.6 ? "warn" : "bad";
  return `<span class="bz-meter${tone ? ` is-${tone}` : ""}"><i style="width:${Math.min(100, Math.round((ratio || 0) * 100))}%"></i></span>`;
}

function trendChart(trend) {
  const top = Math.max(1, ...trend.flatMap((item) => [item.income, item.cost])) * 1.08;
  const columns = trend
    .map(
      (item) => `<div class="bz-tcol" title="${k.esc(monthLabel(item.month))}: орлого ${k.esc(money(item.income))}, зардал ${k.esc(money(item.cost))}">
        <div class="bz-tbars"><b class="is-in" style="height:${(item.income / top) * 100}%"></b><b class="is-out" style="height:${(item.cost / top) * 100}%"></b></div>
        <span>${monthShort(item.month)}</span><small class="${item.profit < 0 ? "is-neg" : "is-pos"}">${k.esc(money(item.profit))}</small>
      </div>`,
    )
    .join("");
  return `<div class="bz-trend" role="img" aria-label="6 сарын орлого, зардал">${columns}</div><p class="bz-legend"><i class="is-in"></i>Орлого<i class="is-out"></i>Зардал (элэгдэл орсон)<span>· доорх тоо: цэвэр ашиг</span></p>`;
}

function dailyChart(daily, key, label) {
  const top = Math.max(1, ...daily.map((item) => item[key])) * 1.1;
  const today = k.m.data.today;
  return `<div class="bz-daily" role="img" aria-label="${k.esc(label)}">${daily
    .map((item, index) => {
      const future = item.date > today;
      return `<div class="bz-dcol${future ? " is-future" : ""}" title="${k.fmtDate(item.date)}: ${k.num(item[key])} т"><b style="height:${(item[key] / top) * 100}%"></b><span>${index % 5 === 0 ? Number(item.date.slice(8)) : ""}</span></div>`;
    })
    .join("")}</div>`;
}

function budgetRows(money_) {
  return `<div class="bz-budget">${Object.entries(BUDGET_CATS)
    .map(([key, label]) => {
      const actual = money_.costs[key] || 0;
      const plan = money_.budget[key] || 0;
      const ratio = share(actual, plan);
      return `<div class="bz-brow"><span>${k.esc(label)}</span>${meter(actual, plan, { invert: true })}<b>${k.esc(money(actual))}</b><small>${plan ? `${k.esc(money(plan))} · ${Math.round((ratio || 0) * 100)}%` : "төсөвгүй"}</small></div>`;
    })
    .join("")}</div>`;
}

function profitTable(money_) {
  const row = (label, value, cls = "") => `<tr class="${cls}"><th>${k.esc(label)}</th><td>${k.esc(money(value, { short: false }))}</td></tr>`;
  return `<table class="bz-pl"><tbody>
    ${row("Нүүрсний борлуулалтын орлого", money_.revenue)}
    ${money_.assetGain ? row("Хөрөнгө актласны ашиг / алдагдал", money_.assetGain) : ""}
    ${row("Нийт орлого", money_.income, "is-sum")}
    ${Object.entries(BUDGET_CATS).map(([key, label]) => row(key === "fuel" ? `${label} (${k.num(money_.liters)} л)` : label, -(money_.costs[key] || 0))).join("")}
    ${row(money_.share < 1 ? `Элэгдэл (сарын ${Math.round(money_.share * 100)}%)` : "Элэгдэл", -money_.depreciation)}
    ${row("Цэвэр ашиг", money_.profit, `is-total${money_.profit < 0 ? " is-neg" : ""}`)}
  </tbody></table>`;
}

/* ---------- requests ---------- */

function requestRows(filter) {
  return REQUESTS.flatMap((name) => k.records(name).filter(filter).map((item) => ({ name, item }))).sort((a, b) => String(b.item.createdAt).localeCompare(String(a.item.createdAt)));
}

function requestList(stage) {
  const rows = requestRows((item) => item.stage === stage);
  if (!rows.length) return `<p class="bz-none">${k.ico("check", "m-ico tiny")}Шийдвэр хүлээж буй хүсэлт алга</p>`;
  return `<ul class="bz-reqs">${rows
    .map(({ name, item }) => {
      const sub = name === "capex" ? `${CAPEX_KINDS[item.kind]} · ${k.fmtMoment(item.createdAt)}` : `Актлах хүсэлт · ${k.fmtMoment(item.createdAt)}`;
      return `<li><button type="button" class="bz-req" data-m="request" data-name="${name}" data-id="${item.id}">
        <span class="bz-req-ico">${k.ico(name === "capex" ? "cart" : "tag")}</span>
        <span class="bz-req-main"><b>${k.esc(requestTitle(name, item))}</b><small>${k.esc(sub)}</small></span>
        <b class="bz-req-sum">${k.esc(money(requestValue(name, item)))}</b>${k.ico("chevron", "m-ico bz-req-go")}
      </button></li>`;
    })
    .join("")}</ul>`;
}

/** How the approval runs, shown above the request tables. */
function flowStrip() {
  const role = k.role();
  const step = (who, text, on) => `<li class="${on ? "is-on" : ""}"><b>${who}</b><span>${text}</span></li>`;
  return `<ol class="bz-flow" aria-label="Батлах дараалал">
    ${step("1 · Уулын ахлах инженер", "Худалдан авах, актлах хүсэлт гаргана", role === "engineer")}
    ${step("2 · Санхүү", "Төсөв, үнийн саналыг хянаж захиралд шилжүүлнэ", role === "finance")}
    ${step("3 · Гүйцэтгэх захирал", "Эцэслэн батална · хөрөнгө, зардалд автоматаар бүртгэгдэнэ", role === "director")}
  </ol>`;
}

export function requestsTab(names = REQUESTS) {
  return `${flowStrip()}<div class="bz-stack">${names.map((name) => k.collectionPanel(name)).join("")}</div>`;
}

function steps(item, name) {
  const entry = (role) => (item.trail || []).find((row) => row.role === role);
  const step = (label, row, waiting) => {
    const state = row ? (row.ok ? "ok" : "bad") : waiting ? "wait" : "idle";
    const icon = { ok: "check", bad: "cross", wait: "clock", idle: "clock" }[state];
    return `<li class="bz-step is-${state}"><i>${k.ico(icon, "m-ico tiny")}</i><div><b>${label}</b><span>${row ? `${k.esc(row.by)} · ${k.fmtMoment(row.at)}` : waiting ? "Хүлээгдэж байна" : "–"}</span>${row?.note ? `<p>${k.esc(row.note)}</p>` : ""}</div></li>`;
  };
  const done =
    item.stage === "approved"
      ? name === "capex"
        ? item.asset
          ? "Үндсэн хөрөнгийн бүртгэлд нэмэгдлээ."
          : "Сэлбэг, материалын зардалд бүртгэгдлээ."
        : "Техник актлагдаж, паркаас хасагдлаа."
      : "";
  return `<ol class="bz-steps">
    <li class="bz-step is-ok"><i>${k.ico("check", "m-ico tiny")}</i><div><b>Уулын ахлах инженер · хүсэлт</b><span>${k.fmtMoment(item.createdAt)}</span></div></li>
    ${step("Санхүү · хяналт", entry("finance"), item.stage === "finance")}
    ${step("Гүйцэтгэх захирал · батлах", entry("director"), item.stage === "director")}
  </ol>${done ? `<p class="m-hint">${k.ico("check")}<span>${done}</span></p>` : ""}`;
}

export function openRequest(name, id) {
  const item = k.recordOf(name, id);
  if (!item) return;
  const role = k.role();
  const mine = STAGE_FOR[role] === item.stage;
  const value = requestValue(name, item);
  const book = name === "disposals" ? disposalBook(item) : null;
  const facts =
    name === "capex"
      ? [["Төрөл", CAPEX_KINDS[item.kind]], ["Тоо ширхэг", k.num(item.qty)], ["Нэгжийн үнэ", money(item.price, { short: false })], ["Нийт дүн", money(value, { short: false })], ["Нийлүүлэгч", item.vendor || "–"], ["Шаардлагатай", k.fmtDate(item.needBy)]]
      : [["Техник", k.refLabel("equipment", item.equipment)], ["Хэлбэр", DISPOSE_METHODS[item.method]], ["Үнэлгээ", money(value, { short: false })], ["Дансны үнэ", book == null ? "Хөрөнгийн бүртгэлгүй" : money(book, { short: false })], ...(book != null ? [["Ашиг / алдагдал", money(value - book, { short: false })]] : [])];
  const verbs = role === "director" ? ["Батлах", "Татгалзах"] : ["Захиралд илгээх", "Татгалзах"];
  const form = mine
    ? `<form class="m-form bz-decide" novalidate>
        <label class="m-field is-wide"><span>Тайлбар${role === "director" ? "" : " (захиралд)"}</span><textarea name="note" maxlength="300" rows="3" placeholder="Татгалзвал шалтгаанаа заавал бичнэ"></textarea></label>
        <p class="form-error m-form-error" role="alert" hidden></p>
        <div class="modal-actions"><button class="chip" type="button" data-close>Хаах</button><button class="chip danger" type="submit" data-ok="0">${k.ico("cross")}${verbs[1]}</button><button class="primary" type="submit" data-ok="1">${k.ico("check")}${verbs[0]}</button></div>
      </form>`
    : `<div class="modal-actions"><button class="chip" type="button" data-close>Хаах</button></div>`;
  const body = `<div class="bz-request">
      <div class="bz-request-head">${k.badge(REQUEST_STAGES[item.stage], STAGE_TONE[item.stage])}<b>${k.esc(money(value))}</b></div>
      <dl class="m-dl">${facts.map(([label, text]) => `<div><dt>${k.esc(label)}</dt><dd>${k.esc(text)}</dd></div>`).join("")}<div class="is-wide"><dt>Үндэслэл</dt><dd><p class="m-pre">${k.esc(item.reason)}</p></dd></div></dl>
      ${steps(item, name)}
    </div>${form}`;
  const wrap = k.ctx().openModal({ shield: k.ico(name === "capex" ? "cart" : "tag"), title: k.esc(requestTitle(name, item)), sub: name === "capex" ? "Худалдан авах хүсэлт" : "Техник актлах, худалдах хүсэлт", body, className: "m-modal" });
  const node = wrap?.querySelector("form.bz-decide");
  if (!node) return;
  node.addEventListener("input", () => (node.dataset.dirty = "1"), { once: true });
  node.addEventListener("submit", async (event) => {
    event.preventDefault();
    const ok = event.submitter?.dataset.ok === "1";
    const note = node.elements.note.value.trim();
    k.formError(node, "");
    if (!ok && !note) {
      k.formError(node, "Татгалзсан шалтгаанаа бичнэ үү");
      return;
    }
    for (const button of node.querySelectorAll("button[type='submit']")) button.disabled = true;
    try {
      await k.send(`${k.apiBase()}/requests/${name}/${encodeURIComponent(id)}/decide`, "POST", { ok, note });
      k.ctx().closeModal(true);
      setTimeout(() => k.paint(true), 260);
      k.ctx().toast(role === "director" ? "Гүйцэтгэх захирал" : "Санхүү", ok ? (role === "director" ? "Хүсэлт батлагдлаа" : "Захиралд илгээгдлээ") : "Хүсэлтийг татгалзлаа");
    } catch (error) {
      k.formError(node, error.message);
      for (const button of node.querySelectorAll("button[type='submit']")) button.disabled = false;
    }
  });
}

/* ---------- hero numbers and tab counts ---------- */

export function bizHero(view) {
  const d = k.m.data;
  const s = d.summary;
  if (view === "procure") {
    const all = requestRows(() => true);
    const count = (stage) => all.filter(({ item }) => item.stage === stage).length;
    const waiting = all.filter(({ item }) => ["finance", "director"].includes(item.stage));
    return [[count("finance"), "Санхүү хянаж буй"], [count("director"), "Захирал батлах"], [count("approved"), "Батлагдсан"], [count("rejected"), "Татгалзсан", count("rejected") ? "neg" : ""], [money(waiting.reduce((sum, { name, item }) => sum + requestValue(name, item), 0)), "Хүлээгдэж буй дүн"]];
  }
  if (!s) return [];
  if (view === "finance") return [[money(s.money.income), "Сарын орлого"], [money(s.money.costTotal + s.money.depreciation), "Зардал, элэгдэл"], [money(s.money.profit), "Цэвэр ашиг", s.money.profit < 0 ? "neg" : ""], [s.approvals.finance, "Хянах хүсэлт", s.approvals.finance ? "neg" : ""], [`${k.num(d.fin.settings?.fuelPrice)} ₮`, "Түлш, литр"]];
  if (view === "exec") {
    const ratio = share(s.production.tonnes, s.production.planToDate);
    return [[`${k.num(s.production.tonnes)} т`, `Олборлолт · ${ratio == null ? "–" : `${Math.round(ratio * 100)}%`}`], [money(s.coal.revenue), "Борлуулалт"], [money(s.money.profit), "Цэвэр ашиг", s.money.profit < 0 ? "neg" : ""], [s.approvals.director, "Батлах хүсэлт", s.approvals.director ? "neg" : ""], [s.hse.daysSinceLti ?? "–", "LTI-гүй хоног"]];
  }
  if (view === "coal") return [[`${k.num(s.coal.stockpile)} т`, "Агуулахын нөөц"], [`${k.num(s.coal.shipped)} т`, "Энэ сард ачсан"], [s.coal.trucks, "Ачилт, машин"], [s.coal.cv ? `${k.num(s.coal.cv)}` : "–", "Дундаж илчлэг, ккал/кг"], [s.coal.openSales, "Нээлттэй гэрээ"]];
  if (view === "env") return [[s.env.over, "Хэтрэлт · энэ сар", s.env.over ? "neg" : ""], [s.env.readings, "Хэмжилт · энэ сар"], [`${k.num(s.env.rehabDone)} / ${k.num(s.env.rehabPlanned)} га`, "Нөхөн сэргээлт"], [k.pct(share(s.env.rehabDone, s.env.rehabPlanned)), "Гүйцэтгэл"], [s.env.openAudits, "Нээлттэй шалгалт", s.env.openAudits ? "neg" : ""]];
  return [];
}

/** Requests waiting for this role, for the tab and nav counts. */
export function myInbox() {
  const stage = STAGE_FOR[k.role()];
  return stage ? requestRows((item) => item.stage === stage).length : 0;
}

export function bizTabAlert(tab) {
  const d = k.m.data;
  if (tab === "requests" || tab === "approvals") return myInbox();
  if (tab === "envReadings") return (d.env?.envReadings || []).filter((item) => momentMonth(item.at) === d.month && envState(item) === "over").length;
  if (tab === "envAudits") return (d.env?.envAudits || []).filter((item) => item.status === "open" && item.due && item.due < d.today).length;
  if (tab === "capex" || tab === "disposals") return k.role() === "engineer" ? k.records(tab).filter((item) => item.stage === "rejected" && item.trail?.at(-1)?.at > new Date(Date.parse(d.now) - 7 * 864e5).toISOString()).length : 0;
  return null;
}

/* ---------- boards ---------- */

function moneyCards(s) {
  const used = share(s.money.costTotal, s.money.budgetTotal);
  return cards([
    ["coin", money(s.money.income), "Орлого", `${k.num(s.coal.shipped)} т борлуулсан`],
    ["wallet", money(s.money.costTotal), "Зардал", s.money.budgetTotal ? `Төсвийн ${Math.round((used || 0) * 100)}%` : "Төсөвгүй", used > 1 ? "bad" : used > 0.9 ? "warn" : ""],
    ["chart", money(s.money.depreciation), "Элэгдэл"],
    ["trend", money(s.money.profit), "Цэвэр ашиг", s.money.margin == null ? "" : `Ашгийн хувь ${Math.round(s.money.margin * 100)}%`, s.money.profit < 0 ? "bad" : "ok"],
  ]);
}

export function financeOverview() {
  const d = k.m.data;
  const s = d.summary;
  const fuel = `<form class="m-inline" data-mform="fuel"><label title="Түлшний үнэ, ₮/литр">${k.ico("fuel")}<input type="number" name="fuelPrice" min="100" max="20000" step="10" value="${d.fin.settings?.fuelPrice || ""}" aria-label="Түлшний үнэ, ₮/литр" /><span>₮/л</span></label><button class="icon-btn" type="submit" title="Хадгалах" aria-label="Хадгалах">${k.ico("check")}</button></form>`;
  const assets = k.records("assets").filter((item) => item.status === "active");
  const book = assets.reduce((sum, item) => sum + depreciation(item, d.month).book, 0);
  const cost = assets.reduce((sum, item) => sum + item.cost, 0);
  return `
    ${k.panel({ key: "fin-kpi", icon: "coin", title: `${monthLabel(d.month)} · гүйцэтгэл`, tools: fuel, body: moneyCards(s) })}
    <div class="m-grid">
      ${k.panel({ key: "fin-trend", icon: "trend", title: "Орлого, зардал · 6 сар", body: trendChart(d.trend) })}
      ${k.panel({ key: "fin-pl", icon: "list", title: "Ашиг, алдагдлын тайлан", body: profitTable(s.money) })}
    </div>
    <div class="m-grid">
      ${k.panel({ key: "fin-budget", icon: "sliders", title: "Төсөв ба гүйцэтгэл", body: budgetRows(s.money) })}
      ${k.panel({ key: "fin-queue", icon: "gavel", title: "Санхүү хянах хүсэлт", count: s.approvals.finance, body: `${requestList("finance")}<p class="bz-note">${k.ico("briefcase", "m-ico tiny")}Үндсэн хөрөнгө ${assets.length} · анхны өртөг ${k.esc(money(cost))} · үлдэгдэл ${k.esc(money(book))}</p>` })}
    </div>`;
}

export function revenueTab() {
  const d = k.m.data;
  const rows = k
    .records("sales")
    .filter((item) => item.status !== "cancelled")
    .map((sale) => {
      const progress = saleProgress(sale, k.records("shipments"));
      return `<li class="bz-contract"><div><b>${k.esc(sale.buyer)}</b><small>${k.esc(sale.contract || "")} · ${k.num(sale.price)} ₮/т · ${k.esc(SALE_STATUS[sale.status])}</small></div>${meter(progress.shipped, sale.tonnes)}<span>${k.num(Math.round(progress.shipped))} / ${k.num(sale.tonnes)} т</span><b>${k.esc(money(progress.value))}</b></li>`;
    })
    .join("");
  const note = `<p class="bz-note">${k.ico("coin", "m-ico tiny")}${monthLabel(d.month)}ын орлого ${k.esc(money(d.summary.coal.revenue))} · ${k.num(d.summary.coal.shipped)} т</p>`;
  return `${k.panel({ key: "rev-contracts", icon: "coin", title: "Гэрээний биелэлт ба орлого · гэрээ эхэлснээс хойш", body: rows ? `<ul class="bz-contracts">${rows}</ul>${note}` : `<p class="bz-none">Гэрээ алга</p>` })}
    ${k.collectionPanel("shipments")}${k.collectionPanel("sales")}`;
}

export function execBoard() {
  const d = k.m.data;
  const s = d.summary;
  const prod = share(s.production.tonnes, s.production.planToDate);
  const avail = s.fleet.availability;
  const top = cards([
    ["mine", `${k.num(s.production.tonnes)} т`, "Олборлолт", `Төлөвлөгөө ${k.num(s.production.planToDate)} т · ${prod == null ? "–" : `${Math.round(prod * 100)}%`}`, prod == null ? "" : prod >= 1 ? "ok" : prod >= 0.9 ? "warn" : "bad"],
    ["scale", `${k.num(s.coal.shipped)} т`, "Нүүрс ачилт", `${s.coal.trucks} машин · нөөц ${k.num(s.coal.stockpile)} т`],
    ["coin", money(s.money.income), "Орлого", `${s.coal.openSales} нээлттэй гэрээ`],
    ["trend", money(s.money.profit), "Цэвэр ашиг", s.money.margin == null ? "" : `Ашгийн хувь ${Math.round(s.money.margin * 100)}%`, s.money.profit < 0 ? "bad" : "ok"],
    ["people", `${s.people.onSite}/${s.people.staff}`, "Талбай дээр", "Ээлжийн ажилтан"],
    ["truck", k.pct(avail), "Техникийн бэлэн байдал", `${s.fleet.ready}/${s.fleet.total} бэлэн${s.fleet.retired ? ` · ${s.fleet.retired} актлагдсан` : ""}`, avail == null ? "" : avail >= 0.85 ? "ok" : avail >= 0.7 ? "warn" : "bad"],
    ["shield", s.hse.daysSinceLti ?? "–", "LTI-гүй хоног", `${s.hse.incidents} осол · ${s.hse.nearmiss} дөхөлт · ${s.hse.violations} зөрчил`, s.hse.lti ? "bad" : "ok"],
    ["leaf", s.env.over, "Байгаль орчны хэтрэлт", `Нөхөн сэргээлт ${k.pct(share(s.env.rehabDone, s.env.rehabPlanned))}`, s.env.over ? "warn" : "ok"],
  ]);
  return `
    ${k.panel({ key: "exec-kpi", icon: "gauge", title: `${monthLabel(d.month)} · ${s.elapsed}/${s.days} хоног`, body: top })}
    <div class="m-grid">
      ${k.panel({ key: "exec-queue", icon: "gavel", title: "Таны батлах хүсэлт", count: s.approvals.director, body: requestList("director") })}
      ${k.panel({ key: "exec-trend", icon: "trend", title: "Орлого, зардал · 6 сар", body: trendChart(d.trend) })}
    </div>
    <div class="m-grid">
      ${k.panel({ key: "exec-prod", icon: "mine", title: "Олборлолт · өдрөөр (тонн)", body: dailyChart(s.production.daily, "tonnes", "Өдрийн олборлолт") })}
      ${k.panel({ key: "exec-ship", icon: "scale", title: "Нүүрс ачилт · өдрөөр (тонн)", body: dailyChart(s.production.daily, "shipped", "Өдрийн ачилт") })}
    </div>
    <div class="m-grid">
      ${k.panel({ key: "exec-budget", icon: "sliders", title: "Төсөв ба гүйцэтгэл", body: budgetRows(s.money) })}
      ${k.panel({ key: "exec-pl", icon: "list", title: "Ашиг, алдагдал", body: profitTable(s.money) })}
    </div>`;
}

export function coalBoard() {
  const d = k.m.data;
  const s = d.summary;
  const grades = Object.entries(COAL_GRADES)
    .map(([key, label]) => {
      const count = s.coal.grades[key] || 0;
      return count ? `<i class="bz-grade is-${key}" style="flex:${count}" title="${k.esc(label)}: ${count}">${k.esc(label)} · ${count}</i>` : "";
    })
    .join("");
  const opening = k.role() === "shipmgr" ? `<form class="m-inline" data-mform="opening"><label title="Эхний үлдэгдэл, тонн">${k.ico("box")}<input type="number" name="opening" min="0" step="100" value="${d.coal.settings?.opening ?? 0}" aria-label="Агуулахын эхний үлдэгдэл, тонн" /><span>т</span></label><button class="icon-btn" type="submit" title="Хадгалах" aria-label="Хадгалах">${k.ico("check")}</button></form>` : "";
  const contracts = k
    .records("sales")
    .filter((item) => item.status === "open")
    .map((sale) => {
      const progress = saleProgress(sale, k.records("shipments"));
      return `<li class="bz-contract"><div><b>${k.esc(sale.buyer)}</b><small>${k.esc(sale.contract || "")}${sale.minCv ? ` · ≥ ${k.num(sale.minCv)} ккал/кг` : ""}</small></div>${meter(progress.shipped, sale.tonnes)}<span>${k.num(Math.round(progress.shipped))} / ${k.num(sale.tonnes)} т</span><b>${k.num(Math.round(progress.left))} т үлдсэн</b></li>`;
    })
    .join("");
  return `
    ${k.panel({
      key: "coal-kpi",
      icon: "coal",
      title: `${monthLabel(d.month)} · нүүрс`,
      tools: opening,
      body: cards([
        ["box", `${k.num(s.coal.stockpile)} т`, "Агуулахын нөөц", `Эхний үлдэгдэл ${k.num(d.coal.settings?.opening ?? 0)} т + олборлолт − ачилт`],
        ["scale", `${k.num(s.coal.shipped)} т`, "Энэ сард ачсан", `${s.coal.trucks} машин`],
        ["flask", s.coal.cv ? k.num(s.coal.cv) : "–", "Дундаж илчлэг, ккал/кг", `${s.coal.samples} дээж`],
        ["chart", s.coal.ash ?? "–", "Дундаж үнс, %", `Чийг ${s.coal.moisture ?? "–"}%`],
        ["coin", money(s.coal.revenue), "Борлуулалт", `${k.num(s.coal.contractedLeft)} т гэрээт үлдэгдэл`],
      ]),
    })}
    <div class="m-grid">
      ${k.panel({ key: "coal-contracts", icon: "briefcase", title: "Нээлттэй гэрээний биелэлт", count: s.coal.openSales, body: contracts ? `<ul class="bz-contracts">${contracts}</ul>` : `<p class="bz-none">Нээлттэй гэрээ алга</p>` })}
      ${k.panel({ key: "coal-quality", icon: "flask", title: "Чанарын зэрэглэл · энэ сар", body: grades ? `<div class="bz-grades">${grades}</div><p class="bz-note">Дээд зэрэг: илчлэг ≥ 6,000, үнс ≤ 15% · Стандарт: илчлэг ≥ 5,000, үнс ≤ 25%</p>` : `<p class="bz-none">Энэ сард шинжилгээ алга</p>` })}
    </div>
    ${k.panel({ key: "coal-daily", icon: "scale", title: "Ачилт · өдрөөр (тонн)", body: dailyChart(s.production.daily, "shipped", "Өдрийн ачилт") })}`;
}

export function envBoard() {
  const d = k.m.data;
  const readings = d.env.envReadings;
  const metrics = Object.entries(ENV_METRICS)
    .map(([key, spec]) => {
      const list = readings.filter((item) => item.metric === key).sort((a, b) => b.at.localeCompare(a.at));
      const latest = list[0];
      const month = list.filter((item) => momentMonth(item.at) === d.month);
      const over = month.filter((item) => envState(item) === "over").length;
      const state = latest ? envState(latest) : null;
      const limit = spec.min != null ? `${spec.min}–${spec.max}` : spec.max != null ? `≤ ${spec.max}` : "–";
      return `<div class="bz-env${state ? ` is-${ENV_TONE[state]}` : ""}">
        <span class="bz-env-top">${k.esc(spec.label)}${state ? k.badge(state === "over" ? "Хэтэрсэн" : state === "near" ? "Ойртсон" : "Хэвийн", ENV_TONE[state]) : ""}</span>
        <b>${latest ? `${k.num(latest.value)}<small>${k.esc(spec.unit)}</small>` : "–"}</b>
        <span>${latest ? `${k.esc(latest.point)} · ${k.fmtMoment(latest.at)}` : "Хэмжилт алга"}</span>
        <small>Хязгаар ${k.esc(limit)} ${k.esc(spec.unit)} · энэ сард ${month.length} хэмжилт, ${over} хэтрэлт</small>
      </div>`;
    })
    .join("");
  const breaches = readings
    .filter((item) => envState(item) === "over")
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)
    .map((item) => `<li><b>${k.esc(ENV_METRICS[item.metric]?.label)} · ${k.num(item.value)} ${k.esc(ENV_METRICS[item.metric]?.unit)}</b><span>${k.esc(item.point)} · ${k.fmtMoment(item.at)}</span></li>`)
    .join("");
  const rehab = k
    .records("rehab")
    .map((item) => `<li class="bz-contract"><div><b>${k.esc(item.name)}</b><small>${k.esc(REHAB_STAGES[item.stage])}${item.due ? ` · ${k.fmtDate(item.due)}` : ""}</small></div>${meter(item.done, item.planned)}<span>${k.num(item.done)} / ${k.num(item.planned)} га</span><b>${k.pct(share(item.done, item.planned))}</b></li>`)
    .join("");
  return `
    ${k.panel({ key: "env-metrics", icon: "leaf", title: "Хяналт шинжилгээний сүүлийн утга", body: `<div class="bz-envs">${metrics}</div>` })}
    <div class="m-grid">
      ${k.panel({ key: "env-breach", icon: "alert", title: "Сүүлийн хэтрэлтүүд", body: breaches ? `<ul class="bz-breaches">${breaches}</ul>` : `<p class="bz-none">${k.ico("check", "m-ico tiny")}Хэтрэлт алга</p>` })}
      ${k.panel({ key: "env-rehab", icon: "leaf", title: "Нөхөн сэргээлтийн явц", body: rehab ? `<ul class="bz-contracts">${rehab}</ul>` : `<p class="bz-none">Талбай бүртгээгүй</p>` })}
    </div>`;
}

/* ---------- monthly report ---------- */

export function openReportPicker() {
  const d = k.m.data;
  const body = `<form class="m-form" novalidate>
      <div class="m-form-grid"><label class="m-field"><span>Тайлант сар</span><input type="month" name="month" value="${d.month}" max="${d.month}" required /></label></div>
      <p class="m-hint">${k.ico("print")}<span>Тайланг урьдчилан харж, «Хэвлэх / PDF» товчоор хэвлэх цонхонд «Save as PDF / PDF болгон хадгалах»-ыг сонгоно уу.</span></p>
      <p class="form-error m-form-error" role="alert" hidden></p>
      <div class="modal-actions"><button class="chip" type="button" data-close>Болих</button><button class="primary" type="submit">${k.ico("report")}Тайлан харах</button></div>
    </form>`;
  const wrap = k.ctx().openModal({ shield: k.ico("report"), title: "Сарын тайлан", sub: "Үйлдвэрлэл, борлуулалт, санхүү, ХАБЭА, байгаль орчин", body, className: "m-modal" });
  const form = wrap?.querySelector("form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const month = form.elements.month.value;
    if (!/^\d{4}-\d{2}$/.test(month)) return k.formError(form, "Сараа сонгоно уу");
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      const report = await k.ctx().api(`${k.apiBase()}/report?month=${month}`);
      k.ctx().closeModal(true);
      showReport(report);
    } catch (error) {
      k.formError(form, error.message);
      button.disabled = false;
    }
  });
}

/** The report in a full-screen frame over the page; printing the frame prints the report alone, with no pop-up. */
function showReport(report) {
  const shade = document.createElement("div");
  shade.className = "bz-report";
  shade.setAttribute("role", "dialog");
  shade.setAttribute("aria-modal", "true");
  shade.setAttribute("aria-label", "Сарын тайлан");
  shade.innerHTML = `<div class="bz-report-bar"><b>${k.ico("report")}Сарын тайлан · ${k.esc(monthLabel(report.summary.month))}</b><span><button class="primary" type="button" data-act="print">${k.ico("print")}Хэвлэх / PDF</button><button class="chip" type="button" data-act="close">Хаах</button></span></div><iframe title="Сарын тайлан"></iframe>`;
  const frame = shade.querySelector("iframe");
  frame.srcdoc = reportHtml(report);
  const close = () => {
    shade.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event) => event.key === "Escape" && close();
  shade.addEventListener("click", (event) => {
    const act = event.target.closest("[data-act]")?.dataset.act;
    if (act === "print") frame.contentWindow?.print();
    if (act === "close") close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(shade);
  shade.querySelector("[data-act='print']").focus();
}

function svgBars(values, { height = 120, color = "#c8102e", labels = [] } = {}) {
  const width = 640;
  const top = Math.max(1, ...values) * 1.1;
  const step = width / Math.max(1, values.length);
  const bars = values.map((value, index) => `<rect x="${index * step + step * 0.15}" y="${height - (value / top) * height}" width="${step * 0.7}" height="${(value / top) * height}" fill="${color}" rx="1.5"/>`).join("");
  const text = labels.map((label, index) => (label ? `<text x="${index * step + step / 2}" y="${height + 13}" font-size="9" text-anchor="middle" fill="#666">${label}</text>` : "")).join("");
  return `<svg viewBox="0 0 ${width} ${height + 18}" width="100%" role="img">${bars}${text}<line x1="0" y1="${height}" x2="${width}" y2="${height}" stroke="#bbb"/></svg>`;
}

function svgTrend(trend) {
  const width = 640;
  const height = 140;
  const top = Math.max(1, ...trend.flatMap((item) => [item.income, item.cost])) * 1.1;
  const step = width / trend.length;
  const bars = trend
    .map((item, index) => {
      const x = index * step;
      const bar = (value, offset, fill) => `<rect x="${x + step * offset}" y="${height - (value / top) * height}" width="${step * 0.3}" height="${(value / top) * height}" fill="${fill}" rx="1.5"/>`;
      return `${bar(item.income, 0.18, "#2b8a3e")}${bar(item.cost, 0.52, "#c8102e")}<text x="${x + step / 2}" y="${height + 13}" font-size="10" text-anchor="middle" fill="#555">${monthShort(item.month)}</text>`;
    })
    .join("");
  return `<svg viewBox="0 0 ${width} ${height + 18}" width="100%" role="img">${bars}<line x1="0" y1="${height}" x2="${width}" y2="${height}" stroke="#bbb"/></svg>`;
}

function reportHtml(report) {
  const esc = k.esc;
  const s = report.summary;
  const m = s.money;
  const cell = (value) => `<td>${esc(value)}</td>`;
  const kpi = (value, label) => `<div class="kpi"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
  const ratio = share(s.production.tonnes, s.production.planToDate);
  const days = s.production.daily;
  const contracts = report.contracts.map((item) => `<tr>${cell(item.buyer)}${cell(item.contract || "")}${cell(`${k.num(item.tonnes)} т`)}${cell(`${k.num(Math.round(item.shipped))} т`)}${cell(`${Math.round(item.share * 100)}%`)}${cell(money(item.value, { short: false }))}${cell(SALE_STATUS[item.status] || "")}</tr>`).join("");
  const costs = Object.entries(BUDGET_CATS)
    .map(([key, label]) => `<tr>${cell(label)}${cell(money(m.costs[key] || 0, { short: false }))}${cell(m.budget[key] ? money(m.budget[key], { short: false }) : "–")}${cell(m.budget[key] ? `${Math.round(((m.costs[key] || 0) / m.budget[key]) * 100)}%` : "–")}</tr>`)
    .join("");
  const decided = report.decided.map((item) => `<tr>${cell(item.name === "capex" ? "Худалдан авалт" : "Актлах")}${cell(item.title)}${cell(money(item.value, { short: false }))}${cell(REQUEST_STAGES[item.stage])}${cell(k.fmtMoment(item.decidedAt))}</tr>`).join("");
  const breaches = report.breaches.map((item) => `<tr>${cell(k.fmtMoment(item.at))}${cell(item.point)}${cell(item.limit?.label || item.metric)}${cell(`${k.num(item.value)} ${item.limit?.unit || ""}`)}${cell(item.limit?.min != null ? `${item.limit.min}–${item.limit.max}` : `≤ ${item.limit?.max ?? "–"}`)}</tr>`).join("");
  const section = (title, inner) => `<section><h2>${esc(title)}</h2>${inner}</section>`;
  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><title>Сарын тайлан · ${esc(monthLabel(s.month))}</title>
    <style>
      @page{size:A4;margin:14mm}
      body{font:12px/1.45 system-ui,"Segoe UI",sans-serif;color:#151515;margin:24px}
      header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #c8102e;padding-bottom:10px;margin-bottom:14px}
      header h1{font-size:20px;margin:0}header p{margin:2px 0 0;color:#555}.brand{font-weight:800;letter-spacing:.08em;color:#c8102e;font-size:11px}
      h2{font-size:14px;margin:18px 0 8px;padding-left:8px;border-left:4px solid #c8102e;break-after:avoid}
      section{break-inside:avoid}
      .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.kpi{border:1px solid #ddd;border-radius:8px;padding:8px 10px}.kpi b{display:block;font-size:16px}.kpi span{color:#555;font-size:11px}
      table{width:100%;border-collapse:collapse;margin-top:4px}th,td{border:1px solid #d8d8d8;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f3f3f3;font-weight:600}
      td:nth-child(n+2){font-variant-numeric:tabular-nums}.sum td{font-weight:700;background:#fafafa}.neg{color:#c8102e}
      .legend{color:#555;font-size:10px}.legend i{display:inline-block;width:10px;height:10px;margin:0 4px 0 10px;vertical-align:-1px}
      .sign{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:36px}.sign div{border-top:1px solid #333;padding-top:4px;color:#444}
      footer{margin-top:18px;color:#777;font-size:10px}
    </style></head><body>
    <header><div><div class="brand">UMBRELLA CORPORATION · УУРХАЙ</div><h1>Сарын гүйцэтгэлийн тайлан</h1><p>${esc(monthLabel(s.month))} · ${s.elapsed}/${s.days} хоног</p></div><p>Үүсгэсэн: ${esc(k.fmtMoment(report.generatedAt))}</p></header>
    ${section("1. Гол үзүүлэлт", `<div class="kpis">
      ${kpi(`${k.num(s.production.tonnes)} т`, `Олборлолт · төлөвлөгөөний ${ratio == null ? "–" : `${Math.round(ratio * 100)}%`}`)}
      ${kpi(`${k.num(s.coal.shipped)} т`, `Нүүрс ачилт · ${s.coal.trucks} машин`)}
      ${kpi(money(m.income), "Нийт орлого")}
      ${kpi(money(m.profit), `Цэвэр ашиг${m.margin == null ? "" : ` · ${Math.round(m.margin * 100)}%`}`)}
      ${kpi(k.pct(s.fleet.availability), `Техникийн бэлэн байдал · ${s.fleet.ready}/${s.fleet.total}`)}
      ${kpi(String(s.hse.daysSinceLti ?? "–"), "LTI-гүй хоног")}
      ${kpi(String(s.env.over), "Байгаль орчны хэтрэлт")}
      ${kpi(`${k.num(s.coal.stockpile)} т`, "Нүүрсний нөөц")}
    </div>`)}
    ${section("2. Олборлолт ба ачилт (өдрөөр, тонн)", `${svgBars(days.map((item) => item.tonnes), { labels: days.map((item, index) => (index % 3 === 0 ? Number(item.date.slice(8)) : "")) })}
      ${svgBars(days.map((item) => item.shipped), { color: "#495057", height: 80, labels: days.map((item, index) => (index % 3 === 0 ? Number(item.date.slice(8)) : "")) })}
      <p class="legend"><i style="background:#c8102e"></i>Олборлолт <i style="background:#495057"></i>Нүүрс ачилт</p>`)}
    ${section("3. Нүүрсний борлуулалт ба чанар", `<table><thead><tr><th>Худалдан авагч</th><th>Гэрээ</th><th>Гэрээт</th><th>Ачсан (нийт)</th><th>Биелэлт</th><th>Дүн (нийт)</th><th>Төлөв</th></tr></thead><tbody>${contracts || `<tr><td colspan="7">Гэрээ алга</td></tr>`}</tbody></table>
      <p>Энэ сарын ${s.coal.samples} дээж: дундаж илчлэг <b>${s.coal.cv ?? "–"} ккал/кг</b>, үнс <b>${s.coal.ash ?? "–"}%</b>, чийг <b>${s.coal.moisture ?? "–"}%</b> · ${Object.entries(COAL_GRADES).map(([key, label]) => `${label} ${s.coal.grades[key] || 0}`).join(", ")}</p>`)}
    ${section("4. Санхүү", `<table><thead><tr><th>Үзүүлэлт</th><th>Гүйцэтгэл</th><th>Төсөв</th><th>Хувь</th></tr></thead><tbody>
      <tr>${cell("Нүүрсний борлуулалтын орлого")}${cell(money(m.revenue, { short: false }))}<td>–</td><td>–</td></tr>
      ${m.assetGain ? `<tr>${cell("Хөрөнгө актласны ашиг / алдагдал")}${cell(money(m.assetGain, { short: false }))}<td>–</td><td>–</td></tr>` : ""}
      ${costs}
      <tr>${cell(m.share < 1 ? `Элэгдэл (сарын ${Math.round(m.share * 100)}%)` : "Элэгдэл")}${cell(money(m.depreciation, { short: false }))}<td>–</td><td>–</td></tr>
      <tr class="sum">${cell("Нийт зардал (элэгдэлгүй)")}${cell(money(m.costTotal, { short: false }))}${cell(m.budgetTotal ? money(m.budgetTotal, { short: false }) : "–")}${cell(m.budgetTotal ? `${Math.round((m.costTotal / m.budgetTotal) * 100)}%` : "–")}</tr>
      <tr class="sum">${cell("Цэвэр ашиг")}<td class="${m.profit < 0 ? "neg" : ""}">${esc(money(m.profit, { short: false }))}</td><td>–</td>${cell(m.margin == null ? "–" : `Ашгийн хувь ${Math.round(m.margin * 100)}%`)}</tr>
    </tbody></table>
    <p>Түлш ${k.num(m.liters)} л × ${k.num(report.fuelPrice)} ₮. Үндсэн хөрөнгө ${report.assets.count}: анхны өртөг ${esc(money(report.assets.cost))}, үлдэгдэл өртөг ${esc(money(report.assets.book))}.</p>
    ${svgTrend(report.trend)}<p class="legend"><i style="background:#2b8a3e"></i>Орлого <i style="background:#c8102e"></i>Зардал, элэгдэл · сүүлийн 6 сар</p>`)}
    ${section("5. Худалдан авалт, актлалтын шийдвэр", `<table><thead><tr><th>Төрөл</th><th>Агуулга</th><th>Дүн</th><th>Шийдвэр</th><th>Огноо</th></tr></thead><tbody>${decided || `<tr><td colspan="5">Энэ сард шийдвэрлэсэн хүсэлт алга</td></tr>`}</tbody></table>
      <p>Тайлан гаргах үед хүлээгдэж буй: санхүүд ${s.approvals.finance}, захиралд ${s.approvals.director} · нийт ${esc(money(s.approvals.pendingValue))}</p>`)}
    ${section("6. ХАБЭА ба хүн хүч", `<p>Осол <b>${s.hse.incidents}</b> (LTI ${s.hse.lti}), ослын дөхөлт, аюулын мэдээлэл <b>${s.hse.nearmiss}</b>, хамгаалалтын зөрчил <b>${s.hse.violations}</b>, нээлттэй хэрэг <b>${s.hse.open}</b>. Ээлжийн ажилтан ${s.people.staff}, тайлан гаргах үед талбай дээр ${s.people.onSite}.</p>`)}
    ${section("7. Байгаль орчин", `<p>Хэмжилт ${s.env.readings}, хэтрэлт <b>${s.env.over}</b>, хязгаарт ойртсон ${s.env.near}. Нөхөн сэргээлт ${k.num(s.env.rehabDone)} / ${k.num(s.env.rehabPlanned)} га, нээлттэй хяналт шалгалт ${s.env.openAudits}.</p>
      ${breaches ? `<table><thead><tr><th>Хэзээ</th><th>Цэг</th><th>Үзүүлэлт</th><th>Утга</th><th>Хязгаар</th></tr></thead><tbody>${breaches}</tbody></table>` : ""}`)}
    <div class="sign"><div>Санхүүгийн менежер</div><div>Гүйцэтгэх захирал</div></div>
    <footer>UMBRELLA уурхайн удирдлагын систем · автоматаар бэлтгэсэн тайлан</footer>
    </body></html>`;
}

/** Book value columns for the asset register. */
export function assetCols() {
  return [
    ["Элэгдэл / сар", (item) => money(depreciation(item, k.m.data.month).monthly)],
    ["Хуримтлагдсан", (item) => money(depreciation(item, k.m.data.month).accumulated)],
    [
      "Үлдэгдэл өртөг",
      (item) => {
        if (item.status === "disposed") return k.badge(`Актлагдсан ${k.fmtDate(item.disposedOn)}`);
        const value = depreciation(item, k.m.data.month);
        const left = share(value.book, item.cost);
        return `<span class="m-who"><b>${k.esc(money(value.book))}</b><small>${Math.round((left || 0) * 100)}% · ${value.months}/${value.life} сар</small></span>`;
      },
    ],
  ];
}

export { envState, netOf, requestValue, saleProgress, ENV_TONE };
