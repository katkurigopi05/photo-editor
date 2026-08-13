import { TiffReader, findTag, type IfdEntry } from "./tiff.js";

/**
 * Reading a DNG's structure: what the sensor data is and where it lives.
 *
 * This stops short of decoding pixels on purpose. Everything here is testable
 * against files built to the specification, and every later stage — unpacking,
 * demosaicing, colour — depends on getting these numbers right. A wrong black
 * level or a mistaken CFA phase produces a picture that looks *plausible* and is
 * wrong, which is the worst kind of bug to find later.
 *
 * The one structural thing worth knowing about DNG: **IFD0 is usually not the
 * photograph.** It is normally a small preview, with the full-resolution sensor
 * data in a SubIFD. A reader that trusts IFD0 gets a thumbnail and reports its
 * dimensions confidently.
 */

const TAG_IMAGE_WIDTH = 0x0100;
const TAG_IMAGE_LENGTH = 0x0101;
const TAG_BITS_PER_SAMPLE = 0x0102;
const TAG_COMPRESSION = 0x0103;
const TAG_PHOTOMETRIC = 0x0106;
const TAG_STRIP_OFFSETS = 0x0111;
const TAG_SAMPLES_PER_PIXEL = 0x0115;
const TAG_ROWS_PER_STRIP = 0x0116;
const TAG_STRIP_BYTE_COUNTS = 0x0117;
const TAG_SUB_IFDS = 0x014a;
const TAG_TILE_WIDTH = 0x0142;
const TAG_TILE_LENGTH = 0x0143;
const TAG_TILE_OFFSETS = 0x0144;
const TAG_TILE_BYTE_COUNTS = 0x0145;
const TAG_CFA_REPEAT = 0x828d;
const TAG_CFA_PATTERN = 0x828e;
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DNG_VERSION = 0xc612;
const TAG_BLACK_LEVEL = 0xc61a;
const TAG_WHITE_LEVEL = 0xc61d;

/** PhotometricInterpretation 32803: the samples are a colour-filter array, i.e.
 * undemosaiced sensor data. This is what makes an IFD the raw one. */
const PHOTOMETRIC_CFA = 32803;

export const DNG_COMPRESSION = {
  none: 1,
  lzw: 5,
  jpeg: 7,
  deflate: 8,
  packBits: 32773,
  lossyJpeg: 34892,
} as const;

/** Colour of one sensor site. DNG stores 0=red, 1=green, 2=blue. */
export type CfaColour = "R" | "G" | "B";

export interface DngImageLayout {
  width: number;
  height: number;
  bitsPerSample: number;
  samplesPerPixel: number;
  compression: number;
  /** Row-major CFA pattern, e.g. ["R","G","G","B"] for a 2×2 RGGB sensor.
   * Empty when the IFD is not a CFA image. */
  cfaPattern: CfaColour[];
  cfaRepeat: { cols: number; rows: number };
  /** Per-channel black level, or a single value applied to all. */
  blackLevel: number[];
  whiteLevel: number;
  /** Where the sample data sits. Strips and tiles are alternative layouts and
   * exactly one is used. */
  strips?: { offsets: number[]; byteCounts: number[]; rowsPerStrip: number };
  tiles?: {
    offsets: number[];
    byteCounts: number[];
    width: number;
    height: number;
  };
}

export interface DngMetadata {
  make?: string;
  model?: string;
  /** DNGVersion as four bytes, e.g. [1,4,0,0]. */
  version: number[];
  /** The full-resolution CFA image. */
  raw: DngImageLayout;
  /** True when this build can turn `raw` into pixels today. Reported rather
   * than assumed, because most DNGs in the wild are losslessly compressed and
   * that decoder is not written yet. */
  decodable: boolean;
  /** Present when `decodable` is false: what is in the way, in words. */
  reason?: string;
}

const cfaColour = (code: number): CfaColour =>
  code === 0 ? "R" : code === 2 ? "B" : "G";

