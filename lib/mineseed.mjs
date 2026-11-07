// One-time demo data for the MASTER pages: organisation, fleet, competency, safety records, stock and camp.
// It builds on whatever staff exist, goes through the same checks as the pages, and runs inside update().
import { STAFF_ROLES } from "./auth.mjs";
import { personalOf } from "./personal.mjs";
import { autoBeds, createRecord, ensureMine, operatorProblems } from "./mine.mjs";
import { EQUIP_CERT, crewChange, currentShift, localDay, localInput } from "../public/js/minecore.js";
import { addDays, shiftDateOf } from "../public/js/workstats.js";

export const MINE_SEED_VERSION = 1;
const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

const POSITION_CYCLE = ["operator", "operator", "driver", "mechanic", "operator", "helper", "electrician", "shiftlead", "hse", "blaster", "operator", "driver"];
const OPERATOR_CERTS = ["excavator", "truck", "truck", "dozer", "loader", "drill", "truck", "crane"];

const FLEET = [
  ["EX-01", "excavator", "Komatsu PC2000"],
  ["EX-02", "excavator", "Hitachi EX1200"],
  ["TR-01", "truck", "CAT 777E"],
  ["TR-02", "truck", "CAT 777E"],
  ["TR-03", "truck", "Komatsu HD785"],
  ["TR-04", "truck", "Komatsu HD785"],
  ["TR-05", "truck", "BELAZ 7555"],
  ["DZ-01", "dozer", "CAT D9T"],
  ["LD-01", "loader", "CAT 992K"],
  ["DR-01", "drill", "Epiroc SmartROC D65"],
  ["CR-01", "crane", "Liebherr LTM 1100"],
  ["GR-01", "grader", "CAT 16M"],
  ["LV-01", "lv", "Toyota Land Cruiser 79"],
  ["BUS-01", "bus", "Yutong ZK6122"],
];

const STOCK = [
  ["PPE-HLM", "Хамгаалалтын малгай", "ppe", 34, "ш", 10],
  ["PPE-BTS", "Хамгаалалттай гутал", "ppe", 8, "хос", 10],
  ["PPE-GLV", "Ажлын бээлий", "ppe", 120, "хос", 50],
  ["PPE-VST", "Гэрэл ойлгогч хантааз", "ppe", 40, "ш", 15],
  ["PPE-RSP", "Амьсгал хамгаалагчийн шүүлтүүр", "ppe", 60, "ш", 30],
  ["SP-FLT", "Хөдөлгүүрийн тосны шүүлтүүр", "spare", 14, "ш", 6],
  ["SP-TYR", "Дугуй 27.00R49", "spare", 3, "ш", 4],
  ["SP-HYD", "Гидравлик хоолой", "spare", 22, "ш", 8],
  ["FL-DSL", "Дизель түлш", "fuel", 48000, "л", 20000],
  ["FL-OIL", "Моторын тос 15W-40", "fuel", 1600, "л", 500],
  ["CN-WLD", "Гагнуурын электрод", "consumable", 45, "кг", 20],
];

const TALKS = [
  ["Хүйтний улиралд хүнд техникийн аюулгүй ажиллагаа", "1. Техникээ асаахын өмнө 10 минут халаана.\n2. Мөстсөн замд хурдыг 20 км/ц хүртэл бууруулна.\n3. Кабинаас буухдаа гурван цэгийн тулгуур барина.\n4. Хүйтэнд 30 минут тутамд дулаацах завсарлага авна."],
  ["Явган хүний аюулгүй байдал", "1. Техникийн хөдөлгөөний бүсэд явганаар орохгүй.\n2. Самосвалын харалган бүсийг санаж, жолоочтой нүдээр харилцана.\n3. Гэрэл ойлгогч хантааз заавал өмсөнө."],
  ["Тэсэлгээний өдрийн журам", "1. Тэсэлгээний 30 минутын өмнө аюултай бүсээс гарна.\n2. Дуут дохио, White Queen-ий мэдэгдлийг сонсоно.\n3. «Бүс нээгдлээ» гэсэн мэдэгдэл хүртэл бүсэд орохгүй."],
  ["Эрчим хүч тусгаарлах (LOTO)", "1. Засвар эхлэхээс өмнө бүх эрчим хүчний эх үүсвэрийг тусгаарлана.\n2. Хувийн цоож, шошгоо зүүнэ.\n3. Тусгаарласан эсэхийг асаах оролдлогоор шалгана."],
];

