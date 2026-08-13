import { describe, expect, it } from "vitest";
import { routeRaw, type RawDecoderInfo } from "../src/route.js";

/**
 * Choosing a decoder.
 *
 * The rule being tested is that the *file* decides, not a setting: a DNG never
 * pays for a multi-megabyte download when built-in code can read it, and a
 * vendor format is not silently handed to a decoder that cannot read it.
 */

const dngOnly: RawDecoderInfo = {
  id: "dng-ts",
  formats: ["dng"],
  needsDownload: false,
  available: true,
};

const libraw: RawDecoderInfo = {
  id: "libraw-wasm",
  formats: [
    "dng",
    "cr2",
    "cr3",
    "nef",
    "arw",
    "orf",
    "rw2",
    "raf",
    "pef",
    "srw",
  ],
  needsDownload: true,
  available: true,
};

/** A minimal little-endian TIFF carrying just the tags a test needs. */
function tiff(tags: { tag: number; value: number }[]): Uint8Array {
  const bytes = new Uint8Array(8 + 2 + tags.length * 12 + 4 + 16);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 0x2a, 0x00], 0);
  view.setUint32(4, 8, true);
  view.setUint16(8, tags.length, true);
  tags.forEach((t, i) => {
    const at = 10 + i * 12;
    view.setUint16(at, t.tag, true);
    view.setUint16(at + 2, 3, true);
    view.setUint32(at + 4, 1, true);
    view.setUint32(at + 8, t.value, true);
  });
  return bytes;
}

const aDng = (): Uint8Array => tiff([{ tag: 0xc612, value: 0x01040000 }]);

const aCr3 = (): Uint8Array => {
  const b = new Uint8Array(64);
  b.set(new TextEncoder().encode("\0\0\0\x18ftypcrx "), 0);
  return b;
};

const aJpeg = (): Uint8Array => {
  const b = new Uint8Array(64);
  b.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return b;
};

describe("routeRaw", () => {
  it("says plainly when the file is not raw at all", () => {
    expect(routeRaw(aJpeg(), [dngOnly, libraw])).toEqual({ kind: "not-raw" });
  });

  it("sends a DNG to the built-in decoder rather than the download", () => {
    // The whole point of routing. Both can read it; only one costs a fetch.
    const out = routeRaw(aDng(), [libraw, dngOnly]);
    expect(out.kind).toBe("decode");
    if (out.kind !== "decode") return;
    expect(out.decoder.id).toBe("dng-ts");
  });

  it("still routes a DNG when only the downloadable decoder is present", () => {
    const out = routeRaw(aDng(), [libraw]);
    expect(out.kind).toBe("decode");
    if (out.kind !== "decode") return;
    expect(out.decoder.id).toBe("libraw-wasm");
  });

  it("sends a vendor format to the decoder that can read it", () => {
    const out = routeRaw(aCr3(), [dngOnly, libraw]);
    expect(out.kind).toBe("decode");
    if (out.kind !== "decode") return;
    expect(out.decoder.id).toBe("libraw-wasm");
  });

  it("never hands a vendor format to a decoder that cannot read it", () => {
    // Falling back to "any decoder" would fail deep inside the DNG reader with
    // a parse error, and the user would be told the file was corrupt.
    const out = routeRaw(aCr3(), [dngOnly]);
    expect(out.kind).toBe("unsupported");
  });

  it("distinguishes 'not installed' from 'never supported'", () => {
    // These are different problems: one the user can fix and one they cannot,
    // so the message must not blur them.
    const notLoaded = routeRaw(aCr3(), [
      dngOnly,
      { ...libraw, available: false },
    ]);
    expect(notLoaded.kind).toBe("unsupported");
    if (notLoaded.kind !== "unsupported") return;
    expect(notLoaded.reason).toMatch(/not loaded/);

    const neverSupported = routeRaw(aCr3(), [dngOnly]);
    if (neverSupported.kind !== "unsupported") return;
    expect(neverSupported.reason).toMatch(/cannot read|not a format/);
  });

  it("names the camera and format in the refusal", () => {
    // "Canon CR3 needs the extended decoder" is actionable; "unsupported file"
    // is not.
    const out = routeRaw(aCr3(), [dngOnly, { ...libraw, available: false }]);
    if (out.kind !== "unsupported") return;
    expect(out.reason).toContain("Canon");
    expect(out.reason).toContain("CR3");
  });

  it("ignores a decoder that is not available even if it fits", () => {
    const out = routeRaw(aDng(), [{ ...dngOnly, available: false }, libraw]);
    expect(out.kind).toBe("decode");
    if (out.kind !== "decode") return;
    expect(out.decoder.id).toBe("libraw-wasm");
  });

  it("reports nothing usable when no decoder is registered", () => {
    const out = routeRaw(aDng(), []);
    expect(out.kind).toBe("unsupported");
  });

  it("carries the identification through, so the caller need not sniff twice", () => {
    const out = routeRaw(aDng(), [dngOnly]);
    if (out.kind !== "decode") return;
    expect(out.identified).toMatchObject({ format: "dng", isDng: true });
  });
});
