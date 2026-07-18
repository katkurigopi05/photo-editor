import { z } from "zod";
import {
  audioGainDbSchema,
  audioPanSchema,
  effectInstanceSchema,
  jsonObjectSchema,
  mediaAssetSchema,
  microsecondStringSchema,
  nonNegativeSafeIntSchema,
  projectSettingsSchema,
  sequenceSchema,
  timelineClipSchema,
  trackSchema,
  unitPlaybackRateSchema,
} from "@director/project-schema";
import { envelopeBaseShape } from "./envelope.js";

/**
 * A command envelope for a specific command type. Every command is a member of
 * a discriminated union keyed on `commandType`, with a Zod-validated payload.
 */
function command<Type extends string, Payload extends z.ZodTypeAny>(
  commandType: Type,
  payload: Payload,
) {
  return z
    .object({
      ...envelopeBaseShape,
      commandType: z.literal(commandType),
      payload,
    })
    .strict();
}

// --- project.create ---------------------------------------------------------

export const projectCreatePayloadSchema = z
  .object({
    projectId: z.string().min(1),
    ownerId: z.string().min(1),
    name: z.string(),
    settings: projectSettingsSchema,
  })
  .strict();

export const projectCreateCommandSchema = command(
  "project.create",
  projectCreatePayloadSchema,
);

// --- asset.register ---------------------------------------------------------

export const assetRegisterPayloadSchema = z
  .object({ asset: mediaAssetSchema })
  .strict();

export const assetRegisterCommandSchema = command(
  "asset.register",
  assetRegisterPayloadSchema,
);

// --- timeline.create_sequence ----------------------------------------------

export const sequenceInputSchema = sequenceSchema.omit({ tracks: true });

export const createSequencePayloadSchema = z
  .object({ sequence: sequenceInputSchema })
  .strict();

export const createSequenceCommandSchema = command(
  "timeline.create_sequence",
  createSequencePayloadSchema,
);

// --- timeline.add_track -----------------------------------------------------

export const trackInputSchema = trackSchema.omit({ clips: true });

export const addTrackPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    track: trackInputSchema,
  })
  .strict();

export const addTrackCommandSchema = command(
  "timeline.add_track",
  addTrackPayloadSchema,
);

// --- timeline.add_clip ------------------------------------------------------

/** Clip input: no `trackId` (taken from payload), no caller-supplied
 * `timelineDurationUs` (derived from the source range), and no `effects`
 * (a clip is created with an empty effect stack; effects are added by command). */
export const clipInputSchema = timelineClipSchema
  .omit({
    trackId: true,
    timelineDurationUs: true,
    effects: true,
    audioGainDb: true,
    audioPan: true,
  })
  .extend({ playbackRate: unitPlaybackRateSchema })
  .strict();

export const addClipPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    trackId: z.string().min(1),
    clip: clipInputSchema,
    insertionIndex: nonNegativeSafeIntSchema.optional(),
  })
  .strict();

export const addClipCommandSchema = command(
  "timeline.add_clip",
  addClipPayloadSchema,
);

// --- timeline.move_clip -----------------------------------------------------

export const moveClipPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    targetTrackId: z.string().min(1),
    timelineStartUs: microsecondStringSchema,
  })
  .strict();

export const moveClipCommandSchema = command(
  "timeline.move_clip",
  moveClipPayloadSchema,
);

// --- timeline.trim_clip -----------------------------------------------------

export const trimClipPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    sourceInUs: microsecondStringSchema,
    sourceOutUs: microsecondStringSchema,
  })
  .strict();

export const trimClipCommandSchema = command(
  "timeline.trim_clip",
  trimClipPayloadSchema,
);

// --- timeline.delete_clip ---------------------------------------------------

export const deleteClipPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
  })
  .strict();

export const deleteClipCommandSchema = command(
  "timeline.delete_clip",
  deleteClipPayloadSchema,
);

// --- timeline.add_effect ----------------------------------------------------

export const addEffectPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    effect: effectInstanceSchema,
  })
  .strict();

export const addEffectCommandSchema = command(
  "timeline.add_effect",
  addEffectPayloadSchema,
);

// --- timeline.update_effect_params ------------------------------------------

