import test from "node:test";
import assert from "node:assert/strict";
import { TrafficError, trafficConfigured, trafficTile } from "../lib/traffic.mjs";

function withEnv(values, run) {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  delete process.env.GOOGLE_TILES_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  Object.assign(process.env, values);
  return Promise.resolve(run()).finally(() => {
    globalThis.fetch = realFetch;
    process.env = saved;
  });
}

test("traffic without a Google key explains what is missing", () =>
  withEnv({}, async () => {
    assert.equal(trafficConfigured(), false);
    await assert.rejects(trafficTile(14, 1, 1), (error) => error instanceof TrafficError && error.status === 503);
  }));

test("traffic creates one overlay session and reuses it for tiles", () =>
  withEnv({ GOOGLE_TILES_API_KEY: "tiles-key" }, async () => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
      if (String(url).includes("createSession")) {
        return new Response(JSON.stringify({ session: "s1", expiry: String(Math.floor(Date.now() / 1000) + 3600) }), { status: 200 });
      }
      return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "Content-Type": "image/png" } });
    };
    const first = await trafficTile(14, 12000, 5800);
    await trafficTile(14, 12001, 5800);
    assert.equal(first.type, "image/png");
    assert.equal(calls.filter((call) => call.url.includes("createSession")).length, 1);
    assert.deepEqual(calls[0].body.layerTypes, ["layerTraffic"]);
    assert.equal(calls[0].body.overlay, true);
    assert.ok(calls[1].url.includes("/2dtiles/14/12000/5800?session=s1"));
  }));

test("traffic surfaces Google errors such as a disabled API", () =>
  withEnv({ GOOGLE_TILES_API_KEY: "other-key" }, async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: { message: "Map Tiles API has not been used in project" } }), { status: 403 });
    await assert.rejects(trafficTile(14, 1, 1), /Map Tiles API has not been used/);
  }));
