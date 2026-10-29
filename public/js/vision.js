const QUOTES = {
  tired: ["Богино алхам хангалттай. Эхний ажлаа л дуусга.", "Ядарсан үед ус, дараа нь нэг ажил."],
  stress: ["Амьсгаагаа уртасга. Дараагийн минут чинийх.", "Нэг зүйлийг хаахад бусад нь намдана."],
  calm: ["Өнөөдрийн эхний алхам жижиг байж болно. Түүнийг хий.", "Тогтвортой байхад өдөр өөр өнгөтэй болдог."],
};

let landmarkerPromise = null;
let modelState = "pending";

async function landmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/vision_bundle.mjs");
      const files = await vision.FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm",
      );
      return vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        },
        runningMode: "IMAGE",
        numFaces: 1,
      });
    })().catch((error) => {
      modelState = "failed";
      landmarkerPromise = null;
      throw error;
    });
  }
  const ready = await landmarkerPromise;
  modelState = "ready";
  return ready;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function ear(landmarks, indices) {
  const [p1, p2, p3, p4, p5, p6] = indices.map((index) => landmarks[index]);
  const width = dist(p1, p4);
  if (!width) return null;
  return (dist(p2, p6) + dist(p3, p5)) / (2 * width);
}

function sample(data, width, height, x, y) {
  const radius = 6;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let lum = [];
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const i = (py * width + px) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      lum.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      n += 1;
    }
  }
  if (!n) return null;
  const mean = lum.reduce((sum, value) => sum + value, 0) / n;
  const variance = lum.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
  return { r: r / n, g: g / n, b: b / n, mean, variance };
}

function skinFromSamples(samples) {
  const usable = samples.filter(Boolean);
  if (!usable.length) return null;
  const r = usable.reduce((sum, item) => sum + item.r, 0) / usable.length;
  const g = usable.reduce((sum, item) => sum + item.g, 0) / usable.length;
  const b = usable.reduce((sum, item) => sum + item.b, 0) / usable.length;
  const mean = usable.reduce((sum, item) => sum + item.mean, 0) / usable.length;
  const variance = usable.reduce((sum, item) => sum + item.variance, 0) / usable.length;
  const redness = r - (g + b) / 2;
  const irritation = clamp(redness / 42);
  const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  const hydration = clamp(0.75 - variance / 800 + saturation * 0.4);
  const lightPenalty = mean < 45 || mean > 220 ? 0.35 : 0;
  return { hydration, irritation, lightPenalty, mean };
}

function advice(reading) {
  const mood = reading.fatigue > 0.65 ? "tired" : reading.stress > 0.65 ? "stress" : "calm";
  const quote = QUOTES[mood][0];
  const mind =
    mood === "tired"
      ? "Ядаргаа өндөр харагдаж байна. Богино алхалт, дараа нь нэг ажил. Кофеноос өмнө ус."
      : mood === "stress"
        ? "Стрессийн тэмдэг өндөр. 60 секундийн амьсгал, дараа нь хамгийн чухал нэг ажлаа эхэл."
        : "Тайван төлөв харагдаж байна. Өдрийн хамгийн чухал ажлаа эхний блок дээр тавь.";
  let skin = "Арьсны гэрэл жигд харагдаж байна. Өдөр тутмын чийгшүүлэлтээ үргэлжлүүл.";
  if (reading.irritation > 0.55) skin = "Улайлт өндөр харагдаж байна. Үнэртэй бус зөөлөн угааж, өнөөдөр шууд наранд бага бай.";
  else if (reading.hydration < 0.4) skin = "Чийгийн тэмдэг бага харагдаж байна. Ус ууж, энгийн чийгшүүлэгч түрх.";
  return { quote, advice: mind, skinAdvice: skin };
}

export async function analyzeFrame(video) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let fatigue = null;
  let stress = null;
  let samples = [];
  let mode = "color";
  try {
    const marker = await landmarker();
    const result = marker.detect(canvas);
    const landmarks = result.faceLandmarks?.[0];
    if (!landmarks) throw new Error("Нүүр олдсонгүй");
    mode = "landmark";
    const left = ear(landmarks, [33, 160, 158, 133, 153, 144]);
    const right = ear(landmarks, [362, 385, 387, 263, 373, 380]);
    if (left == null || right == null) throw new Error("Нүд тодорхойгүй");
    const eye = (left + right) / 2;
    fatigue = clamp((0.3 - eye) / 0.14);
    const brow = dist(landmarks[107], landmarks[336]);
    const faceW = dist(landmarks[33], landmarks[263]) || 1;
    stress = clamp((0.42 - brow / faceW) / 0.12);
    for (const index of [50, 280, 117, 346]) {
      const point = landmarks[index];
      samples.push(sample(pixels.data, canvas.width, canvas.height, point.x * canvas.width, point.y * canvas.height));
    }
  } catch {
    mode = "color";
    if ("FaceDetector" in window) {
      try {
        const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        const faces = await detector.detect(canvas);
        const box = faces[0]?.boundingBox;
        if (box) {
          samples.push(sample(pixels.data, canvas.width, canvas.height, box.x + box.width * 0.35, box.y + box.height * 0.55));
          samples.push(sample(pixels.data, canvas.width, canvas.height, box.x + box.width * 0.65, box.y + box.height * 0.55));
        }
      } catch {
        /* color sample from the center */
      }
    }
    if (!samples.filter(Boolean).length) {
      samples.push(sample(pixels.data, canvas.width, canvas.height, canvas.width / 2, canvas.height / 2));
    }
  }

  const skin = skinFromSamples(samples);
  if (!skin) return { error: "Кадраас өнгө уншиж чадсангүй. Гэрэл нэмээд дахин дарна уу." };
  const confidence = clamp((mode === "landmark" ? 0.78 : 0.48) - skin.lightPenalty);
  const reading = {
    fatigue: fatigue ?? 0,
    stress: stress ?? 0,
    hydration: skin.hydration,
    irritation: skin.irritation,
    confidence,
    withheld: confidence < 0.55 || mode !== "landmark",
    mode,
  };
  if (reading.withheld) {
    const missingModel = mode !== "landmark";
    return {
      ...reading,
      quote: missingModel ? "Нүүрний загвар ачаалагдаагүй тул тоог нуув." : "Гэрэл хангалтгүй тул тоог нуув.",
      advice: "Камер руу нүүрээ бүтэн, жигд гэрэлтэй харуулаад дахин дарна уу. Энэ бол эмнэлгийн онош биш.",
      skinAdvice: "Арьсны тоог энэ кадр дээр гаргасангүй.",
    };
  }
  return { ...reading, ...advice(reading) };
}

export function modelStatus() {
  return modelState;
}
