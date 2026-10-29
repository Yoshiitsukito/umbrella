const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const LISTEN_MS = 15000;
const MANUAL_MS = 90000;

let active = null;
let audio = null;
let speakToken = 0;

export function canRecognizeInBrowser() {
  return Boolean(Recognition);
}

export function canRecord() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
}

export function isListening() {
  return Boolean(active);
}

export function stopListening() {
  active?.stop();
}

/** Stops listening and throws away whatever was heard. */
export function cancelListening() {
  active?.cancel();
}

function browserListen({ onInterim, onFinal, onUnclear, onError, onEnd }, manual = false) {
  const deadline = performance.now() + (manual ? MANUAL_MS : LISTEN_MS);
  let rec = null;
  let finalText = "";
  let interim = "";
  let failed = null;
  let heard = false;
  let spoke = false;
  let stopped = false;
  let discarded = false;
  const stop = () => {
    stopped = true;
    rec?.stop();
  };
  const cancel = () => {
    stopped = true;
    discarded = true;
    rec?.abort();
  };
  const timer = setTimeout(
    () => {
      if (manual || !heard) stop();
    },
    manual ? MANUAL_MS : LISTEN_MS,
  );
  const start = () => {
    rec = new Recognition();
    rec.lang = "mn-MN";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      if ((finalText + interim).trim()) heard = true;
      onInterim?.((finalText + interim).trim());
      if (!manual && finalText.trim()) stop();
    };
    rec.onspeechstart = () => {
      spoke = true;
    };
    rec.onnomatch = () => {
      spoke = true;
    };
    rec.onerror = (event) => {
      failed = event.error;
    };
    rec.onend = () => {
      const silent = !failed || failed === "no-speech";
      const again = manual ? silent : silent && !spoke && !finalText.trim();
      if (!stopped && again && performance.now() < deadline - 300) {
        if (manual && interim.trim()) finalText += `${interim} `;
        interim = "";
        failed = null;
        start();
        return;
      }
      clearTimeout(timer);
      active = null;
      if (discarded) {
        onEnd?.();
        return;
      }
      if (manual && interim.trim()) finalText += interim;
      if (failed && failed !== "no-speech" && failed !== "aborted") onError?.(failed);
      else if (finalText.trim()) onFinal?.(finalText.trim());
      else if (spoke && failed !== "aborted") onUnclear?.();
      onEnd?.();
    };
    rec.start();
  };
  active = { stop, cancel, kind: "browser" };
  start();
}

