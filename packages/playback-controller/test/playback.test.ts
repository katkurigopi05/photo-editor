import { describe, test, expect } from "vitest";
import type { Sequence, Rational } from "@director/project-schema";
import {
  timeToFrameIndex,
  frameToStartTimeUs,
  framesInDuration,
  resolveAtTime,
  sequenceDurationUs,
  createPlaybackState,
  play,
  pause,
  seek,
  setRate,
  setLoopRegion,
  tick,
  planPrefetch,
} from "../src/index.js";

describe("playback-controller frame-timing", () => {
  test("integer frame rate: 30 fps", () => {
    const rate: Rational = { numerator: 30, denominator: 1 };

    // 0 us is frame 0
    expect(timeToFrameIndex("0", rate)).toBe(0);
    expect(frameToStartTimeUs(0, rate)).toBe("0");

    // 1 frame = 1,000,000 / 30 = 33333.333... us
    // So 33333 us is still frame 0, 33334 us is frame 1
    expect(timeToFrameIndex("33333", rate)).toBe(0);
    expect(timeToFrameIndex("33334", rate)).toBe(1);

    // Round-trip check
    for (let f = 0; f < 100; f++) {
      const startTime = frameToStartTimeUs(f, rate);
      expect(timeToFrameIndex(startTime, rate)).toBe(f);
    }
  });

  test("non-integer frame rate: 29.97 fps (30000/1001)", () => {
    const rate: Rational = { numerator: 30000, denominator: 1001 };

    // 1 frame = 1001 * 1,000,000 / 30000 = 33366.666... us
    expect(timeToFrameIndex("0", rate)).toBe(0);
    expect(frameToStartTimeUs(0, rate)).toBe("0");

    expect(timeToFrameIndex("33366", rate)).toBe(0);
    expect(timeToFrameIndex("33367", rate)).toBe(1);
    expect(frameToStartTimeUs(1, rate)).toBe("33367"); // ceil(33366.666...) = 33367

    // Round-trip check
    for (let f = 0; f < 100; f++) {
      const startTime = frameToStartTimeUs(f, rate);
      expect(timeToFrameIndex(startTime, rate)).toBe(f);
    }
  });

  test("framesInDuration", () => {
    const rate: Rational = { numerator: 24, denominator: 1 };
    // 1 second (1000000 us) at 24 fps is 24 frames
    expect(framesInDuration("1000000", rate)).toBe(24);
    // 0.5 second is 12 frames
    expect(framesInDuration("500000", rate)).toBe(12);
  });

  test("invalid inputs throw RangeError", () => {
    const rate: Rational = { numerator: 30, denominator: 1 };
    const invalidRate: Rational = { numerator: 0, denominator: 1 };
    const negativeRate: Rational = { numerator: 30, denominator: -1 };

    expect(() => timeToFrameIndex("-1", rate)).toThrow(RangeError);
    expect(() => timeToFrameIndex("100", invalidRate)).toThrow(RangeError);
    expect(() => timeToFrameIndex("100", negativeRate)).toThrow(RangeError);

    expect(() => frameToStartTimeUs(-1, rate)).toThrow(RangeError);
    expect(() => frameToStartTimeUs(1.5, rate)).toThrow(RangeError);
  });
});

