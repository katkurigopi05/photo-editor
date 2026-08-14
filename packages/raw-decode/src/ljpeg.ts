/**
 * Lossless JPEG — the compression nearly every real DNG uses.
 *
 * This is ITU T.81 Annex H, and it shares almost nothing with the JPEG people
 * mean when they say JPEG. There is no DCT, no quantisation and no colour
 * transform: each sample is predicted from its already-decoded neighbours, and
 * only the prediction error is Huffman-coded. That is why it is lossless, and
 * why a browser's built-in JPEG decoder cannot read it — `createImageBitmap`
 * rejects an SOF3 frame outright, so this has to be written out.
 *
 * The awkward part is what the "components" mean. A DNG does not store a
 * colour image here; it stores undemosaiced sensor samples, and it usually
 * declares **two** components so that a Bayer row's alternating colours end up
 * in separate prediction streams. Predicting a red site from the green site
 * beside it would produce a large error on every sample and compress worse than
 * storing the raw values. So component `c` at column `x` is the sensor sample
 * at column `x * Nf + c`, and the decoder interleaves them back on output.
 *
 * Written from the specification rather than adapted from an existing decoder:
 * the reference implementations are GPL, and the format is small enough that
 * reimplementing is cheaper than the licence question.
 */

/** Markers used by a lossless frame. Everything else is skipped by length. */
const MARKER = {
  SOI: 0xd8,
  EOI: 0xd9,
  SOS: 0xda,
  DHT: 0xc4,
  DRI: 0xdd,
  SOF3: 0xc3,
} as const;

const isRestart = (marker: number): boolean => marker >= 0xd0 && marker <= 0xd7;

export interface LosslessJpeg {
  /** Samples per line, per component — not the pixel width of the tile. */
  width: number;
  height: number;
  components: number;
  precision: number;
  /** `width * components * height` samples, interleaved by component. */
  samples: Uint16Array;
}

interface HuffmanTable {
  /** Smallest code of each length, indexed 1–16. */
  minCode: Int32Array;
  /** Largest code of each length, or -1 when no code has that length. */
  maxCode: Int32Array;
  /** Index into `values` of the first symbol of each length. */
  valuePointer: Int32Array;
  values: Uint8Array;
}

/**
 * Build the decode tables from a DHT segment's counts and symbols.
 *
 * The canonical form in T.81 F.2.2.3: codes are assigned in increasing length,
 * so a code can be recognised by reading bits until the accumulated value falls
 * within the range for that length. No lookup table is built — the tables here
 * are per tile, not per image, and a DNG has thousands of tiles.
 */
function buildHuffman(counts: Uint8Array, values: Uint8Array): HuffmanTable {
  const minCode = new Int32Array(17);
  const maxCode = new Int32Array(18).fill(-1);
  const valuePointer = new Int32Array(17);

  let code = 0;
  let index = 0;
  for (let length = 1; length <= 16; length += 1) {
    const count = counts[length - 1]!;
    valuePointer[length] = index;
    minCode[length] = code;
    index += count;
    code += count;
    maxCode[length] = count === 0 ? -1 : code - 1;
    code <<= 1;
  }
  return { minCode, maxCode, valuePointer, values };
}

/**
 * Bit reader over entropy-coded data.
 *
 * Two rules make this different from an ordinary bit reader. A 0xFF byte is
 * stuffed with a following 0x00 when it is data, so `FF 00` reads as one 0xFF;
 * and a 0xFF followed by anything else is a marker, which ends the data. Past
 * the end the reader returns zero bits rather than throwing, because a truncated
 * tile should produce a dark tile and not lose the rest of the photograph.
 */
class BitReader {
  private bits = 0;
  private count = 0;
  hitMarker = false;

  constructor(
    private readonly bytes: Uint8Array,
    private at: number,
  ) {}

