export const SYSTEM_PROMPT = [
  "Чи Red King — UMBRELLA Corporation-ий дуут AI туслах.",
  "Хэрэглэгчийн хэлээр (ихэвчлэн монгол) товч, ойлгомжтой хариул: ихэнхдээ 1–4 өгүүлбэр.",
  "Хариуг чанга уншдаг тул markdown, хүснэгт, од, emoji, URL бүү бич; жагсаалт хэрэгтэй бол энгийн өгүүлбэрээр дугаарла.",
  "Минут, зай, нислэгийн цаг, үнэ, цаг агаарыг зөвхөн хэрэгслийн хариунаас ав. Хоосон хариуг байгаа мэт битгий дүүргэ.",
  "Эрүүл мэндийн тоог онош гэж битгий хэл.",
  "Мессеж нь дуу танилтаас болж эвдэрсэн, утгагүй үг үсэг эсвэл юу хүсэж байгааг огт ойлгохооргүй бол өөр юу ч бичилгүй зөвхөн [UNCLEAR] гэж хариул.",
].join(" ");

const PROVIDERS = {
  gemini: { label: "Gemini", env: "GEMINI_API_KEY", modelEnv: "GEMINI_MODEL", models: "gemini-3.8-flash,gemini-3.6-flash" },
  claude: { label: "Claude", env: "ANTHROPIC_API_KEY", modelEnv: "ANTHROPIC_MODEL", models: "claude-sonnet-5-5,claude-haiku-5-5" },
  openai: { label: "ChatGPT", env: "OPENAI_API_KEY", modelEnv: "OPENAI_MODEL", models: "gpt-6.1-terra,gpt-5.4-mini" },
  grok: { label: "Grok", env: "XAI_API_KEY", modelEnv: "XAI_MODEL", models: "grok-4.7,grok-4.6" },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);

