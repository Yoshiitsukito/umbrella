// Pure wellbeing arithmetic for the Health and Today pages (shift-aware advice, trends, reminders).
import { CYCLE_WORK_DAYS, LEAVE_LABEL, PLAN_LABEL, WEEKDAY_SHORT, addDays, datesBetween, leaveOn, plannedKind, shiftSpan, weekdayOf } from "./workstats.js";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const TZ_MS = 8 * HOUR_MS;

export const SLEEP_TARGET_MIN = 450;
export const NIGHT_STREAK_LIMIT = 3;
export const BREAK_EVERY_MS = 2 * HOUR_MS;
export const BP_HIGH = { sys: 140, dia: 90 };
export const MOODS = [
  { value: 5, face: "😀", label: "Маш сайн" },
  { value: 4, face: "🙂", label: "Сайн" },
  { value: 3, face: "😐", label: "Дунд" },
  { value: 2, face: "🙁", label: "Муу" },
  { value: 1, face: "😞", label: "Маш муу" },
];
const SHIFT_WORD = { day: "өдрийн", night: "шөнийн" };
export const MEAL_LABEL = { breakfast: "Өглөө", lunch: "Өдөр", dinner: "Орой" };
export const BREATHING = {
  calm: { label: "Тайвшрах 4–6", steps: [["Амьсгал ав", 4], ["Гаргах", 6]] },
  box: { label: "Box 4–4–4–4", steps: [["Амьсгал ав", 4], ["Барих", 4], ["Гаргах", 4], ["Барих", 4]] },
  sleep: { label: "Нойр 4–7–8", steps: [["Амьсгал ав", 4], ["Барих", 7], ["Гаргах", 8]] },
};

export const clockOf = (ms) => new Date(ms + TZ_MS).toISOString().slice(11, 16);
export const localHour = (ms) => new Date(ms + TZ_MS).getUTCHours() + new Date(ms).getUTCMinutes() / 60;
/** Planned shift spans around `today`, skipping days off and approved leave. */
export function spansAround({ week, leaves, uid, today, before = 2, after = 3 }) {
  const spans = [];
  for (let offset = -before; offset <= after; offset += 1) {
    const date = addDays(today, offset);
    const kind = plannedKind(week, date);
    if (kind === "off" || leaveOn(leaves, uid, date)) continue;
    spans.push({ date, kind, ...shiftSpan(date, kind) });
  }
  return spans;
}

function dayWord(now, ms) {
  const ahead = Math.round((Date.parse(new Date(ms + TZ_MS).toISOString().slice(0, 10)) - Date.parse(new Date(now + TZ_MS).toISOString().slice(0, 10))) / DAY_MS);
  return ahead === 0 ? "Өнөөдөр" : ahead === 1 ? "Маргааш" : ahead === -1 ? "Өчигдөр" : WEEKDAY_SHORT[new Date(ms + TZ_MS).getUTCDay()];
}

