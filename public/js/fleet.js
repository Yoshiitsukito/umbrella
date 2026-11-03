// Fleet control centre for the chief mining engineer: live map, selected unit, production and equipment state.
import { EQUIP_TYPES, PRIORITIES, WO_KINDS, localInput } from "./minecore.js";
import { FACES, MATERIALS, PHASES, SITE, ROADS, ZONES, fleetState, fuelLevel, haulTotals, hourlyHaul, opClock, shiftDayStart, zoneBox } from "./fleetcore.js";

export const FLEET_VIEWS = ["fleet"];

const DAY_MS = 24 * 3600 * 1000;
const TILT_Y = 1.55;
const MIN_W = 520;

const ICON = {
  truck: '<path d="M2.5 16.5V7h11v9.5M13.5 10.5h4l3 3.5v2.5h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  excavator: '<path d="M3 19h10v-4H3z"/><path d="M5 15v-3.5h5l1.5 3.5"/><path d="M11 11.5l5-6.5 4 4-2 3"/><path d="M18 12l1.5 3h-3"/>',
  loader: '<path d="M3 17h9v-5H6l-3 2.5z"/><path d="M12 13l5-2 3 4h-4"/><circle cx="6" cy="18.2" r="1.6"/><circle cx="11" cy="18.2" r="1.6"/>',
  dozer: '<path d="M5 15v-5h7l2 5"/><rect x="4" y="15" width="11" height="4" rx="2"/><path d="M18 9v10M18 14h-3"/>',
  drill: '<path d="M8 21V8l4-5 4 5v13"/><path d="M12 3v18M6 21h12"/>',
  crane: '<path d="M6 21V4l14 3M6 8l13-1M17 7v6"/><path d="M3 21h6"/><rect x="15.5" y="13" width="3" height="3"/>',
  grader: '<path d="M3 15h18M6 15v-5h5v5M13 15l2-5h3"/><circle cx="5" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
  lv: '<path d="M3 15.5l2-5.5h11l3 5.5v3H3z"/><circle cx="7" cy="18.5" r="1.6"/><circle cx="16" cy="18.5" r="1.6"/>',
  bus: '<rect x="4" y="4" width="16" height="13" rx="2"/><path d="M4 11h16"/><circle cx="8" cy="19" r="1.4"/><circle cx="16" cy="19" r="1.4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  gauge: '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>',
  pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
  fuel: '<path d="M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M4 21h12M7 8h6"/><path d="M15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3"/>',
  wrench: '<path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8" r="1.5"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
  spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/><path d="M19 3v4M17 5h4"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 5a3 3 0 0 1 0 6M18 20a6 6 0 0 0-2-4.5"/>',
  alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4.5M12 17.5v.1"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  mine: '<path d="M2.5 20.5h19M4 20.5l5-9 3 4 3-6 5 11"/>',
  pile: '<path d="M3 19l4-7 3 3 3-6 3 4 5 6z"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  layers: '<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
  dept: '<rect x="3" y="9" width="7" height="12" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/><path d="M6 13h1M6 17h1M17 7h1M17 11h1M17 15h1"/>',
};

const TYPE_FILTERS = [
  ["all", "Бүгд", "grid"],
  ["truck", "Самосвал", "truck"],
  ["dig", "Экскаватор, ачигч", "excavator"],
  ["support", "Туслах техник", "dozer"],
];
const RANGES = { "24h": "24Ц", "7d": "7Х", "30d": "30Х" };
const SHIFT_BARS = [
  ["day", "Өдөр"],
  ["night", "Шөнө"],
  ["off", "Амралт"],
];

let ctx = null;
const f = {
  data: null,
  version: 0,
  timer: 0,
  raf: 0,
  loading: false,
  live: null,
  totals: null,
  sel: null,
  zone: "all",
  type: "all",
  material: null,
  range: "24h",
  box: [...SITE.view],
  nodes: new Map(),
  parts: new Map(),
  pressing: false,
  chart: { key: "", html: "" },
  lastFrame: 0,
  lastTick: 0,
  drag: null,
  ...readStored("fleet-ui", { tilt: true, layers: { tags: true, roads: true, labels: true } }),
};

function readStored(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key)) };
  } catch {
    return fallback;
  }
}

const saveUi = () => localStorage.setItem("fleet-ui", JSON.stringify({ tilt: f.tilt, layers: f.layers }));
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const ico = (name, cls = "fl-ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] || ICON.grid}</svg>`;
const num = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value)).toLocaleString("en-US") : "–");
const pct = (value) => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
const recordOf = (id) => f.data?.equipment.find((item) => item.id === id) || null;
const unitOf = (id) => f.live?.machines.find((item) => item.id === id) || null;
const materialOf = (digger) => FACES[digger.face].material;
const groupOf = (type) => (type === "truck" ? "truck" : type === "excavator" || type === "loader" ? "dig" : "support");
const clock = (ms) => localInput(ms).slice(11, 16);
const mounted = () => FLEET_VIEWS.includes(ctx?.state.view) && ctx.stage.querySelector(".fl-grid");

function etaText(seconds) {
  const total = Math.max(0, Math.round(seconds));
  return total < 3600 ? `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}` : `${Math.floor(total / 3600)} ц ${Math.floor((total % 3600) / 60)} мин`;
}

function stateOf(unit) {
  if (unit.status === "down") return ["Эвдэрсэн", "bad"];
  if (unit.status === "service") return ["Засварт", "warn"];
  if (unit.paused) return ["Завсарлага", "idle"];
  if (unit.phase === "parked") return ["Зогсоолд", "idle"];
  if (unit.phase === "stopped") return ["Зогссон", "idle"];
  if (unit.moving) return [unit.payload > 0 ? "Ачаатай" : "Явж байна", unit.payload > 0 ? "load" : "ok"];
  return ["Ажиллаж байна", "info"];
}

/** Hands the module the app's helpers: { stage, state, api, render, openModal, closeModal, toast }. */
export function initFleet(context) {
  ctx = context;
  ctx.stage.addEventListener("click", onClick);
  ctx.stage.addEventListener("change", onChange);
  ctx.stage.addEventListener("pointerdown", onPointerDown);
  ctx.stage.addEventListener("wheel", onWheel, { passive: false });
}

/* ---------- data and timers ---------- */

export async function fleetStart() {
  if (!f.timer) f.timer = setInterval(() => refresh(), 15000);
  if (!f.raf) f.raf = requestAnimationFrame(frame);
  if (!f.data) await refresh();
  else mount();
}

export function fleetStop() {
  clearInterval(f.timer);
  cancelAnimationFrame(f.raf);
  f.timer = 0;
  f.raf = 0;
}

