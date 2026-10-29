import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createPmtilesReader, findEntry, parseDirectory, zxyToTileId } from "../lib/pmtiles.mjs";

function varint(value) {
  const bytes = [];
  let rest = value;
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  bytes.push(rest);
  return bytes;
}

function directory(entries) {
  const bytes = [...varint(entries.length)];
  let last = 0;
  for (const entry of entries) {
    bytes.push(...varint(entry.tileId - last));
    last = entry.tileId;
  }
  for (const entry of entries) bytes.push(...varint(entry.runLength));
  for (const entry of entries) bytes.push(...varint(entry.length));
  for (const entry of entries) bytes.push(...varint(entry.offset + 1));
  return Buffer.from(bytes);
}

test("PMTiles Hilbert tile ids match the spec", () => {
  assert.equal(zxyToTileId(0, 0, 0), 0);
  assert.equal(zxyToTileId(1, 0, 0), 1);
  assert.equal(zxyToTileId(1, 0, 1), 2);
  assert.equal(zxyToTileId(1, 1, 1), 3);
  assert.equal(zxyToTileId(1, 1, 0), 4);
  assert.equal(zxyToTileId(2, 0, 0), 5);
});

test("PMTiles directory parsing and run-length lookup", () => {
  const entries = parseDirectory(directory([
    { tileId: 5, runLength: 1, length: 10, offset: 0 },
    { tileId: 9, runLength: 3, length: 4, offset: 10 },
  ]));
  assert.equal(entries[1].tileId, 9);
  assert.equal(findEntry(entries, 5).offset, 0);
  assert.equal(findEntry(entries, 11).offset, 10);
  assert.equal(findEntry(entries, 12), null);
  assert.equal(findEntry(entries, 4), null);
});

test("PMTiles reader resolves a tile through HTTP ranges", async () => {
  const tileBody = Buffer.from("tile-bytes");
  const root = gzipSync(directory([{ tileId: zxyToTileId(1, 1, 1), runLength: 1, length: tileBody.length, offset: 0 }]));
  const header = Buffer.alloc(127);
  header.write("PMTiles", 0, "ascii");
  header[7] = 3;
  header.writeBigUInt64LE(127n, 8);
  header.writeBigUInt64LE(BigInt(root.length), 16);
  header.writeBigUInt64LE(BigInt(127 + root.length), 56);
  header[97] = 2;
  header[98] = 1;
  header[100] = 0;
  header[101] = 1;
  const file = Buffer.concat([header, root, tileBody]);
  const fetchImpl = async (_url, { headers }) => {
    const [, from, to] = headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);
    const slice = file.subarray(from, Math.min(file.length, to + 1));
    return { status: 206, arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length) };
  };
  const reader = createPmtilesReader("memory", { fetchImpl });
  assert.equal(String(await reader.tile(1, 1, 1)), "tile-bytes");
  assert.equal(await reader.tile(1, 0, 0), null);
  assert.equal(await reader.tile(5, 0, 0), null);
  assert.deepEqual(await reader.info(), { minZoom: 0, maxZoom: 1, gzip: false });
});
