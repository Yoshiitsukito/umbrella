import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, newUser } from "../lib/auth.mjs";
import { createRecord, deleteRecord, ensureMine, masterView, updateRecord } from "../lib/mine.mjs";
import { GUARD_COLLECTIONS, GUARD_ROLE, decideViolation, guardView } from "../lib/guard.mjs";
import { personalOf } from "../lib/personal.mjs";
import { requestPass } from "../lib/passes.mjs";

const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-11-01T10:00:00+08:00");
const local = (ms) => new Date(ms + 8 * HOUR).toISOString().slice(0, 16);

function baseDb() {
  const users = [];
  const add = (id, role, displayName) => users.push(newUser({ id, username: id, password: "x", role, displayName, existing: users }));
  add("usr_a", "user", "Болд");
  add("usr_master", "master", "Мастер");
  add("usr_sec", GUARD_ROLE, "Харуул");
  const db = { users, shiftPlans: {}, leaves: [], attendance: { events: [], usedJti: [], people: {}, historyFrom: "2026-10-01" } };
  ensureMine(db);
  return db;
}

const report = (db, body, now = NOW) => createRecord(db, "violations", { at: local(now - HOUR), kind: "ppe", severity: "medium", detail: "Малгайгүй явсан", ...body }, { by: "usr_sec", now });

test("security is a role of its own and owns the violations log", () => {
  assert.ok(ROLES.includes(GUARD_ROLE));
  assert.deepEqual(GUARD_COLLECTIONS, ["violations"]);
});

test("a violation names a worker or an outsider and cannot be dated ahead", () => {
  const db = baseDb();
  assert.match(report(db, { party: "staff" }).error, /Ажилтнаа/);
  assert.match(report(db, { party: "visitor" }).error, /нэрийг/);
  assert.match(report(db, { party: "staff", uid: "usr_a", at: local(NOW + 2 * HOUR) }).error, /ирээдүй/);
  const staff = report(db, { party: "staff", uid: "usr_a", hseStatus: "acted" }).item;
  assert.equal(staff.hseStatus, "new", "the reporter cannot set HSE's decision");
  const visitor = report(db, { party: "contractor", person: "Дорж · ABC ХХК", kind: "alcohol", severity: "high" }).item;
  assert.equal(visitor.person, "Дорж · ABC ХХК");
  assert.equal(db.guard.violations.length, 2);
});

test("security edits or removes a violation only until HSE takes it up", () => {
  const db = baseDb();
  const item = report(db, { party: "staff", uid: "usr_a" }).item;
  const edited = updateRecord(db, "violations", item.id, { ...item, place: "Хаалга 2", hseStatus: "dismissed" }, { by: "usr_sec", now: NOW });
  assert.equal(edited.item.place, "Хаалга 2");
  assert.equal(edited.item.hseStatus, "new");
  assert.ok(decideViolation(db, item.id, { status: "review" }, { displayName: "Мастер" }, NOW).ok);
  assert.match(updateRecord(db, "violations", item.id, { ...item, place: "Өөр" }, { by: "usr_sec", now: NOW }).error, /ХАБЭА/);
  assert.equal(deleteRecord(db, "violations", item.id).status, 409);
  const fresh = report(db, { party: "other", person: "Жолооч" }).item;
  assert.ok(deleteRecord(db, "violations", fresh.id).item);
});

test("HSE acts on a violation with a measure, and the worker is told once", () => {
  const db = baseDb();
  const item = report(db, { party: "staff", uid: "usr_a" }).item;
  const master = { displayName: "Мастер" };
  assert.match(decideViolation(db, item.id, { status: "new" }, master, NOW).error, /буруу/);
  assert.match(decideViolation(db, item.id, { status: "acted" }, master, NOW).error, /арга хэмжээ/);
  assert.match(decideViolation(db, item.id, { status: "dismissed" }, master, NOW).error, /шалтгаан/);
  assert.equal(decideViolation(db, "vio_none", { status: "review" }, master, NOW).status, 404);
  const notices = () => personalOf(db, "usr_a").notices.filter((notice) => notice.kind === "hse");
  const acted = decideViolation(db, item.id, { status: "acted", measure: "warning", note: "Сануулга өгсөн" }, master, NOW).item;
  assert.deepEqual([acted.hseStatus, acted.measure, acted.hseNote, acted.hseBy], ["acted", "warning", "Сануулга өгсөн", "Мастер"]);
  assert.equal(notices().length, 1);
  assert.match(notices()[0].text, /Сануулга/);
  decideViolation(db, item.id, { status: "acted", measure: "warning", note: "Дахин" }, master, NOW);
  assert.equal(notices().length, 1, "same measure again is not news");
  const outsider = report(db, { party: "visitor", person: "Зочин" }).item;
  decideViolation(db, outsider.id, { status: "dismissed", note: "Зөвшөөрөлтэй байсан" }, master, NOW);
  assert.equal(outsider.hseStatus, "dismissed");
  assert.equal(outsider.measure, null);
});

test("the master's HSE page sees violations; the security page sees staff, violations and gate counts", () => {
  const db = baseDb();
  report(db, { party: "staff", uid: "usr_a" });
  assert.equal(masterView(db, NOW).guard.violations.length, 1);
  const pass = requestPass(db, db.users[0], { kind: "exit", from: local(NOW + HOUR), until: local(NOW + 3 * HOUR), reason: "Эмнэлэг" }, NOW).pass;
  pass.decisions.engineer = { ok: true, by: "Ахлах", uid: "usr_eng", at: new Date(NOW).toISOString(), note: null };
  const view = guardView(db, NOW);
  assert.deepEqual(view.users.map((user) => user.id), ["usr_a"], "only shift staff are named in reports");
  assert.equal(view.guard.violations.length, 1);
  assert.deepEqual(view.gate, { out: 0, late: 0, ready: 1, pending: 0 });
  assert.ok(!view.hse && !view.skills && !view.ops, "no other safety or production records");
  assert.ok(!JSON.stringify(view).includes("passwordHash"));
});
