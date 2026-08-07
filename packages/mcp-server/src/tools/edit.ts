import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addClipPayloadSchema,
  addEffectPayloadSchema,
  addKeyframePayloadSchema,
  addTrackPayloadSchema,
  assetRegisterPayloadSchema,
  createSequencePayloadSchema,
  deleteClipPayloadSchema,
  moveClipPayloadSchema,
  projectCreatePayloadSchema,
  removeEffectPayloadSchema,
  removeKeyframePayloadSchema,
  reorderEffectsPayloadSchema,
  setClipAudioGainPayloadSchema,
  setClipAudioPanPayloadSchema,
  setAssetRatingPayloadSchema,
  setClipSpeedPayloadSchema,
  addMaskPayloadSchema,
  updateMaskPayloadSchema,
  removeMaskPayloadSchema,
  setEffectMaskPayloadSchema,
  setClipTransitionPayloadSchema,
  trimClipPayloadSchema,
  updateClipAnimationsPayloadSchema,
  updateClipEffectsPayloadSchema,
  updateEffectParamsPayloadSchema,
  updateKeyframePayloadSchema,
} from "@director/command-schema";
import type { z } from "zod";

import type { ProjectSession } from "../session.js";
import { asJson } from "./format.js";

/**
 * Editing tools — one per public command.
 *
 * Each tool's input schema *is* the command's payload schema, taken straight
 * from @director/command-schema. Hand-writing a parallel set of shapes here
 * would drift the moment a command gains a field, and would let this server
 * accept payloads the engine rejects. The engine still validates on dispatch;
 * this just means the agent sees the real contract up front.
 */

interface CommandTool {
  name: string;
  commandType: string;
  title: string;
  description: string;
  // Payload schemas are all `.strict()` objects, so `.shape` is the tool input.
  schema: z.ZodObject<z.ZodRawShape>;
}

