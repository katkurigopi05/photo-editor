import { describe, expect, it } from "vitest";
import type { Project, Sequence } from "@director/project-schema";
import { resolveAtTimeDeep } from "../src/compound.js";
import { compoundCycle } from "@director/project-schema";

/**
 * Compound clips: a clip that plays a whole sequence.
 *
 * Modelled as an asset kind, the way adjustment layers were, so a compound clip
 * is an ordinary clip and no reducer learns a new case. What is genuinely new is
 * *resolution*: the picture at an instant may come from inside another sequence,
 * possibly several levels down.
 *
 * Two things must hold or the feature is a hazard rather than a feature. A cycle
 * must be refused rather than recursed into, and an inner clip's position must
 * be reported in the outer timeline, or every caller would have to know how deep
 * it was standing.
 */

const clip = (o: Partial<Record<string, unknown>> = {}) => ({
  id: "clip-1",
  assetId: "asset-1",
  trackId: "track-1",
  timelineStartUs: "0",
  timelineDurationUs: "2000000",
  sourceInUs: "0",
  sourceOutUs: "2000000",
  playbackRate: { numerator: 1, denominator: 1 },
  audioGainDb: 0,
  audioPan: 0,
  effects: [],
  ...o,
});

const sequence = (id: string, clips: unknown[]): Sequence =>
  ({
    id,
    name: id,
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
    tracks: [{ id: "track-1", kind: "video", name: "V1", index: 0, clips }],
  }) as unknown as Sequence;

const asset = (id: string, kind: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    projectId: "project-1",
    kind,
    originalUri:
      kind === "sequence" ? `sequence:${extra.sequenceId}` : "file:///a.mov",
    checksum: "0".repeat(64),
    metadata: { fileSizeBytes: "1", durationUs: "10000000" },
    createdAt: "2026-01-01T00:00:00.000Z",
    ...extra,
  }) as never;

const project = (sequences: Sequence[], assets: unknown[]): Project =>
  ({
    id: "project-1",
    ownerId: "owner-1",
    name: "Demo",
    schemaVersion: 1,
    currentVersion: 1,
    settings: { defaultFrameRate: { numerator: 30, denominator: 1 } },
    assets,
    sequences,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }) as unknown as Project;

/** Outer holds one compound clip pointing at inner, which holds real media. */
function nested() {
  const inner = sequence("inner", [
    clip({ id: "inner-clip", assetId: "media", timelineStartUs: "0" }),
  ]);
  const outer = sequence("outer", [
    clip({ id: "outer-clip", assetId: "compound", timelineStartUs: "1000000" }),
  ]);
  return project(
    [outer, inner],
    [
      asset("media", "video"),
      asset("compound", "sequence", { sequenceId: "inner" }),
    ],
  );
}

describe("resolveAtTimeDeep", () => {
  it("returns the media inside a compound clip, not the compound clip", () => {
    // The renderer draws pictures; a compound clip has none of its own.
    const layers = resolveAtTimeDeep(nested(), "outer", "1500000");
    expect(layers).toHaveLength(1);
    expect(layers[0]?.assetId).toBe("media");
  });

  it("reports the inner clip's position in the outer timeline", () => {
    // The inner clip sits at 0 inside, and the compound clip sits at 1s
    // outside, so it is live at 1s of the outer timeline. A caller computing
    // clip-local time from this must not need to know how deep it was.
    const layers = resolveAtTimeDeep(nested(), "outer", "1500000");
    expect(layers[0]?.timelineStartUs).toBe("1000000");
  });

  it("maps the source time through the nesting", () => {
    // Half a second into the compound clip is half a second into the inner
    // clip's own source, since neither is trimmed or retimed here.
    const layers = resolveAtTimeDeep(nested(), "outer", "1500000");
    expect(layers[0]?.sourceTimeUs).toBe("500000");
  });

  it("is empty where the compound clip is not live", () => {
    expect(resolveAtTimeDeep(nested(), "outer", "500000")).toEqual([]);
  });

  it("still resolves an ordinary sequence unchanged", () => {
    const flat = project(
      [sequence("outer", [clip({ assetId: "media" })])],
      [asset("media", "video")],
    );
    const layers = resolveAtTimeDeep(flat, "outer", "1000000");
    expect(layers).toHaveLength(1);
    expect(layers[0]?.assetId).toBe("media");
    expect(layers[0]?.timelineStartUs).toBe("0");
  });

  it("resolves two levels down", () => {
    const deepest = sequence("deepest", [
      clip({ id: "d", assetId: "media", timelineStartUs: "0" }),
    ]);
    const middle = sequence("middle", [
      clip({ id: "m", assetId: "compound-deep", timelineStartUs: "0" }),
    ]);
    const top = sequence("top", [
      clip({ id: "t", assetId: "compound-mid", timelineStartUs: "0" }),
    ]);
    const p = project(
      [top, middle, deepest],
      [
        asset("media", "video"),
        asset("compound-deep", "sequence", { sequenceId: "deepest" }),
        asset("compound-mid", "sequence", { sequenceId: "middle" }),
      ],
    );
    expect(resolveAtTimeDeep(p, "top", "500000")[0]?.assetId).toBe("media");
  });
});

describe("compoundCycle", () => {
  it("finds nothing in a sound nesting", () => {
    expect(compoundCycle(nested(), "outer")).toBeNull();
  });

  it("catches a sequence that contains itself", () => {
    const self = sequence("loop", [
      clip({ id: "c", assetId: "compound-self" }),
    ]);
    const p = project(
      [self],
      [asset("compound-self", "sequence", { sequenceId: "loop" })],
    );
    expect(compoundCycle(p, "loop")).toContain("loop");
  });

  it("catches a longer ring", () => {
    // a contains b, b contains a. Recursing this would not stop.
    const a = sequence("a", [clip({ id: "ca", assetId: "to-b" })]);
    const b = sequence("b", [clip({ id: "cb", assetId: "to-a" })]);
    const p = project(
      [a, b],
      [
        asset("to-b", "sequence", { sequenceId: "b" }),
        asset("to-a", "sequence", { sequenceId: "a" }),
      ],
    );
    expect(compoundCycle(p, "a")).not.toBeNull();
  });

  it("resolution stops rather than hanging when a cycle exists anyway", () => {
    // Belt and braces: the reducer refuses to create one, but a hand-edited
    // project file must not be able to lock the renderer up.
    const self = sequence("loop", [
      clip({ id: "c", assetId: "compound-self" }),
    ]);
    const p = project(
      [self],
      [asset("compound-self", "sequence", { sequenceId: "loop" })],
    );
    expect(() => resolveAtTimeDeep(p, "loop", "500000")).not.toThrow();
    expect(resolveAtTimeDeep(p, "loop", "500000")).toEqual([]);
  });
});
