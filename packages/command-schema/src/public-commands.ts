import { z } from "zod";
import {
  audioGainDbSchema,
  audioPanSchema,
  animationKeyframeSchema,
  animationPropertySchema,
  animationTracksSchema,
  transitionSchema,
  transitionSideSchema,
  effectInstanceSchema,
  jsonObjectSchema,
  mediaAssetSchema,
  microsecondStringSchema,
  nonNegativeSafeIntSchema,
  projectSettingsSchema,
  sequenceSchema,
  timelineClipSchema,
  trackSchema,
  clipPlaybackRateSchema,
  clipMaskSchema,
  maskContributionSchema,
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
 * `timelineDurationUs` (derived from the source range), and no `effects`,
 * `animations` or transitions — all of those are created only through their
 * own dedicated commands. */
export const clipInputSchema = timelineClipSchema
  .omit({
    trackId: true,
    timelineDurationUs: true,
    effects: true,
    animations: true,
    transitionIn: true,
    transitionOut: true,
    audioGainDb: true,
    audioPan: true,
  })
  .extend({ playbackRate: clipPlaybackRateSchema })
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

// --- timeline.update_clip_effects -------------------------------------------

/** Replace a clip's entire effect stack in one command (e.g. presets). */
export const updateClipEffectsPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    effects: z.array(effectInstanceSchema),
  })
  .strict();

export const updateClipEffectsCommandSchema = command(
  "timeline.update_clip_effects",
  updateClipEffectsPayloadSchema,
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

// --- timeline masks ---------------------------------------------------------

/** Add a mask to a clip. Masks are geometry, not pixels, so the whole mask
 * travels in the command and replays exactly. */
export const addMaskPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    mask: clipMaskSchema,
  })
  .strict();

export const addMaskCommandSchema = command(
  "timeline.add_mask",
  addMaskPayloadSchema,
);

/** Replace a mask's contribution stack. Editing a gradient's endpoints or
 * adding a subtract contribution is this command, not a remove-and-re-add,
 * so effects keep pointing at the same mask through the edit. */
export const updateMaskPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    maskId: z.string().min(1),
    contributions: z.array(maskContributionSchema).min(1),
    name: z.string().max(80).optional(),
  })
  .strict();

export const updateMaskCommandSchema = command(
  "timeline.update_mask",
  updateMaskPayloadSchema,
);

export const removeMaskPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    maskId: z.string().min(1),
  })
  .strict();

export const removeMaskCommandSchema = command(
  "timeline.remove_mask",
  removeMaskPayloadSchema,
);

/** Point an effect at a mask, or clear the reference with `null`. */
export const setEffectMaskPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    effectId: z.string().min(1),
    maskId: z.string().min(1).nullable(),
  })
  .strict();

export const setEffectMaskCommandSchema = command(
  "timeline.set_effect_mask",
  setEffectMaskPayloadSchema,
);

// --- timeline.set_clip_speed ------------------------------------------------

/** Retime a clip. The reducer recomputes `timelineDurationUs` from the source
 * range and the new rate; the source range itself is untouched, because speed
 * changes how the same frames are spread over the timeline, not which frames
 * are used. */
export const setClipSpeedPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    playbackRate: clipPlaybackRateSchema,
  })
  .strict();

export const setClipSpeedCommandSchema = command(
  "timeline.set_clip_speed",
  setClipSpeedPayloadSchema,
);

// --- timeline animation keyframes ------------------------------------------

export const addKeyframePayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    animationId: z.string().min(1),
    property: animationPropertySchema,
    keyframe: animationKeyframeSchema,
  })
  .strict();

export const addKeyframeCommandSchema = command(
  "timeline.add_keyframe",
  addKeyframePayloadSchema,
);

const keyframeUpdateShape = animationKeyframeSchema.omit({ id: true }).shape;

export const updateKeyframePayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    animationId: z.string().min(1),
    keyframeId: z.string().min(1),
    ...keyframeUpdateShape,
  })
  .strict();

export const updateKeyframeCommandSchema = command(
  "timeline.update_keyframe",
  updateKeyframePayloadSchema,
);

export const removeKeyframePayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    animationId: z.string().min(1),
    keyframeId: z.string().min(1),
  })
  .strict();

export const removeKeyframeCommandSchema = command(
  "timeline.remove_keyframe",
  removeKeyframePayloadSchema,
);

export const updateClipAnimationsPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    animations: animationTracksSchema,
  })
  .strict();

export const updateClipAnimationsCommandSchema = command(
  "timeline.update_clip_animations",
  updateClipAnimationsPayloadSchema,
);

/** One command sets or clears either end's transition: `null` removes it, so
 * add/replace/remove share a single validated shape and a single inverse. */
export const setClipTransitionPayloadSchema = z
  .object({
    sequenceId: z.string().min(1),
    clipId: z.string().min(1),
    side: transitionSideSchema,
    transition: transitionSchema.nullable(),
  })
  .strict();

export const setClipTransitionCommandSchema = command(
  "timeline.set_clip_transition",
  setClipTransitionPayloadSchema,
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
  updateClipEffectsCommandSchema,
  setClipAudioGainCommandSchema,
  setClipAudioPanCommandSchema,
  setClipSpeedCommandSchema,
  addMaskCommandSchema,
  updateMaskCommandSchema,
  removeMaskCommandSchema,
  setEffectMaskCommandSchema,
  addKeyframeCommandSchema,
  updateKeyframeCommandSchema,
  removeKeyframeCommandSchema,
  updateClipAnimationsCommandSchema,
  setClipTransitionCommandSchema,
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
export type UpdateClipEffectsCommand = z.infer<
  typeof updateClipEffectsCommandSchema
>;
export type SetClipAudioGainCommand = z.infer<
  typeof setClipAudioGainCommandSchema
>;
export type SetClipAudioPanCommand = z.infer<
  typeof setClipAudioPanCommandSchema
>;
export type SetClipSpeedCommand = z.infer<typeof setClipSpeedCommandSchema>;
export type AddMaskCommand = z.infer<typeof addMaskCommandSchema>;
export type UpdateMaskCommand = z.infer<typeof updateMaskCommandSchema>;
export type RemoveMaskCommand = z.infer<typeof removeMaskCommandSchema>;
export type SetEffectMaskCommand = z.infer<typeof setEffectMaskCommandSchema>;
export type AddKeyframeCommand = z.infer<typeof addKeyframeCommandSchema>;
export type UpdateKeyframeCommand = z.infer<typeof updateKeyframeCommandSchema>;
export type RemoveKeyframeCommand = z.infer<typeof removeKeyframeCommandSchema>;
export type UpdateClipAnimationsCommand = z.infer<
  typeof updateClipAnimationsCommandSchema
>;
export type SetClipTransitionCommand = z.infer<
  typeof setClipTransitionCommandSchema
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
  "timeline.update_clip_effects",
  "timeline.set_clip_audio_gain",
  "timeline.set_clip_audio_pan",
  "timeline.set_clip_speed",
  "timeline.add_mask",
  "timeline.update_mask",
  "timeline.remove_mask",
  "timeline.set_effect_mask",
  "timeline.add_keyframe",
  "timeline.update_keyframe",
  "timeline.remove_keyframe",
  "timeline.update_clip_animations",
  "timeline.set_clip_transition",
];
