// Mine fleet telemetry for the control centre, shared by the server and the browser.
// Positions are worked out from the clock, so every screen sees the same machine in the same place without a GPS feed.

const KMH = 1 / 3.6;
const TZ_MS = 8 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
const DAY_S = 86400;
const EPOCH = Date.UTC(2026, 0, 1) - TZ_MS;
const M_PER_DEG = 111320;

/** Daily stops in local minutes: the fleet parks where it is. */
export const BREAKS = [
  [0, 20, "Хоолны завсарлага"],
  [360, 380, "Ээлж солилт"],
  [720, 740, "Хоолны завсарлага"],
  [1080, 1100, "Ээлж солилт"],
];
const OP_DAY = DAY_S - BREAKS.reduce((sum, [from, to]) => sum + (to - from) * 60, 0);

export const MATERIALS = { coal: "Нүүрс", waste: "Хөрс" };
export const ZONES = { north: "Хойд уурхай", west: "Баруун уурхай", plant: "Үйлдвэр, агуулах", dump: "Хөрсний овоолго", base: "Засварын төв", road: "Тээврийн зам" };
export const PHASES = {
  queue: "Ачилт хүлээж байна",
  loading: "Ачиж байна",
  hauling: "Ачаатай явж байна",
  dumping: "Буулгаж байна",
  returning: "Хоосон буцаж байна",
  digging: "Ухаж байна",
  waiting: "Самосвал хүлээж байна",
  drilling: "Өрөмдөж байна",
  working: "Ажиллаж байна",
  driving: "Явж байна",
  stopped: "Зогсож байна",
  parked: "Зогсоолд",
  down: "Эвдэрсэн",
  service: "Засварт",
};
export const SPEED = { loadedRamp: 12, loadedFlat: 30, emptyRamp: 22, emptyFlat: 37, fast: 48 };
export const LIMIT = { ramp: 25, flat: 40 };
const T_LOAD = 150;
const T_DUMP = 50;
const T_QUEUE = 45;

export const SITE = {
  name: "Нүүрсний ил уурхай",
  lat: 43.5865,
  lng: 105.5163,
  view: [-1700, -1050, 3400, 2100],
  pits: [
    { id: "north", name: "Хойд уурхай", cx: 420, cy: -180, rx: 700, ry: 430, benches: 7, floor: 0.3 },
    { id: "west", name: "Баруун уурхай", cx: -820, cy: -420, rx: 380, ry: 250, benches: 5, floor: 0.32 },
  ],
  dump: { cx: 1150, cy: 640, rx: 430, ry: 250 },
  places: {
    plant: { x: -420, y: 560, name: "Баяжуулах үйлдвэр" },
    rom: { x: -820, y: 640, name: "Нүүрсний агуулах" },
    dump: { x: 1150, y: 600, name: "Хөрсний овоолго" },
    workshop: { x: -1350, y: 180, name: "Засварын төв" },
    parking: { x: -1320, y: 340, name: "Зогсоол" },
    fuel: { x: -1110, y: 300, name: "Шатахуун түгээх" },
    camp: { x: -1690, y: 900, name: "Кэмп" },
  },
};

const pitOf = (id) => SITE.pits.find((item) => item.id === id);
const round = (value) => Math.round(value * 10) / 10;
const TURNS = 1.15;

/** A point on a pit's spiral haul ramp: s = 0 on the floor, 1 at the rim exit on the south side. */
export function rampPoint(id, s) {
  const pit = pitOf(id);
  const theta = Math.PI / 2 - (1 - s) * TURNS * 2 * Math.PI;
  const r = pit.floor + (1.03 - pit.floor) * s;
  return [round(pit.cx + pit.rx * r * Math.cos(theta)), round(pit.cy + pit.ry * r * Math.sin(theta))];
}

function ramp(id, from = 0, to = 1) {
  const steps = Math.max(8, Math.round(64 * (to - from)));
  return Array.from({ length: steps + 1 }, (_, index) => rampPoint(id, from + ((to - from) * index) / steps));
}

