// Mine-site records (safety, competency, operations, camp) shared by the server and the MASTER pages:
// the schema every record is checked against, and the pure arithmetic built on top of it.
import { addDays, isRotation, leaveOn, periodSummary, plannedKind, sessionsOf, shiftDateOf } from "./workstats.js";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TZ_MS = 8 * HOUR_MS;

export const INCIDENT_KINDS = { incident: "Осол", nearmiss: "Ослын дөхөлт", hazard: "Аюулын мэдээлэл" };
export const SEVERITIES = { low: "Бага", medium: "Дунд", high: "Өндөр", critical: "Ноцтой" };
export const INJURIES = { none: "Гэмтэлгүй", fai: "Анхны тусламж (FAI)", mti: "Эмчилгээ (MTI)", rwi: "Хөнгөвчилсөн ажил (RWI)", lti: "Чадвар алдсан (LTI)" };
export const INCIDENT_STATUS = { open: "Нээлттэй", investigating: "Шинжилж байна", closed: "Хаагдсан" };
export const CAPA_STATUS = { open: "Хийгдэж байна", done: "Хийгдсэн" };
export const PERMIT_TYPES = { hot: "Галт ажил", confined: "Битүү орчин", height: "Өндөрт ажиллах", loto: "LOTO · эрчим хүч тусгаарлах" };
export const PERMIT_STATUS = { requested: "Хүсэлт", active: "Идэвхтэй", closed: "Хаагдсан", cancelled: "Цуцлагдсан", expired: "Хугацаа дууссан" };
export const SHIFTS = { day: "Өдөр", night: "Шөнө" };
export const PPE_ITEMS = {
  helmet: "Малгай",
  boots: "Хамгаалалттай гутал",
  gloves: "Бээлий",
  glasses: "Нүдний шил",
  vest: "Гэрэл ойлгогч хантааз",
  respirator: "Амьсгал хамгаалагч",
  earplugs: "Чихэвч",
  harness: "Бэхэлгээний бүс",
  coverall: "Ажлын хувцас",
  winter: "Өвлийн хувцас",
};
export const CERT_TYPES = {
  hse: "ХАБ-ын сургалт",
  drive_b: "Жолооны үнэмлэх B",
  drive_c: "Жолооны үнэмлэх C",
  drive_d: "Жолооны үнэмлэх D",
  excavator: "Экскаваторын оператор",
  truck: "Хүнд даацын самосвал",
  dozer: "Бульдозер, грейдер",
  loader: "Ачигчийн оператор",
  drill: "Өрмийн машин",
  crane: "Краны оператор",
  blaster: "Тэсэлгээчин",
  height: "Өндөрт ажиллах",
  confined: "Битүү орчинд ажиллах",
  electric: "Цахилгааны эрх",
  firstaid: "Анхны тусламж",
};
export const MEDICAL_KINDS = { pre: "Ажилд орохын өмнөх", periodic: "Үечилсэн", return: "Ажилд эргэн орох" };
export const MEDICAL_RESULTS = { fit: "Тэнцсэн", restricted: "Хязгаарлалттай", unfit: "Тэнцээгүй" };
export const VISITOR_KINDS = { visitor: "Зочин", contractor: "Гэрээт ажилтан", newhire: "Шинэ ажилтан" };
export const INDUCTION_ITEMS = {
  rules: "Уурхайн дүрэм журам",
  emergency: "Онцгой үеийн дохио, цуглах цэг",
  ppe: "ХХХ-ийн шаардлага",
  hazards: "Талбайн аюул, хориотой бүс",
  traffic: "Тээврийн хөдөлгөөний дүрэм",
};
export const EQUIP_TYPES = { excavator: "Экскаватор", truck: "Самосвал", dozer: "Бульдозер", loader: "Ачигч", drill: "Өрмийн машин", crane: "Кран", grader: "Грейдер", lv: "Суудлын машин", bus: "Автобус" };
/** The licence an operator needs for each kind of machine. */
export const EQUIP_CERT = { excavator: "excavator", truck: "truck", dozer: "dozer", loader: "loader", drill: "drill", crane: "crane", grader: "dozer", lv: "drive_b", bus: "drive_d" };
export const EQUIP_STATUS = { ready: "Бэлэн", running: "Ажиллаж байна", down: "Эвдэрсэн", service: "Засварт" };
export const WO_KINDS = { breakdown: "Эвдрэл", planned: "Төлөвлөгөөт засвар", inspection: "Үзлэг" };
export const WO_STATUS = { open: "Нээлттэй", progress: "Хийгдэж байна", done: "Дууссан" };
export const PRIORITIES = { low: "Бага", medium: "Дунд", high: "Яаралтай" };
export const STOCK_CATS = { spare: "Сэлбэг", ppe: "ХХХ", fuel: "Шатахуун, тос", consumable: "Хэрэглээний материал" };
export const MOVE_KINDS = { in: "Орлого", out: "Зарлага" };
export const POSITIONS = {
  master: "Мастер",
  shiftlead: "Ээлжийн ахлагч",
  hse: "ХАБ-ын инженер",
  mechanic: "Механик",
  manager: "Удирдлага",
  operator: "Оператор",
  driver: "Жолооч",
  blaster: "Тэсэлгээчин",
  electrician: "Цахилгаанчин",
  helper: "Туслах ажилтан",
};
export const WX_METRICS = {
  wind: { label: "Салхи", unit: "м/с", op: "gte", margin: 1 },
  cold: { label: "Мэдрэгдэх хүйтэн", unit: "°C", op: "lte", margin: 1 },
  heat: { label: "Халуун", unit: "°C", op: "gte", margin: 1 },
  thunder: { label: "Аянга, аадар", unit: "", op: "flag", margin: 0 },
  precip: { label: "Хур тунадас", unit: "мм/15 мин", op: "gte", margin: 0 },
};
export const WX_METRIC_LABELS = Object.fromEntries(Object.entries(WX_METRICS).map(([key, item]) => [key, item.label]));
export const BLAST_STATUS = { planned: "Төлөвлөсөн", done: "Хийгдсэн", cancelled: "Цуцалсан" };
/** Minutes before a blast when the station and phones warn; the smallest passed mark wins if several are due. */
export const BLAST_WARN_MIN = [30, 15, 5, 1];
export const BLAST_CLEAR_MIN = 15;
export const TRANSPORT_DIR = { in: "Ирэх", out: "Буцах" };
export const VEHICLES = { bus: "Автобус", flight: "Нислэг", car: "Суудлын машин" };
export const RISK_STATUS = { open: "Хяналт шаардлагатай", controlled: "Хяналтад" };
export const CONTRACT_STATUS = { active: "Идэвхтэй", ended: "Дууссан" };
export const CAMERA_ZONES = { gate: "Хаалга, КПП", dorm: "Байр", canteen: "Хоолны танхим", parking: "Зогсоол", perimeter: "Хашаа", store: "Агуулах", office: "Оффис" };
export const CAMERA_KINDS = {
  demo: "Туршилтын (симуляц)",
  device: "Энэ төхөөрөмжийн камер",
  mjpeg: "MJPEG урсгал",
  snapshot: "Зураг (snapshot)",
  video: "Видео (HLS / MP4)",
  embed: "Вэб хуудас (iframe)",
};
/** Camera kinds that play from an address; the browser reaches it directly, so it must be http(s). */
export const CAMERA_URL_KINDS = ["mjpeg", "snapshot", "video", "embed"];
export const SOS_KINDS = { sos: "SOS товч", lone: "Ганцаар ажиллагч хариу өгөөгүй" };
export const SOS_STATUS = { open: "Шинэ", ack: "Хүлээн авсан", resolved: "Шийдвэрлэсэн", cancelled: "Цуцалсан" };
/** Pre-start checklist: key, label, and whether a failure takes the machine out of service. */
export const PRESTART_ITEMS = [
  ["brakes", "Тоормос", true],
  ["steering", "Жолоодлого", true],
  ["lights", "Гэрэл, дохио", true],
  ["horn", "Дуут дохио, ухрах дохио", true],
  ["tyres", "Дугуй, гинж", true],
  ["leaks", "Тос, түлш гоожоогүй", true],
  ["seatbelt", "Хамгаалах бүс", true],
  ["extinguisher", "Гал унтраагуур", true],
  ["mirrors", "Толь, камер", false],
  ["fluids", "Тос, хөргөлтийн түвшин", false],
  ["cab", "Кабины цэвэрлэгээ", false],
];
export const PRESTART_LABELS = Object.fromEntries(PRESTART_ITEMS.map(([key, label]) => [key, label]));
export const CRITICAL_ITEMS = PRESTART_ITEMS.filter((item) => item[2]).map(([key]) => key);