function readLayout(r: TiffReader, entries: IfdEntry[]): DngImageLayout {
  const num = (tag: number, fallback: number): number => {
    const e = findTag(entries, tag);
    return e ? r.value(e) : fallback;
  };

  const photometric = num(TAG_PHOTOMETRIC, 0);
  const cfaEntry = findTag(entries, TAG_CFA_PATTERN);
  const repeatEntry = findTag(entries, TAG_CFA_REPEAT);
  const repeat = repeatEntry
    ? { cols: r.value(repeatEntry, 0), rows: r.value(repeatEntry, 1) }
    : { cols: 2, rows: 2 };

  const blackEntry = findTag(entries, TAG_BLACK_LEVEL);
  const stripOffsets = findTag(entries, TAG_STRIP_OFFSETS);
  const stripCounts = findTag(entries, TAG_STRIP_BYTE_COUNTS);
  const tileOffsets = findTag(entries, TAG_TILE_OFFSETS);
  const tileCounts = findTag(entries, TAG_TILE_BYTE_COUNTS);

  const layout: DngImageLayout = {
    width: num(TAG_IMAGE_WIDTH, 0),
    height: num(TAG_IMAGE_LENGTH, 0),
    bitsPerSample: num(TAG_BITS_PER_SAMPLE, 16),
    samplesPerPixel: num(TAG_SAMPLES_PER_PIXEL, 1),
    compression: num(TAG_COMPRESSION, DNG_COMPRESSION.none),
    cfaPattern:
      photometric === PHOTOMETRIC_CFA && cfaEntry
        ? r.values(cfaEntry).map(cfaColour)
        : [],
    cfaRepeat: {
      cols: repeat.cols > 0 ? repeat.cols : 2,
      rows: repeat.rows > 0 ? repeat.rows : 2,
    },
    // A single black level applies to every channel; four means one per CFA
    // site, which is how a sensor with different per-colour pedestals is
    // described. Both are kept as an array so callers need one code path.
    blackLevel: blackEntry ? r.values(blackEntry) : [0],
    // 0 would make every later division by (white - black) blow up, so an
    // absent or nonsensical white level falls back to the bit depth's maximum.
    whiteLevel: 0,
  };

  const whiteEntry = findTag(entries, TAG_WHITE_LEVEL);
  const white = whiteEntry ? r.value(whiteEntry) : 0;
  layout.whiteLevel =
    white > 0 ? white : (1 << Math.min(layout.bitsPerSample, 30)) - 1;

  if (tileOffsets && tileCounts) {
    layout.tiles = {
      offsets: r.values(tileOffsets),
      byteCounts: r.values(tileCounts),
      width: num(TAG_TILE_WIDTH, 0),
      height: num(TAG_TILE_LENGTH, 0),
    };
  } else if (stripOffsets && stripCounts) {
    layout.strips = {
      offsets: r.values(stripOffsets),
      byteCounts: r.values(stripCounts),
      rowsPerStrip: num(TAG_ROWS_PER_STRIP, layout.height),
    };
  }

  return layout;
}

const isCfa = (r: TiffReader, entries: IfdEntry[]): boolean => {
  const e = findTag(entries, TAG_PHOTOMETRIC);
  return e !== undefined && r.value(e) === PHOTOMETRIC_CFA;
};

/**
 * Every IFD in the file: the chain from IFD0, plus each SubIFD.
 *
 * SubIFDs are where the photograph usually is, so a reader that only walks the
 * top-level chain finds previews and nothing else.
 */
function allIfds(r: TiffReader): IfdEntry[][] {
  const out: IfdEntry[][] = [];
  const seen = new Set<number>();

  let offset = r.firstIfdOffset();
  // Bounded, and cycle-guarded: a file may point an IFD chain at itself, and
  // following it would not stop.
  for (let i = 0; i < 16 && offset !== 0 && !seen.has(offset); i += 1) {
    seen.add(offset);
    const entries = r.readIfd(offset);
    if (entries.length === 0) break;
    out.push(entries);

    const subs = findTag(entries, TAG_SUB_IFDS);
    if (subs) {
      for (const subOffset of r.values(subs)) {
        if (seen.has(subOffset)) continue;
        seen.add(subOffset);
        const sub = r.readIfd(subOffset);
        if (sub.length > 0) out.push(sub);
      }
    }
    offset = r.nextIfdOffset(offset);
  }
  return out;
}