const COMMAND_TOOLS: CommandTool[] = [
  {
    name: "create_project",
    commandType: "project.create",
    title: "Create project",
    description:
      "Create the project inside the open file. Must be called once before " +
      "any other editing tool; fails if a project already exists.",
    schema: projectCreatePayloadSchema,
  },
  {
    name: "register_asset",
    commandType: "asset.register",
    title: "Register a media asset",
    description:
      "Register source media (image, video or audio) so clips can reference " +
      "it. Registering does not place anything on the timeline.",
    schema: assetRegisterPayloadSchema,
  },
  {
    name: "create_sequence",
    commandType: "timeline.create_sequence",
    title: "Create sequence",
    description:
      "Add a sequence (a timeline) to the project. Tracks are added " +
      "separately with add_track.",
    schema: createSequencePayloadSchema,
  },
  {
    name: "add_track",
    commandType: "timeline.add_track",
    title: "Add track",
    description: "Add a video or audio track to a sequence.",
    schema: addTrackPayloadSchema,
  },
  {
    name: "set_asset_rating",
    commandType: "asset.set_rating",
    title: "Rate an imported asset",
    description:
      "Mark an asset as 'favorite' or 'rejected', or pass null to clear the " +
      "rating. Ratings organise the media bin and never touch the original " +
      "file or any clip already on the timeline.",
    schema: setAssetRatingPayloadSchema,
  },
  {
    name: "add_clip",
    commandType: "timeline.add_clip",
    title: "Add clip",
    description:
      "Place a clip on a track. Timeline duration is derived from the source " +
      "range and playback rate, so it is not supplied here.",
    schema: addClipPayloadSchema,
  },
  {
    name: "move_clip",
    commandType: "timeline.move_clip",
    title: "Move clip",
    description:
      "Move a clip to a new start time and/or a different track. Times are " +
      "microseconds as decimal strings.",
    schema: moveClipPayloadSchema,
  },
  {
    name: "trim_clip",
    commandType: "timeline.trim_clip",
    title: "Trim clip",
    description:
      "Change a clip's in/out points within its source media. Non-destructive.",
    schema: trimClipPayloadSchema,
  },
  {
    name: "delete_clip",
    commandType: "timeline.delete_clip",
    title: "Delete clip",
    description: "Remove a clip from its sequence. Undoable like any command.",
    schema: deleteClipPayloadSchema,
  },
  {
    name: "add_effect",
    commandType: "timeline.add_effect",
    title: "Add effect",
    description:
      "Append an effect to a clip's effect stack. Order matters: effects are " +
      "applied in stack order.",
    schema: addEffectPayloadSchema,
  },
  {
    name: "update_effect_params",
    commandType: "timeline.update_effect_params",
    title: "Update effect parameters",
    description: "Change the parameters of an effect already on a clip.",
    schema: updateEffectParamsPayloadSchema,
  },
  {
    name: "remove_effect",
    commandType: "timeline.remove_effect",
    title: "Remove effect",
    description: "Remove one effect from a clip's stack.",
    schema: removeEffectPayloadSchema,
  },
  {
    name: "reorder_effects",
    commandType: "timeline.reorder_effects",
    title: "Reorder effects",
    description:
      "Reorder a clip's effect stack, which changes the result because " +
      "effects compose in order.",
    schema: reorderEffectsPayloadSchema,
  },
  {
    name: "update_clip_effects",
    commandType: "timeline.update_clip_effects",
    title: "Replace a clip's effect stack",
    description:
      "Replace a clip's whole effect stack in one command. Prefer the " +
      "targeted tools unless you are applying a preset wholesale.",
    schema: updateClipEffectsPayloadSchema,
  },
  {
    name: "set_clip_audio_gain",
    commandType: "timeline.set_clip_audio_gain",
    title: "Set clip gain",
    description: "Set a clip's audio gain in decibels.",
    schema: setClipAudioGainPayloadSchema,
  },
  {
    name: "set_clip_audio_pan",
    commandType: "timeline.set_clip_audio_pan",
    title: "Set clip pan",
    description: "Set a clip's stereo pan, -1 (left) to 1 (right).",
    schema: setClipAudioPanPayloadSchema,
  },
  {
    name: "set_clip_speed",
    commandType: "timeline.set_clip_speed",
    title: "Retime a clip",
    description:
      "Set a clip's playback rate as a reduced rational: 2/1 plays twice as " +
      "fast and occupies half the timeline, 1/2 half as fast and twice the " +
      "timeline. Supported between 1/4 and 4. The source range is unchanged; " +
      "slowing a clip fails with OVERLAP if the clip after it is in the way.",
    schema: setClipSpeedPayloadSchema,
  },
  {
    name: "add_mask",
    commandType: "timeline.add_mask",
    title: "Add a mask to a clip",
    description:
      "Add a mask: a named stack of contributions (linear or radial gradient, " +
      "brush stroke, luminance range, colour range) combined with add, " +
      "subtract or intersect. Coordinates are normalized 0-1 against the " +
      "frame, so a mask means the same region at any output size. Effects " +
      "reference a mask by id via set_effect_mask.",
    schema: addMaskPayloadSchema,
  },
  {
    name: "update_mask",
    commandType: "timeline.update_mask",
    title: "Replace a mask's contributions",
    description:
      "Replace a mask's contribution stack in place, keeping its id so any " +
      "effect referencing it follows the edit.",
    schema: updateMaskPayloadSchema,
  },
  {
    name: "remove_mask",
    commandType: "timeline.remove_mask",
    title: "Remove a mask",
    description:
      "Delete a mask. Fails with MASK_IN_USE while an effect still references " +
      "it; clear the reference with set_effect_mask first.",
    schema: removeMaskPayloadSchema,
  },
  {
    name: "set_effect_mask",
    commandType: "timeline.set_effect_mask",
    title: "Confine an effect to a mask",
    description:
      "Point an effect at one of the clip's masks, or pass null to make it " +
      "global again. Masked effects apply only where the mask covers, " +
      "blending by its coverage.",
    schema: setEffectMaskPayloadSchema,
  },
  {
    name: "add_keyframe",
    commandType: "timeline.add_keyframe",
    title: "Add an animation keyframe",
    description:
      "Add a keyframe to a clip's animation track, creating the track if the " +
      "property has none yet. Times are clip-local microseconds, not timeline " +
      "time, and must fall within the clip's duration.",
    schema: addKeyframePayloadSchema,
  },
  {
    name: "update_keyframe",
    commandType: "timeline.update_keyframe",
    title: "Update an animation keyframe",
    description:
      "Change an existing keyframe's time, value or easing. A keyframe's " +
      "easing governs the segment leaving it.",
    schema: updateKeyframePayloadSchema,
  },
  {
    name: "remove_keyframe",
    commandType: "timeline.remove_keyframe",
    title: "Remove an animation keyframe",
    description:
      "Delete one keyframe. Removing the last keyframe of a track removes the " +
      "track with it.",
    schema: removeKeyframePayloadSchema,
  },
  {
    name: "update_clip_animations",
    commandType: "timeline.update_clip_animations",
    title: "Replace a clip's animation",
    description:
      "Replace every animation track on a clip in one command — how the Auto " +
      "Motion presets are applied, and how one undo removes a whole preset. " +
      "An empty array clears the clip's animation.",
    schema: updateClipAnimationsPayloadSchema,
  },
  {
    name: "set_clip_transition",
    commandType: "timeline.set_clip_transition",
    title: "Set or clear a clip transition",
    description:
      "Attach a transition to one end of a clip, or pass null to remove it. " +
      "A transition is a timed ramp: `cross` fades, `slide` moves the clip " +
      "in from a direction, and `dip` ramps against its own colour. " +
      "transitionIn + transitionOut cannot exceed the clip's duration.",
    schema: setClipTransitionPayloadSchema,
  },
];

