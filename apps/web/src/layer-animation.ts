import { sampleClipAnimations } from "@director/playback-controller";
import type { TimelineClip } from "@director/project-schema";

export interface LayerAnimationTransform {
  positionX: number;
  positionY: number;
  scale: number;
  rotationDegrees: number;
  opacity: number;
}

export interface StaticLayerTransform {
  alpha: number;
  rotateDeg: number;
  flipX: boolean;
  flipY: boolean;
}

export interface CanvasLayerTransform {
  offsetXPx: number;
  offsetYPx: number;
  scaleX: number;
  scaleY: number;
  rotationDegrees: number;
  alpha: number;
}

/** Resolve animation values with identity defaults for unauthored properties. */
export function resolveLayerAnimationTransform(
  clip: Pick<TimelineClip, "animations">,
  localTimeUs: string,
): LayerAnimationTransform {
  const sampled = sampleClipAnimations(clip, localTimeUs);
  return {
    positionX: sampled["transform.position_x"] ?? 0,
    positionY: sampled["transform.position_y"] ?? 0,
    scale: sampled["transform.scale"] ?? 1,
    rotationDegrees: sampled["transform.rotation"] ?? 0,
    opacity: sampled["transform.opacity"] ?? 1,
  };
}

/** Compose static clip effects with sampled animation into Canvas operations.
 * Position is normalized against the output, opacity multiplies, rotation
 * adds, and animation scale preserves static flips through its sign. */
export function composeCanvasLayerTransform(
  staticTransform: StaticLayerTransform,
  animation: LayerAnimationTransform,
  canvasWidth: number,
  canvasHeight: number,
): CanvasLayerTransform {
  return {
    offsetXPx: animation.positionX * canvasWidth,
    offsetYPx: animation.positionY * canvasHeight,
    scaleX: animation.scale * (staticTransform.flipX ? -1 : 1),
    scaleY: animation.scale * (staticTransform.flipY ? -1 : 1),
    rotationDegrees: staticTransform.rotateDeg + animation.rotationDegrees,
    alpha: staticTransform.alpha * animation.opacity,
  };
}

/** Convert absolute timeline time to clip-local time without Number precision
 * loss. Active clips should never produce a negative offset. */
export function clipLocalTimeUs(
  timelineTimeUs: string,
  timelineStartUs: string,
): string {
  const localTime = BigInt(timelineTimeUs) - BigInt(timelineStartUs);
  if (localTime < 0n) {
    throw new RangeError("timeline time is before clip start");
  }
  return localTime.toString();
}
