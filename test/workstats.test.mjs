import test from "node:test";
import assert from "node:assert/strict";
import { addDays, CYCLE_WORK_DAYS, cycleRange, dayRecord, nextShift, onTimeStreak, periodRange, periodSummary, plannedKind, rotationPhase, sessionsOf, shiftDateOf, shiftSpan, SHIFT_MS } from "../public/js/workstats.js";
import { applyRestUpdate, cleanPlan, cleanWeek, leaveRequest, noteAttempt, patternsFor, pruneLeaves, restBlock, restUpdates } from "../lib/workplan.mjs";
import { canLogin, canScan } from "../lib/auth.mjs";

const at = (local) => Date.parse(`${local}+08:00`);
const iso = (local) => new Date(at(local)).toISOString();
const ev = (local, state, uid = "u") => ({ at: iso(local), state, uid });
const DAYS = ["day", "day", "day", "day", "day", "day", "day"];

test("shift spans and shift dates follow the 06:00 boundary in Ulaanbaatar time", () => {
  assert.equal(shiftSpan("2026-10-28", "day").start, at("2026-10-28T06:00:00"));
  assert.equal(shiftSpan("2026-10-28", "night").end, at("2026-10-29T06:00:00"));
  assert.equal(shiftDateOf(at("2026-10-29T05:59:00")), "2026-10-28");
  assert.equal(shiftDateOf(at("2026-10-29T06:00:00")), "2026-10-29");
});

test("an early arrival counts toward the coming shift, and lateness/early leave use a 5 min grace", () => {
  const now = at("2026-10-29T10:00:00");
  const events = [ev("2026-10-28T05:50:00", "in"), ev("2026-10-28T17:40:00", "out")];
  const sessions = sessionsOf(events, "u", now);
  const day = dayRecord({ sessions, week: DAYS, leaves: [], uid: "u", date: "2026-10-28", now });
  assert.equal(day.status, "ontime");
  assert.equal(day.late, 0);
  assert.equal(day.early, 20);
  assert.equal(day.worked, (11 * 60 + 50) * 60 * 1000);
  const late = dayRecord({ sessions: sessionsOf([ev("2026-10-28T06:20:00", "in")], "u", now), week: DAYS, leaves: [], uid: "u", date: "2026-10-28", now });
  assert.equal(late.status, "late");
  assert.equal(late.late, 20);
  assert.equal(late.forgot, true);
});

test("night shifts crossing midnight stay on their start date", () => {
  const now = at("2026-10-30T10:00:00");
  const nights = ["night", "night", "night", "night", "night", "night", "night"];
  const sessions = sessionsOf([ev("2026-10-28T17:58:00", "in"), ev("2026-10-29T06:03:00", "out")], "u", now);
  const night = dayRecord({ sessions, week: nights, leaves: [], uid: "u", date: "2026-10-28", now });
  assert.equal(night.status, "ontime");
  assert.equal(night.early, 0);
  assert.equal(dayRecord({ sessions, week: nights, leaves: [], uid: "u", date: "2026-10-29", now }).status, "absent");
});

test("approved leave replaces absence; days off and upcoming shifts are not absences", () => {
  const now = at("2026-10-28T07:00:00");
  const leaves = [{ uid: "u", status: "approved", type: "sick", from: "2026-10-27", to: "2026-10-27" }];
  const week = ["off", "day", "day", "day", "day", "day", "off"];
  const summary = periodSummary({ sessions: [], week, leaves, uid: "u", from: "2026-10-25", to: "2026-10-31", now });
  assert.deepEqual(
    summary.days.map((day) => day.status),
    ["off", "absent", "leave", "missing", "upcoming", "upcoming", "off"],
  );
  assert.equal(summary.targetDays, 4);
  assert.equal(summary.workedDays, 0);
  assert.equal(summary.leftDays, 3);
  assert.equal(summary.absent, 1);
  assert.equal(summary.leave, 1);
});

