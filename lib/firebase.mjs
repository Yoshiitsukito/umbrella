import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCOPE = "https://www.googleapis.com/auth/datastore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const MAX_COMMIT_BYTES = 8_000_000;

export class FirebaseError extends Error {}

let account;
let token = null;

export function firebaseAccount() {
  if (account !== undefined) return account;
  account = null;
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE?.trim();
  if (!inline && !file) return account;
  let raw;
  try {
    raw = inline || readFileSync(path.resolve(root, file), "utf8");
    if (inline && !inline.startsWith("{")) raw = Buffer.from(inline, "base64").toString("utf8");
    raw = JSON.parse(raw);
  } catch {
    throw new FirebaseError("Firebase service account JSON уншигдсангүй");
  }
  if (!raw.project_id || !raw.client_email || !raw.private_key) throw new FirebaseError("Firebase service account JSON дутуу байна");
  account = {
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || raw.project_id,
    databaseId: process.env.FIREBASE_DATABASE_ID?.trim() || "(default)",
    clientEmail: raw.client_email,
    privateKey: raw.private_key,
  };
  return account;
}

export function firebaseConfigured() {
  return Boolean(firebaseAccount());
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function signedAssertion({ clientEmail, privateKey }, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), privateKey).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

async function accessToken() {
  if (token && token.until - Date.now() > 60_000) return token.value;
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedAssertion(firebaseAccount()) });
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new FirebaseError(`Firebase нэвтрэлт амжилтгүй (${res.status})`);
  token = { value: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return token.value;
}

function documentsPath() {
  const { projectId, databaseId } = firebaseAccount();
  return `projects/${projectId}/databases/${databaseId}/documents`;
}

async function call(method, url, body) {
  const res = await fetch(`https://firestore.googleapis.com/v1/${url}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new FirebaseError(`Firestore алдаа (${res.status}): ${data.error?.status || data.error?.message || "тодорхойгүй"}`);
  return data;
}

export function toValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: value.length ? { values: value.map(toValue) } : {} };
  return { mapValue: toFields(value) };
}

function toFields(object) {
  const fields = {};
  for (const [key, item] of Object.entries(object)) if (item !== undefined) fields[key] = toValue(item);
  return Object.keys(fields).length ? { fields } : {};
}

export function fromValue(value) {
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(fromValue);
  if ("mapValue" in value) return fromFields(value.mapValue.fields);
  return null;
}

function fromFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, fromValue(item)]));
}

export async function listDocuments(collection) {
  const docs = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ pageSize: "300" });
    if (pageToken) query.set("pageToken", pageToken);
    const data = await call("GET", `${documentsPath()}/${collection}?${query}`);
    for (const doc of data.documents || []) docs.push({ id: doc.name.split("/").pop(), data: fromFields(doc.fields) });
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return docs;
}

export async function commitWrites(writes) {
  const base = documentsPath();
  const encoded = writes.map((write) =>
    write.delete
      ? { delete: `${base}/${write.collection}/${write.id}` }
      : { update: { name: `${base}/${write.collection}/${write.id}`, ...toFields(write.data) } },
  );
  let batch = [];
  let size = 0;
  for (const write of encoded) {
    const bytes = Buffer.byteLength(JSON.stringify(write));
    if (batch.length && (size + bytes > MAX_COMMIT_BYTES || batch.length >= 450)) {
      await call("POST", `${base}:commit`, { writes: batch });
      batch = [];
      size = 0;
    }
    batch.push(write);
    size += bytes;
  }
  if (batch.length) await call("POST", `${base}:commit`, { writes: batch });
}
