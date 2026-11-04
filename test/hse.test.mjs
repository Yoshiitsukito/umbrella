import test from "node:test";
import assert from "node:assert/strict";
import { ROLES, newUser } from "../lib/auth.mjs";
import { HSE_ROLE, createRecord, ensureMine, masterView, mineUsers } from "../lib/mine.mjs";
import { GUARD_ROLE, decideViolation } from "../lib/guard.mjs";
import { personalOf } from "../lib/personal.mjs";
import { defaultRoutes } from "../public/js/minecore.js";

const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-11-01T10:00:00+08:00");
const local = (ms) => new Date(ms + 8 * HOUR).toISOString().slice(0, 16);

function baseDb() {
  const users = [];
  const add = (id, role, displayName) => users.push(newUser({ id, username: id, password: "x", role, displayName, existing: users }));
  add("usr_a", "user", "Болд");
  add("usr_head", "user", "Дарга");
  add("usr_hr", "hr", "Хүний нөөц");
  add("usr_master", "master", "Мастер");
  add("usr_sec", GUARD_ROLE, "Харуул");
  add("usr_hse", HSE_ROLE, "ХАБЭА менежер");
  add("usr_camp", "campmgr", "Кэмп");
  const db = { users, shiftPlans: {}, leaves: [], attendance: { events: [], usedJti: [], people: {}, historyFrom: "2026-10-01" } };
  ensureMine(db);
  const dept = createRecord(db, "depts", { name: "Уулын ажлын хэсэг", head: "usr_head" }, { by: "usr_master", now: NOW }).item;
  createRecord(db, "posts", { uid: "usr_a", position: "operator", dept: dept.id }, { by: "usr_master", now: NOW });
  return db;
}

const hseMe = { id: "usr_hse", role: HSE_ROLE, displayName: "ХАБЭА менежер" };
const report = (db, body) => createRecord(db, "violations", { at: local(NOW - HOUR), kind: "ppe", severity: "medium", detail: "Малгайгүй явсан", ...body }, { by: "usr_sec", now: NOW });
const hseNotices = (db, uid) => personalOf(db, uid).notices.filter((notice) => notice.kind === "hse");

test("the HSE manager is a role of its own and a person mine records may name", () => {
  assert.ok(ROLES.includes(HSE_ROLE));
  const db = baseDb();
  assert.ok(mineUsers(db).some((user) => user.id === "usr_hse"));
  assert.ok(masterView(db, NOW).users.some((user) => user.id === "usr_hse"));
});

test("a new violation or incident reaches the HSE manager, not the one who recorded it", () => {
  const db = baseDb();
  report(db, { party: "staff", uid: "usr_a", place: "Хаалга 1" });
  assert.equal(hseNotices(db, "usr_hse").length, 1);
  assert.match(hseNotices(db, "usr_hse")[0].text, /шинэ зөрчил.*Болд.*Хаалга 1/);
  createRecord(db, "incidents", { kind: "hazard", title: "Налуу нурж болзошгүй", severity: "high", at: local(NOW - HOUR), status: "open" }, { by: "usr_a", now: NOW });
  assert.equal(hseNotices(db, "usr_hse").length, 2);
  assert.match(hseNotices(db, "usr_hse")[1].text, /Аюулын мэдээлэл.*Налуу.*Болд/);
  createRecord(db, "incidents", { kind: "nearmiss", title: "Өөрөө бүртгэв", severity: "low", at: local(NOW - HOUR), status: "open" }, { by: "usr_hse", now: NOW });
  assert.equal(hseNotices(db, "usr_hse").length, 2);
});

test("the usual recipients follow the decision, the measure and who broke the rule", () => {
  assert.deepEqual(defaultRoutes("review", null), ["security"]);
  assert.deepEqual(defaultRoutes("dismissed", null), ["security"]);
  assert.deepEqual(defaultRoutes("acted", "warning"), ["security", "head"]);
  assert.deepEqual(defaultRoutes("acted", "fine"), ["security", "head", "hr"]);
  assert.deepEqual(defaultRoutes("acted", "suspend"), ["security", "head", "hr", "master"]);
  assert.deepEqual(defaultRoutes("acted", "training", "contractor"), ["security", "master", "campmgr"]);
});

test("a decision goes to the chosen departments once, and again only when it changes", () => {
  const db = baseDb();
  const item = report(db, { party: "staff", uid: "usr_a" }).item;
  assert.match(decideViolation(db, item.id, { status: "review", routes: ["nobody"] }, hseMe, NOW).error, /Илгээх хэсэг/);
  const first = decideViolation(db, item.id, { status: "acted", measure: "fine", note: "50,000₮", routes: ["security", "head", "hr"] }, hseMe, NOW);
  assert.ok(first.ok);
  assert.equal(first.sent, 3);
  assert.deepEqual(first.item.routes, ["security", "head", "hr"]);
  for (const uid of ["usr_sec", "usr_head", "usr_hr"]) assert.match(hseNotices(db, uid).at(-1).text, /ХАБЭА-ын шийдвэр.*Болд.*Торгууль.*50,000₮/);
  assert.equal(hseNotices(db, "usr_master").length, 0);
  assert.equal(hseNotices(db, "usr_a").length, 1, "the worker hears once, in their own words");
  assert.match(hseNotices(db, "usr_a")[0].text, /арга хэмжээ авлаа/);

  const again = decideViolation(db, item.id, { status: "acted", measure: "fine", note: "Засвар", routes: ["security", "head", "hr", "master"] }, hseMe, NOW);
  assert.equal(again.sent, 1, "only the newly added master hears");
  assert.equal(hseNotices(db, "usr_sec").length, 1);
  assert.equal(hseNotices(db, "usr_master").length, 1);

  const changed = decideViolation(db, item.id, { status: "acted", measure: "suspend", note: "Давтан", routes: ["security", "hr"] }, hseMe, NOW);
  assert.equal(changed.sent, 2);
  assert.match(hseNotices(db, "usr_hr").at(-1).text, /түдгэлзүүлэх/);
  assert.equal(hseNotices(db, "usr_head").length, 1);
});

test("an outsider's violation reaches the camp manager, and no department head is guessed", () => {
  const db = baseDb();
  const item = report(db, { party: "contractor", person: "Дорж · ABC ХХК", kind: "alcohol" }).item;
  const result = decideViolation(db, item.id, { status: "acted", measure: "dismiss", routes: ["security", "head", "campmgr"] }, hseMe, NOW);
  assert.equal(result.sent, 2);
  assert.match(hseNotices(db, "usr_camp")[0].text, /Дорж · ABC ХХК/);
  assert.equal(hseNotices(db, "usr_head").length, 0);
});
