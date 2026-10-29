import test from "node:test";
import assert from "node:assert/strict";
import {
  addWater,
  announcementInput,
  announcementsFor,
  birthdaysAround,
  birthdayValue,
  dayOf,
  freshNotices,
  leaveNotice,
  personalOf,
  planNotice,
  prunePersonal,
  pushNotice,
  reminderInput,
  sleepInput,
  sunTimes,
  toggleMeal,
  applyWatch,
  watchInput,
  weekFor,
} from "../lib/personal.mjs";

test("each user gets a separate record under its own key", () => {
  const db = {};
  dayOf(personalOf(db, "u1"), "2026-10-28").water = 500;
  addWater(dayOf(personalOf(db, "u2"), "2026-10-28"), 250);
  assert.equal(db.personal_u1.days["2026-10-28"].water, 500);
  assert.equal(db.personal_u2.days["2026-10-28"].water, 250);
  assert.equal(db.personal_u2.days["2026-10-28"].cups, 1);
});

test("sleep input spans midnight and validates the watch score", () => {
  assert.deepEqual(sleepInput({ start: "23:30", end: "07:00" }).sleep, { start: "23:30", end: "07:00", min: 450, score: null });
  assert.equal(sleepInput({ start: "08:30", end: "15:00", score: "82" }).sleep.min, 390);
  assert.ok(sleepInput({ start: "25:00", end: "07:00" }).error);
  assert.ok(sleepInput({ start: "23:00", end: "07:00", score: 140 }).error);
});

test("a smartwatch reading saves only the values given and replaces day totals", () => {
  const { reading } = watchInput({ start: "22:30", end: "06:00", score: "", steps: "9120", active: "", sys: "", dia: "", hr: "64" });
  assert.deepEqual(reading, { sleep: { start: "22:30", end: "06:00", min: 450, score: null }, steps: 9120, vitals: { sys: null, dia: null, hr: 64, source: "watch" } });
  const record = { days: {}, vitals: [] };
  const day = dayOf(record, "2026-10-28");
  day.steps = 3000;
  applyWatch(record, day, reading, Date.parse("2026-10-28T01:00:00Z"));
  assert.equal(day.steps, 9120);
  assert.equal(day.sleep.min, 450);
  assert.deepEqual(record.vitals, [{ at: "2026-10-28T01:00:00.000Z", sys: null, dia: null, hr: 64, source: "watch" }]);
  assert.equal(watchInput({ hr: 72, source: "ble" }).reading.vitals.source, "ble");
  assert.ok(watchInput({ sys: 120 }).error, "blood pressure needs both numbers");
  assert.ok(watchInput({ hr: 300 }).error);
  assert.ok(watchInput({ start: "23:00" }).error);
  assert.ok(watchInput({}).error);
});

test("meals toggle and reminders reject markup", () => {
  const day = {};
  assert.ok(toggleMeal(day, "lunch"));
  assert.equal(day.meals.lunch, true);
  toggleMeal(day, "lunch");
  assert.equal(day.meals.lunch, false);
  assert.equal(toggleMeal(day, "snack"), false);
  assert.ok(reminderInput({ title: "<b>x</b>" }).error);
  assert.ok(reminderInput({ title: "Тайлан", due: "9:00" }).error);
  const { reminder } = reminderInput({ title: "  Тайлан   илгээх ", due: "16:45" });
  assert.equal(reminder.title, "Тайлан илгээх");
  assert.equal(reminder.due, "16:45");
});

test("pruning drops old days, finished reminders and stale notices", () => {
  const now = Date.parse("2026-10-28T04:00:00Z");
  const record = personalOf({}, "u1");
  dayOf(record, "2026-08-01").water = 1;
  dayOf(record, "2026-10-01").water = 1;
  record.reminders.push({ id: "a", done: true, doneOn: "2026-10-20" }, { id: "b", done: true, doneOn: "2026-10-27" }, { id: "c", done: false });
  pushNotice(record, "plan", "old", now - 20 * 86400000);
  pushNotice(record, "plan", "new", now);
  prunePersonal(record, "2026-10-28", now);
  assert.deepEqual(Object.keys(record.days), ["2026-10-01"]);
  assert.deepEqual(record.reminders.map((item) => item.id), ["b", "c"]);
  assert.deepEqual(freshNotices(record, now).map((item) => item.text), ["new"]);
});

