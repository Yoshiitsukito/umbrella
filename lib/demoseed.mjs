// One-time demo data for the hosted server: 25 staff (five per card clearance level), a shift plan and
// 14 days of check-ins and check-outs for every staff member, and a week of kitchen menu.
// It runs inside the server's update() so the in-memory copy and Firestore stay in step.
import crypto from "node:crypto";
import { STAFF_ROLES, newUser } from "./auth.mjs";
import { shiftOf } from "./attendance.mjs";
import { ensureMenu, menuItems } from "./menu.mjs";
import { patternsFor } from "./workplan.mjs";
import { addDays, isRotation, plannedKind, rotationFrom, sessionsOf, shiftDateOf, shiftSpan } from "../public/js/workstats.js";

export const DEMO_VERSION = 1;
export const HISTORY_DAYS = 14;
export const MENU_DAYS = 7;
const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;

const PEOPLE = [
  ["Бат-Эрдэнэ Ганболд", "baterdene.g"],
  ["Оюунчимэг Дорж", "oyunchimeg.d"],
  ["Тэмүүлэн Баяр", "temuulen.b"],
  ["Номин-Эрдэнэ Сүх", "nomin.s"],
  ["Ганзориг Пүрэв", "ganzorig.p"],
  ["Солонго Энхбаяр", "solongo.e"],
  ["Мөнх-Очир Цэнд", "munkhochir.ts"],
  ["Анужин Болд", "anujin.b"],
  ["Түвшинбаяр Жаргал", "tuvshinbayar.j"],
  ["Хулан Мягмар", "khulan.m"],
  ["Энхтүвшин Гантулга", "enkhtuvshin.g"],
  ["Маралгоо Сэргэлэн", "maralgoo.s"],
  ["Билгүүн Отгон", "bilguun.o"],
  ["Сарнай Төмөр", "sarnai.t"],
  ["Эвэн Чинбат", "even.ch"],
  ["Нандин-Эрдэнэ Ням", "nandin.n"],
  ["Цогтбаяр Лхагва", "tsogtbayar.l"],
  ["Уянга Дашдорж", "uyanga.d"],
  ["Эрдэнэбилэг Мөнх", "erdenebileg.m"],
  ["Ариунаа Ганбат", "ariunaa.g"],
  ["Тэнгис Батсүх", "tengis.b"],
  ["Должинсүрэн Гэрэл", "doljinsuren.g"],
  ["Батцэцэг Очир", "battsetseg.o"],
  ["Мандах Энхжаргал", "mandakh.e"],
  ["Ганхуяг Сандаг", "gankhuyag.s"],
].map(([displayName, username]) => ({ displayName, username }));

const LEVELS = {
  1: { classification: "АЖИЛТАН", titles: ["Агуулахын ажилтан", "Туслах ажилтан", "Жолооч", "Үйлчилгээний ажилтан", "Харуул"] },
  2: { classification: "ТЕХНИКЧ", titles: ["Цахилгаанчин", "Засварчин", "Сантехникч", "Лаборант", "Операторч"] },
  3: { classification: "ИНЖЕНЕР", titles: ["Механик инженер", "Программист", "Сүлжээний инженер", "Барилгын инженер", "Чанарын инженер"] },
  4: { classification: "АХЛАХ ИНЖЕНЕР", titles: ["Ахлах механик", "Ахлах программист", "Төслийн инженер", "Аюулгүй ажиллагааны ахлах", "Ахлах технологич"] },
  5: { classification: "УДИРДЛАГА", titles: ["Ээлжийн ахлагч", "Хэсгийн дарга", "Үйлдвэрлэлийн менежер", "Техникийн захирал", "Аюулгүй байдлын менежер"] },
};
const PROJECTS = ["UMBRELLA ХӨТӨЛБӨР", "HOLO ХӨТӨЛБӨР", "ИНЖЕНЕР ТЕХНОЛОГИ", "ЛОГИСТИК", "СУДАЛГАА"];

