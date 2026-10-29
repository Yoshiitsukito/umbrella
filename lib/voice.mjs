import { speakableMongolian } from "./speech.mjs";

const FIRST_TIMEOUT_MS = 20000;
const LAST_TIMEOUT_MS = 45000;
const BENCH_MS = 10 * 60 * 1000;
const benched = new Map();

function list(value, fallback) {
  return (value || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function voiceSupport() {
  const tts = [];
  const stt = [];
  if (process.env.ELEVENLABS_API_KEY) tts.push("elevenlabs");
  if (process.env.OPENAI_API_KEY) {
    tts.push("openai");
    stt.push("openai");
  }
  if (process.env.GEMINI_API_KEY) {
    tts.push("gemini");
    stt.push("gemini");
  }
  return { tts, stt };
}

class Retryable extends Error {}

async function request(url, options, label, timeout) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    if (error?.name === "TimeoutError") throw new Retryable(`${label}: ${Math.round(timeout / 1000)} секундэд хариу ирсэнгүй`);
    throw error;
  }
}

async function failure(res, label, retryStatuses = [404]) {
  const text = await res.text();
  let detail = text.slice(0, 200);
  try {
    detail = JSON.parse(text).error?.message || detail;
  } catch {
    /* keep raw text */
  }
  const credit = /no credits|credit balance|insufficient_quota/i.test(text);
  const message = credit ? `${label}: дансны кредит дууссан` : `${label} ${res.status}: ${detail}`;
  if (!credit && (retryStatuses.includes(res.status) || res.status === 429 || res.status >= 500)) return new Retryable(message);
  return new Error(message);
}

async function tryModels(kind, models, call) {
  const now = Date.now();
  const resting = (model) => (benched.get(`${kind}:${model}`) || 0) > now;
  const ordered = [...models.filter((model) => !resting(model)), ...models.filter(resting)];
  let lastError = null;
  for (const [index, model] of ordered.entries()) {
    const timeout = index < ordered.length - 1 ? FIRST_TIMEOUT_MS : LAST_TIMEOUT_MS;
    try {
      const result = await call(model, timeout);
      benched.delete(`${kind}:${model}`);
      return result;
    } catch (error) {
      if (!(error instanceof Retryable)) throw error;
      benched.set(`${kind}:${model}`, Date.now() + BENCH_MS);
      lastError = error;
    }
  }
  throw lastError || new Error(`${kind}: загвар алга`);
}

function wavFromPcm(pcm, rate = 24000) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const JARVIS_STYLE =
  "a refined, composed artificial-intelligence butler in the spirit of J.A.R.V.I.S. from Iron Man: calm, polite, slightly formal, quietly confident, with a hint of dry wit; smooth mid-low male register, crisp articulation, measured unhurried pace, short precise pauses between sentences; warm but restrained";

const QUEEN_STYLE =
  "a clear, warm, friendly female public-address announcer: calm and confident, natural mid-high female register, crisp articulation, steady unhurried pace";

export const VOICES = ["jarvis", "queen"];

function openaiSpeech(text, voice) {
  const queen = voice === "queen";
  return tryModels("openai-tts", list(process.env.OPENAI_TTS_MODEL, "gpt-4o-mini-tts"), async (model, timeout) => {
    const res = await request(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          voice: queen ? process.env.OPENAI_QUEEN_VOICE || "nova" : process.env.OPENAI_TTS_VOICE || "onyx",
          input: text,
          instructions: `Voice: ${queen ? QUEEN_STYLE : JARVIS_STYLE}. Language: fluent, natural Mongolian (Khalkha) with correct Mongolian pronunciation; never switch to English and do not add a foreign accent. Say only the given text.`,
          response_format: "mp3",
        }),
      },
      "OpenAI TTS",
      timeout,
    );
    if (!res.ok) throw await failure(res, "OpenAI TTS");
    return { audio: Buffer.from(await res.arrayBuffer()), type: "audio/mpeg", source: `OpenAI ${model}` };
  });
}

