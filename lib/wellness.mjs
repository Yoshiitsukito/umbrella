export function todaySchedule() {
  return [
    { title: "Өглөөний товч", start: "09:00", end: "09:30", kind: "work" },
    { title: "Загварын тойм", start: "10:00", end: "12:00", kind: "work" },
    { title: "Хоол", start: "12:30", end: "13:30", kind: "rest" },
    { title: "Хэрэглэгчийн ярилцлага", start: "15:00", end: "16:30", kind: "work" },
  ];
}

export function workMinutes(schedule = todaySchedule()) {
  return schedule
    .filter((item) => item.kind === "work")
    .reduce((sum, item) => sum + clockSpan(item.start, item.end), 0);
}

export function clockSpan(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 1440;
  return mins;
}

export function hydrationTarget(weightKg, feelsLikeC, busy) {
  const weight = Number(weightKg) > 0 ? Number(weightKg) : 70;
  const feels = Number.isFinite(Number(feelsLikeC)) ? Number(feelsLikeC) : 18;
  const heat = feels >= 28 ? 1.3 : feels >= 22 ? 1.15 : feels < 5 ? 0.95 : 1;
  const activity = busy ? 1.15 : 1;
  const baseMl = Math.round(weight * 35);
  const raw = baseMl * heat * activity;
  const targetMl = Math.round(Math.min(4500, Math.max(1500, raw)) / 50) * 50;
  const reason =
    heat > 1
      ? "Халуун өдөр тул сууриас нэмэв."
      : heat < 1
        ? "Хүйтэн өдөр тул сууриас бага зэрэг бууруулав."
        : "Дулааны нэмэгдэл байхгүй.";
  return { baseMl, heat, activity, targetMl, feelsLikeC: feels, reason };
}

export function energyFromSleep(sleep) {
  const durationMin = Math.round(Number(sleep.durationMin) || 0);
  let score = sleep.score == null || sleep.score === "" ? null : Number(sleep.score);
  if (score == null || Number.isNaN(score)) {
    const hours = durationMin / 60;
    const efficiency = sleep.efficiency == null ? 85 : Number(sleep.efficiency);
    score = Math.round(Math.max(0, Math.min(100, (hours / 8) * 70 + efficiency * 0.3)));
  } else {
    score = Math.round(Math.max(0, Math.min(100, score)));
  }
  let band = "steady";
  if (durationMin < 360 || score < 60) band = "low";
  else if (score >= 80 && durationMin >= 420) band = "high";
  const advice = {
    low: "Богино төвлөрөл: 45 минут ажиллаад 15 минут бос. Оройн хүнд ажлыг маргааш руу шилжүүл.",
    steady: "90 минутын хоёр блок хангалттай. Хоолны дараа 10 минут алх.",
    high: "Гүн төвлөрөлд 2 цаг өгч болно. Үндсэн ажлаа үдээс өмнө хаа.",
  }[band];
  const blocks = {
    low: ["09:00–09:45 нэг чухал ажил", "10:00–10:15 завсарлага", "10:15–11:00 хоёр дахь ажил", "16:00-д өдрийг хаа"],
    steady: ["09:00–10:30 гүн ажил", "10:45–12:00 тойм, уулзалт", "15:00–16:30 хоёр дахь блок"],
    high: ["09:00–11:00 хамгийн хүнд ажил", "11:15–12:30 үргэлжлэл", "15:00–16:30 нэмэлт блок"],
  }[band];
  return { score, band, advice, blocks, durationMin };
}
