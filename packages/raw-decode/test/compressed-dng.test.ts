import { describe, expect, it } from "vitest";
import { readDng, DNG_COMPRESSION } from "../src/dng.js";
import { unpackImage, normaliseSamples } from "../src/unpack.js";
import {
  buildDng,
  cfaIfd,
  dngVersion,
  LONG,
  SHORT,
  type Tag,
} from "./dng-fixtures.js";
import { encodeLosslessJpeg } from "./ljpeg-encoder.js";

/**
 * A losslessly compressed DNG, read the whole way through.
 *
 * The pieces are already tested apart: `decodeLosslessJpeg` against streams
 * built to the specification, and `unpackImage` against synthetic layouts. What
 * nothing covered is a *file* — a real DNG structure whose compression tag says
 * lossless JPEG and whose strip holds an actual stream — going in one end and
 * coming out as the samples that were encoded.
 *
 * That gap is the reason this exists. The manual says losslessly compressed
 * DNGs open, which is the compression cameras actually write, and a claim about
 * whole files deserves a test on a whole file. Both halves could be right and
 * the join still wrong: `readDng` could report the file decodable while
 * `unpackImage` is handed a layout it silently declines, and the result is a
 * black frame from a valid photograph.
 */

const WIDTH = 8;
const HEIGHT = 6;
const BLACK = 1024;
const WHITE = 65535;

/** Sensor values with something to check in every position. */
function sensorSamples(): number[] {
  const out: number[] = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      out.push(BLACK + ((x * 2731 + y * 5119) % (WHITE - BLACK)));
    }
  }
  return out;
}

/**
 * Build a DNG whose single strip is a lossless JPEG stream.
 *
 * Two components, because that is how a DNG stores a Bayer row — alternating
 * colours go into separate prediction streams — so the frame is half the pixel
 * width of the image.
 */
function compressedDng(samples: number[]): Uint8Array {
  const stream = encodeLosslessJpeg({
    width: WIDTH / 2,
    height: HEIGHT,
    components: 2,
    precision: 16,
    selector: 1,
    samples,
  });

  const tags: Tag[] = cfaIfd(WIDTH, HEIGHT).map((tag) => {
    if (tag.tag === 0x0103) {
      return { ...tag, value: DNG_COMPRESSION.jpeg };
    }
    return tag;
  });

  // The strip payload replaces the uncompressed one the fixture builder writes.
  const withStrip: Tag[] = [
    ...tags.filter((tag) => tag.tag !== 0x0111 && tag.tag !== 0x0117),
    { tag: 0x0111, type: LONG, count: 1, data: [] },
    { tag: 0x0117, type: LONG, count: 1, value: stream.length },
    { tag: 0x0116, type: SHORT, count: 1, value: HEIGHT },
  ];

  return buildDng([dngVersion(), ...withStrip], [], stream);
}

describe("a losslessly compressed DNG", () => {
  const samples = sensorSamples();

  it("is reported as decodable, not refused", () => {
    const dng = readDng(compressedDng(samples));
    expect(dng).not.toBe(null);
    expect(dng!.raw.compression).toBe(DNG_COMPRESSION.jpeg);
    expect(dng!.decodable).toBe(true);
    expect(dng!.reason).toBeUndefined();
  });

  it("decodes to the samples that were encoded", () => {
    // The join. A wrong answer here is a black or scrambled frame from a file
    // the reader has just declared readable.
    const dng = readDng(compressedDng(samples));
    const out = unpackImage(compressedDng(samples), dng!.raw);
    expect(out).not.toBe(null);
    expect(out!.length).toBe(WIDTH * HEIGHT);
    expect([...out!]).toEqual(samples);
  });

  it("normalises to a picture with real variation, not a flat field", () => {
    // Guards the case where every sample decodes to the same value: the
    // equality check above would still pass on a constant image if the encoder
    // and decoder agreed on a constant, so this asserts the picture has range.
    const dng = readDng(compressedDng(samples));
    const out = unpackImage(compressedDng(samples), dng!.raw);
    const normalised = normaliseSamples(out!, dng!.raw);
    const min = Math.min(...normalised);
    const max = Math.max(...normalised);
    expect(max - min).toBeGreaterThan(0.5);
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
  });
});