/** New params are validated against the target effect's type in the reducer,
 * so the payload only asserts a JSON-native params object here. */
export const updateEffectParamsPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    effectId: z.string().min(1),
    params: jsonObjectSchema,
  })
  .strict();

export const updateEffectParamsCommandSchema = command(
  "timeline.update_effect_params",
  updateEffectParamsPayloadSchema,
);

// --- timeline.remove_effect -------------------------------------------------

export const removeEffectPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    effectId: z.string().min(1),
  })
  .strict();

export const removeEffectCommandSchema = command(
  "timeline.remove_effect",
  removeEffectPayloadSchema,
);

// --- timeline.reorder_effects -----------------------------------------------

/** `order` is the new full ordering of the clip's effect ids (a permutation of
 * the existing effect ids). */
export const reorderEffectsPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    order: z.array(z.string().min(1)),
  })
  .strict();

export const reorderEffectsCommandSchema = command(
  "timeline.reorder_effects",
  reorderEffectsPayloadSchema,
);

// --- timeline.set_clip_audio_gain -------------------------------------------

export const setClipAudioGainPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    gainDb: audioGainDbSchema,
  })
  .strict();

export const setClipAudioGainCommandSchema = command(
  "timeline.set_clip_audio_gain",
  setClipAudioGainPayloadSchema,
);

// --- timeline.set_clip_audio_pan --------------------------------------------

export const setClipAudioPanPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    pan: audioPanSchema,
  })
  .strict();

export const setClipAudioPanCommandSchema = command(
  "timeline.set_clip_audio_pan",
  setClipAudioPanPayloadSchema,
);

// --- discriminated union ----------------------------------------------------

export const projectCommandSchema = z.discriminatedUnion("commandType", [
  projectCreateCommandSchema,
  assetRegisterCommandSchema,
  createSequenceCommandSchema,
  addTrackCommandSchema,
  addClipCommandSchema,
  moveClipCommandSchema,
  trimClipCommandSchema,
  deleteClipCommandSchema,
  addEffectCommandSchema,
  updateEffectParamsCommandSchema,
  removeEffectCommandSchema,
  reorderEffectsCommandSchema,
  setClipAudioGainCommandSchema,
  setClipAudioPanCommandSchema,
]);

export type ProjectCommand = z.infer<typeof projectCommandSchema>;
export type ProjectCreateCommand = z.infer<typeof projectCreateCommandSchema>;
export type AssetRegisterCommand = z.infer<typeof assetRegisterCommandSchema>;
export type CreateSequenceCommand = z.infer<typeof createSequenceCommandSchema>;
export type AddTrackCommand = z.infer<typeof addTrackCommandSchema>;
export type AddClipCommand = z.infer<typeof addClipCommandSchema>;
export type MoveClipCommand = z.infer<typeof moveClipCommandSchema>;
export type TrimClipCommand = z.infer<typeof trimClipCommandSchema>;
export type DeleteClipCommand = z.infer<typeof deleteClipCommandSchema>;
export type AddEffectCommand = z.infer<typeof addEffectCommandSchema>;
export type UpdateEffectParamsCommand = z.infer<
  typeof updateEffectParamsCommandSchema
>;
export type RemoveEffectCommand = z.infer<typeof removeEffectCommandSchema>;
export type ReorderEffectsCommand = z.infer<typeof reorderEffectsCommandSchema>;
export type SetClipAudioGainCommand = z.infer<
  typeof setClipAudioGainCommandSchema
>;
export type SetClipAudioPanCommand = z.infer<
  typeof setClipAudioPanCommandSchema
>;

export type PublicCommandType = ProjectCommand["commandType"];

export const PUBLIC_COMMAND_TYPES: readonly PublicCommandType[] = [
  "project.create",
  "asset.register",
  "timeline.create_sequence",
  "timeline.add_track",
  "timeline.add_clip",
  "timeline.move_clip",
  "timeline.trim_clip",
  "timeline.delete_clip",
  "timeline.add_effect",
  "timeline.update_effect_params",
  "timeline.remove_effect",
  "timeline.reorder_effects",
  "timeline.set_clip_audio_gain",
  "timeline.set_clip_audio_pan",
];
