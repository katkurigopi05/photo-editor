import { describe, expect, it } from "vitest";
import { clipMarkerSchema, MARKER_KINDS } from "../src/markers.js";
import { timelineClipSchema } from "../src/entities.js";

/**
 * Markers.
 *
 * A marker is a note pinned to a moment of a clip — Final Cut's markers, which
 * ride the clip rather than the timeline, so trimming or moving the clip takes
 * its notes with it. That is why the time is clip-local microseconds, the same
 * coordinate space as keyframes, and not a timeline position that would have to
 * be rewritten on every move.
 */

const marker = (overrides: Record<string, unknown> = {}) => ({
  id: "marker-1",
  timeUs: "1500000",
  name: "Cut here",
  kind: "standard" as const,
  ...overrides,
});

const clip = (markers?: unknown) => ({
  id: "clip-1",
  assetId: "asset-1",
  trackId: "track-1",
  timelineStartUs: "0",
  timelineDurationUs: "5000000",
  sourceInUs: "0",
  sourceOutUs: "5000000",
  playbackRate: { numerator: 1, denominator: 1 },
  audioGainDb: 0,
  audioPan: 0,
  effects: [],
  ...(markers === undefined ? {} : { markers }),
});

describe("clipMarkerSchema", () => {
  it("accepts a named marker at a clip-local time", () => {
    expect(clipMarkerSchema.parse(marker())).toEqual(marker());
  });

  it("accepts every kind it offers", () => {
    for (const kind of MARKER_KINDS) {
      expect(clipMarkerSchema.safeParse(marker({ kind })).success).toBe(true);
    }
  });

  it("offers the kinds an editor actually uses", () => {
    // Chapter markers carry into an exported file's chapter list; to-do markers
    // are the ones a person filters for. Both are worth distinguishing from an
    // ordinary note, and nothing else is.
    expect([...MARKER_KINDS].sort()).toEqual(["chapter", "standard", "todo"]);
  });

  it("rejects a non-canonical or negative time", () => {
    for (const timeUs of ["1.5", "-1", "01", "", "1e6"]) {
      expect(clipMarkerSchema.safeParse(marker({ timeUs })).success).toBe(
        false,
      );
    }
  });

  it("rejects an empty name and an over-long one", () => {
    expect(clipMarkerSchema.safeParse(marker({ name: "" })).success).toBe(
      false,
    );
    expect(
      clipMarkerSchema.safeParse(marker({ name: "x".repeat(201) })).success,
    ).toBe(false);
  });

  it("rejects an unknown kind or an extra key", () => {
    expect(clipMarkerSchema.safeParse(marker({ kind: "urgent" })).success).toBe(
      false,
    );
    expect(clipMarkerSchema.safeParse(marker({ colour: "red" })).success).toBe(
      false,
    );
  });

  it("carries an optional completion flag for to-do markers", () => {
    const done = clipMarkerSchema.parse(marker({ kind: "todo", done: true }));
    expect(done.done).toBe(true);
    // Absent rather than false when untouched, so old projects parse
    // byte-identically.
    expect(clipMarkerSchema.parse(marker())).not.toHaveProperty("done");
  });
});

describe("clips carrying markers", () => {
  it("parses a clip with no markers exactly as before", () => {
    expect(timelineClipSchema.parse(clip())).not.toHaveProperty("markers");
  });

  it("accepts a clip with markers", () => {
    const parsed = timelineClipSchema.parse(clip([marker()]));
    expect(parsed.markers?.[0]?.name).toBe("Cut here");
  });

  it("rejects duplicate marker ids on one clip", () => {
    expect(
      timelineClipSchema.safeParse(
        clip([marker(), marker({ timeUs: "2000000" })]),
      ).success,
    ).toBe(false);
  });

  it("accepts two markers at the same instant", () => {
    // Different notes about the same frame is ordinary; only the ids must be
    // unique.
    expect(
      timelineClipSchema.safeParse(clip([marker(), marker({ id: "marker-2" })]))
        .success,
    ).toBe(true);
  });
});
