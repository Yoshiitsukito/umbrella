import { cycleLabel, gfsData, insideBox, neighbourhoodProbability, sampleAt, sampleFrame } from "./gfs.mjs";

export function windFrom(deg) {
  const names = ["хойд", "зүүн хойд", "зүүн", "зүүн урд", "урд", "баруун урд", "баруун", "баруун хойд"];
  const turn = ((Number(deg) % 360) + 360) % 360;
  return names[Math.round(turn / 45) % 8];
}

export function conditionLabel(code) {
  const map = {
    0: "Цэлмэг",
    1: "Ерөнхийдөө цэлмэг",
    2: "Үүлшинэ",
    3: "Бүрхэг",
    45: "Манан",
    48: "Хяруутай манан",
    51: "Шиврээ бороо",
    53: "Шиврээ бороо",
    55: "Шиврээ бороо",
    61: "Бороо",
    63: "Бороо",
    65: "Ширүүн бороо",
    71: "Цас",
    73: "Цас",
    75: "Ширүүн цас",
    77: "Цасан ширхэг",
    80: "Аадар бороо",
    81: "Аадар бороо",
    82: "Ширүүн аадар",
    85: "Цасан шамарга",
    86: "Цасан шамарга",
    95: "Аянга",
    96: "Мөндөртэй аянга",
    99: "Мөндөртэй аянга",
  };
  return map[code] || "Тодорхойгүй нөхцөл";
}

export function precipKind(code, tempC) {
  if ([71, 73, 75, 77, 85, 86].includes(code) || tempC <= 0) return "snow";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(code)) return "rain";
  return tempC <= 0 ? "snow" : "rain";
}

export function parseLocalIso(iso, offsetSeconds = 28800) {
  const [date, time] = String(iso).split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - offsetSeconds * 1000;
}

export function classifyPrecip(slots, nowMs, tempC, weatherCode, offsetSeconds = 28800) {
  const parsed = slots
    .map((slot) => ({ ...slot, t: parseLocalIso(slot.time, offsetSeconds) }))
    .sort((a, b) => a.t - b.t);
  const wet = (slot) => slot && slot.precipMm >= 0.1;
  const current =
    parsed.find((slot) => Math.abs(slot.t - nowMs) <= 8 * 60 * 1000) ||
    [...parsed].reverse().find((slot) => slot.t <= nowMs);
  const kind = precipKind(weatherCode, tempC);
  if (wet(current)) {
    const word = kind === "snow" ? "Цас" : "Бороо";
    return { status: "ongoing", kind, text: `${word} одоо орж байна.` };
  }
  const upcoming = parsed.find((slot) => slot.t > nowMs && slot.t - nowMs <= 20 * 60 * 1000 && wet(slot));
  if (!upcoming) {
    return { status: "clear", kind: "none", text: "Ойрын 20 минутад хур тунадас харагдахгүй." };
  }
  const inMin = Math.max(1, Math.round((upcoming.t - nowMs) / 60000));
  const word = kind === "snow" ? "Цас" : "Бороо";
  return {
    status: "approaching",
    kind,
    inMin,
    text: `${word} ойролцоогоор ${inMin} минутын дараа орж эхэлнэ.`,
  };
}

export function briefingSentence(weather) {
  const temp = Math.round(weather.tempC);
  const feels = Math.round(weather.feelsLikeC);
  const wind = `${weather.windSpeedMs.toFixed(1)} м/с, ${windFrom(weather.windDirDeg)} зүгээс`;
  const later = (weather.hourly || []).find((hour) => hour.precipProb >= 50);
  const extra = later ? ` ${later.label} цаг орчимд хур тунадасны магадлал ${later.precipProb}%.` : "";
  return `Өнөөдөр ${temp}°C, салхи ${wind}. Мэдрэмж ${feels}°C. ${weather.condition}.${extra}`;
}

const LOCAL_OFFSET_S = 28800;
const HOUR_MS = 3600 * 1000;
const SLOT_MS = 15 * 60 * 1000;

export function localIso(ms, offsetSeconds = LOCAL_OFFSET_S) {
  return new Date(ms + offsetSeconds * 1000).toISOString().slice(0, 16);
}