/** Dish, category, portion and calories per meal; each day takes a different pick from each list. */
const DISHES = {
  breakfast: {
    main: [["Өндөгтэй будаа", 300, 420], ["Сүүтэй будаа", 300, 360], ["Блин, зөгийн балтай", 220, 450], ["Омлет, хиамтай", 250, 430], ["Овъёосны будаа", 300, 320]],
    side: [["Талх, цөцгийн тос", 80, 260], ["Чанасан өндөг", 100, 150], ["Бяслагтай сэндвич", 150, 340]],
    drink: [["Сүүтэй цай", 250, 110], ["Хар цай", 250, 5], ["Какао", 250, 190]],
  },
  lunch: {
    soup: [["Гурилтай шөл", 350, 320], ["Банштай шөл", 350, 380], ["Ногоотой шөл", 350, 180], ["Борщ", 350, 230], ["Хонины махтай шөл", 350, 340]],
    main: [["Цуйван", 350, 620], ["Бууз (6 ш)", 300, 590], ["Хуушуур (3 ш)", 300, 680], ["Тахианы махтай будаа", 350, 560], ["Үхрийн махтай хуурга", 350, 540], ["Котлет, нухсан төмс", 350, 600], ["Гуляш, будаа", 350, 580]],
    salad: [["Байцааны салат", 150, 90], ["Луувангийн салат", 150, 110], ["Нийслэл салат", 150, 260], ["Өргөст хэмхний салат", 150, 60]],
    drink: [["Компот", 250, 90], ["Жимсний шүүс", 250, 110], ["Ус", 500, 0]],
  },
  dinner: {
    main: [["Шарсан гоймон", 350, 560], ["Хуурга, будаа", 350, 590], ["Загасны котлет, будаа", 350, 480], ["Тахианы шөлтэй гоймон", 400, 430], ["Манты (5 ш)", 300, 540], ["Махан бөмбөлөг, макарон", 350, 610]],
    side: [["Чанасан ногоо", 150, 80], ["Шарсан төмс", 150, 280], ["Будаа", 150, 200]],
    dessert: [["Тараг", 150, 120], ["Жимс", 200, 100], ["Бялуу", 100, 350], ["Жигнэмэг", 60, 270]],
    drink: [["Сүүтэй цай", 250, 110], ["Ногоон цай", 250, 5]],
  },
  night: {
    main: [["Бантан", 350, 330], ["Хуушуур (2 ш)", 200, 450], ["Сэндвич, тахиатай", 220, 420], ["Банштай шөл", 350, 380], ["Гурилтай хуурга", 300, 520]],
    drink: [["Кофе", 250, 60], ["Сүүтэй цай", 250, 110], ["Халуун шоколад", 250, 210]],
  },
};

const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];
const between = (min, max, rnd) => min + Math.floor(rnd() * (max - min + 1));
const two = (value) => String(value).padStart(2, "0");
const cardDate = (ms) => {
  const date = new Date(ms);
  return `${two(date.getUTCMonth() + 1)}/${two(date.getUTCDate())}/${date.getUTCFullYear()}`;
};

function demoUsers(db, now, rnd) {
  const taken = new Set(db.users.map((user) => user.username));
  const added = [];
  PEOPLE.forEach((person, index) => {
    if (taken.has(person.username)) return;
    const level = Math.floor(index / 5) + 1;
    const { classification, titles } = LEVELS[level];
    const createdMs = now - between(30, 400, rnd) * DAY_MS;
    const user = newUser({
      username: person.username,
      password: crypto.randomBytes(18).toString("base64url"),
      role: "user",
      displayName: person.displayName,
      title: titles[index % 5],
      email: `${person.username}@umbrella.local`,
      card: { classification, project: pick(PROJECTS, rnd), clearance: level, issued: cardDate(createdMs), expires: cardDate(createdMs + 4 * 365.25 * DAY_MS), signature: person.displayName.split(" ")[0] },
      existing: db.users,
    });
    user.createdAt = new Date(createdMs).toISOString();
    db.users.push(user);
    added.push(user);
  });
  return added;
}

/** A rotation for the person's role, anchored so the last 14 days hold at least five planned shifts. */
function randomRotation(role, today, histStart, rnd) {
  const patterns = patternsFor(role);
  let plan = null;
  for (let tries = 0; tries < 40; tries += 1) {
    const pattern = pick(patterns, rnd);
    plan = { type: "rotation", start: addDays(today, -between(0, 27, rnd)), ...(pattern !== "dn" ? { pattern } : {}) };
    let shifts = 0;
    for (let date = histStart; date < today; date = addDays(date, 1)) if (plannedKind(plan, date) !== "off") shifts += 1;
    if (shifts >= 5) break;
  }
  return plan;
}

/** Gives every staff member a plan that covers the last 14 days; existing plans keep their future part. */
function ensurePlans(db, staff, today, histStart, rnd) {
  db.shiftPlans ||= {};
  for (const user of staff) {
    const plan = db.shiftPlans[user.id];
    if (!plan) {
      db.shiftPlans[user.id] = randomRotation(user.role, today, histStart, rnd);
      continue;
    }
    if (!isRotation(plan)) continue;
    let oldest = plan;
    while (isRotation(oldest.before)) oldest = oldest.before;
    if (rotationFrom(oldest) > histStart) oldest.before = randomRotation(user.role, rotationFrom(oldest), histStart, rnd);
  }
}

