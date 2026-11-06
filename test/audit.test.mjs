import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { newUser } from "../lib/auth.mjs";
import { auditDays, auditList, auditLog, bodySummary, compact, diffRecords, findAudit, pruneAudit, snapshotOf } from "../lib/audit.mjs";
import { backupDue, backupName, listBackups, mergeRestore, parseBackup, parseName, pruneBackups, readBackup, writeBackup } from "../lib/backup.mjs";
import { createRecord, deleteRecord, ensureMine, restoreRecord } from "../lib/mine.mjs";

const NOW = Date.parse("2026-11-05T10:00:00+08:00");
const DAY = 24 * 3600 * 1000;

test("a diff lists only changed fields, hides secrets and skips the edit stamp", () => {
  const before = { title: "Хуучин", value: 1, pass: "h1", updatedAt: "a", same: [1, 2] };
  const after = { title: "Шинэ", value: 1, pass: "h2", updatedAt: "b", same: [1, 2], extra: true };
  assert.deepEqual(diffRecords(before, after), { title: ["Хуучин", "Шинэ"], pass: ["•••", "•••"], extra: [null, true] });
  assert.deepEqual(diffRecords(null, { a: 1 }), { a: [null, 1] });
  assert.deepEqual(diffRecords({ next: "2026-12-01" }, { next: "2027-01-01" }), { next: ["2026-12-01", "2027-01-01"] }, "an exam's next date is not a secret");
});

test("compact copies cut long text, hide files and secrets, and trim deep or long structures", () => {
  const value = compact({ note: "я".repeat(400), photo: "data:image/jpeg;base64,AAAA", token: "t", list: Array.from({ length: 40 }, (_, index) => index), deep: { a: { b: { c: { d: 1 } } } } });
  assert.equal(value.note.length, 301);
  assert.equal(value.photo, "[файл]");
  assert.equal(value.token, "•••");
  assert.equal(value.list.length, 31);
  assert.equal(value.list.at(-1), "… +10");
  assert.equal(value.deep.a.b.c, "{…}");
  assert.equal(bodySummary({}), undefined);
  assert.deepEqual(bodySummary({ password: "x", name: "a" }), { password: "•••", name: "a" });
});

test("a deleted record is kept whole when small, trimmed and marked partial when large", () => {
  assert.deepEqual(snapshotOf({ id: "r1", title: "A", photo: "data:x", auth: "s" }), { snapshot: { id: "r1", title: "A", photo: null } });
  const big = snapshotOf({ id: "r2", text: "x".repeat(20_000) });
  assert.equal(big.partial, true);
  assert.equal(big.snapshot.text.length, 301);
});

test("entries go under one key per local day, shard when a day fills up, and are listed newest first", () => {
  const db = {};
  for (let index = 0; index < 305; index += 1) auditLog(db, { by: index % 2 ? "usr_a" : "usr_b", action: "call", path: `/api/x/${index}` }, NOW + index * 1000);
  auditLog(db, { by: "usr_a", action: "update", label: "Өчигдөр" }, NOW - DAY);
  assert.equal(db["audit_2026-11-05"].length, 300);
  assert.equal(db["audit_2026-11-05_2"].length, 5);
  assert.deepEqual(auditDays(db), ["2026-11-05", "2026-11-04"]);
  const today = auditList(db, { from: "2026-11-05", to: "2026-11-05" });
  assert.equal(today.entries.length, 305);
  assert.equal(today.entries[0].path, "/api/x/304");
  assert.equal(auditList(db, { from: "2026-11-04", to: "2026-11-05", by: "usr_a", action: "update" }).entries[0].label, "Өчигдөр");
  assert.equal(auditList(db, { q: "/api/x/304" }).entries.length, 1);
  assert.equal(auditList(db, { limit: 10 }).more, true);
  const id = today.entries[3].id;
  assert.equal(findAudit(db, id).id, id);
  assert.ok(!("note" in db["audit_2026-11-05"][0]), "empty fields are left out");
});

