// Per-user wellbeing data: water, sleep, activity, meals, mood, vitals, reminders and notices.
// Each user lives under its own top-level key so one Firestore document never holds everyone.
import { randomBytes } from "node:crypto";
import { isoDate } from "./workplan.mjs";
import { sunElevation } from "./weather.mjs";
import { DEFAULT_WEEK, LEAVE_LABEL, PLAN_LABEL, WEEKDAY_SHORT, addDays, isRotation, patternOf, plannedKind, rotationFrom, weekdayOf } from "../public/js/workstats.js";

export const MEALS = ["breakfast", "lunch", "dinner"];
export const OFF_WEEK = ["off", "off", "off", "off", "off", "off", "off"];

const DAY_MS = 24 * 3600 * 1000;
const KEEP_DAYS = 62;
const KEEP_VITALS = 120;
const KEEP_REMINDERS = 60;
const DONE_KEEP_DAYS = 3;
const NOTICE_KEEP_DAYS = 14;
const KEEP_NOTICES = 30;
const ANNOUNCE_KEEP_DAYS = 14;
const KEEP_ANNOUNCEMENTS = 30;

const newId = (prefix) => `${prefix}_${randomBytes(6).toString("hex")}`;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

export const personalKey = (uid) => `personal_${uid}`;

export function personalOf(db, uid) {
  const key = personalKey(uid);
  const record = db[key] && typeof db[key] === "object" ? db[key] : (db[key] = {});
  record.days ||= {};
  record.vitals ||= [];
  record.reminders ||= [];
  record.notices ||= [];
  return record;
}

export function dayOf(record, date) {
  record.days[date] ||= {};
  return record.days[date];
}

/** The week a person is scheduled on: admin-set plan, otherwise default (admins default to no shifts). */
export function weekFor(db, user) {
  return db.shiftPlans?.[user.id] || (user.role === "admin" ? OFF_WEEK : DEFAULT_WEEK);
}

export function prunePersonal(record, today, now = Date.now()) {
  for (const date of Object.keys(record.days)) if (daysBetween(date, today) >= KEEP_DAYS) delete record.days[date];
  record.vitals = record.vitals.slice(-KEEP_VITALS);
  record.reminders = record.reminders
    .filter((item) => !item.done || daysBetween(item.doneOn || today, today) <= DONE_KEEP_DAYS)
    .slice(-KEEP_REMINDERS);
  record.notices = record.notices.filter((item) => now - Date.parse(item.at) < NOTICE_KEEP_DAYS * DAY_MS).slice(-KEEP_NOTICES);
  return record;
}

/** Trimmed single-line text, or null when it is empty, too long or carries markup/control characters. */
export function cleanText(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > max || /[<>\p{Cc}]/u.test(text)) return null;
  return text;
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export function clockMinutes(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 1440;
  return mins;
}

export function waterAmount(value) {
  const amount = Number(value);
  return amount >= 50 && amount <= 1000 ? Math.round(amount) : null;
}

export function addWater(day, amount) {
  day.water = Math.min(10000, (day.water || 0) + amount);
  day.cups = (day.cups || 0) + 1;
  return day;
}

export function sleepInput(body) {
  const start = String(body?.start ?? "");
  const end = String(body?.end ?? "");
  if (!CLOCK.test(start) || !CLOCK.test(end)) return { error: "Унтсан, сэрсэн цагаа оруулна уу" };
  const min = clockMinutes(start, end);
  if (min < 30 || min > 16 * 60) return { error: "Нойрны хугацаа 30 минутаас 16 цаг хооронд байна" };
  const rawScore = body?.score;
  const score = rawScore === "" || rawScore == null ? null : Number(rawScore);
  if (score !== null && !(Number.isInteger(score) && score >= 0 && score <= 100)) return { error: "Бугуйвчны оноо 0–100 байна" };
  return { sleep: { start, end, min, score } };
}

/**
 * One reading copied from a smartwatch app, or taken live over Bluetooth: any of sleep, steps, active minutes,
 * blood pressure and heart rate. Totals replace the day's numbers rather than adding to them.
 */
