import {
  applyColourTransform,
  cameraToSrgb,
  demosaicBilinear,
  findTag,
  LIBRAW_UNAVAILABLE,
  normaliseSamples,
  readDng,
  routeRaw,
  TiffReader,
  toRgba,
  unpackImage,
  type Matrix3,
} from "@director/raw-decode";

/**
 * Opening a camera raw file.
 *
 * A raw file is not a picture — it is sensor readings plus the instructions for
 * turning them into one. The app's import path expects something a browser can
 * decode, so raw files are developed here first and handed on as an ordinary
 * image. Everything downstream — the bin, the timeline, effects, export — then
 * works without knowing raw exists.
 *
 * Which decoder does the work is decided by `routeRaw` from the file's bytes,
 * not its extension. Today that means DNG through the built-in decoder, and a
 * clear refusal naming the camera and format for anything needing LibRaw, which
 * is not shipped. See `packages/raw-decode`.
 */

/** How much of the file is needed to identify it. Formats declare themselves in
 * their first bytes; reading a 60MB file to answer a question about its header
 * would stall the import for nothing. */
const SNIFF_BYTES = 64 * 1024;

const TAG_COLOR_MATRIX_1 = 0xc621;
const TAG_COLOR_MATRIX_2 = 0xc622;
const TAG_AS_SHOT_NEUTRAL = 0xc628;

export type RawImportResult =
  | { kind: "not-raw" }
  | { kind: "developed"; file: File }
  | { kind: "refused"; reason: string };

/**
 * Read the colour matrix and white balance.
 *
 * `ColorMatrix2` is preferred when present: a DNG may carry two, calibrated for
 * different illuminants, and the second is the one for daylight — the better
 * default for a file whose lighting is unknown. Missing entirely is not an
 * error; the picture is then developed in the sensor's own primaries, which is
 * approximate but far better than refusing to open it.
 */
function readColourTags(bytes: Uint8Array): {
  matrix?: Matrix3;
  neutral?: number[];
} {
  const r = TiffReader.open(bytes);
  if (r === null) return {};

  // The colour tags live in IFD0, not in the SubIFD holding the sensor data.
  const entries = r.readIfd(r.firstIfdOffset());
  const matrixEntry =
    findTag(entries, TAG_COLOR_MATRIX_2) ?? findTag(entries, TAG_COLOR_MATRIX_1);
  const neutralEntry = findTag(entries, TAG_AS_SHOT_NEUTRAL);

  const out: { matrix?: Matrix3; neutral?: number[] } = {};
  if (matrixEntry && matrixEntry.count === 9) {
    out.matrix = r.values(matrixEntry) as unknown as Matrix3;
  }
  if (neutralEntry && neutralEntry.count === 3) {
    out.neutral = r.values(neutralEntry);
  }
  return out;
}

/** Draw RGBA into a canvas and encode it as a PNG file the app can import. */
async function toPngFile(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  name: string,
): Promise<File | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return null;
  // Copied into a fresh buffer: ImageData requires a Uint8ClampedArray backed
  // by an ArrayBuffer, and the decoder's output is typed more loosely than
  // that. The copy is one frame's worth and happens once per import.
  const pixels = new Uint8ClampedArray(rgba.length);
  pixels.set(rgba);
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0);

  // PNG rather than JPEG: a developed raw is the starting point for grading,
  // and re-quantising it before the user has touched it would throw away
  // exactly the latitude they opened a raw file to get.
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (blob === null) return null;
  return new File([blob], name, { type: "image/png" });
}

/**
 * Develop a raw file into an image, or explain why not.
 *
 * `not-raw` means the caller should carry on with its normal path — this is not
 * a failure and must not be reported as one, since every ordinary JPEG lands
 * here first.
 */
export async function developRaw(file: File): Promise<RawImportResult> {
  const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());

  // The decoders offered: the built-in DNG reader, and LibRaw as unavailable so
  // a vendor format is refused in words rather than silently unsupported.
  const routed = routeRaw(head, [
    {
      id: "dng-ts",
      formats: ["dng"],
      needsDownload: false,
      available: true,
    },
    LIBRAW_UNAVAILABLE,
  ]);

  if (routed.kind === "not-raw") return { kind: "not-raw" };
  if (routed.kind === "unsupported") {
    return { kind: "refused", reason: routed.reason };
  }

  // Only now is the whole file read. Identification needed a header; decoding
  // needs the sensor data, which is nearly all of it.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dng = readDng(bytes);
  if (dng === null) {
    return { kind: "refused", reason: "This file is not a readable DNG." };
  }
  if (!dng.decodable) {
    return {
      kind: "refused",
      reason:
        dng.reason ??
        "This DNG uses features the built-in decoder does not support.",
    };
  }

  const samples = unpackImage(bytes, dng.raw);
  if (samples === null) {
    return {
      kind: "refused",
      reason: `This DNG stores ${dng.raw.bitsPerSample}-bit samples in a layout the decoder cannot read.`,
    };
  }

  const normalised = normaliseSamples(samples, dng.raw);
  const rgb = demosaicBilinear(normalised, dng.raw);
  if (rgb === null) {
    return { kind: "refused", reason: "This DNG declares no colour pattern." };
  }

  const { matrix, neutral } = readColourTags(bytes);
  // No matrix is not fatal: the picture is then in the sensor's own primaries.
  // Approximate colour beats refusing a file that decoded perfectly well.
  const transform = matrix ? cameraToSrgb(matrix, neutral) : null;
  const corrected = transform ? applyColourTransform(rgb, transform) : rgb;

  const developed = await toPngFile(
    toRgba(corrected),
    rgb.width,
    rgb.height,
    `${file.name.replace(/\.[^.]+$/, "")}.png`,
  );
  if (developed === null) {
    return { kind: "refused", reason: "Could not draw the developed picture." };
  }
  return { kind: "developed", file: developed };
}
