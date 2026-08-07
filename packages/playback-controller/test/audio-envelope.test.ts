import { describe, expect, it } from "vitest";
import type { TimelineClip } from "@director/project-schema";
import {
  resolveAudioFades,
  audioEnvelopeGain,
  type ResolvedAudioFades,
} from "../src/audio-envelope.js";

/**
 * Audio fades and same-track crossfades.
 *
 * The mixer and the export mixdown must agree exactly on where a clip is
 * silent and where it is at full level, so all of that arithmetic lives here as
 * one pure function pair rather than being written twice against two different
 * audio graphs.
 *
 * Overlaps use an equal-power curve, not a linear one: two correlated sources
 * crossfading linearly dip ~3 dB in the middle, which is audible as a hole in
 * the middle of every crossfade.
 */

const clip = (
  id: string,
  startUs: string,
  durationUs: string,
  effects: TimelineClip["effects"] = [],
): TimelineClip =>
  ({
    id,
    assetId: "asset-1",
    trackId: "track-audio",
    timelineStartUs: startUs,
    timelineDurationUs: durationUs,
    sourceInUs: "0",
    sourceOutUs: durationUs,
    playbackRate: { numerator: 1, denominator: 1 },
    audioGainDb: 0,
    audioPan: 0,
    effects,
  }) as TimelineClip;

const fade = (fadeInUs: string, fadeOutUs: string): TimelineClip["effects"] =>
  [
    {
      id: "fx-fade",
      type: "audio.fade",
      enabled: true,
      params: { fadeInUs, fadeOutUs },
    },
  ] as TimelineClip["effects"];

describe("resolveAudioFades", () => {
  it("reports no fade for a bare clip", () => {
    const resolved = resolveAudioFades(clip("a", "0", "4000000"), []);
    expect(resolved).toEqual<ResolvedAudioFades>({
      fadeInUs: "0",
      fadeOutUs: "0",
      fadeInFromOverlap: false,
      fadeOutFromOverlap: false,
    });
  });

  it("uses the explicit fade effect", () => {
    const resolved = resolveAudioFades(
      clip("a", "0", "4000000", fade("500000", "1000000")),
      [],
    );
    expect(resolved.fadeInUs).toBe("500000");
    expect(resolved.fadeOutUs).toBe("1000000");
    expect(resolved.fadeInFromOverlap).toBe(false);
  });

  it("ignores a disabled fade effect", () => {
    const effects = fade("500000", "500000").map((fx) => ({
      ...fx,
      enabled: false,
    })) as TimelineClip["effects"];
    const resolved = resolveAudioFades(clip("a", "0", "4000000", effects), []);
    expect(resolved.fadeInUs).toBe("0");
  });

  it("scales both fades down when they would overlap each other", () => {
    // A 3s fade in and a 3s fade out on a 4s clip cannot both run in full.
    const resolved = resolveAudioFades(
      clip("a", "0", "4000000", fade("3000000", "3000000")),
      [],
    );
    expect(
      BigInt(resolved.fadeInUs) + BigInt(resolved.fadeOutUs),
    ).toBeLessThanOrEqual(4000000n);
    // Reduced proportionally, so a symmetric request stays symmetric.
    expect(resolved.fadeInUs).toBe(resolved.fadeOutUs);
  });

  it("derives a crossfade from an overlap with the previous clip", () => {
    const previous = clip("a", "0", "4000000");
    const current = clip("b", "3000000", "4000000");
    const resolved = resolveAudioFades(current, [previous]);
    expect(resolved.fadeInUs).toBe("1000000");
    expect(resolved.fadeInFromOverlap).toBe(true);
    expect(resolved.fadeOutUs).toBe("0");
  });

  it("derives the matching fade out on the outgoing clip", () => {
    const previous = clip("a", "0", "4000000");
    const current = clip("b", "3000000", "4000000");
    const resolved = resolveAudioFades(previous, [current]);
    expect(resolved.fadeOutUs).toBe("1000000");
    expect(resolved.fadeOutFromOverlap).toBe(true);
    expect(resolved.fadeInUs).toBe("0");
  });

  it("keeps the longer of an explicit fade and an overlap", () => {
    const previous = clip("a", "0", "4000000");
    const current = clip("b", "3000000", "4000000", fade("2000000", "0"));
    expect(resolveAudioFades(current, [previous]).fadeInUs).toBe("2000000");

    const shortExplicit = clip("b", "3000000", "4000000", fade("200000", "0"));
    expect(resolveAudioFades(shortExplicit, [previous]).fadeInUs).toBe(
      "1000000",
    );
  });

  it("ignores clips that do not overlap and clips on other tracks", () => {
    const before = clip("a", "0", "1000000"); // ends exactly at the start
    const current = clip("b", "1000000", "4000000");
    expect(resolveAudioFades(current, [before]).fadeInUs).toBe("0");

    const otherTrack = { ...clip("c", "0", "4000000"), trackId: "track-2" };
    expect(resolveAudioFades(current, [otherTrack]).fadeInUs).toBe("0");
  });

  it("never lets an overlap exceed the clip", () => {
    // A short clip fully inside a long one: the fade cannot be longer than the
    // clip it belongs to, or the ramp would still be rising at the last sample.
    const long = clip("a", "0", "10000000");
    const short = clip("b", "1000000", "2000000");
    const resolved = resolveAudioFades(short, [long]);
    expect(BigInt(resolved.fadeInUs)).toBeLessThanOrEqual(2000000n);
  });
});