/** Zero tolerance: any reading above this (‰) fails the breath test. */
export const ALCOHOL_LIMIT = 0;
export const CERT_SOON_DAYS = 30;
export const DEFAULT_RULES = { enforce: true, required: ["hse"], medical: true, alcoholHours: 24 };

const f = (key, label, type, extra = {}) => ({ key, label, type, ...extra });

/**
 * Every record type: the top-level area it is stored under, its id prefix, how many are kept, and its fields.
 * Field types: text, long, number, date, datetime, time, select, user, users, ref, bool, checks, photo, geo.
 * `list` puts a field in the table, `def` is the form default, `show` limits a field to some values of another.
 */
export const COLLECTIONS = {
  incidents: {
    area: "hse",
    prefix: "inc",
    keep: 300,
    label: "Осол, ослын дөхөлт, аюул",
    fields: [
      f("kind", "Төрөл", "select", { options: INCIDENT_KINDS, required: true, list: true, def: "nearmiss" }),
      f("title", "Гарчиг", "text", { max: 80, required: true, list: true }),
      f("severity", "Ноцтой байдал", "select", { options: SEVERITIES, required: true, list: true, def: "medium" }),
      f("injury", "Гэмтэл", "select", { options: INJURIES, list: true, def: "none" }),
      f("at", "Хэзээ", "datetime", { required: true, list: true, def: "now" }),
      f("place", "Байршил, хэсэг", "text", { max: 80, list: true }),
      f("geo", "GPS байршил", "geo"),
      f("description", "Юу болсон", "long", { max: 1000 }),
      f("people", "Холбогдох хүмүүс", "users"),
      f("photo", "Зураг", "photo"),
      f("status", "Төлөв", "select", { options: INCIDENT_STATUS, list: true, def: "open" }),
      f("rootCause", "Шалтгааны шинжилгээ (5 яагаад)", "long", { max: 1500 }),
    ],
  },
  capa: {
    area: "hse",
    prefix: "capa",
    keep: 500,
    label: "Засах арга хэмжээ (CAPA)",
    fields: [
      f("incident", "Осол, аюул", "ref", { ref: "incidents", required: true, list: true }),
      f("action", "Арга хэмжээ", "text", { max: 160, required: true, list: true }),
      f("owner", "Хариуцагч", "user", { list: true }),
      f("due", "Дуусах хугацаа", "date", { list: true }),
      f("status", "Төлөв", "select", { options: CAPA_STATUS, list: true, def: "open" }),
    ],
  },
  talks: {
    area: "hse",
    prefix: "tbt",
    keep: 200,
    label: "Ээлжийн өмнөх зааварчилгаа",
    fields: [
      f("date", "Огноо", "date", { required: true, list: true, def: "shiftdate" }),
      f("shift", "Ээлж", "select", { options: SHIFTS, required: true, list: true, def: "current" }),
      f("topic", "Сэдэв", "text", { max: 100, required: true, list: true }),
      f("crew", "Бригад", "ref", { ref: "crews", list: true }),
      f("content", "Агуулга", "long", { max: 1500, required: true }),
    ],
  },
  permits: {
    area: "hse",
    prefix: "ptw",
    keep: 300,
    label: "Ажлын зөвшөөрөл",
    fields: [
      f("type", "Төрөл", "select", { options: PERMIT_TYPES, required: true, list: true }),
      f("title", "Ажлын тодорхойлолт", "text", { max: 100, required: true, list: true }),
      f("place", "Байршил", "text", { max: 80, list: true }),
      f("holder", "Зөвшөөрөл эзэмшигч", "user", { required: true, list: true }),
      f("members", "Ажиллах хүмүүс", "users"),
      f("from", "Эхлэх", "datetime", { required: true, list: true, def: "now" }),
      f("to", "Дуусах", "datetime", { required: true, list: true, def: "now+8h" }),
      f("controls", "Аюул, хяналтын арга хэмжээ", "long", { max: 800, required: true }),
      f("gas", "Хийн хэмжилт (O₂, CO, H₂S, LEL)", "text", { max: 120, show: { type: ["confined", "hot"] } }),
      f("isolation", "Тусгаарласан цэг, цоожны дугаар", "long", { max: 500, show: { type: ["loto"] } }),
      f("issuerSign", "Олгогчийн гарын үсэг (овог нэр)", "text", { max: 60 }),
      f("holderSign", "Хүлээн авагчийн гарын үсэг (овог нэр)", "text", { max: 60 }),
      f("status", "Төлөв", "select", { options: { requested: "Хүсэлт", active: "Идэвхтэй", closed: "Хаагдсан", cancelled: "Цуцлагдсан" }, list: true, def: "requested" }),
    ],
  },
  risks: {
    area: "hse",
    prefix: "rsk",
    keep: 300,
    label: "Эрсдэлийн бүртгэл",
    fields: [
      f("hazard", "Аюул", "text", { max: 120, required: true, list: true }),
      f("place", "Ажлын байр", "text", { max: 80, list: true }),
      f("likelihood", "Магадлал (1–5)", "number", { min: 1, max: 5, step: 1, required: true, list: true, def: 3 }),
      f("severity", "Үр дагавар (1–5)", "number", { min: 1, max: 5, step: 1, required: true, list: true, def: 3 }),
      f("controls", "Хяналтын арга хэмжээ", "long", { max: 800 }),
      f("owner", "Хариуцагч", "user", { list: true }),
      f("review", "Дахин хянах", "date", { list: true }),
      f("status", "Төлөв", "select", { options: RISK_STATUS, list: true, def: "open" }),
    ],
  },
  jsas: {
    area: "hse",
    prefix: "jsa",
    keep: 200,
    label: "JSA / JHA",
    fields: [
      f("title", "Нэр", "text", { max: 100, required: true, list: true }),
      f("job", "Ажил", "text", { max: 120, list: true }),
      f("steps", "Алхам | Аюул | Хяналт", "long", { max: 2000, required: true }),
      f("ppe", "Шаардлагатай ХХХ", "text", { max: 160, list: true }),
      f("template", "Загвар", "bool", { list: true }),
    ],
  },
  alcohol: {
    area: "hse",
    prefix: "alc",
    keep: 1500,
    label: "Согтууруулах ундааны шалгалт",
    fields: [
      f("uid", "Ажилтан", "user", { required: true, list: true }),
      f("at", "Хэзээ", "datetime", { required: true, list: true, def: "now" }),
      f("value", "Үр дүн (‰)", "number", { min: 0, max: 5, step: 0.01, required: true, list: true, def: 0 }),
      f("note", "Тэмдэглэл", "text", { max: 120, list: true }),
    ],
  },
  ppe: {
    area: "hse",
    prefix: "ppe",
    keep: 1500,
    label: "Хувийн хамгаалах хэрэгсэл",
    fields: [
      f("uid", "Ажилтан", "user", { required: true, list: true }),
      f("item", "Хэрэгсэл", "select", { options: PPE_ITEMS, required: true, list: true }),
      f("size", "Хэмжээ", "text", { max: 12, list: true }),
      f("issued", "Олгосон", "date", { required: true, list: true, def: "today" }),
      f("life", "Ашиглах хугацаа (сар)", "number", { min: 1, max: 60, step: 1, required: true, list: true, def: 12 }),
      f("stock", "Агуулахаас хасах", "ref", { ref: "stock" }),
    ],
  },
  blasts: {
    area: "hse",
    prefix: "bl",
    keep: 200,
    label: "Тэсэлгээ",
    fields: [
      f("at", "Тэсэлгээний цаг", "datetime", { required: true, list: true, def: "now+1h" }),
      f("place", "Блок, байршил", "text", { max: 80, required: true, list: true }),
      f("radius", "Аюултай бүс (м)", "number", { min: 50, max: 3000, step: 10, required: true, list: true, def: 500 }),
      f("blaster", "Тэсэлгээчин", "user", { list: true }),
      f("notes", "Тэмдэглэл", "text", { max: 200 }),
      f("status", "Төлөв", "select", { options: BLAST_STATUS, list: true, def: "planned" }),
    ],
  },
  wxRules: {
    area: "hse",
    prefix: "wxr",
    keep: 40,
    label: "Цаг агаарын босго",
    fields: [
      f("name", "Нэр", "text", { max: 60, required: true, list: true }),
      f("metric", "Хэмжигдэхүүн", "select", { options: WX_METRIC_LABELS, required: true, list: true }),
      f("threshold", "Босго", "number", { min: -70, max: 70, step: 0.1, list: true, def: 15 }),
      f("action", "Авах арга хэмжээ", "text", { max: 160, required: true, list: true }),
      f("enabled", "Идэвхтэй", "bool", { list: true, def: true }),
    ],
  },
  certs: {
    area: "skills",
    prefix: "crt",
    keep: 3000,
    label: "Гэрчилгээ, үнэмлэх",
    fields: [
      f("uid", "Ажилтан", "user", { required: true, list: true }),
      f("type", "Төрөл", "select", { options: CERT_TYPES, required: true, list: true }),
      f("number", "Дугаар", "text", { max: 30, list: true }),
      f("issued", "Олгосон", "date", { list: true }),
      f("expires", "Дуусах", "date", { required: true, list: true }),
    ],
  },
  medicals: {
    area: "skills",
    prefix: "med",
    keep: 2000,
    label: "Эрүүл мэндийн үзлэг",
    fields: [
      f("uid", "Ажилтан", "user", { required: true, list: true }),
      f("kind", "Үзлэг", "select", { options: MEDICAL_KINDS, required: true, list: true, def: "periodic" }),
      f("date", "Огноо", "date", { required: true, list: true, def: "today" }),
      f("result", "Дүгнэлт", "select", { options: MEDICAL_RESULTS, required: true, list: true, def: "fit" }),
      f("restrictions", "Хязгаарлалт", "text", { max: 160, list: true }),
      f("next", "Дараагийн үзлэг", "date", { required: true, list: true }),
    ],
  },
  visitors: {
    area: "skills",
    prefix: "vis",
    keep: 500,
    label: "Танилцуулга, түр нэвтрэх",
    fields: [
      f("name", "Овог нэр", "text", { max: 60, required: true, list: true }),
      f("kind", "Төрөл", "select", { options: VISITOR_KINDS, required: true, list: true, def: "visitor" }),
      f("company", "Байгууллага", "text", { max: 60, list: true }),
      f("host", "Хүлээн авагч", "user", { list: true }),
      f("purpose", "Зорилго", "text", { max: 120 }),
      f("from", "Эхлэх", "date", { required: true, list: true, def: "today" }),
      f("to", "Дуусах", "date", { required: true, list: true, def: "today" }),
      f("induction", "Танилцуулга сургалт", "checks", { options: INDUCTION_ITEMS, list: true }),
    ],
  },
  depts: {
    area: "ops",
    prefix: "dep",
    keep: 60,
    label: "Хэлтэс, хэсэг",
    fields: [f("name", "Нэр", "text", { max: 60, required: true, list: true, unique: true }), f("head", "Дарга", "user", { list: true })],
  },
  crews: {
    area: "ops",
    prefix: "crw",
    keep: 100,
    label: "Бригад",
    fields: [
      f("name", "Нэр", "text", { max: 60, required: true, list: true, unique: true }),
      f("dept", "Хэлтэс", "ref", { ref: "depts", list: true }),
      f("leader", "Ахлагч", "user", { list: true }),
      f("members", "Гишүүд", "users", { list: true }),
    ],
  },
  posts: {
    area: "ops",
    prefix: "pos",
    keep: 2000,
    label: "Албан тушаал",
    fields: [
      f("uid", "Ажилтан", "user", { required: true, list: true, unique: true }),
      f("position", "Уурхайн албан тушаал", "select", { options: POSITIONS, required: true, list: true }),
      f("dept", "Хэлтэс", "ref", { ref: "depts", list: true }),
    ],
  },
  equipment: {
    area: "ops",
    prefix: "eq",
    keep: 300,
    label: "Техник",
    fields: [
      f("code", "Код", "text", { max: 16, required: true, list: true, unique: true }),
      f("type", "Төрөл", "select", { options: EQUIP_TYPES, required: true, list: true }),
      f("model", "Загвар", "text", { max: 40, list: true }),
      f("hours", "Мото цаг", "number", { min: 0, max: 300000, step: 1, list: true, def: 0 }),
      f("serviceEvery", "Засварын давтамж (мото цаг)", "number", { min: 50, max: 5000, step: 1, def: 250 }),
      f("lastService", "Сүүлийн засвар (мото цаг)", "number", { min: 0, max: 300000, step: 1, def: 0 }),
      f("status", "Төлөв", "select", { options: EQUIP_STATUS, list: true, def: "ready" }),
    ],
  },
  assigns: {
    area: "ops",
    prefix: "asg",
    keep: 2000,
    label: "Техникийн хуваарилалт",
    fields: [
      f("date", "Огноо", "date", { required: true, list: true, def: "shiftdate" }),
      f("shift", "Ээлж", "select", { options: SHIFTS, required: true, list: true, def: "current" }),
      f("equipment", "Техник", "ref", { ref: "equipment", required: true, list: true }),
      f("operator", "Оператор", "user", { required: true, list: true }),
    ],
  },
  prestarts: {
    area: "ops",
    prefix: "pre",
    keep: 2000,
    label: "Ажлын өмнөх үзлэг (pre-start)",
    fields: [
      f("equipment", "Техник", "ref", { ref: "equipment", required: true, list: true }),
      f("operator", "Оператор", "user", { required: true, list: true }),
      f("date", "Огноо", "date", { required: true, list: true, def: "shiftdate" }),
      f("shift", "Ээлж", "select", { options: SHIFTS, required: true, list: true, def: "current" }),
      f("hours", "Мото цаг", "number", { min: 0, max: 300000, step: 1, list: true }),
      f("ok", "Хэвийн зүйлс", "checks", { options: PRESTART_LABELS, def: "all" }),
      f("note", "Тэмдэглэл", "text", { max: 200, list: true }),
    ],
  },
  workorders: {
    area: "ops",
    prefix: "wo",
    keep: 600,
    label: "Засварын ажлын захиалга",
    fields: [
      f("equipment", "Техник", "ref", { ref: "equipment", required: true, list: true }),
      f("kind", "Төрөл", "select", { options: WO_KINDS, required: true, list: true, def: "breakdown" }),
      f("title", "Гарчиг", "text", { max: 100, required: true, list: true }),
      f("description", "Тайлбар", "long", { max: 800 }),
      f("priority", "Яаралтай эсэх", "select", { options: PRIORITIES, list: true, def: "medium" }),
      f("mechanic", "Механик", "user", { list: true }),
      f("status", "Төлөв", "select", { options: WO_STATUS, list: true, def: "open" }),
    ],
  },
  fuel: {
    area: "ops",
    prefix: "fl",
    keep: 3000,
    label: "Түлш",
    fields: [
      f("equipment", "Техник", "ref", { ref: "equipment", required: true, list: true }),
      f("at", "Хэзээ", "datetime", { required: true, list: true, def: "now" }),
      f("liters", "Литр", "number", { min: 1, max: 5000, step: 1, required: true, list: true }),
      f("hours", "Мото цаг", "number", { min: 0, max: 300000, step: 1, list: true }),
    ],
  },
  stock: {
    area: "ops",
    prefix: "stk",
    keep: 500,
    label: "Агуулах",
    fields: [
      f("code", "Код", "text", { max: 20, required: true, list: true, unique: true }),
      f("name", "Нэр", "text", { max: 60, required: true, list: true }),
      f("category", "Ангилал", "select", { options: STOCK_CATS, required: true, list: true }),
      f("qty", "Үлдэгдэл", "number", { min: 0, max: 1000000, step: 0.01, required: true, list: true, def: 0 }),
      f("unit", "Нэгж", "text", { max: 10, list: true, def: "ш" }),
      f("min", "Доод үлдэгдэл", "number", { min: 0, max: 1000000, step: 0.01, list: true, def: 0 }),
      f("place", "Байршил", "text", { max: 40 }),
    ],
  },
  moves: {
    area: "ops",
    prefix: "mv",
    keep: 3000,
    immutable: true,
    label: "Агуулахын орлого, зарлага",
    fields: [
      f("stock", "Бараа", "ref", { ref: "stock", required: true, list: true }),
      f("kind", "Төрөл", "select", { options: MOVE_KINDS, required: true, list: true, def: "out" }),
      f("qty", "Тоо хэмжээ", "number", { min: 0.01, max: 1000000, step: 0.01, required: true, list: true }),
      f("at", "Хэзээ", "datetime", { required: true, list: true, def: "now" }),
      f("note", "Тэмдэглэл", "text", { max: 120, list: true }),
    ],
  },
  handovers: {
    area: "ops",
    prefix: "ho",
    keep: 600,
    label: "Ээлж хүлээлцэх тайлан",
    fields: [
      f("date", "Огноо", "date", { required: true, list: true, def: "shiftdate" }),
      f("shift", "Ээлж", "select", { options: SHIFTS, required: true, list: true, def: "current" }),
      f("crew", "Бригад", "ref", { ref: "crews", list: true }),
      f("place", "Хэсэг, блок", "text", { max: 80, list: true }),
      f("tonnes", "Олборлолт (тонн)", "number", { min: 0, max: 1000000, step: 1, list: true, def: 0 }),
      f("work", "Хийсэн ажил", "long", { max: 1000, required: true }),
      f("issues", "Гарсан асуудал", "long", { max: 800 }),
      f("next", "Дараагийн ээлжид", "long", { max: 800 }),
    ],
  },
  rooms: {
    area: "camp",
    prefix: "rm",
    keep: 500,
    label: "Кэмпийн өрөө",
    fields: [
      f("block", "Байр", "text", { max: 20, required: true, list: true }),
      f("number", "Өрөө", "text", { max: 10, required: true, list: true }),
      f("beds", "Ор", "number", { min: 1, max: 12, step: 1, required: true, list: true, def: 4 }),
      f("note", "Тэмдэглэл", "text", { max: 80, list: true }),
    ],
  },
  transport: {
    area: "camp",
    prefix: "tr",
    keep: 400,
    label: "Ээлжийн тээвэр",
    fields: [
      f("date", "Огноо", "date", { required: true, list: true, def: "today" }),
      f("dir", "Чиглэл", "select", { options: TRANSPORT_DIR, required: true, list: true, def: "in" }),
      f("vehicle", "Тээвэр", "select", { options: VEHICLES, list: true, def: "bus" }),
      f("ref", "Дугаар, нислэг", "text", { max: 30, list: true }),
      f("depart", "Хөдлөх цаг", "time", { list: true }),
      f("route", "Маршрут", "text", { max: 80, list: true }),
      f("extra", "Нэмэлт зорчигч", "users"),
      f("note", "Тэмдэглэл", "text", { max: 120 }),
    ],
  },
  contractors: {
    area: "camp",
    prefix: "ctr",
    keep: 200,
    label: "Гэрээт гүйцэтгэгч",
    fields: [
      f("name", "Компани", "text", { max: 80, required: true, list: true, unique: true }),
      f("contract", "Гэрээний №", "text", { max: 30, list: true }),
      f("scope", "Ажлын хамрах хүрээ", "text", { max: 120, list: true }),
      f("contact", "Холбоо барих хүн", "text", { max: 60, list: true }),
      f("phone", "Утас", "text", { max: 20, list: true }),
      f("until", "Гэрээ дуусах", "date", { list: true }),
      f("workers", "Ажилчдын тоо", "number", { min: 0, max: 5000, step: 1, list: true }),
      f("status", "Төлөв", "select", { options: CONTRACT_STATUS, list: true, def: "active" }),
    ],
  },
  cameras: {
    area: "camp",
    prefix: "cam",
    keep: 64,
    label: "Камер",
    fields: [
      f("name", "Нэр", "text", { max: 40, required: true, list: true, unique: true }),
      f("zone", "Байршил", "select", { options: CAMERA_ZONES, required: true, list: true, def: "gate" }),
      f("kind", "Холболт", "select", { options: CAMERA_KINDS, required: true, list: true, def: "demo" }),
      f("url", "Урсгалын хаяг (https://…)", "url", { max: 500, show: { kind: CAMERA_URL_KINDS } }),
      f("every", "Шинэчлэх (сек)", "number", { min: 1, max: 60, step: 1, def: 2, show: { kind: ["snapshot"] } }),
      f("enabled", "Идэвхтэй", "bool", { list: true, def: true }),
      f("note", "Тэмдэглэл", "text", { max: 80 }),
    ],
  },
};