const J1 = [420, 360];
const JW = [-800, 0];
const JW2 = [-680, 300];
const LINES = {
  northExit: [rampPoint("north", 1), J1],
  toPlant: [J1, [160, 420], [-120, 500], [-330, 545], [-420, 560]],
  toDump: [J1, [680, 420], [880, 500], [1030, 560], [1150, 600]],
  westExit: [rampPoint("west", 1), JW, [-720, 180], JW2],
  westPlant: [JW2, [-560, 430], [-460, 530], [-420, 560]],
  westRom: [JW2, [-740, 450], [-800, 600], [-820, 630]],
  workshop: [[-1350, 180], [-1180, 170], [-1000, 120], JW],
  fuel: [[-1180, 170], [-1110, 300]],
  parking: [[-1350, 180], [-1320, 340]],
  camp: [[-1700, 900], [-1520, 720], [-1400, 520], [-1320, 340]],
};
const reversed = (line) => [...line].reverse();

/** Roads for the map: the two spiral ramps and the surface haul roads. */
export const ROADS = [
  { pts: ramp("north"), ramp: true },
  { pts: ramp("west"), ramp: true },
  ...Object.values(LINES).map((pts) => ({ pts, ramp: false })),
];

/** Dig faces: where an excavator or loader stands, what it digs and where its trucks dump. */
export const FACES = {
  "n-coal": { pit: "north", s: 0, material: "coal", to: "plant" },
  "n-ob1": { pit: "north", s: 0.62, material: "waste", to: "dump" },
  "n-ob2": { pit: "north", s: 0.36, material: "waste", to: "dump" },
  "w-coal": { pit: "west", s: 0, material: "coal", to: "rom" },
  "w-ob": { pit: "west", s: 0.55, material: "waste", to: "dump" },
};
const DIGGER_FACES = { excavator: ["n-coal", "n-ob1", "n-ob2", "w-ob"], loader: ["w-coal"] };
const DRILL_SPOTS = [[-40, -470], [700, -520], [-1000, -560]];
const CRANE_SPOTS = [[-350, 615], [-1300, 120]];

/** Shuttle routes for the support fleet. */
const PATROLS = {
  dozer: { pts: [[1040, 575], [1180, 540], [1290, 600], [1220, 690]], kmh: 6, dwell: 25 },
  grader: { pts: LINES.toDump, kmh: 9, dwell: 40 },
  lv: { pts: [...LINES.workshop, [-720, 180], ...LINES.westPlant, ...reversed(LINES.toPlant).slice(1), rampPoint("north", 1)], kmh: 36, dwell: 150 },
  bus: { pts: [...LINES.camp, [-1350, 180]], kmh: 35, dwell: 900 },
};

function buildRoute(legs) {
  const pts = [];
  const ramps = [];
  for (const { pts: line, ramp: isRamp } of legs) {
    for (const point of line) {
      const last = pts[pts.length - 1];
      if (last && last[0] === point[0] && last[1] === point[1]) continue;
      if (pts.length) ramps.push(Boolean(isRamp));
      pts.push(point);
    }
  }
  const cum = [0];
  for (let index = 1; index < pts.length; index += 1) cum.push(cum[index - 1] + Math.hypot(pts[index][0] - pts[index - 1][0], pts[index][1] - pts[index - 1][1]));
  const length = cum[cum.length - 1];
  const rampLen = ramps.reduce((sum, isRamp, index) => sum + (isRamp ? cum[index + 1] - cum[index] : 0), 0);
  return { pts, ramps, cum, length, rampLen, flatLen: length - rampLen };
}

const ROUTES = new Map();

/** The haul road from a dig face to where its material is dumped. */
export function haulRoute(faceKey) {
  if (ROUTES.has(faceKey)) return ROUTES.get(faceKey);
  const face = FACES[faceKey];
  const legs = [{ pts: ramp(face.pit, face.s, 1), ramp: true }];
  if (face.pit === "north") legs.push({ pts: LINES.northExit }, { pts: face.to === "plant" ? LINES.toPlant : LINES.toDump });
  else {
    legs.push({ pts: LINES.westExit });
    if (face.to === "rom") legs.push({ pts: LINES.westRom });
    else if (face.to === "plant") legs.push({ pts: LINES.westPlant });
    else legs.push({ pts: LINES.westPlant }, { pts: reversed(LINES.toPlant) }, { pts: LINES.toDump });
  }
  const route = buildRoute(legs);
  ROUTES.set(faceKey, route);
  return route;
}

const PATROL_ROUTES = new Map();
const patrolRoute = (type) => {
  if (!PATROL_ROUTES.has(type)) PATROL_ROUTES.set(type, buildRoute([{ pts: PATROLS[type].pts }]));
  return PATROL_ROUTES.get(type);
};

