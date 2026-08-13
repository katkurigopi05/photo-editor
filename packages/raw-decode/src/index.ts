/**
 * Camera raw support — map step C4.
 *
 * This package answers "what is this file, and what should open it" before any
 * decoding happens. The decoders themselves land behind the interface here: a
 * DNG reader in TypeScript, and a LibRaw build in WebAssembly for everything
 * else.
 *
 * Getting the routing right first is deliberate. It is the part that decides
 * whether a user pays a multi-megabyte download to open a file the built-in
 * code could have read, and it is fully testable with a few bytes of header —
 * long before either decoder exists.
 */

export {
  sniffRaw,
  RAW_FORMATS,
  type RawFormat,
  type RawIdentification,
} from "./sniff.js";

export {
  readDng,
  DNG_COMPRESSION,
  type CfaColour,
  type DngImageLayout,
  type DngMetadata,
} from "./dng.js";

export { TiffReader, findTag, type IfdEntry } from "./tiff.js";

export {
  routeRaw,
  type RawDecoderInfo,
  type RawRouteOutcome,
} from "./route.js";
