import { z } from "zod";
import {
  audioGainDbSchema,
  audioPanSchema,
  effectInstanceSchema,
  isoInstantSchema,
  jsonObjectSchema,
  microsecondStringSchema,
  nonNegativeSafeIntSchema,
  timelineClipSchema,
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

export const internalCommandSchema = z.discriminatedUnion("commandType", [
  removeProjectInverseSchema,
  removeAssetInverseSchema,
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
]);

export type InternalProjectCommand = z.infer<typeof internalCommandSchema>;
export type InternalCommandType = InternalProjectCommand["commandType"];