export const AREAS = ["hse", "skills", "ops", "camp"];

export function collectionsOf(area) {
  return Object.keys(COLLECTIONS).filter((name) => COLLECTIONS[name].area === area);
}

/** Local (UTC+8) wall-clock "YYYY-MM-DDTHH:MM" for a moment. */
export function localInput(ms) {
  return new Date(ms + TZ_MS).toISOString().slice(0, 16);
}

export function localDay(ms) {
  return localInput(ms).slice(0, 10);
}

export function currentShift(now) {
  const hour = new Date(now + TZ_MS).getUTCHours();
  return hour >= 6 && hour < 18 ? "day" : "night";
}

export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export function addMonths(date, months) {
  const [year, month, day] = date.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end.toISOString().slice(0, 10);
}

const TIMED_DEFAULTS = new Set(["now", "now+1h", "now+8h", "today", "shiftdate", "current", "all"]);

/** The value a fresh form starts with. */
export function defaultValue(field, now) {
  const def = field.def;
  if (def === "now") return localInput(now);
  if (def === "now+1h") return localInput(now + HOUR_MS);
  if (def === "now+8h") return localInput(now + 8 * HOUR_MS);
  if (def === "today") return localDay(now);
  if (def === "shiftdate") return shiftDateOf(now);
  if (def === "current") return currentShift(now);
  if (def === "all") return Object.keys(field.options || {});
  if (def !== undefined) return def;
  if (field.type === "users" || field.type === "checks") return [];
  if (field.type === "bool") return false;
  return "";
}