/** Sleep and energy advice timed to the person's real shifts. */
export function shiftAdvice({ week, leaves, uid, today, now }) {
  const spans = spansAround({ week, leaves, uid, today });
  const current = spans.find((span) => span.start <= now && now < span.end);
  const prev = spans.filter((span) => span.end <= now).at(-1);
  const next = spans.find((span) => span.start > now);
  const tips = [];
  if (current?.kind === "night") {
    tips.push({
      level: "info",
      icon: "moon",
      title: "Шөнийн ээлж явж байна",
      text: `Кофеиныг ${clockOf(current.start + 8 * HOUR_MS)}-аас өмнө дуусга. ${clockOf(current.start + 6 * HOUR_MS)} орчим хөнгөн хоол идээд 10 минут алх. Гэрэл сайтай газар ажилла.`,
    });
  } else if (current?.kind === "day") {
    tips.push({ level: "info", icon: "sun", title: "Өдрийн ээлж явж байна", text: `2 цаг тутам 5 минут босч алх. Үдийн хоолоо алгасахгүй, ${clockOf(current.start + 7 * HOUR_MS)}-аас хойш кофеиныг багасга.` });
  }
  if (!current && prev?.kind === "night" && now - prev.end < 10 * HOUR_MS) {
    const from = prev.end + 30 * MINUTE_MS;
    tips.push({
      level: "warn",
      icon: "moon",
      title: "Шөнийн ээлжийн дараа унт",
      text: `${clockOf(from)}–${clockOf(from + 7 * HOUR_MS)} хооронд 7 цаг унт. Өрөөгөө харанхуй, сэрүүн, чимээгүй байлга. Гэр рүүгээ нарны шил зүүвэл нойр хурдан хүрнэ.`,
    });
  }
  if (!current && next && next.start - now < 30 * HOUR_MS) {
    if (next.kind === "day") {
      const bed = next.start - 9 * HOUR_MS;
      const wake = next.start - 90 * MINUTE_MS;
      if (prev?.kind === "night" && next.start - prev.end < 36 * HOUR_MS) {
        tips.push({ level: "warn", icon: "sun", title: "Шөнөөс өдрийн ээлж рүү шилжинэ", text: `Өдөр 3–4 цаг л унтаад, орой ${clockOf(bed)}-д унт. ${dayWord(now, next.start)} ${clockOf(next.start)}-д ээлж эхэлнэ.` });
      } else if (now < bed + 2 * HOUR_MS) {
        tips.push({ level: "info", icon: "sun", title: `${dayWord(now, next.start)} ${clockOf(next.start)}-д өдрийн ээлж`, text: `${clockOf(bed)}-аас өмнө унтаж, ${clockOf(wake)}-д бос. 7.5 цаг нойр төвлөрөл, хариу үйлдлийг хамгаална.` });
      }
    } else {
      const napFrom = next.start - 6 * HOUR_MS;
      tips.push({
        level: "info",
        icon: "moon",
        title: `${dayWord(now, next.start)} ${clockOf(next.start)}-д шөнийн ээлж`,
        text: `${clockOf(napFrom)}–${clockOf(napFrom + 2 * HOUR_MS)} хооронд 1.5 цаг унтаж ав. Ээлжээс 2 цагийн өмнө хоолло, хүнд хоол бүү ид.`,
      });
    }
  }
  if (!current && (!next || next.start - now >= 30 * HOUR_MS)) {
    tips.push({ level: "ok", icon: "rest", title: "Амралтын өдөр", text: "Өглөө ердийн цагтаа бос, гадаа 20 минут нар үз. Унтах, сэрэх цагаа 1 цагаас илүү бүү өөрчил." });
  }
  return tips.slice(0, 3);
}

/** Days worked in a row up to today, days off worked this week, and the run of planned night shifts around today. */
export function workload({ sessions, week, leaves, uid, today, now }) {
  const workedOn = new Set(sessions.filter((item) => item.start <= now).map((item) => item.date));
  let workStreak = 0;
  for (let date = workedOn.has(today) ? today : addDays(today, -1); workedOn.has(date) && workStreak < 60; date = addDays(date, -1)) workStreak += 1;
  const extraDays = datesBetween(addDays(today, -6), today).filter((date) => workedOn.has(date) && plannedKind(week, date) === "off").length;
  const isNight = (date) => plannedKind(week, date) === "night" && !leaveOn(leaves, uid, date);
  let anchor = isNight(today) ? today : isNight(addDays(today, -1)) ? addDays(today, -1) : isNight(addDays(today, 1)) ? addDays(today, 1) : null;
  let streak = 0;
  let first = anchor;
  let last = anchor;
  if (anchor) {
    while (isNight(addDays(first, -1)) && streak < 14) {
      first = addDays(first, -1);
      streak += 1;
    }
    while (isNight(addDays(last, 1)) && streak < 28) {
      last = addDays(last, 1);
      streak += 1;
    }
    streak += 1;
  }
  const warnings = [];
  if (workStreak > CYCLE_WORK_DAYS) {
    warnings.push({ level: "danger", text: `${workStreak} өдөр амралтгүй ажилласан (7-7-14 эргэлтийн ${CYCLE_WORK_DAYS} өдрөөс илүү). Ядаргааны эрсдэл өндөр: 14 хоногийн амралтаа бүрэн ав, илүү цаг бүү ав.` });
  } else if (extraDays) {
    warnings.push({ level: "warn", text: `Сүүлийн 7 хоногт амралтын ${extraDays} өдөр ажилласан. Эргэлтийн амралтаа алдахгүй байхыг хичээ.` });
  }
  if (streak >= NIGHT_STREAK_LIMIT) {
    const span = `${first.slice(5).replace("-", ".")}–${last.slice(5).replace("-", ".")}`;
    warnings.push({ level: "warn", text: `${streak} шөнө дараалсан ээлж (${span}). Ядаргааны эрсдэлтэй: ээлж бүрийн дараа 7 цаг унтаж, ээлжийн дараа машин барихаас болгоомжил.` });
  }
  return { workStreak, extraDays, nightStreak: streak, warnings };
}

