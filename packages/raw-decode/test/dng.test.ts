import { describe, expect, it } from "vitest";
import { readDng, DNG_COMPRESSION } from "../src/dng.js";
import {
  buildDng,
  cfaIfd,
  dngVersion,
  SHORT,
  LONG,
  ASCII_TYPE,
  type Tag,
} from "./dng-fixtures.js";

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

  it("accepts a losslessly compressed DNG, which is most of them", () => {
    // Lossless JPEG is what cameras actually write; uncompressed DNGs are
    // mostly conversions. This used to be refused.
    const dng = readDng(
      buildDng([
        dngVersion(),
        ...cfaIfd(100, 80).map((t) =>
          t.tag === 0x0103 ? { ...t, value: DNG_COMPRESSION.jpeg } : t,
        ),
      ]),
    );
    expect(dng!.decodable).toBe(true);
    expect(dng!.reason).toBeUndefined();
    expect(dng!.raw.width).toBe(100);
  });

  it("still names a compression it cannot read", () => {
    // The reporting path has to keep working, or an unreadable file goes back
    // to being refused without explanation.
    const dng = readDng(
      buildDng([
        dngVersion(),
        ...cfaIfd(100, 80).map((t) =>
          t.tag === 0x0103 ? { ...t, value: DNG_COMPRESSION.lossyJpeg } : t,
        ),
      ]),
    );
    expect(dng!.decodable).toBe(false);
    expect(dng!.reason).toContain("lossy JPEG");
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
