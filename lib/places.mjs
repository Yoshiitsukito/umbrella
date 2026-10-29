export const AIRPORTS = [
  { code: "ULN", lat: 47.843, lng: 106.767, city: "Улаанбаатар", country: "MN" },
  { code: "PEK", lat: 40.08, lng: 116.585, city: "Бээжин", country: "CN" },
  { code: "PKX", lat: 39.509, lng: 116.411, city: "Бээжин Дасин", country: "CN" },
  { code: "PVG", lat: 31.144, lng: 121.808, city: "Шанхай Пудун", country: "CN" },
  { code: "SHA", lat: 31.198, lng: 121.336, city: "Шанхай Хунчяо", country: "CN" },
  { code: "CAN", lat: 23.392, lng: 113.299, city: "Гуанжоу", country: "CN" },
  { code: "SZX", lat: 22.639, lng: 113.811, city: "Шэньжэнь", country: "CN" },
  { code: "HKG", lat: 22.308, lng: 113.918, city: "Хонконг", country: "HK" },
  { code: "TFU", lat: 30.319, lng: 104.445, city: "Чэнду", country: "CN" },
  { code: "XIY", lat: 34.447, lng: 108.752, city: "Шиань", country: "CN" },
  { code: "ICN", lat: 37.46, lng: 126.441, city: "Сөүл", country: "KR" },
  { code: "NRT", lat: 35.765, lng: 140.386, city: "Токио Нарита", country: "JP" },
  { code: "HND", lat: 35.549, lng: 139.78, city: "Токио Ханэда", country: "JP" },
  { code: "BKK", lat: 13.69, lng: 100.75, city: "Бангкок", country: "TH" },
  { code: "SIN", lat: 1.364, lng: 103.991, city: "Сингапур", country: "SG" },
  { code: "DXB", lat: 25.253, lng: 55.366, city: "Дубай", country: "AE" },
  { code: "IST", lat: 41.275, lng: 28.752, city: "Истанбул", country: "TR" },
  { code: "LHR", lat: 51.47, lng: -0.454, city: "Лондон", country: "GB" },
  { code: "FRA", lat: 50.037, lng: 8.562, city: "Франкфурт", country: "DE" },
  { code: "SVO", lat: 55.973, lng: 37.415, city: "Москва", country: "RU" },
  { code: "DEL", lat: 28.556, lng: 77.1, city: "Дели", country: "IN" },
  { code: "ALA", lat: 43.352, lng: 77.04, city: "Алматы", country: "KZ" },
];

export const NAMED_PLACES = [
  { keys: ["улаанбаатар", "ulaanbaatar"], code: "ULN", query: "Ulaanbaatar" },
  { keys: ["бээжин", "beijing", "peking", "пекин"], code: "PEK", query: "Beijing" },
  { keys: ["шанхай", "shanghai"], code: "PVG", query: "Shanghai" },
  { keys: ["гуанжоу", "guangzhou"], code: "CAN", query: "Guangzhou" },
  { keys: ["шэньжэнь", "shenzhen"], code: "SZX", query: "Shenzhen" },
  { keys: ["хонконг", "hong kong", "hongkong"], code: "HKG", query: "Hong Kong" },
  { keys: ["чэнду", "chengdu"], code: "TFU", query: "Chengdu" },
  { keys: ["шиань", "xian", "xi'an"], code: "XIY", query: "Xi'an" },
  { keys: ["сөүл", "seoul"], code: "ICN", query: "Seoul" },
  { keys: ["токио", "tokyo"], code: "HND", query: "Tokyo" },
  { keys: ["бангкок", "bangkok"], code: "BKK", query: "Bangkok" },
  { keys: ["сингапур", "singapore"], code: "SIN", query: "Singapore" },
  { keys: ["дубай", "dubai"], code: "DXB", query: "Dubai" },
  { keys: ["истанбул", "istanbul"], code: "IST", query: "Istanbul" },
  { keys: ["лондон", "london"], code: "LHR", query: "London" },
  { keys: ["москва", "moscow"], code: "SVO", query: "Moscow" },
  { keys: ["хятад", "china"], code: "PEK", query: "Beijing", generic: true },
];

