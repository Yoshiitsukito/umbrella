// Pure attendance arithmetic shared by the user and admin attendance pages.

// Day shift 06:00–18:00, night shift 18:00–06:00 (local time).
export const SHIFT_START_HOUR = 6;
export const SHIFT_HOURS = 12;
export const GRACE_MIN = 5;
export const DEFAULT_WEEK = ["off", "day", "day", "day", "day", "day", "off"];
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
export const WEEKDAY_SHORT = ["Ня", "Да", "Мя", "Лх", "Пү", "Ба", "Бя"];
export const PLAN_LABEL = { day: "Өдөр", night: "Шөнө", off: "Амралт" };
export const LEAVE_LABEL = { leave: "Чөлөө", sick: "Өвчтэй", trip: "Томилолт" };

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const TZ_MS = 8 * HOUR_MS;
// A session belongs to the shift date it starts in, counting arrivals up to 3 h early.
const EARLY_ARRIVAL_MS = 3 * HOUR_MS;
const MAX_SESSION_MS = 16 * HOUR_MS;

export const SHIFT_MS = SHIFT_HOURS * HOUR_MS;

const clockAt = (hour) => `${String(hour % 24).padStart(2, "0")}:00`;
/** Start and end wall-clock times of each shift, e.g. day ["06:00", "18:00"]. */
export const SHIFT_CLOCK = {
  day: [clockAt(SHIFT_START_HOUR), clockAt(SHIFT_START_HOUR + SHIFT_HOURS)],
  night: [clockAt(SHIFT_START_HOUR + SHIFT_HOURS), clockAt(SHIFT_START_HOUR + 2 * SHIFT_HOURS)],
};

export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function weekdayOf(date) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function shiftDateOf(ms) {
  return new Date(ms + TZ_MS - SHIFT_START_HOUR * HOUR_MS).toISOString().slice(0, 10);
}

export function shiftSpan(date, shift) {
  const start = Date.parse(`${date}T00:00:00Z`) - TZ_MS + SHIFT_START_HOUR * HOUR_MS + (shift === "night" ? SHIFT_MS : 0);
  return { start, end: start + SHIFT_MS };
}

export function planOf(week) {
  return Array.isArray(week) && week.length === 7 ? week : DEFAULT_WEEK;
}

/**
 * 28-day cycles of 14 working days and 14 off: 7 day then 7 night shifts, 7 night then 7 day shifts
 * (a rotation that starts on nights), or 14 day shifts in a row (human resources).
 */
export const ROTATIONS = {
  dn: [...Array(7).fill("day"), ...Array(7).fill("night"), ...Array(14).fill("off")],
  nd: [...Array(7).fill("night"), ...Array(7).fill("day"), ...Array(14).fill("off")],
  dd: [...Array(14).fill("day"), ...Array(14).fill("off")],
};
export const ROTATION_LABEL = { dn: "7 өдөр → 7 шөнө → 14 амралт", nd: "7 шөнө → 7 өдөр → 14 амралт", dd: "14 өдөр → 14 амралт" };
export const ROTATION = ROTATIONS.dn;

export function isRotation(plan) {
  return Boolean(plan && !Array.isArray(plan) && plan.type === "rotation" && /^\d{4}-\d{2}-\d{2}$/.test(plan.start));
}

export function patternOf(plan) {
  return ROTATIONS[plan?.pattern] ? plan.pattern : "dn";
}

/** The date a rotation takes effect; `start` only anchors the cycle and may lie earlier. */
export function rotationFrom(plan) {
  return plan.from || plan.start;
}

/**
 * Planned shift kind on a date. Before a rotation takes effect, an earlier rotation it replaced still applies;
 * otherwise those days are rest, as if the previous 14-day rest block led into the first shift.
 */
