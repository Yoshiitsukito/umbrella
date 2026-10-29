// The UMBRELLA phone app: sleep-button windows, phone step counts, location fixes and sleep taken from the button.
import { addDays, localParts } from "./places.mjs";

const HOUR_MS = 60 * 60 * 1000;
const at = (date, hour) => Date.parse(`${date}T${String(hour).padStart(2, "0")}:00:00+08:00`);

/** After a night shift the sleep button shows from 07:00; otherwise (day shift or rest) from 19:00. */
export const SLEEP_FROM = { night: 7, evening: 19 };
const SLEEP_HOURS = { night: 9, evening: 9 };

/**
 * Times the sleep button is offered, from yesterday to tomorrow, still open at `now`.
 * `kindOn(date)` is that date's planned shift: "day", "night" or "off".
 */
export function sleepWindows(kindOn, now = Date.now()) {
  const today = localParts(new Date(now)).date;
  const windows = [];
  for (const date of [addDays(today, -1), today, addDays(today, 1)]) {
    if (kindOn(addDays(date, -1)) === "night") {
      const from = at(date, SLEEP_FROM.night);
      windows.push({ kind: "night", from, until: from + SLEEP_HOURS.night * HOUR_MS });
    }
    if (kindOn(date) !== "night") {
      const from = at(date, SLEEP_FROM.evening);
      windows.push({ kind: "evening", from, until: from + SLEEP_HOURS.evening * HOUR_MS });
    }
  }
  return windows
    .filter((item) => item.until > now)
    .sort((a, b) => a.from - b.from)
    .map((item) => ({ kind: item.kind, from: new Date(item.from).toISOString(), until: new Date(item.until).toISOString() }));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Steps and active minutes counted by the phone for one calendar day (today or yesterday's late sync). */
export function activityInput(body, today) {
  const date = String(body?.date || today);
  const steps = Number(body?.steps);
  const active = body?.active == null ? 0 : Number(body.active);
  if (!ISO_DATE.test(date) || (date !== today && date !== addDays(today, -1))) return { error: "Огноо буруу" };
  if (!Number.isInteger(steps) || steps < 0 || steps > 100000) return { error: "Алхам 0–100000 байна" };
  if (!Number.isInteger(active) || active < 0 || active > 1440) return { error: "Идэвхтэй минут 0–1440 байна" };
  return { date, steps, active };
}

export function applyPhoneActivity(day, { steps, active }, now = Date.now()) {
  day.steps = steps;
  day.active = Math.max(day.active || 0, active);
  day.phone = { steps, active, at: new Date(now).toISOString() };
}

export function locationInput(body, now = Date.now()) {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const acc = body?.acc == null ? null : Number(body.acc);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: "Байршил буруу" };
  if (acc !== null && !(acc >= 0 && acc < 100000)) return { error: "Нарийвчлал буруу" };
  const taken = Date.parse(body?.at);
  const when = Number.isFinite(taken) && taken <= now + 60 * 1000 ? taken : now;
  return { place: { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, acc: acc === null ? null : Math.round(acc), at: new Date(when).toISOString() } };
}

/** A night taken from the sleep and wake buttons, filed under the calendar day it ended (like the health form). */
export function phoneSleep(body, now = Date.now()) {
  const start = Date.parse(body?.start);
  const end = Date.parse(body?.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end > now + 60 * 1000) return { error: "Нойрны цаг буруу" };
  const min = Math.round((end - start) / 60000);
  if (min < 30 || min > 16 * 60) return { error: "Нойрны хугацаа 30 минутаас 16 цаг хооронд байна" };
  const clock = (ms) => {
    const parts = localParts(new Date(ms));
    return `${String(parts.hh).padStart(2, "0")}:${String(parts.mm).padStart(2, "0")}`;
  };
  return { date: localParts(new Date(end)).date, sleep: { start: clock(start), end: clock(end), min, score: null, source: "phone" } };
}