describe("audioEnvelopeGain", () => {
  const none: ResolvedAudioFades = {
    fadeInUs: "0",
    fadeOutUs: "0",
    fadeInFromOverlap: false,
    fadeOutFromOverlap: false,
  };

  it("is unity everywhere without fades", () => {
    for (const t of ["0", "1", "2000000", "3999999"]) {
      expect(audioEnvelopeGain(t, "4000000", none)).toBe(1);
    }
  });

  it("ramps from silence to unity across the fade in", () => {
    const fades: ResolvedAudioFades = { ...none, fadeInUs: "1000000" };
    expect(audioEnvelopeGain("0", "4000000", fades)).toBe(0);
    expect(audioEnvelopeGain("1000000", "4000000", fades)).toBeCloseTo(1, 10);
    expect(audioEnvelopeGain("2000000", "4000000", fades)).toBe(1);
    // Monotonic across the ramp.
    let previous = -1;
    for (let us = 0; us <= 1_000_000; us += 50_000) {
      const gain = audioEnvelopeGain(String(us), "4000000", fades);
      expect(gain).toBeGreaterThanOrEqual(previous);
      previous = gain;
    }
  });

  it("ramps from unity to silence across the fade out", () => {
    const fades: ResolvedAudioFades = { ...none, fadeOutUs: "1000000" };
    expect(audioEnvelopeGain("3000000", "4000000", fades)).toBeCloseTo(1, 10);
    expect(audioEnvelopeGain("4000000", "4000000", fades)).toBeCloseTo(0, 10);
    expect(audioEnvelopeGain("3500000", "4000000", fades)).toBeLessThan(1);
  });

  it("holds constant power across a crossfade", () => {
    // The reason for the equal-power curve: the outgoing tail and the incoming
    // head must sum to unity power at every instant of the overlap.
    const outgoing: ResolvedAudioFades = {
      ...none,
      fadeOutUs: "1000000",
      fadeOutFromOverlap: true,
    };
    const incoming: ResolvedAudioFades = {
      ...none,
      fadeInUs: "1000000",
      fadeInFromOverlap: true,
    };
    for (let us = 0; us <= 1_000_000; us += 100_000) {
      const out = audioEnvelopeGain(
        String(3_000_000 + us),
        "4000000",
        outgoing,
      );
      const inn = audioEnvelopeGain(String(us), "4000000", incoming);
      expect(out * out + inn * inn).toBeCloseTo(1, 6);
    }
  });

  it("clamps outside the clip rather than extrapolating", () => {
    const fades: ResolvedAudioFades = { ...none, fadeInUs: "1000000" };
    expect(audioEnvelopeGain("-500000", "4000000", fades)).toBe(0);
    expect(audioEnvelopeGain("9000000", "4000000", fades)).toBe(1);
  });

  it("handles a zero-length clip without dividing by zero", () => {
    expect(audioEnvelopeGain("0", "0", none)).toBe(1);
  });
});
