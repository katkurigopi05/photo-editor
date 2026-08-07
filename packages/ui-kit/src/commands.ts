import type {
  AddClipCommand,
  AddEffectCommand,
  AddKeyframeCommand,
  AddTrackCommand,
  AssetRegisterCommand,
  CreateSequenceCommand,
  DeleteClipCommand,
  MoveClipCommand,
  ProjectCommand,
  ProjectCreateCommand,
  RemoveEffectCommand,
  RemoveKeyframeCommand,
  ReorderEffectsCommand,
  SetClipAudioGainCommand,
  SetClipAudioPanCommand,
  SetClipSpeedCommand,
  TrimClipCommand,
  UpdateClipEffectsCommand,
  UpdateClipAnimationsCommand,
  SetClipTransitionCommand,
  UpdateEffectParamsCommand,
  UpdateKeyframeCommand,
} from "@director/command-schema";

/**
 * Command builders: pure functions that turn UI intent into a fully-formed
 * command envelope. Identity and time are supplied by the caller (a
 * `CommandContext`) — nothing here reads the clock or generates IDs, so the UI
 * boundary stays deterministic and testable, and Rule 6 is preserved.
 */
export interface CommandContext {
  id: string;
  createdAt: string;
  actor: { type: "user" | "agent" | "system"; id: string };
  baseVersion: number;
}

function envelope<T extends ProjectCommand>(
  ctx: CommandContext,
  commandType: T["commandType"],
  payload: T["payload"],
): T {
  return {
    id: ctx.id,
    commandType,
    baseVersion: ctx.baseVersion,
    actor: ctx.actor,
    createdAt: ctx.createdAt,
    payload,
  } as T;
}

export const buildCreateProject = (
  ctx: CommandContext,
  payload: ProjectCreateCommand["payload"],
): ProjectCreateCommand => envelope(ctx, "project.create", payload);

export const buildRegisterAsset = (
  ctx: CommandContext,
  payload: AssetRegisterCommand["payload"],
): AssetRegisterCommand => envelope(ctx, "asset.register", payload);

export const buildCreateSequence = (
  ctx: CommandContext,
  payload: CreateSequenceCommand["payload"],
): CreateSequenceCommand => envelope(ctx, "timeline.create_sequence", payload);

export const buildAddTrack = (
  ctx: CommandContext,
  payload: AddTrackCommand["payload"],
): AddTrackCommand => envelope(ctx, "timeline.add_track", payload);

export const buildAddClip = (
  ctx: CommandContext,
  payload: AddClipCommand["payload"],
): AddClipCommand => envelope(ctx, "timeline.add_clip", payload);

export const buildMoveClip = (
  ctx: CommandContext,
  payload: MoveClipCommand["payload"],
): MoveClipCommand => envelope(ctx, "timeline.move_clip", payload);

export const buildTrimClip = (
  ctx: CommandContext,
  payload: TrimClipCommand["payload"],
): TrimClipCommand => envelope(ctx, "timeline.trim_clip", payload);

export const buildDeleteClip = (
  ctx: CommandContext,
  payload: DeleteClipCommand["payload"],
): DeleteClipCommand => envelope(ctx, "timeline.delete_clip", payload);

export const buildAddEffect = (
  ctx: CommandContext,
  payload: AddEffectCommand["payload"],
): AddEffectCommand => envelope(ctx, "timeline.add_effect", payload);

export const buildUpdateEffectParams = (
  ctx: CommandContext,
  payload: UpdateEffectParamsCommand["payload"],
): UpdateEffectParamsCommand =>
  envelope(ctx, "timeline.update_effect_params", payload);

export const buildRemoveEffect = (
  ctx: CommandContext,
  payload: RemoveEffectCommand["payload"],
): RemoveEffectCommand => envelope(ctx, "timeline.remove_effect", payload);

export const buildReorderEffects = (
  ctx: CommandContext,
  payload: ReorderEffectsCommand["payload"],
): ReorderEffectsCommand => envelope(ctx, "timeline.reorder_effects", payload);

export const buildUpdateClipEffects = (
  ctx: CommandContext,
  payload: UpdateClipEffectsCommand["payload"],
): UpdateClipEffectsCommand =>
  envelope(ctx, "timeline.update_clip_effects", payload);

export const buildSetClipAudioGain = (
  ctx: CommandContext,
  payload: SetClipAudioGainCommand["payload"],
): SetClipAudioGainCommand =>
  envelope(ctx, "timeline.set_clip_audio_gain", payload);

export const buildSetClipAudioPan = (
  ctx: CommandContext,
  payload: SetClipAudioPanCommand["payload"],
): SetClipAudioPanCommand =>
  envelope(ctx, "timeline.set_clip_audio_pan", payload);

export const buildSetClipSpeed = (
  ctx: CommandContext,
  payload: SetClipSpeedCommand["payload"],
): SetClipSpeedCommand => envelope(ctx, "timeline.set_clip_speed", payload);

export const buildAddKeyframe = (
  ctx: CommandContext,
  payload: AddKeyframeCommand["payload"],
): AddKeyframeCommand => envelope(ctx, "timeline.add_keyframe", payload);

export const buildUpdateKeyframe = (
  ctx: CommandContext,
  payload: UpdateKeyframeCommand["payload"],
): UpdateKeyframeCommand => envelope(ctx, "timeline.update_keyframe", payload);

export const buildRemoveKeyframe = (
  ctx: CommandContext,
  payload: RemoveKeyframeCommand["payload"],
): RemoveKeyframeCommand => envelope(ctx, "timeline.remove_keyframe", payload);

export const buildUpdateClipAnimations = (
  ctx: CommandContext,
  payload: UpdateClipAnimationsCommand["payload"],
): UpdateClipAnimationsCommand =>
  envelope(ctx, "timeline.update_clip_animations", payload);

export const buildSetClipTransition = (
  ctx: CommandContext,
  payload: SetClipTransitionCommand["payload"],
): SetClipTransitionCommand =>
  envelope(ctx, "timeline.set_clip_transition", payload);
