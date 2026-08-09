import { describe, expect, it } from "vitest";
import {
  CLIP_DB,
  METER_FLOOR_DB,
  gainToDb,
  holdPeak,
  isClipped,
  meterFraction,
  peakLevel,
  readChannel,
  rmsLevel,
  silentReading,
} from "../src/audio-meter.js";

/**
 * Audio metering.
 *
 * Metering a live graph in a headless browser has already produced a false
 * silent reading once (LESSONS.md, 2026-07-20), so the arithmetic is pinned
 * here where it can be pinned: against a full-scale sine, whose peak and RMS
 * are known to three decimal places, and against silence.
 */

/** A sine wave at a given amplitude. */
function sine(amplitude: number, samples = 4096): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * i) / 64);
  }
  return out;
}

describe("peakLevel and rmsLevel", () => {
  it("reads a full-scale sine as peak 1 and RMS 1/√2", () => {
    const wave = sine(1);
    expect(peakLevel(wave)).toBeCloseTo(1, 3);
    expect(rmsLevel(wave)).toBeCloseTo(Math.SQRT1_2, 3);
  });

  it("reads silence as zero on both", () => {
    const quiet = new Float32Array(512);
    expect(peakLevel(quiet)).toBe(0);
    expect(rmsLevel(quiet)).toBe(0);
  });

  it("counts a negative excursion as a peak", () => {
    // Clipping is symmetric; a meter that watched only positive samples would
    // miss half of it.
    expect(peakLevel(new Float32Array([0, -0.9, 0.2]))).toBeCloseTo(0.9, 6);
  });

  it("survives an empty buffer", () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0);
  });
});

describe("gainToDb", () => {
  it("puts full scale at 0dB and half amplitude at about -6dB", () => {
    expect(gainToDb(1)).toBeCloseTo(0, 6);
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 2);
  });

  it("pins silence to the floor instead of negative infinity", () => {
    expect(gainToDb(0)).toBe(METER_FLOOR_DB);
    expect(Number.isFinite(gainToDb(0))).toBe(true);
  });
});

describe("meterFraction", () => {
  it("runs 0 at the floor to 1 at full scale", () => {
    expect(meterFraction(METER_FLOOR_DB)).toBe(0);
    expect(meterFraction(0)).toBe(1);
  });

  it("is linear in decibels, not in amplitude", () => {
    // An amplitude-linear meter spends most of its length on the top few
    // decibels and shows nothing where dialogue lives.
    expect(meterFraction(-30)).toBeCloseTo(0.5, 6);
    expect(meterFraction(-15)).toBeCloseTo(0.75, 6);
  });

  it("clamps rather than running off the ends", () => {
    expect(meterFraction(-100)).toBe(0);
    expect(meterFraction(6)).toBe(1);
  });
});

describe("isClipped", () => {
  it("flags a level at or above the clip point", () => {
    expect(isClipped(0)).toBe(true);
    expect(isClipped(CLIP_DB)).toBe(true);
    expect(isClipped(-1)).toBe(false);
  });
});

describe("holdPeak", () => {
  it("jumps up instantly", () => {
    expect(holdPeak(-40, -6)).toBe(-6);
  });

  it("falls back slowly rather than dropping", () => {
    // A peak that lasts one frame is invisible at any sensible refresh rate.
    expect(holdPeak(-6, -40, 1.5)).toBeCloseTo(-7.5, 6);
  });

  it("never falls below the current level or the floor", () => {
    expect(holdPeak(-20, -19, 5)).toBe(-19);
    expect(holdPeak(METER_FLOOR_DB, METER_FLOOR_DB, 5)).toBe(METER_FLOOR_DB);
  });
});

describe("readChannel", () => {
  it("reads a loud sine as peak, RMS and hold together", () => {
    const reading = readChannel(sine(1));
    expect(reading.peakDb).toBeCloseTo(0, 2);
    expect(reading.rmsDb).toBeCloseTo(-3.01, 1);
    expect(reading.holdDb).toBeCloseTo(0, 2);
    expect(reading.clipped).toBe(true);
  });

  it("carries the hold forward across frames", () => {
    const loud = readChannel(sine(1));
    const quiet = readChannel(new Float32Array(512), loud);
    expect(quiet.peakDb).toBe(METER_FLOOR_DB);
    expect(quiet.holdDb).toBeGreaterThan(quiet.peakDb);
  });

  it("latches a clip so it cannot flash past unseen", () => {
    const loud = readChannel(sine(1));
    const quiet = readChannel(new Float32Array(512), loud);
    expect(quiet.clipped).toBe(true);
    // …and starting fresh clears it.
    expect(readChannel(new Float32Array(512)).clipped).toBe(false);
  });

  it("reads a quiet signal well below the clip point", () => {
    const reading = readChannel(sine(0.05));
    expect(reading.peakDb).toBeLessThan(-20);
    expect(reading.clipped).toBe(false);
  });
});

describe("silentReading", () => {
  it("is silence with nothing held and nothing clipped", () => {
    expect(silentReading()).toEqual({
      peakDb: METER_FLOOR_DB,
      rmsDb: METER_FLOOR_DB,
      holdDb: METER_FLOOR_DB,
      clipped: false,
    });
  });
});
