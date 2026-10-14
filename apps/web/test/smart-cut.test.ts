import { describe, expect, it } from "vitest";
import { planSmartSilenceCut } from "../src/smart-cut.js";

describe("AI Smart Silence & Dead Air Cutter", () => {
  it("detects silence intervals and generates jump-cut plan", () => {
    const sampleRate = 44100;
    // 3 seconds total:
    // 0.0s - 1.0s: speech (amplitude 0.5)
    // 1.0s - 2.0s: silence (amplitude 0.0)
    // 2.0s - 3.0s: speech (amplitude 0.5)
    const pcm = new Float32Array(sampleRate * 3);

    for (let i = 0; i < sampleRate; i += 1) {
      pcm[i] = 0.5;
    }
    // 1s to 2s is 0.0 (silence)
    for (let i = sampleRate * 2; i < sampleRate * 3; i += 1) {
      pcm[i] = 0.5;
    }

    const plan = planSmartSilenceCut(pcm, sampleRate, {
      silenceThreshold: 0.02,
      minSilenceDurationMicroseconds: 400_000n, // 400ms
      paddingMicroseconds: 50_000n, // 50ms padding
    });

    expect(plan.gapsToRemove.length).toBe(1);
    const gap = plan.gapsToRemove[0]!;
    // Raw gap was [1.0s, 2.0s]. With 50ms padding on each side, cut should be approx [1.05s, 1.95s]
    expect(gap.startMicroseconds).toBeGreaterThanOrEqual(1_000_000n);
    expect(gap.endMicroseconds).toBeLessThanOrEqual(2_000_000n);
    expect(gap.durationMicroseconds).toBeGreaterThan(800_000n);

    // Kept spans should divide into 2 speech segments
    expect(plan.keptSpans.length).toBe(2);
    expect(plan.totalSavedDurationMicroseconds).toBe(gap.durationMicroseconds);
  });

  it("handles completely silent or active audio without unwanted cuts", () => {
    const sampleRate = 44100;
    // All active audio (no silence)
    const activePcm = new Float32Array(sampleRate).fill(0.4);
    const plan = planSmartSilenceCut(activePcm, sampleRate);

    expect(plan.gapsToRemove.length).toBe(0);
    expect(plan.keptSpans.length).toBe(1);
    expect(plan.totalSavedDurationMicroseconds).toBe(0n);
  });
});
