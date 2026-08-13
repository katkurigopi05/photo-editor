/**
 * Reading TIFF structure.
 *
 * DNG is TIFF, and so are most vendor raw formats, so this is the layer both
 * the sniffer and the DNG reader stand on. Kept separate because two copies of
 * a byte reader drift, and a drift here is silent: the file still parses, just
 * into different numbers.
 *
 * Every read is bounds-checked and returns a default rather than throwing. A
 * raw file is untrusted input — it may be truncated, it may be a different
 * format wearing a TIFF header, and it may be hostile. Nothing here should be
 * able to read past the buffer it was given.
 */

export const TIFF_LE_MAGIC = [0x49, 0x49, 0x2a, 0x00] as const;
export const TIFF_BE_MAGIC = [0x4d, 0x4d, 0x00, 0x2a] as const;

/** TIFF field types, by their on-disk code. Sizes are in bytes. */
const TYPE_SIZE: Readonly<Record<number, number>> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

export interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Where the value bytes live. Values of four bytes or fewer are stored in
   * the entry itself; longer ones are stored elsewhere and the entry holds an
   * offset. Resolved here so callers never have to care which. */
  valueOffset: number;
  /** False when the value would run past the end of the buffer. Such an entry
   * is readable as a tag but its value must not be trusted. */
  inBounds: boolean;
}

export class TiffReader {
  readonly littleEndian: boolean;

  private constructor(
    readonly bytes: Uint8Array,
    littleEndian: boolean,
  ) {
    this.littleEndian = littleEndian;
  }

  /** Open a buffer as TIFF, or null if it does not begin like one. */
  static open(bytes: Uint8Array): TiffReader | null {
    if (bytes.length < 8) return null;
    const le = TIFF_LE_MAGIC.every((b, i) => bytes[i] === b);
    const be = TIFF_BE_MAGIC.every((b, i) => bytes[i] === b);
    if (!le && !be) return null;
    return new TiffReader(bytes, le);
  }

  u8(at: number): number {
    return this.bytes[at] ?? 0;
  }

  u16(at: number): number {
    if (at < 0 || at + 2 > this.bytes.length) return 0;
    const a = this.bytes[at]!;
    const b = this.bytes[at + 1]!;
    return this.littleEndian ? a | (b << 8) : (a << 8) | b;
  }

  u32(at: number): number {
    if (at < 0 || at + 4 > this.bytes.length) return 0;
    const a = this.bytes[at]!;
    const b = this.bytes[at + 1]!;
    const c = this.bytes[at + 2]!;
    const d = this.bytes[at + 3]!;
    return this.littleEndian
      ? (a | (b << 8) | (c << 16) | (d << 24)) >>> 0
      : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  }

  ascii(at: number, length: number): string {
    let out = "";
    const end = Math.min(at + length, this.bytes.length);
    for (let i = at; i < end; i += 1) {
      const c = this.bytes[i]!;
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    return out;
  }

  /** Offset of the first IFD. */
  firstIfdOffset(): number {
    return this.u32(4);
  }

  /**
   * Read one IFD's entries.
   *
   * Returns an empty list for an offset or entry count that cannot fit, rather
   * than reading whatever happens to be there — a corrupt header should make a
   * file unreadable, not make it read as something else.
   */
  readIfd(offset: number): IfdEntry[] {
    if (offset < 8 || offset + 2 > this.bytes.length) return [];
    const count = this.u16(offset);
    if (count === 0 || offset + 2 + count * 12 + 4 > this.bytes.length) {
      return [];
    }

    const entries: IfdEntry[] = [];
    for (let i = 0; i < count; i += 1) {
      const at = offset + 2 + i * 12;
      const type = this.u16(at + 2);
      const n = this.u32(at + 4);
      const size = (TYPE_SIZE[type] ?? 0) * n;
      const inline = size > 0 && size <= 4;
      const valueOffset = inline ? at + 8 : this.u32(at + 8);
      entries.push({
        tag: this.u16(at),
        type,
        count: n,
        valueOffset,
        inBounds:
          size > 0 &&
          valueOffset >= 0 &&
          valueOffset + size <= this.bytes.length,
      });
    }
    return entries;
  }

  /** Offset of the IFD after this one, or 0 when there is none. */
  nextIfdOffset(offset: number): number {
    if (offset < 8 || offset + 2 > this.bytes.length) return 0;
    const count = this.u16(offset);
    const at = offset + 2 + count * 12;
    if (at + 4 > this.bytes.length) return 0;
    return this.u32(at);
  }

  /** One numeric value from an entry, by index. Zero when out of bounds or of
   * a type that is not a plain integer. */
  value(entry: IfdEntry, index = 0): number {
    if (!entry.inBounds || index >= entry.count) return 0;
    const size = TYPE_SIZE[entry.type] ?? 0;
    const at = entry.valueOffset + index * size;
    switch (entry.type) {
      case 1:
      case 2:
      case 6:
      case 7:
        return this.u8(at);
      case 3:
      case 8:
        return this.u16(at);
      case 4:
      case 9:
        return this.u32(at);
      case 5:
      case 10: {
        // A rational is two longs. Division by zero gives 0 rather than
        // Infinity, which would poison anything downstream that averages it.
        const denominator = this.u32(at + 4);
        return denominator === 0 ? 0 : this.u32(at) / denominator;
      }
      default:
        return 0;
    }
  }

  /** Every numeric value of an entry. */
  values(entry: IfdEntry): number[] {
    const out: number[] = [];
    for (let i = 0; i < entry.count; i += 1) out.push(this.value(entry, i));
    return out;
  }

  /** An entry's ASCII value, trimmed. */
  string(entry: IfdEntry): string {
    if (!entry.inBounds) return "";
    return this.ascii(entry.valueOffset, Math.min(entry.count, 128)).trim();
  }
}

/** Look one tag up in a list of entries. */
export const findTag = (
  entries: readonly IfdEntry[],
  tag: number,
): IfdEntry | undefined => entries.find((e) => e.tag === tag);
