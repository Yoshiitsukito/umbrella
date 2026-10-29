export const STEP_GOAL = 8000;
export const ACTIVE_GOAL = 30;

export function bmiInfo(weightKg, heightCm) {
  const weight = Number(weightKg);
  const height = Number(heightCm) / 100;
  if (!(weight > 0) || !(height > 0)) return null;
  const value = Math.round((weight / (height * height)) * 10) / 10;
  let band = "normal";
  let label = "Хэвийн жин";
  if (value < 18.5) {
    band = "low";
    label = "Жингийн дутагдал";
  } else if (value >= 30) {
    band = "high";
    label = "Таргалалт";
  } else if (value >= 25) {
    band = "elevated";
    label = "Илүүдэл жин";
  }
  return { value, band, label };
}

export function bloodPressureBand(sys, dia) {
  if (!(sys > 0) || !(dia > 0)) return null;
  if (sys > 180 || dia > 120) return { band: "crisis", label: "Яаралтай өндөр", advice: "Дахин хэмжээд ийм хэвээр бол яаралтай тусламж (103) дуудна уу." };
  if (sys >= 140 || dia >= 90) return { band: "stage2", label: "Даралт ихсэлт, 2-р зэрэг", advice: "Эмчид ойрын хугацаанд үзүүлнэ үү." };
  if (sys >= 130 || dia >= 80) return { band: "stage1", label: "Даралт ихсэлт, 1-р зэрэг", advice: "Давс багасгаж, хөдөлгөөнөө нэмээд эмчтэй зөвлөлдөнө үү." };
  if (sys >= 120) return { band: "elevated", label: "Бага зэрэг өндөр", advice: "Давс, стрессээ хянаж, өдөр бүр алхаарай." };
  if (sys < 90 || dia < 60) return { band: "low", label: "Даралт бага", advice: "Толгой эргэх бол ус ууж, суугаад амраарай." };
  return { band: "normal", label: "Хэвийн", advice: "Сайн байна." };
}

export function heartRateBand(bpm) {
  if (!(bpm > 0)) return null;
  if (bpm > 100) return { band: "high", label: "Тайван үеийн цохилт өндөр" };
  if (bpm < 50) return { band: "low", label: "Цохилт бага (тамирчин бол хэвийн)" };
  return { band: "normal", label: "Хэвийн" };
}

export function airInfo(air) {
  if (!air || !Number.isFinite(air.usAqi)) return null;
  const aqi = air.usAqi;
  const levels = [
    [50, "good", "Сайн", "Гадаа алхахад тохиромжтой."],
    [100, "moderate", "Дунд зэрэг", "Мэдрэмтгий хүмүүс гадаа удаан хүнд ачаалал хийхгүй байх."],
    [150, "sensitive", "Мэдрэмтгий бүлэгт муу", "Хүүхэд, ахмад, астматай хүн гадаа бага байж, KN95 амны хаалт зүүнэ."],
    [200, "bad", "Муу", "Гадаа дасгал хийхгүй. KN95/N95 амны хаалт зүүж, агаар цэвэршүүлэгч асаана."],
    [300, "very-bad", "Маш муу", "Аль болох гадаа гарахгүй, цонхоо хаана."],
    [Infinity, "hazard", "Аюултай", "Гадаа гарахгүй. Амьсгал давчдвал эмчид хандана."],
  ];
  const [, band, label, advice] = levels.find(([limit]) => aqi <= limit);
  const uv = Number.isFinite(air.uv) ? air.uv : null;
  let uvAdvice = null;
  if (uv != null) {
    if (uv >= 8) uvAdvice = "UV маш өндөр: 11–16 цагт сүүдэрт байж, SPF 50 түрхэнэ.";
    else if (uv >= 6) uvAdvice = "UV өндөр: малгай, нарны шил, SPF 30+ хэрэгтэй.";
    else if (uv >= 3) uvAdvice = "UV дунд: удаан гадаа байвал нарны тос түрхэнэ.";
    else uvAdvice = "UV бага.";
  }
  return { aqi, band, label, advice, pm25: air.pm25, pm10: air.pm10, uv, uvAdvice, time: air.time };
}