function scan(uid, ms, state, place, rnd) {
  const at = new Date(ms).toISOString();
  const jitter = () => (rnd() - 0.5) * 0.0008;
  return { at, uid, state, ...shiftOf(at), lat: +(place.lat + jitter()).toFixed(6), lng: +(place.lng + jitter()).toFixed(6) };
}

/** Check-in and check-out times for one shift: mostly on time, sometimes late, early or missing. */
function shiftScans(uid, span, place, now, rnd) {
  const roll = rnd();
  if (roll < 0.06) return [];
  const late = roll < 0.2;
  const inMs = span.start + (late ? between(6, 45, rnd) : -between(3, 40, rnd)) * MIN_MS;
  const outMs = span.end + (rnd() < 0.08 ? -between(15, 90, rnd) : between(-3, 35, rnd)) * MIN_MS;
  if (outMs >= now) return [];
  return [scan(uid, inMs, "in", place, rnd), scan(uid, outMs, "out", place, rnd)];
}

/** Fills the last 14 shift days with scans; a person's real records are never touched or interleaved. */
function fillAttendance(db, staff, today, histStart, now, rnd) {
  const attendance = db.attendance;
  const place = { lat: Number(db.location?.lat) || 47.9165, lng: Number(db.location?.lng) || 106.8797 };
  let added = 0;
  for (const user of staff) {
    const plan = db.shiftPlans?.[user.id];
    const real = sessionsOf(attendance.events, user.id, now).map((session) => session.date);
    const stop = real.length ? real.reduce((min, date) => (date < min ? date : min)) : addDays(today, 1);
    const fresh = [];
    for (let date = histStart; date <= today && date < stop; date = addDays(date, 1)) {
      const kind = plannedKind(plan, date);
      if (kind !== "off") fresh.push(...shiftScans(user.id, shiftSpan(date, kind), place, now, rnd));
      else if (rnd() < 0.04) fresh.push(...shiftScans(user.id, shiftSpan(date, "day"), place, now, rnd));
    }
    if (!fresh.length) continue;
    attendance.events.push(...fresh);
    added += fresh.length;
    if (!real.length) {
      const last = fresh.at(-1);
      attendance.people = { ...attendance.people, [user.id]: { state: last.state, since: last.at } };
    }
  }
  attendance.events.sort((a, b) => a.at.localeCompare(b.at));
  if (!attendance.historyFrom || attendance.historyFrom > histStart) attendance.historyFrom = histStart;
  const trackFrom = new Date(shiftSpan(histStart, "day").start - 3 * 3600 * 1000).toISOString();
  if (!attendance.resetAt || attendance.resetAt > trackFrom) attendance.resetAt = trackFrom;
  return added;
}

/** A week of menus from today; days the kitchen already filled are left alone. */
function fillMenu(db, today, by, now, rnd) {
  ensureMenu(db);
  let added = 0;
  for (let ahead = 0; ahead < MENU_DAYS; ahead += 1) {
    const date = addDays(today, ahead);
    if (menuItems(db, date).length) continue;
    const day = (db.menu.days[date] = []);
    for (const [meal, categories] of Object.entries(DISHES)) {
      for (const [category, dishes] of Object.entries(categories)) {
        const [name, portion, kcal] = dishes[(ahead + Math.floor(rnd() * dishes.length)) % dishes.length];
        day.push({
          id: `mn_${crypto.randomBytes(6).toString("hex")}`,
          meal,
          category,
          name,
          portion,
          unit: category === "drink" || category === "soup" ? "мл" : "г",
          kcal,
          note: null,
          source: "manual",
          protein: null,
          fat: null,
          carbs: null,
          aiNote: null,
          by,
          at: new Date(now).toISOString(),
        });
        added += 1;
      }
    }
  }
  return added;
}

/** Seeds once per DEMO_VERSION; returns a summary, or null when it already ran. */
export function seedDemo(db, { now = Date.now(), random = Math.random } = {}) {
  if (db.demoSeed?.version >= DEMO_VERSION) return null;
  db.users ||= [];
  db.attendance ||= { events: [], usedJti: [] };
  db.attendance.events ||= [];
  const today = shiftDateOf(now);
  const histStart = addDays(today, -HISTORY_DAYS);
  const users = demoUsers(db, now, random);
  const staff = db.users.filter((user) => STAFF_ROLES.includes(user.role));
  ensurePlans(db, staff, today, histStart, random);
  const scans = fillAttendance(db, staff, today, histStart, now, random);
  const kitchen = db.users.find((user) => user.role === "kitchen");
  const dishes = fillMenu(db, today, kitchen?.id || "demo", now, random);
  db.demoSeed = { version: DEMO_VERSION, at: new Date(now).toISOString(), users: users.map((user) => user.id) };
  return { users: users.length, staff: staff.length, scans, dishes };
}