  /** Read one bit, MSB first. */
  private bit(): number {
    if (this.count === 0) {
      if (this.at >= this.bytes.length) {
        this.hitMarker = true;
        return 0;
      }
      let byte = this.bytes[this.at++]!;
      if (byte === 0xff) {
        const next = this.bytes[this.at] ?? 0xd9;
        if (next === 0x00) {
          this.at += 1;
        } else {
          // A real marker: stop consuming and feed zeros.
          this.hitMarker = true;
          this.at -= 1;
          byte = 0;
          return 0;
        }
      }
      this.bits = byte;
      this.count = 8;
    }
    this.count -= 1;
    return (this.bits >> this.count) & 1;
  }

  receive(length: number): number {
    let value = 0;
    for (let i = 0; i < length; i += 1) value = (value << 1) | this.bit();
    return value;
  }

  decode(table: HuffmanTable): number {
    let code = this.bit();
    let length = 1;
    while (length <= 16) {
      if (table.maxCode[length]! >= 0 && code <= table.maxCode[length]!) {
        const index =
          table.valuePointer[length]! + (code - table.minCode[length]!);
        return table.values[index] ?? 0;
      }
      code = (code << 1) | this.bit();
      length += 1;
    }
    // A code longer than 16 bits cannot exist in a valid stream.
    return 0;
  }

  /** Skip to the next byte boundary and past a restart marker, as a restart
   * interval requires. */
  restart(): void {
    this.count = 0;
    while (this.at + 1 < this.bytes.length) {
      if (this.bytes[this.at] === 0xff && isRestart(this.bytes[this.at + 1]!)) {
        this.at += 2;
        this.hitMarker = false;
        return;
      }
      this.at += 1;
    }
    this.hitMarker = true;
  }
}

/** Sign-extend a Huffman-coded difference of `length` bits. */
function extend(value: number, length: number): number {
  return value < 1 << (length - 1) ? value - (1 << length) + 1 : value;
}

/**
 * Predict a sample from its neighbours.
 *
 * `left`, `above` and `aboveLeft` are T.81's Ra, Rb and Rc. The seven selectors
 * are all defined by the standard; DNG writers in practice use 1 and, for the
 * first row of a tile, fall back to the row-start rules below.
 */
function predict(
  selector: number,
  left: number,
  above: number,
  aboveLeft: number,
): number {
  switch (selector) {
    case 1:
      return left;
    case 2:
      return above;
    case 3:
      return aboveLeft;
    case 4:
      return left + above - aboveLeft;
    case 5:
      return left + ((above - aboveLeft) >> 1);
    case 6:
      return above + ((left - aboveLeft) >> 1);
    case 7:
      return (left + above) >> 1;
    default:
      // 0 is only legal in a differential frame, which a DNG never contains.
      return left;
  }
}

/**
 * Decode one lossless JPEG stream.
 *
 * Returns null when the bytes are not a lossless frame — a lossy JPEG preview
 * stored in the same file, say. Callers treat that as "this tile cannot be
 * read" rather than as corruption, because both occur in valid files.
 */