describe("playback-controller timeline", () => {
  const dummySequence: Sequence = {
    id: "seq-1",
    name: "Test Sequence",
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
    tracks: [
      {
        id: "track-v1",
        kind: "video",
        name: "V1",
        index: 0,
        clips: [
          {
            id: "clip-1",
            assetId: "asset-1",
            trackId: "track-v1",
            timelineStartUs: "0",
            timelineDurationUs: "2000000", // 2s
            sourceInUs: "1000000",
            sourceOutUs: "3000000",
            playbackRate: { numerator: 1, denominator: 1 },
            audioGainDb: 0,
            audioPan: 0,
            effects: [],
          },
          {
            id: "clip-2",
            assetId: "asset-2",
            trackId: "track-v1",
            timelineStartUs: "3000000", // gap from 2s to 3s
            timelineDurationUs: "1000000", // 1s
            sourceInUs: "0",
            sourceOutUs: "1000000",
            playbackRate: { numerator: 1, denominator: 1 },
            audioGainDb: 0,
            audioPan: 0,
            effects: [],
          },
        ],
      },
      {
        id: "track-a1",
        kind: "audio",
        name: "A1",
        index: 1,
        clips: [
          {
            id: "clip-3",
            assetId: "asset-3",
            trackId: "track-a1",
            timelineStartUs: "1000000", // starts at 1s
            timelineDurationUs: "3000000", // 3s long (ends at 4s)
            sourceInUs: "0",
            sourceOutUs: "3000000",
            playbackRate: { numerator: 1, denominator: 1 },
            audioGainDb: 0,
            audioPan: 0,
            effects: [],
          },
        ],
      },
    ],
  };

  test("resolveAtTime - standard and gaps", () => {
    // At t=0: clip-1 is active on V1, no active clip on A1
    const t0 = resolveAtTime(dummySequence, "0");
    expect(t0).toHaveLength(1);
    expect(t0[0]).toEqual({
      trackId: "track-v1",
      clipId: "clip-1",
      assetId: "asset-1",
      timelineStartUs: "0",
      sourceTimeUs: "1000000", // sourceInUs (1s) + 0 offset
    });

    // At t=1.5s (1500000 us):
    // V1 active: clip-1 (offset 1.5s, sourceTime = 1s + 1.5s = 2.5s)
    // A1 active: clip-3 (offset 0.5s, sourceTime = 0s + 0.5s = 0.5s)
    const t1_5 = resolveAtTime(dummySequence, "1500000");
    expect(t1_5).toHaveLength(2);
    expect(t1_5.find((c) => c.trackId === "track-v1")).toEqual({
      trackId: "track-v1",
      clipId: "clip-1",
      assetId: "asset-1",
      timelineStartUs: "0",
      sourceTimeUs: "2500000",
    });
    expect(t1_5.find((c) => c.trackId === "track-a1")).toEqual({
      trackId: "track-a1",
      clipId: "clip-3",
      assetId: "asset-3",
      timelineStartUs: "1000000",
      sourceTimeUs: "500000",
    });

    // At t=2.5s (2500000 us): gap on V1, A1 has clip-3 active (offset 1.5s)
    const t2_5 = resolveAtTime(dummySequence, "2500000");
    expect(t2_5).toHaveLength(1);
    expect(t2_5[0]).toEqual({
      trackId: "track-a1",
      clipId: "clip-3",
      assetId: "asset-3",
      timelineStartUs: "1000000",
      sourceTimeUs: "1500000",
    });

    // Half-open check: clip-1 is active at [0, 2000000). At 2000000, it is inactive!
    const t2_0 = resolveAtTime(dummySequence, "2000000");
    expect(t2_0.find((c) => c.trackId === "track-v1")).toBeUndefined();
  });

  test("sequenceDurationUs", () => {
    // V1 ends at 4s (3s + 1s)
    // A1 ends at 4s (1s + 3s)
    expect(sequenceDurationUs(dummySequence)).toBe("4000000");
  });
});

describe("playback-controller transport", () => {
  test("initial state and state transitions", () => {
    let state = createPlaybackState("5000000"); // 5s duration
    expect(state.currentTimeUs).toBe("0");
    expect(state.playing).toBe(false);
    expect(state.rate).toEqual({ numerator: 1, denominator: 1 });
    expect(state.loopRegion).toBeNull();
    expect(state.durationUs).toBe("5000000");

    state = play(state);
    expect(state.playing).toBe(true);

    state = pause(state);
    expect(state.playing).toBe(false);

    state = seek(state, "3000000");
    expect(state.currentTimeUs).toBe("3000000");

    // Seek clamping
    state = seek(state, "10000000");
    expect(state.currentTimeUs).toBe("5000000"); // clamped to duration

    state = seek(state, "-100");
    expect(state.currentTimeUs).toBe("0"); // clamped to 0

    state = setRate(state, { numerator: 2, denominator: 1 });
    expect(state.rate).toEqual({ numerator: 2, denominator: 1 });
  });

  test("ticking behaviour", () => {
    let state = createPlaybackState("10000000"); // 10s
    state = play(state);

    // Tick 1s when rate is 1/1
    state = tick(state, "1000000");
    expect(state.currentTimeUs).toBe("1000000");

    // Change rate to 2/1 (double speed)
    state = setRate(state, { numerator: 2, denominator: 1 });
    state = tick(state, "1000000"); // ticks 2s in timeline
    expect(state.currentTimeUs).toBe("3000000");

    // Pause
    state = pause(state);
    state = tick(state, "1000000"); // no-op when paused
    expect(state.currentTimeUs).toBe("3000000");

    // Play again and tick past duration (clamping + auto-pauses)
    state = play(state);
    state = tick(state, "5000000"); // ticks 10s (exceeds duration of 10s)
    expect(state.currentTimeUs).toBe("10000000");
    expect(state.playing).toBe(false);
  });

  test("looping behaviour", () => {
    let state = createPlaybackState("10000000");
    state = setLoopRegion(state, { startUs: "2000000", endUs: "6000000" });
    expect(state.loopRegion).toEqual({ startUs: "2000000", endUs: "6000000" });

    state = seek(state, "3000000");
    state = play(state);

    // Tick 1s
    state = tick(state, "1000000");
    expect(state.currentTimeUs).toBe("4000000");

    // Tick another 3s (takes us to 7000000, which is >= endUs of 6000000. Loop wraps!)
    // Loop span = 6s - 2s = 4s.
    // next = 4s + 3s = 7s.
    // wrapped = start + (next - start) % span = 2s + (7s - 2s) % 4s = 2s + 5s % 4s = 3s
    state = tick(state, "3000000");
    expect(state.currentTimeUs).toBe("3000000");
  });

  test("invalid rate and loop region validation", () => {
    const state = createPlaybackState("10000000");

    expect(() =>
      createPlaybackState("10000000", { numerator: 0, denominator: 1 }),
    ).toThrow(RangeError);
    expect(() => setRate(state, { numerator: 1, denominator: -1 })).toThrow(
      RangeError,
    );

    // Loop region: start >= end
    expect(() =>
      setLoopRegion(state, { startUs: "3000000", endUs: "2000000" }),
    ).toThrow(RangeError);
    expect(() =>
      setLoopRegion(state, { startUs: "3000000", endUs: "3000000" }),
    ).toThrow(RangeError);

    // Loop region: negative start
    expect(() =>
      setLoopRegion(state, { startUs: "-1000", endUs: "2000000" }),
    ).toThrow(RangeError);

    // Loop region: end exceeds duration
    expect(() =>
      setLoopRegion(state, { startUs: "2000000", endUs: "11000000" }),
    ).toThrow(RangeError);
  });
});

