import { describe, expect, it } from "vitest";
import { sniffRaw } from "../src/sniff.js";

/**
 * Identifying raw files from their bytes.
 *
 * The headers here are built to spec rather than copied from a run, so a wrong
 * answer means a wrong sniffer. The load-bearing case is the last group: a
 * `.dng` and a `.nef` can begin with identical bytes, and the whole point of
 * reading the file instead of the filename is telling them apart.
 */

/** Build a little-endian TIFF with IFD0 containing the given tags. */
function tiff(
  tags: { tag: number; type?: number; count?: number; value: number }[],
  opts: { bigEndian?: boolean; makeString?: string } = {},
): Uint8Array {
  const big = opts.bigEndian === true;
  const makeBytes = opts.makeString
    ? new TextEncoder().encode(`${opts.makeString}\0`)
    : new Uint8Array(0);

  const ifdOffset = 8;
  const entries = tags.length;
  const ifdSize = 2 + entries * 12 + 4;
  const makeAt = ifdOffset + ifdSize;
  const bytes = new Uint8Array(makeAt + makeBytes.length + 16);
  const view = new DataView(bytes.buffer);

  if (big) {
    bytes.set([0x4d, 0x4d, 0x00, 0x2a], 0);
  } else {
    bytes.set([0x49, 0x49, 0x2a, 0x00], 0);
  }
  view.setUint32(4, ifdOffset, !big);
  view.setUint16(ifdOffset, entries, !big);

  tags.forEach((t, i) => {
    const at = ifdOffset + 2 + i * 12;
    view.setUint16(at, t.tag, !big);
    view.setUint16(at + 2, t.type ?? 3, !big);
    view.setUint32(at + 4, t.count ?? 1, !big);
    view.setUint32(at + 8, t.value, !big);
  });

  if (makeBytes.length > 0) bytes.set(makeBytes, makeAt);
  return bytes;
}

/** A TIFF whose Make tag points at a string stored after the IFD. */
const withMake = (
  make: string,
  extra: { tag: number; value: number }[] = [],
) => {
  const makeBytes = new TextEncoder().encode(`${make}\0`);
  const tags = [
    { tag: 0x010f, type: 2, count: makeBytes.length, value: 0 },
    ...extra.map((e) => ({ ...e, type: 3, count: 1 })),
  ];
  const bytes = tiff(tags, { makeString: make });
  // Point the Make entry at where the string actually landed.
  const view = new DataView(bytes.buffer);
  const ifdSize = 2 + tags.length * 12 + 4;
  view.setUint32(8 + 2 + 8, 8 + ifdSize, true);
  return bytes;
};

describe("sniffRaw", () => {
  it("returns null for something far too short to identify", () => {
    expect(sniffRaw(new Uint8Array([0x49, 0x49]))).toBeNull();
  });

  it("returns null for an ordinary JPEG", () => {
    const jpeg = new Uint8Array(64);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0], 0);
    expect(sniffRaw(jpeg)).toBeNull();
  });

  it("recognises a Fujifilm RAF by its ASCII signature", () => {
    const raf = new Uint8Array(64);
    raf.set(new TextEncoder().encode("FUJIFILMCCD-RAW"), 0);
    expect(sniffRaw(raf)).toMatchObject({ format: "raf", isDng: false });
  });

  it("recognises a Canon CR3 by its ISO-BMFF brand", () => {
    const cr3 = new Uint8Array(64);
    cr3.set(new TextEncoder().encode("\0\0\0\x18ftypcrx "), 0);
    expect(sniffRaw(cr3)).toMatchObject({ format: "cr3", make: "Canon" });
  });

  it("recognises a Canon CR2 by its header marker", () => {
    const cr2 = tiff([{ tag: 0x0100, value: 1 }]);
    cr2.set(new TextEncoder().encode("CR"), 8);
    expect(sniffRaw(cr2)).toMatchObject({ format: "cr2", isDng: false });
  });

  it("recognises Panasonic RW2 by its non-TIFF magic", () => {
    const rw2 = new Uint8Array(64);
    rw2.set([0x49, 0x49, 0x55, 0x00], 0);
    expect(sniffRaw(rw2)).toMatchObject({ format: "rw2" });
  });

  it("recognises Olympus ORF by its non-TIFF magic", () => {
    const orf = new Uint8Array(64);
    orf.set([0x49, 0x49, 0x52, 0x4f], 0);
    expect(sniffRaw(orf)).toMatchObject({ format: "orf" });
  });

  it("recognises a DNG by its DNGVersion tag", () => {
    const dng = tiff([{ tag: 0xc612, value: 0x01040000 }]);
    expect(sniffRaw(dng)).toMatchObject({ format: "dng", isDng: true });
  });

  it("recognises a big-endian DNG too", () => {
    // Nikon writes big-endian TIFF; a DNG from such a camera must still read.
    const dng = tiff([{ tag: 0xc612, value: 0x01040000 }], { bigEndian: true });
    expect(sniffRaw(dng)).toMatchObject({ format: "dng", isDng: true });
  });

  it("reads the camera make from a vendor TIFF", () => {
    expect(sniffRaw(withMake("NIKON CORPORATION"))).toMatchObject({
      format: "nef",
      isDng: false,
      make: "NIKON CORPORATION",
    });
  });

  it("maps each vendor to its own format", () => {
    const cases: [string, string][] = [
      ["SONY", "arw"],
      ["OLYMPUS CORPORATION", "orf"],
      ["Panasonic", "rw2"],
      ["PENTAX", "pef"],
      ["SAMSUNG", "srw"],
    ];
    for (const [make, format] of cases) {
      expect(sniffRaw(withMake(make))?.format).toBe(format);
    }
  });

  it("calls a DNG a DNG even when a camera vendor made it", () => {
    // The case the whole design turns on. A Nikon-authored DNG is a DNG and any
    // conforming decoder reads it; routing it by Make would send it to a NEF
    // path that cannot. DNGVersion has to win.
    const dng = withMake("NIKON CORPORATION", [{ tag: 0xc612, value: 1 }]);
    expect(sniffRaw(dng)).toMatchObject({
      format: "dng",
      isDng: true,
      make: "NIKON CORPORATION",
    });
  });

  it("returns null for a TIFF that names no camera and is not a DNG", () => {
    // A plain scanner TIFF. It may be many things; guessing which raw format
    // would be a confident wrong answer.
    expect(sniffRaw(tiff([{ tag: 0x0100, value: 640 }]))).toBeNull();
  });

  it("does not follow a corrupt IFD offset", () => {
    const broken = tiff([{ tag: 0xc612, value: 1 }]);
    new DataView(broken.buffer).setUint32(4, 0xfffffff0, true);
    expect(() => sniffRaw(broken)).not.toThrow();
    expect(sniffRaw(broken)).toBeNull();
  });

  it("does not follow an entry count that cannot fit", () => {
    const broken = tiff([{ tag: 0xc612, value: 1 }]);
    new DataView(broken.buffer).setUint16(8, 60000, true);
    expect(() => sniffRaw(broken)).not.toThrow();
    expect(sniffRaw(broken)).toBeNull();
  });
});
