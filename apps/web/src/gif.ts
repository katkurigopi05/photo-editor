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
      // A per-frame palette tracks color better than one global table, which
      // matters for the gradients and tints this editor produces.
      const palette = quantize(frame.data, maxColors);
      frames.push({
        index: applyPalette(frame.data, palette),
        palette,
        width: frame.width,
        height: frame.height,
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
