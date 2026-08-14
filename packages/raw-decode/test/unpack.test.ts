import { describe, expect, it } from "vitest";
import {
  cfaColourAt,
  normaliseSamples,
  rowBytes,
  unpackImage,
  unpackRows,
} from "../src/unpack.js";
import type { DngImageLayout } from "../src/dng.js";
import { DNG_COMPRESSION } from "../src/dng.js";
import { encodeLosslessJpeg } from "./ljpeg-encoder.js";

/**
 * Unpacking sample bytes.
 *
 * Every expected value here is worked out from the specification, so a wrong
 * answer means a wrong unpacker. The two cases worth reading are `packs bits
 * most-significant-first` and `restarts each row on a byte boundary` — both
 * produce values in a plausible range when wrong, so neither is caught by
 * eyeballing a decoded picture.
 */

/** Pack values MSB-first at the given depth, restarting each row on a byte
 * boundary — the layout the spec describes, written independently here so the
 * test is not the implementation reflected back. */
function pack(rows: number[][], bits: number): Uint8Array {
  const width = rows[0]?.length ?? 0;
  const stride = Math.ceil((width * bits) / 8);
  const out = new Uint8Array(stride * rows.length);
  rows.forEach((row, y) => {
    let bit = 0;
    for (const value of row) {
      for (let b = bits - 1; b >= 0; b -= 1) {
        if ((value >> b) & 1) {
          const at = y * stride + (bit >> 3);
          out[at] = out[at]! | (0x80 >> (bit & 7));
        }
        bit += 1;
      }
    }
  });
  return out;
}

const layout = (over: Partial<DngImageLayout> = {}): DngImageLayout => ({
  width: 4,
  height: 2,
  bitsPerSample: 12,
  samplesPerPixel: 1,
  compression: 1,
  cfaPattern: ["R", "G", "G", "B"],
  cfaRepeat: { cols: 2, rows: 2 },
  blackLevel: [0],
  whiteLevel: 4095,
  ...over,
});

describe("rowBytes", () => {
  it("rounds up to whole bytes", () => {
    expect(rowBytes(4, 8)).toBe(4);
    expect(rowBytes(4, 12)).toBe(6);
    expect(rowBytes(4, 14)).toBe(7);
    // Five 12-bit samples is 60 bits, which needs eight bytes, not seven.
    expect(rowBytes(5, 12)).toBe(8);
  });
});

describe("unpackRows", () => {
  it("reads 8-bit samples straight through", () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect([...unpackRows(bytes, 0, 4, 1, 8)]).toEqual([1, 2, 3, 4]);
  });

  it("reads 16-bit samples big-endian, as TIFF stores them", () => {
    const bytes = new Uint8Array([0x12, 0x34, 0xab, 0xcd]);
    expect([...unpackRows(bytes, 0, 2, 1, 16)]).toEqual([0x1234, 0xabcd]);
  });

  it("packs bits most-significant-first", () => {
    // Two 12-bit samples in three bytes. 0xABC then 0xDEF is AB CD EF; reading
    // the other way round gives numbers in range and wrong.
    const bytes = new Uint8Array([0xab, 0xcd, 0xef]);
    expect([...unpackRows(bytes, 0, 2, 1, 12)]).toEqual([0xabc, 0xdef]);
  });

  it("reads 14-bit samples across byte boundaries", () => {
    const values = [0x3fff, 0x0000, 0x1234, 0x2aaa];
    const bytes = pack([values], 14);
    expect([...unpackRows(bytes, 0, 4, 1, 14)]).toEqual(values);
  });

  it("restarts each row on a byte boundary", () => {
    // Five 12-bit samples is 60 bits: each row wastes four bits of padding.
    // Packing rows continuously instead shears the image, and the shear grows
    // with every row — invisible at the top, obvious at the bottom.
    const rows = [
      [1, 2, 3, 4, 5],
      [100, 200, 300, 400, 500],
    ];
    const bytes = pack(rows, 12);
    const got = unpackRows(bytes, 0, 5, 2, 12);
    expect([...got.slice(0, 5)]).toEqual(rows[0]);
    expect([...got.slice(5)]).toEqual(rows[1]);
  });

  it("honours the starting offset", () => {
    const bytes = new Uint8Array([0xff, 0xff, 1, 2, 3, 4]);
    expect([...unpackRows(bytes, 2, 4, 1, 8)]).toEqual([1, 2, 3, 4]);
  });

  it("reads zero past the end rather than throwing", () => {
    // A truncated file should give a short picture, not an exception halfway
    // through a decode.
    const bytes = new Uint8Array([1, 2]);
    expect(() => unpackRows(bytes, 0, 4, 2, 8)).not.toThrow();
    expect([...unpackRows(bytes, 0, 4, 1, 8)]).toEqual([1, 2, 0, 0]);
  });
});