export function fleetReset() {
  fleetStop();
  Object.assign(f, { data: null, live: null, totals: null, sel: null, zone: "all", type: "all", material: null, box: [...SITE.view] });
  f.nodes.clear();
}

async function refresh() {
  if (f.loading || !ctx.state.me) return;
  f.loading = true;
  try {
    setData(await ctx.api("/api/fleet"));
  } catch (error) {
    if (!f.data && FLEET_VIEWS.includes(ctx.state.view)) ctx.stage.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  } finally {
    f.loading = false;
  }
}

function setData(data) {
  const ids = (list) => (list || []).map((item) => `${item.id}:${item.code}:${item.type}`).join("|");
  const rebuild = ids(f.data?.equipment) !== ids(data.equipment);
  f.data = data;
  f.version += 1;
  if (!FLEET_VIEWS.includes(ctx.state.view)) return;
  if (!mounted()) {
    mount();
    return;
  }
  if (rebuild) buildUnits();
  compute(Date.now());
  paintParts(true);
}

async function send(path, body) {
  const data = await ctx.api(path, { method: "POST", body: JSON.stringify(body) });
  if (data.view) setData(data.view);
  return data;
}

function mount() {
  if (!FLEET_VIEWS.includes(ctx.state.view)) return;
  ctx.stage.classList.add("is-quiet");
  ctx.stage.innerHTML = fleetView();
  f.parts.clear();
  if (!f.data) return;
  buildUnits();
  compute(Date.now());
  paintParts(true);
  drawUnits();
}

function compute(now) {
  if (!f.data) return;
  const dispatch = f.data.dispatch;
  f.live = fleetState(f.data.equipment, now, { dispatch });
  f.totals = haulTotals(f.data.equipment, shiftDayStart(now), now, { dispatch });
}

function frame(time) {
  f.raf = requestAnimationFrame(frame);
  if (!f.data || time - f.lastFrame < 60 || !mounted()) return;
  f.lastFrame = time;
  const now = Date.now();
  f.live = fleetState(f.data.equipment, now, { dispatch: f.data.dispatch });
  drawUnits();
  if (now - f.lastTick >= 1000) {
    f.lastTick = now;
    f.totals = haulTotals(f.data.equipment, shiftDayStart(now), now, { dispatch: f.data.dispatch });
    paintParts(false);
  }
}

/* ---------- page frame ---------- */

export function fleetView() {
  if (!f.data) return `<div class="fl-page"><section class="fl-card"><p class="fl-muted">Ачаалж байна…</p></section></div>`;
  return `<div class="fl-page">
    <header class="fl-head">
      <div class="fl-brand">
        <span class="fl-logo">${ico("mine")}</span>
        <div><b>CONTROL CENTER</b><small>${esc(SITE.name)}</small></div>
      </div>
      <label class="fl-select">${ico("pin", "fl-ico tiny")}<select data-fl-zone-select aria-label="Бүс">${zoneOptions()}</select></label>
      <div class="fl-clock" data-fl-part="clock"></div>
    </header>
    <div class="fl-kpis" data-fl-part="kpis"></div>
    <div class="fl-grid">
      <aside class="fl-col fl-left">
        <section class="fl-card"><h3>${ico("pin")}Ажлын бүс</h3><div data-fl-part="zones"></div></section>
        <section class="fl-card"><h3>${ico("people")}Ээлжийн ажилтан</h3><div data-fl-part="shifts"></div></section>
        <section class="fl-card"><h3>${ico("dept")}Хэлтсээр</h3><div data-fl-part="depts"></div></section>
      </aside>
      <section class="fl-col fl-center">
        <div class="fl-card fl-map-card">
          <div class="fl-map-bar">
            <h3>${ico("route")}Уурхайн газрын зураг <span class="fl-live">LIVE</span></h3>
            <div class="fl-tools">
              <span class="fl-pause" data-fl-part="pause" hidden></span>
              <button type="button" class="fl-tool${f.tilt ? " is-on" : ""}" data-fl-tilt title="2D / 3D">${ico("cube")}<span>${f.tilt ? "3D" : "2D"}</span></button>
              <button type="button" class="fl-tool${f.layers.tags ? " is-on" : ""}" data-fl-layer="tags" title="Шошго">${ico("tag")}</button>
              <button type="button" class="fl-tool${f.layers.roads ? " is-on" : ""}" data-fl-layer="roads" title="Зам">${ico("route")}</button>
              <button type="button" class="fl-tool${f.layers.labels ? " is-on" : ""}" data-fl-layer="labels" title="Нэр">${ico("layers")}</button>
              <span class="fl-tool-gap"></span>
              <button type="button" class="fl-tool" data-fl-zoom="in" title="Томруулах">${ico("plus")}</button>
              <button type="button" class="fl-tool" data-fl-zoom="out" title="Жижигрүүлэх">${ico("minus")}</button>
              <button type="button" class="fl-tool" data-fl-zoom="reset" title="Бүтэн харах">${ico("target")}</button>
            </div>
          </div>
          <div class="fl-map-stage${f.tilt ? " is-3d" : ""}${mapLayerClasses()}" data-fl-map>
            <div class="fl-map-tilt">
              <svg class="fl-map" viewBox="${f.box.join(" ")}" data-fl-svg aria-hidden="true">${mapStatic()}</svg>
              <svg class="fl-map fl-units" viewBox="${f.box.join(" ")}" data-fl-svg><g id="fl-units"></g></svg>
            </div>
            <div class="fl-legend">
              <span><i class="is-load"></i>Ачаатай</span><span><i class="is-ok"></i>Хоосон</span><span><i class="is-info"></i>Ачилт, ажил</span><span><i class="is-idle"></i>Зогссон</span><span><i class="is-bad"></i>Эвдэрсэн, хурд хэтэрсэн</span>
            </div>
            <div class="fl-sel" data-fl-part="sel" hidden></div>
          </div>
        </div>
        <section class="fl-card fl-prod">
          <div class="fl-prod-head">
            <h3>${ico("chart")}Бодит цагийн олборлолт</h3>
            <div class="fl-seg">${Object.entries(RANGES).map(([key, label]) => `<button type="button" data-fl-range="${key}" class="${f.range === key ? "is-on" : ""}">${label}</button>`).join("")}</div>
          </div>
          <div data-fl-part="chart"></div>
        </section>
      </section>
      <aside class="fl-col fl-right">
        <section class="fl-card fl-ai" data-fl-part="ai"></section>
        <section class="fl-card"><h3>${ico("pile")}Материал</h3><div data-fl-part="materials"></div></section>
        <section class="fl-card fl-equip">
          <h3>${ico("truck")}Техникийн төлөв</h3>
          <div class="fl-types">${TYPE_FILTERS.map(([key, label, icon]) => `<button type="button" data-fl-type="${key}" class="${f.type === key ? "is-on" : ""}" title="${label}">${ico(icon)}</button>`).join("")}</div>
          <div class="fl-list" data-fl-part="list"></div>
        </section>
      </aside>
    </div>
  </div>`;
}

