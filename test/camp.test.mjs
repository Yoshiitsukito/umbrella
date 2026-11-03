import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, newUser } from "../lib/auth.mjs";
import { ensureWhiteKing } from "../lib/whiteking.mjs";
import { autoBeds, createRecord, ensureMine, masterView, setBed, updateRecord } from "../lib/mine.mjs";
import { seedMine } from "../lib/mineseed.mjs";
import { CAMP_COLLECTIONS, CAMP_ROLE, campView, seedCamp } from "../lib/camp.mjs";
import { cleanRecord } from "../public/js/minecore.js";
import { addDays } from "../public/js/workstats.js";

const NOW = Date.parse("2026-11-01T10:00:00+08:00");
const TODAY = "2026-11-01";

function baseDb() {
  const users = [];
  users.push(newUser({ id: "usr_admin", username: "admin", password: "x", role: "admin", existing: users }));
  users.push(newUser({ id: "usr_a", username: "bold", password: "x", role: "user", displayName: "Болд", existing: users }));
  users.push(newUser({ id: "usr_b", username: "saraa", password: "x", role: "user", displayName: "Сараа", existing: users }));
  users.push(newUser({ id: "usr_master", username: "master", password: "x", role: "master", displayName: "Мастер", existing: users }));
  users.push(newUser({ id: "usr_camp", username: "camp", password: "x", role: CAMP_ROLE, displayName: "Кэмп менежер", existing: users }));
  const db = { users, shiftPlans: {}, leaves: [], attendance: { events: [], usedJti: [], people: {}, historyFrom: "2026-10-01" }, weather: null };
  ensureWhiteKing(db);
  ensureMine(db);
  return db;
}

const add = (db, name, body) => createRecord(db, name, body, { by: "usr_camp", now: NOW });

test("the camp manager is a role of its own and owns every camp collection", () => {
  assert.ok(ROLES.includes(CAMP_ROLE));
  assert.deepEqual(CAMP_COLLECTIONS.sort(), ["cameras", "contractors", "rooms", "transport"]);
});

test("camera addresses must be http(s) and are required for stream kinds", () => {
  const ctx = { user: () => true, ref: () => false, others: [] };
  assert.match(cleanRecord("cameras", { name: "Хаалга", zone: "gate", kind: "mjpeg", url: "javascript:alert(1)" }, ctx).error, /https/);
  assert.match(cleanRecord("cameras", { name: "Хаалга", zone: "gate", kind: "mjpeg", url: "rtsp://10.0.0.5/stream" }, ctx).error, /https/);
  const { record } = cleanRecord("cameras", { name: "Хаалга", zone: "gate", kind: "demo", url: "https://nvr.example/cam1", every: 5 }, ctx);
  assert.equal(record.url, null, "a demo camera keeps no address");
  assert.equal(record.every, null);
  assert.equal(record.enabled, true);
  const db = baseDb();
  assert.match(add(db, "cameras", { name: "Хаалга", zone: "gate", kind: "snapshot" }).error, /хаяг/);
  const ok = add(db, "cameras", { name: "Хаалга", zone: "gate", kind: "snapshot", url: "https://nvr.example/snap.jpg", every: 3 });
  assert.equal(ok.item.url, "https://nvr.example/snap.jpg");
  assert.equal(ok.item.every, 3);
  assert.match(add(db, "cameras", { name: "хаалга", zone: "dorm", kind: "demo" }).error, /бүртгэлтэй/);
  assert.equal(updateRecord(db, "cameras", ok.item.id, { ...ok.item, kind: "embed", url: "https://nvr.example/live" }, { by: "usr_camp", now: NOW }).item.kind, "embed");
});

test("the camp view carries staff and camp records, and the master view no longer does", () => {
  const db = baseDb();
  db.shiftPlans = { usr_a: { type: "rotation", pattern: "dd", start: addDays(TODAY, -3), before: [] } };
  const room = add(db, "rooms", { block: "A", number: "A101", beds: 2 }).item;
  assert.deepEqual(setBed(db, room.id, 0, "usr_a"), { ok: true });
  assert.match(setBed(db, room.id, 1, "usr_camp").error, /Ажилтан/, "only shift staff take beds");
  const view = campView(db, NOW);
  assert.deepEqual(view.users.map((user) => user.id).sort(), ["usr_a", "usr_b"]);
  assert.equal(view.camp.beds[`${room.id}:0`], "usr_a");
  assert.ok(view.plans.usr_a && !view.hse && !view.skills, "no safety or competency records");
  assert.ok(!JSON.stringify(view).includes("passwordHash") && !JSON.stringify(view).includes('"secret"'));
  assert.equal(masterView(db, NOW).camp, undefined);
  autoBeds(db, NOW);
  assert.equal(Object.values(db.camp.beds).filter((uid) => uid === "usr_a").length, 1);
});

test("demo cameras are added once, after the mine demo data", () => {
  const db = baseDb();
  assert.equal(seedCamp(db, NOW), null, "nothing before the mine demo exists");
  let state = 7;
  seedMine(db, { now: NOW, random: () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648) });
  assert.deepEqual(seedCamp(db, NOW), { added: 6 });
  assert.equal(seedCamp(db, NOW), null);
  assert.ok(db.camp.cameras.every((cam) => cam.kind === "demo" && cam.enabled));
  assert.equal(campView(db, NOW).camp.cameras.length, 6);
});