describe("playback-controller prefetch", () => {
  const dummySequence: Sequence = {
    id: "seq-1",
    name: "Test Sequence",
    width: 1920,
    height: 1080,
    frameRate: { numerator: 30, denominator: 1 },
    tracks: [
      {
        id: "track-v1",
        kind: "video",
        name: "V1",
        index: 0,
        clips: [
          {
            id: "clip-1",
            assetId: "asset-1",
            trackId: "track-v1",
            timelineStartUs: "0",
            timelineDurationUs: "100000", // 100ms
            sourceInUs: "0",
            sourceOutUs: "100000",
            playbackRate: { numerator: 1, denominator: 1 },
            audioGainDb: 0,
            audioPan: 0,
            effects: [],
          },
        ],
      },
    ],
  };

  test("planPrefetch", () => {
    // At 30fps, 1 frame is 33333.33 us
    // If currentTimeUs is 0 and lookAheadUs is 70000 us (ends at 70000 us)
    // Frame 0 starts at 0 us
    // Frame 1 starts at 33334 us
    // Frame 2 starts at 66667 us
    // Frame 3 starts at 100000 us (which is after clip-1 ends since clip-1 duration is 100000 us and is active on [0, 100000) )
    const requests = planPrefetch(dummySequence, "0", "70000");

    // We expect requests for Frame 0, Frame 1, Frame 2 (all within [0, 70000] range and active clip-1)
    expect(requests).toHaveLength(3);

    expect(requests[0]).toEqual({
      frameIndex: 0,
      timelineTimeUs: "0",
      trackId: "track-v1",
      clipId: "clip-1",
      assetId: "asset-1",
      sourceTimeUs: "0",
    });

    expect(requests[1]).toEqual({
      frameIndex: 1,
      timelineTimeUs: "33334",
      trackId: "track-v1",
      clipId: "clip-1",
      assetId: "asset-1",
      sourceTimeUs: "33334",
    });

    expect(requests[2]).toEqual({
      frameIndex: 2,
      timelineTimeUs: "66667",
      trackId: "track-v1",
      clipId: "clip-1",
      assetId: "asset-1",
      sourceTimeUs: "66667",
    });
  });
});

describe("playback-controller sync drift bounds", () => {
  test("long simulated playback should have zero drift due to exact rational arithmetic", () => {
    const rate: Rational = { numerator: 30000, denominator: 1001 }; // 29.97
    let state = createPlaybackState("30000000000", rate); // 10 hours duration
    state = play(state);

    // Simulate ticking 30,000 times by 1/30 second steps (approx 33,333 us)
    // and verify the total matches exactly without any floating point accumulation/drift.
    const steps = 30000;
    const delta = "33333"; // slightly less than actual frame time
    const expectedTimelineDeltaPerStep = (33333n * 30000n) / 1001n;
    const totalExpectedAdvance = expectedTimelineDeltaPerStep * BigInt(steps);

    for (let i = 0; i < steps; i++) {
      state = tick(state, delta);
    }

    expect(state.currentTimeUs).toBe(totalExpectedAdvance.toString());
  });
});
