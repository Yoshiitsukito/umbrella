import test from "node:test";
import assert from "node:assert/strict";
import { chat, configuredProviders } from "../lib/ai.mjs";
import { markUnclear, UNCLEAR_REPLY } from "../lib/concierge.mjs";

test("an [UNCLEAR] reply becomes the spoken apology", () => {
  assert.deepEqual(markUnclear({ reply: " [UNCLEAR] ", cards: {} }), { reply: UNCLEAR_REPLY, unclear: true, cards: {} });
  const normal = { reply: "Өнөөдөр -2°C.", cards: {} };
  assert.equal(markUnclear(normal), normal);
});

const TOOLS = [{ name: "get_weather", description: "weather", parameters: { type: "object", properties: {} } }];
const KEYS = { gemini: "GEMINI_API_KEY", claude: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", grok: "XAI_API_KEY" };

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SCRIPTS = {
  gemini: [
    { candidates: [{ content: { parts: [{ functionCall: { name: "get_weather", args: {} }, thoughtSignature: "sig" }] } }] },
    { candidates: [{ content: { parts: [{ text: "Өнөөдөр -2°C." }] } }] },
  ],
  claude: [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu1", name: "get_weather", input: {} }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Өнөөдөр -2°C." }] },
  ],
  openai: [
    { output: [{ type: "function_call", call_id: "c1", name: "get_weather", arguments: "{}" }] },
    { output: [{ type: "message", content: [{ type: "output_text", text: "Өнөөдөр -2°C." }] }] },
  ],
  grok: [
    { choices: [{ message: { content: "", tool_calls: [{ id: "t1", type: "function", function: { name: "get_weather", arguments: "{}" } }] } }] },
    { choices: [{ message: { content: "Өнөөдөр -2°C." } }] },
  ],
};

for (const id of Object.keys(SCRIPTS)) {
  test(`${id} runs a tool round and returns text`, async () => {
    const saved = { ...process.env };
    const realFetch = globalThis.fetch;
    for (const name of Object.values(KEYS)) delete process.env[name];
    process.env[KEYS[id]] = "test-key";
    const bodies = [];
    let step = 0;
    globalThis.fetch = async (url, options) => {
      bodies.push({ url: String(url), headers: options.headers, body: JSON.parse(options.body) });
      return reply(SCRIPTS[id][step++]);
    };
    const calls = [];
    try {
      const result = await chat(id, "Цаг агаар?", { history: [] }, TOOLS, async (name) => {
        calls.push(name);
        return { tempC: -2 };
      });
      assert.equal(result.reply, "Өнөөдөр -2°C.");
      assert.deepEqual(calls, ["get_weather"]);
      assert.equal(bodies.length, 2);
      assert.ok(!bodies[0].url.includes("test-key"), "key must not be in the URL");
      assert.ok(JSON.stringify(bodies[1].body).includes("-2"), "tool result goes back to the model");
    } finally {
      globalThis.fetch = realFetch;
      process.env = saved;
    }
  });
}

test("missing model falls back to the next one", async () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "k";
  process.env.ANTHROPIC_MODEL = "old-model,new-model";
  const models = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    models.push(body.model);
    if (body.model === "old-model") return reply({ error: { message: "model: old-model not found" } }, 404);
    return reply({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] });
  };
  try {
    const result = await chat("claude", "hi", { history: [] }, TOOLS, async () => ({}));
    assert.deepEqual(models, ["old-model", "new-model"]);
    assert.equal(result.provider, "Claude new-model");
  } finally {
    globalThis.fetch = realFetch;
    process.env = saved;
  }
});

test("a model that times out is skipped on the next call", async () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.XAI_API_KEY = "k";
  process.env.XAI_MODEL = "slow-model,quick-model";
  const models = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    models.push(body.model);
    if (body.model === "slow-model") throw new DOMException("timed out", "TimeoutError");
    return reply({ choices: [{ message: { content: "ok" } }] });
  };
  try {
    assert.equal((await chat("grok", "hi", { history: [] }, TOOLS, async () => ({}))).provider, "Grok quick-model");
    assert.equal((await chat("grok", "hi", { history: [] }, TOOLS, async () => ({}))).provider, "Grok quick-model");
    assert.deepEqual(models, ["slow-model", "quick-model", "quick-model"]);
  } finally {
    globalThis.fetch = realFetch;
    process.env = saved;
  }
});

test("exhausted credit fails fast without trying other models", async () => {
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = "k";
  process.env.OPENAI_MODEL = "a-model,b-model";
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return reply({ error: { message: "You have no credits remaining.", type: "insufficient_quota", code: "credit_balance_exhausted" } }, 429);
  };
  try {
    await assert.rejects(chat("openai", "hi", { history: [] }, TOOLS, async () => ({})), /кредит дууссан/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = realFetch;
    process.env = saved;
  }
});

test("AI_DEFAULT puts the preferred provider first", () => {
  const saved = { ...process.env };
  process.env.GEMINI_API_KEY = "a";
  process.env.XAI_API_KEY = "b";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.AI_DEFAULT = "grok";
  try {
    assert.deepEqual(configuredProviders(), ["grok", "gemini"]);
  } finally {
    process.env = saved;
  }
});