function zoneOptions() {
  return [["all", "Бүх талбай"], ...Object.entries(ZONES).filter(([key]) => key !== "road")].map(([key, label]) => `<option value="${key}"${f.zone === key ? " selected" : ""}>${esc(label)}</option>`).join("");
}

const mapLayerClasses = () => Object.entries(f.layers).map(([key, on]) => (on ? "" : ` no-${key}`)).join("");

/* ---------- the map ---------- */

const pts = (list) => list.map(([x, y]) => `${x},${y}`).join(" ");

function mapStatic() {
  const [x0, y0, w, h] = SITE.view;
  const pits = SITE.pits
    .map((pit) => {
      const rings = Array.from({ length: pit.benches + 1 }, (_, index) => {
        const r = 1.06 - ((1.06 - pit.floor) * index) / pit.benches;
        return `<ellipse class="fl-bench" cx="${pit.cx}" cy="${pit.cy + index * 9}" rx="${Math.round(pit.rx * r)}" ry="${Math.round(pit.ry * r)}" style="--d:${index / pit.benches}" />`;
      }).join("");
      const floor = `<ellipse class="fl-seam" cx="${pit.cx}" cy="${pit.cy + pit.benches * 9}" rx="${Math.round(pit.rx * pit.floor * 0.82)}" ry="${Math.round(pit.ry * pit.floor * 0.82)}" />`;
      return `<g class="fl-pit">${rings}${floor}</g><text class="fl-zone-label" x="${pit.cx}" y="${pit.cy - pit.ry - 40}">${esc(pit.name)}</text>`;
    })
    .join("");
  const dump = SITE.dump;
  const lifts = [1, 0.8, 0.6, 0.42].map((r, index) => `<ellipse class="fl-lift" cx="${dump.cx}" cy="${dump.cy - index * 22}" rx="${Math.round(dump.rx * r)}" ry="${Math.round(dump.ry * r)}" style="--d:${index / 3}" />`).join("");
  const roads = ROADS.map((road) => `<polyline class="fl-road-base${road.ramp ? " is-ramp" : ""}" points="${pts(road.pts)}" />`).join("") + ROADS.map((road) => `<polyline class="fl-road${road.ramp ? " is-ramp" : ""}" points="${pts(road.pts)}" />`).join("");
  const { plant, rom, workshop, parking, fuel, camp } = SITE.places;
  const label = (place, dy = 90) => `<text class="fl-place-label" x="${place.x}" y="${place.y + dy}">${esc(place.name)}</text>`;
  const places = `
    <g class="fl-place"><rect x="${plant.x - 120}" y="${plant.y - 70}" width="150" height="95" rx="6" /><rect x="${plant.x + 45}" y="${plant.y - 50}" width="70" height="70" rx="6" /><path d="M${plant.x + 30} ${plant.y - 30}l60 -60h50" class="fl-conveyor" /></g>${label(plant, 70)}
    <ellipse class="fl-rom" cx="${rom.x}" cy="${rom.y + 25}" rx="120" ry="52" /><ellipse class="fl-rom-top" cx="${rom.x - 15}" cy="${rom.y + 15}" rx="55" ry="20" />${label(rom, 115)}
    <g class="fl-place"><rect x="-1478" y="62" width="236" height="118" rx="6" /><path d="M-1420 62v118M-1362 62v118M-1304 62v118" class="fl-bay" /></g>${label(workshop, -150)}
    <rect class="fl-parking" x="-1432" y="352" width="250" height="100" rx="8" />${label(parking, 150)}
    <g class="fl-place"><circle cx="${fuel.x}" cy="${fuel.y}" r="26" /><rect x="${fuel.x + 32}" y="${fuel.y - 14}" width="34" height="28" rx="4" /></g>${label(fuel, 70)}
    <g class="fl-place">${[0, 1, 2].map((row) => [0, 1, 2].map((col) => `<rect x="${camp.x + 20 + col * 70}" y="${camp.y - 120 + row * 46}" width="56" height="30" rx="4" />`).join("")).join("")}</g>${label({ ...camp, x: camp.x + 110 }, -140)}`;
  return `<defs>
      <radialGradient id="fl-ground" cx="50%" cy="40%" r="80%"><stop offset="0" stop-color="#16231c" /><stop offset="1" stop-color="#070c09" /></radialGradient>
      <filter id="fl-noise" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.0045" numOctaves="4" seed="11" /><feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.36  0 0 0 0 0.3  0 0 0 0.9 -0.32" /></filter>
      <filter id="fl-glow" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <pattern id="fl-gridline" width="250" height="250" patternUnits="userSpaceOnUse"><path d="M250 0H0V250" fill="none" stroke="#39ff88" stroke-opacity="0.06" stroke-width="2" /></pattern>
    </defs>
    <rect x="${x0 - 400}" y="${y0 - 400}" width="${w + 800}" height="${h + 800}" fill="url(#fl-ground)" />
    <rect x="${x0 - 400}" y="${y0 - 400}" width="${w + 800}" height="${h + 800}" filter="url(#fl-noise)" opacity="0.8" />
    <rect x="${x0 - 400}" y="${y0 - 400}" width="${w + 800}" height="${h + 800}" fill="url(#fl-gridline)" />
    <g class="fl-dump">${lifts}</g><text class="fl-zone-label" x="${dump.cx}" y="${dump.cy - dump.ry - 70}">Хөрсний овоолго</text>
    ${pits}
    <g class="fl-roads">${roads}</g>
    <g class="fl-places">${places}</g>
    <g class="fl-compass" transform="translate(${x0 + w - 110} ${y0 + 120})"><circle r="52" /><path d="M0 -40l14 40h-28z" /><text y="-58">N</text></g>
    <g class="fl-scale" transform="translate(${x0 + w - 640} ${y0 + h - 70})"><path d="M0 0h500M0 -14v28M250 -9v18M500 -14v28" /><text x="250" y="-24">500 м</text></g>`;
}

function unitShape(type) {
  if (type === "truck") return '<path class="fl-u-body fl-u-dir" d="M30 0L-18 -17L-9 0L-18 17Z" />';
  if (type === "excavator" || type === "loader") return '<path class="fl-u-body" d="M0 -26L22 -13V13L0 26L-22 13V-13Z" /><path class="fl-u-arm fl-u-dir" d="M8 0H40" />';
  if (type === "drill" || type === "crane") return '<path class="fl-u-body" d="M0 -20L20 0L0 20L-20 0Z" />';
  return '<circle class="fl-u-body" r="14" /><path class="fl-u-arm fl-u-dir" d="M16 -8L28 0L16 8" />';
}

