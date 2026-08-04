import { describe, expect, it } from "vitest";
import {
  buildAddClip,
  buildAddKeyframe,
  buildRemoveKeyframe,
  buildTrimClip,
  buildUpdateKeyframe,
  buildUpdateClipAnimations,
  type CommandContext,
} from "../src/index.js";

const ctx: CommandContext = {
  id: "00000000-0000-4000-8000-000000000010",
  createdAt: "2026-01-01T00:00:00.000Z",
  actor: { type: "user", id: "user-1" },
  baseVersion: 4,
};

describe("command builders (UI action -> command shape)", () => {
  it("buildAddClip produces the exact envelope + payload", () => {
    const payload = {
      sequenceId: "sequence-1",
      trackId: "track-1",
      clip: {
        id: "clip-1",
        assetId: "asset-1",
        timelineStartUs: "0",
        sourceInUs: "0",
        sourceOutUs: "1000000",
        playbackRate: { numerator: 1, denominator: 1 } as const,
      },
    };
    expect(buildAddClip(ctx, payload)).toEqual({
      id: ctx.id,
      commandType: "timeline.add_clip",
      baseVersion: 4,
      actor: { type: "user", id: "user-1" },
      createdAt: ctx.createdAt,
      payload,
    });
  });

  it("uses caller-supplied identity/time (no clock, no random)", () => {
    const cmd = buildTrimClip(
      { ...ctx, baseVersion: 5 },
      {
        sequenceId: "sequence-1",
        clipId: "clip-1",
        sourceInUs: "0",
        sourceOutUs: "500000",
      },
    );
    expect(cmd.id).toBe(ctx.id);
    expect(cmd.createdAt).toBe(ctx.createdAt);
    expect(cmd.commandType).toBe("timeline.trim_clip");
    expect(cmd.baseVersion).toBe(5);
  });

  it("builds exact add, update, and remove keyframe commands", () => {
    const addPayload = {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      animationId: "animation-scale",
      property: "transform.scale" as const,
      keyframe: {
        id: "keyframe-1",
        timeUs: "500000",
        value: 1.25,
        easing: "ease-in-out" as const,
      },
    };
    expect(buildAddKeyframe(ctx, addPayload)).toMatchObject({
      commandType: "timeline.add_keyframe",
      payload: addPayload,
    });

    const updatePayload = {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      animationId: "animation-scale",
      keyframeId: "keyframe-1",
      timeUs: "750000",
      value: 1.5,
      easing: "linear" as const,
    };
    expect(buildUpdateKeyframe(ctx, updatePayload)).toMatchObject({
      commandType: "timeline.update_keyframe",
      payload: updatePayload,
    });

    const removePayload = {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      animationId: "animation-scale",
      keyframeId: "keyframe-1",
    };
    expect(buildRemoveKeyframe(ctx, removePayload)).toMatchObject({
      commandType: "timeline.remove_keyframe",
      payload: removePayload,
    });
  });

  it("builds one atomic clip-animation replacement command", () => {
    const payload = {
      sequenceId: "sequence-1",
      clipId: "clip-1",
      animations: [
        {
          id: "track-1",
          property: "transform.opacity" as const,
          keyframes: [
            {
              id: "keyframe-1",
              timeUs: "0",
              value: 0,
              easing: "linear" as const,
            },
          ],
        },
      ],
    };

    expect(buildUpdateClipAnimations(ctx, payload)).toMatchObject({
      commandType: "timeline.update_clip_animations",
      payload,
    });
  });
});