test("days older than the keep window are dropped", () => {
  const db = { "audit_2025-06-01": [{ id: "a" }], "audit_2025-06-01_2": [{ id: "b" }], "audit_2026-10-26": [{ id: "c" }], audit_note: "not a day" };
  assert.equal(pruneAudit(db, NOW), 2);
  assert.deepEqual(auditDays(db), ["2026-10-26"]);
  assert.equal(db.audit_note, "not a day");
});

test("a deleted mine record can be put back from its snapshot, once", () => {
  const db = { users: [newUser({ id: "usr_m", username: "m", password: "x", role: "master" })] };
  ensureMine(db);
  const item = createRecord(db, "risks", { hazard: "Нуралт", place: "Уурхай-1", likelihood: 3, severity: 4, controls: "Хашлага" }, { by: "usr_m", now: NOW }).item;
  assert.ok(item, "risk created");
  const removed = deleteRecord(db, "risks", item.id).item;
  const { snapshot } = snapshotOf(removed);
  assert.equal(db.hse.risks.length, 0);
  assert.equal(restoreRecord(db, "risks", snapshot).item.id, item.id);
  assert.equal(db.hse.risks.length, 1);
  assert.equal(restoreRecord(db, "risks", snapshot).status, 409);
  assert.ok(restoreRecord(db, "nope", snapshot).error);
});

test("backups are gzip files named by time and reason; listing, pruning and reading stay inside the folder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "umb-backup-"));
  try {
    const db = { secret: "s", users: [{ id: "usr_admin", role: "admin" }], hse: { risks: [] } };
    const first = await writeBackup(db, { dir, reason: "auto", now: NOW });
    assert.equal(first.name, backupName(NOW, "auto"));
    assert.equal(parseName(first.name).at, Math.floor(NOW / 1000) * 1000);
    const twin = await writeBackup(JSON.stringify(db), { dir, reason: "auto", now: NOW });
    assert.notEqual(twin.name, first.name, "same second does not overwrite");
    await writeBackup(db, { dir, reason: "manual", now: NOW + 1000 });
    await writeFile(path.join(dir, "notes.txt"), "x");
    assert.equal((await listBackups(dir)).length, 3);
    assert.equal(await pruneBackups(dir, 1), 1);
    const list = await listBackups(dir);
    assert.deepEqual(list.map((item) => item.reason).sort(), ["auto", "manual"]);
    assert.equal(await readBackup("../package.json", dir), null);
    assert.deepEqual(parseBackup(await readBackup(list[0].name, dir)).db, db);
    assert.equal(backupDue(list, DAY, NOW + 2 * 3600 * 1000), false);
    assert.equal(backupDue(list, DAY, NOW + 2 * DAY), true);
    assert.equal(backupDue([], DAY, NOW), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a backup must be a database with an admin and a secret", () => {
  assert.ok(parseBackup(Buffer.from("not json")).error);
  assert.ok(parseBackup(Buffer.from("[]")).error);
  assert.ok(parseBackup(Buffer.from(JSON.stringify({ secret: "s", users: [{ role: "user" }] }))).error);
  assert.ok(parseBackup(gzipSync(JSON.stringify({ secret: "s", users: [{ role: "admin" }] }))).db);
});

test("restoring keeps this server's secret, push keys, delivery log and the change history of both", () => {
  const current = { secret: "now", vapid: { publicKey: "p" }, deliveries: [1], "audit_2026-11-05": [{ id: "a" }], hse: { risks: [1, 2] } };
  const incoming = { secret: "old", users: [], "audit_2026-10-01": [{ id: "b" }], "audit_2026-11-05": [], hse: { risks: [] } };
  const next = mergeRestore(current, incoming);
  assert.equal(next.secret, "now");
  assert.deepEqual(next.vapid, { publicKey: "p" });
  assert.deepEqual(next.deliveries, [1]);
  assert.deepEqual(next["audit_2026-11-05"], [{ id: "a" }]);
  assert.deepEqual(next["audit_2026-10-01"], [{ id: "b" }]);
  assert.deepEqual(next.hse.risks, []);
  assert.equal(incoming.secret, "old", "the backup object itself is not changed");
});