test("worked days follow the 7-7-14 cycle and count day and night shifts separately", () => {
  const plan = { type: "rotation", start: "2026-10-05" };
  assert.deepEqual(cycleRange(plan, "2026-10-28"), { from: "2026-10-05", to: "2026-11-01" });
  assert.deepEqual(cycleRange(plan, "2026-11-02"), { from: "2026-11-02", to: "2026-11-29" });
  assert.deepEqual(cycleRange(plan, "2026-10-28", 1), { from: "2026-09-07", to: "2026-10-04" });
  assert.deepEqual(cycleRange(["off", "day", "day", "day", "day", "day", "off"], "2026-10-28"), { from: "2026-10-05", to: "2026-11-01" });
  const now = at("2026-10-20T10:00:00");
  const events = [
    ev("2026-10-05T06:00:00", "in"), ev("2026-10-05T18:00:00", "out"),
    ev("2026-10-06T06:20:00", "in"), ev("2026-10-06T18:00:00", "out"),
    ev("2026-10-12T18:00:00", "in"), ev("2026-10-13T06:00:00", "out"),
    ev("2026-10-19T08:00:00", "in"), ev("2026-10-19T12:00:00", "out"),
  ];
  const sum = periodSummary({ sessions: sessionsOf(events, "u", now), week: plan, leaves: [], uid: "u", ...cycleRange(plan, "2026-10-20"), now });
  assert.equal(sum.targetDays, CYCLE_WORK_DAYS);
  assert.equal(sum.workedDays, 4);
  assert.equal(sum.dayShifts, 2);
  assert.equal(sum.nightShifts, 1);
  assert.equal(sum.extra, 1);
  assert.equal(sum.late, 1);
  assert.equal(sum.absent, 11);
  assert.equal(sum.leftDays, 0);
  assert.equal(sum.restTarget, 14);
  assert.equal(sum.restedDays, 1, "the worked day off does not count as rest");
  const fresh = periodSummary({ sessions: sessionsOf(events, "u", now), week: plan, leaves: [], uid: "u", ...cycleRange(plan, "2026-10-20"), now, since: "2026-10-19" });
  assert.equal(fresh.from, "2026-10-19");
  assert.equal(fresh.days.length, 14);
  assert.deepEqual([fresh.targetDays, fresh.workedDays, fresh.absent], [0, 1, 0], "days before tracking began are not counted as absences");
  assert.equal(onTimeStreak({ sessions: [], week: plan, leaves: [], uid: "u", today: "2026-10-20", now, since: "2026-10-20" }), 0);
});

test("before a rotation starts its first cycle is shown, and shifts over before a reset are not absences", () => {
  const plan = { type: "rotation", start: "2026-10-29", before: ["off", "day", "day", "day", "day", "day", "off"] };
  assert.deepEqual(cycleRange(plan, "2026-10-28"), { from: "2026-10-29", to: "2026-11-25" });
  const now = at("2026-10-28T22:10:00");
  const sum = periodSummary({ sessions: [], week: plan, leaves: [], uid: "u", ...cycleRange(plan, "2026-10-28"), now, since: "2026-10-28" });
  assert.deepEqual([sum.targetDays, sum.restTarget], [14, 14]);
  assert.equal(plannedKind(plan, "2026-10-28"), "off");
  const month = periodSummary({ sessions: [], week: plan.before, leaves: [], uid: "u", from: "2026-10-01", to: "2026-10-31", now, since: "2026-10-28", sinceAt: now });
  assert.equal(month.days[0].status, "untracked", "the Wednesday day shift ended before the reset");
  assert.deepEqual([month.absent, month.targetDays], [0, 2]);
});

test("streaks count on-time shifts back to the last late or missed one", () => {
  const now = at("2026-10-30T19:00:00");
  const events = [
    ev("2026-10-27T06:30:00", "in"),
    ev("2026-10-27T18:00:00", "out"),
    ev("2026-10-28T06:00:00", "in"),
    ev("2026-10-28T18:00:00", "out"),
    ev("2026-10-29T05:55:00", "in"),
    ev("2026-10-29T18:00:00", "out"),
    ev("2026-10-30T06:02:00", "in"),
  ];
  const sessions = sessionsOf(events, "u", now);
  assert.equal(onTimeStreak({ sessions, week: DAYS, leaves: [], uid: "u", today: "2026-10-30", now }), 3);
});

