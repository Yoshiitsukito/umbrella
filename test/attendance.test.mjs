import test from "node:test";
import assert from "node:assert/strict";
import { ensureAttendance, presenceOf, recordScan, shiftOf, shiftWindows } from "../lib/attendance.mjs";

const at = (local) => Date.parse(`${local}+08:00`);

test("shifts run 06:00-18:00 (day) and 18:00-06:00 (night) on the same shift date", () => {
  assert.deepEqual(shiftOf(new Date(at("2026-10-28T06:00:00")).toISOString()), { date: "2026-10-28", shift: "day" });
  assert.deepEqual(shiftOf(new Date(at("2026-10-28T17:59:00")).toISOString()), { date: "2026-10-28", shift: "day" });
  assert.deepEqual(shiftOf(new Date(at("2026-10-28T18:00:00")).toISOString()), { date: "2026-10-28", shift: "night" });
  assert.deepEqual(shiftOf(new Date(at("2026-10-29T00:00:00")).toISOString()), { date: "2026-10-28", shift: "night" });
  assert.deepEqual(shiftOf(new Date(at("2026-10-29T05:59:00")).toISOString()), { date: "2026-10-28", shift: "night" });
  const windows = shiftWindows(at("2026-10-29T00:00:00"));
  assert.equal(windows.date, "2026-10-28");
  assert.equal(windows.current, "night");
  assert.equal(windows.night.start, new Date(at("2026-10-28T18:00:00")).toISOString());
  assert.equal(windows.night.end, new Date(at("2026-10-29T06:00:00")).toISOString());
});

test("each user checks in and out independently", () => {
  const attendance = { people: {}, events: [], usedJti: [] };
  const now = at("2026-10-28T07:00:00");
  assert.equal(recordScan(attendance, "a", { lat: 1, lng: 2 }, now), "in");
  assert.equal(recordScan(attendance, "b", { lat: 1, lng: 2 }, now + 60000), "in");
  assert.equal(recordScan(attendance, "a", { lat: 1, lng: 2 }, now + 120000), "out");
  assert.equal(presenceOf(attendance, "a").state, "out");
  assert.equal(presenceOf(attendance, "b").state, "in");
  assert.equal(presenceOf(attendance, "c").state, "out");
  assert.deepEqual(
    attendance.events.map((item) => [item.uid, item.state, item.shift, item.date]),
    [
      ["a", "in", "day", "2026-10-28"],
      ["b", "in", "day", "2026-10-28"],
      ["a", "out", "day", "2026-10-28"],
    ],
  );
});

test("legacy single-profile attendance is migrated to per-user records", () => {
  const db = {
    profile: { id: "usr_saran" },
    attendance: { state: "in", since: "2026-10-28T01:00:00.000Z", events: [{ at: "2026-10-28T01:00:00.000Z", state: "in" }], usedJti: [] },
  };
  assert.equal(ensureAttendance(db), true);
  assert.deepEqual(db.attendance.people, { usr_saran: { state: "in", since: "2026-10-28T01:00:00.000Z" } });
  assert.equal(db.attendance.events[0].uid, "usr_saran");
  assert.equal(db.attendance.events[0].shift, "day");
  assert.equal("state" in db.attendance, false);
  assert.equal(ensureAttendance(db), false);
});
