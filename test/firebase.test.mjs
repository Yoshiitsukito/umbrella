import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { commitWrites, fromValue, listDocuments, signedAssertion, toValue } from "../lib/firebase.mjs";
import { joinDb, splitDb } from "../lib/store.mjs";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: "demo-umbrella", client_email: "svc@demo-umbrella.iam.gserviceaccount.com", private_key: pem });

test("Firestore values round-trip JSON data", () => {
  const sample = { n: 3, f: 1.5, s: "Сайн", b: false, z: null, empty: [], obj: {}, list: [1, { a: "x" }], nested: { deep: { v: -2 } } };
  assert.deepEqual(fromValue(toValue(sample)), sample);
  assert.deepEqual(toValue(7), { integerValue: "7" });
  assert.deepEqual(toValue([]), { arrayValue: {} });
});

test("db splits into app/user documents and joins back in order", () => {
  const db = { secret: "x", profile: { id: "u1" }, messages: [], users: [{ id: "usr_b", n: 1 }, { id: "usr_a", n: 2 }] };
  const docs = splitDb(db);
  assert.deepEqual([...docs.keys()], ["app/secret", "app/profile", "app/messages", "users/usr_b", "users/usr_a"]);
  const back = joinDb(
    [...docs].filter(([name]) => name.startsWith("app/")).map(([name, json]) => ({ id: name.slice(4), data: JSON.parse(json) })),
    [...docs].filter(([name]) => name.startsWith("users/")).reverse().map(([name, json]) => ({ id: name.slice(6), data: JSON.parse(json) })),
  );
  assert.deepEqual(back, db);
  assert.equal(splitDb({ profile: { b: 1, a: { d: 2, c: 3 } } }).get("app/profile"), splitDb({ profile: { a: { c: 3, d: 2 }, b: 1 } }).get("app/profile"));
});

test("service account assertion is a valid RS256 JWT", () => {
  const jwt = signedAssertion({ clientEmail: "svc@x", privateKey: pem }, 1_700_000_000_000);
  const [header, claims, signature] = jwt.split(".");
  assert.ok(crypto.verify("RSA-SHA256", Buffer.from(`${header}.${claims}`), publicKey, Buffer.from(signature, "base64url")));
  const body = JSON.parse(Buffer.from(claims, "base64url").toString());
  assert.equal(body.iss, "svc@x");
  assert.equal(body.exp - body.iat, 3600);
  assert.equal(body.scope, "https://www.googleapis.com/auth/datastore");
});

test("listDocuments and commitWrites talk to the Firestore REST API", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "tok", expires_in: 3600 });
    if (options.method === "GET") {
      return Response.json({
        documents: [{ name: "projects/demo-umbrella/databases/(default)/documents/app/profile", fields: { value: { mapValue: { fields: { id: { stringValue: "u1" } } } } } }],
      });
    }
    return Response.json({ writeResults: [] });
  };
  try {
    const docs = await listDocuments("app");
    assert.deepEqual(docs, [{ id: "profile", data: { value: { id: "u1" } } }]);
    await commitWrites([{ collection: "app", id: "profile", data: { value: { id: "u2" } } }, { collection: "users", id: "usr_x", delete: true }]);
    const commit = calls.at(-1);
    assert.equal(commit.url, "https://firestore.googleapis.com/v1/projects/demo-umbrella/databases/(default)/documents:commit");
    assert.equal(commit.options.headers.Authorization, "Bearer tok");
    const body = JSON.parse(commit.options.body);
    assert.equal(body.writes[0].update.name, "projects/demo-umbrella/databases/(default)/documents/app/profile");
    assert.deepEqual(body.writes[1], { delete: "projects/demo-umbrella/databases/(default)/documents/users/usr_x" });
    assert.equal(calls.filter((call) => call.url.startsWith("https://oauth2")).length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
