import crypto from "node:crypto";
import { localParts } from "./places.mjs";

const DAY_MS = 24 * 3600 * 1000;
const DUE_WINDOW_MIN = 2;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PLAIN_TEXT = /^[^\p{Cc}<>]*$/u;
const WEEKDAYS = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

export const PLACEHOLDERS = {
  temp: "Гадаах температур",
  feels: "Мэдрэгдэх температур",
  wind: "Салхины хурд, м/с",
  windDir: "Салхины зүг",
  condition: "Цаг агаарын төлөв",
  precip: "Хур тунадасны өгүүлбэр",
  minutes: "Гэрэл унтрах хүртэлх минут",
  zone: "Бүсийн нэр",
  name: "Ирц бүртгүүлсэн хүний нэр",
  time: "Одоогийн цаг",
  weekday: "Гараг",
  date: "Огноо",
};

export function defaultConfig() {
  return {
    voice: true,
    chime: true,
    morning: {
      enabled: true,
      time: "06:00",
      text: "Өглөөний мэнд! Өнөөдөр гадаа {temp} градус, салхи {windDir} зүгээс секундэд {wind} метр хурдтай байна. {precip} Өнөөдрийн ажилд тань амжилт хүсье!",
    },
    zones: [
      {
        id: "gym",
        name: "Спорт заал",
        on: "18:00",
        off: "22:00",
        warnBefore: 15,
        warnEvery: 5,
        warnText: "Анхааруулга! Спорт заалны гэрэл {minutes} минутын дараа автоматаар унтарна.",
        onText: "",
        offText: "",
        webhookOn: "",
        webhookOff: "",
      },
      {
        id: "dorm",
        name: "Байр",
        on: "05:30",
        off: "23:00",
        warnBefore: 0,
        warnEvery: 5,
        warnText: "",
        onText: "",
        offText: "",
        webhookOn: "",
        webhookOff: "",
      },
    ],
    scan: { enabled: true, inText: "{name}, тавтай морил. Ирц бүртгэгдлээ.", outText: "{name}, баяртай. Гарсан цаг бүртгэгдлээ." },
    custom: [],
  };
}

export function ensureWhiteKing(db) {
  const fresh = !db.whiteking;
  const wk = db.whiteking || (db.whiteking = {});
  const base = defaultConfig();
  const config = wk.config || {};
  wk.config = {
    ...base,
    ...config,
    morning: { ...base.morning, ...config.morning },
    scan: { ...base.scan, ...config.scan },
    zones: base.zones.map((zone) => ({ ...zone, ...(config.zones || []).find((item) => item.id === zone.id) })),
    custom: Array.isArray(config.custom) ? config.custom : [],
  };
  wk.seq ||= 0;
  wk.queue ||= [];
  wk.log ||= [];
  wk.fired ||= {};
  wk.overrides ||= {};
  wk.applied ||= {};
  wk.devices ||= [];
  return fresh;
}

export function toMinutes(time) {
  const [hh, mm] = String(time).split(":").map(Number);
  return hh * 60 + mm;
}

