import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addClipPayloadSchema,
  addEffectPayloadSchema,
  addTrackPayloadSchema,
  assetRegisterPayloadSchema,
  createSequencePayloadSchema,
  deleteClipPayloadSchema,
  moveClipPayloadSchema,
  projectCreatePayloadSchema,
  removeEffectPayloadSchema,
  reorderEffectsPayloadSchema,
  setClipAudioGainPayloadSchema,
  setClipAudioPanPayloadSchema,
  trimClipPayloadSchema,
  updateClipEffectsPayloadSchema,
  updateEffectParamsPayloadSchema,
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
];

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
