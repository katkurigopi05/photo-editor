import { featherMask, type Mask } from "@director/raster-tools";

/**
 * Portrait blur: keep the subject sharp, blur what is behind it.
 *
 * The subject comes from the same U²-Net segmentation the raster editor's AI
 * background removal uses — running the model is the expensive part, so callers
 * cache the mask per asset rather than per frame. Everything here is pure and
 * synchronous so it can run inside `drawLayer`, which preview, GIF and MP4 all
 * share.
 */

/** Highlights above this are what bloom; below it a pixel is just background. */
const BOKEH_HIGHLIGHT_FLOOR = 140;
/** Largest multiplier a fully-bloomed highlight gets, at strength 1. */
const BOKEH_MAX_GAIN = 1.6;
/** How far the subject edge can move across the full subjectScale range. */
const MAX_SUBJECT_BIAS_PX = 12;

/**
 * Grow or shrink the segmented subject.
 *
 * Feathering spreads the hard edge into a ramp, and re-thresholding that ramp
 * at a level either side of the midpoint moves the boundary outward or inward
 * — a dilate/erode without needing a separate morphology pass. Segmentation
 * routinely clips hair or keeps a sliver of background, and this is the knob
 * that fixes it by eye.
 */
export function biasSubjectMask(mask: Mask, subjectScale: number): Mask {
  if (subjectScale === 1) {
    return {
      width: mask.width,
      height: mask.height,
      data: new Uint8ClampedArray(mask.data),
    };
  }
  // subjectScale runs 0.5..1.5; map its distance from 1 onto a feather radius.
  const bias = Math.max(-1, Math.min(1, (subjectScale - 1) / 0.5));
  const radius = Math.max(1, Math.round(Math.abs(bias) * MAX_SUBJECT_BIAS_PX));
  const feathered = featherMask(mask, radius);
  // Growing keeps everything the ramp touched; shrinking keeps only its core.
  const threshold = bias > 0 ? 8 : 247;
  const data = new Uint8ClampedArray(feathered.data.length);
  for (let i = 0; i < feathered.data.length; i++) {
    data[i] = feathered.data[i]! >= threshold ? 255 : 0;
  }
  return { width: mask.width, height: mask.height, data };
}

/**
 * Per-pixel brightness multiplier for the blurred background.
 *
 * Real bokeh is not "more blur" — it is what an out-of-focus highlight does:
 * a bright point spreads into a disc and reads brighter than its surroundings,
 * while shadows stay put. Blurring alone averages highlights away, so they are
 * lifted back in proportion to how bright they were.
 *
 * Returns a gain in [1, BOKEH_MAX_GAIN]; never below 1, so this can only
 * brighten highlights, never crush the background.
 */
export function bokehGain(strength: number, luma: number): number {
  if (strength <= 0) return 1;
  if (luma <= BOKEH_HIGHLIGHT_FLOOR) return 1;
  const headroom = (luma - BOKEH_HIGHLIGHT_FLOOR) / (255 - BOKEH_HIGHLIGHT_FLOOR);
  const clamped = Math.max(0, Math.min(1, strength));
  return 1 + headroom * clamped * (BOKEH_MAX_GAIN - 1);
}

/** Apply {@link bokehGain} across an already-blurred background in place. */
export function bloomHighlights(
  data: Uint8ClampedArray,
  strength: number,
): void {
  if (strength <= 0) return;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const gain = bokehGain(strength, 0.2126 * r + 0.7152 * g + 0.0722 * b);
    if (gain === 1) continue;
    data[i] = r * gain;
    data[i + 1] = g * gain;
    data[i + 2] = b * gain;
  }
}
