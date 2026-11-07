// Sends in-app notices out by Web Push, e-mail and SMS. pushNotice() stays the only producer: the delivery loop
// in server.mjs claims every notice nobody has tried yet, sends it outside the store lock and writes the results back.
import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import webpush from "web-push";
import { personalKey } from "./personal.mjs";

export const CHANNELS = ["push", "email", "sms"];
export const CHANNEL_LABEL = { push: "Push", email: "И-мэйл", sms: "SMS" };
export const PREF_LEVELS = ["off", "urgent", "all"];
export const DEFAULT_PREFS = { push: "all", email: "all", sms: "urgent" };
export const NOTICE_TITLE = {
  plan: "Ээлжийн хуваарь",
  leave: "Чөлөөний хүсэлт",
  "leave-ok": "Чөлөөний хүсэлт",
  "leave-no": "Чөлөөний хүсэлт",
  card: "ID карт",
  hse: "ХАБЭА",
  blast: "ХАБЭА · Тэсэлгээ",
  "pass-ok": "Хөдөлгөөний зөвшөөрөл",
  "pass-no": "Хөдөлгөөний зөвшөөрөл",
  test: "Туршилтын мэдэгдэл",
};

/** Notices older than this when first seen are not sent: the first start after deploy, or a long outage. */
const STALE_MS = 30 * 60 * 1000;
/** A claim older than this was lost to a restart in the middle of sending. */
const SENDING_MS = 5 * 60 * 1000;
const RETRY_MS = [60 * 1000, 5 * 60 * 1000];
const MAX_TRIES = 3;
const KEEP_LOG = 300;
const KEEP_SUBS = 5;
const TIMEOUT_MS = 15 * 1000;
const SMS_MAX = 300;

const newId = (prefix) => `${prefix}_${randomBytes(6).toString("hex")}`;
const iso = (ms) => new Date(ms).toISOString();
const shortError = (error) => String(error?.message || error || "Алдаа").replace(/\s+/g, " ").slice(0, 160);

/** Which outside channels the environment has credentials for; push needs none beyond the VAPID pair. */
export function channelConfig(env = process.env) {
  const port = Number(env.SMTP_PORT) || 587;
  const email = env.SMTP_HOST && env.SMTP_FROM
    ? { host: env.SMTP_HOST, port, secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465, user: env.SMTP_USER || "", pass: env.SMTP_PASS || "", from: env.SMTP_FROM }
    : null;
  let sms = null;
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM) sms = { kind: "twilio", sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM };
  else if (env.SMS_GATEWAY_URL) sms = { kind: "gateway", url: env.SMS_GATEWAY_URL, body: env.SMS_GATEWAY_BODY || "", auth: env.SMS_GATEWAY_AUTH || "" };
  return { email, sms, countryCode: String(env.SMS_COUNTRY_CODE || "976").replace(/\D/g, "") || "976" };
}

/** The VAPID pair from the environment, otherwise one generated once and kept in the database. */
export function ensureVapid(db, env = process.env) {
  const subject = env.VAPID_SUBJECT || "mailto:admin@umbrella.local";
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject };
  if (!db.vapid?.publicKey || !db.vapid?.privateKey) db.vapid = webpush.generateVAPIDKeys();
  return { publicKey: db.vapid.publicKey, privateKey: db.vapid.privateKey, subject };
}

export function vapidOf(db, env = process.env) {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) return ensureVapid(db, env);
  return db.vapid?.publicKey ? { ...db.vapid, subject: env.VAPID_SUBJECT || "mailto:admin@umbrella.local" } : null;
}

/** Digits with an optional leading +, 8–15 long; "" when empty, null when it is not a phone number. */
export function cleanPhone(value) {
  const raw = String(value ?? "").replace(/[\s().-]/g, "");
  if (!raw) return "";
  return /^\+?\d{8,15}$/.test(raw) ? raw : null;
}

/** A local 8-digit number gets the country code; anything else is taken as already international. */
export function e164(phone, countryCode = "976") {
  if (phone.startsWith("+")) return phone;
  return phone.length === 8 ? `+${countryCode}${phone}` : `+${phone}`;
}

export function alertPrefs(record) {
  const saved = record?.alerts || {};
  return Object.fromEntries(CHANNELS.map((channel) => [channel, PREF_LEVELS.includes(saved[channel]) ? saved[channel] : DEFAULT_PREFS[channel]]));
}

export function cleanPrefs(body) {
  const prefs = {};
  for (const channel of CHANNELS) {
    if (body?.[channel] === undefined) continue;
    if (!PREF_LEVELS.includes(body[channel])) return { error: "Мэдэгдлийн тохиргоо буруу" };
    prefs[channel] = body[channel];
  }
  return { prefs };
}

