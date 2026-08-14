#!/usr/bin/env node
/**
 * Write an uncompressed DNG for the test suite.
 *
 * There is no camera here to produce one, and a real raw file cannot be
 * committed: they are tens of megabytes and their licensing is nobody's idea of
 * clear. Writing one to the specification is better anyway — the contents are
 * known exactly, so a decode can be checked against what went in rather than
 * against what it looked like last time.
 *
 * Deliberately uncompressed, because that is what the built-in decoder reads.
 * The compressed case is the one it reports as undecodable with a reason, and
 * that path is covered by unit tests rather than needing a fixture.
 *
 *   node scripts/make_test_dng.mjs
 */

import console from "node:console";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const WIDTH = 64;
const HEIGHT = 48;
const BITS = 16;
const BLACK = 1024;
const WHITE = 65535;

/**
 * A scene with something to check in every channel.
 *
 * A red-to-blue horizontal ramp with a green vertical one, plus a neutral
 * square in the middle. The square is what makes the colour pipeline testable:
 * equal sensor values there must decode to a grey pixel, and any error in the
 * matrix or the white balance tints it.
 */
function scene(x, y) {
  const inSquare =
    x >= WIDTH / 2 - 8 &&
    x < WIDTH / 2 + 8 &&
    y >= HEIGHT / 2 - 8 &&
    y < HEIGHT / 2 + 8;
  if (inSquare) return { r: 0.5, g: 0.5, b: 0.5 };
  return {
    r: 1 - x / (WIDTH - 1),
    g: y / (HEIGHT - 1),
    b: x / (WIDTH - 1),
  };
}

/** Sample the scene through an RGGB colour-filter array, as a sensor does. */
function cfaSample(x, y) {
  const { r, g, b } = scene(x, y);
  const colour = y % 2 === 0 ? (x % 2 === 0 ? r : g) : x % 2 === 0 ? g : b;
  return Math.round(BLACK + colour * (WHITE - BLACK));
}

const entries = [];
const heap = [];
const HEADER = 8;
const IFD_COUNT = 17;
const ifdSize = 2 + IFD_COUNT * 12 + 4;
const heapAt = HEADER + ifdSize;

/** Place bytes after the IFD and return their offset. */
function place(bytes) {
  const at = heapAt + heap.length;
  heap.push(...bytes);
  return at;
}

const u32le = (v) => [
  v & 0xff,
  (v >> 8) & 0xff,
  (v >> 16) & 0xff,
  (v >>> 24) & 0xff,
];
const i32le = (v) => u32le(v < 0 ? v + 0x100000000 : v);
const rational = (n, d) => [...u32le(n), ...u32le(d)];
const srational = (n, d) => [...i32le(n), ...i32le(d)];

/** SHORT=3 LONG=4 RATIONAL=5 BYTE=1 ASCII=2 SRATIONAL=10 */
function entry(tag, type, count, valueBytes) {
  entries.push({ tag, type, count, valueBytes });
}

entry(0x00fe, 4, 1, u32le(0)); // NewSubfileType: the full image
entry(0x0100, 4, 1, u32le(WIDTH));
entry(0x0101, 4, 1, u32le(HEIGHT));
entry(0x0102, 3, 1, [BITS & 0xff, BITS >> 8, 0, 0]);
entry(0x0103, 3, 1, [1, 0, 0, 0]); // Compression: none
entry(0x0106, 3, 1, [0x23, 0x80, 0, 0]); // PhotometricInterpretation 32803 = CFA
entry(0x0115, 3, 1, [1, 0, 0, 0]); // SamplesPerPixel
entry(0x0116, 4, 1, u32le(HEIGHT)); // RowsPerStrip: one strip
entry(0x828d, 3, 2, [2, 0, 2, 0]); // CFARepeatPatternDim
entry(0x828e, 1, 4, [0, 1, 1, 2]); // CFAPattern: RGGB
entry(0xc612, 1, 4, [1, 4, 0, 0]); // DNGVersion
entry(0xc61a, 3, 1, [BLACK & 0xff, BLACK >> 8, 0, 0]);
entry(0xc61d, 4, 1, u32le(WHITE));

// A plausible XYZ→camera matrix with the sign pattern real ones have.
const colourMatrix = [
  [6722, 10000],
  [-6350, 10000],
  [-963, 10000],
  [-4287, 10000],
  [12460, 10000],
  [2028, 10000],
  [-908, 10000],
  [2162, 10000],
  [5668, 10000],
];
entry(
  0xc621,
  10,
  9,
  u32le(place(colourMatrix.flatMap(([n, d]) => srational(n, d)))),
);

// AsShotNeutral: what this camera reads for something neutral.
const neutral = [
  [52, 100],
  [100, 100],
  [72, 100],
];
entry(0xc628, 5, 3, u32le(place(neutral.flatMap(([n, d]) => rational(n, d)))));

// Sensor data, big-endian 16-bit as TIFF stores it.
const samples = [];
for (let y = 0; y < HEIGHT; y += 1) {
  for (let x = 0; x < WIDTH; x += 1) {
    const v = cfaSample(x, y);
    samples.push((v >> 8) & 0xff, v & 0xff);
  }
}
const stripAt = place(samples);
entry(0x0111, 4, 1, u32le(stripAt)); // StripOffsets
entry(0x0117, 4, 1, u32le(samples.length)); // StripByteCounts

if (entries.length !== IFD_COUNT) {
  throw new Error(
    `IFD_COUNT is ${IFD_COUNT} but ${entries.length} entries were written — the heap offset would be wrong`,
  );
}
// TIFF requires IFD entries in ascending tag order; readers are entitled to
// binary-search them.
entries.sort((a, b) => a.tag - b.tag);

const bytes = new Uint8Array(heapAt + heap.length);
const view = new DataView(bytes.buffer);
bytes.set([0x49, 0x49, 0x2a, 0x00], 0);
view.setUint32(4, HEADER, true);
view.setUint16(HEADER, entries.length, true);

entries.forEach((e, i) => {
  const at = HEADER + 2 + i * 12;
  view.setUint16(at, e.tag, true);
  view.setUint16(at + 2, e.type, true);
  view.setUint32(at + 4, e.count, true);
  bytes.set(e.valueBytes.slice(0, 4), at + 8);
});
view.setUint32(HEADER + 2 + entries.length * 12, 0, true);
bytes.set(heap, heapAt);

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "test_media",
  "photos",
  "sensor-ramp-64x48.dng",
);
writeFileSync(out, bytes);
console.log(
  `wrote ${out} (${bytes.length} bytes, ${WIDTH}x${HEIGHT}, uncompressed RGGB)`,
);
