import { describe, expect, test } from "vitest";

import { boomerangOrder, clampGifFps, gifFrameDelayMs } from "../src/gif.js";

describe("boomerangOrder", () => {
  test("plays straight through when boomerang is off", () => {
    expect(boomerangOrder(4, false)).toEqual([0, 1, 2, 3]);
  });

  test("ping-pongs without repeating either endpoint", () => {
    expect(boomerangOrder(4, true)).toEqual([0, 1, 2, 3, 2, 1]);
  });

  test("leaves one- and two-frame clips alone", () => {
    // With fewer than three frames there is no interior to bounce through, and
    // reversing would only duplicate the frames that are already on screen.
    expect(boomerangOrder(1, true)).toEqual([0]);
    expect(boomerangOrder(2, true)).toEqual([0, 1]);
  });

  test("returns an empty order for an empty clip", () => {
    expect(boomerangOrder(0, true)).toEqual([]);
  });
});

describe("clampGifFps", () => {
  test("keeps rates inside the supported range", () => {
    expect(clampGifFps(12)).toBe(12);
    expect(clampGifFps(0)).toBe(1);
    expect(clampGifFps(999)).toBe(50);
  });

  test("rounds fractional rates and falls back on non-finite input", () => {
    expect(clampGifFps(11.4)).toBe(11);
    expect(clampGifFps(Number.NaN)).toBe(10);
  });
});

describe("gifFrameDelayMs", () => {
  test("snaps to the whole hundredths of a second GIF can store", () => {
    expect(gifFrameDelayMs(10)).toBe(100);
    expect(gifFrameDelayMs(20)).toBe(50);
    // 15fps is 66.67ms, which GIF cannot express — 70ms is the nearest it can.
    expect(gifFrameDelayMs(15)).toBe(70);
  });

  test("stays inside what viewers play back reliably", () => {
    // The fps clamp is what keeps this away from the 0ms delay that viewers
    // treat as "as fast as possible" and render inconsistently.
    expect(gifFrameDelayMs(50)).toBe(20);
    expect(gifFrameDelayMs(500)).toBe(20);
    expect(gifFrameDelayMs(1)).toBe(1000);
  });
});