export function decodeLosslessJpeg(
  bytes: Uint8Array,
  start = 0,
): LosslessJpeg | null {
  let at = start;
  if (bytes[at] !== 0xff || bytes[at + 1] !== MARKER.SOI) return null;
  at += 2;

  const huffman = new Map<number, HuffmanTable>();
  let precision = 0;
  let width = 0;
  let height = 0;
  let componentIds: number[] = [];
  let restartInterval = 0;

  while (at + 3 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1;
      continue;
    }
    const marker = bytes[at + 1]!;
    at += 2;
    if (marker === MARKER.EOI) return null;
    if (isRestart(marker) || marker === 0x01 || marker === 0xff) continue;

    const length = (bytes[at]! << 8) | bytes[at + 1]!;
    const segment = at + 2;
    const segmentEnd = at + length;

    if (marker === MARKER.SOF3) {
      precision = bytes[segment]!;
      height = (bytes[segment + 1]! << 8) | bytes[segment + 2]!;
      width = (bytes[segment + 3]! << 8) | bytes[segment + 4]!;
      const count = bytes[segment + 5]!;
      componentIds = [];
      for (let i = 0; i < count; i += 1) {
        componentIds.push(bytes[segment + 6 + i * 3]!);
      }
    } else if (marker === MARKER.DHT) {
      let p = segment;
      while (p < segmentEnd) {
        const id = bytes[p]!;
        const counts = bytes.subarray(p + 1, p + 17);
        let total = 0;
        for (const c of counts) total += c;
        const values = bytes.subarray(p + 17, p + 17 + total);
        // Only DC (class 0) tables exist in a lossless frame; the class bits
        // are kept in the key so a stray AC table cannot shadow a DC one.
        huffman.set(id, buildHuffman(counts, values));
        p += 17 + total;
      }
    } else if (marker === MARKER.DRI) {
      restartInterval = (bytes[segment]! << 8) | bytes[segment + 1]!;
    } else if (marker === MARKER.SOS) {
      const scanCount = bytes[segment]!;
      const tables: HuffmanTable[] = [];
      for (let i = 0; i < scanCount; i += 1) {
        const tableId = bytes[segment + 2 + i * 2]!;
        // High nibble selects the DC table; the low nibble is the AC table and
        // is meaningless here.
        const table = huffman.get(tableId >> 4);
        if (table === undefined) return null;
        tables.push(table);
      }
      const selector = bytes[segmentEnd - 3]!;
      const pointTransform = bytes[segmentEnd - 1]! & 0x0f;

      if (width <= 0 || height <= 0 || componentIds.length === 0) return null;
      if (scanCount !== componentIds.length) return null;

      return decodeScan(bytes, segmentEnd, tables, {
        width,
        height,
        precision,
        selector,
        pointTransform,
        restartInterval,
      });
    }
    at = segmentEnd;
  }
  return null;
}

interface ScanParameters {
  width: number;
  height: number;
  precision: number;
  selector: number;
  pointTransform: number;
  restartInterval: number;
}

function decodeScan(
  bytes: Uint8Array,
  start: number,
  tables: HuffmanTable[],
  p: ScanParameters,
): LosslessJpeg {
  const components = tables.length;
  const perRow = p.width * components;
  const samples = new Uint16Array(perRow * p.height);
  const reader = new BitReader(bytes, start);

  // The value every prediction starts from, before any neighbour exists.
  const seed = 1 << (p.precision - p.pointTransform - 1);
  let sinceRestart = 0;
  let atRestart = true;

  for (let y = 0; y < p.height; y += 1) {
    const row = y * perRow;
    const previous = row - perRow;
    for (let x = 0; x < p.width; x += 1) {
      for (let c = 0; c < components; c += 1) {
        const index = row + x * components + c;

        let prediction: number;
        if (atRestart) {
          // First sample of the image, or the first after a restart marker.
          // Every component starts here, not just the first: each carries its
          // own predictor, and component 1 has no left neighbour either.
          prediction = seed;
        } else if (y === 0) {
          prediction = samples[index - components]!;
        } else if (x === 0) {
          prediction = samples[previous + c]!;
        } else {
          prediction = predict(
            p.selector,
            samples[index - components]!,
            samples[previous + x * components + c]!,
            samples[previous + (x - 1) * components + c]!,
          );
        }
        const length = reader.decode(tables[c]!);
        let difference: number;
        if (length === 0) {
          difference = 0;
        } else if (length === 16) {
          // T.81 gives SSSS=16 a fixed difference rather than 16 extra bits.
          difference = 32768;
        } else {
          difference = extend(reader.receive(length), length);
        }

        samples[index] = (prediction + difference) & 0xffff;
      }
      // Cleared per sample position rather than per component, so every
      // component of the first position predicts from the seed.
      atRestart = false;

      sinceRestart += 1;
      if (p.restartInterval > 0 && sinceRestart === p.restartInterval) {
        reader.restart();
        sinceRestart = 0;
        atRestart = true;
      }
    }
  }

  if (p.pointTransform > 0) {
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] = (samples[i]! << p.pointTransform) & 0xffff;
    }
  }

  return {
    width: p.width,
    height: p.height,
    components,
    precision: p.precision,
    samples,
  };
}
