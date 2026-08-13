import type { RawDecoderInfo } from "./route.js";
import { RAW_FORMATS, type RawFormat } from "./sniff.js";

/**
 * The LibRaw adapter: everything the built-in DNG decoder cannot read.
 *
 * LibRaw handles essentially every camera format ever made, including the
 * losslessly compressed DNGs that are most of them in practice. It is C++, so
 * using it here means a WebAssembly build — several megabytes that have to be
 * fetched before a single pixel can be decoded.
 *
 * **The binary is not in this repository and this module does not fetch one.**
 * It defines the contract, adapts whatever module is supplied to the decoder
 * interface, and reports itself unavailable until one is. That is deliberate:
 * committing a multi-megabyte artefact to a repo that is otherwise source, or
 * downloading one at runtime from wherever, are both decisions for whoever
 * deploys this rather than defaults to be inherited quietly.
 *
 * Until a module is provided, `routeRaw` sees `available: false` and says so in
 * the words a user can act on — "Canon CR3 needs the extended raw decoder,
 * which is not loaded" — rather than failing somewhere deep in a parser.
 */

/** The shape a LibRaw WebAssembly build must present.
 *
 * Intentionally minimal. LibRaw's own surface is enormous and most of it is
 * irrelevant here; a narrow contract is one that several different builds can
 * satisfy, and one that can be faked exactly in a test. */
export interface LibRawModule {
  /**
   * Decode a raw file to 8-bit RGBA at full resolution.
   *
   * Returns null for a file it cannot read. Throwing is also handled by the
   * adapter, because a WASM module aborting is not the same as it declining
   * and neither should reach the caller as an exception.
   */
  decode(bytes: Uint8Array): Promise<{
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
  } | null>;
  /** Formats this build was compiled with. Builds are routinely trimmed to cut
   * their size, so this is asked rather than assumed. */
  supportedFormats?: readonly RawFormat[];
}

export interface LibRawDecoder {
  info: RawDecoderInfo;
  decode: (bytes: Uint8Array) => Promise<{
    width: number;
    height: number;
    rgba: Uint8ClampedArray;
  } | null>;
}

/** The decoder's identity when no module has been supplied. Exported so the
 * app can register it at startup and let the router explain itself. */
export const LIBRAW_UNAVAILABLE: RawDecoderInfo = {
  id: "libraw-wasm",
  formats: RAW_FORMATS,
  needsDownload: true,
  available: false,
};

/**
 * Adapt a LibRaw build to the decoder interface.
 *
 * Pass the module once it is loaded — however it was loaded, which is the point
 * of taking it as an argument rather than importing it. A build that declares
 * no format list is taken at its word for all of them, since a trimmed build
 * that does not say what it kept cannot be second-guessed from here.
 */
export function createLibRawDecoder(module: LibRawModule): LibRawDecoder {
  const formats =
    module.supportedFormats && module.supportedFormats.length > 0
      ? module.supportedFormats
      : RAW_FORMATS;

  return {
    info: {
      id: "libraw-wasm",
      formats,
      // Still true once loaded: the download was paid, and the router uses this
      // to prefer the built-in decoder for a DNG on the *next* file too.
      needsDownload: true,
      available: true,
    },
    decode: async (bytes) => {
      try {
        const result = await module.decode(bytes);
        if (result === null) return null;
        // A module that returns a buffer inconsistent with its own dimensions
        // has gone wrong in a way that would surface as a torn or truncated
        // picture. Refusing beats rendering it.
        if (
          result.width <= 0 ||
          result.height <= 0 ||
          result.rgba.length !== result.width * result.height * 4
        ) {
          return null;
        }
        return result;
      } catch {
        // A WASM abort is not a decline, but neither should reach the caller as
        // an exception — the router's contract is a decoder that returns null.
        return null;
      }
    },
  };
}
