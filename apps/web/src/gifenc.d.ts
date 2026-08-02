/**
 * Minimal typings for `gifenc`, which ships no `.d.ts` of its own. Only the
 * surface this app calls is declared — widening it is fine, guessing at it is
 * not, so each signature here mirrors gifenc's own source.
 */
declare module "gifenc" {
  /** A palette is a list of [r, g, b] (or [r, g, b, a]) 0-255 tuples. */
  export type GifPalette = number[][];

  export interface GifFrameOptions {
    /** Frame duration in milliseconds (gifenc rounds to GIF's 1/100s units). */
    delay?: number;
    palette?: GifPalette | null;
    /** -1 plays once, 0 repeats forever, >0 is an extra-iteration count.
     * Only honoured on the first written frame. */
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    colorDepth?: number;
    dispose?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: GifFrameOptions,
    ): void;
    /** Writes the trailer. Call once, before reading the bytes. */
    finish(): void;
    /** A copy that owns its buffer, unlike `bytesView`, which aliases the
     * encoder's growing scratch space. Typed as backed by a plain
     * ArrayBuffer so it can go straight into a Blob. */
    bytes(): Uint8Array<ArrayBuffer>;
    bytesView(): Uint8Array<ArrayBuffer>;
    reset(): void;
  }

  export function GIFEncoder(opts?: {
    auto?: boolean;
    initialCapacity?: number;
  }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: {
      format?: "rgb565" | "rgb444" | "rgba4444";
      oneBitAlpha?: boolean | number;
      clearAlpha?: boolean;
      clearAlphaColor?: number;
      clearAlphaThreshold?: number;
    },
  ): GifPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: "rgb565" | "rgb444" | "rgba4444",
  ): Uint8Array;
}
