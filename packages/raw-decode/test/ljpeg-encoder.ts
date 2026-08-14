/**
 * A lossless JPEG encoder, for tests only.
 *
 * The decoder has no real DNG to read, so the next best evidence is a stream
 * built here to the specification and read back. Shared between the decoder's
 * own tests and the DNG assembly tests, so both exercise the same stream shape
 * a camera would write.
 */
/** Bits, MSB first, with JPEG's 0xFF byte stuffing. */
class BitWriter {
  private readonly bytes: number[] = [];
  private current = 0;
  private filled = 0;

  write(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.current = (this.current << 1) | ((value >> i) & 1);
      this.filled += 1;
      if (this.filled === 8) this.flush();
    }
  }

  private flush(): void {
    this.bytes.push(this.current & 0xff);
    // A 0xFF in the data must be followed by 0x00, or it reads as a marker.
    if ((this.current & 0xff) === 0xff) this.bytes.push(0x00);
    this.current = 0;
    this.filled = 0;
  }

  finish(): number[] {
    if (this.filled > 0) {
      this.current <<= 8 - this.filled;
      this.filled = 8;
      this.flush();
    }
    return this.bytes;
  }
}

/**
 * A Huffman table giving all seventeen categories a five-bit code.
 *
 * Deliberately not an optimal table: 17 codes of one length is a valid
 * canonical prefix code, and the decoder must not care how good the compression
 * was. It also makes the encoded bits easy to work out by hand.
 */
export const FLAT_COUNTS = [0, 0, 0, 0, 17, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Bits needed to carry a difference, as T.81 categorises it. */
function category(difference: number): number {
  let bits = 0;
  let magnitude = Math.abs(difference);
  while (magnitude > 0) {
    bits += 1;
    magnitude >>= 1;
  }
  return bits;
}

interface EncodeOptions {
  width: number;
  height: number;
  components: number;
  precision: number;
  selector: number;
  samples: number[];
  restartInterval?: number;
  pointTransform?: number;
}

/** Encode a lossless JPEG the way a DNG writer would. */
export function encodeLosslessJpeg(options: EncodeOptions): Uint8Array {
  const {
    width,
    height,
    components,
    precision,
    selector,
    samples,
    restartInterval = 0,
    pointTransform = 0,
  } = options;
  const perRow = width * components;
  const seed = 1 << (precision - pointTransform - 1);

  const writer = new BitWriter();
  let sinceRestart = 0;
  let atRestart = true;
  const restarts: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      for (let c = 0; c < components; c += 1) {
        const index = y * perRow + x * components + c;
        const above = (y - 1) * perRow + x * components + c;
        const aboveLeft = (y - 1) * perRow + (x - 1) * components + c;

        let prediction: number;
        if (atRestart) prediction = seed;
        else if (y === 0) prediction = samples[index - components]!;
        else if (x === 0) prediction = samples[above]!;
        else {
          const left = samples[index - components]!;
          const up = samples[above]!;
          const corner = samples[aboveLeft]!;
          prediction =
            selector === 1
              ? left
              : selector === 2
                ? up
                : selector === 3
                  ? corner
                  : selector === 4
                    ? left + up - corner
                    : selector === 5
                      ? left + ((up - corner) >> 1)
                      : selector === 6
                        ? up + ((left - corner) >> 1)
                        : (left + up) >> 1;
        }
        // Wrapped into the 16-bit signed range, which is what makes the
        // arithmetic modular and lets a prediction of 32768 encode a sample
        // of 0 as a single difference.
        const raw = samples[index]! - prediction;
        const difference = ((raw + 32768) & 0xffff) - 32768;
        if (difference === -32768) {
          // T.81 gives category 16 a fixed meaning — a difference of 32768 —
          // and sends no value bits after it. Sending them anyway puts the
          // whole stream out of step from the first sample onward.
          writer.write(16, 5);
        } else {
          const bits = category(difference);
          writer.write(bits, 5);
          if (bits > 0) {
            const value =
              difference > 0 ? difference : difference + (1 << bits) - 1;
            writer.write(value, bits);
          }
        }
      }
      atRestart = false;

      sinceRestart += 1;
      if (restartInterval > 0 && sinceRestart === restartInterval) {
        restarts.push(writer.finish().length);
        sinceRestart = 0;
        atRestart = true;
      }
    }
  }

  const entropy = writer.finish();
  // Restart markers are inserted at the byte positions recorded above, from the
  // back so earlier positions stay valid.
  let index = 0;
  for (const position of [...restarts].reverse()) {
    const marker = 0xd0 + ((restarts.length - 1 - index) % 8);
    entropy.splice(position, 0, 0xff, marker);
    index += 1;
  }

  const out: number[] = [0xff, 0xd8];

  // DHT — one DC table, used by every component.
  const values = Array.from({ length: 17 }, (_, i) => i);
  const dhtLength = 2 + 1 + 16 + values.length;
  out.push(0xff, 0xc4, dhtLength >> 8, dhtLength & 0xff, 0x00);
  out.push(...FLAT_COUNTS, ...values);

  if (restartInterval > 0) {
    out.push(
      0xff,
      0xdd,
      0x00,
      0x04,
      restartInterval >> 8,
      restartInterval & 0xff,
    );
  }

  // SOF3 — the marker that makes this lossless rather than ordinary JPEG.
  const sofLength = 8 + components * 3;
  out.push(
    0xff,
    0xc3,
    sofLength >> 8,
    sofLength & 0xff,
    precision,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    components,
  );
  for (let c = 0; c < components; c += 1) out.push(c + 1, 0x11, 0x00);

  // SOS — every component reads from DC table 0.
  const sosLength = 6 + components * 2;
  out.push(0xff, 0xda, sosLength >> 8, sosLength & 0xff, components);
  for (let c = 0; c < components; c += 1) out.push(c + 1, 0x00);
  out.push(selector, 0x00, pointTransform & 0x0f);

  out.push(...entropy, 0xff, 0xd9);
  return Uint8Array.from(out);
}