export function fieldShown(field, values) {
  if (!field.show) return true;
  return Object.entries(field.show).every(([key, allowed]) => allowed.includes(values[key]));
}

const PLAIN = /[<>]/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(value) {
  const text = String(value ?? "");
  if (!DAY.test(text)) return false;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(text);
}

/** A local "YYYY-MM-DDTHH:MM" (or full ISO) moment as an ISO string, or null. */
export function parseMoment(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) ? Date.parse(`${text}:00+08:00`) : Date.parse(text);
  return Number.isFinite(ms) && ms > Date.parse("2000-01-01") && ms < Date.parse("2100-01-01") ? new Date(ms).toISOString() : null;
}

function cleanField(field, raw, ctx) {
  const empty = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && !raw.length);
  const fail = (text) => ({ error: `${field.label}: ${text}` });
  if (field.type === "bool") return { value: raw === true || raw === "on" || raw === "true" || raw === 1 };
  if (field.type === "geo") {
    if (empty) return { value: null };
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail("координат буруу");
    return { value: { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } };
  }
  if (empty) return field.required ? fail("заавал бөглөнө") : { value: field.type === "users" || field.type === "checks" ? [] : null };
  switch (field.type) {
    case "text": {
      const text = String(raw).replace(/\s+/g, " ").trim();
      if (!text) return field.required ? fail("заавал бөглөнө") : { value: null };
      if (text.length > field.max || PLAIN.test(text) || CONTROL.test(text)) return fail(`${field.max}-аас ихгүй тэмдэгт, < > тэмдэггүй`);
      return { value: text };
    }
    case "long": {
      const text = String(raw).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      if (!text) return field.required ? fail("заавал бөглөнө") : { value: null };
      if (text.length > field.max || PLAIN.test(text) || CONTROL.test(text)) return fail(`${field.max}-аас ихгүй тэмдэгт, < > тэмдэггүй`);
      return { value: text };
    }
    case "number": {
      const number = Number(raw);
      if (!Number.isFinite(number) || number < field.min || number > field.max) return fail(`${field.min}–${field.max} хооронд тоо`);
      const step = field.step || 1;
      const value = step >= 1 ? Math.round(number) : Math.round(number * 100) / 100;
      return { value };
    }
    case "date":
      return isDate(raw) ? { value: String(raw) } : fail("огноо буруу");
    case "datetime": {
      const value = parseMoment(raw);
      return value ? { value } : fail("огноо, цаг буруу");
    }
    case "time":
      return CLOCK.test(String(raw)) ? { value: String(raw) } : fail("ЦЦ:ММ хэлбэртэй");
    case "url": {
      const text = String(raw).trim();
      let url = null;
      try {
        url = new URL(text);
      } catch {
        /* reported below */
      }
      if (!url || !["http:", "https:"].includes(url.protocol) || text.length > field.max || /\s/.test(text)) return fail("http:// эсвэл https://-ээр эхэлсэн хаяг");
      return { value: url.href };
    }
    case "select":
      return Object.hasOwn(field.options, raw) ? { value: String(raw) } : fail("сонголт буруу");
    case "user":
      return ctx.user(String(raw)) ? { value: String(raw) } : fail("ажилтан олдсонгүй");
    case "users": {
      const list = [...new Set((Array.isArray(raw) ? raw : [raw]).map(String))];
      if (list.length > 80 || !list.every((uid) => ctx.user(uid))) return fail("ажилтан олдсонгүй");
      return { value: list };
    }
    case "ref":
      return ctx.ref(field.ref, String(raw)) ? { value: String(raw) } : fail("олдсонгүй");
    case "checks": {
      const list = [...new Set((Array.isArray(raw) ? raw : [raw]).map(String))];
      if (!list.every((key) => Object.hasOwn(field.options, key))) return fail("сонголт буруу");
      return { value: list };
    }
    case "photo": {
      const text = String(raw);
      if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(text)) return fail("зургийн формат буруу");
      if (text.length > 450_000) return fail("зураг хэт том");
      return { value: text };
    }
    default:
      return fail("төрөл буруу");
  }
}