export function plannedKind(plan, date) {
  if (!isRotation(plan)) return planOf(plan)[weekdayOf(date)];
  if (date < rotationFrom(plan)) return isRotation(plan.before) ? plannedKind(plan.before, date) : "off";
  const offset = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${plan.start}T00:00:00Z`)) / DAY_MS);
  const cycle = ROTATIONS[patternOf(plan)];
  return cycle[((offset % cycle.length) + cycle.length) % cycle.length];
}

/** Where a date sits in its run of identical shift kinds, e.g. day 3 of 7 night shifts, and what comes next. */
export function rotationPhase(plan, date) {
  const kind = plannedKind(plan, date);
  const floor = isRotation(plan) && date >= rotationFrom(plan) ? rotationFrom(plan) : addDays(date, -28);
  let first = date;
  while (first > floor && plannedKind(plan, addDays(first, -1)) === kind) first = addDays(first, -1);
  let last = date;
  while (plannedKind(plan, addDays(last, 1)) === kind && last < addDays(date, 28)) last = addDays(last, 1);
  const length = Math.round((Date.parse(`${last}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS) + 1;
  const index = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / DAY_MS) + 1;
  const nextDate = addDays(last, 1);
  return { kind, index, length, next: { kind: plannedKind(plan, nextDate), date: nextDate } };
}

export function leaveOn(leaves, uid, date) {
  return (leaves || []).find((item) => item.uid === uid && item.status === "approved" && item.from <= date && date <= item.to) || null;
}

/** Pairs a user's check-ins with check-outs; an unclosed check-in counts until now (at most 16 h). */
export function sessionsOf(events, uid, now) {
  const mine = events.filter((item) => item.uid === uid).sort((a, b) => a.at.localeCompare(b.at));
  const sessions = [];
  let open = null;
  const close = (start, end, forgot) => sessions.push({ start, end, forgot, date: shiftDateOf(start + EARLY_ARRIVAL_MS) });
  for (const event of mine) {
    const at = Date.parse(event.at);
    if (event.state === "in") {
      if (open !== null) close(open, Math.min(at, open + MAX_SESSION_MS), true);
      open = at;
    } else if (open !== null) {
      close(open, at, false);
      open = null;
    }
  }
  if (open !== null) {
    const stale = now - open > MAX_SESSION_MS;
    sessions.push({ start: open, end: stale ? open + MAX_SESSION_MS : now, forgot: stale, live: !stale, date: shiftDateOf(open + EARLY_ARRIVAL_MS) });
  }
  return sessions;
}

export function dayRecord({ sessions, week, leaves, uid, date, now }) {
  const planned = plannedKind(week, date);
  const mine = sessions.filter((item) => item.date === date);
  const worked = mine.reduce((sum, item) => sum + (item.end - item.start), 0);
  const first = mine[0];
  const last = mine.at(-1);
  const record = {
    date,
    planned,
    leave: leaveOn(leaves, uid, date),
    worked,
    firstIn: first ? first.start : null,
    lastOut: last && !last.live ? last.end : null,
    live: Boolean(last?.live),
    forgot: mine.some((item) => item.forgot),
    late: 0,
    early: 0,
    span: planned === "off" ? null : shiftSpan(date, planned),
    status: "off",
  };
  if (record.leave) record.status = "leave";
  else if (!record.span) record.status = mine.length ? "extra" : "off";
  else if (!first) record.status = now >= record.span.end ? "absent" : now >= record.span.start ? "missing" : "upcoming";
  else {
    const late = Math.round((first.start - record.span.start) / MINUTE_MS);
    record.late = late > GRACE_MIN ? late : 0;
    if (now >= record.span.end && last && !last.live && !last.forgot) {
      const early = Math.round((record.span.end - last.end) / MINUTE_MS);
      record.early = early > GRACE_MIN ? early : 0;
    }
    record.status = record.late ? "late" : "ontime";
  }
  return record;
}

export function periodRange(kind, today) {
  if (kind === "week" || kind === "lastweek") {
    const monday = addDays(today, -((weekdayOf(today) + 6) % 7) - (kind === "lastweek" ? 7 : 0));
    return { from: monday, to: addDays(monday, 6) };
  }
  const [year, month] = today.split("-").map(Number);
  const first = new Date(Date.UTC(year, month - 1 - (kind === "lastmonth" ? 1 : 0), 1));
  const next = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1));
  return { from: first.toISOString().slice(0, 10), to: addDays(next.toISOString().slice(0, 10), -1) };
}