/** Saves a browser's push subscription on the person's record; one per endpoint, the newest few kept. */
export function addSubscription(record, subscription, { ua = "", now = Date.now() } = {}) {
  const endpoint = String(subscription?.endpoint || "");
  const p256dh = String(subscription?.keys?.p256dh || "");
  const auth = String(subscription?.keys?.auth || "");
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return { error: "Push бүртгэл буруу" };
  }
  if (url.protocol !== "https:" || endpoint.length > 1000 || !/^[\w-]{40,120}$/.test(p256dh) || !/^[\w-]{12,40}$/.test(auth)) return { error: "Push бүртгэл буруу" };
  record.push = (record.push || []).filter((item) => item.endpoint !== endpoint);
  record.push.push({ endpoint, keys: { p256dh, auth }, ua: String(ua).slice(0, 120), at: iso(now) });
  record.push = record.push.slice(-KEEP_SUBS);
  return { ok: true };
}

export function removeSubscription(record, endpoint) {
  const before = (record.push || []).length;
  record.push = (record.push || []).filter((item) => item.endpoint !== endpoint);
  return before !== record.push.length;
}

const targetKey = (channel, to) => `${channel}_${createHash("sha1").update(to).digest("hex").slice(0, 10)}`;

/** Where one notice goes for this person: each channel they want at this urgency, that has an address and credentials. */
export function targetsFor({ user, record, level, config }) {
  const prefs = alertPrefs(record);
  const wants = (channel) => prefs[channel] === "all" || (prefs[channel] === "urgent" && level === "urgent");
  const targets = [];
  if (wants("push")) for (const sub of record?.push || []) targets.push({ channel: "push", to: sub.endpoint, sub });
  if (wants("email") && config.email && user.email) targets.push({ channel: "email", to: user.email });
  if (wants("sms") && config.sms && user.phone) targets.push({ channel: "sms", to: user.phone });
  return targets.map((target) => ({ ...target, key: targetKey(target.channel, target.to) }));
}

function isDue(notice, now) {
  const out = notice.out;
  if (!out) return true;
  if (out.state === "retry") return out.next <= now;
  return out.state === "sending" && now - Date.parse(out.at) > SENDING_MS;
}

export function hasDueDeliveries(db, now = Date.now()) {
  return (db.users || []).some((user) => db[personalKey(user.id)]?.notices?.some((notice) => isDue(notice, now)));
}

/**
 * Marks every notice that is due as being sent and returns the jobs to send: new ones to each wanted channel,
 * retries only to the channels that failed. Runs inside update(); the sending happens after it.
 */
export function claimDeliveries(db, config, now = Date.now()) {
  const jobs = [];
  for (const user of db.users || []) {
    if (user.role === "whiteking") continue;
    const record = db[personalKey(user.id)];
    for (const notice of record?.notices || []) {
      if (!isDue(notice, now)) continue;
      const out = notice.out;
      if (!out && now - Date.parse(notice.at) > STALE_MS) {
        notice.out = { state: "stale" };
        continue;
      }
      const failed = out?.res ? Object.keys(out.res).filter((key) => out.res[key] === "fail") : null;
      const targets = targetsFor({ user, record, level: notice.level, config }).filter((target) => !failed || failed.includes(target.key));
      if (!targets.length) {
        notice.out = out ? { ...out, state: "done" } : { state: "none" };
        continue;
      }
      const tries = (out?.tries || 0) + 1;
      notice.out = { ...out, state: "sending", tries, at: iso(now) };
      jobs.push({ uid: user.id, name: user.displayName || "", notice: { id: notice.id, kind: notice.kind, level: notice.level || "normal", text: notice.text, at: notice.at }, tries, targets });
    }
  }
  return jobs;
}

const transports = new Map();

function mailer(email) {
  const key = `${email.host}:${email.port}:${email.user}`;
  if (!transports.has(key)) {
    transports.set(
      key,
      nodemailer.createTransport({
        host: email.host,
        port: email.port,
        secure: email.secure,
        auth: email.user ? { user: email.user, pass: email.pass } : undefined,
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
      }),
    );
  }
  return transports.get(key);
}

function permanent(message) {
  const error = new Error(message);
  error.permanent = true;
  return error;
}

async function smsTwilio(sms, to, text, countryCode) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sms.sid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sms.sid}:${sms.token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: e164(to, countryCode), From: sms.from, Body: text }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.ok) return;
  const data = await res.json().catch(() => ({}));
  const message = `Twilio ${res.status}${data.message ? `: ${data.message}` : ""}`;
  throw res.status >= 400 && res.status < 500 && res.status !== 429 ? permanent(message) : new Error(message);
}

