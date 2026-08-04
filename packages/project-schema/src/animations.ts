import { z } from "zod";
import { microsecondStringSchema } from "./primitives.js";

/** MVP properties that both Canvas preview and frame-by-frame export can
 * evaluate without browser state or I/O. Position values are normalized
 * offsets relative to the output width/height. */
export const ANIMATION_PROPERTIES = [
  "transform.position_x",
  "transform.position_y",
  "transform.scale",
  "transform.rotation",
  "transform.opacity",
] as const;

export const animationPropertySchema = z.enum(ANIMATION_PROPERTIES);
export type AnimationProperty = z.infer<typeof animationPropertySchema>;

export const ANIMATION_EASINGS = [
  "linear",
  "hold",
  "ease-in",
  "ease-out",
  "ease-in-out",
] as const;

export const animationEasingSchema = z.enum(ANIMATION_EASINGS);
export type AnimationEasing = z.infer<typeof animationEasingSchema>;

const finiteNumberSchema = z
  .number()
  .refine(Number.isFinite, "value must be a finite number");

export const animationKeyframeSchema = z
  .object({
    id: z.string().min(1),
    timeUs: microsecondStringSchema,
    value: finiteNumberSchema,
    easing: animationEasingSchema,
  })
  .strict();
export type AnimationKeyframe = z.infer<typeof animationKeyframeSchema>;

const PROPERTY_RANGES: Record<
  AnimationProperty,
  { readonly min: number; readonly max: number }
> = {
  "transform.position_x": { min: -2, max: 2 },
  "transform.position_y": { min: -2, max: 2 },
  "transform.scale": { min: 0.01, max: 20 },
  "transform.rotation": { min: -3600, max: 3600 },
  "transform.opacity": { min: 0, max: 1 },
};

export const animationTrackSchema = z
  .object({
    id: z.string().min(1),
    property: animationPropertySchema,
    keyframes: z.array(animationKeyframeSchema).min(1),
  })
  .strict()
  .superRefine((track, ctx) => {
    const range = PROPERTY_RANGES[track.property];
    let previousTime: bigint | undefined;

    track.keyframes.forEach((keyframe, index) => {
      const time = BigInt(keyframe.timeUs);
      if (previousTime !== undefined && time <= previousTime) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "keyframe times must be strictly increasing",
          path: ["keyframes", index, "timeUs"],
        });
      }
      previousTime = time;

      if (keyframe.value < range.min || keyframe.value > range.max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${track.property} value must be between ${range.min} and ${range.max}`,
          path: ["keyframes", index, "value"],
        });
      }
    });
  });
export type AnimationTrack = z.infer<typeof animationTrackSchema>;

/** One track per property keeps evaluation unambiguous. IDs are unique within
 * a clip so later commands can address tracks and keyframes deterministically. */
export const animationTracksSchema = z
  .array(animationTrackSchema)
  .superRefine((tracks, ctx) => {
    const trackIds = new Set<string>();
    const properties = new Set<AnimationProperty>();
    const keyframeIds = new Set<string>();

    tracks.forEach((track, trackIndex) => {
      if (trackIds.has(track.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "animation track ids must be unique within a clip",
          path: [trackIndex, "id"],
        });
      }
      trackIds.add(track.id);

      if (properties.has(track.property)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "animation properties must be unique within a clip",
          path: [trackIndex, "property"],
        });
      }
      properties.add(track.property);

      track.keyframes.forEach((keyframe, keyframeIndex) => {
        if (keyframeIds.has(keyframe.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "keyframe ids must be unique within a clip",
            path: [trackIndex, "keyframes", keyframeIndex, "id"],
          });
        }
        keyframeIds.add(keyframe.id);
      });
    });
  });
export type AnimationTracks = z.infer<typeof animationTracksSchema>;
