import { describe, expect, it } from "vitest";
import {
  buildAddClip,
  buildTrimClip,
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
});