/** A local SMS provider: {to} and {text} in the URL (and the optional JSON body) are filled in. */
async function smsGateway(sms, to, text) {
  const fill = (template, encode) => template.replaceAll("{to}", encode(to)).replaceAll("{text}", encode(text));
  const headers = {};
  if (sms.auth) headers.Authorization = sms.auth;
  let body;
  if (sms.body) {
    body = fill(sms.body, (value) => JSON.stringify(value).slice(1, -1));
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(fill(sms.url, encodeURIComponent), { method: body ? "POST" : "GET", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`SMS gateway ${res.status}`);
}

export const SENDERS = {
  async push({ target, payload, urgent, vapid }) {
    try {
      await webpush.sendNotification(target.sub, JSON.stringify(payload), { vapidDetails: vapid, TTL: 24 * 3600, urgency: urgent ? "high" : "normal", timeout: TIMEOUT_MS });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        const gone = permanent("Push бүртгэл хүчингүй болсон");
        gone.gone = true;
        throw gone;
      }
      throw new Error(error.statusCode ? `Push ${error.statusCode}` : shortError(error));
    }
  },
  async email({ target, title, text, config }) {
    await mailer(config.email).sendMail({ from: config.email.from, to: target.to, subject: `UMBRELLA · ${title}`, text: `${text}\n\n— UMBRELLA` });
  },
  async sms({ target, text, config }) {
    const body = `UMBRELLA: ${text}`.slice(0, SMS_MAX);
    if (config.sms.kind === "twilio") await smsTwilio(config.sms, target.to, body, config.countryCode);
    else await smsGateway(config.sms, target.to, body);
  },
};

/** Sends one job to all its targets at once; never throws, each target gets its own result. */
export async function sendJob(job, { config, vapid, senders = SENDERS }) {
  const title = NOTICE_TITLE[job.notice.kind] || "Мэдэгдэл";
  const urgent = job.notice.level === "urgent";
  const payload = { title: `${urgent ? "‼ " : ""}${title}`, body: job.notice.text, tag: job.notice.id, url: "/", urgent };
  return Promise.all(
    job.targets.map(async (target) => {
      const base = { key: target.key, channel: target.channel, to: target.to };
      if (target.channel === "push" && !vapid) return { ...base, ok: false, error: "VAPID түлхүүргүй" };
      try {
        await senders[target.channel]({ target, title, text: job.notice.text, payload, urgent, config, vapid });
        return { ...base, ok: true };
      } catch (error) {
        return { ...base, ok: false, error: shortError(error), permanent: Boolean(error.permanent), gone: Boolean(error.gone) };
      }
    }),
  );
}

/** Hides most of an address in the admin log. */
export function maskTarget(channel, to) {
  if (channel === "push") {
    try {
      return new URL(to).host;
    } catch {
      return "push";
    }
  }
  if (channel === "email") {
    const [name, domain] = String(to).split("@");
    return `${name.slice(0, 2)}***@${domain || ""}`;
  }
  return `${String(to).slice(0, 4)}****`;
}

/** Writes each job's results onto its notice, schedules retries, drops dead push subscriptions and logs the attempt. */
export function recordDeliveries(db, jobs, results, now = Date.now()) {
  db.deliveries ||= [];
  jobs.forEach((job, index) => {
    const outcome = results[index] || [];
    const record = db[personalKey(job.uid)];
    const notice = record?.notices?.find((item) => item.id === job.notice.id);
    for (const result of outcome) if (result.gone && record) removeSubscription(record, result.to);
    if (notice) {
      const res = { ...notice.out?.res };
      for (const result of outcome) res[result.key] = result.ok ? "ok" : result.gone || result.permanent ? "dead" : "fail";
      const retry = Object.values(res).includes("fail") && job.tries < MAX_TRIES;
      notice.out = { state: retry ? "retry" : "done", tries: job.tries, at: iso(now), res, ...(retry ? { next: now + RETRY_MS[job.tries - 1] } : {}) };
    }
    db.deliveries.push({
      id: newId("dlv"),
      at: iso(now),
      uid: job.uid,
      name: job.name,
      kind: job.notice.kind,
      level: job.notice.level,
      text: job.notice.text.slice(0, 140),
      tries: job.tries,
      results: outcome.map(({ channel, to, ok, error }) => ({ channel, to: maskTarget(channel, to), ok, ...(ok ? {} : { error }) })),
    });
  });
  db.deliveries = db.deliveries.slice(-KEEP_LOG);
}

/** Channel readiness for the admin page, without secrets. */
export function channelStatus(config, vapid) {
  const host = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  };
  return {
    push: { ready: Boolean(vapid), detail: vapid ? "Web Push (VAPID)" : "VAPID түлхүүр үүсээгүй" },
    email: { ready: Boolean(config.email), detail: config.email ? `${config.email.host}:${config.email.port} · ${config.email.from}` : "SMTP_HOST, SMTP_FROM тохируулаагүй" },
    sms: { ready: Boolean(config.sms), detail: config.sms ? (config.sms.kind === "twilio" ? `Twilio · ${config.sms.from}` : `Gateway · ${host(config.sms.url)}`) : "TWILIO_* эсвэл SMS_GATEWAY_URL тохируулаагүй" },
  };
}
