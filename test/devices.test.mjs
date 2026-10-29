import assert from "node:assert/strict";
import test from "node:test";
import { PENDING_TTL_MS, approveDevice, deviceList, deviceLogin, removeDevice, requestDevice } from "../lib/devices.mjs";

test("a device can sign in only after an admin approves it", () => {
  const wk = { devices: [] };
  const now = Date.parse("2026-10-28T08:00:00Z");
  const request = requestDevice(wk, "Galaxy A07", now);
  assert.match(request.code, /^\d{4}$/);
  assert.deepEqual(deviceLogin(wk, request.id, request.key, now), { status: "pending", code: request.code });
  assert.equal(deviceLogin(wk, request.id, "wrong-key", now).status, "unknown");
  assert.ok(approveDevice(wk, request.id, now));
  assert.equal(deviceLogin(wk, request.id, request.key, now + 1000).status, "ok");
  assert.equal(deviceList(wk, now)[0].keyHash, undefined);
});

test("unapproved requests expire and removed devices are locked out", () => {
  const wk = { devices: [] };
  const now = Date.parse("2026-10-28T08:00:00Z");
  const stale = requestDevice(wk, "old", now);
  assert.equal(deviceLogin(wk, stale.id, stale.key, now + PENDING_TTL_MS + 1).status, "unknown");
  assert.equal(approveDevice(wk, stale.id, now + PENDING_TTL_MS + 1), null);

  const kept = requestDevice(wk, "station", now);
  approveDevice(wk, kept.id, now);
  assert.equal(deviceLogin(wk, kept.id, kept.key, now + 30 * 24 * 3600 * 1000).status, "ok");
  removeDevice(wk, kept.id);
  assert.equal(deviceLogin(wk, kept.id, kept.key, now).status, "unknown");
});

test("pending requests are capped", () => {
  const wk = { devices: [] };
  for (let i = 0; i < 5; i += 1) assert.ok(requestDevice(wk, `d${i}`).key);
  assert.ok(requestDevice(wk, "one too many").error);
});
