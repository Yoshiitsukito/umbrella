import { idCard } from "./idcard.js";

const CARD_W = 1210;
const CARD_H = 765;
const SCALE = 2;
const PDF_W = 242.65;
const PDF_H = (PDF_W * CARD_H) / CARD_W;

const EXPORT_CSS = `
.idcard { width: ${CARD_W}px !important; cursor: default; }
.idcard .idcard-inner, .idcard .idc-back { transform: none !important; transition: none !important; }
.idcard .idc-face { box-shadow: inset 0 0 0 0.45cqw #cfc9bd, inset 0 0 0 0.75cqw #2a2a2a; }
.idcard .idc-holo { animation: none !important; }
`;

const inlined = new Map();

async function dataUrl(src) {
  if (!src || src.startsWith("data:")) return src;
  if (!inlined.has(src)) {
    inlined.set(
      src,
      fetch(src)
        .then((response) => response.blob())
        .then((blob) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        })),
    );
  }
  return inlined.get(src);
}

function cardCss() {
  const rules = [];
  for (const sheet of document.styleSheets) {
    let list;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of list) if (/idc|idcard/.test(rule.cssText)) rules.push(rule.cssText);
  }
  return rules.join("\n") + EXPORT_CSS;
}

async function faceCanvas(user, side, background) {
  const host = document.createElement("div");
  host.innerHTML = idCard(user);
  const card = host.firstElementChild;
  card.querySelector(side === "back" ? ".idc-front" : ".idc-back")?.remove();
  for (const img of card.querySelectorAll("img")) img.setAttribute("src", await dataUrl(img.getAttribute("src")));
  const wrap = document.createElement("div");
  wrap.setAttribute("style", `width:${CARD_W}px;height:${CARD_H}px;font-family:${getComputedStyle(document.body).fontFamily}`);
  const style = document.createElement("style");
  style.textContent = cardCss();
  wrap.append(style, card);
  const markup = new XMLSerializer().serializeToString(wrap);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W * SCALE}" height="${CARD_H * SCALE}" viewBox="0 0 ${CARD_W} ${CARD_H}"><foreignObject x="0" y="0" width="${CARD_W}" height="${CARD_H}">${markup}</foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W * SCALE;
  canvas.height = CARD_H * SCALE;
  const ctx = canvas.getContext("2d");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function blobOf(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Зураг үүсгэж чадсангүй"))), type, quality));
}

function pdfOf(pages) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let size = 0;
  const push = (part) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    size += bytes.length;
  };
  const object = (id, ...parts) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    parts.forEach(push);
    push("\nendobj\n");
  };
  push("%PDF-1.4\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  pages.forEach((page, index) => {
    const id = 3 + index * 3;
    const draw = `q ${PDF_W.toFixed(2)} 0 0 ${PDF_H.toFixed(2)} 0 0 cm /Im0 Do Q`;
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W.toFixed(2)} ${PDF_H.toFixed(2)}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    object(id + 1, `<< /Length ${draw.length} >>\nstream\n`, draw, "\nendstream");
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
      page.bytes,
      "\nendstream",
    );
  });
  const total = 3 + pages.length * 3;
  const xref = size;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let id = 1; id < total; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

function save(blob, name) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
}

export async function exportCard(user, format, side = "front") {
  const base = `${user.loginCode || user.username}-id-card`;
  if (format === "pdf") {
    const pages = [];
    for (const face of ["front", "back"]) {
      const canvas = await faceCanvas(user, face, "#ffffff");
      const bytes = new Uint8Array(await (await blobOf(canvas, "image/jpeg", 0.95)).arrayBuffer());
      pages.push({ bytes, width: canvas.width, height: canvas.height });
    }
    save(pdfOf(pages), `${base}.pdf`);
    return;
  }
  const jpeg = format === "jpg";
  const canvas = await faceCanvas(user, side, jpeg ? "#ffffff" : null);
  const label = side === "back" ? "ar" : "nuur";
  save(await blobOf(canvas, jpeg ? "image/jpeg" : "image/png", 0.95), `${base}-${label}.${jpeg ? "jpg" : "png"}`);
}
