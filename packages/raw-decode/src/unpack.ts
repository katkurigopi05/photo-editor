import type { CfaColour, DngImageLayout } from "./dng.js";
import { DNG_COMPRESSION } from "./dng.js";
import { decodeLosslessJpeg } from "./ljpeg.js";

/**
 * Turning a DNG's sample bytes into sensor values, and those into normalised
 * light.
 *
 * Two things here are easy to get subtly wrong, and both produce a picture that
 * looks like a photograph while being wrong:
 *
 * **Bit packing.** A 14-bit sensor writes fourteen bits per sample with no
 * padding, so samples straddle byte boundaries and the seventh sample of a row
 * begins mid-byte. Bits are most-significant-first, which is the opposite of
 * the little-endian byte order the file's integers use — reading them the other
 * way round gives plausible values in the right range.
 *
 * **Row padding.** Each row of a TIFF strip restarts on a byte boundary. A
 * 14-bit row of 6000 samples occupies 10500 bytes exactly, but an odd width
 * would leave a part-used byte that belongs to no sample. Packing rows
 * continuously instead shears the image progressively — invisible at the top,
 * obvious at the bottom, and easy to mistake for a lens problem.
 */

/** Bit depths this can unpack. */
export const SUPPORTED_BIT_DEPTHS = [8, 10, 12, 14, 16] as const;

/** Bytes one row of packed samples occupies, including its padding to a byte
 * boundary. */
export const rowBytes = (width: number, bitsPerSample: number): number =>
  Math.ceil((width * bitsPerSample) / 8);

/**
 * Read `width × height` samples from `bytes`, starting at `offset`.
 *
 * Returns 16-bit values regardless of the source depth, so callers have one
 * shape to handle. Anything the buffer cannot supply reads as 0 rather than
 * throwing — a truncated file should give a short picture, not an exception
 * halfway through a decode.
 */
export function unpackRows(
  bytes: Uint8Array,
  offset: number,
  width: number,
  height: number,
  bitsPerSample: number,
): Uint16Array {
  const out = new Uint16Array(width * height);
  if (width <= 0 || height <= 0) return out;

  const stride = rowBytes(width, bitsPerSample);
  const mask = (1 << bitsPerSample) - 1;

  for (let y = 0; y < height; y += 1) {
    // Each row restarts on a byte boundary — the bit cursor is reset per row,
    // not carried across.
    const rowStart = offset + y * stride;
    let bitCursor = 0;

    for (let x = 0; x < width; x += 1) {
      let value = 0;
      let remaining = bitsPerSample;

      while (remaining > 0) {
        const byteAt = rowStart + (bitCursor >> 3);
        const bitInByte = bitCursor & 7;
        const available = 8 - bitInByte;
        const take = Math.min(available, remaining);

        const byte = byteAt < bytes.length ? bytes[byteAt]! : 0;
        // Most-significant bits first: take the top `take` bits of what is left
        // in this byte.
        const chunk = (byte >> (available - take)) & ((1 << take) - 1);
        value = (value << take) | chunk;

        bitCursor += take;
        remaining -= take;
      }
      out[y * width + x] = value & mask;
    }
  }
  return out;
}

/**
 * The CFA colour at a sensor position.
 *
 * The pattern repeats across the sensor, so this is a lookup by position within
 * the repeat. Getting the phase wrong swaps red and blue over the whole frame,
 * which looks like a white-balance fault rather than a bug here.
 */
export function cfaColourAt(
  layout: Pick<DngImageLayout, "cfaPattern" | "cfaRepeat">,
  x: number,
  y: number,
): CfaColour {
  const { cols, rows } = layout.cfaRepeat;
  if (layout.cfaPattern.length === 0 || cols <= 0 || rows <= 0) return "G";
  const index = (y % rows) * cols + (x % cols);
  return layout.cfaPattern[index] ?? "G";
}

/**
 * Map raw sensor values onto 0..1 by their black and white levels.
 *
 * The black level is the reading a sensor gives in darkness — it is not zero,
 * and subtracting it is what makes black look black rather than lifted grey.
 * Where a DNG gives four black levels, one per CFA site, they are applied per
 * position: sensors do differ between colours, and averaging them leaves a
 * faint colour cast in the shadows.
 *
 * Values below black clamp to 0 rather than going negative. Noise genuinely
 * takes readings under the black level, and a negative here would survive into
 * the demosaic and appear as coloured speckle in the shadows.
 */