function buildUnits() {
  const layer = ctx.stage.querySelector("#fl-units");
  if (!layer || !f.data) return;
  layer.innerHTML = f.data.equipment
    .map(
      (item) => `<g class="fl-unit" data-fl-unit="${esc(item.id)}"><g class="fl-u-in">
        <circle class="fl-u-halo" r="34" /><circle class="fl-u-ring" r="46" />${unitShape(item.type)}
        <g class="fl-tag"><rect class="fl-tag-bg" x="-8" y="-86" height="40" rx="7" /><text class="fl-tag-text" x="6" y="-58"></text></g>
      </g></g>`,
    )
    .join("");
  f.nodes.clear();
  for (const node of layer.querySelectorAll(".fl-unit")) {
    f.nodes.set(node.dataset.flUnit, { g: node, inner: node.firstElementChild, dirs: [...node.querySelectorAll(".fl-u-dir")], tag: node.querySelector(".fl-tag"), rect: node.querySelector(".fl-tag-bg"), text: node.querySelector(".fl-tag-text"), cls: "", label: "", stack: -1 });
  }
}

function matches(unit) {
  if (f.type !== "all" && groupOf(unit.type) !== f.type) return false;
  if (f.material && unit.material !== f.material) return false;
  return true;
}

function drawUnits() {
  if (!f.live) return;
  const k = Math.min(1, Math.max(0.2, f.box[2] / SITE.view[2]));
  const sy = f.tilt ? TILT_Y : 1;
  const stacks = new Map();
  for (const unit of f.live.machines) {
    const node = f.nodes.get(unit.id);
    if (!node) continue;
    const key = `${Math.round(unit.x / 45)}:${Math.round(unit.y / 45)}`;
    const stack = stacks.get(key) || 0;
    stacks.set(key, stack + 1);
    node.g.setAttribute("transform", `translate(${(unit.x + stack * 30 * k).toFixed(1)} ${unit.y.toFixed(1)})`);
    node.inner.setAttribute("transform", `scale(${k.toFixed(3)} ${(k * sy).toFixed(3)})`);
    for (const dir of node.dirs) dir.setAttribute("transform", `rotate(${Math.round(unit.heading)})`);
    if (stack !== node.stack) {
      node.stack = stack;
      node.tag.setAttribute("transform", `translate(0 ${-stack * 46})`);
    }
    const [, tone] = stateOf(unit);
    const cls = `fl-unit is-${tone}${unit.overspeed ? " is-fast" : ""}${unit.id === f.sel ? " is-sel" : ""}${matches(unit) ? "" : " is-dim"}`;
    if (cls !== node.cls) {
      node.cls = cls;
      node.g.setAttribute("class", cls);
    }
    const label = unit.moving ? `${unit.code} · ${Math.round(unit.kmh)}` : unit.code;
    if (label !== node.label) {
      node.label = label;
      node.text.textContent = label;
      node.rect.setAttribute("width", String(label.length * 17 + 18));
    }
  }
}

function setBox(box) {
  const [, , baseW, baseH] = SITE.view;
  const w = Math.min(baseW * 1.2, Math.max(MIN_W, box[2]));
  const h = (w * baseH) / baseW;
  const cx = Math.min(SITE.view[0] + baseW, Math.max(SITE.view[0], box[0] + box[2] / 2));
  const cy = Math.min(SITE.view[1] + baseH, Math.max(SITE.view[1], box[1] + box[3] / 2));
  f.box = [Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h)];
  for (const svg of ctx.stage.querySelectorAll("[data-fl-svg]")) svg.setAttribute("viewBox", f.box.join(" "));
  drawUnits();
}

function zoomBy(factor) {
  const [x, y, w, h] = f.box;
  setBox([x + (w - w * factor) / 2, y + (h - h * factor) / 2, w * factor, h * factor]);
}

function frameZone(zone) {
  const box = zone === "all" ? [...SITE.view] : zoneBox(zone);
  const ratio = SITE.view[2] / SITE.view[3];
  const w = Math.max(box[2], box[3] * ratio);
  setBox([box[0] + box[2] / 2 - w / 2, box[1] + box[3] / 2 - w / ratio / 2, w, w / ratio]);
}

function onPointerDown(event) {
  if (!FLEET_VIEWS.includes(ctx.state.view)) return;
  f.pressing = true;
  window.addEventListener("pointerup", () => setTimeout(() => (f.pressing = false), 0), { once: true });
  const stage = event.target.closest("[data-fl-map]");
  if (!stage || event.button !== 0 || event.target.closest(".fl-sel, .fl-legend")) return;
  const rect = stage.getBoundingClientRect();
  f.drag = { x: event.clientX, y: event.clientY, box: [...f.box], scale: f.box[2] / rect.width, moved: false, id: event.pointerId, stage };
  const move = (next) => {
    const drag = f.drag;
    if (!drag || next.pointerId !== drag.id) return;
    const dx = next.clientX - drag.x;
    const dy = next.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      stage.setPointerCapture(drag.id);
      stage.classList.add("is-dragging");
    }
    const sy = f.tilt ? TILT_Y : 1;
    setBox([drag.box[0] - dx * drag.scale, drag.box[1] - dy * drag.scale * sy, drag.box[2], drag.box[3]]);
  };
  const up = () => {
    stage.classList.remove("is-dragging");
    stage.removeEventListener("pointermove", move);
    stage.removeEventListener("pointerup", up);
    stage.removeEventListener("pointercancel", up);
    setTimeout(() => (f.drag = null), 0);
  };
  stage.addEventListener("pointermove", move);
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
}

function onWheel(event) {
  if (!event.target.closest("[data-fl-map]") || event.target.closest(".fl-sel")) return;
  event.preventDefault();
  zoomBy(event.deltaY > 0 ? 1.15 : 1 / 1.15);
}

/* ---------- live parts ---------- */

/** Coal so far against the plan, measured in working time so breaks don't count against the pace. */
function paceOf(now) {
  const plan = f.data.planTonnes || 12000;
  const start = shiftDayStart(now);
  const share = (opClock(now) - opClock(start)) / (opClock(start + DAY_MS) - opClock(start));
  const pace = share > 0.01 ? f.totals.coal / (plan * share) - 1 : 0;
  return { plan, share, pace, forecast: share > 0.01 ? f.totals.coal / share : plan };
}

function setPart(name, html) {
  const node = ctx.stage.querySelector(`[data-fl-part="${name}"]`);
  if (!node || f.parts.get(name) === html) return;
  node.innerHTML = html;
  f.parts.set(name, html);
}

