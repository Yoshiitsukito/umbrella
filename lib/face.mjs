import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";

const require = createRequire(import.meta.url);
const MODEL_DIR = fileURLToPath(new URL("../node_modules/@vladmandic/face-api/model", import.meta.url));

export const FACE_MATCH = 0.5;
export const FACE_TURN = 0.1;
/** Faces that are not the card owner before the check gives up. */
export const FACE_STRANGERS = 4;
const FRAME_MAX_CHARS = 400_000;
const MAX_SIDE = 960;

let engine = null;

function load() {
  if (!engine) {
    engine = (async () => {
      const tf = require("@tensorflow/tfjs");
      require("@tensorflow/tfjs-backend-wasm");
      const faceapi = require("@vladmandic/face-api/dist/face-api.node-wasm.js");
      await tf.setBackend("wasm");
      await tf.ready();
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_DIR);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_DIR);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_DIR);
      return { tf, faceapi };
    })();
    engine.catch(() => {
      engine = null;
    });
  }
  return engine;
}

export async function warmFace() {
  await load();
}

/** EXIF orientation tag of a JPEG (1 when absent or unreadable). */
export function exifOrientation(buffer) {
  try {
    let at = 2;
    while (at + 4 < buffer.length && buffer[at] === 0xff) {
      const marker = buffer[at + 1];
      const length = buffer.readUInt16BE(at + 2);
      if (marker === 0xda) break;
      if (marker === 0xe1 && buffer.toString("ascii", at + 4, at + 8) === "Exif") {
        const tiff = at + 10;
        const little = buffer.toString("ascii", tiff, tiff + 2) === "II";
        const u16 = (offset) => (little ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset));
        const u32 = (offset) => (little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset));
        const ifd = tiff + u32(tiff + 4);
        const count = u16(ifd);
        for (let index = 0; index < count; index += 1) {
          const entry = ifd + 2 + index * 12;
          if (u16(entry) === 0x0112) return u16(entry + 8);
        }
        return 1;
      }
      at += 2 + length;
    }
  } catch {
    /* malformed EXIF: treat as upright */
  }
  return 1;
}

function decode(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    const image = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: false, maxResolutionInMP: 30, maxMemoryUsageInMB: 256 });
    return { width: image.width, height: image.height, data: image.data, orientation: exifOrientation(buffer) };
  }
  if (buffer.length > 8 && buffer.readUInt32BE(0) === 0x89504e47) {
    const png = PNG.sync.read(buffer);
    const data = new Uint8Array(png.width * png.height * 3);
    for (let pixel = 0, out = 0; pixel < png.data.length; pixel += 4) {
      data[out++] = png.data[pixel];
      data[out++] = png.data[pixel + 1];
      data[out++] = png.data[pixel + 2];
    }
    return { width: png.width, height: png.height, data, orientation: 1 };
  }
  return null;
}

function toTensor(tf, image) {
  return tf.tidy(() => {
    let tensor = tf.tensor3d(image.data, [image.height, image.width, 3], "int32");
    if (image.orientation === 3 || image.orientation === 4) tensor = tf.reverse(tensor, [0, 1]);
    if (image.orientation === 5 || image.orientation === 6) tensor = tf.reverse(tf.transpose(tensor, [1, 0, 2]), [1]);
    if (image.orientation === 7 || image.orientation === 8) tensor = tf.reverse(tf.transpose(tensor, [1, 0, 2]), [0]);
    const [height, width] = tensor.shape;
    const scale = MAX_SIDE / Math.max(height, width);
    if (scale < 1) tensor = tf.cast(tf.image.resizeBilinear(tensor, [Math.round(height * scale), Math.round(width * scale)]), "int32");
    return tensor;
  });
}

/**
 * Where the nose tip sits between the outer eye corners, measured along the
 * eye axis: about 0.5 facing the camera, lower/higher when the head turns.
 * A flat photo keeps the same value however it is tilted.
 */
export function turnOf(points) {
  const left = points[36];
  const right = points[45];
  const nose = points[30];
  const ax = right.x - left.x;
  const ay = right.y - left.y;
  const span = ax * ax + ay * ay;
  if (!span) return 0.5;
  return ((nose.x - left.x) * ax + (nose.y - left.y) * ay) / span;
}

/** The largest face in an encoded image: { descriptor, turn, score } or null. */
export async function faceOf(buffer) {
  const image = decode(buffer);
  if (!image) return null;
  const { tf, faceapi } = await load();
  const tensor = toTensor(tf, image);
  try {
    const found = await faceapi
      .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();
    if (!found.length) return null;
    const area = (item) => item.detection.box.width * item.detection.box.height;
    const best = found.reduce((a, b) => (area(b) > area(a) ? b : a));
    return { descriptor: Array.from(best.descriptor), turn: turnOf(best.landmarks.positions), score: best.detection.score };
  } finally {
    tensor.dispose();
  }
}

export function frameBuffer(value) {
  const text = String(value ?? "");
  const data = text.startsWith("data:") ? text.slice(text.indexOf(",") + 1) : text;
  if (!data || data.length > FRAME_MAX_CHARS || !/^[A-Za-z0-9+/=]+$/.test(data)) return null;
  return Buffer.from(data, "base64");
}

const references = new Map();

/** Face descriptor of a stored profile photo (cached), or null when no face is found. */
export function photoFace(photo) {
  const key = createHash("sha256").update(photo).digest("base64url");
  if (!references.has(key)) {
    if (references.size > 500) references.delete(references.keys().next().value);
    const pending = (async () => (await faceOf(Buffer.from(photo.slice(photo.indexOf(",") + 1), "base64")))?.descriptor || null)();
    pending.catch(() => references.delete(key));
    references.set(key, pending);
  }
  return references.get(key);
}

export function faceDistance(a, b) {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += (a[index] - b[index]) ** 2;
  return Math.sqrt(sum);
}

const round = (value) => Math.round(value * 1000) / 1000;

/**
 * Follows a face check frame by frame while the station waits for the card owner.
 * faces: every face seen so far (frames without a face are not included).
 * Returns { done: false, hint: "look" | "turn" } until the owner has looked at the
 * camera and turned their head, or { done: true, ok, reason?, distance, turn }.
 */
export function faceProgress(reference, faces, { match = FACE_MATCH, turn = FACE_TURN, strangers = FACE_STRANGERS } = {}) {
  const scored = faces.map((face) => ({ ...face, distance: faceDistance(reference, face.descriptor) }));
  const owner = scored.filter((face) => face.distance <= match);
  const best = scored.length ? Math.min(...scored.map((face) => face.distance)) : null;
  const turns = owner.map((face) => face.turn);
  const spread = owner.length ? Math.max(...turns) - Math.min(...turns) : 0;
  const detail = { distance: best === null ? null : round(best), turn: round(spread), frames: scored.length };
  if (!owner.length) {
    if (scored.length >= strangers) return { done: true, ok: false, reason: "mismatch", ...detail };
    return { done: false, hint: "look", ...detail };
  }
  if (spread >= turn) return { done: true, ok: true, ...detail };
  return { done: false, hint: "turn", ...detail };
}