const JSAS = [
  ["Хүнд даацын самосвалын дугуй солих", "Дугуйн засвар", "Техникийг зогсоох | Өнхрөх | Тоормос, дугуйн хаалт, LOTO\nДугуйн даралт гаргах | Тэсрэлт | Хавхлагыг холоос нээх, хажуунаас ажиллах\nДугуйг өргөх | Унах, дарагдах | Дугуйн манипулятор, хүнийг бүсээс гаргах\nШинэ дугуй суулгах | Гар хавчуулах | Бээлий, дохиогоор харилцах", "Малгай, гутал, бээлий, нүдний шил, хантааз"],
  ["Гагнуурын ажил", "Засвар", "Галт ажлын зөвшөөрөл авах | Гал түймэр | Зөвшөөрөл, хийн хэмжилт\nТалбайг цэвэрлэх | Шатамхай материал | 10 м радиуст шатамхай зүйлгүй болгох\nГагнах | Нүд түлэгдэх, утаа | Гагнуурын баг, агааржуулалт\nДуусгах | Нууц гал | 30 минут ажиглах, гал унтраагуур бэлэн", "Гагнуурын баг, арьсан бээлий, гал тэсвэртэй хувцас"],
  ["Тэсэлгээний цооног цэнэглэх", "Тэсэлгээ", "Цооног шалгах | Нуралт | Цооногийн амсар, ус шалгах\nТэсрэх бодис зөөх | Санамсаргүй тэсрэлт | Зөвшөөрөгдсөн машин, зөвхөн тэсэлгээчин\nЦэнэглэх | Статик цахилгаан | Газардуулга, гар утасгүй\nБүсийг хаах | Хүн орох | Харуул, дохио, White Queen мэдэгдэл", "Малгай, антистатик хувцас, бээлий"],
];

const RISKS = [
  ["Самосвал, явган хүний мөргөлдөөн", "Уурхайн зам", 3, 5, "Тусгаарласан явган хүний зам, ухрах дохио, камер", "open"],
  ["Ухалтын хана нурах", "Уурхайн ухалтын хана", 2, 5, "Хананы налууг өдөр бүр шалгах, радарын мониторинг", "controlled"],
  ["Тоосжилт", "Бутлах цех", 4, 2, "Ус шүрших систем, амьсгал хамгаалагч", "controlled"],
  ["Өндрөөс унах", "Конвейерийн галерей", 2, 4, "Хашлага, бэхэлгээний бүс, өндрийн зөвшөөрөл", "controlled"],
  ["Тэсрэх бодисын санамсаргүй тэсрэлт", "Тэсрэх бодисын агуулах", 1, 5, "Хандалтын хяналт, газардуулга, зөвхөн тэсэлгээчин", "controlled"],
  ["Хүйтэнд хөлдөх", "Ил уурхай", 3, 3, "Дулаацах байр, 30 минутын завсарлага, өвлийн хувцас", "open"],
];

const WORK = ["Блок 4-12-оос хүдэр ачиж бутлах цех рүү тээвэрлэв.", "Хөрс хуулалт 1180 горизонтод үргэлжлэв.", "Тэсэлгээний цооног өрөмдлөг 18 цооног.", "Зам засвар, ус шүршилт хийв."];
const ISSUES = ["", "", "TR-03 гидравлик гоожсон, засварт өгсөн.", "Шөнийн 02:00–02:40 цахилгаан тасарсан.", "Салхитай тул кран 1 цаг зогссон."];

