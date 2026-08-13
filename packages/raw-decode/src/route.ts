import { sniffRaw, type RawFormat, type RawIdentification } from "./sniff.js";

/**
 * Choosing a decoder for a file.
 *
 * Two are planned and they are not interchangeable:
 *
 * - **A DNG decoder in TypeScript.** Small, ships with the app, no download, no
 *   WASM. DNG is an open specification, so this is writable — but it reads only
 *   DNG.
 * - **A LibRaw build in WebAssembly.** Reads essentially every camera format
 *   ever made, at the cost of a multi-megabyte binary that has to be fetched
 *   before it can decode anything.
 *
 * The choice is not a preference to be configured. It follows from the file:
 * a DNG should never pay for a several-megabyte download, and a Nikon NEF
 * cannot be read without one. So the file is identified first and the decoder
 * follows — which is why `sniffRaw` reads the bytes rather than the extension.
 *
 * This module is the decision only. It holds no decoder and imports none, so it
 * stays testable without either being finished, and so the routing can be got
 * right before there is anything to route.
 */

/** What a decoder implementation must tell the router about itself. */
export interface RawDecoderInfo {
  id: string;
  /** Formats it can read at all. */
  formats: readonly RawFormat[];
  /**
   * True when using it costs a download the user has not already paid.
   *
   * The router prefers a decoder that is already here, all else being equal —
   * a 3MB fetch to open a file the built-in code could have read is a cost with
   * nothing bought.
   */
  needsDownload: boolean;
  /** False when the implementation is not present in this build or failed to
   * load. Reported rather than thrown, because a missing optional decoder is a
   * normal state and not an error. */
  available: boolean;
}

export type RawRouteOutcome =
  | { kind: "decode"; decoder: RawDecoderInfo; identified: RawIdentification }
  | { kind: "not-raw" }
  | {
      kind: "unsupported";
      identified: RawIdentification;
      /** Plain-language reason naming the format and, where known, the camera
       * make — so the message can say "Nikon NEF files need the extended
       * decoder" instead of "unsupported file". */
      reason: string;
    };

const describe = (id: RawIdentification): string =>
  id.make ? `${id.make} ${id.format.toUpperCase()}` : id.format.toUpperCase();

/**
 * Decide how to open a file.
 *
 * Order matters: among decoders that can read the format, one already present
 * beats one that must be fetched. Within that, the first registered wins, so
 * the caller's ordering is the tie-break rather than something arbitrary.
 */
export function routeRaw(
  bytes: Uint8Array,
  decoders: readonly RawDecoderInfo[],
): RawRouteOutcome {
  const identified = sniffRaw(bytes);
  if (identified === null) return { kind: "not-raw" };

  const usable = decoders.filter(
    (d) => d.available && d.formats.includes(identified.format),
  );
  if (usable.length > 0) {
    // Stable: `needsDownload` false sorts first, and equal entries keep their
    // registration order.
    const best = usable.reduce((a, b) =>
      a.needsDownload && !b.needsDownload ? b : a,
    );
    return { kind: "decode", decoder: best, identified };
  }

  // Distinguish "nothing here can ever read this" from "the thing that could is
  // not installed". The second is fixable by the user and the first is not, so
  // telling them apart is the difference between a useful message and a dead
  // end.
  const couldIfAvailable = decoders.filter((d) =>
    d.formats.includes(identified.format),
  );
  const reason =
    couldIfAvailable.length > 0
      ? `${describe(identified)} needs the extended raw decoder, which is not loaded.`
      : `${describe(identified)} is not a format this build can read.`;

  return { kind: "unsupported", identified, reason };
}