test("plan and leave notices describe the change", () => {
  const before = ["off", "day", "day", "day", "day", "day", "off"];
  const after = ["off", "day", "day", "day", "night", "day", "off"];
  assert.equal(planNotice(before, after, "2026-10-29"), "Маргаашийн ээлж өөрчлөгдлөө: Өдөр → Шөнө.");
  assert.equal(planNotice(before, after, "2026-10-28"), "Ээлжийн хуваарь шинэчлэгдлээ: Пү.");
  assert.equal(planNotice(before, before, "2026-10-28"), null);
  const rotation = { type: "rotation", start: "2026-11-02", before };
  assert.equal(planNotice(before, rotation, "2026-10-29"), "Маргаашийн ээлж өөрчлөгдлөө: Өдөр → Амралт.");
  assert.equal(planNotice(before, { ...rotation, start: "2026-10-26", from: "2026-11-02" }, "2026-10-29"), "Маргаашийн ээлж өөрчлөгдлөө: Өдөр → Амралт.");
  assert.equal(planNotice(rotation, { ...rotation, start: "2026-11-03" }, "2026-10-29"), "Ээлжийн хуваарь шинэчлэгдлээ: 7 хоног өдөр, 7 хоног шөнө, 14 хоног амралт. 11.03-аас: Өдөр.");
  assert.equal(planNotice(before, { ...rotation, start: "2026-10-22" }, "2026-10-29"), "Маргаашийн ээлж өөрчлөгдлөө: Өдөр → Шөнө.");
  assert.equal(leaveNotice({ type: "trip", from: "2026-11-02", to: "2026-11-04", status: "approved" }), "Томилолт хүсэлт (11.02–11.04) зөвшөөрөгдлөө.");
  assert.deepEqual(weekFor({ shiftPlans: {} }, { id: "a", role: "admin" }), ["off", "off", "off", "off", "off", "off", "off"]);
});

test("announcements expose read state without leaking who read", () => {
  const now = Date.parse("2026-10-28T04:00:00Z");
  const { announcement } = announcementInput({ text: "Маргааш 10:00-д хурал" }, "Admin", now);
  announcement.readBy.push("u1");
  const [mine] = announcementsFor([announcement], "u1", now);
  assert.equal(mine.read, true);
  assert.equal(mine.readBy, undefined);
  assert.equal(announcementsFor([announcement], "u2", now)[0].read, false);
  assert.equal(announcementsFor([announcement], "u2", now + 20 * 86400000).length, 0);
  assert.ok(announcementInput({ text: "" }, "Admin").error);
});

test("birthdays wrap the year and handle leap days", () => {
  assert.equal(birthdayValue("").value, null);
  assert.ok(birthdayValue("2999-01-01").error);
  const users = [
    { id: "a", displayName: "A", birthday: "1990-10-28" },
    { id: "b", displayName: "B", birthday: "1995-01-02" },
    { id: "c", displayName: "C", birthday: "2000-02-29" },
    { id: "w", displayName: "W", birthday: "1990-10-28", role: "whiteking" },
  ];
  assert.deepEqual(birthdaysAround(users, "2026-10-28").map((item) => [item.id, item.inDays, item.age]), [["a", 0, 36]]);
  assert.deepEqual(birthdaysAround(users, "2026-12-30").map((item) => [item.id, item.inDays]), [["b", 3]]);
  assert.deepEqual(birthdaysAround(users, "2027-02-25").map((item) => [item.id, item.date]), [["c", "2027-02-28"]]);
});

test("sun times for Ulaanbaatar land at plausible local hours", () => {
  const { rise, set } = sunTimes(47.92, 106.92, "2026-10-28");
  const local = (ms) => new Date(ms + 8 * 3600000).toISOString().slice(11, 16);
  assert.ok(local(rise) > "07:15" && local(rise) < "07:45", local(rise));
  assert.ok(local(set) > "17:30" && local(set) < "18:00", local(set));
});
