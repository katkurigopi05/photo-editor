import { describe, expect, it } from "vitest";
import type { Project, Sequence, TimelineClip } from "../src/index.js";
import { dissolveBlockers, dissolveCompound } from "../src/compound.js";

/**
 * Dissolving a compound clip: turning one clip back into the several it was
 * made from.
 *
 * Compounding was a one-way door — a run of clips became a single clip whose
 * contents no part of the app could reach again. This is the inverse, and the
 * two claims worth pinning are that a *trimmed* compound clip gives back only
 * the part it was actually playing, and that a compound clip carrying anything
 * which acts on the composite is refused rather than silently changed.
 */

const clip = (o: Partial<TimelineClip> = {}): TimelineClip =>
  ({
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
  }) as TimelineClip;

const sequence = (
  id: string,
  clips: TimelineClip[],
  kind: "video" | "audio" = "video",
): Sequence =>
  ({
    id,
    name: id,
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
    tracks: [{ id: `${id}-t`, kind, name: "V1", index: 0, clips }],
  }) as unknown as Sequence;

const asset = (id: string, kind: string, sequenceId?: string) =>
  ({
    id,
    projectId: "project-1",
    kind,
    originalUri: sequenceId ? `sequence:${sequenceId}` : "file:///a.mov",
    checksum: "0".repeat(64),
    metadata: { fileSizeBytes: "1", durationUs: "10000000" },
    createdAt: "2026-01-01T00:00:00.000Z",
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

/** Inner holds two clips back to back, 0–2s and 2–4s. */
function nested(inner: TimelineClip[] = defaultInner()) {
  return project(
    [sequence("outer", []), sequence("inner", inner)],
    [asset("media", "video"), asset("compound", "sequence", "inner")],
  );
}

const defaultInner = (): TimelineClip[] => [
  clip({ id: "a", assetId: "media", timelineStartUs: "0" }),
  clip({ id: "b", assetId: "media", timelineStartUs: "2000000" }),
];

/** The compound clip in the outer timeline, playing all 4s from 1s. */
const compound = (o: Partial<TimelineClip> = {}): TimelineClip =>
  clip({
    id: "compound-clip",
    assetId: "compound",
    timelineStartUs: "1000000",
    timelineDurationUs: "4000000",
    sourceInUs: "0",
    sourceOutUs: "4000000",
    ...o,
  });

describe("dissolveCompound", () => {
  it("gives back every clip inside", () => {
    const out = dissolveCompound(nested(), compound());
    expect(out.map((p) => p.source.id)).toEqual(["a", "b"]);
  });

  it("places them where the compound clip sat, not where they sat inside", () => {
    // The compound clip starts at 1s, so the inner clip at 0 lands at 1s and
    // the one at 2s lands at 3s. Getting this wrong moves the whole edit.
    const out = dissolveCompound(nested(), compound());
    expect(out.map((p) => p.timelineStartUs)).toEqual(["1000000", "3000000"]);
  });

  it("keeps their lengths", () => {
    const out = dissolveCompound(nested(), compound());
    expect(out.map((p) => p.timelineDurationUs)).toEqual([
      "2000000",
      "2000000",
    ]);
  });

  it("drops what a trimmed compound clip was not playing", () => {
    // Playing only the first 2s of the inner sequence: the second clip is not
    // on screen, so dissolving must not put it back.
    const out = dissolveCompound(
      nested(),
      compound({ sourceOutUs: "2000000", timelineDurationUs: "2000000" }),
    );
    expect(out.map((p) => p.source.id)).toEqual(["a"]);
  });

  it("cuts a clip the trim runs through, rather than dropping it", () => {
    const out = dissolveCompound(
      nested(),
      compound({ sourceOutUs: "3000000", timelineDurationUs: "3000000" }),
    );
    expect(out).toHaveLength(2);
    // Only the first second of the second clip was playing.
    expect(out[1]?.timelineDurationUs).toBe("1000000");
  });

  it("advances the source of a clip trimmed at the front", () => {
    // Starting 1s into the inner sequence cuts a second off clip `a`. Its
    // length is then right whether or not the source moves — but its content
    // is only right if it does.
    const out = dissolveCompound(
      nested(),
      compound({ sourceInUs: "1000000", timelineDurationUs: "3000000" }),
    );
    expect(out[0]?.source.id).toBe("a");
    expect(out[0]?.sourceInUs).toBe("1000000");
    expect(out[0]?.sourceOutUs).toBe("2000000");
    expect(out[0]?.timelineDurationUs).toBe("1000000");
  });

  it("still starts the trimmed-at-the-front clip where the compound clip does", () => {
    const out = dissolveCompound(
      nested(),
      compound({ sourceInUs: "1000000", timelineDurationUs: "3000000" }),
    );
    expect(out[0]?.timelineStartUs).toBe("1000000");
  });

  it("reports the track kind each clip needs", () => {
    const p = project(
      [sequence("outer", []), sequence("inner", defaultInner(), "audio")],
      [asset("media", "video"), asset("compound", "sequence", "inner")],
    );
    expect(dissolveCompound(p, compound()).map((x) => x.trackKind)).toEqual([
      "audio",
      "audio",
    ]);
  });

  it("is empty for an ordinary clip", () => {
    const p = project([sequence("outer", [])], [asset("media", "video")]);
    expect(dissolveCompound(p, clip({ assetId: "media" }))).toEqual([]);
  });

  it("is empty when the sequence it names is gone", () => {
    const p = project(
      [sequence("outer", [])],
      [asset("compound", "sequence", "missing")],
    );
    expect(dissolveCompound(p, compound())).toEqual([]);
  });

  it("unpacks one level, leaving a nested compound clip whole", () => {
    // Dissolving is one undoable step. Unpacking an unknown depth in one press
    // would be a different, much larger action wearing the same button.
    const p = project(
      [
        sequence("outer", []),
        sequence("inner", [clip({ id: "deep", assetId: "compound-2" })]),
        sequence("innermost", [clip({ id: "leaf", assetId: "media" })]),
      ],
      [
        asset("media", "video"),
        asset("compound", "sequence", "inner"),
        asset("compound-2", "sequence", "innermost"),
      ],
    );
    const out = dissolveCompound(p, compound());
    expect(out.map((x) => x.source.id)).toEqual(["deep"]);
  });
});

describe("dissolveBlockers", () => {
  it("lets an untouched compound clip through", () => {
    expect(dissolveBlockers(compound())).toEqual([]);
  });

  it("lets a trimmed and moved one through", () => {
    // Neither changes the picture of any inner clip; both are expressible by
    // windowing, which is what dissolveCompound does.
    expect(
      dissolveBlockers(
        compound({ timelineStartUs: "9000000", sourceInUs: "500000" }),
      ),
    ).toEqual([]);
  });

  it("refuses one carrying an effect, and says so", () => {
    const blocked = dissolveBlockers(
      compound({
        effects: [
          { id: "fx", type: "brightness", enabled: true, params: {} },
        ] as never,
      }),
    );
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toContain("composite");
  });

  it("refuses an animated one", () => {
    expect(
      dissolveBlockers(compound({ animations: [{}] as never })),
    ).toHaveLength(1);
  });

  it("refuses a masked one", () => {
    expect(dissolveBlockers(compound({ masks: [{}] as never }))).toHaveLength(
      1,
    );
  });

  it("refuses a blended one, but not an explicitly normal one", () => {
    expect(dissolveBlockers(compound({ blendMode: "multiply" }))).toHaveLength(
      1,
    );
    expect(dissolveBlockers(compound({ blendMode: "normal" }))).toEqual([]);
  });

  it("refuses a retimed one, counting 2/2 as unretimed", () => {
    expect(
      dissolveBlockers(
        compound({ playbackRate: { numerator: 2, denominator: 1 } }),
      ),
    ).toHaveLength(1);
    expect(
      dissolveBlockers(
        compound({ playbackRate: { numerator: 2, denominator: 2 } }),
      ),
    ).toEqual([]);
  });

  it("refuses a speed-ramped one", () => {
    expect(
      dissolveBlockers(compound({ speedRamp: { segments: [] } as never })),
    ).toHaveLength(1);
  });

  it("names every reason at once, not just the first", () => {
    // A user who removes the effect and is then told about the blend mode has
    // been made to discover the rules one refusal at a time.
    const blocked = dissolveBlockers(
      compound({
        effects: [
          { id: "fx", type: "brightness", enabled: true, params: {} },
        ] as never,
        blendMode: "screen",
        playbackRate: { numerator: 2, denominator: 1 },
      }),
    );
    expect(blocked).toHaveLength(3);
  });
});
