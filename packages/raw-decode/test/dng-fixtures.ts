/**
 * Building DNG files for tests, to the specification.
 *
 * A real raw file cannot be committed — tens of megabytes, and licensing that is
 * nobody's idea of clear — so files are constructed here instead. The contents
 * are then known exactly, and a decode is checked against what went in rather
 * than against what it looked like last time.
 *
 * Shared so the compressed-DNG tests build the same file shape the structural
 * tests do, differing only in the compression tag and the strip payload.
 */
import { DNG_COMPRESSION } from "../src/dng.js";

export const PHOTOMETRIC_CFA = 32803;

export interface Tag {
  tag: number;
  type: number;
  count: number;
  /** Inline value, for counts that fit in four bytes. */
  value?: number;
  /** Values written after the IFDs, with the entry pointing at them. */
  data?: number[];
  /** ASCII payload, written the same way. */
  text?: string;
}

export const SHORT = 3;
export const LONG = 4;
export const BYTE = 1;
export const ASCII_TYPE = 2;

/**
 * Build a little-endian TIFF with a main IFD and optional SubIFDs.
 *
 * Layout: header, IFD0, each SubIFD, then a heap for values too large to sit
 * inside their entry. Offsets are computed rather than hard-coded so a test can
 * add a tag without recalculating the file by hand.
 */
export function buildDng(
  ifd0: Tag[],
  subIfds: Tag[][] = [],
  /**
   * Sample bytes to append, with StripOffsets patched to point at them.
   *
   * The structural tests never needed real samples — they check what the reader
   * reports about a file, not what it decodes — so StripOffsets is a fixed made-up
   * number there. A test that actually decodes needs the tag to point at bytes
   * that exist, and the offset is only known once the heap is laid out.
   */
  payload?: Uint8Array,
): Uint8Array {
  const ifdSize = (tags: Tag[]): number => 2 + tags.length * 12 + 4;

  const ifd0At = 8;
  const subAt: number[] = [];
  let cursor = ifd0At + ifdSize(ifd0);
  for (const sub of subIfds) {
    subAt.push(cursor);
    cursor += ifdSize(sub);
  }
  const heapAt = cursor;

  // Reserve heap space for every out-of-line value.
  const heap: number[] = [];
  const place = (bytes: number[]): number => {
    const at = heapAt + heap.length;
    heap.push(...bytes);
    return at;
  };

  const bytes = new Uint8Array(heapAt + 4096);
  const view = new DataView(bytes.buffer);
  bytes.set([0x49, 0x49, 0x2a, 0x00], 0);
  view.setUint32(4, ifd0At, true);

  const writeIfd = (at: number, tags: Tag[], next: number): void => {
    view.setUint16(at, tags.length, true);
    tags.forEach((t, i) => {
      const entry = at + 2 + i * 12;
      view.setUint16(entry, t.tag, true);
      view.setUint16(entry + 2, t.type, true);
      view.setUint32(entry + 4, t.count, true);

      if (t.text !== undefined) {
        const encoded = [...new TextEncoder().encode(`${t.text}\0`)];
        view.setUint32(entry + 8, place(encoded), true);
        return;
      }
      if (t.data !== undefined) {
        const size = t.type === SHORT ? 2 : t.type === BYTE ? 1 : 4;
        if (t.data.length * size <= 4) {
          // Small enough to live in the entry.
          t.data.forEach((v, k) => {
            if (size === 1) view.setUint8(entry + 8 + k, v);
            else if (size === 2) view.setUint16(entry + 8 + k * 2, v, true);
            else view.setUint32(entry + 8 + k * 4, v, true);
          });
          return;
        }
        const flat: number[] = [];
        for (const v of t.data) {
          if (size === 1) flat.push(v & 0xff);
          else if (size === 2) flat.push(v & 0xff, (v >> 8) & 0xff);
          else
            flat.push(
              v & 0xff,
              (v >> 8) & 0xff,
              (v >> 16) & 0xff,
              (v >> 24) & 0xff,
            );
        }
        view.setUint32(entry + 8, place(flat), true);
        return;
      }
      view.setUint32(entry + 8, t.value ?? 0, true);
    });
    view.setUint32(at + 2 + tags.length * 12, next, true);
  };

  writeIfd(ifd0At, ifd0, 0);
  subIfds.forEach((sub, i) => writeIfd(subAt[i]!, sub, 0));

  // Patch the SubIFDs tag, now that their offsets are known.
  if (subIfds.length > 0) {
    const index = ifd0.findIndex((t) => t.tag === 0x014a);
    if (index >= 0) {
      const entry = ifd0At + 2 + index * 12;
      if (subAt.length === 1) {
        view.setUint32(entry + 8, subAt[0]!, true);
      } else {
        const flat: number[] = [];
        for (const a of subAt)
          flat.push(
            a & 0xff,
            (a >> 8) & 0xff,
            (a >> 16) & 0xff,
            (a >> 24) & 0xff,
          );
        view.setUint32(entry + 8, place(flat), true);
      }
    }
  }

  bytes.set(heap, heapAt);

  if (payload !== undefined) {
    const payloadAt = heapAt + heap.length;
    const out = new Uint8Array(payloadAt + payload.length);
    out.set(bytes.subarray(0, payloadAt), 0);
    out.set(payload, payloadAt);

    // Patch StripOffsets last: until the heap is placed, this offset does not
    // exist, and a tag pointing at the wrong place decodes whatever is there.
    const patched = new DataView(out.buffer);
    const index = ifd0.findIndex((t) => t.tag === 0x0111);
    if (index < 0) {
      throw new Error(
        "a payload was given but no StripOffsets tag to point at it",
      );
    }
    patched.setUint32(ifd0At + 2 + index * 12 + 8, payloadAt, true);
    return out;
  }

  return bytes;
}

export const dngVersion = (): Tag => ({
  tag: 0xc612,
  type: BYTE,
  count: 4,
  data: [1, 4, 0, 0],
});

/** A CFA IFD of the given size, uncompressed RGGB. */
export const cfaIfd = (
  width: number,
  height: number,
  extra: Tag[] = [],
): Tag[] => [
  { tag: 0x0100, type: LONG, count: 1, value: width },
  { tag: 0x0101, type: LONG, count: 1, value: height },
  { tag: 0x0102, type: SHORT, count: 1, value: 14 },
  { tag: 0x0103, type: SHORT, count: 1, value: DNG_COMPRESSION.none },
  { tag: 0x0106, type: SHORT, count: 1, value: PHOTOMETRIC_CFA },
  { tag: 0x0115, type: SHORT, count: 1, value: 1 },
  { tag: 0x828e, type: BYTE, count: 4, data: [0, 1, 1, 2] },
  { tag: 0x0111, type: LONG, count: 1, value: 4096 },
  { tag: 0x0117, type: LONG, count: 1, value: width * height * 2 },
  ...extra,
];