/** Seeds once per MINE_SEED_VERSION; returns a summary, or null when it already ran. */
export function seedMine(db, { now = Date.now(), random = Math.random } = {}) {
  if (db.mineSeed?.version >= MINE_SEED_VERSION) return null;
  ensureMine(db);
  const staff = (db.users || []).filter((user) => STAFF_ROLES.includes(user.role));
  const master = (db.users || []).find((user) => user.role === "master");
  const by = master?.id || "seed";
  const today = localDay(now);
  const shiftDate = shiftDateOf(now);
  const shift = currentShift(now);
  const demoIds = new Set(db.demoSeed?.users || []);
  const demo = staff.filter((user) => demoIds.has(user.id));
  const errors = [];
  let count = 0;
  const pick = (list) => list[Math.floor(random() * list.length)];
  const between = (min, max) => min + Math.floor(random() * (max - min + 1));
  const at = (ms) => localInput(ms);
  const add = (name, body, when = now) => {
    const result = createRecord(db, name, body, { by, now: when, quiet: true });
    if (result.error) {
      errors.push(`${name}: ${result.error}`);
      return null;
    }
    count += 1;
    return result.item;
  };

  const depts = ["Уулын ажлын хэсэг", "Механик засварын хэсэг", "ХАБЭА алба", "Тэсэлгээний хэсэг", "Кэмп, логистик"].map((name, index) => add("depts", { name, head: staff[index]?.id || null }));
  const [mining, mech, hseDept, blastDept, campDept] = depts;
  const positions = new Map();
  staff.forEach((user, index) => {
    const position = user.role === "hr" ? "manager" : user.role === "kitchen" ? "helper" : POSITION_CYCLE[index % POSITION_CYCLE.length];
    positions.set(user.id, position);
    const dept = { mechanic: mech, electrician: mech, hse: hseDept, blaster: blastDept, manager: campDept, helper: campDept }[position] || mining;
    add("posts", { uid: user.id, position, dept: dept?.id || null });
  });
  if (master) add("posts", { uid: master.id, position: "master", dept: mining?.id || null });
  const crewNames = ["А бригад", "Б бригад", "В бригад"];
  const crews = crewNames.map((name, index) => {
    const members = staff.filter((_, i) => i % crewNames.length === index).map((user) => user.id);
    return add("crews", { name, dept: mining?.id || null, leader: members[0] || null, members });
  });

  const expiredHse = demo[3] || null;
  const overdueExam = demo[7] || null;
  staff.forEach((user, index) => {
    const position = positions.get(user.id);
    const issued = addDays(today, -between(60, 330));
    const hseExpires = user === expiredHse ? addDays(today, -5) : index === 1 ? addDays(today, 12) : addDays(issued, 365);
    add("certs", { uid: user.id, type: "hse", number: `ХАБ-${2026}-${String(index + 1).padStart(3, "0")}`, issued, expires: hseExpires });
    const extra = [];
    if (position === "operator") extra.push(OPERATOR_CERTS[index % OPERATOR_CERTS.length]);
    if (position === "driver") extra.push("drive_c", "drive_d");
    if (position === "blaster") extra.push("blaster");
    if (position === "electrician" || position === "mechanic") extra.push("electric");
    if (position === "hse") extra.push("firstaid", "height");
    if (index % 2 === 0) extra.push("drive_b");
    for (const type of extra) {
      const expired = type === "truck" && index % 7 === 2;
      add("certs", { uid: user.id, type, number: `${type.toUpperCase().slice(0, 3)}-${between(10000, 99999)}`, issued: addDays(today, -between(100, 900)), expires: expired ? addDays(today, -between(3, 40)) : addDays(today, between(40, 1200)) });
    }
    const examDate = addDays(today, -between(20, 200));
    add("medicals", {
      uid: user.id,
      kind: "periodic",
      date: examDate,
      result: index === 5 ? "restricted" : "fit",
      restrictions: index === 5 ? "Өндөрт ажиллахыг хориглоно" : null,
      next: user === overdueExam ? addDays(today, -3) : addDays(examDate, 365),
    });
  });

  staff.forEach((user, index) => {
    const record = personalOf(db, user.id);
    const has = [today, addDays(today, -1)].some((date) => record.days[date]?.sleep);
    if (has) return;
    const min = index % 9 === 4 ? between(230, 280) : index % 6 === 1 ? between(310, 350) : between(380, 500);
    const end = `0${between(5, 8)}:${String(between(0, 5) * 10).padStart(2, "0")}`.slice(-5);
    const endMin = Number(end.slice(0, 2)) * 60 + Number(end.slice(3));
    const startMin = (endMin - min + 1440) % 1440;
    const start = `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`;
    record.days[today] ||= {};
    record.days[today].sleep = { start, end, min, score: null, source: "demo" };
  });

  const stock = STOCK.map(([code, name, category, qty, unit, min]) => add("stock", { code, name, category, qty, unit, min, place: category === "fuel" ? "Түлшний станц" : "Төв агуулах" }));
  const stockByCode = Object.fromEntries(stock.filter(Boolean).map((item) => [item.code, item]));
  if (stockByCode["FL-DSL"]) add("moves", { stock: stockByCode["FL-DSL"].id, kind: "in", qty: 30000, at: at(now - 2 * DAY_MS), note: "Түлшний автоцистерн №12" });
  if (stockByCode["PPE-GLV"]) add("moves", { stock: stockByCode["PPE-GLV"].id, kind: "out", qty: 20, at: at(now - DAY_MS), note: "А бригадад" });

  const ppeItems = [["helmet", "PPE-HLM", 24], ["boots", "PPE-BTS", 12], ["vest", "PPE-VST", 12]];
  staff.forEach((user) => {
    for (const [item, , life] of ppeItems) add("ppe", { uid: user.id, item, size: item === "boots" ? String(between(39, 45)) : pick(["M", "L", "XL"]), issued: addDays(today, -between(20, 420)), life });
  });

  const fleet = FLEET.map(([code, type, model]) => {
    const hours = between(2500, 26000);
    const every = type === "lv" || type === "bus" ? 500 : 250;
    return add("equipment", { code, type, model, hours, serviceEvery: every, lastService: hours - between(20, every + 40), status: "ready" });
  }).filter(Boolean);
  const byCode = Object.fromEntries(fleet.map((item) => [item.code, item]));

  const mechanics = staff.filter((user) => positions.get(user.id) === "mechanic");
  const orders = [
    ["TR-03", "breakdown", "Гидравлик хоолой гоожсон", "open", 5, null],
    ["EX-02", "planned", "250 цагийн үйлчилгээ", "progress", 3, null],
    ["DZ-01", "breakdown", "Гинжний чангалагч эвдэрсэн", "done", 50, 44],
    ["TR-01", "inspection", "Тоормосны үзлэг", "done", 30, 29],
  ];
  for (const [code, kind, title, status, openedAgo, closedAgo] of orders) {
    if (!byCode[code]) continue;
    const order = add("workorders", { equipment: byCode[code].id, kind, title, description: null, priority: kind === "breakdown" ? "high" : "medium", mechanic: mechanics[0]?.id || null, status });
    if (!order) continue;
    order.opened = new Date(now - openedAgo * HOUR_MS).toISOString();
    order.closed = closedAgo == null ? null : new Date(now - closedAgo * HOUR_MS).toISOString();
  }
  if (byCode["TR-03"]) byCode["TR-03"].status = "down";
  if (byCode["EX-02"]) byCode["EX-02"].status = "service";

  for (const machine of fleet.filter((item) => ["truck", "excavator", "dozer", "loader"].includes(item.type))) {
    for (let back = 4; back >= 0; back -= 1) add("fuel", { equipment: machine.id, at: at(now - back * DAY_MS - between(1, 5) * HOUR_MS), liters: machine.type === "truck" ? between(600, 900) : between(900, 1500), hours: null });
  }

  const production = fleet.filter((item) => item.status === "ready" && !["lv", "bus"].includes(item.type));
  for (let back = 6; back >= 1; back -= 1) {
    const date = addDays(shiftDate, -back);
    for (const kind of ["day", "night"]) {
      const busy = new Set();
      for (const machine of production) {
        const operator = staff.find((user) => !busy.has(user.id) && operatorProblems(db, user.id, machine, date, now).length === 0);
        if (operator && add("assigns", { date, shift: kind, equipment: machine.id, operator: operator.id })) busy.add(operator.id);
      }
    }
  }

  const taken = new Set();
  for (const machine of fleet.filter((item) => item.status === "ready" && EQUIP_CERT[item.type] && !["lv", "bus"].includes(item.type))) {
    const operator = staff.find((user) => !taken.has(user.id) && operatorProblems(db, user.id, machine, shiftDate, now).length === 0);
    if (!operator) continue;
    if (add("assigns", { date: shiftDate, shift, equipment: machine.id, operator: operator.id })) {
      taken.add(operator.id);
      const all = ["brakes", "steering", "lights", "horn", "tyres", "leaks", "seatbelt", "extinguisher", "mirrors", "fluids", "cab"];
      add("prestarts", { equipment: machine.id, operator: operator.id, date: shiftDate, shift, hours: machine.hours, ok: machine.code === "TR-02" ? all.filter((key) => key !== "mirrors") : all, note: machine.code === "TR-02" ? "Баруун толь хагарсан" : null });
    }
  }

  for (let back = 7; back >= 0; back -= 1) {
    const date = addDays(shiftDate, -back);
    for (const kind of ["day", "night"]) {
      const end = Date.parse(`${date}T${kind === "day" ? "18" : "06"}:00:00+08:00`) + (kind === "night" ? DAY_MS : 0);
      if (end > now) continue;
      const crew = crews[(back * 2 + (kind === "night" ? 1 : 0)) % crews.length];
      add("handovers", { date, shift: kind, crew: crew?.id || null, place: pick(["Блок 4-12", "1180 горизонт", "Хойд хана", "Хүдрийн агуулах №2"]), tonnes: between(5200, 6600), work: pick(WORK), issues: pick(ISSUES) || null, next: "Блок 4-13-ын ачилтыг эхлүүлэх." }, end);
    }
  }

  const people = staff.slice(0, 3).map((user) => user.id);
  const nearmiss = add("incidents", { kind: "nearmiss", title: "Самосвал ухрахдаа явган хүнтэй ойртсон", severity: "high", injury: "none", at: at(now - 3 * DAY_MS), place: "Хүдрийн агуулах №2", description: "TR-02 ухрах үед ухрах дохио ажиллаагүй, явган ажилтан 3 метрт ойртсон.", people, status: "investigating", rootCause: "1. Ухрах дохионы реле шатсан.\n2. Pre-start үзлэгт дуут дохиог шалгаагүй.\n3. Явган хүний зам тусгаарлагдаагүй." });
  if (nearmiss) {
    add("capa", { incident: nearmiss.id, action: "Бүх самосвалын ухрах дохиог шалгах", owner: mechanics[0]?.id || null, due: addDays(today, 2), status: "open" });
    add("capa", { incident: nearmiss.id, action: "Агуулахын явган хүний замыг хашлагаар тусгаарлах", owner: staff[0]?.id || null, due: addDays(today, -1), status: "open" });
  }
  const cut = add("incidents", { kind: "incident", title: "Гар зүсэгдсэн (бээлийгүй ажилласан)", severity: "low", injury: "fai", at: at(now - 12 * DAY_MS), place: "Засварын цех", description: "Төмөр хавтан зөөхдөө бээлий өмсөөгүй.", people: people.slice(0, 1), status: "closed", rootCause: "ХХХ-ийн хяналт сул." });
  if (cut) add("capa", { incident: cut.id, action: "Цехэд бээлийн хяналтын хуудас нэвтрүүлэх", owner: staff[1]?.id || null, due: addDays(today, -8), status: "done" });
  add("incidents", { kind: "incident", title: "Шатнаас унаж шагайгаа гэмтээсэн", severity: "medium", injury: "mti", at: at(now - 25 * DAY_MS), place: "Бутлах цех", description: "Мөстсөн шатнаас хальтарсан.", people: people.slice(1, 2), status: "closed", rootCause: "Шатны мөсийг цэвэрлэх хуваарьгүй байсан." });
  add("incidents", { kind: "hazard", title: "Замын хажуугийн хана нурах эрсдэлтэй", severity: "high", injury: "none", at: at(now - 2 * HOUR_MS), place: "Хойд хана, 1200 горизонт", description: "Хананд шинэ ан цав үүссэн.", people: [], status: "open" });
  add("incidents", { kind: "hazard", title: "Цехийн хойд хаалганы гэрэлтүүлэг ажиллахгүй", severity: "low", injury: "none", at: at(now - DAY_MS), place: "Засварын цех", people: [], status: "open" });

  for (let back = 3; back >= 0; back -= 1) {
    const date = addDays(shiftDate, -back);
    for (const kind of ["day", "night"]) {
      const [topic, content] = TALKS[(back * 2 + (kind === "night" ? 1 : 0)) % TALKS.length];
      const talk = add("talks", { date, shift: kind, topic, content, crew: null });
      if (!talk) continue;
      const startMs = Date.parse(`${date}T${kind === "day" ? "06" : "18"}:00:00+08:00`);
      if (startMs > now) continue;
      const audience = staff.filter((user) => (db.shiftPlans?.[user.id] ? true : false)).map((user) => user.id);
      const share = date === shiftDate && kind === shift ? 0.4 : 0.9;
      for (const uid of audience) if (random() < share) talk.acks.push({ uid, at: new Date(startMs + between(-20, 15) * MIN_MS).toISOString(), via: pick(["app", "qr"]) });
    }
  }

  const holder = mechanics[0] || staff[0];
  const second = staff[1] || holder;
  if (holder) {
    const sign = (user) => user?.displayName || "";
    add("permits", { type: "hot", title: "Бункерийн хананд гагнуур хийх", place: "Баяжуулах үйлдвэр, бункер №3", holder: holder.id, members: [second.id], from: at(now - 2 * HOUR_MS), to: at(now + 4 * HOUR_MS), controls: "Шатамхай материал зайлуулсан, гал унтраагуур 2 ширхэг, ажиглагч томилсон.", gas: "O₂ 20.9%, LEL 0%", issuerSign: master?.displayName || "Мастер", holderSign: sign(holder), status: "active" });
    add("permits", { type: "height", title: "Конвейерийн галерейд гэрэлтүүлэг солих", place: "Конвейер C-2", holder: second.id, members: [], from: at(now - HOUR_MS), to: at(now + 5 * HOUR_MS), controls: "Бэхэлгээний бүс, хашлага шалгасан, доод бүсийг хаасан.", issuerSign: master?.displayName || "Мастер", holderSign: sign(second), status: "active" });
    add("permits", { type: "confined", title: "Усны савны дотоод үзлэг", place: "Усан сан №1", holder: holder.id, members: [], from: at(now + DAY_MS), to: at(now + DAY_MS + 6 * HOUR_MS), controls: "Агааржуулалт, хийн тасралтгүй хэмжилт, гадна ажиглагч.", gas: "", status: "requested" });
    add("permits", { type: "loto", title: "Бутлуурын хөтлөгч мотор солих", place: "Бутлах цех", holder: holder.id, members: [], from: at(now - 30 * HOUR_MS), to: at(now - 22 * HOUR_MS), controls: "6 кВ тэжээл тасалсан, газардуулсан.", isolation: "QF-12, цоож №07, №11", issuerSign: master?.displayName || "Мастер", holderSign: sign(holder), status: "closed" }, now - 30 * HOUR_MS);
    add("permits", { type: "hot", title: "Самосвалын тэвшинд гагнуур", place: "Засварын цех", holder: second.id, members: [], from: at(now - 10 * HOUR_MS), to: at(now - HOUR_MS), controls: "Гал унтраагуур, ажиглагч.", gas: "LEL 0%", issuerSign: master?.displayName || "Мастер", holderSign: sign(second), status: "active" }, now - 10 * HOUR_MS);
  }

  for (const [hazard, place, likelihood, severity, controls, status] of RISKS) add("risks", { hazard, place, likelihood, severity, controls, owner: pick(staff)?.id || null, review: addDays(today, between(10, 90)), status });
  for (const [title, job, steps, ppe] of JSAS) add("jsas", { title, job, steps, ppe, template: true });

  const blaster = staff.find((user) => positions.get(user.id) === "blaster");
  let blastAt = Date.parse(`${today}T14:00:00+08:00`);
  if (blastAt - now < 40 * MIN_MS) blastAt += DAY_MS;
  add("blasts", { at: at(blastAt), place: "Блок 4-12, 1180 горизонт", radius: 500, blaster: blaster?.id || null, notes: "64 цооног, ANFO 18 тонн", status: "planned" });
  add("blasts", { at: at(blastAt - DAY_MS - 2 * DAY_MS), place: "Блок 4-11", radius: 500, blaster: blaster?.id || null, notes: "52 цооног", status: "done" }, blastAt - 4 * DAY_MS);

  for (const [name, metric, threshold, action] of [
    ["Хүчтэй салхи · кран", "wind", 15, "Кран, өндөрт ажиллах ажлыг зогсооно."],
    ["Шуурга · бүх гадна ажил", "wind", 20, "Бүх гадна ажлыг зогсоож, техникээ аюулгүй газар байрлуулна."],
    ["Хэт хүйтэн", "cold", -40, "Гадна ажлыг 30 минут тутамд дулаацах завсарлагатай хийнэ."],
    ["Аянга, аадар", "thunder", 0, "Тэсэлгээ, өндөрт ажиллах, кран зогсооно. Хаалттай байранд орно."],
    ["Их хур тунадас", "precip", 2, "Уурхайн замын хурдыг 20 км/ц болгоно."],
  ])
    add("wxRules", { name, metric, threshold, action, enabled: true });

  for (const [name, contract, scope, contact, phone, until, workers, status] of [
    ["Монгол Дриллинг ХХК", "ГЭ-2026/014", "Өрөмдлөгийн үйлчилгээ", "Б. Батболд", "99112233", addDays(today, 240), 18, "active"],
    ["Эрдэнэс Тээвэр ХХК", "ГЭ-2026/021", "Баяжмал тээвэрлэлт", "Д. Энхтуяа", "88004411", addDays(today, 90), 42, "active"],
    ["Говь Кэтеринг ХХК", "ГЭ-2025/107", "Кэмпийн хоол үйлдвэрлэл", "С. Оюун", "95556677", addDays(today, 20), 14, "active"],
    ["Хүдэр Сервис ХХК", "ГЭ-2025/066", "Бутлуурын засвар", "Т. Ганзориг", "99887766", addDays(today, -15), 0, "ended"],
  ])
    add("contractors", { name, contract, scope, contact, phone, until, workers, status });

  const host = master?.id || staff[0]?.id || null;
  const full = ["rules", "emergency", "ppe", "hazards", "traffic"];
  const visitor = add("visitors", { name: "Д. Ганбат", kind: "contractor", company: "Монгол Дриллинг ХХК", host, purpose: "Өрмийн машины засвар", from: today, to: addDays(today, 3), induction: full });
  if (visitor) Object.assign(visitor, { onSite: true, inAt: new Date(now - 3 * HOUR_MS).toISOString() });
  add("visitors", { name: "J. Smith", kind: "visitor", company: "Rio Advisory", host, purpose: "ХАБЭА-ын аудит", from: today, to: addDays(today, 1), induction: full.slice(0, 3) });
  add("visitors", { name: "Б. Сараа", kind: "newhire", company: null, host, purpose: "Лаборант, ажилд орох", from: addDays(today, 1), to: addDays(today, 14), induction: [] });

  for (let number = 1; number <= 8; number += 1) add("rooms", { block: "A", number: `A1${String(number).padStart(2, "0")}`, beds: 4, note: number === 1 ? "Ахлах ажилтнууд" : null });
  for (let number = 1; number <= 6; number += 1) add("rooms", { block: "B", number: `B2${String(number).padStart(2, "0")}`, beds: 2, note: null });
  autoBeds(db, now);

  for (const date of [today, addDays(today, 1)]) {
    const change = crewChange(staff, db.shiftPlans, db.leaves, date);
    if (change.arrive.length) add("transport", { date, dir: "in", vehicle: "bus", ref: "BUS-01", depart: "07:00", route: "Улаанбаатар – Уурхай", extra: [], note: null });
    if (change.depart.length) add("transport", { date, dir: "out", vehicle: "bus", ref: "BUS-01", depart: "19:30", route: "Уурхай – Улаанбаатар", extra: [], note: null });
  }
  add("transport", { date: addDays(today, 1), dir: "out", vehicle: "flight", ref: "OM 202", depart: "11:20", route: "Даланзадгад – Улаанбаатар", extra: staff.slice(0, 2).map((user) => user.id), note: "Удирдлагын томилолт" });

  const onDuty = staff.filter((user) => db.attendance?.people?.[user.id]?.state === "in");
  for (const user of onDuty.length ? onDuty : staff.slice(0, 6)) add("alcohol", { uid: user.id, at: at(now - between(10, 240) * MIN_MS), value: 0, note: "Хаалганы шалгалт" });

  db.mineSeed = { version: MINE_SEED_VERSION, at: new Date(now).toISOString(), records: count, errors: errors.slice(0, 20) };
  return { records: count, errors };
}
