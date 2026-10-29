import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { commitWrites, firebaseAccount, firebaseConfigured, listDocuments } from "./firebase.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "data", "db.json");

export function defaultDb() {
  return {
    secret: crypto.randomBytes(32).toString("hex"),
    profile: {
      id: "usr_saran",
      displayName: "Сарантуяа",
      title: "Бүтээгдэхүүний дизайнер",
      org: "HOLO Lab",
      email: "saran@holo.local",
      weightKg: 62,
    },
    location: { lat: 47.9184, lng: 106.9177, label: "Улаанбаатар" },
    attendance: { people: {}, events: [], usedJti: [] },
    briefings: [],
    alerts: [],
    announcements: [],
    vision: null,
    messages: [],
    weather: null,
  };
}

const APP = "app";
const USERS = "users";

let chain = Promise.resolve();
let memory = null;
let persisted = new Map();

async function readLocal() {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeLocal(db) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(db, null, 2));
}

function stableJson(value) {
  return JSON.stringify(value, (key, item) =>
    item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]])) : item,
  );
}

export function splitDb(db) {
  const docs = new Map();
  for (const [key, value] of Object.entries(db)) {
    if (key === USERS || value === undefined) continue;
    docs.set(`${APP}/${key}`, { value });
  }
  (db.users || []).forEach((user, order) => docs.set(`${USERS}/${user.id}`, { order, user }));
  return new Map([...docs].map(([name, data]) => [name, stableJson(data)]));
}

export function joinDb(appDocs, userDocs) {
  const db = Object.fromEntries(appDocs.map((doc) => [doc.id, doc.data.value]));
  const users = userDocs.filter((doc) => doc.data.user).sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));
  if (users.length) db.users = users.map((doc) => doc.data.user);
  return db;
}

async function pushChanges(db) {
  const next = splitDb(db);
  const writes = [];
  for (const [name, json] of next) {
    if (persisted.get(name) === json) continue;
    const [collection, id] = name.split("/");
    writes.push({ collection, id, data: JSON.parse(json) });
  }
  for (const name of persisted.keys()) {
    if (next.has(name)) continue;
    const [collection, id] = name.split("/");
    writes.push({ collection, id, delete: true });
  }
  if (writes.length) await commitWrites(writes);
  persisted = next;
}

async function readFirebase() {
  const [appDocs, userDocs] = await Promise.all([listDocuments(APP), listDocuments(USERS)]);
  if (appDocs.length || userDocs.length) {
    const db = joinDb(appDocs, userDocs);
    persisted = splitDb(db);
    return db;
  }
  const db = (await readLocal()) || defaultDb();
  persisted = new Map();
  await pushChanges(db);
  console.log("Firebase Firestore хоосон байсан тул одоогийн өгөгдлийг шилжүүллээ.");
  return db;
}

async function read() {
  if (memory) return memory;
  if (firebaseConfigured()) {
    memory = await readFirebase();
    await writeLocal(memory);
    return memory;
  }
  memory = await readLocal();
  if (!memory) {
    memory = defaultDb();
    await writeLocal(memory);
  }
  return memory;
}

export function storageLabel() {
  if (!firebaseConfigured()) return "data/db.json (дотоод файл)";
  const { projectId, databaseId } = firebaseAccount();
  return `Firebase Firestore · ${projectId}${databaseId === "(default)" ? "" : ` / ${databaseId}`}`;
}

export function update(mutator) {
  const run = chain.then(async () => {
    const db = await read();
    const result = await mutator(db);
    memory = db;
    await writeLocal(db);
    if (firebaseConfigured()) {
      try {
        await pushChanges(db);
      } catch (error) {
        console.error(`Firebase руу бичиж чадсангүй, дараагийн өөрчлөлтөөр дахин оролдоно: ${error.message}`);
      }
    }
    return result === undefined ? db : result;
  });
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}

export function inspect(reader) {
  const run = chain.then(async () => reader(await read()));
  chain = run.then(
    () => {},
    () => {},
  );
  return run;
}

export async function load() {
  return update((db) => structuredClone(db));
}