function paintParts(full) {
  if (!mounted() || !f.live) return;
  const now = Date.now();
  setPart("clock", `${ico("clock", "fl-ico tiny")}<b>${localInput(now).slice(11, 16)}</b><span>${f.data.shift === "day" ? "Өдрийн ээлж" : "Шөнийн ээлж"}</span>`);
  if (f.pressing && !full) return;
  const set = setPart;
  set("kpis", kpis(now));
  set("zones", zones());
  set("materials", materials());
  set("list", equipList());
  set("ai", insight(now));
  const pause = ctx.stage.querySelector('[data-fl-part="pause"]');
  if (pause) {
    pause.hidden = !f.live.pause;
    if (f.live.pause) pause.innerHTML = `${ico("clock", "fl-ico tiny")}${esc(f.live.pause.label)} · ${clock(f.live.pause.until)} хүртэл`;
  }
  if (full) {
    set("shifts", shifts());
    set("depts", depts());
  }
  set("chart", chart(now));
  paintSelected(full);
}

function kpis(now) {
  const totals = f.totals;
  const { plan, pace } = paceOf(now);
  const start = shiftDayStart(now);
  const machines = f.live.machines;
  const broken = machines.filter((item) => ["down", "service"].includes(item.status)).length;
  const moving = machines.filter((item) => item.moving).length;
  const hours = Math.max(0.5, (now - start) / 3600000);
  const people = f.data.personnel;
  const card = (icon, label, value, sub, tone = "", bar = null) =>
    `<div class="fl-kpi${tone ? ` is-${tone}` : ""}"><span class="fl-kpi-ico">${ico(icon)}</span><div><small>${label}</small><b>${value}</b><em>${sub}</em>${bar == null ? "" : `<span class="fl-bar"><i style="width:${pct(bar)}"></i></span>`}</div></div>`;
  return [
    card("pile", "Нүүрс · өнөөдөр", `${num(totals.coal)} т`, `${pace >= 0 ? "+" : ""}${Math.round(pace * 100)}% төлөвлөгөө ${num(plan)} т`, pace >= 0 ? "ok" : "warn", totals.coal / plan),
    card("mine", "Хөрс хуулалт", `${num(totals.waste)} т`, `Харьцаа ${totals.coal ? (totals.waste / totals.coal).toFixed(1) : "–"} : 1`),
    card("route", "Хийгдсэн рейс", num(totals.loads), `Цагт ~${num(totals.loads / hours)}`),
    card("truck", "Ажиллаж буй техник", `${machines.length - broken}/${machines.length}`, `${moving} явж байна · ${broken} засварт`, broken ? "warn" : ""),
    card("people", "Талбай дээрх ажилтан", num(people.onSite), `Нийт ${num(people.total)}`),
    card("alert", "Өнөөдрийн осол", num(f.data.incidents.today), `Нээлттэй ${num(f.data.incidents.open)}`, f.data.incidents.today ? "bad" : "ok"),
  ].join("");
}

function zones() {
  const counts = {};
  for (const unit of f.live.machines) counts[unit.zone] = (counts[unit.zone] || 0) + 1;
  const rows = [["all", "Бүх талбай", f.live.machines.length], ...Object.entries(ZONES).map(([key, label]) => [key, label, counts[key] || 0])];
  return `<div class="fl-zones">${rows
    .filter(([key]) => key !== "road" || counts.road)
    .map(([key, label, count]) => `<button type="button" data-fl-zone="${key}" class="${f.zone === key ? "is-on" : ""}"${key === "road" ? " disabled" : ""}><span>${esc(label)}</span><b>${count}</b></button>`)
    .join("")}</div>`;
}

function shifts() {
  const people = f.data.personnel;
  const max = Math.max(1, people.day, people.night, people.off);
  return `<div class="fl-bars">${SHIFT_BARS.map(([key, label]) => `<div class="fl-barrow"><span>${label}</span><span class="fl-bar is-${key}"><i style="width:${pct(people[key] / max)}"></i></span><b>${people[key]}</b></div>`).join("")}</div>
    <p class="fl-note">${ico("check", "fl-ico tiny")}Талбай дээр <b>${people.onSite}</b> / ${people.total}</p>`;
}

function depts() {
  const list = f.data.departments.filter((item) => item.total).slice(0, 6);
  if (!list.length) return `<p class="fl-muted">Хэлтэс бүртгэгдээгүй</p>`;
  const max = Math.max(1, ...list.map((item) => item.total));
  return `<div class="fl-bars">${list.map((item) => `<div class="fl-barrow" title="${esc(item.name)}"><span>${esc(item.name)}</span><span class="fl-bar is-dept"><i style="width:${pct(item.total / max)}"></i><i class="is-in" style="width:${pct(item.onSite / max)}"></i></span><b>${item.onSite}/${item.total}</b></div>`).join("")}</div>`;
}

function materials() {
  const trucks = (material) => f.live.machines.filter((item) => item.type === "truck" && item.material === material).length;
  return `<div class="fl-chips">${Object.entries(MATERIALS)
    .map(([key, label]) => `<button type="button" data-fl-material="${key}" class="fl-chip is-${key}${f.material === key ? " is-on" : ""}"><span>${label}</span><b>${num(f.totals[key])} т</b><small>${trucks(key)} самосвал</small></button>`)
    .join("")}</div>`;
}

function equipList() {
  const rows = f.live.machines.filter((unit) => matches(unit) && (f.zone === "all" || unit.zone === f.zone));
  if (!rows.length) return `<p class="fl-muted">Техник алга</p>`;
  return rows
    .map((unit) => {
      const [label, tone] = stateOf(unit);
      const truck = unit.type === "truck" && unit.cap;
      const share = truck ? unit.payload / unit.cap : fuelLevel(unit, Date.now());
      const value = truck ? `${num(unit.payload)} т` : pct(share);
      return `<button type="button" class="fl-row${unit.id === f.sel ? " is-sel" : ""}" data-fl-unit="${esc(unit.id)}">
        <span class="fl-row-ico is-${tone}">${ico(unit.type)}</span>
        <span class="fl-row-main"><b>${esc(unit.code)}</b><small>${esc(PHASES[unit.phase] || "")}</small></span>
        <span class="fl-row-stat"><em class="fl-badge is-${tone}">${label}</em><span class="fl-mini">${ico(truck ? "pile" : "fuel", "fl-ico tiny")}<span class="fl-bar${truck ? "" : share < 0.2 ? " is-low" : " is-fuel"}"><i style="width:${pct(share)}"></i></span><small>${value}</small></span></span>
      </button>`;
    })
    .join("");
}

/* ---------- smart assistant ---------- */

