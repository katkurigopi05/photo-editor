/**
 * Animated GIF encoding.
 *
 * The encoder (gifenc, MIT) is pulled in with a dynamic `import()` so it only
 * costs bandwidth once GIF mode is actually entered — the app's other two
 * modes never touch it. `loadGifEncoder` is idempotent and safe to call as a
 * warm-up the moment the mode is selected, so the first export does not pay
 * the download.
 *
 * Frames are quantized as they arrive but written at the end, because the GIF
 * header carries the loop flag (it belongs to the first frame) and because a
 * boomerang has to replay frames the encoder has already consumed. Palettized
 * frames cost one byte per pixel plus a small palette, roughly a quarter of
 * the RGBA they came from.
 */

import type * as Gifenc from "gifenc";
import type { GifEncoderInstance, GifPalette } from "gifenc";

export interface GifEncodeOptions {
  /** Sampling rate of the GIF itself. GIFs store delays in 1/100s units, so
   * rates that do not divide 100 evenly are approximated by the format. */
  fps: number;
  /** Repeat forever vs. play through once. */
  loop: boolean;
  /** Append the frames again in reverse for a ping-pong loop. */
  boomerang: boolean;
  /** Palette size. GIF caps this at 256 colors per frame. */
  maxColors?: number;
}

export interface GifSink {
  /** Quantizes and buffers one frame. Frames must arrive in playback order. */
  addFrame(frame: ImageData): void;
  /** Encodes everything buffered so far and returns the finished file. */
  finish(): Blob;
  /** Frames buffered — before any boomerang expansion. */
  count(): number;
}

const MIN_FPS = 1;
const MAX_FPS = 50;
const MAX_COLORS = 256;
const MIN_COLORS = 2;

type GifencModule = typeof Gifenc;

let modulePromise: Promise<GifencModule> | null = null;

/** Loads (once) and returns the GIF encoder module. Concurrent callers share
 * the same in-flight import; a failed load is not cached, so a later attempt
 * can retry rather than being stuck with the rejection. */
export function loadGifEncoder(): Promise<GifencModule> {
  if (!modulePromise) {
    modulePromise = import("gifenc").catch((err: unknown) => {
      modulePromise = null;
      throw err instanceof Error
        ? err
        : new Error("Could not load the GIF encoder.");
    });
  }
  return modulePromise;
}

/** True once the encoder is in memory — lets the UI skip a "loading" state. */
export function isGifEncoderLoaded(): boolean {
  return modulePromise !== null;
}

export function clampGifFps(fps: number): number {
  if (!Number.isFinite(fps)) return 10;
  return Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(fps)));
}

/** Frame delays in a GIF are whole hundredths of a second, so the rate is
 * snapped to what the format can actually store. The 50fps cap keeps the
 * result at 20ms or more, which is as fast as viewers reliably play. */
export function gifFrameDelayMs(fps: number): number {
  return Math.round(100 / clampGifFps(fps)) * 10;
}

/**
 * Blend partially transparent pixels onto black and make them opaque.
 *
 * GIF stores one bit of alpha, so a pixel drawn at 40% opacity is written at
 * full strength and any fade authored with `transform.opacity` disappears —
 * the exported GIF cuts straight to the fully visible frame. Premultiplying
 * against black puts the fade back into the RGB channels, which GIF can
 * represent, and matches what the MP4 encoder already does with this same
 * canvas.
 *
 * Fully transparent pixels are left alone: `fx.remove_background` keys pixels
 * out to alpha 0, GIF can store that, and flattening them would paint the
 * removed background back in as black.
 *
 * Mutates in place, like `removeBackground` in main.ts — the buffer is read
 * straight off the export canvas and handed to the encoder, and copying it per
 * frame would allocate a megabyte per frame for nothing.
 */
export function flattenPartialAlpha(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]!;
    if (alpha === 0 || alpha === 255) continue;
    const factor = alpha / 255;
    data[i] = Math.round(data[i]! * factor);
    data[i + 1] = Math.round(data[i + 1]! * factor);
    data[i + 2] = Math.round(data[i + 2]! * factor);
    data[i + 3] = 255;
  }
}

