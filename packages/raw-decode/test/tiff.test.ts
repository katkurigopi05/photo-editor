import { describe, expect, it } from "vitest";
import { TiffReader, findTag } from "../src/tiff.js";

/**
 * The shared TIFF reader.
 *
 * These exist because of a bug that shipped: every rational was read unsigned,
 * and a DNG's colour matrices are SRATIONAL with roughly half their entries
 * negative. Reading −0.49 as about 4.29 billion does not throw and does not
 * look wrong until a picture comes out the far end in impossible colours, so
 * the signed types get direct coverage here rather than being exercised only
 * through whatever happens to call them.
 */

/**
 * A little-endian TIFF carrying one IFD entry.
 *
 * Values of four bytes or fewer live **inside the entry**; longer ones are
 * stored after the IFD with the entry holding an offset. The helper honours
 * that split, because writing everything out-of-line would test a file layout
 * no encoder produces — and would have the reader looking in the right place
 * for the wrong reason.
 */
function tiffWith(type: number, count: number, payload: number[]): Uint8Array {
  const ifdAt = 8;
  const ifdSize = 2 + 12 + 4;
  const valueAt = ifdAt + ifdSize;
  const inline = payload.length <= 4;
  const bytes = new Uint8Array(valueAt + payload.length + 8);
  const view = new DataView(bytes.buffer);

  bytes.set([0x49, 0x49, 0x2a, 0x00], 0);
  view.setUint32(4, ifdAt, true);
  view.setUint16(ifdAt, 1, true);
  view.setUint16(ifdAt + 2, 0x1234, true);
  view.setUint16(ifdAt + 4, type, true);
  view.setUint32(ifdAt + 6, count, true);

  if (inline) {
    bytes.set(payload, ifdAt + 10);
  } else {
    view.setUint32(ifdAt + 10, valueAt, true);
    bytes.set(payload, valueAt);
  }
  return bytes;
}

/** Little-endian bytes of a signed 32-bit integer. */
const i32 = (v: number): number[] => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return [...b];
};

const readOne = (type: number, payload: number[], count = 1): number => {
  const r = TiffReader.open(tiffWith(type, count, payload))!;
  const entry = findTag(r.readIfd(r.firstIfdOffset()), 0x1234)!;
  return r.value(entry);
};

describe("TiffReader.open", () => {
  it("accepts both byte orders", () => {
    const le = new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]);
    const be = new Uint8Array([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]);
    expect(TiffReader.open(le)?.littleEndian).toBe(true);
    expect(TiffReader.open(be)?.littleEndian).toBe(false);
  });

  it("rejects anything else", () => {
    expect(
      TiffReader.open(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    ).toBeNull();
    expect(TiffReader.open(new Uint8Array(4))).toBeNull();
  });
});

describe("signed field types", () => {
  it("reads SRATIONAL negatives as negative", () => {
    // The shipped bug. −4906146/10000000 is a real magnitude from a DNG colour
    // matrix; read unsigned it becomes about 429.
    expect(readOne(10, [...i32(-4906146), ...i32(10000000)])).toBeCloseTo(
      -0.4906146,
      7,
    );
  });

  it("reads SRATIONAL positives unchanged", () => {
    expect(readOne(10, [...i32(3133856), ...i32(1000000)])).toBeCloseTo(
      3.133856,
      6,
    );
  });

  it("reads RATIONAL as unsigned, since that is what it is", () => {
    // Type 5 has no sign: a large value is large, not negative. Applying the
    // signed read here would break AsShotNeutral and the levels.
    expect(readOne(5, [...i32(3000000000), ...i32(1000000000)])).toBeCloseTo(
      3,
      6,
    );
  });

  it("reads SLONG negatives", () => {
    expect(readOne(9, i32(-70000))).toBe(-70000);
  });

  it("reads LONG large values as positive", () => {
    expect(readOne(4, i32(-1))).toBe(4294967295);
  });

  it("reads SSHORT negatives", () => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setInt16(0, -300, true);
    expect(readOne(8, [...b])).toBe(-300);
  });

  it("reads SBYTE negatives", () => {
    expect(readOne(6, [0xff])).toBe(-1);
  });

  it("returns zero for a rational with a zero denominator", () => {
    // Infinity here would poison anything downstream that averages it.
    expect(readOne(10, [...i32(5), ...i32(0)])).toBe(0);
    expect(readOne(5, [...i32(5), ...i32(0)])).toBe(0);
  });
});

describe("bounds", () => {
  it("marks an entry whose value runs past the buffer as out of bounds", () => {
    const bytes = tiffWith(10, 1, [1, 2, 3, 4, 5, 6, 7, 8]);
    // The IFD ends at byte 26 and the 8-byte SRATIONAL follows it, so cutting
    // at 30 leaves the entry readable and its value four bytes short.
    const truncated = bytes.slice(0, 30);
    const r = TiffReader.open(truncated)!;
    const entry = findTag(r.readIfd(r.firstIfdOffset()), 0x1234);
    // The tag is still readable; its value is not to be trusted.
    expect(entry?.inBounds).toBe(false);
    expect(r.value(entry!)).toBe(0);
  });

  it("returns an empty IFD for an offset that cannot fit", () => {
    const r = TiffReader.open(
      new Uint8Array([0x49, 0x49, 0x2a, 0, 0xf0, 0xff, 0xff, 0xff]),
    )!;
    expect(r.readIfd(r.firstIfdOffset())).toEqual([]);
  });

  it("reads zero rather than throwing past the end", () => {
    const r = TiffReader.open(
      new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]),
    )!;
    expect(() => r.u32(1000)).not.toThrow();
    expect(r.u32(1000)).toBe(0);
    expect(r.u16(1000)).toBe(0);
  });
});
