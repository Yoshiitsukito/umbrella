import test from "node:test";
import assert from "node:assert/strict";
import { newUser } from "../lib/auth.mjs";
import { ensureMine } from "../lib/mine.mjs";
import { campView } from "../lib/camp.mjs";
import { personalOf } from "../lib/personal.mjs";
import { cancelPass, decidePass, gatePass, ownPasses, passInbox, passesView, requestPass } from "../lib/passes.mjs";
import { awaits, canSee, checkPass, isLate, nextGate, passStatus } from "../public/js/passcore.js";

const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-11-01T10:00:00+08:00");

function baseDb() {
  const users = [];
  const add = (id, role, displayName) => users.push(newUser({ id, username: id, password: "x", role, displayName, existing: users }));
  add("usr_a", "user", "Болд");
  add("usr_b", "user", "Сараа");
  add("usr_hr", "hr", "Хүний нөөц");
  add("usr_eng", "engineer", "Ахлах");
  add("usr_camp", "campmgr", "Кэмп");
  add("usr_sec", "security", "Харуул");
  const db = { users, shiftPlans: {}, leaves: [], attendance: { events: [], usedJti: [], people: {}, historyFrom: "2026-10-01" } };
  ensureMine(db);
  return db;
}

const me = (db, id) => db.users.find((user) => user.id === id);
const ask = (db, uid, body, now = NOW) => requestPass(db, me(db, uid), body, now);
const local = (ms) => new Date(ms + 8 * HOUR).toISOString().slice(0, 16);

test("a request is checked for kind, times, length and reason", () => {
  assert.match(checkPass({ kind: "trip", from: local(NOW + HOUR), reason: "Эмнэлэг" }, NOW).error, /төрөл/);
  assert.match(checkPass({ kind: "arrive", reason: "Эмнэлэг" }, NOW).error, /Ирэх цаг/);
  assert.match(checkPass({ kind: "depart", from: local(NOW - 3 * HOUR), reason: "Гэр бүл" }, NOW).error, /Өнгөрсөн/);
  assert.match(checkPass({ kind: "exit", from: local(NOW + HOUR), reason: "Эмнэлэг" }, NOW).error, /Буцаж ирэх/);
  assert.match(checkPass({ kind: "exit", from: local(NOW + HOUR), until: local(NOW), reason: "Эмнэлэг" }, NOW).error, /хойш/);
  assert.match(checkPass({ kind: "exit", from: local(NOW + HOUR), until: local(NOW + 80 * HOUR), reason: "Эмнэлэг" }, NOW).error, /ээлжийн бусаар буух/);
  assert.match(checkPass({ kind: "arrive", from: local(NOW + HOUR), reason: "а" }, NOW).error, /Шалтгаан/);
  assert.match(checkPass({ kind: "arrive", from: local(NOW + HOUR), reason: "<script>" }, NOW).error, /< >/);
  const { pass } = checkPass({ kind: "arrive", from: local(NOW + 2 * HOUR), until: local(NOW + 5 * HOUR), place: "Сум", reason: "  Ээлж  солих  " }, NOW);
  assert.deepEqual(pass, { kind: "arrive", from: new Date(NOW + 2 * HOUR).toISOString(), until: null, reason: "Ээлж солих", place: null });
});

test("only shift staff ask, and one open request per kind and time", () => {
  const db = baseDb();
  assert.equal(ask(db, "usr_eng", { kind: "exit", from: local(NOW + HOUR), until: local(NOW + 4 * HOUR), reason: "Сум" }).status, 403);
  const first = ask(db, "usr_a", { kind: "exit", from: local(NOW + HOUR), until: local(NOW + 4 * HOUR), reason: "Эмнэлэг" });
  assert.ok(first.pass.id.startsWith("ps_"));
  assert.equal(ask(db, "usr_a", { kind: "exit", from: local(NOW + 2 * HOUR), until: local(NOW + 6 * HOUR), reason: "Банк" }).status, 409);
  assert.ok(ask(db, "usr_a", { kind: "exit", from: local(NOW + 5 * HOUR), until: local(NOW + 6 * HOUR), reason: "Банк" }).pass, "a later, separate trip");
  assert.ok(ask(db, "usr_b", { kind: "exit", from: local(NOW + HOUR), until: local(NOW + 4 * HOUR), reason: "Эмнэлэг" }).pass);
});

