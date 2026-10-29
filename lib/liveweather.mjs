import { briefingSentence, classifyPrecip, conditionLabel, localIso, sunElevation, windFrom } from "./weather.mjs";

const OFFSET_S = 28800;
const SLOT_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 10000;
const POINT_TTL_MS = 10 * 60 * 1000;
const pointCache = new Map();

/** OpenWeatherMap condition id → the WMO weather code the rest of the system uses. */
export function owmCode(id) {
  const n = Number(id);
  if (n >= 200 && n < 300) return 95;
  if ([300, 310].includes(n)) return 51;
  if ([302, 312, 314].includes(n)) return 55;
  if (n >= 300 && n < 400) return 53;
  if (n === 500 || n === 511) return 61;
  if (n === 501) return 63;
  if (n >= 502 && n <= 504) return 65;
  if (n === 520) return 80;
  if (n === 521) return 81;
  if (n >= 522 && n < 600) return 82;
  if (n === 600) return 71;
  if (n === 602) return 75;
  if (n === 620) return 85;
  if (n === 621 || n === 622) return 86;
  if (n >= 600 && n < 700) return 73;
  if ([701, 711, 721, 741].includes(n)) return 45;
  if (n >= 700 && n < 800) return 3;
  if (n === 800) return 0;
  if (n === 801) return 1;
  if (n === 802) return 2;
  return 3;
}

const round1 = (value) => Math.round(Number(value) * 10) / 10;
const METEO_CURRENT = "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code,is_day,precipitation,cloud_cover";

async function getJson(url, label) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new Error(`${label}: ${error?.name === "TimeoutError" ? "хариу ирсэнгүй" : error.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${label} ${res.status}: ${String(data.message || data.reason || "").slice(0, 120)}`);
  return data;
}

/** Station-based current conditions from OpenWeatherMap. */
async function owmCurrent(lat, lng) {
  const key = process.env.OPENWEATHERMAP_API_KEY;
  if (!key) return null;
  const url = new URL("https://api.openweathermap.org/data/2.5/weather");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lng);
  url.searchParams.set("units", "metric");
  url.searchParams.set("appid", key);
  const data = await getJson(url, "OpenWeatherMap");
  const code = owmCode(data.weather?.[0]?.id);
  const precipMmH = Number(data.rain?.["1h"] ?? data.snow?.["1h"] ?? 0);
  return {
    tempC: round1(data.main.temp),
    feelsLikeC: round1(data.main.feels_like),
    humidity: data.main.humidity,
    windSpeedMs: round1(data.wind?.speed ?? 0),
    windDirDeg: Math.round(data.wind?.deg ?? 0),
    code,
    cloud: Number(data.clouds?.all ?? 0),
    precipMmH,
    wet: code >= 51,
    station: data.name || "",
    observedMs: Number(data.dt) * 1000 || Date.now(),
  };
}

async function openMeteo(lat, lng) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat);
  url.searchParams.set("longitude", lng);
  url.searchParams.set("current", METEO_CURRENT);
  url.searchParams.set("hourly", "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,is_day");
  url.searchParams.set("minutely_15", "precipitation");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("forecast_hours", "25");
  url.searchParams.set("past_minutely_15", "4");
  url.searchParams.set("forecast_minutely_15", "24");
  return getJson(url, "Open-Meteo");
}

function meteoCurrent(current) {
  const code = Number(current.weather_code) || 0;
  return {
    tempC: round1(current.temperature_2m),
    feelsLikeC: round1(current.apparent_temperature),
    humidity: current.relative_humidity_2m,
    windSpeedMs: round1(current.wind_speed_10m),
    windDirDeg: Math.round(current.wind_direction_10m),
    code,
    cloud: Number(current.cloud_cover ?? 0),
    precipMmH: Number(current.precipitation || 0) * 4,
    wet: code >= 51,
    station: "",
    observedMs: Number(current.time) * 1000 || Date.now(),
  };
}