/**
 * Checks a submitted record against its schema. `ctx.user(uid)` and `ctx.ref(collection, id)` say whether a
 * referenced person or record exists; `ctx.others` are the other records of the same type for unique fields.
 * Fields hidden by `show` are cleared, and a field left out of the body takes its fixed default (not a
 * time-based one). Returns { record } with only schema fields, or { error }.
 */
export function cleanRecord(name, body, ctx) {
  const schema = COLLECTIONS[name];
  if (!schema) return { error: "Бүртгэлийн төрөл буруу" };
  const record = {};
  for (const field of schema.fields) {
    const missing = body?.[field.key] === undefined && field.def !== undefined && !TIMED_DEFAULTS.has(field.def);
    const result = cleanField(field, missing ? field.def : body?.[field.key], ctx);
    if (result.error) return result;
    record[field.key] = result.value;
  }
  for (const field of schema.fields) if (!fieldShown(field, record)) record[field.key] = field.type === "users" || field.type === "checks" ? [] : null;
  for (const field of schema.fields.filter((item) => item.unique)) {
    const value = String(record[field.key] ?? "").toLowerCase();
    if (value && (ctx.others || []).some((item) => String(item[field.key] ?? "").toLowerCase() === value)) return { error: `${field.label}: «${record[field.key]}» бүртгэлтэй байна` };
  }
  return { record };
}