test("next shift skips days off and approved leave", () => {
  const week = ["off", "day", "day", "day", "day", "day", "off"];
  const leaves = [{ uid: "u", status: "approved", type: "trip", from: "2026-10-30", to: "2026-10-30" }];
  const next = nextShift({ week, leaves, uid: "u", now: at("2026-10-29T19:00:00") });
  assert.equal(next.date, "2026-11-02");
  assert.equal(next.shift, "day");
});

test("period ranges cover Monday-Sunday weeks and calendar months", () => {
  assert.deepEqual(periodRange("week", "2026-10-28"), { from: "2026-10-26", to: "2026-11-01" });
  assert.deepEqual(periodRange("lastweek", "2026-10-28"), { from: "2026-10-19", to: "2026-10-25" });
  assert.deepEqual(periodRange("month", "2026-10-28"), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(periodRange("lastmonth", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
});

test("leave requests are validated and overlapping ones refused", () => {
  const base = { uid: "u", today: "2026-10-28" };
  assert.ok(leaveRequest({ type: "sick", from: "2026-10-27", to: "2026-10-28", note: "Ханиад" }, base).leave);
  assert.match(leaveRequest({ type: "vacation", from: "2026-10-27", to: "2026-10-28" }, base).error, /төрөл/);
  assert.match(leaveRequest({ type: "leave", from: "2026-10-30", to: "2026-10-29" }, base).error, /өмнө/);
  assert.match(leaveRequest({ type: "leave", from: "2026-02-30", to: "2026-03-01" }, base).error, /Огноо/);
  assert.match(leaveRequest({ type: "leave", from: "2026-11-01", to: "2026-12-15" }, base).error, /31/);
  assert.match(leaveRequest({ type: "leave", from: "2026-10-29", to: "2026-10-29", note: "<b>" }, base).error, /Тайлбар/);
  const leaves = [{ uid: "u", status: "pending", from: "2026-10-29", to: "2026-10-31" }];
  assert.match(leaveRequest({ type: "trip", from: "2026-10-31", to: "2026-11-02" }, { ...base, leaves }).error, /өөр хүсэлт/);
  assert.ok(leaveRequest({ type: "trip", from: "2026-10-31", to: "2026-11-02" }, { ...base, uid: "v", leaves }).leave);
  assert.equal(pruneLeaves([{ to: "2026-05-01" }, { to: "2026-10-01" }], "2026-10-28").length, 1);
});

test("shift plans and card attempts are sanitised", () => {
  assert.deepEqual(cleanWeek(["off", "day", "day", "night", "day", "day", "off"]), ["off", "day", "day", "night", "day", "day", "off"]);
  assert.equal(cleanWeek(["day"]), null);
  assert.equal(cleanWeek(["off", "day", "day", "evening", "day", "day", "off"]), null);
  const now = at("2026-10-28T10:00:00");
  const old = [{ uid: "u", at: iso("2026-09-01T10:00:00"), reason: "mismatch" }];
  assert.deepEqual(noteAttempt(old, "u", { reason: "mismatch" }, now).map((item) => item.reason), ["mismatch"]);
  assert.equal(noteAttempt([], "u", { reason: "cancelled" }, now).length, 0);
});

test("a 7 day / 7 night / 14 off rotation repeats every 28 days and rests before it starts", () => {
  const before = ["off", "day", "day", "day", "day", "day", "off"];
  const plan = { type: "rotation", start: "2026-10-28", before };
  const run = Array.from({ length: 30 }, (_, index) => plannedKind(plan, addDays("2026-10-28", index)));
  assert.deepEqual(run.slice(0, 7), Array(7).fill("day"));
  assert.deepEqual(run.slice(7, 14), Array(7).fill("night"));
  assert.deepEqual(run.slice(14, 28), Array(14).fill("off"));
  assert.deepEqual(run.slice(28), ["day", "day"]);
  assert.equal(plannedKind(plan, "2026-10-25"), "off");
  assert.equal(plannedKind(plan, "2026-10-27"), "off", "the days before the first shift are rest, not the old week");
  assert.deepEqual(rotationPhase(plan, "2026-11-06"), { kind: "night", index: 3, length: 7, next: { kind: "off", date: "2026-11-11" } });
  assert.equal(rotationPhase(plan, "2026-10-28").index, 1);
  assert.equal(rotationPhase(plan, "2026-10-28").length, 7);
  assert.deepEqual(rotationPhase(plan, "2026-11-11"), { kind: "off", index: 1, length: 14, next: { kind: "day", date: "2026-11-25" } });
  const fromNight = { type: "rotation", start: "2026-10-21", from: "2026-10-28", before: plan };
  assert.equal(plannedKind(fromNight, "2026-10-27"), "off");
  assert.equal(plannedKind(fromNight, "2026-10-29"), "night");
  assert.equal(plannedKind({ ...fromNight, from: "2026-11-01" }, "2026-10-29"), "day", "an earlier rotation still applies before the new one");
  assert.equal(plannedKind(fromNight, "2026-10-25"), "off");
  assert.equal(plannedKind(fromNight, "2026-10-28"), "night");
  assert.deepEqual(rotationPhase(fromNight, "2026-10-28"), { kind: "night", index: 1, length: 7, next: { kind: "off", date: "2026-11-04" } });
  const sessions = sessionsOf([ev("2026-11-04T17:55:00", "in"), ev("2026-11-05T06:01:00", "out")], "u", at("2026-11-05T10:00:00"));
  assert.equal(dayRecord({ sessions, week: plan, leaves: [], uid: "u", date: "2026-11-04", now: at("2026-11-05T10:00:00") }).status, "ontime");
  assert.equal(nextShift({ week: plan, leaves: [], uid: "u", now: at("2026-11-12T10:00:00") }).date, "2026-11-25");
});

test("plan bodies are either a week or a dated rotation", () => {
  const week = ["off", "day", "day", "day", "day", "day", "off"];
  assert.deepEqual(cleanPlan({ days: week }, null), week);
  assert.deepEqual(cleanPlan({ rotation: { start: "2026-10-28" } }, week), { type: "rotation", start: "2026-10-28", before: week });
  const running = { type: "rotation", start: "2026-10-28", before: week };
  assert.deepEqual(cleanPlan({ rotation: { start: "2026-11-01" } }, running).before, running);
  assert.deepEqual(cleanPlan({ rotation: { start: "2026-10-21", from: "2026-10-28" } }, running), { type: "rotation", start: "2026-10-21", from: "2026-10-28", before: week });
  assert.equal(cleanPlan({ rotation: { start: "2026-10-28", from: "2026-10-21" } }, week), null);
  const tonight = { type: "rotation", start: "2026-10-21", from: "2026-10-28", before: week };
  const corrected = cleanPlan({ rotation: { start: "2026-10-22", from: "2026-10-29" } }, tonight, "2026-10-28");
  assert.deepEqual(corrected, { type: "rotation", start: "2026-10-22", from: "2026-10-29", before: week });
  assert.equal(plannedKind(corrected, "2026-10-28"), "off");
  assert.equal(plannedKind(corrected, "2026-10-29"), "night");
  assert.deepEqual(cleanPlan({ rotation: { start: "2026-10-22", from: "2026-10-29" } }, tonight, "2026-11-02").before, tonight);
  assert.deepEqual(cleanPlan({ rotation: { start: "2026-11-01" } }, null), { type: "rotation", start: "2026-11-01" });
  assert.equal(cleanPlan({ rotation: { start: "2026-02-30" } }, week), null);
  assert.equal(cleanPlan({ rotation: {} }, week), null);
});

test("a night-first rotation runs 7 nights, 7 days, 14 off; HR works 14 days then 14 off", () => {
  const nights = { type: "rotation", start: "2026-11-01", pattern: "nd" };
  const kinds = (plan) => Array.from({ length: 28 }, (_, index) => plannedKind(plan, addDays("2026-11-01", index)));
  assert.deepEqual(kinds(nights), [...Array(7).fill("night"), ...Array(7).fill("day"), ...Array(14).fill("off")]);
  const hr = { type: "rotation", start: "2026-11-01", pattern: "dd" };
  assert.deepEqual(kinds(hr), [...Array(14).fill("day"), ...Array(14).fill("off")]);
  assert.equal(plannedKind(hr, "2026-11-29"), "day");
  assert.deepEqual(rotationPhase(hr, "2026-11-05"), { kind: "day", index: 5, length: 14, next: { kind: "off", date: "2026-11-15" } });
  assert.deepEqual(cleanPlan({ rotation: { start: "2026-11-01", pattern: "nd" } }, null), nights);
  assert.equal(cleanPlan({ rotation: { start: "2026-11-01", pattern: "dd" } }, null), null);
  assert.deepEqual(cleanPlan({ rotation: { start: "2026-11-01" } }, null, null, patternsFor("hr")), hr);
  assert.equal(cleanPlan({ rotation: { start: "2026-11-01", pattern: "nd" } }, null, null, patternsFor("hr")), null);
  assert.deepEqual(cleanPlan({ rotation: { start: "2026-12-01" } }, nights, "2026-11-20").before, nights);
  const restAfterDays = restBlock(hr, at("2026-11-15T10:00:00"));
  assert.deepEqual(restAfterDays, { until: "2026-11-29", kind: "day", resumeAt: at("2026-11-29T03:00:00") });
  assert.equal(restBlock(hr, at("2026-11-08T19:00:00")), null);
});

test("rest block starts 3h after the last night shift and ends 3h before the next day shift", () => {
  const plan = { type: "rotation", start: "2026-11-02" };
  assert.deepEqual(restBlock(plan, at("2026-11-16T10:00:00")), { until: "2026-11-30", kind: "day", resumeAt: at("2026-11-30T03:00:00") });
  assert.equal(restBlock(plan, at("2026-11-16T07:00:00")), null);
  assert.equal(restBlock(plan, at("2026-11-30T04:00:00")), null);
  assert.equal(restBlock(plan, at("2026-11-09T00:00:00")), null);
  assert.equal(restBlock(plan, at("2026-11-04T21:00:00")), null);
  assert.equal(restBlock([...Array(7).fill("off")], at("2026-11-16T10:00:00")), null);
  assert.equal(restBlock({ type: "rotation", start: "2026-10-19", from: "2026-11-20" }, at("2026-11-16T10:00:00")), null);
});

test("rest updates suspend, respect a manual hold and resume the card", () => {
  const plans = { u1: { type: "rotation", start: "2026-11-02" }, a1: { type: "rotation", start: "2026-11-02" } };
  const card = { status: "ACTIVE" };
  const users = [{ id: "u1", role: "user", card }, { id: "a1", role: "admin", card: { status: "ACTIVE" } }];
  const resting = at("2026-11-16T10:00:00");
  const [suspend, ...rest] = restUpdates(users, plans, resting);
  assert.equal(rest.length, 0);
  assert.equal(suspend.type, "suspend");
  applyRestUpdate(card, suspend);
  assert.deepEqual(card, { status: "SUSPENDED", restUntil: "2026-11-30" });
  assert.equal(canLogin({ card }), true);
  assert.equal(canScan({ card }), false);
  assert.deepEqual(restUpdates(users, plans, resting), []);
  const [resume] = restUpdates(users, plans, at("2026-11-30T04:00:00"));
  assert.equal(resume.type, "resume");
  applyRestUpdate(card, resume);
  assert.deepEqual(card, { status: "ACTIVE" });
  assert.equal(canScan({ card }), true);
  const held = { status: "ACTIVE", restHold: "2026-11-30" };
  assert.deepEqual(restUpdates([{ id: "u1", role: "user", card: held }], plans, resting), []);
  assert.equal(restUpdates([{ id: "u1", role: "user", card: held }], plans, at("2026-11-30T04:00:00"))[0].type, "release");
  assert.equal(canLogin({ card: { status: "SUSPENDED" } }), false);
});
