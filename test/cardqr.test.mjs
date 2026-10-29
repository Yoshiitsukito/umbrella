import assert from "node:assert/strict";
import test from "node:test";
import { CARD_QR_PREFIX, ensureCardKeys, findByCardQr, newUser, publicUser } from "../lib/auth.mjs";

test("every person gets a card QR, the station does not", () => {
  const user = newUser({ username: "bat", password: "secret123" });
  const station = newUser({ username: "whitequeen", password: "secret123", role: "whiteking" });
  assert.ok(user.cardKey);
  assert.equal(station.cardKey, null);
  const shown = publicUser(user);
  assert.equal(shown.cardQr, `${CARD_QR_PREFIX}${user.cardKey}`);
  assert.equal(shown.cardKey, undefined);
  assert.equal(publicUser(station).cardQr, undefined);
});

test("card QR resolves to its owner and stops working once renewed", () => {
  const users = [newUser({ username: "bat", password: "secret123" }), newUser({ username: "dorj", password: "secret123" })];
  const old = publicUser(users[1]).cardQr;
  assert.equal(findByCardQr(users, old)?.username, "dorj");
  assert.equal(findByCardQr(users, `${CARD_QR_PREFIX}nope`), null);
  assert.equal(findByCardQr(users, users[1].cardKey), null);
  users[1].cardKey = "renewed-key-value-123456";
  assert.equal(findByCardQr(users, old), null);
});

test("existing users are backfilled with card keys", () => {
  const db = { users: [{ id: "a", role: "user" }, { id: "b", role: "admin", cardKey: "keep" }, { id: "c", role: "whiteking" }] };
  assert.equal(ensureCardKeys(db), 1);
  assert.ok(db.users[0].cardKey);
  assert.equal(db.users[1].cardKey, "keep");
  assert.equal(db.users[2].cardKey, undefined);
});