/** Valid, soon to expire, or expired, against a calendar date. */
export function expiryState(expires, today, soonDays = CERT_SOON_DAYS) {
  if (!expires) return { state: "none", days: null };
  const days = daysBetween(today, expires);
  return { state: days < 0 ? "expired" : days <= soonDays ? "soon" : "valid", days };
}

export function validCert(certs, uid, type, today) {
  return (certs || []).some((item) => item.uid === uid && item.type === type && item.expires >= today);
}

export function latestMedical(medicals, uid) {
  return (medicals || []).filter((item) => item.uid === uid).sort((a, b) => b.date.localeCompare(a.date) || (b.at || "").localeCompare(a.at || ""))[0] || null;
}

export function lastAlcoholFail(alcohol, uid, now, hours) {
  return (
    (alcohol || [])
      .filter((item) => item.uid === uid && item.value > ALCOHOL_LIMIT && now - Date.parse(item.at) < hours * HOUR_MS && Date.parse(item.at) <= now)
      .sort((a, b) => b.at.localeCompare(a.at))[0] || null
  );
}

/** Why a person's card must not open the gate: required training, medical fitness, a failed breath test. */
export function holdReasons({ uid, certs, medicals, alcohol, rules = DEFAULT_RULES, today, now }) {
  const reasons = [];
  for (const type of rules.required || []) {
    if (validCert(certs, uid, type, today)) continue;
    const had = (certs || []).some((item) => item.uid === uid && item.type === type);
    reasons.push(`${CERT_TYPES[type] || type}: ${had ? "хугацаа дууссан" : "бүртгэлгүй"}`);
  }
  if (rules.medical) {
    const exam = latestMedical(medicals, uid);
    if (!exam) reasons.push("Эрүүл мэндийн үзлэг бүртгэлгүй");
    else if (exam.result === "unfit") reasons.push("Эрүүл мэндийн үзлэгт тэнцээгүй");
    else if (exam.next < today) reasons.push(`Үечилсэн үзлэгийн хугацаа ${exam.next.slice(5).replace("-", ".")}-нд дууссан`);
  }
  const fail = rules.alcoholHours > 0 ? lastAlcoholFail(alcohol, uid, now, rules.alcoholHours) : null;
  if (fail) reasons.push(`Согтууруулах ундааны шалгалт эерэг (${fail.value}‰), ${localInput(Date.parse(fail.at) + rules.alcoholHours * HOUR_MS).slice(5).replace("T", " ").replace("-", ".")} хүртэл`);
  return reasons;
}

