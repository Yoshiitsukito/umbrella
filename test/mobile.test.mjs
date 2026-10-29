import test from "node:test";
import assert from "node:assert/strict";
import { activityInput, applyPhoneActivity, locationInput, phoneSleep, sleepWindows } from "../lib/mobile.mjs";
import { issueMobileToken, issueSession, verifyMobileToken, verifySession } from "../lib/auth.mjs";

const local = (text) => Date.parse(`${text}+08:00`);

test("the sleep button opens at 19:00 after a day shift and at 07:00 after a night shift", () => {
  const plan = { "2026-10-27": "day", "2026-10-28": "night", "2026-10-29": "night", "2026-10-30": "off" };
  const kindOn = (date) => plan[date] || "off";
  const evening = sleepWindows(kindOn, local("2026-10-27T20:00:00"));
  assert.deepEqual(evening[0], { kind: "evening", from: new Date(local("2026-10-27T19:00:00")).toISOString(), until: new Date(local("2026-10-28T04:00:00")).toISOString() });
  const morning = sleepWindows(kindOn, local("2026-10-29T08:00:00"));
  assert.equal(morning[0].kind, "night");
  assert.equal(morning[0].from, new Date(local("2026-10-29T07:00:00")).toISOString());
  assert.ok(!morning.some((item) => item.from === new Date(local("2026-10-29T19:00:00")).toISOString()), "no evening button before a night shift");
  const rest = sleepWindows(kindOn, local("2026-10-30T12:00:00"));
  assert.deepEqual(rest.map((item) => item.kind), ["night", "evening", "evening"]);
});

test("phone activity is checked and replaces the day's steps", () => {
  assert.equal(activityInput({ steps: -1 }, "2026-10-28").error, "Алхам 0–100000 байна");
  assert.equal(activityInput({ steps: 10, date: "2026-10-20" }, "2026-10-28").error, "Огноо буруу");
  const input = activityInput({ steps: 4200, active: 12, date: "2026-10-27" }, "2026-10-28");
  const day = { steps: 9000, active: 30 };
  applyPhoneActivity(day, input, local("2026-10-28T00:05:00"));
  assert.equal(day.steps, 4200);
  assert.equal(day.active, 30);
  assert.equal(day.phone.steps, 4200);
});

test("location fixes and button sleep are validated", () => {
  assert.equal(locationInput({ lat: 120, lng: 0 }).error, "Байршил буруу");
  assert.deepEqual(locationInput({ lat: 47.9184123, lng: 106.9177456, acc: 8.4, at: "2026-10-28T01:00:00Z" }, Date.parse("2026-10-28T02:00:00Z")).place, {
    lat: 47.918412,
    lng: 106.917746,
    acc: 8,
    at: "2026-10-28T01:00:00.000Z",
  });
  const night = phoneSleep({ start: "2026-10-28T14:40:00Z", end: "2026-10-28T22:10:00Z" }, Date.parse("2026-10-28T23:00:00Z"));
  assert.deepEqual(night, { date: "2026-10-29", sleep: { start: "22:40", end: "06:10", min: 450, score: null, source: "phone" } });
  assert.ok(phoneSleep({ start: "2026-10-28T14:40:00Z", end: "2026-10-28T14:50:00Z" }).error);
});

test("mobile tokens and browser sessions are not interchangeable", () => {
  const user = { id: "usr_a", ver: 2 };
  const mobile = issueMobileToken("secret", user);
  const session = issueSession("secret", user);
  assert.equal(verifyMobileToken("secret", mobile).uid, "usr_a");
  assert.equal(verifySession("secret", mobile), null);
  assert.equal(verifyMobileToken("secret", session), null);
});