/** Which compressions this build can currently turn into pixels. */
const SUPPORTED_COMPRESSION: ReadonlySet<number> = new Set([
  DNG_COMPRESSION.none,
]);

/**
 * Read a DNG's structure, or null if the bytes are not a DNG.
 *
 * "Not a DNG" is separate from "a DNG this cannot decode". The second still
 * returns metadata, with `decodable` false and a reason — because knowing it is
 * a 6000×4000 lossless-JPEG DNG is exactly what lets the app say something
 * useful instead of refusing an unnamed file.
 */
export function readDng(bytes: Uint8Array): DngMetadata | null {
  const r = TiffReader.open(bytes);
  if (r === null) return null;

  const ifds = allIfds(r);
  if (ifds.length === 0) return null;

  const versionEntry = ifds
    .map((entries) => findTag(entries, TAG_DNG_VERSION))
    .find((e) => e !== undefined);
  if (versionEntry === undefined) return null;

  // The raw image is the largest CFA IFD. Largest rather than first because a
  // DNG may carry more than one CFA image — a reduced-resolution proxy beside
  // the full one — and NewSubfileType is not always set to say which is which.
  const cfaIfds = ifds.filter((entries) => isCfa(r, entries));
  const layouts = cfaIfds.map((entries) => readLayout(r, entries));
  const raw = layouts.reduce<DngImageLayout | null>(
    (best, l) =>
      best === null || l.width * l.height > best.width * best.height ? l : best,
    null,
  );

  if (raw === null) {
    // A DNG with no CFA image at all — a linear (already demosaiced) DNG, which
    // is legal and which this reader does not handle yet. Saying so beats
    // returning null and having the caller report "not a DNG".
    const first = readLayout(r, ifds[0]!);
    return {
      version: r.values(versionEntry),
      raw: first,
      decodable: false,
      reason:
        "This DNG holds no colour-filter-array image — it is probably a linear DNG, which is not supported yet.",
      ...describeCamera(r, ifds),
    };
  }

  let decodable = true;
  let reason: string | undefined;
  if (!SUPPORTED_COMPRESSION.has(raw.compression)) {
    decodable = false;
    reason = `This DNG uses ${compressionName(raw.compression)} compression, which is not supported yet.`;
  } else if (raw.width === 0 || raw.height === 0) {
    decodable = false;
    reason = "This DNG declares no image size.";
  } else if (raw.cfaPattern.length === 0) {
    decodable = false;
    reason = "This DNG declares no colour-filter pattern.";
  }

  return {
    version: r.values(versionEntry),
    raw,
    decodable,
    ...(reason !== undefined ? { reason } : {}),
    ...describeCamera(r, ifds),
  };
}

function describeCamera(
  r: TiffReader,
  ifds: IfdEntry[][],
): { make?: string; model?: string } {
  const out: { make?: string; model?: string } = {};
  for (const entries of ifds) {
    const make = findTag(entries, TAG_MAKE);
    const model = findTag(entries, TAG_MODEL);
    if (make && out.make === undefined) {
      const s = r.string(make);
      if (s) out.make = s;
    }
    if (model && out.model === undefined) {
      const s = r.string(model);
      if (s) out.model = s;
    }
  }
  return out;
}

function compressionName(code: number): string {
  switch (code) {
    case DNG_COMPRESSION.none:
      return "uncompressed";
    case DNG_COMPRESSION.jpeg:
      return "lossless JPEG";
    case DNG_COMPRESSION.lossyJpeg:
      return "lossy JPEG";
    case DNG_COMPRESSION.deflate:
      return "Deflate";
    case DNG_COMPRESSION.lzw:
      return "LZW";
    case DNG_COMPRESSION.packBits:
      return "PackBits";
    default:
      return `an unrecognised (${code})`;
  }
}