/** Fitness for duty from last sleep and hours already on shift. */
export function fatigueOf({ sleepMin, onShiftMs = 0 }) {
  const reasons = [];
  let level = 0;
  if (sleepMin == null) reasons.push("Нойрны мэдээлэлгүй");
  else if (sleepMin < 300) {
    level = 2;
    reasons.push(`Нойр ${(sleepMin / 60).toFixed(1)} цаг (5-аас бага)`);
  } else if (sleepMin < 360) {
    level = 1;
    reasons.push(`Нойр ${(sleepMin / 60).toFixed(1)} цаг (6-аас бага)`);
  }
  const hours = onShiftMs / HOUR_MS;
  if (hours >= 14) {
    level = 2;
    reasons.push(`${Math.floor(hours)} цаг тасралтгүй ажилласан`);
  } else if (hours >= 12) {
    level = Math.max(level, 1);
    reasons.push(`${Math.floor(hours)} цаг ажилласан`);
  }
  const state = level === 2 ? "unfit" : level === 1 ? "caution" : sleepMin == null ? "unknown" : "fit";
  const label = { unfit: "Хүнд техник барихыг хориглоно", caution: "Анхааралтай", unknown: "Тодорхойгүй", fit: "Тэнцсэн" }[state];
  return { state, label, reasons };
}

export function permitState(permit, now) {
  if (permit.status === "active" && Date.parse(permit.to) < now) return "expired";
  return permit.status;
}

export function riskLevel(likelihood, severity) {
  const score = Number(likelihood) * Number(severity);
  const level = score <= 4 ? "low" : score <= 9 ? "medium" : score <= 16 ? "high" : "extreme";
  return { score, level, label: { low: "Бага", medium: "Дунд", high: "Өндөр", extreme: "Онц өндөр" }[level] };
}

export function ppeDue(record) {
  return addMonths(record.issued, record.life);
}

export function serviceDue(equipment) {
  const used = (equipment.hours || 0) - (equipment.lastService || 0);
  return { due: used >= equipment.serviceEvery, left: equipment.serviceEvery - used };
}

export function prestartFails(record) {
  const ok = new Set(record.ok || []);
  return PRESTART_ITEMS.map(([key]) => key).filter((key) => !ok.has(key));
}

export function visitorReady(visitor, today) {
  return (visitor.induction || []).length === Object.keys(INDUCTION_ITEMS).length && visitor.from <= today && today <= visitor.to;
}

function mergedLength(intervals) {
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current = null;
  for (const [start, end] of sorted) {
    if (!current || start > current[1]) {
      if (current) total += current[1] - current[0];
      current = [start, end];
    } else current[1] = Math.max(current[1], end);
  }
  if (current) total += current[1] - current[0];
  return total;
}

/** Time a machine was out of service within [from, to): breakdown and planned work orders, overlaps merged. */
export function downtimeMs(workorders, equipmentId, from, to, now) {
  const spans = (workorders || [])
    .filter((item) => item.equipment === equipmentId && item.kind !== "inspection" && item.opened)
    .map((item) => [Math.max(from, Date.parse(item.opened)), Math.min(to, item.closed ? Date.parse(item.closed) : now)]);
  return mergedLength(spans);
}

/** Hours of a span that fall between 22:00 and 06:00 local time. */
export function nightOverlapMs(start, end) {
  let total = 0;
  const firstMidnight = Math.floor((start + TZ_MS) / DAY_MS) * DAY_MS - TZ_MS;
  for (let midnight = firstMidnight - DAY_MS; midnight < end; midnight += DAY_MS) {
    const from = midnight + 22 * HOUR_MS;
    const to = midnight + 30 * HOUR_MS;
    total += Math.max(0, Math.min(end, to) - Math.max(start, from));
  }
  return total;
}

/** People whose rotation brings them to site on `date` and people it sends home. */
export function crewChange(users, plans, leaves, date) {
  const arrive = [];
  const depart = [];
  for (const user of users) {
    const plan = plans?.[user.id];
    if (!isRotation(plan)) continue;
    const today = leaveOn(leaves, user.id, date) ? "off" : plannedKind(plan, date);
    const before = leaveOn(leaves, user.id, addDays(date, -1)) ? "off" : plannedKind(plan, addDays(date, -1));
    if (today !== "off" && before === "off") arrive.push(user.id);
    if (today === "off" && before !== "off") depart.push(user.id);
  }
  return { arrive, depart };
}