/** Sleep shortfall over the last 7 recorded nights against the 7.5 h target. */
export function sleepDebt({ days, today, week, leaves, uid }) {
  const nights = datesBetween(addDays(today, -6), today).filter((date) => days[date]?.sleep);
  const slept = nights.reduce((sum, date) => sum + days[date].sleep.min, 0);
  const debtMin = Math.max(0, nights.length * SLEEP_TARGET_MIN - slept);
  let offDay = null;
  for (let ahead = 1; ahead <= 14 && !offDay; ahead += 1) {
    const date = addDays(today, ahead);
    if (plannedKind(week, date) === "off" || leaveOn(leaves, uid, date)) offDay = date;
  }
  let advice = "";
  if (nights.length) {
    if (debtMin < 60) advice = "Нойрны өр алга. Ингээд тогтмол үргэлжлүүл.";
    else {
      const when = offDay ? `${WEEKDAY_SHORT[weekdayOf(offDay)]} гарагт (${offDay.slice(5).replace("-", ".")}) ` : "Амралтын өдөр ";
      const extra = Math.min(120, Math.max(60, Math.round(debtMin / 3 / 15) * 15));
      advice = `${when}${Math.floor(extra / 60)} цаг${extra % 60 ? ` ${extra % 60} мин` : ""} илүү унтаж нөхөөрэй. 2 цагаас илүү унтвал хэмнэл алдагдана; өдөр 20 минутын богино нойр ч тусална.`;
    }
  }
  return { nights: nights.length, slept, debtMin, avgMin: nights.length ? Math.round(slept / nights.length) : 0, offDay, advice };
}

/** 7-day averages and the run of latest readings at or above 140/90. */
export function bpStats(vitals, now) {
  const readings = vitals.filter((item) => item.sys && item.dia);
  const recent = readings.filter((item) => now - Date.parse(item.at) < 7 * DAY_MS);
  const avg = (key) => Math.round(recent.reduce((sum, item) => sum + item[key], 0) / recent.length);
  let highStreak = 0;
  for (const item of [...readings].reverse()) {
    if (item.sys >= BP_HIGH.sys || item.dia >= BP_HIGH.dia) highStreak += 1;
    else break;
  }
  return {
    avg7: recent.length ? { sys: avg("sys"), dia: avg("dia"), n: recent.length } : null,
    highStreak,
    alert: highStreak >= 3,
  };
}

export const TRENDS = {
  sleep: { label: "Нойр", unit: "цаг", target: () => SLEEP_TARGET_MIN / 60 },
  steps: { label: "Алхам", unit: "", target: () => 8000 },
  bp: { label: "Даралт", unit: "мм МУБ", target: () => BP_HIGH.sys },
  weight: { label: "Жин", unit: "кг", target: () => null },
  mood: { label: "Сэтгэл", unit: "/5", target: () => null },
};

/** One value per day for a metric (null when nothing was logged). */
export function trendSeries(metric, { days, vitals, from, to }) {
  return datesBetween(from, to).map((date) => {
    const day = days[date] || {};
    let value = null;
    let low = null;
    if (metric === "sleep") value = day.sleep ? Math.round((day.sleep.min / 60) * 10) / 10 : null;
    if (metric === "steps") value = day.steps ?? null;
    if (metric === "weight") value = day.weight ?? null;
    if (metric === "mood") value = day.mood ?? null;
    if (metric === "bp") {
      const same = vitals.filter((item) => item.sys && new Date(Date.parse(item.at) + TZ_MS).toISOString().slice(0, 10) === date);
      if (same.length) {
        value = Math.round(same.reduce((sum, item) => sum + item.sys, 0) / same.length);
        low = Math.round(same.reduce((sum, item) => sum + item.dia, 0) / same.length);
      }
    }
    return { date, value, low };
  });
}

