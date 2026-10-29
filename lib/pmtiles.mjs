import { gunzipSync } from "node:zlib";

export const DEFAULT_BUILDINGS_URL = "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-10-21.0/buildings.pmtiles";

export class PmtilesError extends Error {}

function varintReader(buf) {
  let pos = 0;
  return () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      if (pos >= buf.length) throw new PmtilesError("PMTiles: directory truncated");
      const byte = buf[pos++];
      result += (byte & 0x7f) * 2 ** shift;
      if (!(byte & 0x80)) return result;
      shift += 7;
    }
  };
}

export function parseDirectory(buf) {
  const next = varintReader(buf);
  const entries = Array.from({ length: next() }, () => ({ tileId: 0, runLength: 0, length: 0, offset: 0 }));
  let last = 0;
  for (const entry of entries) entry.tileId = last += next();
  for (const entry of entries) entry.runLength = next();
  for (const entry of entries) entry.length = next();
  entries.forEach((entry, index) => {
    const value = next();
    entry.offset = value === 0 && index > 0 ? entries[index - 1].offset + entries[index - 1].length : value - 1;
  });
  return entries;
}

export function zxyToTileId(z, x, y) {
  let base = 0;
  for (let i = 0; i < z; i += 1) base += 4 ** i;
  let px = x;
  let py = y;
  let d = 0;
  for (let s = 2 ** (z - 1); s >= 1; s /= 2) {
    const rx = (px & s) > 0 ? 1 : 0;
    const ry = (py & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        px = s - 1 - px;
        py = s - 1 - py;
      }
      [px, py] = [py, px];
    }
  }
  return base + d;
}

export function findEntry(entries, tileId) {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const diff = tileId - entries[mid].tileId;
    if (diff > 0) lo = mid + 1;
    else if (diff < 0) hi = mid - 1;
    else return entries[mid];
  }
  if (hi >= 0) {
    const entry = entries[hi];
    if (entry.runLength === 0 || tileId - entry.tileId < entry.runLength) return entry;
  }
  return null;
}

export function createPmtilesReader(url, { fetchImpl = fetch } = {}) {
  let headerPromise = null;
  const leafCache = new Map();

  async function range(offset, length) {
    const res = await fetchImpl(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status !== 206 && res.status !== 200) throw new PmtilesError(`PMTiles ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return res.status === 200 ? buf.subarray(offset, offset + length) : buf;
  }

  function header() {
    headerPromise ||= range(0, 16384)
      .then((buf) => {
        if (buf.toString("ascii", 0, 7) !== "PMTiles" || buf[7] !== 3) throw new PmtilesError("PMTiles v3 биш файл");
        const u64 = (at) => Number(buf.readBigUInt64LE(at));
        const meta = {
          rootOffset: u64(8),
          rootLength: u64(16),
          leafOffset: u64(40),
          dataOffset: u64(56),
          internalCompression: buf[97],
          tileCompression: buf[98],
          minZoom: buf[100],
          maxZoom: buf[101],
        };
        const decode = (part) => (meta.internalCompression === 2 ? gunzipSync(part) : part);
        meta.decode = decode;
        meta.root = parseDirectory(decode(buf.subarray(meta.rootOffset, meta.rootOffset + meta.rootLength)));
        return meta;
      })
      .catch((error) => {
        headerPromise = null;
        throw error;
      });
    return headerPromise;
  }

  async function leaf(meta, entry) {
    const key = entry.offset;
    if (!leafCache.has(key)) {
      leafCache.set(
        key,
        range(meta.leafOffset + entry.offset, entry.length)
          .then((buf) => parseDirectory(meta.decode(buf)))
          .catch((error) => {
            leafCache.delete(key);
            throw error;
          }),
      );
      if (leafCache.size > 400) leafCache.delete(leafCache.keys().next().value);
    }
    return leafCache.get(key);
  }

  return {
    async info() {
      const meta = await header();
      return { minZoom: meta.minZoom, maxZoom: meta.maxZoom, gzip: meta.tileCompression === 2 };
    },
    async tile(z, x, y) {
      const meta = await header();
      if (z < meta.minZoom || z > meta.maxZoom) return null;
      const tileId = zxyToTileId(z, x, y);
      let entries = meta.root;
      for (let depth = 0; depth < 4; depth += 1) {
        const entry = findEntry(entries, tileId);
        if (!entry) return null;
        if (entry.runLength > 0) return range(meta.dataOffset + entry.offset, entry.length);
        entries = await leaf(meta, entry);
      }
      return null;
    },
  };
}