export function haversineM(a, b) {
  const R = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function airportByCode(code) {
  return AIRPORTS.find((item) => item.code === code) || null;
}

export function nearestAirport(lat, lng, maxKm = 80) {
  let best = null;
  let bestM = Infinity;
  for (const airport of AIRPORTS) {
    const meters = haversineM({ lat, lng }, airport);
    if (meters < bestM) {
      best = airport;
      bestM = meters;
    }
  }
  if (!best || bestM > maxKm * 1000) return null;
  return { ...best, distanceM: bestM };
}

export function matchPlace(text) {
  const hay = String(text || "").toLowerCase();
  let found = null;
  for (const place of NAMED_PLACES) {
    for (const key of place.keys) {
      if (!hay.includes(key)) continue;
      if (!found || key.length > found.matched.length) {
        found = { ...place, matched: key };
      }
    }
  }
  return found;
}

export function extractDestination(text) {
  const known = matchPlace(text);
  if (known) return { place: known, query: known.query };
  const mongolian = String(text || "").match(/([\p{L}][\p{L}\s]{1,40}?)\s+руу/u);
  if (mongolian) return { place: null, query: mongolian[1].trim() };
  const english = String(text || "").match(/\bto\s+([A-Za-z][A-Za-z\s]{1,40})/i);
  if (english) return { place: null, query: english[1].trim() };
  return { place: null, query: null };
}

export function localParts(now = new Date(), offsetMin = 480) {
  const shifted = new Date(now.getTime() + offsetMin * 60000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return {
    date: `${y}-${m}-${d}`,
    hh: shifted.getUTCHours(),
    mm: shifted.getUTCMinutes(),
  };
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return dt.toISOString().slice(0, 10);
}

export function readRadius(text) {
  const match = String(text || "").match(/(\d+(?:[.,]\d+)?)\s*(км|km|м|m)(?!\p{L})/iu);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  const unit = match[2].toLowerCase();
  const meters = unit === "км" || unit === "km" ? value * 1000 : value;
  return Math.round(Math.min(8000, Math.max(200, meters)));
}

export function readDate(text, now = new Date()) {
  const today = localParts(now).date;
  const iso = String(text || "").match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  if (/маргааш|tomorrow/i.test(text)) return addDays(today, 1);
  if (/өнөөдөр|today/i.test(text)) return today;
  return null;
}

const FOOD_RE = /хоол|ресторан|кафе|coffee|cafe|restaurant|хоолны|кофены/;
const TRIP_RE = /онгоц|нислэг|flight|аялал|явах|очих|хүрэх|яаж очих/;
const WEATHER_RE = /цаг агаар|бороо|цас|салхи|температур|градус|weather/;
const DAY_RE = /хуваарь|сануулга|миний өдөр|өнөөдөр юу/;
const WATER_RE = /уух|ус уу|hydration|нойр/;

export function parseAsk(text, now = new Date()) {
  const destination = extractDestination(text);
  const food = FOOD_RE.test(text);
  const tripWord = TRIP_RE.test(text);
  const far = destination.place && destination.place.code !== "ULN";
  let intent = "chat";
  if (food && destination.place && destination.place.code !== "ULN") intent = "places_there";
  else if (food && !tripWord) intent = "places";
  else if (tripWord || far || destination.query) intent = "trip";
  else if (WEATHER_RE.test(text)) intent = "weather";
  else if (DAY_RE.test(text)) intent = "day";
  else if (WATER_RE.test(text)) intent = "water";
  const date = readDate(text, now) || (intent === "trip" ? addDays(localParts(now).date, 1) : null);
  return {
    intent,
    destination,
    radiusM: readRadius(text) || 1500,
    date,
    food,
  };
}