test("leaving the mine area needs only the chief engineer; security records out and back in", () => {
  const db = baseDb();
  const { pass } = ask(db, "usr_a", { kind: "exit", from: local(NOW + HOUR), until: local(NOW + 4 * HOUR), reason: "Эмнэлэг" });
  assert.equal(decidePass(db, pass.id, { role: "hr", me: me(db, "usr_hr"), ok: true, now: NOW }).status, 403, "HR does not decide exits");
  assert.equal(gatePass(db, pass.id, { step: "out", me: me(db, "usr_sec"), now: NOW }).status, 409, "not approved yet");
  assert.ok(awaits(pass, "engineer", NOW));
  assert.equal(decidePass(db, pass.id, { role: "engineer", me: me(db, "usr_eng"), ok: true, now: NOW }).ok, true);
  assert.equal(passStatus(pass, NOW), "approved");
  assert.equal(decidePass(db, pass.id, { role: "engineer", me: me(db, "usr_eng"), ok: false, note: "Үгүй", now: NOW }).status, 409);
  assert.equal(personalOf(db, "usr_a").notices.at(-1).kind, "pass-ok");
  assert.equal(gatePass(db, pass.id, { step: "in", me: me(db, "usr_sec"), now: NOW }).status, 409, "out comes first");
  assert.ok(gatePass(db, pass.id, { step: "out", me: me(db, "usr_sec"), now: NOW + HOUR }).ok);
  assert.equal(nextGate(pass, NOW + HOUR), "in");
  assert.equal(isLate(pass, NOW + 5 * HOUR), true, "past the return time while still out");
  assert.equal(passInbox(db, "security", NOW + 5 * HOUR), 1);
  assert.ok(gatePass(db, pass.id, { step: "in", me: me(db, "usr_sec"), now: NOW + 5 * HOUR }).ok);
  assert.equal(passStatus(pass, NOW + 5 * HOUR), "done");
  assert.equal(isLate(pass, NOW + 5 * HOUR), false);
});

test("off-rotation arrival needs both HR and the chief engineer; one refusal refuses", () => {
  const db = baseDb();
  const { pass } = ask(db, "usr_a", { kind: "arrive", from: local(NOW + 24 * HOUR), reason: "Ээлж солих" });
  assert.equal(passInbox(db, "hr", NOW), 1);
  assert.equal(passInbox(db, "engineer", NOW), 1);
  decidePass(db, pass.id, { role: "hr", me: me(db, "usr_hr"), ok: true, now: NOW });
  assert.equal(passStatus(pass, NOW), "pending", "still waiting for the engineer");
  assert.equal(passInbox(db, "hr", NOW), 0);
  assert.equal(cancelPass(db, "usr_a", pass.id, NOW).status, 409, "no withdrawing once someone decided");
  decidePass(db, pass.id, { role: "engineer", me: me(db, "usr_eng"), ok: true, now: NOW });
  assert.equal(passStatus(pass, NOW), "approved");
  assert.equal(passInbox(db, "campmgr", NOW), 1, "the camp plans a bed");
  assert.ok(gatePass(db, pass.id, { step: "in", me: me(db, "usr_sec"), now: NOW + 24 * HOUR }).ok);
  assert.equal(passStatus(pass, NOW + 24 * HOUR), "done");

  const depart = ask(db, "usr_b", { kind: "depart", from: local(NOW + 3 * HOUR), reason: "Гэр бүлийн асуудал" }).pass;
  assert.match(decidePass(db, depart.id, { role: "engineer", me: me(db, "usr_eng"), ok: false, now: NOW }).error, /шалтгаан/);
  decidePass(db, depart.id, { role: "engineer", me: me(db, "usr_eng"), ok: false, note: "Ээлж дутуу", now: NOW });
  assert.equal(passStatus(depart, NOW), "rejected");
  assert.equal(awaits(depart, "hr", NOW), false, "HR no longer has to decide");
  assert.match(personalOf(db, "usr_b").notices.at(-1).text, /Уулын ахлах татгалзлаа: Ээлж дутуу/);
});