/** Working today or tomorrow (so arriving), and not on approved leave: needs a bed. */
export function needsBed(plan, leaves, uid, date) {
  return [date, addDays(date, 1)].some((day) => !leaveOn(leaves, uid, day) && plannedKind(plan, day) !== "off");
}

/**
 * Bed moves that put everyone on site in a bed: keeps beds of people still on site, frees the rest, and fills
 * free beds room by room. `beds` maps "roomId:index" to a user id.
 */
export function allocateBeds({ rooms, beds, users, plans, leaves, date }) {
  const onsite = new Set(users.filter((user) => plans?.[user.id] && needsBed(plans[user.id], leaves, user.id, date)).map((user) => user.id));
  const next = {};
  const placed = new Set();
  for (const [slot, uid] of Object.entries(beds || {})) {
    const roomId = slot.split(":")[0];
    if (onsite.has(uid) && rooms.some((room) => room.id === roomId) && !placed.has(uid)) {
      next[slot] = uid;
      placed.add(uid);
    }
  }
  const freed = Object.values(beds || {}).filter((uid) => !placed.has(uid)).length;
  const waiting = [...onsite].filter((uid) => !placed.has(uid));
  let added = 0;
  for (const room of [...rooms].sort((a, b) => `${a.block}${a.number}`.localeCompare(`${b.block}${b.number}`, "mn", { numeric: true }))) {
    for (let index = 0; index < room.beds && waiting.length; index += 1) {
      const slot = `${room.id}:${index}`;
      if (next[slot]) continue;
      next[slot] = waiting.shift();
      added += 1;
    }
  }
  return { beds: next, added, freed, unplaced: waiting };
}

/** Hours, night hours, overtime and shift counts per person for one calendar month, for payroll. */
export function payrollRows({ users, events, plans, leaves, month, now, since = null, sinceAt = null }) {
  const from = `${month}-01`;
  const [year, mon] = month.split("-").map(Number);
  const to = new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
  return users.map((user) => {
    const sessions = sessionsOf(events, user.id, now);
    const mine = sessions.filter((item) => item.date >= from && item.date <= to);
    const hours = mine.reduce((sum, item) => sum + (item.end - item.start), 0) / HOUR_MS;
    const night = mine.reduce((sum, item) => sum + nightOverlapMs(item.start, item.end), 0) / HOUR_MS;
    const overtime = mine.reduce((sum, item) => sum + Math.max(0, item.end - item.start - 12 * HOUR_MS), 0) / HOUR_MS;
    const sum = periodSummary({ sessions, week: plans?.[user.id] || null, leaves, uid: user.id, from, to, now, since, sinceAt });
    const round = (value) => Math.round(value * 10) / 10;
    return {
      uid: user.id,
      name: user.displayName,
      idNumber: user.card?.idNumber || "",
      title: user.title || "",
      workedDays: sum.workedDays,
      dayShifts: sum.dayShifts,
      nightShifts: sum.nightShifts,
      hours: round(hours),
      nightHours: round(night),
      overtime: round(overtime),
      fieldDays: sum.workedDays,
      leave: sum.leave,
      absent: sum.absent,
      late: sum.late,
    };
  });
}

/** Production against plan, fleet availability and use, and injury frequency rates. */
export function mineKpis({ handovers, planTonnes, incidents, workorders, equipment, assigns, hoursWorked, windowDays, today, now }) {
  const production = [];
  for (let back = 6; back >= 0; back -= 1) {
    const date = addDays(today, -back);
    const tonnes = (handovers || []).filter((item) => item.date === date).reduce((sum, item) => sum + (item.tonnes || 0), 0);
    production.push({ date, tonnes, plan: planTonnes || 0 });
  }
  const weekFrom = Date.parse(`${addDays(today, -6)}T06:00:00+08:00`);
  const span = Math.max(1, now - weekFrom);
  const fleet = equipment || [];
  const down = fleet.reduce((sum, item) => sum + downtimeMs(workorders, item.id, weekFrom, now, now), 0);
  const available = fleet.length * span - down;
  const used = (assigns || []).filter((item) => item.date >= addDays(today, -6) && item.date <= today).length * 12 * HOUR_MS;
  const windowFrom = now - windowDays * DAY_MS;
  const recent = (incidents || []).filter((item) => Date.parse(item.at) >= windowFrom && item.kind === "incident");
  const lti = recent.filter((item) => item.injury === "lti").length;
  const recordable = recent.filter((item) => ["lti", "mti", "rwi"].includes(item.injury)).length;
  const rate = (count) => (hoursWorked > 0 ? Math.round(((count * 1_000_000) / hoursWorked) * 100) / 100 : 0);
  return {
    production,
    prodTotal: production.reduce((sum, item) => sum + item.tonnes, 0),
    prodPlan: production.reduce((sum, item) => sum + item.plan, 0),
    availability: fleet.length ? Math.max(0, Math.min(1, 1 - down / (fleet.length * span))) : null,
    utilization: available > 0 ? Math.min(1, used / available) : null,
    lti,
    recordable,
    ltifr: rate(lti),
    trifr: rate(recordable),
    hoursWorked: Math.round(hoursWorked),
    windowDays,
  };
}

/** The live value of a weather metric (a flag counts 1 or 0), or null when the weather lacks it. */
export function wxValue(weather, metric) {
  if (!weather) return null;
  if (metric === "wind") return Number.isFinite(weather.windSpeedMs) ? weather.windSpeedMs : null;
  if (metric === "cold" || metric === "heat") return Number.isFinite(weather.feelsLikeC) ? weather.feelsLikeC : null;
  if (metric === "thunder") return Number(weather.code) >= 95 ? 1 : 0;
  if (metric === "precip") return Number.isFinite(weather.precipNowMm) ? weather.precipNowMm : null;
  return null;
}

/** Whether a rule fires; an active rule only clears once the value moves back past its margin. */
export function wxTriggered(rule, value, active) {
  if (value == null) return Boolean(active);
  const spec = WX_METRICS[rule.metric];
  if (!spec) return false;
  if (spec.op === "flag") return value >= 1;
  const edge = active ? spec.margin : 0;
  return spec.op === "gte" ? value >= rule.threshold - edge : value <= rule.threshold + edge;
}
