import { z } from "zod";
import {
  audioGainDbSchema,
  audioPanSchema,
  assetRatingSchema,
  animationTracksSchema,
  transitionSchema,
  transitionSideSchema,
  effectInstanceSchema,
  isoInstantSchema,
  jsonObjectSchema,
  microsecondStringSchema,
  nonNegativeSafeIntSchema,
  timelineClipSchema,
  clipPlaybackRateSchema,
  clipMasksSchema,
  clipMarkersSchema,
} from "@director/project-schema";

/**
 * Internal inverse commands. These are never accepted from untrusted public
 * input (`executeCommand` rejects them); they exist only as the recorded
 * inverse of a forward operation and are applied during undo.
 *
 * `restoreUpdatedAt` carries the project's `updatedAt` value from immediately
 * before the forward command applied, so undo restores prior state exactly
 * (byte for byte) without embedding a full-project snapshot.
 */

function internal<Type extends string, Payload extends z.ZodTypeAny>(
  commandType: Type,
  payload: Payload,
) {
  return z
    .object({
      commandType: z.literal(commandType),
      payload,
    })
    .strict();
}

export const removeProjectInverseSchema = internal(
  "internal.remove_project",
  z.object({}).strict(),
);

export const removeAssetInverseSchema = internal(
  "internal.remove_asset",
  z
    .object({
      assetId: z.string().min(1),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

/** `null` restores an asset that had no rating member. */
export const setAssetRatingInverseSchema = internal(
  "internal.set_asset_rating",
  z
    .object({
      assetId: z.string().min(1),
      rating: assetRatingSchema.nullable(),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const removeSequenceInverseSchema = internal(
  "internal.remove_sequence",
  z
    .object({
      sequenceId: z.string().min(1),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const removeTrackInverseSchema = internal(
  "internal.remove_track",
  z
    .object({
      sequenceId: z.string().min(1),
      trackId: z.string().min(1),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const removeClipInverseSchema = internal(
  "internal.remove_clip",
  z
    .object({
      sequenceId: z.string().min(1),
      trackId: z.string().min(1),
      clipId: z.string().min(1),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const insertClipInverseSchema = internal(
  "internal.insert_clip",
  z
    .object({
      sequenceId: z.string().min(1),
      trackId: z.string().min(1),
      clip: timelineClipSchema,
      insertionIndex: nonNegativeSafeIntSchema,
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const moveClipInverseSchema = internal(
  "internal.move_clip",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      targetTrackId: z.string().min(1),
      timelineStartUs: microsecondStringSchema,
      insertionIndex: nonNegativeSafeIntSchema,
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const setClipSourceInverseSchema = internal(
  "internal.set_clip_source",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      sourceInUs: microsecondStringSchema,
      sourceOutUs: microsecondStringSchema,
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const removeEffectInverseSchema = internal(
  "internal.remove_effect",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      effectId: z.string().min(1),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const insertEffectInverseSchema = internal(
  "internal.insert_effect",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      effect: effectInstanceSchema,
      insertionIndex: nonNegativeSafeIntSchema,
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const setEffectParamsInverseSchema = internal(
  "internal.set_effect_params",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      effectId: z.string().min(1),
      params: jsonObjectSchema,
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const reorderEffectsInverseSchema = internal(
  "internal.reorder_effects",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      order: z.array(z.string().min(1)),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const setClipEffectsInverseSchema = internal(
  "internal.set_clip_effects",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      effects: z.array(effectInstanceSchema),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const setClipAudioGainInverseSchema = internal(
  "internal.set_clip_audio_gain",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      gainDb: audioGainDbSchema,
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

/** Restores a clip's rate *and* the duration derived from it: recomputing the
 * duration on undo would repeat the truncation the forward command did. */
/** Restores a clip's whole marker list. Same reasoning as the mask inverse:
 * the list is small, and carrying it entire keeps undo exact — including the
 * difference between no markers and an empty list. `null` restores the absent
 * member. */
export const setClipMarkersInverseSchema = internal(
  "internal.set_clip_markers",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      markers: clipMarkersSchema.nullable(),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

/** Restores a clip's whole mask list. One inverse for every mask command: the
 * list is small geometry, and carrying it entire is what makes undo exact
 * without a per-command reconstruction rule. `null` restores "no masks at all",
 * which is not the same as an empty array. */
export const setClipMasksInverseSchema = internal(
  "internal.set_clip_masks",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      masks: clipMasksSchema.nullable(),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

/** Restores one effect's mask reference. */
export const setEffectMaskInverseSchema = internal(
  "internal.set_effect_mask",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      effectId: z.string().min(1),
      maskId: z.string().min(1).nullable(),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const setClipSpeedInverseSchema = internal(
  "internal.set_clip_speed",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      playbackRate: clipPlaybackRateSchema,
      timelineDurationUs: microsecondStringSchema,
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const setClipAudioPanInverseSchema = internal(
  "internal.set_clip_audio_pan",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      pan: audioPanSchema,
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

/** `null` restores a schema-v1 clip where the optional animations member was
 * absent. An array restores a materialized member, including an empty array. */
export const setClipAnimationsInverseSchema = internal(
  "internal.set_clip_animations",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      animations: animationTracksSchema.nullable(),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

/** `null` restores a clip end that carried no transition, mirroring how
 * `internal.set_clip_animations` restores an absent optional member. */
export const setClipTransitionInverseSchema = internal(
  "internal.set_clip_transition",
  z
    .object({
      sequenceId: z.string().min(1),
      clipId: z.string().min(1),
      side: transitionSideSchema,
      transition: transitionSchema.nullable(),
      restoreUpdatedAt: isoInstantSchema,
    })
    .strict(),
);

export const internalCommandSchema = z.discriminatedUnion("commandType", [
  removeProjectInverseSchema,
  removeAssetInverseSchema,
  setAssetRatingInverseSchema,
  removeSequenceInverseSchema,
  removeTrackInverseSchema,
  removeClipInverseSchema,
  insertClipInverseSchema,
  moveClipInverseSchema,
  setClipSourceInverseSchema,
  removeEffectInverseSchema,
  insertEffectInverseSchema,
  setEffectParamsInverseSchema,
  reorderEffectsInverseSchema,
  setClipEffectsInverseSchema,
  setClipAudioGainInverseSchema,
  setClipAudioPanInverseSchema,
  setClipSpeedInverseSchema,
  setClipMarkersInverseSchema,
  setClipMasksInverseSchema,
  setEffectMaskInverseSchema,
  setClipAnimationsInverseSchema,
  setClipTransitionInverseSchema,
]);

export type InternalProjectCommand = z.infer<typeof internalCommandSchema>;
export type InternalCommandType = InternalProjectCommand["commandType"];