/**
 * Whether a frame needs GIF's 1-bit transparency at all.
 *
 * Only fully transparent pixels qualify: `flattenPartialAlpha` has already
 * folded every partial alpha into RGB, so anything still at 0 was genuinely
 * keyed out (a removed background, or the letterbox around a clip).
 */
export function frameHasTransparency(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] === 0) return true;
  }
  return false;
}

/** Index of a palette's fully transparent entry, or -1 when it has none —
 * including the RGB palettes used for opaque frames, whose entries are
 * `[r, g, b]` triples with no alpha to inspect. */
export function transparentPaletteIndex(palette: GifPalette): number {
  return palette.findIndex((color) => color.length > 3 && color[3] === 0);
}

/**
 * Playback order for `frameCount` frames, ping-ponged when `boomerang` is on.
 * The two endpoints are not repeated — holding on the first and last frame for
 * twice as long is exactly the stutter that makes a boomerang look broken.
 */
export function boomerangOrder(
  frameCount: number,
  boomerang: boolean,
): number[] {
  const forward = Array.from({ length: frameCount }, (_, i) => i);
  if (!boomerang || frameCount < 3) return forward;
  const back = forward.slice(1, -1).reverse();
  return [...forward, ...back];
}

interface QuantizedFrame {
  index: Uint8Array;
  palette: GifPalette;
  width: number;
  height: number;
  /** Palette slot to key out, or -1 for a frame written fully opaque. */
  transparentIndex: number;
}

/**
 * Creates a sink that buffers quantized frames and encodes them on `finish`.
 * Resolves only once the encoder module is available, so callers can await it
 * at the start of an export and treat everything after as synchronous.
 */
export async function createGifEncoder(
  options: GifEncodeOptions,
): Promise<GifSink> {
  const { GIFEncoder, quantize, applyPalette } = await loadGifEncoder();
  const maxColors = Math.min(
    MAX_COLORS,
    Math.max(MIN_COLORS, options.maxColors ?? MAX_COLORS),
  );
  const delay = gifFrameDelayMs(options.fps);
  const frames: QuantizedFrame[] = [];

  return {
    addFrame(frame: ImageData): void {
      // Only frames that actually contain keyed-out pixels pay for an alpha
      // channel: rgba4444 is 4 bits per channel, visibly coarser than rgb565's
      // 5-6-5, and most frames (a full-bleed photo or video) have nothing to
      // key out. Each frame carries its own local palette already, so the
      // format can differ frame to frame.
      const transparent = frameHasTransparency(frame.data);
      const format = transparent ? "rgba4444" : "rgb565";
      // A per-frame palette tracks color better than one global table, which
      // matters for the gradients and tints this editor produces.
      const palette = transparent
        ? quantize(frame.data, maxColors, { format, oneBitAlpha: true })
        : quantize(frame.data, maxColors, { format });
      frames.push({
        index: applyPalette(frame.data, palette, format),
        palette,
        width: frame.width,
        height: frame.height,
        transparentIndex: transparent ? transparentPaletteIndex(palette) : -1,
      });
    },
    count(): number {
      return frames.length;
    },
    finish(): Blob {
      if (frames.length === 0) {
        throw new Error("No frames were rendered for the GIF.");
      }
      const encoder: GifEncoderInstance = GIFEncoder();
      const order = boomerangOrder(frames.length, options.boomerang);
      order.forEach((frameIndex, position) => {
        const frame = frames[frameIndex]!;
        encoder.writeFrame(frame.index, frame.width, frame.height, {
          palette: frame.palette,
          delay,
          // Without this the keyed-out pixels are written as whatever colour
          // sits in that palette slot — in practice black — and a removed
          // background comes back as a black rectangle.
          ...(frame.transparentIndex >= 0
            ? { transparent: true, transparentIndex: frame.transparentIndex }
            : {}),
          // Only the first frame carries the loop flag: 0 repeats forever,
          // -1 plays through once.
          ...(position === 0 ? { repeat: options.loop ? 0 : -1 } : {}),
        });
      });
      encoder.finish();
      // bytes() hands back a copy that owns its buffer; bytesView() would
      // alias the encoder's growing scratch buffer.
      const bytes = encoder.bytes();
      return new Blob([bytes], { type: "image/gif" });
    },
  };
}