export function datesBetween(from, to) {
  const dates = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** A day counts as worked when the person came in for a planned shift, or worked on a day off. */
export const WORKED_STATUSES = ["ontime", "late", "extra"];
export const CYCLE_WORK_DAYS = ROTATION.filter((kind) => kind !== "off").length;

export function isWorkedDay(day) {
  return WORKED_STATUSES.includes(day.status);
}

/**
 * The 28-day 7-7-14 cycle holding `today` (`back` cycles earlier); before a rotation takes effect, its first
 * cycle. Without a rotation, four calendar weeks ending with the current one stand in for a cycle.
 */
export function cycleRange(plan, today, back = 0) {
  let from;
  if (isRotation(plan)) {
    const anchor = today < rotationFrom(plan) ? rotationFrom(plan) : today;
    const offset = Math.round((Date.parse(`${anchor}T00:00:00Z`) - Date.parse(`${plan.start}T00:00:00Z`)) / DAY_MS);
    from = addDays(anchor, -(((offset % ROTATION.length) + ROTATION.length) % ROTATION.length));
  } else {
    from = addDays(today, -((weekdayOf(today) + 6) % 7) - 21);
  }
  from = addDays(from, -ROTATION.length * back);
  return { from, to: addDays(from, ROTATION.length - 1) };
}

/** A missed shift that was already over when attendance tracking (re)started could never have been recorded. */
function untracked(day, sinceAt) {
  return Boolean(sinceAt && day.status === "absent" && day.span.end <= sinceAt);
}

/**
 * Totals for a date range. Days before `since` (the date attendance tracking began) are left out, and so are
 * shifts that ended before `sinceAt` (the moment it began).
 */
export function periodSummary({ sessions, week, leaves, uid, from, to, now, since = null, sinceAt = null }) {
  const start = since && since > from ? since : from;
  const days = datesBetween(start, to).map((date) => {
    const day = dayRecord({ sessions, week, leaves, uid, date, now });
    return untracked(day, sinceAt) ? { ...day, status: "untracked" } : day;
  });
  const shiftDays = days.filter((day) => day.span && !day.leave && day.status !== "untracked");
  const count = (status) => days.filter((day) => day.status === status).length;
  const worked = days.filter(isWorkedDay);
  const restDays = days.filter((day) => day.planned === "off");
  const today = shiftDateOf(now);
  return {
    from: start,
    days,
    workedDays: worked.length,
    restTarget: restDays.length,
    restedDays: restDays.filter((day) => day.date <= today && day.status !== "extra").length,
    dayShifts: worked.filter((day) => day.planned === "day").length,
    nightShifts: worked.filter((day) => day.planned === "night").length,
    targetDays: shiftDays.length,
    leftDays: shiftDays.filter((day) => day.status === "upcoming" || day.status === "missing").length,
    late: count("late"),
    early: days.filter((day) => day.early).length,
    absent: count("absent"),
    leave: count("leave"),
    extra: count("extra"),
  };
}

/** Planned shifts in a row, newest first, that started on time; days off and leave don't break it. */
export function onTimeStreak({ sessions, week, leaves, uid, today, now, since = null, sinceAt = null, lookback = 62 }) {
  let streak = 0;
  for (let back = 0; back < lookback; back += 1) {
    const date = addDays(today, -back);
    if (since && date < since) break;
    const day = dayRecord({ sessions, week, leaves, uid, date, now });
    if (untracked(day, sinceAt)) break;
    if (day.status === "ontime") streak += 1;
    else if (day.status === "late" || day.status === "absent") break;
  }
  return streak;
}

export function nextShift({ week, leaves, uid, now, horizon = 21 }) {
  const today = shiftDateOf(now);
  for (let ahead = 0; ahead < horizon; ahead += 1) {
    const date = addDays(today, ahead);
    const shift = plannedKind(week, date);
    if (shift === "off" || leaveOn(leaves, uid, date)) continue;
    const span = shiftSpan(date, shift);
    if (span.end > now) return { date, shift, ...span, ongoing: span.start <= now };
  }
  return null;
}