/**
 * The command types this module turns into tools.
 *
 * Exported so a test can assert it against `PUBLIC_COMMAND_TYPES`. Each tool's
 * *input schema* is the command's payload schema, so a command that gains a
 * field gains it here automatically — but a wholly new command still needs an
 * entry above, and nothing else notices when one is forgotten. Animation and
 * transition editing shipped for a week with no tools for exactly that reason.
 */
export const EDIT_TOOL_COMMAND_TYPES: readonly string[] = COMMAND_TOOLS.map(
  (tool) => tool.commandType,
);

/** Tool names, for the same coverage check. */
export const EDIT_TOOL_NAMES: readonly string[] = COMMAND_TOOLS.map(
  (tool) => tool.name,
);

export function registerEditTools(
  server: McpServer,
  session: ProjectSession,
): void {
  for (const tool of COMMAND_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema.shape,
      },
      async (args: Record<string, unknown>) => {
        session.requirePath();
        const context = session.context();
        const outcome = await session.dispatch({
          id: context.id,
          commandType: tool.commandType,
          baseVersion: context.baseVersion,
          actor: context.actor,
          createdAt: context.createdAt,
          payload: args,
        });
        return asJson(outcome, !outcome.ok);
      },
    );
  }

  server.registerTool(
    "undo",
    {
      title: "Undo",
      description:
        "Undo the most recent operation and save. The redo stack is in-memory " +
        "only, so redo is unavailable after the project is reopened.",
      inputSchema: {},
    },
    async () => {
      session.requirePath();
      const outcome = await session.undo();
      return asJson(outcome, !outcome.ok);
    },
  );

  server.registerTool(
    "redo",
    {
      title: "Redo",
      description: "Reapply the most recently undone operation and save.",
      inputSchema: {},
    },
    async () => {
      session.requirePath();
      const outcome = await session.redo();
      return asJson(outcome, !outcome.ok);
    },
  );
}