export function fromMinutes(total) {
  const value = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function dailyPlan(config) {
  const items = [];
  const morning = config.morning;
  if (morning.enabled && morning.text) {
    items.push({ key: "morning", time: morning.time, kind: "say", template: morning.text, label: "Өглөөний мэндчилгээ" });
  }
  for (const zone of config.zones) {
    items.push({ key: `${zone.id}:on`, time: zone.on, kind: "light", zone: zone.id, state: "on", template: zone.onText, label: `${zone.name} · гэрэл асна` });
    items.push({ key: `${zone.id}:off`, time: zone.off, kind: "light", zone: zone.id, state: "off", template: zone.offText, label: `${zone.name} · гэрэл унтарна` });
    if (zone.warnText && zone.warnBefore > 0) {
      for (let minutes = zone.warnBefore; minutes > 0; minutes -= zone.warnEvery) {
        items.push({
          key: `${zone.id}:warn${minutes}`,
          time: fromMinutes(toMinutes(zone.off) - minutes),
          kind: "say",
          zone: zone.id,
          minutes,
          template: zone.warnText,
          label: `${zone.name} · унтрахаас ${minutes} мин өмнө`,
        });
      }
    }
  }
  for (const item of config.custom) {
    if (item.enabled && item.text) items.push({ key: `custom:${item.id}`, time: item.time, kind: "say", template: item.text, label: "Нэмэлт мэдэгдэл" });
  }
  return items.sort((a, b) => toMinutes(a.time) - toMinutes(b.time) || a.key.localeCompare(b.key));
}

export function dueItems(plan, fired, date, minute) {
  return plan.filter((item) => {
    const start = toMinutes(item.time);
    return minute >= start && minute < start + DUE_WINDOW_MIN && !fired[`${date}|${item.key}`];
  });
}

export function scheduledState(zone, minute) {
  const on = toMinutes(zone.on);
  const off = toMinutes(zone.off);
  if (on === off) return "off";
  if (on < off) return minute >= on && minute < off ? "on" : "off";
  return minute >= on || minute < off ? "on" : "off";
}

function midnight(now) {
  return Date.parse(`${localParts(new Date(now)).date}T00:00:00+08:00`);
}

export function nextChange(zone, now = Date.now()) {
  const start = midnight(now);
  const candidates = [0, 1].flatMap((day) => [
    { at: start + day * DAY_MS + toMinutes(zone.on) * 60000, state: "on" },
    { at: start + day * DAY_MS + toMinutes(zone.off) * 60000, state: "off" },
  ]);
  return candidates.filter((item) => item.at > now).sort((a, b) => a.at - b.at)[0];
}

export function lightStates(config, overrides = {}, now = Date.now()) {
  const clock = localParts(new Date(now));
  const minute = clock.hh * 60 + clock.mm;
  return config.zones.map((zone) => {
    const override = overrides[zone.id];
    const manual = override && Date.parse(override.until) > now;
    const next = nextChange(zone, now);
    return {
      id: zone.id,
      name: zone.name,
      on: zone.on,
      off: zone.off,
      state: manual ? override.state : scheduledState(zone, minute),
      mode: manual ? "manual" : "auto",
      next: next ? { at: new Date(next.at).toISOString(), state: next.state } : null,
    };
  });
}

export function setOverride(wk, zone, mode, now = Date.now()) {
  if (mode === "auto") {
    delete wk.overrides[zone.id];
    return;
  }
  const next = nextChange(zone, now);
  wk.overrides[zone.id] = { state: mode, until: new Date(next ? next.at : now + DAY_MS).toISOString() };
}

function signedNumber(value) {
  const rounded = Math.round(value);
  return rounded < 0 ? `хасах ${Math.abs(rounded)}` : String(rounded);
}

function precipSentence(weather) {
  const snow = weather.tempC <= 0;
  const word = snow ? "цас" : "бороо";
  if (weather.precip?.status === "ongoing") return `Одоо ${word} орж байна.`;
  const wet = (weather.hourly || []).find((hour) => hour.precipProb >= 40);
  if (wet) return `${wet.label} цагийн орчимд ${word} орох магадлал ${wet.precipProb} хувь байна.`;
  return "Өнөөдөр хур тунадас орохгүй.";
}

export function speechContext(weather, now = Date.now(), extra = {}) {
  const clock = localParts(new Date(now));
  const date = new Date(`${clock.date}T12:00:00+08:00`);
  const base = {
    time: `${String(clock.hh).padStart(2, "0")} цаг ${String(clock.mm).padStart(2, "0")} минут`,
    weekday: `${WEEKDAYS[date.getUTCDay()]} гараг`,
    date: `${date.getUTCMonth() + 1} сарын ${date.getUTCDate()}`,
  };
  const words = weather
    ? {
        temp: signedNumber(weather.tempC),
        feels: signedNumber(weather.feelsLikeC),
        wind: String(Math.round(weather.windSpeedMs)),
        windDir: weather.windFrom || "",
        condition: String(weather.condition || "").toLowerCase(),
        precip: precipSentence(weather),
      }
    : { temp: "тодорхойгүй", feels: "тодорхойгүй", wind: "тодорхойгүй", windDir: "тодорхойгүй", condition: "", precip: "" };
  return { ...base, ...words, ...extra };
}

export function fillTemplate(template, context) {
  return String(template || "")
    .replace(/\{(\w+)\}/g, (match, key) => (context[key] === undefined ? match : String(context[key])))
    .replace(/\s+/g, " ")
    .trim();
}

export function itemContext(item, config) {
  const zone = item.zone && config.zones.find((entry) => entry.id === item.zone);
  return { ...(zone ? { zone: zone.name } : {}), ...(item.minutes ? { minutes: item.minutes } : {}) };
}

export function enqueue(wk, text, label, source, now = Date.now()) {
  wk.seq += 1;
  const item = { id: wk.seq, at: new Date(now).toISOString(), text, label, source };
  wk.queue.push(item);
  wk.queue = wk.queue.slice(-30);
  addLog(wk, "say", `${label}: ${text}`, now);
  return item;
}

export function addLog(wk, kind, text, now = Date.now()) {
  wk.log.push({ at: new Date(now).toISOString(), kind, text });
  wk.log = wk.log.slice(-120);
}

export function pruneFired(wk, date) {
  for (const key of Object.keys(wk.fired)) if (!key.startsWith(`${date}|`)) delete wk.fired[key];
}

function cleanText(value, max, label) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length > max || !PLAIN_TEXT.test(text)) throw new Error(`${label}: ${max}-аас ихгүй тэмдэгт, < > тэмдэггүй байна`);
  return text;
}

