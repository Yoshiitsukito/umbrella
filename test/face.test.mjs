import test from "node:test";
import assert from "node:assert/strict";
import { exifOrientation, faceProgress, frameBuffer, turnOf } from "../lib/face.mjs";

const vector = (value) => Array.from({ length: 128 }, (_, index) => (index === 0 ? value : 0));
const owner = vector(0);

test("faceProgress waits for a face, then for a head turn, then passes", () => {
  assert.deepEqual(faceProgress(owner, []).hint, "look");
  const front = [{ descriptor: vector(0.3), turn: 0.5 }];
  assert.equal(faceProgress(owner, front).hint, "turn");
  const turned = faceProgress(owner, [...front, { descriptor: vector(0.4), turn: 0.36 }]);
  assert.equal(turned.done, true);
  assert.equal(turned.ok, true);
  assert.equal(turned.distance, 0.3);
});

test("faceProgress keeps waiting on a still photo of the owner", () => {
  const still = Array.from({ length: 30 }, () => ({ descriptor: vector(0.1), turn: 0.5 }));
  assert.deepEqual([faceProgress(owner, still).done, faceProgress(owner, still).hint], [false, "turn"]);
});

test("faceProgress gives up on strangers and ignores their head turns", () => {
  const stranger = (turn) => ({ descriptor: vector(0.7), turn });
  assert.equal(faceProgress(owner, [stranger(0.3), stranger(0.7)]).hint, "look");
  const verdict = faceProgress(owner, [stranger(0.3), stranger(0.7), stranger(0.4), stranger(0.6)]);
  assert.equal(verdict.done, true);
  assert.equal(verdict.reason, "mismatch");
  assert.equal(faceProgress(owner, [{ descriptor: vector(0.2), turn: 0.5 }, stranger(0.3)]).hint, "turn");
});

test("turnOf ignores in-plane tilt but follows the nose", () => {
  const face = (nose, angle = 0) => {
    const rotate = ({ x, y }) => ({ x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) });
    const points = [];
    points[36] = rotate({ x: 0, y: 0 });
    points[45] = rotate({ x: 10, y: 0 });
    points[30] = rotate({ x: nose, y: 4 });
    return points;
  };
  assert.equal(turnOf(face(5)), 0.5);
  assert.ok(Math.abs(turnOf(face(5, 0.4)) - 0.5) < 1e-9);
  assert.ok(Math.abs(turnOf(face(7, 0.4)) - 0.7) < 1e-9);
});

test("exifOrientation reads the rotation tag that phone cameras write", () => {
  const exif = Buffer.from("FFD8" + "FFE10022" + "457869660000" + "4D4D002A00000008" + "0001" + "011200030000000100060000" + "00000000" + "FFDA", "hex");
  assert.equal(exifOrientation(exif), 6);
  assert.equal(exifOrientation(Buffer.from("FFD8FFDA", "hex")), 1);
  assert.equal(exifOrientation(Buffer.from("FFD8FFE1", "hex")), 1);
});

test("frameBuffer accepts base64 or data URLs and rejects junk", () => {
  assert.deepEqual(frameBuffer("data:image/jpeg;base64,AAEC"), Buffer.from([0, 1, 2]));
  assert.deepEqual(frameBuffer("AAEC"), Buffer.from([0, 1, 2]));
  assert.equal(frameBuffer("<script>"), null);
  assert.equal(frameBuffer(""), null);
  assert.equal(frameBuffer("A".repeat(400_001)), null);
});