describe("cfaColourAt", () => {
  it("repeats the pattern across the sensor", () => {
    const l = layout();
    expect(cfaColourAt(l, 0, 0)).toBe("R");
    expect(cfaColourAt(l, 1, 0)).toBe("G");
    expect(cfaColourAt(l, 0, 1)).toBe("G");
    expect(cfaColourAt(l, 1, 1)).toBe("B");
    // And again one repeat over.
    expect(cfaColourAt(l, 2, 2)).toBe("R");
    expect(cfaColourAt(l, 3, 3)).toBe("B");
  });

  it("falls back to green rather than throwing on a missing pattern", () => {
    expect(cfaColourAt(layout({ cfaPattern: [] }), 0, 0)).toBe("G");
  });
});

describe("normaliseSamples", () => {
  it("maps black to 0 and white to 1", () => {
    const samples = new Uint16Array([512, 4095, 2303]);
    const out = normaliseSamples(
      samples,
      layout({ width: 3, height: 1, blackLevel: [512], whiteLevel: 4095 }),
    );
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(1, 6);
    expect(out[2]).toBeCloseTo(0.5, 3);
  });

  it("clamps readings below black to zero", () => {
    // Noise genuinely reads under the black level. A negative would survive
    // into the demosaic and show as coloured speckle in the shadows.
    const out = normaliseSamples(
      new Uint16Array([400]),
      layout({ width: 1, height: 1, blackLevel: [512] }),
    );
    expect(out[0]).toBe(0);
  });

  it("applies a per-site black level by CFA position", () => {
    // Averaging four different pedestals leaves a faint colour cast in the
    // shadows, which is exactly what per-site levels exist to remove.
    const samples = new Uint16Array([100, 200, 300, 400]);
    const out = normaliseSamples(
      samples,
      layout({
        width: 2,
        height: 2,
        blackLevel: [100, 200, 300, 400],
        whiteLevel: 4100,
      }),
    );
    // Every sample sits exactly on its own black level, so all read as zero.
    expect([...out]).toEqual([0, 0, 0, 0]);
  });

  it("returns zero rather than Infinity when white is not above black", () => {
    const out = normaliseSamples(
      new Uint16Array([1000]),
      layout({ width: 1, height: 1, blackLevel: [2000], whiteLevel: 1000 }),
    );
    expect(out[0]).toBe(0);
    expect(Number.isFinite(out[0])).toBe(true);
  });
});