function cleanTime(value, label) {
  const text = String(value ?? "").trim();
  if (!TIME.test(text)) throw new Error(`${label}: цаг ЦЦ:ММ хэлбэртэй байна`);
  return text;
}

function cleanInt(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label}: ${min}–${max} бүхэл тоо байна`);
  return number;
}

function cleanUrl(value, label) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${label}: хаяг буруу`);
  }
  if (!["http:", "https:"].includes(url.protocol) || text.length > 300) throw new Error(`${label}: http(s) хаяг байна`);
  return text;
}

export function cleanConfig(input, current) {
  try {
    const morning = input.morning || {};
    const zones = current.zones.map((zone) => {
      const raw = (input.zones || []).find((item) => item.id === zone.id) || zone;
      const label = cleanText(raw.name, 40, "Бүсийн нэр") || zone.name;
      return {
        id: zone.id,
        name: label,
        on: cleanTime(raw.on, `${label} · асах`),
        off: cleanTime(raw.off, `${label} · унтрах`),
        warnBefore: cleanInt(raw.warnBefore, 0, 60, `${label} · сануулах минут`),
        warnEvery: cleanInt(raw.warnEvery, 1, 30, `${label} · давтамж`),
        warnText: cleanText(raw.warnText, 300, `${label} · сануулга`),
        onText: cleanText(raw.onText, 300, `${label} · асах үг`),
        offText: cleanText(raw.offText, 300, `${label} · унтрах үг`),
        webhookOn: cleanUrl(raw.webhookOn, `${label} · асаах холбоос`),
        webhookOff: cleanUrl(raw.webhookOff, `${label} · унтраах холбоос`),
      };
    });
    const custom = (Array.isArray(input.custom) ? input.custom : []).slice(0, 20).map((item, index) => ({
      id: /^[a-z0-9_-]{1,24}$/.test(item.id || "") ? item.id : crypto.randomBytes(4).toString("hex"),
      time: cleanTime(item.time, `Нэмэлт мэдэгдэл ${index + 1}`),
      text: cleanText(item.text, 300, `Нэмэлт мэдэгдэл ${index + 1}`),
      enabled: Boolean(item.enabled),
    }));
    return {
      config: {
        voice: Boolean(input.voice),
        chime: Boolean(input.chime),
        morning: {
          enabled: Boolean(morning.enabled),
          time: cleanTime(morning.time, "Өглөөний мэндчилгээ"),
          text: cleanText(morning.text, 400, "Өглөөний мэндчилгээ"),
        },
        zones,
        scan: {
          enabled: Boolean(input.scan?.enabled),
          inText: cleanText(input.scan?.inText, 200, "Ирэх үг"),
          outText: cleanText(input.scan?.outText, 200, "Гарах үг"),
        },
        custom: custom.filter((item) => item.text),
      },
    };
  } catch (error) {
    return { error: error.message };
  }
}
