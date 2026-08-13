/**
 * Recognising a raw file from its bytes.
 *
 * The extension is not evidence. Camera raw files are routinely renamed, and
 * several of these formats are TIFF underneath — a `.nef` and a `.dng` can have
 * byte-identical first eight bytes. Deciding which decoder to use from a
 * filename would send a DNG to a decoder that cannot read it and report the
 * wrong reason when it failed.
 *
 * So the container is read, and TIFF-based files are opened far enough to find
 * the two tags that actually settle it: `DNGVersion`, which is what makes a
 * file a DNG regardless of what the camera called it, and `Make`, which
 * separates the vendor TIFF variants from each other.
 */

export const RAW_FORMATS = [
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
] as const;
export type RawFormat = (typeof RAW_FORMATS)[number];

export interface RawIdentification {
  format: RawFormat;
  /** True when the file is a DNG, which every conforming decoder can read
   * without knowing the camera. Vendor formats need format-specific support. */
  isDng: boolean;
  /** Camera manufacturer as recorded in the file, when the container carries
   * it. Useful in an error message: "a Nikon NEF" beats "an unsupported file". */
  make?: string;
}

const TIFF_LE = [0x49, 0x49, 0x2a, 0x00];
const TIFF_BE = [0x4d, 0x4d, 0x00, 0x2a];

/** TIFF tag 0xC612. Its presence *is* the definition of a DNG. */
const TAG_DNG_VERSION = 0xc612;
const TAG_MAKE = 0x010f;

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((b, i) => bytes[i] === b);

const ascii = (bytes: Uint8Array, at: number, length: number): string => {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    const c = bytes[at + i];
    if (c === undefined || c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
};

class Reader {
  constructor(
    private readonly bytes: Uint8Array,
    private readonly littleEndian: boolean,
  ) {}

  u16(at: number): number {
    const a = this.bytes[at];
    const b = this.bytes[at + 1];
    if (a === undefined || b === undefined) return 0;
    return this.littleEndian ? a | (b << 8) : (a << 8) | b;
  }

  u32(at: number): number {
    const a = this.bytes[at];
    const b = this.bytes[at + 1];
    const c = this.bytes[at + 2];
    const d = this.bytes[at + 3];
    if (
      a === undefined ||
      b === undefined ||
      c === undefined ||
      d === undefined
    )
      return 0;
    return this.littleEndian
      ? (a | (b << 8) | (c << 16) | (d << 24)) >>> 0
      : ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  }
}

/**
 * Read IFD0's tags, stopping at the first sign the file is malformed.
 *
 * Deliberately shallow: this only needs two tags to route a file, and walking
 * the whole tree of a raw file to answer "which decoder" would be doing the
 * decoder's job before deciding whether to call it.
 */
function readIfd0(
  bytes: Uint8Array,
  littleEndian: boolean,
): { hasDngVersion: boolean; make?: string } {
  const r = new Reader(bytes, littleEndian);
  const ifdOffset = r.u32(4);
  // A plausible offset only; a corrupt one is treated as "not identifiable"
  // rather than followed into arbitrary memory.
  if (ifdOffset < 8 || ifdOffset + 2 > bytes.length)
    return { hasDngVersion: false };

  const count = r.u16(ifdOffset);
  // 12 bytes per entry. A count that cannot fit is a broken header.
  if (count === 0 || ifdOffset + 2 + count * 12 > bytes.length) {
    return { hasDngVersion: false };
  }

  let hasDngVersion = false;
  let make: string | undefined;

  for (let i = 0; i < count; i += 1) {
    const entry = ifdOffset + 2 + i * 12;
    const tag = r.u16(entry);
    if (tag === TAG_DNG_VERSION) hasDngVersion = true;
    if (tag === TAG_MAKE) {
      const length = r.u32(entry + 4);
      // Values of four bytes or fewer live in the entry itself; longer ones are
      // stored elsewhere and the entry holds an offset.
      const at = length <= 4 ? entry + 8 : r.u32(entry + 8);
      if (at + Math.min(length, 64) <= bytes.length) {
        make = ascii(bytes, at, Math.min(length, 64)).trim();
      }
    }
  }
  return { hasDngVersion, ...(make !== undefined ? { make } : {}) };
}

/** Vendor TIFF variants, keyed by what `Make` says. */
function tiffVendorFormat(make: string | undefined): RawFormat | null {
  const m = (make ?? "").toUpperCase();
  if (m.startsWith("NIKON")) return "nef";
  if (m.startsWith("SONY")) return "arw";
  if (m.startsWith("OLYMPUS") || m.startsWith("OM DIGITAL")) return "orf";
  if (m.startsWith("PANASONIC") || m.startsWith("LEICA")) return "rw2";
  if (m.startsWith("PENTAX") || m.startsWith("RICOH")) return "pef";
  if (m.startsWith("SAMSUNG")) return "srw";
  if (m.startsWith("CANON")) return "cr2";
  return null;
}

/**
 * Identify a raw file, or return null if it is not one this knows.
 *
 * Only the head of the file is needed — pass as much as is convenient; a few
 * kilobytes is plenty and avoids reading a 60MB file to answer a question about
 * its first few hundred bytes.
 */
export function sniffRaw(bytes: Uint8Array): RawIdentification | null {
  if (bytes.length < 16) return null;

  // Fujifilm: a plain ASCII signature, no TIFF header at the front.
  if (ascii(bytes, 0, 15) === "FUJIFILMCCD-RAW") {
    return { format: "raf", isDng: false, make: "FUJIFILM" };
  }

  // Canon CR3 is ISO base media, like MP4: a `ftyp` box with brand `crx `.
  if (ascii(bytes, 4, 4) === "ftyp" && ascii(bytes, 8, 4).startsWith("crx")) {
    return { format: "cr3", isDng: false, make: "Canon" };
  }

  const littleEndian = startsWith(bytes, TIFF_LE);
  const bigEndian = startsWith(bytes, TIFF_BE);

  // Panasonic RW2 and Olympus ORF use their own magic number in place of
  // TIFF's 42, so they are not caught by the check above.
  if (bytes[0] === 0x49 && bytes[1] === 0x49) {
    const magic = bytes[2]! | (bytes[3]! << 8);
    if (magic === 0x0055)
      return { format: "rw2", isDng: false, make: "Panasonic" };
    if (magic === 0x4f52 || magic === 0x5352) {
      return { format: "orf", isDng: false, make: "Olympus" };
    }
  }

  if (!littleEndian && !bigEndian) return null;

  // Canon CR2 marks itself in the header, before any IFD.
  if (littleEndian && ascii(bytes, 8, 2) === "CR") {
    return { format: "cr2", isDng: false, make: "Canon" };
  }

  const { hasDngVersion, make } = readIfd0(bytes, littleEndian);
  // DNGVersion wins over everything. A Nikon-made DNG is a DNG: it is readable
  // by any conforming decoder, and routing it by `Make` would send it to a NEF
  // path that cannot read it.
  if (hasDngVersion) {
    return { format: "dng", isDng: true, ...(make ? { make } : {}) };
  }

  const vendor = tiffVendorFormat(make);
  if (vendor)
    return { format: vendor, isDng: false, ...(make ? { make } : {}) };

  // A TIFF that is not a DNG and names no camera we recognise. It may still be
  // raw, but nothing here can say which kind, and guessing would produce a
  // confident wrong answer.
  return null;
}
