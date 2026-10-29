import { localParts } from "./places.mjs";
import { SHIFT_HOURS, SHIFT_START_HOUR } from "../public/js/workstats.js";

export { SHIFT_HOURS, SHIFT_START_HOUR };
const HOUR_MS = 3600 * 1000;
const KEEP_MS = 62 * 24 * HOUR_MS;
// Firestore keeps all of attendance in one document (1 MB limit).
const KEEP_EVENTS = 4000;

export function shiftWindows(now = Date.now()) {
  const date = localParts(new Date(now - SHIFT_START_HOUR * HOUR_MS)).date;
  const dayStart = Date.parse(`${date}T${String(SHIFT_START_HOUR).padStart(2, "0")}:00:00+08:00`);
  const nightStart = dayStart + SHIFT_HOURS * HOUR_MS;
  const nightEnd = nightStart + SHIFT_HOURS * HOUR_MS;
  const iso = (ms) => new Date(ms).toISOString();
  return {
    date,
    current: now < nightStart ? "day" : "night",
    day: { start: iso(dayStart), end: iso(nightStart) },
    night: { start: iso(nightStart), end: iso(nightEnd) },
  };
}

export function shiftOf(at) {
  const windows = shiftWindows(Date.parse(at));
  return { date: windows.date, shift: windows.current };
}

export function ensureAttendance(db) {
  const attendance = db.attendance || (db.attendance = { events: [], usedJti: [] });
  attendance.events ||= [];
  attendance.usedJti ||= [];
  const legacy = db.profile?.id;
  let changed = false;
  for (const event of attendance.events) {
    if (!event.uid && legacy) {
      event.uid = legacy;
      changed = true;
    }
    if (!event.date || !event.shift) {
      Object.assign(event, shiftOf(event.at));
      changed = true;
    }
  }
  if (!attendance.people) {
    attendance.people = {};
    if (legacy && attendance.since) attendance.people[legacy] = { state: attendance.state || "out", since: attendance.since };
    changed = true;
  }
  // HR's attendance history starts on the day it was introduced; earlier days had no shift plans to judge.
  if (!attendance.historyFrom) {
    attendance.historyFrom = shiftWindows().date;
    changed = true;
  }
  if ("state" in attendance || "since" in attendance) {
    delete attendance.state;
    delete attendance.since;
    changed = true;
  }
  return changed;
}

export function presenceOf(attendance, uid) {
  return attendance.people?.[uid] || { state: "out", since: null };
}

export function recordScan(attendance, uid, coords, now = Date.now()) {
  const at = new Date(now).toISOString();
  const state = presenceOf(attendance, uid).state === "in" ? "out" : "in";
  attendance.people = { ...attendance.people, [uid]: { state, since: at } };
  attendance.events.push({ at, uid, state, ...shiftOf(at), lat: coords.lat, lng: coords.lng });
  attendance.events = attendance.events.filter((item) => now - Date.parse(item.at) < KEEP_MS).slice(-KEEP_EVENTS);
  return state;
}
