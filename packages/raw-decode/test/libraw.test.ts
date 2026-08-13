import { describe, expect, it } from "vitest";
import {
  createLibRawDecoder,
  LIBRAW_UNAVAILABLE,
  type LibRawModule,
} from "../src/libraw.js";
import { routeRaw } from "../src/route.js";

/**
 * The LibRaw adapter.
 *
 * No WebAssembly binary is involved: the contract is deliberately narrow enough
 * to fake exactly, which is what makes the adapter's own behaviour — declining,
 * validating, and surviving an abort — testable without one.
 *
 * The pairing with `routeRaw` is the part worth checking. An adapter that is
 * correct in isolation but registers itself wrongly would send DNGs down a
 * multi-megabyte path, or claim formats a trimmed build cannot read.
 */

const rgba = (w: number, h: number): Uint8ClampedArray =>
  new Uint8ClampedArray(w * h * 4).fill(200);

const workingModule = (): LibRawModule => ({
  decode: async (bytes) =>
    bytes.length === 0 ? null : { width: 2, height: 2, rgba: rgba(2, 2) },
});

const aCr3 = (): Uint8Array => {
  const b = new Uint8Array(64);
  b.set(new TextEncoder().encode("\0\0\0\x18ftypcrx "), 0);
  return b;
};

const aDng = (): Uint8Array => {
  const bytes = new Uint8Array(64);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 0x2a, 0x00], 0);
  view.setUint32(4, 8, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 0xc612, true);
  view.setUint16(12, 3, true);
  view.setUint32(14, 1, true);
  view.setUint32(18, 1, true);
  return bytes;
};

describe("LIBRAW_UNAVAILABLE", () => {
  it("claims every format but reports itself absent", () => {
    // Claiming the formats matters: it is what lets the router say "needs the
    // extended decoder, which is not loaded" rather than "cannot be read".
    expect(LIBRAW_UNAVAILABLE.available).toBe(false);
    expect(LIBRAW_UNAVAILABLE.formats).toContain("cr3");
    expect(LIBRAW_UNAVAILABLE.needsDownload).toBe(true);
  });

  it("makes the router explain a missing decoder rather than refuse blankly", () => {
    const out = routeRaw(aCr3(), [LIBRAW_UNAVAILABLE]);
    expect(out.kind).toBe("unsupported");
    if (out.kind !== "unsupported") return;
    expect(out.reason).toMatch(/not loaded/);
    expect(out.reason).toContain("CR3");
  });
});

describe("createLibRawDecoder", () => {
  it("reports itself available once a module is supplied", () => {
    expect(createLibRawDecoder(workingModule()).info.available).toBe(true);
  });

  it("decodes through the module", async () => {
    const out = await createLibRawDecoder(workingModule()).decode(aCr3());
    expect(out?.width).toBe(2);
    expect(out?.rgba.length).toBe(16);
  });

  it("passes a module's decline through as null", async () => {
    const out = await createLibRawDecoder(workingModule()).decode(
      new Uint8Array(0),
    );
    expect(out).toBeNull();
  });

  it("survives a module that throws", async () => {
    // A WASM abort is not a decline, but neither should reach the caller as an
    // exception — the router's contract is a decoder that returns null.
    const decoder = createLibRawDecoder({
      decode: async () => {
        throw new Error("abort");
      },
    });
    await expect(decoder.decode(aCr3())).resolves.toBeNull();
  });

  it("refuses a result whose buffer contradicts its dimensions", async () => {
    // A torn or truncated picture is worse than none: it looks like a decode
    // that worked and a camera that did not.
    const decoder = createLibRawDecoder({
      decode: async () => ({ width: 4, height: 4, rgba: rgba(2, 2) }),
    });
    expect(await decoder.decode(aCr3())).toBeNull();
  });

  it("refuses zero dimensions", async () => {
    const decoder = createLibRawDecoder({
      decode: async () => ({
        width: 0,
        height: 0,
        rgba: new Uint8ClampedArray(0),
      }),
    });
    expect(await decoder.decode(aCr3())).toBeNull();
  });

  it("honours a trimmed build's format list", async () => {
    // Builds are routinely trimmed to cut their size. Claiming formats it was
    // not compiled with would route files to a decoder that fails on them.
    const decoder = createLibRawDecoder({
      ...workingModule(),
      supportedFormats: ["cr3"],
    });
    expect(decoder.info.formats).toEqual(["cr3"]);
    expect(routeRaw(aDng(), [decoder.info]).kind).toBe("unsupported");
    expect(routeRaw(aCr3(), [decoder.info]).kind).toBe("decode");
  });

  it("takes an unlabelled build at its word for everything", () => {
    // A build that does not say what it kept cannot be second-guessed from
    // here, and assuming the minimum would make a full build useless.
    expect(
      createLibRawDecoder(workingModule()).info.formats.length,
    ).toBeGreaterThan(5);
  });
});

describe("routing between the two decoders", () => {
  const dngOnly = {
    id: "dng-ts",
    formats: ["dng"] as const,
    needsDownload: false,
    available: true,
  };

  it("keeps a DNG on the built-in decoder even with LibRaw loaded", async () => {
    // The reason `needsDownload` stays true after loading: a DNG should not be
    // sent through the heavy path just because it happens to be resident.
    const libraw = createLibRawDecoder(workingModule());
    const out = routeRaw(aDng(), [libraw.info, dngOnly]);
    expect(out.kind).toBe("decode");
    if (out.kind !== "decode") return;
    expect(out.decoder.id).toBe("dng-ts");
  });

  it("sends a vendor format to LibRaw", () => {
    const libraw = createLibRawDecoder(workingModule());
    const out = routeRaw(aCr3(), [dngOnly, libraw.info]);
    expect(out.kind).toBe("decode");
    if (out.kind !== "decode") return;
    expect(out.decoder.id).toBe("libraw-wasm");
  });
});