export function watchInput(body) {
  const read = (value) => (value == null || value === "" ? null : Number(value));
  const result = {};
  if (body?.start || body?.end) {
    const { sleep, error } = sleepInput(body);
    if (error) return { error };
    result.sleep = sleep;
  }
  const steps = read(body?.steps);
  if (steps !== null) {
    if (!(Number.isInteger(steps) && steps >= 0 && steps <= 100000)) return { error: "Алхам 0–100000 байна" };
    result.steps = steps;
  }
  const active = read(body?.active);
  if (active !== null) {
    if (!(Number.isInteger(active) && active >= 0 && active <= 1440)) return { error: "Идэвхтэй минут 0–1440 байна" };
    result.active = active;
  }
  const sys = read(body?.sys);
  const dia = read(body?.dia);
  const hr = read(body?.hr);
  if (sys !== null || dia !== null) {
    if (!(sys >= 70 && sys <= 260 && dia >= 40 && dia <= 160 && sys > dia)) return { error: "Даралт 70–260 / 40–160 байна" };
  }
  if (hr !== null && !(hr >= 30 && hr <= 220)) return { error: "Зүрхний цохилт 30–220 байна" };
  if (sys !== null || hr !== null) {
    result.vitals = { sys: sys === null ? null : Math.round(sys), dia: dia === null ? null : Math.round(dia), hr: hr === null ? null : Math.round(hr), source: body?.source === "ble" ? "ble" : "watch" };
  }
  if (!Object.keys(result).length) return { error: "Цагнаас дор хаяж нэг утга оруулна уу" };
  return { reading: result };
}

export function applyWatch(record, day, reading, now = Date.now()) {
  if (reading.sleep) day.sleep = reading.sleep;
  if (reading.steps != null) day.steps = reading.steps;
  if (reading.active != null) day.active = reading.active;
  if (reading.vitals) record.vitals.push({ at: new Date(now).toISOString(), ...reading.vitals });
  return record;
}

export function moodValue(value) {
  const mood = Number(value);
  return Number.isInteger(mood) && mood >= 1 && mood <= 5 ? mood : null;
}

export function toggleMeal(day, meal) {
  if (!MEALS.includes(meal)) return false;
  day.meals ||= {};
  day.meals[meal] = !day.meals[meal];
  return true;
}

export function reminderInput(body, now = Date.now()) {
  const title = cleanText(body?.title, 80);
  if (!title) return { error: "Сануулгын нэр 1–80 тэмдэгт, < > тэмдэггүй байна" };
  const due = String(body?.due ?? "").trim();
  if (due && !CLOCK.test(due)) return { error: "Цаг ЦЦ:ММ хэлбэртэй байна" };
  return { reminder: { id: newId("rem"), title, due: due || null, done: false, at: new Date(now).toISOString() } };
}

export function pushNotice(record, kind, text, now = Date.now()) {
  record.notices.push({ id: newId("nt"), kind, text, at: new Date(now).toISOString(), seen: false });
  record.notices = record.notices.slice(-KEEP_NOTICES);
}

export function freshNotices(record, now = Date.now()) {
  return record.notices.filter((item) => !item.seen && now - Date.parse(item.at) < NOTICE_KEEP_DAYS * DAY_MS);
}

export function leaveNotice(leave) {
  const span = leave.from === leave.to ? leave.from.slice(5).replace("-", ".") : `${leave.from.slice(5).replace("-", ".")}–${leave.to.slice(5).replace("-", ".")}`;
  const verdict = leave.status === "approved" ? "зөвшөөрөгдлөө" : "татгалзагдлаа";
  return `${LEAVE_LABEL[leave.type]} хүсэлт (${span}) ${verdict}.`;
}

const ROTATION_TEXT = { dn: "7 хоног өдөр, 7 хоног шөнө, 14 хоног амралт", nd: "7 хоног шөнө, 7 хоног өдөр, 14 хоног амралт", dd: "14 хоног өдөр, 14 хоног амралт" };

