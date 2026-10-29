import test from "node:test";
import assert from "node:assert/strict";
import { CARD_TEXT_LIMITS, cardPatch, cardTexts, cleanLoginCode, ensureCardTemplates, ensureLoginCodes, newUser, publicUser } from "../lib/auth.mjs";
import { CARD_TEXTS } from "../public/js/idcard.js";

test("login codes are 4 characters mixing letters and digits", () => {
  assert.equal(cleanLoginCode(" k7p3 "), "K7P3");
  assert.equal(cleanLoginCode("ABCD"), null);
  assert.equal(cleanLoginCode("1234"), null);
  assert.equal(cleanLoginCode("K7P"), null);
  assert.equal(cleanLoginCode("K7P3X"), null);
  assert.equal(cleanLoginCode("K7-3"), null);
  assert.equal(cleanLoginCode(undefined), null);
});

test("existing users without a login code get a unique one", () => {
  const db = { users: [{ id: "a", username: "admin", loginCode: "K7P3" }, { id: "b", username: "saran" }, { id: "c", username: "bat" }] };
  const assigned = ensureLoginCodes(db);
  assert.deepEqual(assigned.map((user) => user.id), ["b", "c"]);
  assert.equal(db.users[0].loginCode, "K7P3");
  assert.ok(db.users.every((user) => cleanLoginCode(user.loginCode) === user.loginCode));
  assert.equal(new Set(db.users.map((user) => user.loginCode)).size, 3);
  assert.deepEqual(ensureLoginCodes(db), []);
});

const base = { classification: "АЖИЛТАН", project: "UMBRELLA ХӨТӨЛБӨР", idNumber: "123A-B456", status: "ACTIVE", clearance: 1, expires: "10/28/2030" };

test("new users get card numbers and ids that no existing user has", () => {
  const existing = [];
  for (let index = 0; index < 200; index += 1) existing.push(newUser({ username: `u${index}`, password: "secret1", existing }));
  assert.equal(new Set(existing.map((user) => user.card.idNumber)).size, existing.length);
  assert.equal(new Set(existing.map((user) => user.id)).size, existing.length);
  assert.equal(new Set(existing.map((user) => user.loginCode)).size, existing.length);
  assert.ok(existing.every((user) => /^\d{3}[A-Z]-[A-Z]\d{3}$/.test(user.card.idNumber)));
  assert.ok(existing.every((user) => cleanLoginCode(user.loginCode) === user.loginCode));
});

test("client card texts match server limits", () => {
  assert.deepEqual(Object.fromEntries(CARD_TEXTS.map((item) => [item.key, item.max])), CARD_TEXT_LIMITS);
  for (const item of CARD_TEXTS) assert.ok(item.value.length <= item.max, item.key);
});

test("cardPatch edits id number, dates and signature", () => {
  const { card } = cardPatch({ idNumber: "777x-z001", issued: "01/15/2026", signature: " Бат " }, base);
  assert.equal(card.idNumber, "777X-Z001");
  assert.equal(card.issued, "01/15/2026");
  assert.equal(card.signature, "Бат");
  const cleared = cardPatch({ issued: "", signature: "" }, card).card;
  assert.equal(cleared.issued, undefined);
  assert.equal(cleared.signature, undefined);
});

test("cardPatch rejects bad card input", () => {
  assert.ok(cardPatch({ idNumber: "a b" }, base).error);
  assert.ok(cardPatch({ issued: "13/01/2026" }, base).error);
});

test("cardTexts cleans and validates level template texts", () => {
  assert.deepEqual(cardTexts({ band: "  ЗОЧИН ", notice: "" }).texts, { band: "ЗОЧИН" });
  assert.ok(cardTexts({ unknown: "x" }).error);
  assert.ok(cardTexts({ band: "<b>x</b>" }).error);
  assert.ok(cardTexts({ band: "Х".repeat(33) }).error);
  assert.ok(cardTexts(["x"]).error);
});

test("card texts come from the user's level template", () => {
  const db = {
    users: [
      { id: "a", pass: "x", ver: 1, card: { ...base, clearance: 5, texts: { band: "АДМИН" } } },
      { id: "b", pass: "y", ver: 0, card: { ...base, clearance: 2 } },
    ],
  };
  assert.equal(ensureCardTemplates(db), true);
  assert.deepEqual(db.cardTemplates, { 5: { band: "АДМИН" } });
  assert.equal(db.users[0].card.texts, undefined);
  assert.equal(ensureCardTemplates(db), false);
  const admin = publicUser(db.users[0], db.cardTemplates);
  assert.deepEqual(admin.card.texts, { band: "АДМИН" });
  assert.equal(admin.pass, undefined);
  assert.equal(publicUser(db.users[1], db.cardTemplates).card.texts, undefined);
});