function models(id) {
  const spec = PROVIDERS[id];
  return (process.env[spec.modelEnv] || spec.models)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function key(id) {
  return process.env[PROVIDERS[id].env] || "";
}

export function providerList() {
  return PROVIDER_IDS.map((id) => ({
    id,
    label: PROVIDERS[id].label,
    configured: Boolean(key(id)),
    model: models(id)[0],
  }));
}

export function configuredProviders() {
  const preferred = (process.env.AI_DEFAULT || "").trim();
  const ready = PROVIDER_IDS.filter((id) => key(id));
  if (ready.includes(preferred)) return [preferred, ...ready.filter((id) => id !== preferred)];
  return ready;
}

export function providerLabel(id) {
  return PROVIDERS[id]?.label || id;
}

class ModelUnavailable extends Error {}

const FIRST_TIMEOUT_MS = 20000;
const LAST_TIMEOUT_MS = 45000;
const BENCH_MS = 10 * 60 * 1000;
const benched = new Map();

async function post(url, headers, body, label, timeout = LAST_TIMEOUT_MS) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error?.name === "TimeoutError") throw new ModelUnavailable(`${label}: ${Math.round(timeout / 1000)} секундэд хариу ирсэнгүй`);
    throw error;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || data?.error || data?.message || `${res.status}`;
    const text = typeof message === "string" ? message : JSON.stringify(message);
    const code = `${data?.error?.code || ""} ${data?.error?.type || ""}`;
    if (/insufficient_quota|credit_balance/i.test(code) || /no credits|credit balance/i.test(text)) {
      throw new Error(`${label}: дансны кредит дууссан — billing хэсэгт кредит нэмнэ үү`);
    }
    if (res.status === 404 || (res.status === 400 && /model/i.test(text) && /(not found|does not exist|invalid|unknown|not supported)/i.test(text))) {
      throw new ModelUnavailable(`${label}: ${text}`);
    }
    if (res.status === 429 || res.status >= 500) throw new ModelUnavailable(`${label} ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`${label} ${res.status}: ${text.slice(0, 200)}`);
  }
  return data;
}

async function withModels(id, run) {
  const now = Date.now();
  const resting = (model) => (benched.get(`${id}:${model}`) || 0) > now;
  const list = models(id);
  const ordered = [...list.filter((model) => !resting(model)), ...list.filter(resting)];
  let lastError = null;
  for (const [index, model] of ordered.entries()) {
    const timeout = index < ordered.length - 1 ? FIRST_TIMEOUT_MS : LAST_TIMEOUT_MS;
    try {
      const result = await run(model, timeout);
      benched.delete(`${id}:${model}`);
      return { ...result, model };
    } catch (error) {
      if (!(error instanceof ModelUnavailable)) throw error;
      benched.set(`${id}:${model}`, Date.now() + BENCH_MS);
      lastError = error;
    }
  }
  throw lastError || new Error(`${providerLabel(id)}: загвар олдсонгүй`);
}

function historyTurns(history) {
  return (history || [])
    .slice(-6)
    .filter((item) => item.text)
    .map((item) => ({ role: item.role === "assistant" ? "assistant" : "user", text: item.text }));
}

async function gemini(message, ctx, tools, runTool) {
  const contents = [
    ...historyTurns(ctx.history).map((turn) => ({ role: turn.role === "assistant" ? "model" : "user", parts: [{ text: turn.text }] })),
    { role: "user", parts: [{ text: message }] },
  ];
  return withModels("gemini", async (model, timeout) => {
    const turn = [...contents];
    for (let round = 0; round < 4; round += 1) {
      const data = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { "x-goog-api-key": key("gemini") },
        {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: turn,
          tools: [{ functionDeclarations: tools }],
        },
        "Gemini",
        timeout,
      );
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const calls = parts.filter((part) => part.functionCall);
      if (!calls.length) return { reply: parts.map((part) => part.text || "").join("").trim() };
      turn.push({ role: "model", parts });
      const responses = [];
      for (const { functionCall } of calls) {
        const result = await runTool(functionCall.name, functionCall.args || {});
        responses.push({ functionResponse: { name: functionCall.name, response: { result } } });
      }
      turn.push({ role: "user", parts: responses });
    }
    return { reply: "" };
  });
}

async function claude(message, ctx, tools, runTool) {
  const messages = [
    ...historyTurns(ctx.history).map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: message },
  ];
  return withModels("claude", async (model, timeout) => {
    const turn = [...messages];
    for (let round = 0; round < 4; round += 1) {
      const data = await post(
        "https://api.anthropic.com/v1/messages",
        { "x-api-key": key("claude"), "anthropic-version": "2023-06-01" },
        {
          model,
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: turn,
          tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
        },
        "Claude",
        timeout,
      );
      const blocks = data.content || [];
      const calls = blocks.filter((block) => block.type === "tool_use");
      if (!calls.length || data.stop_reason !== "tool_use") {
        return { reply: blocks.filter((block) => block.type === "text").map((block) => block.text).join("").trim() };
      }
      turn.push({ role: "assistant", content: blocks });
      const results = [];
      for (const call of calls) {
        const result = await runTool(call.name, call.input || {});
        results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result).slice(0, 20000) });
      }
      turn.push({ role: "user", content: results });
    }
    return { reply: "" };
  });
}

async function openai(message, ctx, tools, runTool) {
  const input = [
    ...historyTurns(ctx.history).map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: message },
  ];
  return withModels("openai", async (model, timeout) => {
    const turn = [...input];
    for (let round = 0; round < 4; round += 1) {
      const data = await post(
        "https://api.openai.com/v1/responses",
        { Authorization: `Bearer ${key("openai")}` },
        {
          model,
          instructions: SYSTEM_PROMPT,
          input: turn,
          reasoning: { effort: "low" },
          tools: tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters })),
        },
        "ChatGPT",
        timeout,
      );
      const output = data.output || [];
      const calls = output.filter((item) => item.type === "function_call");
      if (!calls.length) {
        const text = output
          .filter((item) => item.type === "message")
          .flatMap((item) => item.content || [])
          .filter((part) => part.type === "output_text")
          .map((part) => part.text)
          .join("")
          .trim();
        return { reply: text || data.output_text || "" };
      }
      turn.push(...output);
      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await runTool(call.name, args);
        turn.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result).slice(0, 20000) });
      }
    }
    return { reply: "" };
  });
}

async function grok(message, ctx, tools, runTool) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...historyTurns(ctx.history).map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user", content: message },
  ];
  return withModels("grok", async (model, timeout) => {
    const turn = [...messages];
    for (let round = 0; round < 4; round += 1) {
      const data = await post(
        "https://api.x.ai/v1/chat/completions",
        { Authorization: `Bearer ${key("grok")}` },
        {
          model,
          messages: turn,
          tools: tools.map((tool) => ({ type: "function", function: tool })),
        },
        "Grok",
        timeout,
      );
      const choice = data.choices?.[0]?.message || {};
      const calls = choice.tool_calls || [];
      if (!calls.length) return { reply: String(choice.content || "").trim() };
      turn.push({ role: "assistant", content: choice.content || "", tool_calls: calls });
      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.function?.arguments || "{}");
        } catch {
          args = {};
        }
        const result = await runTool(call.function?.name, args);
        turn.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 20000) });
      }
    }
    return { reply: "" };
  });
}

const ADAPTERS = { gemini, claude, openai, grok };

export async function chat(id, message, ctx, tools, runTool) {
  if (!ADAPTERS[id]) throw new Error(`Тодорхойгүй AI: ${id}`);
  if (!key(id)) throw new Error(`${providerLabel(id)} түлхүүр .env файлд алга (${PROVIDERS[id].env})`);
  const result = await ADAPTERS[id](message, ctx, tools, runTool);
  return { reply: result.reply, provider: `${providerLabel(id)} ${result.model}`, providerId: id };
}

/** Single-turn, tool-free calls that return the model's text, for structured answers outside the Red King persona. */
const PLAIN = {
  async gemini(system, prompt, model, timeout) {
    const data = await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { "x-goog-api-key": key("gemini") },
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
      },
      "Gemini",
      timeout,
    );
    return (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
  },
  async claude(system, prompt, model, timeout) {
    const data = await post(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": key("claude"), "anthropic-version": "2023-06-01" },
      { model, max_tokens: 1500, system, messages: [{ role: "user", content: prompt }] },
      "Claude",
      timeout,
    );
    return (data.content || []).filter((block) => block.type === "text").map((block) => block.text).join("");
  },
  async openai(system, prompt, model, timeout) {
    const data = await post(
      "https://api.openai.com/v1/responses",
      { Authorization: `Bearer ${key("openai")}` },
      { model, instructions: system, input: prompt, reasoning: { effort: "low" } },
      "ChatGPT",
      timeout,
    );
    return (data.output || [])
      .filter((item) => item.type === "message")
      .flatMap((item) => item.content || [])
      .filter((part) => part.type === "output_text")
      .map((part) => part.text)
      .join("");
  },
  async grok(system, prompt, model, timeout) {
    const data = await post(
      "https://api.x.ai/v1/chat/completions",
      { Authorization: `Bearer ${key("grok")}` },
      { model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] },
      "Grok",
      timeout,
    );
    return String(data.choices?.[0]?.message?.content || "");
  },
};

export function parseJsonReply(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("AI JSON хариу буцаасангүй");
  return JSON.parse(text.slice(start, end + 1));
}

/** Asks the configured providers in order of preference for a JSON object; the first good answer wins. */
export async function completeJson(system, prompt) {
  const ids = configuredProviders();
  if (!ids.length) throw new Error("AI түлхүүр .env файлд тохируулаагүй байна");
  let lastError = null;
  for (const id of ids) {
    try {
      const result = await withModels(id, async (model, timeout) => ({ text: await PLAIN[id](system, prompt, model, timeout) }));
      return { data: parseJsonReply(result.text), provider: `${providerLabel(id)} ${result.model}` };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