function geminiSpeech(text, voice) {
  const queen = voice === "queen";
  const models = list(process.env.GEMINI_TTS_MODEL, "gemini-3.8-flash-tts,gemini-3.1-flash-tts-preview");
  // Gemini TTS sometimes reads a style prompt aloud, so announcements send the bare text only.
  const prompt = queen ? text : `Read the following aloud in fluent, natural Mongolian, in the voice of ${JARVIS_STYLE}:\n${text}`;
  const voiceName = queen ? process.env.GEMINI_QUEEN_VOICE || "Kore" : process.env.GEMINI_TTS_VOICE || "Charon";
  return tryModels("gemini-tts", models, async (model, timeout) => {
    const res = await request(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
          },
        }),
      },
      "Gemini TTS",
      timeout,
    );
    if (!res.ok) throw await failure(res, "Gemini TTS");
    const data = await res.json();
    const inline = data?.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
    if (!inline?.data) throw new Retryable(`Gemini TTS ${model} дуу буцаасангүй`);
    const raw = Buffer.from(inline.data, "base64");
    const mime = inline.mimeType || "";
    if (/wav/i.test(mime) || raw.subarray(0, 4).toString("ascii") === "RIFF") {
      return { audio: raw, type: "audio/wav", source: `Gemini ${model}` };
    }
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1]) || 24000;
    return { audio: wavFromPcm(raw, rate), type: "audio/wav", source: `Gemini ${model}` };
  });
}

function elevenlabsSpeech(text, voice) {
  const voiceId =
    voice === "queen" ? process.env.ELEVENLABS_QUEEN_VOICE || "XrExE9yKIg1WjnnlVkGX" : process.env.ELEVENLABS_VOICE_ID || "KQhNCZcXa4AKEt3GoAdo";
  return tryModels("elevenlabs-tts", list(process.env.ELEVENLABS_TTS_MODEL, "eleven_v4,eleven_v3"), async (model, timeout) => {
    const res = await request(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: model, language_code: "mn" }),
      },
      "ElevenLabs TTS",
      timeout,
    );
    if (!res.ok) throw await failure(res, "ElevenLabs TTS", [400, 404, 422]);
    return { audio: Buffer.from(await res.arrayBuffer()), type: "audio/mpeg", source: `ElevenLabs ${model}` };
  });
}

export async function synthesize(input, voice = "jarvis") {
  const text = voice === "queen" ? speakableMongolian(input) : input;
  const order = voiceSupport().tts;
  const preferred = process.env.TTS_PROVIDER;
  if (order.includes(preferred)) order.sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
  if (!order.length) throw new Error("Дуу гаргах түлхүүр алга (OPENAI_API_KEY эсвэл GEMINI_API_KEY)");
  const errors = [];
  for (const id of order) {
    try {
      if (id === "elevenlabs") return await elevenlabsSpeech(text, voice);
      return id === "openai" ? await openaiSpeech(text, voice) : await geminiSpeech(text, voice);
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.join(" · "));
}

function openaiTranscribe(audio, type) {
  const models = list(process.env.OPENAI_STT_MODEL, "gpt-transcribe,gpt-4o-mini-transcribe");
  return tryModels("openai-stt", models, async (model, timeout) => {
    const form = new FormData();
    form.append("file", new Blob([audio], { type }), type.includes("ogg") ? "speech.ogg" : type.includes("mp4") ? "speech.mp4" : "speech.webm");
    form.append("model", model);
    form.append("language", "mn");
    const res = await request(
      "https://api.openai.com/v1/audio/transcriptions",
      { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form },
      "OpenAI STT",
      timeout,
    );
    if (!res.ok) throw await failure(res, "OpenAI STT", [400, 404]);
    return { text: String((await res.json()).text || "").trim(), source: `OpenAI ${model}` };
  });
}

function geminiTranscribe(audio, type) {
  const models = list(process.env.GEMINI_MODEL, "gemini-3.8-flash,gemini-3.6-flash");
  return tryModels("gemini-stt", models, async (model, timeout) => {
    const res = await request(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType: type.split(";")[0], data: audio.toString("base64") } },
                { text: "Transcribe this speech exactly as spoken, in its original language (usually Mongolian Cyrillic). Output only the transcript." },
              ],
            },
          ],
        }),
      },
      "Gemini STT",
      timeout,
    );
    if (!res.ok) throw await failure(res, "Gemini STT");
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("").trim();
    return { text, source: `Gemini ${model}` };
  });
}

export async function transcribe(audio, type) {
  const order = voiceSupport().stt;
  if (!order.length) throw new Error("Дуу таних түлхүүр алга (OPENAI_API_KEY эсвэл GEMINI_API_KEY)");
  const errors = [];
  for (const id of order) {
    try {
      return id === "openai" ? await openaiTranscribe(audio, type) : await geminiTranscribe(audio, type);
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(errors.join(" · "));
}