/** Average mood by shift kind and by how long the person slept that night. */
export function moodLinks({ days, week, leaves, uid, from, to }) {
  const groups = { day: [], night: [], off: [], short: [], fair: [], good: [] };
  for (const date of datesBetween(from, to)) {
    const day = days[date];
    if (!day?.mood) continue;
    const kind = leaveOn(leaves, uid, date) ? "off" : plannedKind(week, date);
    groups[kind].push(day.mood);
    if (day.sleep) groups[day.sleep.min < 360 ? "short" : day.sleep.min < SLEEP_TARGET_MIN ? "fair" : "good"].push(day.mood);
  }
  const row = (key, label) => ({ key, label, n: groups[key].length, avg: groups[key].length ? Math.round((groups[key].reduce((a, b) => a + b, 0) / groups[key].length) * 10) / 10 : null });
  return {
    shifts: [row("day", PLAN_LABEL.day), row("night", PLAN_LABEL.night), row("off", PLAN_LABEL.off)],
    sleep: [row("short", "6 цагаас бага"), row("fair", "6–7.5 цаг"), row("good", "7.5+ цаг")],
  };
}

export const STEP_GOAL = 8000;
export const ACTIVE_WEEK_GOAL = 150;
const HR_RISE = 7;

const average = (list) => (list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null);

/**
 * Advice from what a smartwatch tracks (sleep, steps, active minutes, blood pressure, resting heart rate),
 * read against the person's shifts. Worst news first, at most five tips.
 */