export function windFromVector(u, v) {
  return ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
}

export function apparentTemperature(tempC, rh, windMs) {
  const vapour = (rh / 100) * 6.105 * Math.exp((17.27 * tempC) / (237.7 + tempC));
  return tempC + 0.33 * vapour - 0.7 * windMs - 4;
}

export function weatherCodeFrom({ precipMmH, snow, cloud, tempC }) {
  if (precipMmH >= 0.1) {
    if (snow || tempC <= 0) return precipMmH < 1 ? 71 : precipMmH < 4 ? 73 : 75;
    return precipMmH < 0.5 ? 51 : precipMmH < 2.5 ? 61 : precipMmH < 7.6 ? 63 : 65;
  }
  if (cloud < 20) return 0;
  if (cloud < 50) return 1;
  if (cloud < 80) return 2;
  return 3;
}

export function sunElevation(lat, lng, ms) {
  const date = new Date(ms);
  const dayOfYear = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);
  const decl =
    0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  const solarMinutes = hours * 60 + eqTime + 4 * lng;
  const hourAngle = ((solarMinutes / 4 - 180) * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  const cosZenith = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  return 90 - (Math.acos(Math.max(-1, Math.min(1, cosZenith))) * 180) / Math.PI;
}

function describe(sample, lat, lng, ms) {
  const windSpeedMs = Math.hypot(sample.u, sample.v);
  const code = weatherCodeFrom(sample);
  return {
    tempC: Math.round(sample.tempC * 10) / 10,
    windSpeedMs: Math.round(windSpeedMs * 10) / 10,
    windDirDeg: Math.round(windFromVector(sample.u, sample.v)),
    feelsLikeC: Math.round(apparentTemperature(sample.tempC, sample.rh, windSpeedMs) * 10) / 10,
    code,
    isDay: sunElevation(lat, lng, ms) > -0.833,
  };
}

export async function fetchForecast(lat, lng) {
  const data = await gfsData();
  if (!insideBox(lat, lng)) throw new Error("Байршил NOAA GFS татсан бүсээс гадуур байна (.env: GFS_BBOX)");
  const now = Date.now();
  const sample = sampleAt(data, lat, lng, now);
  const current = describe(sample, lat, lng, now);
  const startHour = Math.floor(now / HOUR_MS) * HOUR_MS;
  const hourly = data.frames
    .map((frame, index) => ({ frame, index }))
    .filter(({ frame }) => frame.valid >= startHour)
    .slice(0, 24)
    .map(({ frame, index }) => {
      const point = describe(sampleFrame(frame, lat, lng), lat, lng, frame.valid);
      const time = localIso(frame.valid);
      return {
        time,
        label: time.slice(11, 16),
        tempC: point.tempC,
        precipProb: neighbourhoodProbability(data, index, lat, lng),
        windSpeedMs: point.windSpeedMs,
        code: point.code,
        isDay: point.isDay,
      };
    });
  const slots = [];
  const first = data.frames[0].valid;
  const last = data.frames.at(-1).valid;
  for (let t = Math.max(first, Math.floor((now - HOUR_MS) / SLOT_MS) * SLOT_MS); t <= Math.min(last, now + 6 * HOUR_MS); t += SLOT_MS) {
    slots.push({ time: localIso(t), precipMm: Math.round((sampleAt(data, lat, lng, t).precipMmH / 4) * 100) / 100 });
  }
  const weather = {
    observedAt: localIso(Math.floor(now / SLOT_MS) * SLOT_MS),
    ...current,
    windFrom: windFrom(current.windDirDeg),
    precipNowMm: Math.round((sample.precipMmH / 4) * 100) / 100,
    condition: conditionLabel(current.code),
    hourly,
    slots,
    offsetSeconds: LOCAL_OFFSET_S,
    source: "NOAA GFS",
    model: `GFS ${cycleLabel(data)}`,
    lat,
    lng,
    fetchedAt: new Date().toISOString(),
  };
  weather.precip = classifyPrecip(slots, now, weather.tempC, weather.code, LOCAL_OFFSET_S);
  weather.summary = briefingSentence(weather);
  return weather;
}