function suggestions(now) {
  const items = [];
  const machines = f.live.machines;
  for (const unit of machines.filter((item) => item.overspeed)) items.push(["bad", "gauge", `${unit.code} хурд хэтрүүлж байна: ${Math.round(unit.kmh)} км/ц (хязгаар ${unit.limit})`, unit.id]);
  for (const record of f.data.equipment.filter((item) => item.prestart?.critical)) items.push(["bad", "alert", `${record.code} prestart: ${record.prestart.fails.slice(0, 2).join(", ")}`, record.id]);
  for (const record of f.data.equipment.filter((item) => item.status === "down")) items.push(["warn", "wrench", `${record.code} эвдэрсэн${record.orders.length ? ` · ${record.orders[0].title}` : ""}`, record.id]);
  const diggers = f.live.plan.diggers.filter((item) => item.active);
  for (const digger of diggers) {
    const queued = machines.filter((item) => item.digger === digger.machine.id && item.phase === "queue");
    if (!digger.trucks.length) items.push(["warn", "excavator", `${digger.machine.code} самосвалгүй зогсож байна`, digger.machine.id]);
    else if (queued.length >= 2) {
      const spare = diggers.filter((item) => item !== digger && materialOf(item) === materialOf(digger) && item.trucks.length < digger.trucks.length - 1).sort((a, b) => a.trucks.length - b.trucks.length)[0];
      items.push(["info", "route", `${digger.machine.code} дээр ${queued.length} самосвал хүлээж байна${spare ? ` — ${queued[queued.length - 1].code}-г ${spare.machine.code} руу шилжүүлэх` : ""}`, queued[queued.length - 1].id]);
    }
  }
  for (const unit of machines) {
    if (["down", "service"].includes(unit.status)) continue;
    const fuel = fuelLevel(unit, now);
    if (fuel < 0.2) items.push(["warn", "fuel", `${unit.code} шатахуун ${pct(fuel)} — түгээх цэг рүү`, unit.id]);
  }
  for (const record of f.data.equipment) {
    if (["down", "service"].includes(record.status)) continue;
    if (record.service.due) items.push(["warn", "wrench", `${record.code} засварын хугацаа ${num(-record.service.left)} мото цагаар хэтэрсэн`, record.id]);
    else if (record.service.left <= 25) items.push(["info", "wrench", `${record.code} засвар ${num(record.service.left)} мото цагийн дараа`, record.id]);
  }
  return items;
}

function insight(now) {
  const { plan, share, pace, forecast } = paceOf(now);
  const stock = 42000 + f.totals.coal - (plan / 1.05) * share;
  const items = suggestions(now).slice(0, 5);
  const head = Math.abs(pace) < 0.02 ? "Олборлолт төлөвлөгөөний дагуу явж байна" : `Нүүрсний олборлолт төлөвлөгөөнөөс ${Math.abs(Math.round(pace * 100))}% ${pace > 0 ? "илүү" : "хоцорч"} байна`;
  return `<div class="fl-ai-top">
      <svg class="fl-rock" viewBox="0 0 120 90" aria-hidden="true"><defs><linearGradient id="fl-rock-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a4a40" /><stop offset="1" stop-color="#0c120f" /></linearGradient></defs><path d="M10 70L24 28L52 12L86 20L110 48L100 76L58 84Z" fill="url(#fl-rock-g)" stroke="#39ff88" stroke-opacity=".5" /><path d="M24 28L58 44L86 20M58 44L58 84M58 44L110 48" stroke="#39ff88" stroke-opacity=".25" fill="none" /></svg>
      <div><span class="fl-ai-tag">${ico("spark", "fl-ico tiny")}Ухаалаг зөвлөх</span><b class="${pace >= 0 ? "is-ok" : "is-warn"}">${head}</b></div>
    </div>
    <div class="fl-ai-stats">
      <div><small>Өдрийн таамаг</small><b>${num(forecast)} т</b></div>
      <div><small>Агуулахын нөөц</small><b>${num(stock)} т</b></div>
    </div>
    <ul class="fl-ai-list">${items.length ? items.map(([tone, icon, text, id]) => `<li><button type="button" class="is-${tone}" data-fl-unit="${esc(id)}">${ico(icon, "fl-ico tiny")}<span>${esc(text)}</span></button></li>`).join("") : `<li class="fl-muted">${ico("check", "fl-ico tiny")}Анхаарах зүйл алга</li>`}</ul>`;
}

/* ---------- production chart ---------- */

function chartRows(now) {
  const { equipment, dispatch } = f.data;
  if (f.range === "24h") return hourlyHaul(equipment, now, { dispatch }).map((row) => ({ ...row, label: clock(row.start).slice(0, 2), title: `${clock(row.start)}` }));
  const days = f.range === "7d" ? 7 : 30;
  const today = shiftDayStart(now);
  return Array.from({ length: days }, (_, index) => {
    const start = today - (days - 1 - index) * DAY_MS;
    const totals = haulTotals(equipment, start, Math.min(start + DAY_MS, now), { dispatch });
    const date = localInput(start).slice(5, 10).replace("-", ".");
    return { coal: totals.coal, waste: totals.waste, loads: totals.loads, label: date, title: date };
  });
}

function chart(now) {
  const key = `${f.range}:${f.version}:${Math.floor(now / (f.range === "24h" ? 60000 : 3600000))}`;
  if (f.chart.key === key) return f.chart.html;
  const rows = chartRows(now);
  const start = shiftDayStart(now);
  const opDay = (opClock(start + DAY_MS) - opClock(start)) / 3600;
  const plan = f.range === "24h" ? (f.data.planTonnes || 12000) / opDay : f.data.planTonnes || 12000;
  const max = Math.max(plan * 1.15, ...rows.map((row) => row.coal + row.waste)) || 1;
  const W = 720;
  const H = 190;
  const pad = { l: 46, r: 8, t: 10, b: 24 };
  const inner = { w: W - pad.l - pad.r, h: H - pad.t - pad.b };
  const step = inner.w / rows.length;
  const bar = Math.max(3, step * 0.62);
  const y = (value) => pad.t + inner.h - (value / max) * inner.h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => {
    const value = max * share;
    return `<line class="fl-gridl" x1="${pad.l}" x2="${W - pad.r}" y1="${y(value)}" y2="${y(value)}" /><text class="fl-axis" x="${pad.l - 6}" y="${y(value) + 4}" text-anchor="end">${value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : Math.round(value)}</text>`;
  });
  const every = Math.ceil(rows.length / 12);
  const bars = rows
    .map((row, index) => {
      const x = pad.l + index * step + (step - bar) / 2;
      const coalTop = y(row.coal);
      const wasteTop = y(row.coal + row.waste);
      return `<g><title>${row.title} · Нүүрс ${num(row.coal)} т · Хөрс ${num(row.waste)} т · ${row.loads} рейс</title>
        <rect class="fl-col-coal" x="${x.toFixed(1)}" y="${coalTop.toFixed(1)}" width="${bar.toFixed(1)}" height="${(pad.t + inner.h - coalTop).toFixed(1)}" rx="2" />
        <rect class="fl-col-waste" x="${x.toFixed(1)}" y="${wasteTop.toFixed(1)}" width="${bar.toFixed(1)}" height="${Math.max(0, coalTop - wasteTop).toFixed(1)}" rx="2" />
        ${index % every === 0 ? `<text class="fl-axis" x="${(x + bar / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${row.label}</text>` : ""}</g>`;
    })
    .join("");
  const sum = rows.reduce((acc, row) => ({ coal: acc.coal + row.coal, waste: acc.waste + row.waste, loads: acc.loads + row.loads }), { coal: 0, waste: 0, loads: 0 });
  const html = `<div class="fl-chart">
      <svg viewBox="0 0 ${W} ${H}" aria-hidden="true">${ticks.join("")}${bars}<line class="fl-plan" x1="${pad.l}" x2="${W - pad.r}" y1="${y(plan)}" y2="${y(plan)}" /></svg>
      <div class="fl-chart-sum">
        <div><i class="is-coal"></i><small>Нүүрс</small><b>${num(sum.coal)} т</b></div>
        <div><i class="is-waste"></i><small>Хөрс</small><b>${num(sum.waste)} т</b></div>
        <div><i class="is-plan"></i><small>Нүүрсний төлөвлөгөө</small><b>${num(plan)} т/${f.range === "24h" ? "цаг" : "өдөр"}</b></div>
        <div><small>Рейс</small><b>${num(sum.loads)}</b></div>
      </div>
    </div>`;
  f.chart = { key, html };
  return html;
}

