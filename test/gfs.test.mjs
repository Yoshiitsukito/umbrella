import test from "node:test";
import assert from "node:assert/strict";
import { parseGrib2 } from "../lib/grib2.mjs";
import { insideBox, neighbourhoodProbability, sampleAt, sampleFrame } from "../lib/gfs.mjs";
import { apparentTemperature, localIso, sunElevation, weatherCodeFrom, windFromVector } from "../lib/weather.mjs";

function section(number, size, fill) {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(size, 0);
  buf[4] = number;
  fill?.(buf);
  return buf;
}

function gribMessage({ nx, ny, raws, reference, scan = 64, category = 0, parameter = 0, surface = 103 }) {
  const s1 = section(1, 21, (b) => {
    b.writeUInt16BE(2026, 12);
    b[14] = 10;
    b[15] = 27;
    b[16] = 6;
  });
  const s3 = section(3, 72, (b) => {
    b.writeUInt16BE(0, 12);
    b.writeUInt32BE(nx, 30);
    b.writeUInt32BE(ny, 34);
    b.writeInt32BE(47_000_000, 46);
    b.writeInt32BE(106_000_000, 50);
    b.writeInt32BE(47_250_000, 55);
    b.writeInt32BE(106_500_000, 59);
    b.writeUInt32BE(250_000, 63);
    b.writeUInt32BE(250_000, 67);
    b[71] = scan;
  });
  const s4 = section(4, 34, (b) => {
    b.writeUInt16BE(0, 7);
    b[9] = category;
    b[10] = parameter;
    b[17] = 1;
    b.writeUInt32BE(3, 18);
    b[22] = surface;
    b[23] = 0;
    b.writeUInt32BE(2, 24);
  });
  const s5 = section(5, 21, (b) => {
    b.writeUInt32BE(nx * ny, 5);
    b.writeUInt16BE(0, 9);
    b.writeFloatBE(reference, 11);
    b[19] = 8;
  });
  const s6 = section(6, 6, (b) => {
    b[5] = 255;
  });
  const s7 = section(7, 5 + raws.length, (b) => Buffer.from(raws).copy(b, 5));
  const body = Buffer.concat([s1, s3, s4, s5, s6, s7, Buffer.from("7777")]);
  const s0 = Buffer.alloc(16);
  s0.write("GRIB", 0, "ascii");
  s0[6] = 0;
  s0[7] = 2;
  s0.writeBigUInt64BE(BigInt(16 + body.length), 8);
  return Buffer.concat([s0, body]);
}

test("GRIB2 simple packing decodes grid, product and values", () => {
  const buf = Buffer.concat([
    gribMessage({ nx: 3, ny: 2, raws: [0, 1, 2, 3, 4, 5], reference: 270 }),
    gribMessage({ nx: 3, ny: 2, raws: [10, 10, 10, 10, 10, 10], reference: 0, category: 1, parameter: 7, surface: 1 }),
  ]);
  const [first, second] = parseGrib2(buf);
  assert.equal(first.grid.nx, 3);
  assert.equal(first.grid.ny, 2);
  assert.equal(first.grid.la1, 47);
  assert.equal(first.grid.dx, 0.25);
  assert.equal(first.grid.scan, 64);
  assert.equal(first.surface, 103);
  assert.equal(first.surfaceValue, 2);
  assert.equal(first.forecastTime, 3);
  assert.equal(first.reference.toISOString(), "2026-10-27T06:00:00.000Z");
  assert.deepEqual([...first.values], [270, 271, 272, 273, 274, 275]);
  assert.equal(second.category, 1);
  assert.equal(second.parameter, 7);
  assert.deepEqual([...second.values], [10, 10, 10, 10, 10, 10]);
});

function synthFrame(valid, { t2 = 273.15, prate = 0, csnow = 0, tcdc = 0 } = {}) {
  const grid = { nx: 3, ny: 3, la1: 47, lo1: 106, dx: 0.25, dy: 0.25, scan: 64 };
  const fill = (value) => (typeof value === "function" ? Float32Array.from({ length: 9 }, (_, i) => value(i)) : new Float32Array(9).fill(value));
  return { valid, grid, t2: fill(t2), rh: fill(50), u: fill(3), v: fill(4), prate: fill(prate), csnow: fill(csnow), tcdc: fill(tcdc) };
}

test("GFS sampling respects south-to-north scan and interpolates in time", () => {
  const southWarm = synthFrame(0, { t2: (i) => (i < 3 ? 283.15 : 273.15) });
  assert.equal(Math.round(sampleFrame(southWarm, 47, 106.25).tempC), 10);
  assert.equal(Math.round(sampleFrame(southWarm, 47.5, 106.25).tempC) + 0, 0);
  const point = sampleFrame(southWarm, 47.25, 106.25);
  assert.equal(Math.round(Math.hypot(point.u, point.v)), 5);

  const hour = 3600 * 1000;
  const data = { frames: [synthFrame(0, { prate: 0 }), synthFrame(hour, { prate: 2 / 3600 })] };
  data.grid = data.frames[0].grid;
  assert.equal(Math.round(sampleAt(data, 47.25, 106.25, hour / 2).precipMmH * 10) / 10, 1);
  assert.equal(neighbourhoodProbability(data, 0, 47.25, 106.25, 1), 50);
  assert.equal(neighbourhoodProbability(data, 1, 47.25, 106.25, 1), 50);
});

test("GFS area box", () => {
  assert.equal(insideBox(47.92, 106.92), true);
  assert.equal(insideBox(35.7, 139.7), false);
});

test("derived weather quantities", () => {
  assert.equal(Math.round(windFromVector(0, -5)), 0);
  assert.equal(Math.round(windFromVector(-5, 0)), 90);
  assert.ok(apparentTemperature(-10, 60, 8) < -15);
  assert.equal(weatherCodeFrom({ precipMmH: 0, cloud: 10, tempC: 5 }), 0);
  assert.equal(weatherCodeFrom({ precipMmH: 0, cloud: 90, tempC: 5 }), 3);
  assert.equal(weatherCodeFrom({ precipMmH: 3, cloud: 100, tempC: 5, snow: false }), 63);
  assert.equal(weatherCodeFrom({ precipMmH: 0.5, cloud: 100, tempC: -3, snow: true }), 71);
  assert.equal(localIso(Date.UTC(2026, 9, 27, 4, 30)), "2026-10-27T12:30");
  assert.ok(sunElevation(47.92, 106.92, Date.UTC(2026, 9, 27, 4, 0)) > 20);
  assert.ok(sunElevation(47.92, 106.92, Date.UTC(2026, 9, 27, 16, 0)) < -20);
});
