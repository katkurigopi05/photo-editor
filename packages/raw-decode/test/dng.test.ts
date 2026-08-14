import { describe, expect, it } from "vitest";
import { readDng, DNG_COMPRESSION } from "../src/dng.js";

/**
 * Reading a DNG's structure.
 *
 * Files are built here to the specification, so a wrong answer means a wrong
 * reader rather than a changed fixture.
 *
 * The case the design turns on is `finds the raw image in a SubIFD`. IFD0 in a
 * real DNG is normally a small preview; a reader that trusts it returns a
 * thumbnail's dimensions with complete confidence, and every later stage then
 * decodes the wrong image perfectly.
 */

const PHOTOMETRIC_CFA = 32803;

interface Tag {
  tag: number;
  type: number;
  count: number;
  /** Inline value, for counts that fit in four bytes. */
  value?: number;
  /** Values written after the IFDs, with the entry pointing at them. */
  data?: number[];
  /** ASCII payload, written the same way. */
  text?: string;
}

const SHORT = 3;
const LONG = 4;
const BYTE = 1;
const ASCII_TYPE = 2;

/**
 * Build a little-endian TIFF with a main IFD and optional SubIFDs.
 *
 * Layout: header, IFD0, each SubIFD, then a heap for values too large to sit
 * inside their entry. Offsets are computed rather than hard-coded so a test can
 * add a tag without recalculating the file by hand.
 */
function buildDng(ifd0: Tag[], subIfds: Tag[][] = []): Uint8Array {
  const ifdSize = (tags: Tag[]): number => 2 + tags.length * 12 + 4;

  const ifd0At = 8;
  const subAt: number[] = [];
  let cursor = ifd0At + ifdSize(ifd0);
  for (const sub of subIfds) {
    subAt.push(cursor);
    cursor += ifdSize(sub);
  }
  const heapAt = cursor;

  // Reserve heap space for every out-of-line value.
  const heap: number[] = [];
  const place = (bytes: number[]): number => {
    const at = heapAt + heap.length;
    heap.push(...bytes);
    return at;
  };

  const bytes = new Uint8Array(heapAt + 4096);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 0x2a, 0x00], 0);
  view.setUint32(4, ifd0At, true);

  const writeIfd = (at: number, tags: Tag[], next: number): void => {
    view.setUint16(at, tags.length, true);
    tags.forEach((t, i) => {
      const entry = at + 2 + i * 12;
      view.setUint16(entry, t.tag, true);
      view.setUint16(entry + 2, t.type, true);
      view.setUint32(entry + 4, t.count, true);

      if (t.text !== undefined) {
        const encoded = [...new TextEncoder().encode(`${t.text}\0`)];
        view.setUint32(entry + 8, place(encoded), true);
        return;
      }
      if (t.data !== undefined) {
        const size = t.type === SHORT ? 2 : t.type === BYTE ? 1 : 4;
        if (t.data.length * size <= 4) {
          // Small enough to live in the entry.
          t.data.forEach((v, k) => {
            if (size === 1) view.setUint8(entry + 8 + k, v);
            else if (size === 2) view.setUint16(entry + 8 + k * 2, v, true);
            else view.setUint32(entry + 8 + k * 4, v, true);
          });
          return;
        }
        const flat: number[] = [];
        for (const v of t.data) {
          if (size === 1) flat.push(v & 0xff);
          else if (size === 2) flat.push(v & 0xff, (v >> 8) & 0xff);
          else
            flat.push(
              v & 0xff,
              (v >> 8) & 0xff,
              (v >> 16) & 0xff,
              (v >> 24) & 0xff,
            );
        }
        view.setUint32(entry + 8, place(flat), true);
        return;
      }
      view.setUint32(entry + 8, t.value ?? 0, true);
    });
    view.setUint32(at + 2 + tags.length * 12, next, true);
  };

  writeIfd(ifd0At, ifd0, 0);
  subIfds.forEach((sub, i) => writeIfd(subAt[i]!, sub, 0));

  // Patch the SubIFDs tag, now that their offsets are known.
  if (subIfds.length > 0) {
    const index = ifd0.findIndex((t) => t.tag === 0x014a);
    if (index >= 0) {
      const entry = ifd0At + 2 + index * 12;
      if (subAt.length === 1) {
        view.setUint32(entry + 8, subAt[0]!, true);
      } else {
        const flat: number[] = [];
        for (const a of subAt)
          flat.push(
            a & 0xff,
            (a >> 8) & 0xff,
            (a >> 16) & 0xff,
            (a >> 24) & 0xff,
          );
        view.setUint32(entry + 8, place(flat), true);
      }
    }
  }

  bytes.set(heap, heapAt);
  return bytes;
}