/* ---------- selected unit ---------- */

function busy() {
  const active = document.activeElement;
  return Boolean(document.querySelector(".modal:not(.is-closing)")) || (ctx.stage.contains(active) && active?.tagName === "SELECT");
}

function paintSelected(full) {
  const box = ctx.stage.querySelector('[data-fl-part="sel"]');
  if (!box) return;
  const unit = f.sel && unitOf(f.sel);
  const record = f.sel && recordOf(f.sel);
  if (!unit || !record) {
    box.hidden = true;
    box.innerHTML = "";
    box.dataset.unit = "";
    return;
  }
  box.hidden = false;
  if (box.dataset.unit !== unit.id || (full && !busy())) {
    box.dataset.unit = unit.id;
    box.innerHTML = `<div data-fl-sel-live></div>${selActions(unit, record)}`;
    f.parts.delete("sel");
  }
  const html = selLive(unit, record);
  if (f.parts.get("sel") === html) return;
  box.querySelector("[data-fl-sel-live]").innerHTML = html;
  f.parts.set("sel", html);
}

function selLive(unit, record) {
  const [label, tone] = stateOf(unit);
  const today = f.totals.machines[unit.id];
  const fuel = fuelLevel(unit, Date.now());
  const gauge = Math.min(1, unit.kmh / 60);
  const arc = 2 * Math.PI * 34 * 0.75;
  const fact = (icon, name, value) => `<div><dt>${ico(icon, "fl-ico tiny")}${name}</dt><dd>${value}</dd></div>`;
  const payload =
    unit.type === "truck" && unit.cap
      ? `<div class="fl-payload"><div><span>Ачаа</span><b>${num(unit.payload)} / ${num(unit.cap)} т</b>${unit.material ? `<em class="is-${unit.material}">${MATERIALS[unit.material]}</em>` : ""}</div><span class="fl-bar is-${unit.material || "ok"}"><i style="width:${pct(unit.payload / unit.cap)}"></i></span></div>`
      : "";
  const trucks = unit.trucks ? f.live.machines.filter((item) => unit.trucks.includes(item.id)) : null;
  return `<div class="fl-sel-head">
      <span class="fl-sel-ico is-${tone}">${ico(unit.type)}</span>
      <div><b>${esc(unit.code)}</b><small>${esc(record.model || "")} · ${esc(EQUIP_TYPES[unit.type] || unit.type)}</small></div>
      <em class="fl-badge is-${tone}">${label}</em>
      <button type="button" class="fl-x" data-fl-close aria-label="Хаах">${ico("close")}</button>
    </div>
    <div class="fl-speed${unit.overspeed ? " is-fast" : ""}">
      <svg viewBox="0 0 80 80" aria-hidden="true"><circle class="fl-gauge-bg" cx="40" cy="40" r="34" stroke-dasharray="${arc} 999" transform="rotate(135 40 40)" /><circle class="fl-gauge-val" cx="40" cy="40" r="34" stroke-dasharray="${(arc * gauge).toFixed(1)} 999" transform="rotate(135 40 40)" /></svg>
      <div><b>${unit.kmh.toFixed(1)}</b><span>км/ц</span><small>Хязгаар ${unit.limit} км/ц</small></div>
    </div>
    ${payload}
    <dl class="fl-facts">
      ${fact("route", "Үйлдэл", esc(PHASES[unit.phase] || "–"))}
      ${unit.dest ? fact("pin", "Чиглэл", `${esc(unit.dest)}${unit.eta ? ` · ${etaText(unit.eta)}` : ""}`) : ""}
      ${fact("target", "GPS", `${unit.lat.toFixed(5)}, ${unit.lng.toFixed(5)}`)}
      ${fact("mine", "Бүс", esc(ZONES[unit.zone] || "–"))}
      ${fact("user", "Оператор", esc(record.operator?.name || "Оноогоогүй"))}
      ${today ? fact("chart", "Өнөөдөр", `${today.loads} рейс · ${num(today.tonnes)} т`) : ""}
      ${trucks ? fact("truck", "Самосвал", trucks.length ? trucks.map((item) => esc(item.code)).join(", ") : "–") : ""}
      ${fact("fuel", "Шатахуун", `<span class="fl-bar${fuel < 0.2 ? " is-low" : " is-fuel"}"><i style="width:${pct(fuel)}"></i></span>${pct(fuel)}`)}
      ${fact("clock", "Мото цаг", `${num(record.hours)} · ${record.service.due ? `<span class="is-bad">засвар хэтэрсэн</span>` : `засвар ${num(record.service.left)} ц дараа`}`)}
      ${fact("check", "Prestart", record.prestart ? (record.prestart.fails.length ? `<span class="${record.prestart.critical ? "is-bad" : "is-warn"}">${esc(record.prestart.fails.join(", "))}</span>` : `<span class="is-ok">Хэвийн</span>`) : "Бөглөөгүй")}
    </dl>
    ${record.orders.length ? `<ul class="fl-orders">${record.orders.map((order) => `<li>${ico("wrench", "fl-ico tiny")}<span>${esc(order.title)}</span><em>${esc(WO_KINDS[order.kind] || "")}</em></li>`).join("")}</ul>` : ""}`;
}