/** Real current weather (OpenWeatherMap station, else Open-Meteo) with Open-Meteo's hourly and 15-minute forecast. */
export async function fetchLiveWeather(lat, lng) {
  const [station, meteo] = await Promise.allSettled([owmCurrent(lat, lng), openMeteo(lat, lng)]);
  const forecast = meteo.status === "fulfilled" ? meteo.value : null;
  const now = Date.now();
  const current = (station.status === "fulfilled" && station.value) || (forecast?.current ? meteoCurrent(forecast.current) : null);
  if (!current) throw new Error([station.reason?.message, meteo.reason?.message].filter(Boolean).join(" · ") || "Цаг агаарын мэдээ ирсэнгүй");

  const hours = forecast?.hourly;
  const startHour = Math.floor(now / 3600000) * 3600000;
  const hourly = (hours?.time || [])
    .map((t, i) => ({ t: t * 1000, i }))
    .filter(({ t }) => t >= startHour)
    .slice(0, 24)
    .map(({ t, i }) => {
      const time = localIso(t, OFFSET_S);
      return {
        time,
        label: time.slice(11, 16),
        tempC: round1(hours.temperature_2m[i]),
        precipProb: Math.round(hours.precipitation_probability?.[i] ?? 0),
        windSpeedMs: round1(hours.wind_speed_10m[i]),
        code: Number(hours.weather_code[i]) || 0,
        isDay: Boolean(hours.is_day[i]),
      };
    });
  if (hourly[0]) Object.assign(hourly[0], { tempC: current.tempC, windSpeedMs: current.windSpeedMs, code: current.code });

  const quarter = forecast?.minutely_15;
  const slots = (quarter?.time || []).map((t, i) => ({ time: localIso(t * 1000, OFFSET_S), t: t * 1000, precipMm: Number(quarter.precipitation[i] || 0) }));
  if (current.wet) {
    const slot = [...slots].reverse().find((item) => item.t <= now);
    if (slot) slot.precipMm = Math.max(slot.precipMm, current.precipMmH / 4, 0.1);
    else slots.push({ time: localIso(Math.floor(now / SLOT_MS) * SLOT_MS, OFFSET_S), precipMm: Math.max(current.precipMmH / 4, 0.1) });
  }
  const isDay = sunElevation(lat, lng, now) > -0.833;
  const source = station.status === "fulfilled" && station.value ? `OpenWeatherMap${current.station ? ` · ${current.station}` : ""}` : "Open-Meteo";
  const weather = {
    observedAt: localIso(current.observedMs, OFFSET_S),
    tempC: current.tempC,
    windSpeedMs: current.windSpeedMs,
    windDirDeg: current.windDirDeg,
    feelsLikeC: current.feelsLikeC,
    humidity: current.humidity,
    code: current.code,
    isDay,
    windFrom: windFrom(current.windDirDeg),
    precipNowMm: Math.round((current.precipMmH / 4) * 100) / 100,
    condition: conditionLabel(current.code),
    hourly,
    slots: slots.map(({ time, precipMm }) => ({ time, precipMm })),
    offsetSeconds: OFFSET_S,
    source,
    model: forecast ? "Open-Meteo урьдчилсан мэдээ" : "",
    lat,
    lng,
    fetchedAt: new Date().toISOString(),
  };
  weather.precip = classifyPrecip(weather.slots, now, weather.tempC, weather.code, OFFSET_S);
  weather.summary = briefingSentence(weather);
  return weather;
}

/** Current weather at any map point, cached per ~0.1° for ten minutes. */
export async function livePoint(lat, lng) {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
  const hit = pointCache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  let current = null;
  let source = "";
  try {
    current = await owmCurrent(lat, lng);
    if (current) source = `OpenWeatherMap${current.station ? ` · ${current.station}` : ""}`;
  } catch {
    current = null;
  }
  if (!current) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lng);
    url.searchParams.set("current", METEO_CURRENT);
    url.searchParams.set("wind_speed_unit", "ms");
    url.searchParams.set("timeformat", "unixtime");
    current = meteoCurrent((await getJson(url, "Open-Meteo")).current);
    source = "Open-Meteo";
  }
  const value = { ...current, source };
  pointCache.set(key, { value, until: Date.now() + POINT_TTL_MS });
  if (pointCache.size > 500) pointCache.delete(pointCache.keys().next().value);
  return value;
}