export function watchAdvice({ days, vitals, today, now, week, leaves, uid }) {
  const kindOn = (date) => (leaveOn(leaves, uid, date) ? "off" : plannedKind(week, date));
  const kind = kindOn(today);
  const nextNight = kind === "night" || kindOn(addDays(today, 1)) === "night";
  const last7 = datesBetween(addDays(today, -6), today);
  const nights = last7.map((date) => days[date]?.sleep?.min).filter((min) => min != null);
  const lastSleep = days[today]?.sleep?.min ?? days[addDays(today, -1)]?.sleep?.min ?? null;
  const steps = last7.slice(0, -1).map((date) => days[date]?.steps).filter((value) => value != null);
  const todaySteps = days[today]?.steps || 0;
  const activeWeek = last7.reduce((sum, date) => sum + (days[date]?.active || 0), 0);
  const recent = (from, to) => vitals.filter((item) => item.hr && now - Date.parse(item.at) >= from * DAY_MS && now - Date.parse(item.at) < to * DAY_MS).map((item) => item.hr);
  const hrNow = average(recent(0, 7));
  const hrBefore = average(recent(7, 28));
  const bp = bpStats(vitals, now);
  const latestBp = vitals.filter((item) => item.sys && item.dia).at(-1);
  const bpAge = latestBp ? (now - Date.parse(latestBp.at)) / DAY_MS : Infinity;
  const tips = [];
  const add = (rank, level, icon, title, text) => tips.push({ rank, level, icon, title, text });

  const short = lastSleep != null && lastSleep < 360;
  const tired = short && hrNow != null && hrBefore != null && hrNow - hrBefore >= HR_RISE;
  if (tired) {
    add(0, "danger", "warn", "Ядаргааны шинж", `Нойр ${Math.round((lastSleep / 60) * 10) / 10} цаг, тайван үеийн зүрхний цохилт ${Math.round(hrNow - hrBefore)}-аар өссөн. Өнөөдөр нэмэлт ачаалал бүү ав, ээлжийн дараа машин барихаас болгоомжил.`);
  }

  if (latestBp && bpAge < 7 && (latestBp.sys >= BP_HIGH.sys || latestBp.dia >= BP_HIGH.dia)) {
    add(bp.alert ? 0 : 1, bp.alert ? "danger" : "warn", "heart", `Даралт ${latestBp.sys}/${latestBp.dia}`, bp.alert ? `Сүүлийн ${bp.highStreak} хэмжилт дараалан 140/90-ээс дээш. Эмчид үзүүлээрэй.` : "5 минут тайван суугаад дахин хэмж. Давс, кофеин багасгаж, өнөөдөр 20 минут алх.");
  } else if (bp.avg7 && (bp.avg7.sys >= 130 || bp.avg7.dia >= 85)) {
    add(2, "warn", "heart", `7 хоногийн дундаж даралт ${bp.avg7.sys}/${bp.avg7.dia}`, "Хэвийнээс арай өндөр. Давсыг багасгаж, өдөр бүр 30 минут хөдөлж, долоо хоногт 3 удаа хэмж.");
  } else if (bpAge > 7) {
    add(4, "info", "heart", "Даралтаа хэмжих цаг боллоо", latestBp ? "Сүүлийн хэмжилтээс 7 хоног өнгөрсөн. Цаг эсвэл аппаратаар хэмжээд оруулаарай." : "Даралтаа долоо хоногт 2 удаа хэмжиж оруулбал өөрчлөлтийг эрт анзаарна.");
  }

  if (lastSleep == null && !nights.length) {
    add(3, "info", "moon", "Нойрны мэдээлэл алга", "Цагныхаа апп-аас унтсан, сэрсэн цагаа хуулж оруулбал ээлжид тохирсон нойрны зөвлөгөө гарна.");
  } else if (short && !tired) {
    add(1, "warn", "moon", `Сүүлийн нойр ${Math.round((lastSleep / 60) * 10) / 10} цаг`, nextNight ? "Шөнийн ээлжээс өмнө 14:00–16:00 хооронд 90 минут унтаж ав." : "Өнөө орой ердийнхөөсөө 1 цагийн өмнө унт. Унтахаас 1 цагийн өмнө утсаа тавь.");
  } else if (nights.length >= 3 && average(nights) >= SLEEP_TARGET_MIN) {
    add(5, "ok", "moon", "Нойр хангалттай", `7 хоногийн дундаж ${Math.round((average(nights) / 60) * 10) / 10} цаг. Ингээд тогтмол үргэлжлүүл.`);
  }

  if (hrNow != null && hrBefore != null && hrNow - hrBefore >= HR_RISE && !tired) {
    add(2, "warn", "heart", "Тайван үеийн цохилт өссөн", `Энэ 7 хоногт дунджаар ${Math.round(hrNow)}, өмнө нь ${Math.round(hrBefore)}. Ядаргаа, ханиад эхэлж буйн шинж байж болно: амралт, нойроо нэм.`);
  } else if (hrNow != null && hrNow > 100) {
    add(2, "warn", "heart", `Тайван үеийн цохилт ${Math.round(hrNow)}`, "Тайван үед 100-аас дээш байвал кофеин, стресс, нойроо шалга. Удаан үргэлжилбэл эмчид хандаарай.");
  }

  const stepsAvg = average(steps);
  if (stepsAvg != null && stepsAvg < 5000) {
    add(3, "warn", "steps", `Дунджаар ${Math.round(stepsAvg)} алхам`, kind === "off" ? "Амралтын өдөр гадаа 40 минут алхвал 8000-д хүрнэ." : "Ээлжийн завсарлага бүрт 10 минут алх. Шат ашиглавал өдөрт 2000 алхам нэмэгдэнэ.");
  } else if (localHour(now) >= 15 && todaySteps < STEP_GOAL && todaySteps > 0) {
    add(4, "info", "steps", `Өнөөдөр ${todaySteps} алхам`, `Зорилт хүртэл ${STEP_GOAL - todaySteps} алхам. Орой 20 минут алхвал хүрнэ.`);
  }
  if (activeWeek < ACTIVE_WEEK_GOAL && (stepsAvg != null || activeWeek > 0)) {
    add(4, "info", "steps", `Идэвхтэй ${activeWeek}/${ACTIVE_WEEK_GOAL} минут`, `Энэ 7 хоногт ${ACTIVE_WEEK_GOAL - activeWeek} минут дутуу. ${kind === "night" ? "Шөнийн ээлжийн өмнө хүнд дасгал бүү хий, хөнгөн алхалт хангалттай." : "Өдөрт 20–30 минут хурдан алхах хангалттай."}`);
  }

  tips.sort((a, b) => a.rank - b.rank);
  return {
    tips: tips.slice(0, 5).map(({ rank, ...tip }) => tip),
    stats: {
      sleepAvgMin: nights.length ? Math.round(average(nights)) : null,
      lastSleepMin: lastSleep,
      stepsAvg: stepsAvg == null ? null : Math.round(stepsAvg),
      activeWeek,
      hrAvg: hrNow == null ? null : Math.round(hrNow),
      hrBefore: hrBefore == null ? null : Math.round(hrBefore),
      bp: latestBp && bpAge < 7 ? { sys: latestBp.sys, dia: latestBp.dia } : null,
    },
  };
}

/** Heart-rate zone of a live Bluetooth reading. */
export function pulseZone(bpm) {
  if (!bpm) return { key: "none", label: "–" };
  if (bpm < 50) return { key: "low", label: "Бага" };
  if (bpm <= 90) return { key: "rest", label: "Тайван" };
  if (bpm <= 120) return { key: "light", label: "Хөнгөн ачаалал" };
  if (bpm <= 150) return { key: "work", label: "Дунд ачаалал" };
  return { key: "high", label: "Өндөр ачаалал" };
}