function selActions(unit, record) {
  const dispatch = unit.type === "truck" && !["down", "service"].includes(unit.status);
  const diggers = f.live.plan.diggers.filter((item) => item.active);
  const current = f.data.dispatch[unit.id] || "";
  return `<div class="fl-sel-actions">
    ${dispatch ? `<label class="fl-select">${ico("route", "fl-ico tiny")}<select data-fl-dispatch="${esc(unit.id)}" aria-label="Чиглүүлэх"><option value="">Автомат чиглүүлэлт</option>${diggers.map((item) => `<option value="${esc(item.machine.id)}"${current === item.machine.id ? " selected" : ""}>${esc(item.machine.code)} · ${MATERIALS[materialOf(item)]} · ${item.trucks.length} самосвал</option>`).join("")}</select></label>` : ""}
    <button type="button" class="fl-btn" data-fl-order="${esc(record.id)}">${ico("wrench", "fl-ico tiny")}Засварын хүсэлт</button>
  </div>`;
}

function select(id) {
  f.sel = id;
  drawUnits();
  paintParts(false);
}

function openOrder(id) {
  const record = recordOf(id);
  if (!record) return;
  const options = (map, chosen) => Object.entries(map).map(([key, label]) => `<option value="${key}"${key === chosen ? " selected" : ""}>${esc(label)}</option>`).join("");
  const wrap = ctx.openModal({
    shield: ico("wrench", "m-ico"),
    title: `${esc(record.code)} · засварын хүсэлт`,
    sub: esc(`${record.model || ""} · ${EQUIP_TYPES[record.type] || ""}`),
    body: `<form class="m-form" novalidate><div class="m-form-grid">
        <label class="m-field"><span>Төрөл</span><select name="kind">${options(WO_KINDS, "breakdown")}</select></label>
        <label class="m-field"><span>Яаралтай эсэх</span><select name="priority">${options(PRIORITIES, "high")}</select></label>
        <label class="m-field is-wide"><span>Гарчиг *</span><input name="title" maxlength="100" required /></label>
        <label class="m-field is-wide"><span>Тайлбар</span><textarea name="description" maxlength="800" rows="3"></textarea></label>
      </div><p class="form-error m-form-error" role="alert" hidden></p>
      <div class="modal-actions"><button class="chip" type="button" data-close>Болих</button><button class="primary" type="submit">${ico("check", "m-ico")}Илгээх</button></div></form>`,
    className: "m-modal",
  });
  if (!wrap) return;
  const form = wrap.querySelector("form");
  form.elements.title.focus();
  form.addEventListener("input", () => (form.dataset.dirty = "1"), { once: true });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = form.querySelector(".m-form-error");
    const values = Object.fromEntries(new FormData(form));
    if (!values.title.trim()) {
      error.textContent = "Гарчиг оруулна уу";
      error.hidden = false;
      return;
    }
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    try {
      await send("/api/fleet/workorders", { ...values, equipment: record.id });
      ctx.closeModal(true);
      ctx.toast("Засварын хүсэлт", `${record.code} · мастерын самбарт бүртгэгдлээ`);
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
      button.disabled = false;
    }
  });
}

/* ---------- events ---------- */

function onClick(event) {
  if (!FLEET_VIEWS.includes(ctx.state.view)) return;
  f.pressing = false;
  const target = event.target;
  const unit = target.closest("[data-fl-unit]");
  if (unit && !f.drag?.moved) {
    select(unit.dataset.flUnit);
    return;
  }
  if (target.closest("[data-fl-close]")) {
    f.sel = null;
    drawUnits();
    paintParts(false);
    return;
  }
  const order = target.closest("[data-fl-order]");
  if (order) {
    openOrder(order.dataset.flOrder);
    return;
  }
  const zone = target.closest("[data-fl-zone]");
  if (zone) {
    setZone(zone.dataset.flZone);
    return;
  }
  const type = target.closest("[data-fl-type]");
  if (type) {
    f.type = type.dataset.flType;
    for (const button of ctx.stage.querySelectorAll("[data-fl-type]")) button.classList.toggle("is-on", button === type);
    drawUnits();
    paintParts(false);
    return;
  }
  const material = target.closest("[data-fl-material]");
  if (material) {
    f.material = f.material === material.dataset.flMaterial ? null : material.dataset.flMaterial;
    drawUnits();
    paintParts(false);
    return;
  }
  const range = target.closest("[data-fl-range]");
  if (range) {
    f.range = range.dataset.flRange;
    for (const button of ctx.stage.querySelectorAll("[data-fl-range]")) button.classList.toggle("is-on", button === range);
    paintParts(false);
    return;
  }
  const zoom = target.closest("[data-fl-zoom]");
  if (zoom) {
    if (zoom.dataset.flZoom === "reset") frameZone(f.zone);
    else zoomBy(zoom.dataset.flZoom === "in" ? 1 / 1.4 : 1.4);
    return;
  }
  const tilt = target.closest("[data-fl-tilt]");
  if (tilt) {
    f.tilt = !f.tilt;
    saveUi();
    tilt.classList.toggle("is-on", f.tilt);
    tilt.querySelector("span").textContent = f.tilt ? "3D" : "2D";
    ctx.stage.querySelector("[data-fl-map]")?.classList.toggle("is-3d", f.tilt);
    drawUnits();
    return;
  }
  const layer = target.closest("[data-fl-layer]");
  if (layer) {
    const name = layer.dataset.flLayer;
    f.layers[name] = !f.layers[name];
    saveUi();
    layer.classList.toggle("is-on", f.layers[name]);
    ctx.stage.querySelector("[data-fl-map]")?.classList.toggle(`no-${name}`, !f.layers[name]);
  }
}

function setZone(zone) {
  f.zone = Object.hasOwn(ZONES, zone) ? zone : "all";
  const picker = ctx.stage.querySelector("[data-fl-zone-select]");
  if (picker) picker.value = f.zone;
  frameZone(f.zone);
  paintParts(false);
}

async function onChange(event) {
  if (!FLEET_VIEWS.includes(ctx.state.view)) return;
  const target = event.target;
  if (target.matches("[data-fl-zone-select]")) {
    setZone(target.value);
    target.blur();
    return;
  }
  if (target.matches("[data-fl-dispatch]")) {
    const truck = target.dataset.flDispatch;
    target.disabled = true;
    try {
      await send("/api/fleet/dispatch", { truck, digger: target.value || null });
      const code = recordOf(truck)?.code || "";
      ctx.toast("Чиглүүлэлт", target.value ? `${code} → ${recordOf(target.value)?.code || ""}` : `${code} · автомат чиглүүлэлт`);
    } catch (error) {
      ctx.toast("Амжилтгүй", error.message);
    } finally {
      target.disabled = false;
      target.blur();
      paintParts(true);
    }
  }
}