const dngVersion = (): Tag => ({
  tag: 0xc612,
  type: BYTE,
  count: 4,
  data: [1, 4, 0, 0],
});

/** A CFA IFD of the given size, uncompressed RGGB. */
const cfaIfd = (width: number, height: number, extra: Tag[] = []): Tag[] => [
  { tag: 0x0100, type: LONG, count: 1, value: width },
  { tag: 0x0101, type: LONG, count: 1, value: height },
  { tag: 0x0102, type: SHORT, count: 1, value: 14 },
  { tag: 0x0103, type: SHORT, count: 1, value: DNG_COMPRESSION.none },
  { tag: 0x0106, type: SHORT, count: 1, value: PHOTOMETRIC_CFA },
  { tag: 0x0115, type: SHORT, count: 1, value: 1 },
  { tag: 0x828e, type: BYTE, count: 4, data: [0, 1, 1, 2] },
  { tag: 0x0111, type: LONG, count: 1, value: 4096 },
  { tag: 0x0117, type: LONG, count: 1, value: width * height * 2 },
  ...extra,
];

describe("readDng", () => {
  it("returns null for bytes that are not TIFF", () => {
    expect(readDng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
  });

  it("returns null for a TIFF with no DNGVersion", () => {
    // A plain TIFF is not a DNG, however much it looks like one structurally.
    expect(readDng(buildDng(cfaIfd(100, 80)))).toBeNull();
  });

  it("reads size, bit depth and CFA pattern from a flat DNG", () => {
    const dng = readDng(buildDng([dngVersion(), ...cfaIfd(6000, 4000)]));
    expect(dng).not.toBeNull();
    expect(dng!.raw.width).toBe(6000);
    expect(dng!.raw.height).toBe(4000);
    expect(dng!.raw.bitsPerSample).toBe(14);
    expect(dng!.raw.cfaPattern).toEqual(["R", "G", "G", "B"]);
    expect(dng!.decodable).toBe(true);
  });

  it("finds the raw image in a SubIFD, not the preview in IFD0", () => {
    // The case the whole reader turns on. IFD0 here is a 160×120 RGB preview;
    // trusting it would report a thumbnail's dimensions with full confidence.
    const preview: Tag[] = [
      dngVersion(),
      { tag: 0x0100, type: LONG, count: 1, value: 160 },
      { tag: 0x0101, type: LONG, count: 1, value: 120 },
      { tag: 0x0106, type: SHORT, count: 1, value: 2 },
      { tag: 0x014a, type: LONG, count: 1, value: 0 },
    ];
    const dng = readDng(buildDng(preview, [cfaIfd(6000, 4000)]));
    expect(dng!.raw.width).toBe(6000);
    expect(dng!.raw.height).toBe(4000);
  });

  it("takes the largest CFA image when there is more than one", () => {
    // A DNG may carry a reduced-resolution raw beside the full one, and
    // NewSubfileType is not always set to say which is which.
    const root: Tag[] = [
      dngVersion(),
      { tag: 0x0106, type: SHORT, count: 1, value: 2 },
      { tag: 0x014a, type: LONG, count: 2, data: [0, 0] },
    ];
    const dng = readDng(
      buildDng(root, [cfaIfd(1500, 1000), cfaIfd(6000, 4000)]),
    );
    expect(dng!.raw.width).toBe(6000);
  });

  it("reads black and white levels", () => {
    const dng = readDng(
      buildDng([
        dngVersion(),
        ...cfaIfd(100, 80, [
          { tag: 0xc61a, type: SHORT, count: 1, value: 512 },
          { tag: 0xc61d, type: LONG, count: 1, value: 16383 },
        ]),
      ]),
    );
    expect(dng!.raw.blackLevel).toEqual([512]);
    expect(dng!.raw.whiteLevel).toBe(16383);
  });

  it("falls back to the bit depth when no white level is given", () => {
    // Zero would make every later division by (white − black) blow up.
    const dng = readDng(buildDng([dngVersion(), ...cfaIfd(100, 80)]));
    expect(dng!.raw.whiteLevel).toBe(16383);
  });

  it("reads a per-channel black level as four values", () => {
    const dng = readDng(
      buildDng([
        dngVersion(),
        ...cfaIfd(100, 80, [
          { tag: 0xc61a, type: SHORT, count: 4, data: [510, 512, 512, 514] },
        ]),
      ]),
    );
    expect(dng!.raw.blackLevel).toEqual([510, 512, 512, 514]);
  });

  it("reads strip layout", () => {
    const dng = readDng(buildDng([dngVersion(), ...cfaIfd(100, 80)]));
    expect(dng!.raw.strips?.offsets).toEqual([4096]);
    expect(dng!.raw.tiles).toBeUndefined();
  });

  it("reads tile layout and prefers it over strips", () => {
    const dng = readDng(
      buildDng([
        dngVersion(),
        ...cfaIfd(100, 80, [
          { tag: 0x0142, type: LONG, count: 1, value: 64 },
          { tag: 0x0143, type: LONG, count: 1, value: 64 },
          { tag: 0x0144, type: LONG, count: 2, data: [1000, 2000] },
          { tag: 0x0145, type: LONG, count: 2, data: [500, 500] },
        ]),
      ]),
    );
    expect(dng!.raw.tiles?.offsets).toEqual([1000, 2000]);
    expect(dng!.raw.tiles?.width).toBe(64);
    expect(dng!.raw.strips).toBeUndefined();
  });

  it("reads the camera make and model", () => {
    const dng = readDng(
      buildDng([
        dngVersion(),
        { tag: 0x010f, type: ASCII_TYPE, count: 6, text: "Canon" },
        { tag: 0x0110, type: ASCII_TYPE, count: 6, text: "R5 II" },
        ...cfaIfd(100, 80),
      ]),
    );
    expect(dng!.make).toBe("Canon");
    expect(dng!.model).toBe("R5 II");
  });

  it("reports a compressed DNG as not decodable, naming the compression", () => {
    // Most DNGs in the wild are losslessly compressed. Saying so is what lets
    // the app explain itself instead of refusing an unnamed file.
    const dng = readDng(
      buildDng([
        dngVersion(),
        ...cfaIfd(100, 80).map((t) =>
          t.tag === 0x0103 ? { ...t, value: DNG_COMPRESSION.jpeg } : t,
        ),
      ]),
    );
    expect(dng!.decodable).toBe(false);
    expect(dng!.reason).toContain("lossless JPEG");
    // Still reports the size: knowing what it is remains useful.
    expect(dng!.raw.width).toBe(100);
  });

  it("reports a linear DNG as not decodable rather than as not a DNG", () => {
    const dng = readDng(
      buildDng([
        dngVersion(),
        { tag: 0x0100, type: LONG, count: 1, value: 100 },
        { tag: 0x0101, type: LONG, count: 1, value: 80 },
        // PhotometricInterpretation 2 = RGB, already demosaiced.
        { tag: 0x0106, type: SHORT, count: 1, value: 2 },
      ]),
    );
    expect(dng).not.toBeNull();
    expect(dng!.decodable).toBe(false);
    expect(dng!.reason).toContain("linear");
  });

  it("does not loop on an IFD chain that points at itself", () => {
    const dng = buildDng([dngVersion(), ...cfaIfd(100, 80)]);
    // Point IFD0's "next" at IFD0.
    const view = new DataView(dng.buffer);
    const count = view.getUint16(8, true);
    view.setUint32(8 + 2 + count * 12, 8, true);
    expect(() => readDng(dng)).not.toThrow();
    expect(readDng(dng)!.raw.width).toBe(100);
  });

  it("survives a truncated file without reading past the end", () => {
    const full = buildDng([dngVersion(), ...cfaIfd(100, 80)]);
    for (const cut of [16, 32, 64, 100]) {
      expect(() => readDng(full.slice(0, cut))).not.toThrow();
    }
  });
});