/** Where the digger itself stands: a little off the ramp, against the face. */
export function facePoint(faceKey) {
  const face = FACES[faceKey];
  const pit = pitOf(face.pit);
  const [x, y] = rampPoint(face.pit, face.s);
  const dx = (x - pit.cx) / pit.rx;
  const dy = (y - pit.cy) / pit.ry;
  const norm = Math.hypot(dx, dy) || 1;
  return [round(x + (dx / norm) * 36), round(y + (dy / norm) * 36)];
}

function cycleOf(route) {
  const haul = route.rampLen / (SPEED.loadedRamp * KMH) + route.flatLen / (SPEED.loadedFlat * KMH);
  const back = route.rampLen / (SPEED.emptyRamp * KMH) + route.flatLen / (SPEED.emptyFlat * KMH);
  const backFast = route.rampLen / (SPEED.emptyRamp * KMH) + route.flatLen / (SPEED.fast * KMH);
  return { haul, back, backFast, total: T_QUEUE + T_LOAD + haul + T_DUMP + back };
}

function hash(...parts) {
  let value = 2166136261;
  for (const char of parts.join("|")) {
    value ^= char.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  value ^= value >>> 13;
  value = Math.imul(value, 0x5bd1e995);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967296;
}

const angle = (from, to) => (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;

/** Moves along a route for `tau` seconds at ramp/flat speeds; returns the point, heading and speed there. */
function walk(route, tau, rampKmh, flatKmh, backwards) {
  const count = route.ramps.length;
  for (let step = 0; step < count; step += 1) {
    const index = backwards ? count - 1 - step : step;
    const length = route.cum[index + 1] - route.cum[index];
    const kmh = route.ramps[index] ? rampKmh : flatKmh;
    const time = length / (kmh * KMH);
    if (tau <= time || step === count - 1) {
      const share = Math.min(1, Math.max(0, tau / time));
      const [from, to] = backwards ? [route.pts[index + 1], route.pts[index]] : [route.pts[index], route.pts[index + 1]];
      return { x: from[0] + (to[0] - from[0]) * share, y: from[1] + (to[1] - from[1]) * share, heading: angle(from, to), kmh, ramp: route.ramps[index] };
    }
    tau -= time;
  }
  return { x: route.pts[0][0], y: route.pts[0][1], heading: 0, kmh: 0, ramp: false };
}

/** Seconds of working time since the epoch; the clock stands still during breaks. */
export function opClock(ms) {
  const local = (ms - EPOCH) / 1000;
  const day = Math.floor(local / DAY_S);
  const sec = local - day * DAY_S;
  let used = sec;
  for (const [from, to] of BREAKS) used -= Math.min(Math.max(sec - from * 60, 0), (to - from) * 60);
  return day * OP_DAY + used;
}

export function breakAt(ms) {
  const minute = (((ms + TZ_MS) / 60000) % 1440 + 1440) % 1440;
  const hit = BREAKS.find(([from, to]) => minute >= from && minute < to);
  return hit ? { label: hit[2], until: Math.round(ms + (hit[1] - minute) * 60000) } : null;
}

/** 06:00 local on the shift day `ms` falls in. */
export function shiftDayStart(ms) {
  const local = ms + TZ_MS - 6 * HOUR_MS;
  return Math.floor(local / (DAY_S * 1000)) * DAY_S * 1000 + 6 * HOUR_MS - TZ_MS;
}

export function toGps(x, y) {
  return { lat: SITE.lat - y / M_PER_DEG, lng: SITE.lng + x / (M_PER_DEG * Math.cos((SITE.lat * Math.PI) / 180)) };
}

export function zoneOf(x, y) {
  for (const pit of SITE.pits) if (((x - pit.cx) / pit.rx) ** 2 + ((y - pit.cy) / pit.ry) ** 2 <= 1.15) return pit.id;
  const dump = SITE.dump;
  if (((x - dump.cx) / dump.rx) ** 2 + ((y - dump.cy) / dump.ry) ** 2 <= 1.2) return "dump";
  const near = (place, radius) => Math.hypot(x - place.x, y - place.y) <= radius;
  if (near(SITE.places.plant, 260) || near(SITE.places.rom, 220)) return "plant";
  if (near(SITE.places.workshop, 330) || near(SITE.places.camp, 220)) return "base";
  return "road";
}

/** The map area to frame for each zone, as an SVG viewBox. */
export function zoneBox(zone) {
  const pit = pitOf(zone);
  if (pit) return [pit.cx - pit.rx - 120, pit.cy - pit.ry - 120, 2 * pit.rx + 240, 2 * pit.ry + 240];
  if (zone === "dump") return [SITE.dump.cx - SITE.dump.rx - 300, SITE.dump.cy - SITE.dump.ry - 200, 2 * SITE.dump.rx + 500, 2 * SITE.dump.ry + 340];
  if (zone === "plant") return [-1050, 300, 900, 560];
  if (zone === "base") return [-1700, -60, 900, 600];
  return [...SITE.view];
}

const TRUCK_CAPACITY = [[/797/, 363], [/793/, 227], [/930E/, 290], [/830E/, 220], [/789/, 181], [/HD785/, 91], [/785/, 136], [/777/, 90], [/775/, 64], [/7513/, 130], [/7555/, 55]];

/** Rated payload in tonnes, read from the truck's model name. */
export function truckCapacity(model = "") {
  const name = String(model || "").toUpperCase();
  return TRUCK_CAPACITY.find(([pattern]) => pattern.test(name))?.[1] || 90;
}

const working = (machine) => machine && !["down", "service"].includes(machine.status);
const byCode = (a, b) => String(a.code).localeCompare(String(b.code), "en", { numeric: true });

/** Puts diggers on faces and trucks on diggers; a dispatcher's choice wins while that digger is working. */
export function planFleet(equipment, dispatch = {}) {
  const list = [...(equipment || [])].sort(byCode);
  const diggers = [];
  for (const type of ["excavator", "loader"]) {
    list.filter((item) => item.type === type).forEach((machine, index) => {
      const face = DIGGER_FACES[type][index];
      if (face) diggers.push({ machine, face, active: working(machine), trucks: [] });
    });
  }
  const active = diggers.filter((item) => item.active);
  const trucks = list.filter((item) => item.type === "truck" && working(item));
  const auto = [];
  for (const truck of trucks) {
    const chosen = active.find((item) => item.machine.id === dispatch?.[truck.id]);
    if (chosen) chosen.trucks.push(truck);
    else auto.push(truck);
  }
  for (const truck of auto) {
    const big = truckCapacity(truck.model) >= 150;
    const preferred = active.filter((item) => (FACES[item.face].material === "waste") === big);
    const pool = preferred.length ? preferred : active;
    const target = pool.reduce((best, item) => (!best || item.trucks.length < best.trucks.length ? item : best), null);
    target?.trucks.push(truck);
  }
  const haul = new Map();
  for (const digger of active) {
    digger.trucks.sort(byCode);
    digger.trucks.forEach((truck, index) => haul.set(truck.id, { digger, index, count: digger.trucks.length }));
  }
  return { list, diggers, haul };
}

function truckCycle(truck, slot) {
  const route = haulRoute(slot.digger.face);
  const cycle = cycleOf(route);
  const offset = (slot.index / slot.count) * cycle.total + hash(truck.id) * 20;
  return { route, cycle, offset, cap: truckCapacity(truck.model), face: FACES[slot.digger.face] };
}

/** Coal is light for its bulk, so a tray fills by volume at about 70% of the rated tonnes. */
const FILL = { coal: [0.64, 0.12], waste: [0.88, 0.12] };

function cycleDetail(truck, info, k) {
  const fast = info.route.flatLen > 300 && hash(truck.id, k, "v") < 0.14;
  const back = fast ? info.cycle.backFast : info.cycle.back;
  const [low, spread] = FILL[info.face.material];
  return { fast, back, queue: T_QUEUE + info.cycle.back - back, full: Math.round(info.cap * (low + spread * hash(truck.id, k, "p"))) };
}

function truckState(truck, slot, op) {
  const info = truckCycle(truck, slot);
  const { route, cycle } = info;
  const position = op + info.offset;
  const k = Math.floor(position / cycle.total);
  let u = position - k * cycle.total;
  const { fast, back, queue, full } = cycleDetail(truck, info, k);
  const place = SITE.places[info.face.to].name;
  const base = { material: info.face.material, cap: info.cap, digger: slot.digger.machine.id, diggerCode: slot.digger.machine.code, face: slot.digger.face, cycle: Math.round(cycle.total) };
  const atStart = { x: route.pts[0][0], y: route.pts[0][1], heading: angle(route.pts[1], route.pts[0]) };
  const end = route.pts[route.pts.length - 1];
  const atEnd = { x: end[0], y: end[1], heading: angle(route.pts[route.pts.length - 2], end) };
  if (u < queue) return { ...base, ...atStart, phase: "queue", kmh: 0, payload: 0, dest: slot.digger.machine.code, eta: queue - u + T_LOAD };
  u -= queue;
  if (u < T_LOAD) return { ...base, ...atStart, phase: "loading", kmh: 0, payload: Math.round((full * Math.min(4, Math.floor(u / (T_LOAD / 4)) + 1)) / 4), dest: place, eta: T_LOAD - u };
  u -= T_LOAD;
  if (u < cycle.haul) return { ...base, ...walk(route, u, SPEED.loadedRamp, SPEED.loadedFlat, false), phase: "hauling", payload: full, dest: place, eta: cycle.haul - u };
  u -= cycle.haul;
  if (u < T_DUMP) return { ...base, ...atEnd, phase: "dumping", kmh: 0, payload: Math.round(full * (1 - u / T_DUMP)), dest: place, eta: T_DUMP - u };
  u -= T_DUMP;
  return { ...base, ...walk(route, u, SPEED.emptyRamp, fast ? SPEED.fast : SPEED.emptyFlat, true), phase: "returning", payload: 0, dest: slot.digger.machine.code, eta: back - u };
}

function patrolState(machine, index, op) {
  const spec = PATROLS[machine.type];
  const route = patrolRoute(machine.type);
  const run = route.length / (spec.kmh * KMH);
  const period = 2 * (spec.dwell + run);
  let u = (op + index * period * 0.37 + hash(machine.id) * 60) % period;
  const first = route.pts[0];
  const last = route.pts[route.pts.length - 1];
  if (u < spec.dwell) return { x: first[0], y: first[1], heading: angle(route.pts[1], first), phase: "stopped", kmh: 0 };
  u -= spec.dwell;
  if (u < run) return { ...walk(route, u, spec.kmh, spec.kmh, false), phase: machine.type === "dozer" ? "working" : "driving" };
  u -= run;
  if (u < spec.dwell) return { x: last[0], y: last[1], heading: angle(route.pts[route.pts.length - 2], last), phase: "stopped", kmh: 0 };
  return { ...walk(route, u - spec.dwell, spec.kmh, spec.kmh, true), phase: machine.type === "dozer" ? "working" : "driving" };
}

const slotAt = (origin, index, perRow, gap) => ({ x: origin[0] + (index % perRow) * gap, y: origin[1] + Math.floor(index / perRow) * gap * 0.9 });

/** Every machine's position, speed, heading, payload and job at `ms`. */
export function fleetState(equipment, ms, { dispatch } = {}) {
  const plan = planFleet(equipment, dispatch);
  const op = opClock(ms);
  const pause = breakAt(ms);
  const machines = [];
  const typeIndex = {};
  let bays = 0;
  let idle = 0;
  for (const machine of plan.list) {
    typeIndex[machine.type] = (typeIndex[machine.type] ?? -1) + 1;
    const index = typeIndex[machine.type];
    let state;
    if (machine.status === "down" || machine.status === "service") state = { ...slotAt([-1440, 95], bays++, 4, 52), heading: 90, phase: machine.status, kmh: 0 };
    else if (machine.type === "truck" && plan.haul.has(machine.id)) state = truckState(machine, plan.haul.get(machine.id), op);
    else if (["excavator", "loader"].includes(machine.type) && plan.diggers.some((item) => item.machine.id === machine.id)) {
      const digger = plan.diggers.find((item) => item.machine.id === machine.id);
      const [x, y] = facePoint(digger.face);
      const pit = pitOf(FACES[digger.face].pit);
      state = { x, y, heading: angle([x, y], [pit.cx, pit.cy]), phase: digger.trucks.length ? "waiting" : "digging", kmh: 0, face: digger.face, material: FACES[digger.face].material, trucks: digger.trucks.map((item) => item.id) };
    } else if (PATROLS[machine.type]) state = patrolState(machine, index, op);
    else if (machine.type === "drill") {
      const [x, y] = DRILL_SPOTS[index % DRILL_SPOTS.length];
      state = { x, y, heading: 20, phase: "drilling", kmh: 0 };
    } else if (machine.type === "crane") {
      const [x, y] = CRANE_SPOTS[index % CRANE_SPOTS.length];
      state = { x, y, heading: 0, phase: "working", kmh: 0 };
    } else state = { ...slotAt([-1400, 380], idle++, 5, 46), heading: 90, phase: "parked", kmh: 0 };
    const moving = state.kmh > 0 && !pause;
    const kmh = moving ? Math.round(state.kmh * (1 + 0.035 * Math.sin(ms / 2300 + hash(machine.id) * 6)) * 10) / 10 : 0;
    const limit = state.ramp ? LIMIT.ramp : LIMIT.flat;
    machines.push({
      ...state,
      id: machine.id,
      code: machine.code,
      type: machine.type,
      model: machine.model || "",
      status: machine.status,
      kmh,
      moving,
      paused: Boolean(pause) && !["down", "service", "parked"].includes(state.phase),
      limit,
      overspeed: moving && kmh > limit,
      zone: zoneOf(state.x, state.y),
      ...toGps(state.x, state.y),
    });
  }
  for (const machine of machines) {
    if (!machine.trucks) continue;
    if (machines.some((truck) => truck.digger === machine.id && truck.phase === "loading")) machine.phase = "loading";
  }
  return { at: ms, op, pause, machines, plan };
}

/** Loads dumped between two moments, per material and per machine. */
export function haulTotals(equipment, fromMs, toMs, { dispatch } = {}) {
  const plan = planFleet(equipment, dispatch);
  const from = opClock(fromMs);
  const to = opClock(toMs);
  const totals = { coal: 0, waste: 0, loads: 0, machines: {} };
  for (const truck of plan.list) {
    const slot = plan.haul.get(truck.id);
    if (!slot) continue;
    const info = truckCycle(truck, slot);
    const mine = { loads: 0, tonnes: 0 };
    const first = Math.floor((from + info.offset) / info.cycle.total) - 1;
    const last = Math.floor((to + info.offset) / info.cycle.total) + 1;
    for (let k = first; k <= last; k += 1) {
      const detail = cycleDetail(truck, info, k);
      const done = k * info.cycle.total - info.offset + detail.queue + T_LOAD + info.cycle.haul + T_DUMP;
      if (done <= from || done > to) continue;
      mine.loads += 1;
      mine.tonnes += detail.full;
      totals[info.face.material] += detail.full;
      totals.loads += 1;
      const digger = (totals.machines[slot.digger.machine.id] ||= { loads: 0, tonnes: 0 });
      digger.loads += 1;
      digger.tonnes += detail.full;
    }
    totals.machines[truck.id] = mine;
  }
  return totals;
}

/** Tonnes dumped per hour over the last `hours`, ending with the current hour. */
export function hourlyHaul(equipment, ms, { dispatch, hours = 24 } = {}) {
  const end = Math.floor(ms / HOUR_MS) * HOUR_MS + HOUR_MS;
  return Array.from({ length: hours }, (_, index) => {
    const start = end - (hours - index) * HOUR_MS;
    const totals = haulTotals(equipment, start, Math.min(start + HOUR_MS, ms), { dispatch });
    return { start, coal: totals.coal, waste: totals.waste, loads: totals.loads };
  });
}

const TANK = { truck: 1500, excavator: 3400, loader: 1600, dozer: 1100, grader: 500, drill: 700, crane: 400, lv: 130, bus: 300 };
const BURN = { truck: 70, excavator: 160, loader: 90, dozer: 55, grader: 22, drill: 40, crane: 15, lv: 12, bus: 18 };

/** Share of a full tank, refilled at every shift change and drawn down while working. */
export function fuelLevel(machine, ms) {
  const shiftMs = 12 * HOUR_MS;
  const start = Math.floor((ms + TZ_MS - 6 * HOUR_MS) / shiftMs);
  const into = (ms + TZ_MS - 6 * HOUR_MS - start * shiftMs) / HOUR_MS;
  const full = 0.88 + 0.12 * hash(machine.id, start, "f");
  if (["down", "service"].includes(machine.status)) return Math.round(full * 60) / 100;
  const used = (into * (BURN[machine.type] || 20) * (0.75 + 0.55 * hash(machine.id, "b"))) / (TANK[machine.type] || 500);
  return Math.max(0.04, Math.round((full - used) * 100) / 100);
}
