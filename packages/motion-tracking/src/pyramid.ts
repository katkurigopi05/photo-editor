import type { FlowFrame } from "./types.js";

/**
 * Image pyramids and sub-pixel sampling — the two things optical flow needs
 * before it can do anything useful.
 *
 * Plain Lucas-Kanade solves for a displacement by linearising the image around
 * a point, which only holds while the motion is a pixel or two. Real footage
 * moves further than that. A pyramid fixes it by solving coarse first: at
 * quarter resolution a 16-pixel motion *is* four pixels, and the answer is
 * carried down as the starting guess for the next level.
 */

/**
 * Levels stop before either side gets smaller than this.
 *
 * A window has to fit inside the level for the solve to mean anything, and
 * below about this size there is no structure left to lock onto — only the
 * average of the whole picture.
 */
export const MIN_LEVEL_SIZE = 24;

/** Default depth. Four levels reach 16× displacement, which covers ordinary
 * handheld motion at 1080p without paying for levels nobody reads. */
export const DEFAULT_LEVELS = 4;

/**
 * Halve a frame with a 2×2 box filter.
 *
 * Averaging rather than dropping every other pixel, because subsampling alone
 * aliases: a fence or a striped shirt reduced by point-sampling produces a
 * pattern that moves differently from the real one, and the tracker then
 * faithfully follows something that is not there.
 */
export function halve(frame: FlowFrame): FlowFrame {
  const width = Math.max(1, frame.width >> 1);
  const height = Math.max(1, frame.height >> 1);
  const luma = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    const y0 = y * 2;
    const y1 = Math.min(y0 + 1, frame.height - 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = x * 2;
      const x1 = Math.min(x0 + 1, frame.width - 1);
      const sum =
        frame.luma[y0 * frame.width + x0]! +
        frame.luma[y0 * frame.width + x1]! +
        frame.luma[y1 * frame.width + x0]! +
        frame.luma[y1 * frame.width + x1]!;
      luma[y * width + x] = Math.round(sum / 4);
    }
  }
  return { width, height, luma };
}

/**
 * Successive half-resolution levels, finest first.
 *
 * Index 0 is the frame itself, so a caller that ignores the pyramid entirely
 * still gets the original at the front rather than a surprise.
 */
export function buildPyramid(
  frame: FlowFrame,
  levels: number = DEFAULT_LEVELS,
): FlowFrame[] {
  const out: FlowFrame[] = [frame];
  for (let i = 1; i < levels; i += 1) {
    const previous = out[out.length - 1]!;
    if (
      previous.width >> 1 < MIN_LEVEL_SIZE ||
      previous.height >> 1 < MIN_LEVEL_SIZE
    ) {
      break;
    }
    out.push(halve(previous));
  }
  return out;
}

/**
 * Read a frame at a fractional position, interpolating between the four
 * surrounding pixels.
 *
 * The single most important function here. Nearest-neighbour would be faster
 * and would quantise every measurement to whole pixels, so a tracker built on
 * it converges to integers and jitters by up to half a pixel every frame —
 * which reads as a shake rather than as an error, and is easy to mistake for
 * the footage.
 *
 * Positions outside the frame clamp to the edge rather than wrapping or
 * returning zero: a black border invented off-frame is strong fake structure,
 * and the solve would happily lock onto it.
 */
export function sampleBilinear(frame: FlowFrame, x: number, y: number): number {
  const cx = Math.max(0, Math.min(frame.width - 1, x));
  const cy = Math.max(0, Math.min(frame.height - 1, y));
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, frame.width - 1);
  const y1 = Math.min(y0 + 1, frame.height - 1);
  const fx = cx - x0;
  const fy = cy - y0;

  const p00 = frame.luma[y0 * frame.width + x0]!;
  const p10 = frame.luma[y0 * frame.width + x1]!;
  const p01 = frame.luma[y1 * frame.width + x0]!;
  const p11 = frame.luma[y1 * frame.width + x1]!;

  const top = p00 + (p10 - p00) * fx;
  const bottom = p01 + (p11 - p01) * fx;
  return top + (bottom - top) * fy;
}

/** Whether a position is far enough inside the frame for a window to sit on it
 * without most of the window being clamped edge. */
export function insideFrame(
  frame: FlowFrame,
  x: number,
  y: number,
  margin: number,
): boolean {
  return (
    x >= margin &&
    y >= margin &&
    x <= frame.width - 1 - margin &&
    y <= frame.height - 1 - margin
  );
}
