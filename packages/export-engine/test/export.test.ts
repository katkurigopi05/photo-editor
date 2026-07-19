import { describe, expect, it } from "vitest";
import {
  advanceExport,
  cancelExport,
  exportPresetSchema,
  failExport,
  hasCompletedOutput,
  isCodecContainerCompatible,
  isTerminal,
  planExport,
  planVideoFrames,
  startExport,
  timeOutExport,
} from "../src/index.js";
import { mp4Preset, twoSecondProject } from "./fixtures.js";

describe("preset validation", () => {
  it("accepts a valid preset", () => {
    expect(exportPresetSchema.safeParse(mp4Preset).success).toBe(true);
  });

  it("rejects invalid presets", () => {
    expect(
      exportPresetSchema.safeParse({ ...mp4Preset, width: -1 }).success,
    ).toBe(false);
    expect(
      exportPresetSchema.safeParse({ ...mp4Preset, videoCodec: "xvid" })
        .success,
    ).toBe(false);
  });
});

describe("codec/container compatibility", () => {
  it("matches the container matrix", () => {
    expect(isCodecContainerCompatible("h264", "mp4")).toBe(true);
    expect(isCodecContainerCompatible("vp9", "webm")).toBe(true);
    expect(isCodecContainerCompatible("h264", "webm")).toBe(false);
    expect(isCodecContainerCompatible("prores", "mov")).toBe(true);
    expect(isCodecContainerCompatible("prores", "mp4")).toBe(false);
  });

  it("planExport rejects an incompatible codec/container", () => {
    const result = planExport(twoSecondProject(), "sequence-1", {
      ...mp4Preset,
      container: "webm",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INCOMPATIBLE_CODEC");
  });
});

describe("planExport", () => {
  it("is deterministic and reproducible", () => {
    const a = planExport(twoSecondProject(), "sequence-1", mp4Preset);
    const b = planExport(twoSecondProject(), "sequence-1", mp4Preset);
    expect(a).toEqual(b);
  });

  it("computes frame count and audio sample count (round-trip fixture)", () => {
    const result = planExport(twoSecondProject(), "sequence-1", mp4Preset);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 2s at 30fps = 60 frames; 2s at 48kHz = 96000 samples.
      expect(result.plan.framesTotal).toBe(60);
      expect(result.plan.audioSampleCount).toBe(96000);
      expect(result.plan.durationUs).toBe("2000000");
      expect(result.plan.projectVersion).toBe(6);
      expect(result.plan.audioClips.map((c) => c.clipId)).toEqual(["clip-a"]);
    }
  });

  it("binds to a specific project version (headless reproducibility)", () => {
    const result = planExport(twoSecondProject(), "sequence-1", mp4Preset);
    if (result.ok) expect(result.plan.projectVersion).toBe(6);
  });

  it("returns SEQUENCE_NOT_FOUND / EMPTY_SEQUENCE", () => {
    const missing = planExport(twoSecondProject(), "nope", mp4Preset);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe("SEQUENCE_NOT_FOUND");

    const empty = twoSecondProject();
    empty.sequences[0]!.tracks = [];
    const result = planExport(empty, "sequence-1", mp4Preset);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("EMPTY_SEQUENCE");
  });
});

describe("planVideoFrames", () => {
  it("returns per-frame render requests for a bounded range", () => {
    const frames = planVideoFrames(
      twoSecondProject(),
      "sequence-1",
      mp4Preset,
      0,
      3,
    );
    expect(frames.map((f) => f.frameIndex)).toEqual([0, 1, 2]);
    expect(frames[0]?.layers[0]?.clipId).toBe("clip-v");
  });
});

describe("export job", () => {
  function runningJob() {
    const result = planExport(twoSecondProject(), "sequence-1", mp4Preset);
    if (!result.ok) throw new Error("plan failed");
    return startExport(result.plan);
  }

  it("advances to completion", () => {
    let job = runningJob();
    expect(job.status).toBe("running");
    job = advanceExport(job, 30);
    expect(job.status).toBe("running");
    job = advanceExport(job, 60);
    expect(job.status).toBe("completed");
    expect(hasCompletedOutput(job)).toBe(true);
  });

  it("cancellation leaves no completed output", () => {
    let job = advanceExport(runningJob(), 30);
    job = cancelExport(job);
    expect(job.status).toBe("cancelled");
    expect(hasCompletedOutput(job)).toBe(false);
    // further advances are no-ops after a terminal state
    expect(advanceExport(job, 60)).toBe(job);
  });

  it("records typed failures", () => {
    const job = failExport(runningJob(), {
      code: "SEQUENCE_NOT_FOUND",
      message: "gone",
    });
    expect(job.status).toBe("failed");
    expect(job.error?.code).toBe("SEQUENCE_NOT_FOUND");
    expect(hasCompletedOutput(job)).toBe(false);
  });

  it("times out as a distinct terminal state from failed/cancelled", () => {
    let job = advanceExport(runningJob(), 30);
    job = timeOutExport(job);
    expect(job.status).toBe("timed_out");
    expect(job.error?.code).toBe("TIMED_OUT");
    expect(hasCompletedOutput(job)).toBe(false);
    expect(isTerminal(job)).toBe(true);
    // further advances/timeouts are no-ops after a terminal state
    expect(advanceExport(job, 60)).toBe(job);
    expect(timeOutExport(job)).toBe(job);
  });
});