/** Describes what changed between two plans, calling out tomorrow when it is affected. */
export function planNotice(before, after, tomorrow) {
  const ahead = Array.from({ length: 28 }, (_, index) => addDays(tomorrow, index));
  const changed = ahead.filter((date) => plannedKind(before, date) !== plannedKind(after, date));
  if (!changed.length) return null;
  if (changed[0] === tomorrow) return `Маргаашийн ээлж өөрчлөгдлөө: ${PLAN_LABEL[plannedKind(before, tomorrow)]} → ${PLAN_LABEL[plannedKind(after, tomorrow)]}.`;
  if (isRotation(after)) return `Ээлжийн хуваарь шинэчлэгдлээ: ${ROTATION_TEXT[patternOf(after)]}. ${rotationFrom(after).slice(5).replace("-", ".")}-аас: ${PLAN_LABEL[plannedKind(after, rotationFrom(after))]}.`;
  const weekdays = [...new Set(changed.map((date) => weekdayOf(date)))].sort((a, b) => a - b);
  return `Ээлжийн хуваарь шинэчлэгдлээ: ${weekdays.map((day) => WEEKDAY_SHORT[day]).join(", ")}.`;
}

export function announcementInput(body, by, now = Date.now()) {
  const text = cleanText(body?.text, 300);
  if (!text) return { error: "Зарлал 1–300 тэмдэгт, < > тэмдэггүй байна" };
  return { announcement: { id: newId("an"), text, by, at: new Date(now).toISOString(), readBy: [] } };
}

export function pruneAnnouncements(list, now = Date.now()) {
  return list.filter((item) => now - Date.parse(item.at) < ANNOUNCE_KEEP_DAYS * DAY_MS).slice(-KEEP_ANNOUNCEMENTS);
}

export function announcementsFor(list, uid, now = Date.now()) {
  return pruneAnnouncements(list, now)
    .map(({ id, text, by, at, readBy }) => ({ id, text, by, at, read: readBy.includes(uid) }))
    .reverse();
}

export function birthdayValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return { value: null };
  if (!isoDate(text) || text < "1930-01-01" || text > new Date().toISOString().slice(0, 10)) return { error: "Төрсөн огноо буруу" };
  return { value: text };
}

function birthdayIn(year, birthday) {
  const monthDay = birthday.slice(5);
  if (monthDay === "02-29" && !isoDate(`${year}-02-29`)) return `${year}-02-28`;
  return `${year}-${monthDay}`;
}

/** Birthdays from today through the next `days` days, nearest first. */
export function birthdaysAround(users, today, days = 7) {
  const year = Number(today.slice(0, 4));
  const list = [];
  for (const user of users) {
    if (!user.birthday || user.role === "whiteking") continue;
    let date = birthdayIn(year, user.birthday);
    if (date < today) date = birthdayIn(year + 1, user.birthday);
    const inDays = daysBetween(today, date);
    if (inDays <= days) list.push({ id: user.id, name: user.displayName, date, inDays, age: Number(date.slice(0, 4)) - Number(user.birthday.slice(0, 4)) });
  }
  return list.sort((a, b) => a.inDays - b.inDays);
}

/** Sunrise and sunset (ms) for a local date by scanning the solar elevation curve. */
export function sunTimes(lat, lng, date, offsetHours = 8) {
  const start = Date.parse(`${date}T00:00:00Z`) - offsetHours * 3600 * 1000;
  const step = 2 * 60 * 1000;
  const horizon = -0.833;
  let rise = null;
  let set = null;
  let prev = sunElevation(lat, lng, start) - horizon;
  for (let t = start + step; t <= start + DAY_MS; t += step) {
    const value = sunElevation(lat, lng, t) - horizon;
    const at = Math.round(t - step + (step * prev) / (prev - value));
    if (prev < 0 && value >= 0 && rise === null) rise = at;
    if (prev >= 0 && value < 0) set = at;
    prev = value;
  }
  return { rise, set };
}