export function climateAdvice(feelsLikeC) {
  const feels = Number(feelsLikeC);
  if (!Number.isFinite(feels)) return null;
  if (feels <= -48) return { band: "danger", text: `Мэдрэмж ${Math.round(feels)}°C: ил арьс 5 минут хүрэхгүйд хөлдөнө. Гадаа гарахаас зайлсхий.` };
  if (feels <= -40) return { band: "danger", text: `Мэдрэмж ${Math.round(feels)}°C: ил арьс 5–10 минутад хөлдөнө. Нүүр, гараа бүрэн хучаарай.` };
  if (feels <= -28) return { band: "warn", text: `Мэдрэмж ${Math.round(feels)}°C: ил арьс 10–30 минутад хөлдөж болно. Бээлий, малгай, ороолт заавал.` };
  if (feels <= -10) return { band: "warn", text: `Мэдрэмж ${Math.round(feels)}°C: давхар хувцаслаж, чих, гараа дулаан байлга.` };
  if (feels >= 35) return { band: "danger", text: `Мэдрэмж ${Math.round(feels)}°C: халууны цохилтын эрсдэлтэй. Сүүдэрт байж, ус ойр ойрхон уу.` };
  if (feels >= 30) return { band: "warn", text: `Мэдрэмж ${Math.round(feels)}°C: халуун. 11–16 цагт хүнд ачаалал хийхгүй.` };
  return { band: "ok", text: `Мэдрэмж ${Math.round(feels)}°C: дулааны хувьд эрсдэлгүй.` };
}

function airScore(aqi) {
  if (aqi <= 50) return 1;
  if (aqi <= 100) return 0.8;
  if (aqi <= 150) return 0.55;
  if (aqi <= 200) return 0.3;
  return 0.1;
}

export function healthSummary({ drunkMl, targetMl, energy, steps, activeMin, vision, air, vitals, climate, hour, today }) {
  const parts = [];
  const tips = [];
  const expected = targetMl ? targetMl * Math.max(0, Math.min(1, (hour - 7) / 14)) : 0;
  if (targetMl) {
    parts.push({ id: "water", label: "Ус", value: Math.min(1, drunkMl / targetMl), weight: 25 });
    if (drunkMl + 150 < expected) tips.push({ level: "info", text: `Одоогийн байдлаар ${Math.round(expected - drunkMl)} мл ус дутуу байна. Нэг аяга ус уугаарай.` });
  }
  if (energy) {
    parts.push({ id: "sleep", label: "Нойр", value: energy.score / 100, weight: 25 });
    if (energy.band === "low") tips.push({ level: "info", text: "Нойр дутуу: өнөөдөр кофеиныг 14 цагаас хойш хэрэглэхгүй, 22:30-д унтахыг зорь." });
  }
  parts.push({
    id: "move",
    label: "Хөдөлгөөн",
    value: Math.min(1, 0.7 * (steps / STEP_GOAL) + 0.3 * (activeMin / ACTIVE_GOAL)),
    weight: 25,
  });
  const visionToday = vision && !vision.withheld && vision.at && vision.at.slice(0, 10) === today ? vision : null;
  if (visionToday) {
    parts.push({ id: "mind", label: "Стресс", value: 1 - visionToday.stress, weight: 15 });
    if (visionToday.stress >= 0.6) tips.push({ level: "info", text: "Камерын үнэлгээгээр стресс өндөр байна. 60 секундийн амьсгалын дасгал хийгээрэй." });
  }
  if (air) {
    parts.push({ id: "air", label: "Агаар", value: airScore(air.aqi), weight: 10 });
    if (air.aqi > 100) tips.push({ level: "warn", text: `Агаарын чанар ${air.label} (AQI ${air.aqi}). ${air.advice}` });
  }
  const bp = vitals?.bp;
  if (bp && ["stage2", "crisis"].includes(bp.band)) tips.unshift({ level: "danger", text: `Даралт ${bp.label}. ${bp.advice}` });
  if (climate && climate.band !== "ok") tips.push({ level: climate.band === "danger" ? "danger" : "warn", text: climate.text });
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = Math.round((parts.reduce((sum, part) => sum + part.value * part.weight, 0) / total) * 100);
  const band = score >= 80 ? "good" : score >= 55 ? "ok" : "low";
  return {
    score,
    band,
    parts: parts.map(({ id, label, value }) => ({ id, label, pct: Math.round(value * 100) })),
    tips: tips.slice(0, 5),
  };
}

export async function fetchAir(lat, lng) {
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lng));
  url.searchParams.set("current", "us_aqi,pm2_5,pm10,uv_index");
  url.searchParams.set("timezone", "auto");
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const data = await res.json();
  if (!res.ok) throw new Error(`Агаарын чанар: ${data?.reason || res.status}`);
  const current = data.current || {};
  const num = (value) => (Number.isFinite(Number(value)) && value !== null ? Number(value) : null);
  return {
    usAqi: num(current.us_aqi),
    pm25: num(current.pm2_5),
    pm10: num(current.pm10),
    uv: num(current.uv_index),
    time: current.time || null,
    lat,
    lng,
    fetchedAt: new Date().toISOString(),
  };
}
