import { describe, expect, it } from "vitest";
import { decodeLosslessJpeg } from "../src/ljpeg.js";
import { encodeLosslessJpeg, FLAT_COUNTS } from "./ljpeg-encoder.js";

/**
 * Lossless JPEG decoding.
 *
 * There is no committed DNG to test against — a real one is megabytes and its
 * licence is somebody else's — so most of these encode a known image and read
 * it back. That catches a great deal, but it cannot catch a mistake I make
 * identically in both directions, so the first test decodes a stream whose
 * bytes are written out and reasoned about by hand. If the encoder and decoder
 * ever agree on something wrong, that one still fails.
 */

describe("decodeLosslessJpeg, against bytes written by hand", () => {
  it("decodes a stream whose every bit is accounted for", () => {
    // One row, one component, 8-bit, predictor 1. Three samples: 128, 130, 129.
    //
    //   sample 0: no neighbour, so predicted 2^(8-0-1) = 128. difference 0.
    //             category 0 → the five bits 00000, and no value bits.
    //   sample 1: predicted from the left, 128. difference +2.
    //             category 2 → 00010, then the two bits 10.
    //   sample 2: predicted from the left, 130. difference -1.
    //             category 1 → 00001, then -1 + 2 - 1 = 0, one bit 0.
    //
    // Concatenated: 00000 00010 10 00001 0 → 0000000010100000 10 padded with
    // ones is not what a writer emits; zeros are, giving 0x00 0xA0 0x40.
    const entropy = [0b00000000, 0b10100000, 0b10000000];
    const values = Array.from({ length: 17 }, (_, i) => i);
    const bytes = Uint8Array.from([
      0xff,
      0xd8,
      0xff,
      0xc4,
      0x00,
      0x24,
      0x00,
      ...FLAT_COUNTS,
      ...values,
      0xff,
      0xc3,
      0x00,
      0x0b,
      8,
      0x00,
      0x01,
      0x00,
      0x03,
      1,
      1,
      0x11,
      0x00,
      0xff,
      0xda,
      0x00,
      0x08,
      1,
      1,
      0x00,
      1,
      0x00,
      0x00,
      ...entropy,
      0xff,
      0xd9,
    ]);

    const out = decodeLosslessJpeg(bytes);
    expect(out).not.toBe(null);
    expect(out!.width).toBe(3);
    expect(out!.height).toBe(1);
    expect(out!.components).toBe(1);
    expect([...out!.samples]).toEqual([128, 130, 129]);
  });
});

describe("decodeLosslessJpeg, round-tripping", () => {
  const image = (width: number, height: number, components: number): number[] =>
    Array.from(
      { length: width * height * components },
      (_, i) => (i * 37 + ((i * i) % 101)) % 4096,
    );

  it("reads back a single-component image", () => {
    const samples = image(8, 6, 1);
    const out = decodeLosslessJpeg(
      encodeLosslessJpeg({
        width: 8,
        height: 6,
        components: 1,
        precision: 16,
        selector: 1,
        samples,
      }),
    );
    expect([...out!.samples]).toEqual(samples);
  });

  it("reads back two components, which is how a DNG stores a Bayer row", () => {
    // The case that matters: two components exist so alternating sensor
    // colours are predicted separately. Interleaving them wrongly on output
    // swaps red and green across the whole frame.
    const samples = image(16, 8, 2);
    const out = decodeLosslessJpeg(
      encodeLosslessJpeg({
        width: 16,
        height: 8,
        components: 2,
        precision: 16,
        selector: 1,
        samples,
      }),
    );
    expect(out!.components).toBe(2);
    expect([...out!.samples]).toEqual(samples);
  });

  it("handles every predictor the standard defines", () => {
    for (const selector of [1, 2, 3, 4, 5, 6, 7]) {
      const samples = image(9, 7, 1);
      const out = decodeLosslessJpeg(
        encodeLosslessJpeg({
          width: 9,
          height: 7,
          components: 1,
          precision: 16,
          selector,
          samples,
        }),
      );
      expect([...out!.samples], `predictor ${selector}`).toEqual(samples);
    }
  });

  it("handles 12-, 14- and 16-bit precision", () => {
    for (const precision of [12, 14, 16]) {
      const limit = (1 << precision) - 1;
      const samples = image(8, 4, 1).map((v) => v % limit);
      const out = decodeLosslessJpeg(
        encodeLosslessJpeg({
          width: 8,
          height: 4,
          components: 1,
          precision,
          selector: 1,
          samples,
        }),
      );
      expect([...out!.samples], `precision ${precision}`).toEqual(samples);
    }
  });

  it("resynchronises at restart intervals", () => {
    // Restart markers let a decoder recover from a corrupt tile. They also
    // reset the predictor, so a decoder that skips the marker but keeps
    // predicting produces an image that is correct until the first restart.
    const samples = image(12, 5, 1);
    const out = decodeLosslessJpeg(
      encodeLosslessJpeg({
        width: 12,
        height: 5,
        components: 1,
        precision: 16,
        selector: 1,
        samples,
        restartInterval: 6,
      }),
    );
    expect([...out!.samples]).toEqual(samples);
  });

  it("survives a stream cut short instead of running away", () => {
    // A truncated tile should cost that tile, not the photograph.
    const full = encodeLosslessJpeg({
      width: 8,
      height: 8,
      components: 1,
      precision: 16,
      selector: 1,
      samples: image(8, 8, 1),
    });
    const out = decodeLosslessJpeg(full.subarray(0, full.length - 20));
    expect(out).not.toBe(null);
    expect(out!.samples.length).toBe(64);
  });
});

describe("decodeLosslessJpeg, refusing what it cannot read", () => {
  it("returns null for bytes that are not JPEG at all", () => {
    expect(decodeLosslessJpeg(Uint8Array.from([1, 2, 3, 4]))).toBe(null);
  });

  it("returns null for a baseline JPEG rather than misreading it", () => {
    // SOF0 is the ordinary DCT frame. Treating it as lossless would produce a
    // plausible-looking field of noise from a perfectly valid file.
    const bytes = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 8, 0x00, 0x01, 0x00, 0x01, 1, 1, 0x11,
      0x00, 0xff, 0xd9,
    ]);
    expect(decodeLosslessJpeg(bytes)).toBe(null);
  });

  it("returns null when the scan names a Huffman table that was never sent", () => {
    const bytes = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc3, 0x00, 0x0b, 8, 0x00, 0x01, 0x00, 0x01, 1, 1, 0x11,
      0x00, 0xff, 0xda, 0x00, 0x08, 1, 1, 0x30, 1, 0x00, 0x00, 0xff, 0xd9,
    ]);
    expect(decodeLosslessJpeg(bytes)).toBe(null);
  });
});