export function normaliseSamples(
  samples: Uint16Array,
  layout: Pick<
    DngImageLayout,
    | "width"
    | "height"
    | "blackLevel"
    | "whiteLevel"
    | "cfaPattern"
    | "cfaRepeat"
  >,
): Float32Array {
  const out = new Float32Array(samples.length);
  const { width, height, blackLevel, whiteLevel } = layout;
  const perSite = blackLevel.length > 1;
  const { cols, rows } = layout.cfaRepeat;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (i >= samples.length) break;
      const black = perSite
        ? (blackLevel[(y % rows) * cols + (x % cols)] ?? blackLevel[0] ?? 0)
        : (blackLevel[0] ?? 0);
      const span = whiteLevel - black;
      // A white level at or below black is a broken file. Zero output beats
      // dividing by zero and filling the frame with Infinity.
      if (span <= 0) {
        out[i] = 0;
        continue;
      }
      const v = (samples[i]! - black) / span;
      out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

/**
 * Turn one stored block — a strip or a tile — into samples.
 *
 * Uncompressed blocks are bit-unpacked; lossless-JPEG blocks are decoded. Both
 * produce `width * rows` samples, so the assembly below does not care which the
 * file used, which is the same reason strips and tiles are unified there.
 *
 * A block that fails to decode returns null rather than throwing. One
 * unreadable tile in a photograph should cost that tile — the caller leaves it
 * black — not the whole import.
 */
function decodeBlock(
  bytes: Uint8Array,
  offset: number,
  byteCount: number,
  width: number,
  rows: number,
  layout: DngImageLayout,
): Uint16Array | null {
  if (layout.compression === DNG_COMPRESSION.none) {
    return unpackRows(bytes, offset, width, rows, layout.bitsPerSample);
  }

  // Bounded by the stored byte count, so a decoder that loses synchronisation
  // cannot wander into the next tile and produce plausible nonsense.
  const end =
    byteCount > 0 ? Math.min(bytes.length, offset + byteCount) : bytes.length;
  const frame = decodeLosslessJpeg(bytes.subarray(offset, end));
  if (frame === null) return null;

  const decoded = frame.width * frame.components;
  if (decoded !== width) return null;
  const wanted = width * rows;
  if (frame.samples.length < wanted) {
    // A frame shorter than the block it describes: keep what arrived rather
    // than discarding a mostly-good tile.
    const padded = new Uint16Array(wanted);
    padded.set(
      frame.samples.subarray(0, Math.min(frame.samples.length, wanted)),
    );
    return padded;
  }
  return frame.samples.subarray(0, wanted);
}

/**
 * Read every sample of a CFA image.
 *
 * Strips and tiles are alternative layouts and DNG uses one or the other. Both
 * are assembled into a single row-major buffer here, so nothing downstream has
 * to know which the file used — nor whether the blocks were stored plain or
 * losslessly compressed.
 */
export function unpackImage(
  bytes: Uint8Array,
  layout: DngImageLayout,
): Uint16Array | null {
  const { width, height, bitsPerSample } = layout;
  if (width <= 0 || height <= 0) return null;
  if (!SUPPORTED_BIT_DEPTHS.includes(bitsPerSample as 8 | 12 | 14 | 16)) {
    return null;
  }

  const out = new Uint16Array(width * height);

  if (layout.tiles) {
    const { offsets, byteCounts, width: tw, height: th } = layout.tiles;
    if (tw <= 0 || th <= 0) return null;
    const across = Math.ceil(width / tw);

    offsets.forEach((offset, index) => {
      const tileX = (index % across) * tw;
      const tileY = Math.floor(index / across) * th;
      // Tiles are whole even at the edges: a tile past the image boundary is
      // padded by the encoder, so the full tile is read and the surplus
      // discarded when copying.
      const tile = decodeBlock(
        bytes,
        offset,
        byteCounts[index] ?? 0,
        tw,
        th,
        layout,
      );
      // One unreadable tile leaves a black square; the rest of the photograph
      // still arrives.
      if (tile === null) return;
      for (let y = 0; y < th; y += 1) {
        const destY = tileY + y;
        if (destY >= height) break;
        for (let x = 0; x < tw; x += 1) {
          const destX = tileX + x;
          if (destX >= width) break;
          out[destY * width + destX] = tile[y * tw + x]!;
        }
      }
    });
    return out;
  }

  const strips = layout.strips;
  if (!strips) return null;
  const perStrip = strips.rowsPerStrip > 0 ? strips.rowsPerStrip : height;

  strips.offsets.forEach((offset, index) => {
    const firstRow = index * perStrip;
    if (firstRow >= height) return;
    // The last strip is usually short; reading a full one would run past the
    // image and, on a tight buffer, past the file.
    const rowsHere = Math.min(perStrip, height - firstRow);
    const strip = decodeBlock(
      bytes,
      offset,
      strips.byteCounts[index] ?? 0,
      width,
      rowsHere,
      layout,
    );
    if (strip === null) return;
    out.set(strip.subarray(0, rowsHere * width), firstRow * width);
  });

  return out;
}
