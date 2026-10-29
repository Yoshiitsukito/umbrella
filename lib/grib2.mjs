function signed16(buf, at) {
  const raw = buf.readUInt16BE(at);
  return raw & 0x8000 ? -(raw & 0x7fff) : raw;
}

function signed32(buf, at) {
  const raw = buf.readUInt32BE(at);
  return raw & 0x80000000 ? -(raw & 0x7fffffff) : raw;
}

function readGrid(buf, p) {
  const template = buf.readUInt16BE(p + 12);
  if (template !== 0) throw new Error(`GRIB2: торын загвар 3.${template} дэмжигдэхгүй`);
  return {
    nx: buf.readUInt32BE(p + 30),
    ny: buf.readUInt32BE(p + 34),
    la1: signed32(buf, p + 46) / 1e6,
    lo1: signed32(buf, p + 50) / 1e6,
    la2: signed32(buf, p + 55) / 1e6,
    lo2: signed32(buf, p + 59) / 1e6,
    dx: buf.readUInt32BE(p + 63) / 1e6,
    dy: buf.readUInt32BE(p + 67) / 1e6,
    scan: buf[p + 71],
  };
}

function readProduct(buf, p) {
  const template = buf.readUInt16BE(p + 7);
  const scale = buf[p + 23];
  const value = buf.readUInt32BE(p + 24);
  return {
    pdt: template,
    category: buf[p + 9],
    parameter: buf[p + 10],
    timeUnit: buf[p + 17],
    forecastTime: buf.readUInt32BE(p + 18),
    surface: buf[p + 22],
    surfaceValue: scale === 255 ? null : value / 10 ** (scale > 127 ? -(scale & 0x7f) : scale),
  };
}

function readPacking(buf, p) {
  const template = buf.readUInt16BE(p + 9);
  if (template !== 0) throw new Error(`GRIB2: багцлалт 5.${template} дэмжигдэхгүй`);
  return {
    count: buf.readUInt32BE(p + 5),
    reference: buf.readFloatBE(p + 11),
    binaryScale: signed16(buf, p + 15),
    decimalScale: signed16(buf, p + 17),
    bits: buf[p + 19],
  };
}

function unpack(buf, start, packing, total, bitmap) {
  const values = new Float32Array(total);
  const base = packing.reference;
  const factor = 2 ** packing.binaryScale;
  const divisor = 10 ** packing.decimalScale;
  const bits = packing.bits;
  let bitPos = start * 8;
  for (let i = 0; i < total; i += 1) {
    if (bitmap && !(bitmap[i >> 3] & (0x80 >> (i & 7)))) {
      values[i] = Number.NaN;
      continue;
    }
    let raw = 0;
    for (let b = 0; b < bits; b += 1) {
      const byte = buf[(bitPos + b) >> 3];
      raw = raw * 2 + ((byte >> (7 - ((bitPos + b) & 7))) & 1);
    }
    bitPos += bits;
    values[i] = (base + raw * factor) / divisor;
  }
  return values;
}

export function parseGrib2(buf) {
  const messages = [];
  let offset = 0;
  while (offset <= buf.length - 16) {
    if (buf.toString("ascii", offset, offset + 4) !== "GRIB") {
      offset += 1;
      continue;
    }
    if (buf[offset + 7] !== 2) throw new Error("GRIB2: зөвхөн 2-р хувилбар дэмжинэ");
    const length = Number(buf.readBigUInt64BE(offset + 8));
    const end = offset + length;
    const message = { discipline: buf[offset + 6] };
    let grid = null;
    let product = null;
    let packing = null;
    let bitmap = null;
    let p = offset + 16;
    while (p < end - 4) {
      const size = buf.readUInt32BE(p);
      const section = buf[p + 4];
      if (section === 1) {
        message.reference = new Date(Date.UTC(buf.readUInt16BE(p + 12), buf[p + 14] - 1, buf[p + 15], buf[p + 16], buf[p + 17], buf[p + 18]));
      } else if (section === 3) {
        grid = readGrid(buf, p);
      } else if (section === 4) {
        product = readProduct(buf, p);
      } else if (section === 5) {
        packing = readPacking(buf, p);
      } else if (section === 6) {
        const indicator = buf[p + 5];
        if (indicator === 0) bitmap = buf.subarray(p + 6, p + size);
        else if (indicator !== 255) throw new Error("GRIB2: өмнөх bitmap дэмжигдэхгүй");
      } else if (section === 7) {
        const total = grid.nx * grid.ny;
        message.values = packing.bits === 0 ? new Float32Array(total).fill(packing.reference / 10 ** packing.decimalScale) : unpack(buf, p + 5, packing, total, bitmap);
      }
      p += size;
    }
    messages.push({ ...message, ...product, grid });
    offset = end;
  }
  return messages;
}