/** Parses a Bluetooth GATT heart_rate_measurement value (flags byte, then 8- or 16-bit bpm). */
export function parseHeartRate(view) {
  const flags = view.getUint8(0);
  return flags & 1 ? view.getUint16(1, true) : view.getUint8(1);
}

/** How many 2-hour blocks someone has been on site since checking in. */
export function breakIndex(since, now) {
  return since ? Math.floor((now - since) / BREAK_EVERY_MS) : 0;
}

/** Weather at the moment a shift ends, with what to wear for the trip home. */
export function departureAdvice(hourly, endMs) {
  if (!hourly?.length || !endMs) return null;
  const target = new Date(endMs + TZ_MS).toISOString().slice(0, 13);
  const hour = hourly.find((item) => item.time.slice(0, 13) === target);
  if (!hour) return null;
  const tips = [];
  if (hour.tempC <= -25) tips.push("Маш хүйтэн: дулаан гутал, малгай, бээлий, нүүрний хаалт заавал");
  else if (hour.tempC <= -5) tips.push("Хүйтэн: давхар хувцаслаж, малгай, бээлийтэй гар");
  else if (hour.tempC <= 5) tips.push("Сэрүүн: хүрэм, малгай авч яв");
  else if (hour.tempC >= 28) tips.push("Халуун: ус авч яв");
  if (hour.precipProb >= 50) tips.push(hour.tempC <= 0 ? "цас орох магадлалтай, гулгаанаас болгоомжил" : "бороо орох магадлалтай, шүхэр ав");
  if (hour.windSpeedMs >= 8) tips.push("салхи хүчтэй");
  const advice = tips.length ? `${tips.join(", ")}.` : "Онцгой бэлтгэл хэрэггүй.";
  return {
    at: endMs,
    tempC: Math.round(hour.tempC),
    windSpeedMs: hour.windSpeedMs,
    precipProb: hour.precipProb,
    code: hour.code,
    isDay: hour.isDay,
    advice,
    text: `${clockOf(endMs)}-д ${Math.round(hour.tempC)}°, салхи ${hour.windSpeedMs.toFixed(0)} м/с. ${advice}`,
  };
}

/** The spoken morning briefing Red King reads on the Today page. */
export function briefingText({ name, now, shift, leave, weather, air, reminders, announcements, birthdays, debt }) {
  const parts = [];
  const hour = localHour(now);
  const hello = hour < 12 ? "Өглөөний мэнд" : hour < 18 ? "Өдрийн мэнд" : "Оройн мэнд";
  parts.push(`${hello}${name ? `, ${name}` : ""}.`);
  if (leave) parts.push(`Өнөөдөр та чөлөөтэй: ${LEAVE_LABEL[leave.type].toLowerCase()}.`);
  else if (shift) parts.push(`Өнөөдөр ${SHIFT_WORD[shift.kind]} ээлж, ${clockOf(shift.start)}-аас ${clockOf(shift.end)} хүртэл.`);
  else parts.push("Өнөөдөр амралтын өдөр.");
  if (weather) parts.push(`Одоо ${Math.round(weather.tempC)} хэм, мэдрэмж ${Math.round(weather.feelsLikeC)} хэм. ${weather.condition}.`);
  if (air?.aqi > 100) parts.push(`Агаарын чанар ${air.label.toLowerCase()}, амны хаалт зүүгээрэй.`);
  if (debt?.debtMin >= 60) parts.push(`Энэ долоо хоногт ${Math.round(debt.debtMin / 60)} цаг орчим нойр дутуу байна.`);
  const open = (reminders || []).filter((item) => !item.done);
  if (open.length) parts.push(`Сануулга ${open.length}: ${open.slice(0, 3).map((item) => `${item.due ? `${item.due}-д ` : ""}${item.title}`).join("; ")}.`);
  const unread = (announcements || []).filter((item) => !item.read);
  if (unread.length) parts.push(`Шинэ зарлал: ${unread[0].text}`);
  const todays = (birthdays || []).filter((item) => item.inDays === 0);
  if (todays.length) parts.push(`Өнөөдөр төрсөн өдөр нь: ${todays.map((item) => item.name).join(", ")}. Мэндчилгээ дэвшүүлээрэй.`);
  parts.push("Сайхан өдөр өнгөрүүлээрэй.");
  return parts.join(" ");
}
