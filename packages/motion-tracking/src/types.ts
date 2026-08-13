/**
 * The shapes this package works in.
 *
 * Luma only. Optical flow tracks brightness structure, so carrying three
 * channels would triple every sample and every gradient for no gain — and the
 * one place colour would help (a red object on green of the same brightness) is
 * rare enough not to pay for on every frame.
 */

/** A single-channel frame. `luma.length === width * height`. */
export interface FlowFrame {
  width: number;
  height: number;
  luma: Uint8ClampedArray;
}

export interface TrackPoint {
  x: number;
  y: number;
}

export interface TrackResult {
  /** Where the point moved to. Sub-pixel — do not round it away. */
  point: TrackPoint;
  /** 0..1. How much to trust `point`. */
  confidence: number;
  /**
   * True when tracking failed: occluded, left the frame, or a region with too
   * little structure to lock onto. `point` is meaningless when this is set.
   *
   * Separate from a low confidence on purpose. "I followed it but I am unsure"
   * and "there was nothing to follow" call for different handling upstream, and
   * collapsing them into one number loses the difference.
   */
  lost: boolean;
}

/** The rigid motion that best maps one frame onto another — what stabilisation
 * has to undo. Radians; `scale` is 1 when unchanged. */
export interface RigidTransform {
  dx: number;
  dy: number;
  rotationRad: number;
  scale: number;
  confidence: number;
}
