import crypto from "node:crypto";

export const PENDING_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 5;
const MAX_DEVICES = 20;

function digest(key) {
  return crypto.createHash("sha256").update(String(key)).digest();
}

function cleanName(value) {
  const name = String(value ?? "").replace(/[\p{Cc}<>]/gu, "").trim().slice(0, 40);
  return name || "Төхөөрөмж";
}

function isLive(device, now) {
  return device.status === "approved" || now - Date.parse(device.requestedAt) < PENDING_TTL_MS;
}

export function pruneDevices(wk, now = Date.now()) {
  wk.devices = (wk.devices || []).filter((device) => isLive(device, now));
}

export function requestDevice(wk, name, now = Date.now()) {
  pruneDevices(wk, now);
  if (wk.devices.filter((device) => device.status === "pending").length >= MAX_PENDING) return { error: "Хүлээгдэж буй хүсэлт хэт олон байна. Админ шийдвэрлэсний дараа дахин оролдоно уу." };
  if (wk.devices.length >= MAX_DEVICES) return { error: "Холбогдсон төхөөрөмжийн тоо дээд хэмжээндээ хүрсэн." };
  const key = crypto.randomBytes(24).toString("base64url");
  const device = {
    id: crypto.randomBytes(6).toString("hex"),
    name: cleanName(name),
    code: String(crypto.randomInt(1000, 10000)),
    keyHash: digest(key).toString("hex"),
    status: "pending",
    requestedAt: new Date(now).toISOString(),
    approvedAt: null,
    lastSeen: null,
  };
  wk.devices.push(device);
  return { id: device.id, key, code: device.code };
}

export function deviceLogin(wk, id, key, now = Date.now()) {
  const device = (wk.devices || []).find((item) => item.id === String(id || ""));
  if (!device || !isLive(device, now)) return { status: "unknown" };
  const expected = Buffer.from(device.keyHash, "hex");
  if (!crypto.timingSafeEqual(expected, digest(key))) return { status: "unknown" };
  if (device.status !== "approved") return { status: "pending", code: device.code };
  device.lastSeen = new Date(now).toISOString();
  return { status: "ok", device };
}

export function approveDevice(wk, id, now = Date.now()) {
  const device = (wk.devices || []).find((item) => item.id === id && isLive(item, now));
  if (!device) return null;
  device.status = "approved";
  device.approvedAt ||= new Date(now).toISOString();
  return device;
}

export function removeDevice(wk, id) {
  const index = (wk.devices || []).findIndex((item) => item.id === id);
  return index < 0 ? null : wk.devices.splice(index, 1)[0];
}

export function deviceList(wk, now = Date.now()) {
  return (wk.devices || [])
    .filter((device) => isLive(device, now))
    .map(({ id, name, code, status, requestedAt, approvedAt, lastSeen }) => ({ id, name, code, status, requestedAt, approvedAt, lastSeen }));
}