describe("unpackImage", () => {
  it("assembles a stripped image", () => {
    const rows = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ];
    const bytes = pack(rows, 12);
    const out = unpackImage(
      bytes,
      layout({
        strips: { offsets: [0], byteCounts: [bytes.length], rowsPerStrip: 2 },
      }),
    );
    expect([...out!]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("assembles several strips in order", () => {
    const first = pack([[1, 2, 3, 4]], 12);
    const second = pack([[5, 6, 7, 8]], 12);
    const bytes = new Uint8Array(first.length + second.length);
    bytes.set(first, 0);
    bytes.set(second, first.length);
    const out = unpackImage(
      bytes,
      layout({
        strips: {
          offsets: [0, first.length],
          byteCounts: [first.length, second.length],
          rowsPerStrip: 1,
        },
      }),
    );
    expect([...out!]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("does not read a full strip past the end of the image", () => {
    // The last strip is usually short. Reading a whole one would run past the
    // image and, on a tight buffer, past the file.
    const bytes = pack(
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
      12,
    );
    const out = unpackImage(
      bytes,
      layout({
        width: 2,
        height: 3,
        strips: { offsets: [0], byteCounts: [bytes.length], rowsPerStrip: 4 },
      }),
    );
    expect([...out!]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("assembles tiles into the right places", () => {
    // Two 2×2 tiles side by side make a 4×2 image.
    const left = pack(
      [
        [1, 2],
        [5, 6],
      ],
      12,
    );
    const right = pack(
      [
        [3, 4],
        [7, 8],
      ],
      12,
    );
    const bytes = new Uint8Array(left.length + right.length);
    bytes.set(left, 0);
    bytes.set(right, left.length);
    const out = unpackImage(
      bytes,
      layout({
        tiles: {
          offsets: [0, left.length],
          byteCounts: [left.length, right.length],
          width: 2,
          height: 2,
        },
      }),
    );
    expect([...out!]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("discards the padding of a tile that overhangs the image", () => {
    // Tiles are whole even at the edge, so a 3-wide image tiled 2 across has a
    // column of encoder padding that must not appear in the result.
    const t0 = pack([[1, 2]], 12);
    const t1 = pack([[3, 99]], 12);
    const bytes = new Uint8Array(t0.length + t1.length);
    bytes.set(t0, 0);
    bytes.set(t1, t0.length);
    const out = unpackImage(
      bytes,
      layout({
        width: 3,
        height: 1,
        tiles: {
          offsets: [0, t0.length],
          byteCounts: [t0.length, t1.length],
          width: 2,
          height: 1,
        },
      }),
    );
    expect([...out!]).toEqual([1, 2, 3]);
  });

  it("refuses a bit depth it cannot unpack", () => {
    expect(
      unpackImage(new Uint8Array(16), layout({ bitsPerSample: 13 })),
    ).toBeNull();
  });

  it("refuses an image with no strip or tile layout", () => {
    expect(unpackImage(new Uint8Array(16), layout())).toBeNull();
  });
});

describe("unpackImage, losslessly compressed", () => {
  /** One lossless-JPEG block holding `rows` of samples, as a DNG stores it. */
  const block = (rows: number[][], components = 2): Uint8Array =>
    encodeLosslessJpeg({
      // A DNG splits a Bayer row across components so alternating colours are
      // predicted separately, so the frame is narrower than the block.
      width: (rows[0]?.length ?? 0) / components,
      height: rows.length,
      components,
      precision: 16,
      selector: 1,
      samples: rows.flat(),
    });

  it("decodes a compressed strip", () => {
    const rows = [
      [10, 20, 30, 40],
      [50, 60, 70, 80],
    ];
    const bytes = block(rows);
    const out = unpackImage(
      bytes,
      layout({
        compression: DNG_COMPRESSION.jpeg,
        bitsPerSample: 16,
        strips: { offsets: [0], byteCounts: [bytes.length], rowsPerStrip: 2 },
      }),
    );
    expect([...out!]).toEqual(rows.flat());
  });

  it("assembles compressed tiles into one image", () => {
    // The case a real camera produces. A tile placed at the wrong offset still
    // yields a full-looking picture, just scrambled, so the values are chosen
    // to make position obvious.
    const topLeft = block([
      [1, 2],
      [5, 6],
    ]);
    const topRight = block([
      [3, 4],
      [7, 8],
    ]);
    const bottomLeft = block([
      [9, 10],
      [13, 14],
    ]);
    const bottomRight = block([
      [11, 12],
      [15, 16],
    ]);

    const bytes = new Uint8Array(
      topLeft.length + topRight.length + bottomLeft.length + bottomRight.length,
    );
    const offsets: number[] = [];
    const byteCounts: number[] = [];
    let at = 0;
    for (const tile of [topLeft, topRight, bottomLeft, bottomRight]) {
      offsets.push(at);
      byteCounts.push(tile.length);
      bytes.set(tile, at);
      at += tile.length;
    }

    const out = unpackImage(
      bytes,
      layout({
        width: 4,
        height: 4,
        compression: DNG_COMPRESSION.jpeg,
        bitsPerSample: 16,
        tiles: { offsets, byteCounts, width: 2, height: 2 },
      }),
    );
    expect([...out!]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("leaves one unreadable tile black rather than losing the image", () => {
    // A corrupt tile must cost that tile. Refusing the whole file would throw
    // away a photograph over one damaged square.
    const good = block([
      [1, 2],
      [3, 4],
    ]);
    const rubbish = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]);
    const bytes = new Uint8Array(good.length + rubbish.length);
    bytes.set(good, 0);
    bytes.set(rubbish, good.length);

    const out = unpackImage(
      bytes,
      layout({
        width: 4,
        height: 2,
        compression: DNG_COMPRESSION.jpeg,
        bitsPerSample: 16,
        tiles: {
          offsets: [0, good.length],
          byteCounts: [good.length, rubbish.length],
          width: 2,
          height: 2,
        },
      }),
    );
    expect(out).not.toBe(null);
    expect([...out!]).toEqual([1, 2, 0, 0, 3, 4, 0, 0]);
  });

  it("reads a block only from its own bytes", () => {
    // A tile whose entropy data is cut short keeps asking for bits. What it
    // gets must come from padding, not from whatever follows in the file.
    //
    // The trailing bytes here are 0xAA rather than another tile: a tile that
    // follows starts with FF D8, which the bit reader already treats as a
    // marker and stops at, so a neighbouring *JPEG* hides the bug. Trailing
    // bytes with no 0xFF in them — padding, or a following TIFF structure —
    // are read straight through unless the stored byte count stops it, and
    // they decode into a full square of plausible values.
    const damaged = block([
      [100, 200],
      [300, 400],
    ]).subarray(0, -6);

    const exact = unpackImage(
      damaged,
      layout({
        width: 2,
        height: 2,
        compression: DNG_COMPRESSION.jpeg,
        bitsPerSample: 16,
        tiles: {
          offsets: [0],
          byteCounts: [damaged.length],
          width: 2,
          height: 2,
        },
      }),
    );

    const padded = new Uint8Array(damaged.length + 32).fill(0xaa);
    padded.set(damaged, 0);
    const withTrailing = unpackImage(
      padded,
      layout({
        width: 2,
        height: 2,
        compression: DNG_COMPRESSION.jpeg,
        bitsPerSample: 16,
        tiles: {
          offsets: [0],
          byteCounts: [damaged.length],
          width: 2,
          height: 2,
        },
      }),
    );

    expect([...withTrailing!]).toEqual([...exact!]);
  });

  it("refuses a block whose frame is the wrong width for its tile", () => {
    // A frame that decodes but describes a different geometry would be laid
    // out row by row into the wrong places, producing a sheared picture.
    const bytes = block([
      [1, 2],
      [3, 4],
    ]);
    const out = unpackImage(
      bytes,
      layout({
        width: 4,
        height: 2,
        compression: DNG_COMPRESSION.jpeg,
        bitsPerSample: 16,
        strips: { offsets: [0], byteCounts: [bytes.length], rowsPerStrip: 2 },
      }),
    );
    // Nothing placed, rather than placed wrongly.
    expect([...out!]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