test("nobody decides their own request, and unanswered requests expire", () => {
  const db = baseDb();
  const own = requestPass(db, me(db, "usr_hr"), { kind: "depart", from: local(NOW + HOUR), reason: "Өвчтэй" }, NOW).pass;
  assert.equal(decidePass(db, own.id, { role: "hr", me: me(db, "usr_hr"), ok: true, now: NOW }).status, 403);
  assert.equal(passStatus(own, NOW + 30 * HOUR), "expired");
  const exit = ask(db, "usr_a", { kind: "exit", from: local(NOW + HOUR), until: local(NOW + 3 * HOUR), reason: "Банк" }).pass;
  decidePass(db, exit.id, { role: "engineer", me: me(db, "usr_eng"), ok: true, now: NOW });
  assert.equal(passStatus(exit, NOW + 4 * HOUR), "expired", "approved but never used");
  assert.equal(gatePass(db, exit.id, { step: "out", me: me(db, "usr_sec"), now: NOW + 4 * HOUR }).status, 409);
});

test("a worker withdraws an undecided request", () => {
  const db = baseDb();
  const { pass } = ask(db, "usr_a", { kind: "arrive", from: local(NOW + 30 * HOUR), reason: "Сургалт" });
  assert.equal(cancelPass(db, "usr_b", pass.id, NOW).status, 404, "only their own");
  assert.deepEqual(cancelPass(db, "usr_a", pass.id, NOW), { ok: true });
  assert.equal(ownPasses(db, "usr_a", NOW).length, 0);
});

test("each role sees only its kinds; the camp sees approved arrivals and departures", () => {
  const db = baseDb();
  const exit = ask(db, "usr_a", { kind: "exit", from: local(NOW + HOUR), until: local(NOW + 3 * HOUR), reason: "Банк" }).pass;
  const arrive = ask(db, "usr_b", { kind: "arrive", from: local(NOW + 26 * HOUR), reason: "Ээлж солих" }).pass;
  assert.equal(canSee(exit, "campmgr"), false);
  assert.equal(canSee(exit, "hr"), false);
  assert.deepEqual(passesView(db, "campmgr", NOW).passes.map((pass) => pass.id), [arrive.id]);
  assert.deepEqual(passesView(db, "security", NOW).passes.map((pass) => pass.id).sort(), [exit.id, arrive.id].sort());
  assert.deepEqual(passesView(db, "hr", NOW).passes.map((pass) => pass.id), [arrive.id]);
  const board = passesView(db, "engineer", NOW);
  assert.equal(board.passes.length, 2);
  assert.equal(board.inbox, 2, "the board carries the menu count");
  assert.equal(passesView(db, "hr", NOW).inbox, 1);
  assert.deepEqual(board.users.map((user) => user.id).sort(), ["usr_a", "usr_b"]);
  assert.ok(!JSON.stringify(board).includes("passwordHash"));
  assert.equal(campView(db, NOW).passes.length, 0, "not approved yet");
  decidePass(db, arrive.id, { role: "hr", me: me(db, "usr_hr"), ok: true, now: NOW });
  decidePass(db, arrive.id, { role: "engineer", me: me(db, "usr_eng"), ok: true, now: NOW });
  assert.deepEqual(campView(db, NOW).passes.map(({ uid, kind, date }) => ({ uid, kind, date })), [{ uid: "usr_b", kind: "arrive", date: "2026-11-02" }]);
});
