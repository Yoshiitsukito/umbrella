import test from "node:test";
import assert from "node:assert/strict";
import { newUser } from "../lib/auth.mjs";
import { HSE_ROLE, ensureMine, raiseSos } from "../lib/mine.mjs";
import { personalKey, personalOf, pushNotice } from "../lib/personal.mjs";
import {
  addSubscription,
  alertPrefs,
  channelConfig,
  claimDeliveries,
  cleanPhone,
  cleanPrefs,
  e164,
  ensureVapid,
  hasDueDeliveries,
  maskTarget,
  recordDeliveries,
  sendJob,
  targetsFor,
} from "../lib/notify.mjs";

const NOW = Date.parse("2026-11-05T10:00:00+08:00");
const MIN = 60 * 1000;
const SUB = { endpoint: "https://fcm.googleapis.com/fcm/send/abc123", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
const CONFIG = channelConfig({ SMTP_HOST: "smtp.example.mn", SMTP_FROM: "noreply@example.mn", SMS_GATEWAY_URL: "https://sms.example.mn/send?to={to}&text={text}" });

function baseDb() {
  const users = [];
  const add = (id, role, extra = {}) => users.push(Object.assign(newUser({ id, username: id, password: "x", role, displayName: id, existing: users }), extra));
  add("usr_a", "user", { email: "bold@example.mn", phone: "99112233" });
  add("usr_hse", HSE_ROLE, { phone: "88112233" });
  add("usr_master", "master");
  add("usr_wq", "whiteking");
  const db = { users, attendance: { people: {}, events: [], usedJti: [] } };
  return db;
}

test("phone numbers are digits with an optional +, local ones get the country code", () => {
  assert.equal(cleanPhone(" 9911-2233 "), "99112233");
  assert.equal(cleanPhone("+976 9911 2233"), "+97699112233");
  assert.equal(cleanPhone(""), "");
  assert.equal(cleanPhone("99-ab"), null);
  assert.equal(cleanPhone("1234"), null);
  assert.equal(e164("99112233"), "+97699112233");
  assert.equal(e164("+14155550100"), "+14155550100");
  assert.equal(e164("97699112233"), "+97699112233");
});

test("channels are configured from the environment; nothing without credentials", () => {
  const none = channelConfig({});
  assert.equal(none.email, null);
  assert.equal(none.sms, null);
  assert.equal(CONFIG.email.port, 587);
  assert.equal(CONFIG.email.secure, false);
  assert.equal(channelConfig({ SMTP_HOST: "h", SMTP_FROM: "f", SMTP_PORT: "465" }).email.secure, true);
  assert.equal(channelConfig({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+1555" }).sms.kind, "twilio");
  assert.equal(CONFIG.sms.kind, "gateway");
});

test("preferences default to push and e-mail for all, SMS only for urgent, and reject unknown levels", () => {
  assert.deepEqual(alertPrefs(undefined), { push: "all", email: "all", sms: "urgent" });
  assert.deepEqual(alertPrefs({ alerts: { sms: "all", email: "nope" } }), { push: "all", email: "all", sms: "all" });
  assert.deepEqual(cleanPrefs({ email: "off" }), { prefs: { email: "off" } });
  assert.ok(cleanPrefs({ sms: "sometimes" }).error);
});

test("push subscriptions are validated, deduplicated by endpoint and capped", () => {
  const record = {};
  assert.ok(addSubscription(record, { endpoint: "http://x", keys: SUB.keys }).error);
  assert.ok(addSubscription(record, { endpoint: SUB.endpoint, keys: { p256dh: "short", auth: "x" } }).error);
  assert.ok(addSubscription(record, SUB, { now: NOW }).ok);
  assert.ok(addSubscription(record, SUB, { now: NOW }).ok);
  assert.equal(record.push.length, 1);
  for (let index = 0; index < 7; index += 1) addSubscription(record, { ...SUB, endpoint: `${SUB.endpoint}${index}` });
  assert.equal(record.push.length, 5);
});

test("a notice goes to each channel the person wants at its urgency, if it has an address and credentials", () => {
  const db = baseDb();
  const user = db.users[0];
  const record = personalOf(db, user.id);
  addSubscription(record, SUB);
  const channels = (level, config = CONFIG) => targetsFor({ user, record, level, config }).map((target) => target.channel).sort();
  assert.deepEqual(channels("normal"), ["email", "push"]);
  assert.deepEqual(channels("urgent"), ["email", "push", "sms"]);
  record.alerts = { push: "off", email: "urgent", sms: "off" };
  assert.deepEqual(channels("normal"), []);
  assert.deepEqual(channels("urgent"), ["email"]);
  record.alerts = {};
  assert.deepEqual(channels("urgent", channelConfig({})), ["push"]);
});

test("claiming marks due notices as sending, skips stale ones and the station, and finishes those with nowhere to go", () => {
  const db = baseDb();
  pushNotice(personalOf(db, "usr_a"), "hse", "Шинэ", NOW - MIN, "urgent");
  pushNotice(personalOf(db, "usr_a"), "hse", "Хуучин", NOW - 2 * 3600 * 1000);
  pushNotice(personalOf(db, "usr_master"), "hse", "Хаягүй", NOW - MIN);
  pushNotice(personalOf(db, "usr_wq"), "hse", "Станц", NOW - MIN);
  assert.ok(hasDueDeliveries(db, NOW));
  const jobs = claimDeliveries(db, CONFIG, NOW);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].notice.text, "Шинэ");
  assert.equal(jobs[0].notice.level, "urgent");
  assert.deepEqual(jobs[0].targets.map((target) => target.channel).sort(), ["email", "sms"]);
  const [fresh, old] = personalOf(db, "usr_a").notices;
  assert.equal(fresh.out.state, "sending");
  assert.equal(old.out.state, "stale");
  assert.equal(personalOf(db, "usr_master").notices[0].out.state, "none");
  assert.equal(personalOf(db, "usr_wq").notices[0].out, undefined);
  assert.equal(claimDeliveries(db, CONFIG, NOW).length, 0, "a claimed notice is not claimed twice");
  assert.equal(claimDeliveries(db, CONFIG, NOW + 6 * MIN).length, 1, "a claim lost to a restart is retried");
});

test("results are saved on the notice: failures retry only the failed channel, then give up after three tries", async () => {
  const db = baseDb();
  pushNotice(personalOf(db, "usr_a"), "hse", "Ажил зогсоох дохио!", NOW, "urgent");
  const calls = [];
  const senders = {
    email: async ({ target }) => calls.push(["email", target.to]),
    sms: async () => {
      calls.push(["sms"]);
      throw new Error("gateway down");
    },
    push: async () => {},
  };
  let jobs = claimDeliveries(db, CONFIG, NOW);
  let results = await Promise.all(jobs.map((job) => sendJob(job, { config: CONFIG, vapid: null, senders })));
  recordDeliveries(db, jobs, results, NOW);
  const notice = personalOf(db, "usr_a").notices[0];
  assert.equal(notice.out.state, "retry");
  assert.equal(notice.out.next, NOW + MIN);
  assert.equal(db.deliveries.length, 1);
  assert.deepEqual(db.deliveries[0].results.map((item) => [item.channel, item.ok]).sort(), [["email", true], ["sms", false]]);
  assert.equal(db.deliveries[0].results.find((item) => item.channel === "email").to, "bo***@example.mn");

  assert.equal(claimDeliveries(db, CONFIG, NOW + 30 * 1000).length, 0, "not before the retry time");
  for (const at of [NOW + MIN, NOW + 7 * MIN]) {
    jobs = claimDeliveries(db, CONFIG, at);
    assert.deepEqual(jobs[0].targets.map((target) => target.channel), ["sms"]);
    results = await Promise.all(jobs.map((job) => sendJob(job, { config: CONFIG, vapid: null, senders })));
    recordDeliveries(db, jobs, results, at);
  }
  assert.equal(notice.out.state, "done");
  assert.equal(notice.out.tries, 3);
  assert.equal(calls.filter(([channel]) => channel === "email").length, 1, "e-mail sent once");
  assert.equal(calls.filter(([channel]) => channel === "sms").length, 3);
});

test("a push subscription the push service says is gone is removed", async () => {
  const db = baseDb();
  const record = personalOf(db, "usr_master");
  addSubscription(record, SUB);
  pushNotice(record, "hse", "Тэсэлгээ", NOW);
  const jobs = claimDeliveries(db, CONFIG, NOW);
  const gone = Object.assign(new Error("gone"), { permanent: true, gone: true });
  const results = await Promise.all(jobs.map((job) => sendJob(job, { config: CONFIG, vapid: { publicKey: "p", privateKey: "k", subject: "mailto:a@b" }, senders: { push: async () => Promise.reject(gone) } })));
  recordDeliveries(db, jobs, results, NOW);
  assert.equal(record.push.length, 0);
  assert.equal(record.notices[0].out.state, "done");
  assert.equal(db.deliveries[0].results[0].to, "fcm.googleapis.com");
});

test("the VAPID pair is generated once and kept, unless the environment sets one", () => {
  const db = {};
  const first = ensureVapid(db, {});
  assert.ok(first.publicKey.length > 60 && first.privateKey.length > 20);
  assert.equal(ensureVapid(db, {}).publicKey, first.publicKey);
  assert.equal(ensureVapid(db, { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" }).publicKey, "pub");
});

test("addresses are masked for the admin log", () => {
  assert.equal(maskTarget("sms", "99112233"), "9911****");
  assert.equal(maskTarget("email", "saraa@gmail.com"), "sa***@gmail.com");
  assert.equal(maskTarget("push", "https://web.push.apple.com/abc"), "web.push.apple.com");
});

test("an SOS sends an urgent notice to HSE managers and masters", () => {
  const db = baseDb();
  ensureMine(db);
  raiseSos(db, "usr_a", { now: NOW });
  for (const uid of ["usr_hse", "usr_master"]) {
    const notice = db[personalKey(uid)].notices.at(-1);
    assert.equal(notice.level, "urgent");
    assert.match(notice.text, /SOS/);
  }
  assert.equal(db[personalKey("usr_a")]?.notices?.length || 0, 0, "not the person who raised it");
});