async function recordListen({ onFinal, onUnclear, onError, onEnd, onLevel }, manual = false) {
  let cancelled = false;
  active = { stop: () => (cancelled = true), cancel: () => (cancelled = true), kind: "record" };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch {
    active = null;
    onError?.("not-allowed");
    onEnd?.();
    return;
  }
  if (cancelled) {
    active = null;
    stream.getTracks().forEach((track) => track.stop());
    onEnd?.();
    return;
  }
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((item) => MediaRecorder.isTypeSupported(item)) || "";
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const started = performance.now();
  let heard = false;
  let quietSince = 0;
  let timer = 0;
  let discarded = false;
  const finish = () => {
    clearInterval(timer);
    if (recorder.state !== "inactive") recorder.stop();
  };
  timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const value of samples) sum += value * value;
    const level = Math.sqrt(sum / samples.length);
    onLevel?.(level);
    const now = performance.now();
    if (level > 0.03) {
      heard = true;
      quietSince = 0;
    } else if (heard && !manual) {
      quietSince ||= now;
      if (now - quietSince > 1400) finish();
    }
    if (manual ? now - started > MANUAL_MS : now - started > LISTEN_MS + 15000 || (!heard && now - started > LISTEN_MS)) finish();
  }, 100);
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  recorder.onstop = async () => {
    active = null;
    stream.getTracks().forEach((track) => track.stop());
    context.close();
    if (discarded || (!heard && !(manual && performance.now() - started > 1000))) {
      onEnd?.();
      return;
    }
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    try {
      const res = await fetch("/api/stt", { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
      const data = await res.json();
      if (res.status === 400) onUnclear?.();
      else if (!res.ok) throw new Error(data.error || "Дуу таних амжилтгүй");
      else if (data.text?.trim()) onFinal?.(data.text.trim());
      else onUnclear?.();
    } catch (error) {
      onError?.(error.message);
    }
    onEnd?.();
  };
  active = {
    stop: finish,
    cancel: () => {
      discarded = true;
      finish();
    },
    kind: "record",
  };
  recorder.start(250);
}

/** With `manual`, listening runs until stopListening() (or MANUAL_MS) instead of ending at the first pause. */
export function listen(handlers, { serverStt, manual = false }) {
  if (active) return;
  if (manual && serverStt && canRecord()) {
    recordListen(handlers, true);
    return;
  }
  if (Recognition) {
    let fellBack = false;
    browserListen(
      {
        ...handlers,
        onError: (code) => {
          const recoverable = ["network", "language-not-supported", "service-not-allowed"].includes(code);
          if (recoverable && serverStt && canRecord()) {
            fellBack = true;
            handlers.onFallback?.();
            recordListen(handlers, manual);
          } else handlers.onError?.(code);
        },
        onEnd: () => {
          if (!fellBack) handlers.onEnd?.();
        },
      },
      manual,
    );
    return;
  }
  if (serverStt && canRecord()) {
    recordListen(handlers, manual);
    return;
  }
  handlers.onError?.("unsupported");
  handlers.onEnd?.();
}

const FEMALE_VOICE = /yesui|female|svetlana|dariya|irina|ekaterina|zira|aria|jenny/i;

function browserVoice(female = false, lang = "mn") {
  const voices = (window.speechSynthesis?.getVoices() || []).filter((voice) => voice.lang?.toLowerCase().startsWith(lang));
  if (female) return voices.find((voice) => FEMALE_VOICE.test(voice.name)) || voices[0] || null;
  return voices.find((voice) => /bataa|male/i.test(voice.name)) || voices[0] || null;
}

function speakBrowser(text, voice, { onStart, onEnd, female }) {
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang || "mn-MN";
  utterance.rate = female ? 1 : 0.96;
  utterance.pitch = female ? 1.05 : 0.88;
  utterance.onstart = () => onStart?.("browser");
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

let fx = null;
let source = null;
let meter = 0;

function impulse(ctx, seconds) {
  const length = Math.round(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

// Jarvis-like colouring: trimmed lows, presence lift, a short metallic comb and a small room.
function jarvisChain() {
  if (fx) return fx;
  const ctx = new AudioContext();
  const filter = (type) => Object.assign(ctx.createBiquadFilter(), { type });
  const input = ctx.createGain();
  const highpass = filter("highpass");
  highpass.frequency.value = 140;
  const presence = filter("peaking");
  presence.frequency.value = 3000;
  presence.Q.value = 0.9;
  presence.gain.value = 4;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.ratio.value = 3;
  const dry = ctx.createGain();
  dry.gain.value = 0.9;
  const comb = ctx.createDelay(0.05);
  comb.delayTime.value = 0.011;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.3;
  const metal = ctx.createGain();
  metal.gain.value = 0.2;
  const room = ctx.createConvolver();
  room.buffer = impulse(ctx, 0.45);
  const roomGain = ctx.createGain();
  roomGain.gain.value = 0.16;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  input.connect(highpass).connect(presence).connect(compressor);
  compressor.connect(dry).connect(analyser);
  compressor.connect(comb).connect(metal).connect(analyser);
  comb.connect(feedback).connect(comb);
  compressor.connect(room).connect(roomGain).connect(analyser);
  analyser.connect(ctx.destination);
  fx = { ctx, input, analyser, samples: new Float32Array(analyser.fftSize) };
  return fx;
}

export function primeAudio() {
  try {
    jarvisChain().ctx.resume();
  } catch {
    /* Web Audio unavailable; speech plays unprocessed */
  }
}

async function runningChain() {
  try {
    const chain = jarvisChain();
    if (chain.ctx.state !== "running") await Promise.race([chain.ctx.resume(), new Promise((done) => setTimeout(done, 300))]);
    return chain.ctx.state === "running" ? chain : null;
  } catch {
    return null;
  }
}

function startMeter(onLevel) {
  if (!onLevel || !fx) return;
  const tick = () => {
    if (!source) return;
    fx.analyser.getFloatTimeDomainData(fx.samples);
    let sum = 0;
    for (const value of fx.samples) sum += value * value;
    onLevel(Math.sqrt(sum / fx.samples.length));
    meter = requestAnimationFrame(tick);
  };
  meter = requestAnimationFrame(tick);
}

export function stopSpeaking() {
  speakToken += 1;
  window.speechSynthesis?.cancel();
  cancelAnimationFrame(meter);
  source?.disconnect();
  source = null;
  if (audio) {
    audio.pause();
    URL.revokeObjectURL(audio.src);
    audio = null;
  }
}

export async function speak(text, { serverTts, voice = "jarvis", onStart, onEnd, onError, onLevel }) {
  const female = voice === "queen";
  stopSpeaking();
  const mine = speakToken;
  const clean = String(text || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
  if (!clean) return;
  const mongolian = browserVoice(female);
  if (serverTts) {
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: clean, voice }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Дуу гаргах амжилтгүй");
      const blob = await res.blob();
      if (mine !== speakToken) return;
      const natural = female || /elevenlabs/i.test(decodeURIComponent(res.headers.get("X-Voice-Source") || ""));
      const chain = natural ? null : await runningChain();
      if (mine !== speakToken) return;
      audio = new Audio(URL.createObjectURL(blob));
      if (chain) {
        source = chain.ctx.createMediaElementSource(audio);
        source.connect(chain.input);
      }
      audio.onended = () => {
        stopSpeaking();
        onEnd?.();
      };
      audio.onerror = () => onEnd?.();
      await audio.play();
      startMeter(onLevel);
      onStart?.(decodeURIComponent(res.headers.get("X-Voice-Source") || "server"));
      return;
    } catch (error) {
      if (!mongolian) onError?.(error.message);
    }
  }
  if (mongolian) {
    speakBrowser(clean, mongolian, { onStart, onEnd, female });
    return;
  }
  if (!window.speechSynthesis) {
    onEnd?.();
    return;
  }
  const cyrillic = browserVoice(female, "ru");
  if (!cyrillic) {
    onError?.("Монгол хоолой олдсонгүй. Microsoft Edge-ээр нээвэл үнэгүй Bataa/Yesui хоолой ажиллана, эсвэл OPENAI_API_KEY / GEMINI_API_KEY нэмнэ үү.");
    return;
  }
  speakBrowser(clean, cyrillic, { onStart: () => onStart?.("fallback"), onEnd, female });
}

window.speechSynthesis?.getVoices();
