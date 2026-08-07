import { describe, expect, it } from "vitest";
import {
  browserPresetUnsupportedReason,
  type ExportPreset,
} from "../src/index.js";

/**
 * The preset schema mirrors the Rust engine and accepts the full codec matrix.
 * The browser path implements a slice of it, and used to accept the rest and
 * silently encode H.264/MP4 regardless — a wrong file rather than an error.
 */
const base: ExportPreset = {
  width: 1280,
  height: 720,
  frameRate: { numerator: 30, denominator: 1 },
  videoCodec: "h264",
  container: "mp4",
  videoBitrateKbps: 6000,
  audioCodec: "opus",
  audioSampleRate: 48000,
};

describe("browserPresetUnsupportedReason", () => {
  it("accepts what the browser exporter actually produces", () => {
    expect(browserPresetUnsupportedReason(base)).toBeNull();
  });

  it("accepts a silent export", () => {
    expect(
      browserPresetUnsupportedReason({ ...base, audioCodec: "none" }),
    ).toBeNull();
  });

  it("rejects a codec the browser path cannot encode", () => {
    const reason = browserPresetUnsupportedReason({
      ...base,
      videoCodec: "av1",
    });
    expect(reason).toContain("av1");
  });

  it("rejects a container the browser path cannot mux", () => {
    // vp9/webm is a legitimate combination for the Rust engine, so this has to
    // fail on browser capability rather than on codec/container compatibility.
    const reason = browserPresetUnsupportedReason({
      ...base,
      videoCodec: "vp9",
      container: "webm",
    });
    expect(reason).not.toBeNull();
    expect(reason).toContain("vp9");
  });

  it("rejects an audio codec the browser path cannot encode", () => {
    const reason = browserPresetUnsupportedReason({
      ...base,
      audioCodec: "flac",
    });
    expect(reason).toContain("flac");
  });

  it("reports an impossible codec/container pairing before capability", () => {
    // prores in mp4 is invalid for any engine; say that rather than blaming
    // the browser for it.
    const reason = browserPresetUnsupportedReason({
      ...base,
      videoCodec: "prores",
      container: "mp4",
    });
    expect(reason).toContain("container");
  });

  it("explains itself rather than returning a bare refusal", () => {
    const reason = browserPresetUnsupportedReason({
      ...base,
      videoCodec: "h265",
    });
    expect(reason?.length ?? 0).toBeGreaterThan(20);
  });
});
