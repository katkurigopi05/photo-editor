import { describe, expect, it } from "vitest";
import {
  buildExportPreset,
  h264CodecString,
  FRAME_RATE_CHOICES,
  RESOLUTION_CHOICES,
  type ExportFields,
} from "../src/export-preset.js";

/**
 * Turning the export dialog's fields into a validated preset.
 *
 * This is where a user's free text meets a schema that an encoder will trust,
 * so the tests are about refusal as much as acceptance: an odd width, a
 * nonsense frame rate or a bitrate of zero must fail here with something a
 * person can read, not three layers down inside WebCodecs.
 */

const fields = (overrides: Partial<ExportFields> = {}): ExportFields => ({
  resolution: "1920x1080",
  customWidth: "",
  customHeight: "",
  frameRate: "30",
  bitrateKbps: "8000",
  audioCodec: "opus",
  audioBitrateKbps: "128",
  ...overrides,
});

const ok = (input: ExportFields) => {
  const result = buildExportPreset(input);
  if (!result.ok) throw new Error(`expected a preset, got: ${result.error}`);
  return result.preset;
};

describe("buildExportPreset", () => {
  it("builds a preset from the standard choices", () => {
    const preset = ok(fields());
    expect(preset).toMatchObject({
      width: 1920,
      height: 1080,
      videoCodec: "h264",
      container: "mp4",
      videoBitrateKbps: 8000,
      audioCodec: "opus",
      audioBitrateKbps: 128,
      audioSampleRate: 48000,
    });
    expect(preset.frameRate).toEqual({ numerator: 30, denominator: 1 });
  });

  it("keeps broadcast rates exact as rationals", () => {
    // 29.97 is 30000/1001, not 29.97: a float would drift a frame every few
    // minutes against the microsecond timeline.
    expect(ok(fields({ frameRate: "30000/1001" })).frameRate).toEqual({
      numerator: 30000,
      denominator: 1001,
    });
    expect(ok(fields({ frameRate: "60000/1001" })).frameRate).toEqual({
      numerator: 60000,
      denominator: 1001,
    });
  });

  it("offers 4K and 1440p, and every choice is even-sided", () => {
    // H.264 chroma is subsampled 2x2, so odd dimensions are not encodable.
    for (const choice of RESOLUTION_CHOICES) {
      if (choice.value === "custom") continue;
      const [w, h] = choice.value.split("x").map(Number);
      expect(w! % 2).toBe(0);
      expect(h! % 2).toBe(0);
    }
    expect(RESOLUTION_CHOICES.map((c) => c.value)).toContain("3840x2160");
    expect(RESOLUTION_CHOICES.map((c) => c.value)).toContain("2560x1440");
  });

  it("accepts a custom size", () => {
    const preset = ok(
      fields({ resolution: "custom", customWidth: "1000", customHeight: "562" }),
    );
    expect(preset.width).toBe(1000);
    expect(preset.height).toBe(562);
  });

  it("rounds an odd custom size up rather than failing", () => {
    // Typing 1001 is a slip, not a request for something impossible; silently
    // encoding at a different size would be worse than nudging by one pixel.
    const preset = ok(
      fields({ resolution: "custom", customWidth: "1001", customHeight: "563" }),
    );
    expect(preset.width).toBe(1002);
    expect(preset.height).toBe(564);
  });

  it("refuses a custom size that is empty, zero or absurd", () => {
    for (const [w, h] of [
      ["", "1080"],
      ["0", "1080"],
      ["-4", "1080"],
      ["abc", "1080"],
      ["100000", "1080"],
    ]) {
      const result = buildExportPreset(
        fields({ resolution: "custom", customWidth: w!, customHeight: h! }),
      );
      expect(result.ok, `${w}x${h}`).toBe(false);
    }
  });

  it("refuses a bitrate that is not a positive number", () => {
    for (const bitrate of ["", "0", "-500", "lots"]) {
      expect(buildExportPreset(fields({ bitrateKbps: bitrate })).ok).toBe(false);
    }
  });

  it("names the field it refused", () => {
    const result = buildExportPreset(fields({ bitrateKbps: "0" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("bitrate");
  });

  it("drops the audio settings entirely when audio is off", () => {
    const preset = ok(fields({ audioCodec: "none" }));
    expect(preset.audioCodec).toBe("none");
    expect(preset.audioBitrateKbps).toBeUndefined();
  });

  it("offers only frame rates the timeline can express exactly", () => {
    for (const choice of FRAME_RATE_CHOICES) {
      const preset = ok(fields({ frameRate: choice.value }));
      expect(Number.isInteger(preset.frameRate.numerator)).toBe(true);
      expect(Number.isInteger(preset.frameRate.denominator)).toBe(true);
      expect(preset.frameRate.denominator).toBeGreaterThan(0);
    }
  });
});

describe("h264CodecString", () => {
  it("picks a level that can carry the frame size", () => {
    // Level 4.0 caps the coded area well below 4K; asking for one anyway is how
    // an export dies inside the encoder instead of in a message.
    expect(h264CodecString(1280, 720, 30)).toBe("avc1.42001f");
    expect(h264CodecString(1920, 1080, 30)).toBe("avc1.420028");
    // 4K30 is 32,400 macroblocks at 972,000/s, which level 5.1 carries; only
    // 4K60 needs 5.2. Asking for a higher level than the picture needs would
    // narrow the set of decoders that will play the file.
    expect(h264CodecString(3840, 2160, 30)).toBe("avc1.420033");
    expect(h264CodecString(3840, 2160, 60)).toBe("avc1.420034");
  });

  it("raises the level when the frame rate raises the macroblock rate", () => {
    // Same picture, twice the rate: 1080p60 exceeds level 4.0's throughput.
    expect(h264CodecString(1920, 1080, 60)).not.toBe(
      h264CodecString(1920, 1080, 30),
    );
  });

  it("never returns a level below the smallest one it knows", () => {
    expect(h264CodecString(64, 64, 24)).toMatch(/^avc1\.4200[0-9a-f]{2}$/);
  });
});
