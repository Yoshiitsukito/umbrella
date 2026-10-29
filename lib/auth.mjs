import crypto from "node:crypto";

export const SESSION_COOKIE = "umb_session";
export const SESSION_TTL_SEC = 7 * 24 * 60 * 60;
export const CARD_STATUSES = ["ACTIVE", "SUSPENDED", "REVOKED"];
export const ROLES = ["user", "hr", "kitchen", "admin", "whiteking"];
/** Roles that work shifts, scan in and out, and appear on HR's staff pages. */
export const STAFF_ROLES = ["user", "hr", "kitchen"];

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(password), salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored || "").split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export const MOBILE_TTL_SEC = 180 * 24 * 60 * 60;

function sessionKey(secret, purpose = "umbrella-session") {
  return crypto.createHmac("sha256", secret).update(purpose).digest();
}

export function issueSession(secret, user, now = Date.now(), { purpose, ttlSec = SESSION_TTL_SEC } = {}) {
  const payload = { uid: user.id, v: user.ver || 0, exp: now + ttlSec * 1000 };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", sessionKey(secret, purpose)).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Token the UMBRELLA phone app's background service sends as a Bearer header; it opens only /api/mobile/. */
export function issueMobileToken(secret, user, now = Date.now()) {
  return issueSession(secret, user, now, { purpose: "umbrella-mobile", ttlSec: MOBILE_TTL_SEC });
}

export function verifyMobileToken(secret, token, now = Date.now()) {
  return verifySession(secret, token, now, "umbrella-mobile");
}

export function verifySession(secret, token, now = Date.now(), purpose) {
  const [body, sig, extra] = String(token || "").split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = crypto.createHmac("sha256", sessionKey(secret, purpose)).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.uid || !(payload.exp > now)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function sessionCookie(token, secure = false) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}${secure ? "; Secure" : ""}`;
}

export function clearedCookie(secure = false) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function cardNumber() {
  const digits = (count) => Array.from({ length: count }, () => crypto.randomInt(10)).join("");
  const letter = () => String.fromCharCode(65 + crypto.randomInt(26));
  return `${digits(3)}${letter()}-${letter()}${digits(3)}`;
}

function unique(make, taken) {
  for (;;) {
    const value = make();
    if (!taken.has(value)) return value;
  }
}

function expiryFrom(date, years = 4) {
  const end = new Date(date);
  end.setFullYear(end.getFullYear() + years);
  const two = (value) => String(value).padStart(2, "0");
  return `${two(end.getMonth() + 1)}/${two(end.getDate())}/${end.getFullYear()}`;
}

export function newUser({ id, username, password, role = "user", displayName, title = "", email = "", card = {}, existing = [] }) {
  const createdAt = new Date().toISOString();
  const takenIds = new Set(existing.map((user) => user.id));
  const takenCards = new Set(existing.map((user) => user.card?.idNumber));
  const takenCodes = new Set(existing.map((user) => user.loginCode));
  return {
    id: id || unique(() => `usr_${crypto.randomBytes(5).toString("hex")}`, takenIds),
    username,
    loginCode: unique(makeLoginCode, takenCodes),
    role,
    displayName: displayName || username,
    title,
    email,
    photo: null,
    pass: hashPassword(password),
    ver: 0,
    cardKey: role === "whiteking" ? null : newCardKey(),
    createdAt,
    lastLoginAt: null,
    card: {
      classification: "АЖИЛТАН",
      project: "UMBRELLA ХӨТӨЛБӨР",
      idNumber: unique(cardNumber, takenCards),
      status: "ACTIVE",
      clearance: role === "admin" ? 5 : 1,
      expires: expiryFrom(createdAt),
      ...card,
    },
  };
}

export function ensureUsers(db) {
  if (Array.isArray(db.users) && db.users.length) return null;
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const userPassword = process.env.USER_PASSWORD || "saran123";
  db.users = [];
  db.users.push(
    newUser({
      id: "usr_admin",
      username: "admin",
      password: adminPassword,
      role: "admin",
      displayName: "Administrator",
      title: "Аюулгүй байдлын алба",
      email: "admin@umbrella.local",
      card: { classification: "АДМИНИСТРАТОР", project: "АЮУЛГҮЙ БАЙДАЛ", clearance: 5 },
    }),
  );
  db.users.push(
    newUser({
      id: db.profile?.id || "usr_saran",
      username: "saran",
      password: userPassword,
      role: "user",
      displayName: db.profile?.displayName || "Сарантуяа",
      title: db.profile?.title || "",
      email: db.profile?.email || "",
      card: { classification: "ДИЗАЙНЕР", project: "HOLO ХӨТӨЛБӨР", clearance: 3 },
      existing: db.users,
    }),
  );
  return { admin: adminPassword, user: userPassword, adminCode: db.users[0].loginCode, userCode: db.users[1].loginCode };
}

export function ensureStationUser(db) {
  if (!Array.isArray(db.users)) return null;
  for (const user of db.users.filter((item) => item.role === "whiteking")) {
    if (user.displayName === "White King") user.displayName = "White Queen";
    if (user.card?.project === "WHITE KING") user.card.project = "WHITE QUEEN";
    if (user.username === "whiteking" && !db.users.some((item) => item.username === "whitequeen")) user.username = "whitequeen";
  }
  if (db.users.some((user) => user.role === "whiteking")) return null;
  const password = process.env.WHITEQUEEN_PASSWORD || process.env.WHITEKING_PASSWORD || "whiteking123";
  const user = newUser({
    username: "whitequeen",
    password,
    role: "whiteking",
    displayName: "White Queen",
    title: "Ирц ба гэрэлтүүлгийн станц",
    card: { classification: "СТАНЦ", project: "WHITE QUEEN", clearance: 1 },
    existing: db.users,
  });
  db.users.push(user);
  return { code: user.loginCode, password };
}

export const CARD_QR_PREFIX = "UMBC:";

export function newCardKey() {
  return crypto.randomBytes(16).toString("base64url");
}

export function ensureCardKeys(db) {
  let added = 0;
  for (const user of db.users || []) {
    if (user.role === "whiteking" || user.cardKey) continue;
    user.cardKey = newCardKey();
    added += 1;
  }
  return added;
}

export function findByCardQr(users, text) {
  const value = String(text || "");
  if (!value.startsWith(CARD_QR_PREFIX)) return null;
  const key = Buffer.from(value.slice(CARD_QR_PREFIX.length));
  return (
    (users || []).find((user) => {
      if (!user.cardKey || user.role === "whiteking") return false;
      const own = Buffer.from(user.cardKey);
      return own.length === key.length && crypto.timingSafeEqual(own, key);
    }) || null
  );
}

export function publicUser(user, templates = {}) {
  if (!user) return null;
  const { pass, ver, cardKey, ...rest } = user;
  const result = structuredClone(rest);
  if (cardKey) result.cardQr = `${CARD_QR_PREFIX}${cardKey}`;
  if (result.card) {
    const texts = templates[String(result.card.clearance)];
    delete result.card.texts;
    if (texts && Object.keys(texts).length) result.card.texts = { ...texts };
  }
  return result;
}

export const CARD_LEVELS = [1, 2, 3, 4, 5];

export function ensureCardTemplates(db) {
  if (db.cardTemplates && typeof db.cardTemplates === "object") return false;
  db.cardTemplates = {};
  for (const user of db.users || []) {
    if (!user.card) continue;
    const level = String(user.card.clearance || 1);
    if (user.card.texts && Object.keys(user.card.texts).length && !db.cardTemplates[level]) db.cardTemplates[level] = user.card.texts;
    delete user.card.texts;
  }
  return true;
}

/** A card suspended only for a rotation rest block still opens the app; it just cannot be scanned. */
export function canLogin(user) {
  return Boolean(user) && (user.card?.status === "ACTIVE" || (user.card?.status === "SUSPENDED" && Boolean(user.card.restUntil)));
}

export function canScan(user) {
  return Boolean(user) && user.card?.status === "ACTIVE";
}

const LOGIN_CODE = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{4}$/;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeLoginCode() {
  for (;;) {
    const code = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join("");
    if (LOGIN_CODE.test(code)) return code;
  }
}

export function cleanLoginCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return LOGIN_CODE.test(code) ? code : null;
}

export function ensureLoginCodes(db) {
  const taken = new Set((db.users || []).map((user) => user.loginCode).filter(Boolean));
  const assigned = [];
  for (const user of db.users || []) {
    if (user.loginCode) continue;
    user.loginCode = unique(makeLoginCode, taken);
    taken.add(user.loginCode);
    assigned.push(user);
  }
  return assigned;
}

export function cleanUsername(value) {
  const name = String(value || "").trim().toLowerCase();
  return /^[a-z0-9._-]{3,24}$/.test(name) ? name : null;
}

export function passwordProblem(value) {
  const text = String(value || "");
  if (text.length < 6) return "Нууц үг хамгийн багадаа 6 тэмдэгт байна";
  if (text.length > 128) return "Нууц үг хэт урт байна";
  return null;
}

const CARD_TEXT = /^[\p{L}\p{N} .,'&/()-]{1,32}$/u;
const CARD_DATE = /^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/;
const CARD_ID = /^[A-Z0-9-]{3,16}$/;
const PLAIN_TEXT = /^[^\p{Cc}<>]*$/u;

export const CARD_TEXT_LIMITS = {
  brand: 16,
  sub: 24,
  subAccent: 32,
  nameLabel: 16,
  classLabel: 16,
  projectLabel: 16,
  idLabel: 16,
  statusLabel: 16,
  level: 24,
  band: 32,
  auth: 40,
  expiresLabel: 20,
  expiresSuffix: 16,
  backTop: 48,
  backTopAccent: 32,
  noticeTitle: 40,
  notice: 420,
  signLabel: 32,
  qrLabel: 20,
  cardNoLabel: 16,
  issuedLabel: 16,
  levelLabel: 16,
  backBand: 60,
  returnText: 80,
  hotline: 48,
};

export function cardTexts(input) {
  if (input === null) return { texts: {} };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "Картын бичвэр буруу" };
  const texts = {};
  for (const [key, raw] of Object.entries(input)) {
    const max = CARD_TEXT_LIMITS[key];
    if (!max) return { error: "Картын бичвэр буруу" };
    const value = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (value.length > max || !PLAIN_TEXT.test(value)) return { error: `Картын бичвэр ${max}-аас ихгүй тэмдэгт, < > тэмдэггүй байна` };
    texts[key] = value;
  }
  return { texts };
}

export function cardPatch(input, current) {
  const next = { ...current };
  if (input.idNumber !== undefined) {
    const value = String(input.idNumber).trim().toUpperCase();
    if (!CARD_ID.test(value)) return { error: "ID дугаар 3–16 латин үсэг, тоо, зураас байна" };
    next.idNumber = value;
  }
  if (input.signature !== undefined) {
    const value = String(input.signature).replace(/\s+/g, " ").trim();
    if (value.length > 40 || !PLAIN_TEXT.test(value)) return { error: "Гарын үсэг 40-өөс ихгүй тэмдэгт байна" };
    if (value) next.signature = value;
    else delete next.signature;
  }
  if (input.issued !== undefined) {
    const value = String(input.issued).trim();
    if (value && !CARD_DATE.test(value)) return { error: "Олгосон огноо буруу" };
    if (value) next.issued = value;
    else delete next.issued;
  }
  for (const key of ["classification", "project"]) {
    if (input[key] === undefined) continue;
    const value = String(input[key]).trim().toUpperCase();
    if (!CARD_TEXT.test(value)) return { error: "Картын бичвэр 1–32 тэмдэгт байна" };
    next[key] = value;
  }
  if (input.status !== undefined) {
    if (!CARD_STATUSES.includes(input.status)) return { error: "Төлөв буруу" };
    next.status = input.status;
  }
  if (input.clearance !== undefined) {
    const level = Number(input.clearance);
    if (!Number.isInteger(level) || level < 1 || level > 5) return { error: "Зэрэглэл 1–5 байна" };
    next.clearance = level;
  }
  if (input.expires !== undefined) {
    const value = String(input.expires).trim();
    if (!CARD_DATE.test(value)) return { error: "Хугацаа ММ/ӨӨ/ЖЖЖЖ хэлбэртэй байна" };
    next.expires = value;
  }
  return { card: next };
}

const PHOTO_PREFIX = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function photoProblem(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !PHOTO_PREFIX.test(value)) return "Зургийн формат буруу";
  if (value.length > 600_000) return "Зураг хэт том байна";
  return null;
}
