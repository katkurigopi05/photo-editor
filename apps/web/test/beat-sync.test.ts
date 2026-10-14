import { describe, expect, it } from "vitest";
import {
  analyzeAudioBeats,
  snapClipsToMusicalBeats,
  type BeatMarker,
  type TimelineClipCut,
} from "../src/beat-sync.js";

describe("AI Audio Beat Sync & Rhythm Detection", () => {
  it("detects rhythmic beats and estimates BPM from synthetic pulse track", () => {
    // Generate 2 seconds of 120 BPM audio (pulses every 0.5s -> 22050 samples at 44.1kHz)
    const sampleRate = 44100;
    const durationSec = 2;
    const pcm = new Float32Array(sampleRate * durationSec);

    // Inject pulses at 0.0s, 0.5s, 1.0s, 1.5s
    const pulseIndices = [0, 22050, 44100, 66150];
    for (const pulse of pulseIndices) {
      for (let j = 0; j < 500; j += 1) {
        if (pulse + j < pcm.length) {
          pcm[pulse + j] = 0.9 * Math.sin((j / 10) * Math.PI);
        }
      }
    }

    const result = analyzeAudioBeats(pcm, sampleRate);
    expect(result.beats.length).toBeGreaterThanOrEqual(3);
    expect(result.bpm).toBeGreaterThanOrEqual(110);
    expect(result.bpm).toBeLessThanOrEqual(130);
    expect(result.beats[0]?.isDownbeat).toBe(true);
  });

  it("handles empty or silent audio gracefully", () => {
    const emptyPcm = new Float32Array(0);
    const result = analyzeAudioBeats(emptyPcm);
    expect(result.beats).toEqual([]);
    expect(result.bpm).toBe(120);
    expect(result.averageEnergy).toBe(0);
  });

  it("snaps clip boundaries to nearest musical beats within tolerance", () => {
    const beats: BeatMarker[] = [
      { timeMicroseconds: 500_000n, intensity: 1.0, isDownbeat: true },
      { timeMicroseconds: 1_000_000n, intensity: 0.8, isDownbeat: false },
      { timeMicroseconds: 1_500_000n, intensity: 0.8, isDownbeat: false },
    ];

    const clips: TimelineClipCut[] = [
      // Clip starts at 520ms (within 200ms of 500ms beat)
      { id: "clip-1", startMicroseconds: 520_000n, durationMicroseconds: 400_000n },
      // Clip starts at 850ms (150ms from 1000ms beat)
      { id: "clip-2", startMicroseconds: 850_000n, durationMicroseconds: 300_000n },
      // Clip starts at 2200ms (far beyond 200ms tolerance from 1500ms)
      { id: "clip-3", startMicroseconds: 2_200_000n, durationMicroseconds: 500_000n },
    ];

    const snapped = snapClipsToMusicalBeats(clips, beats, 200_000n);

    expect(snapped[0]?.startMicroseconds).toBe(500_000n);
    expect(snapped[1]?.startMicroseconds).toBe(1_000_000n);
    expect(snapped[2]?.startMicroseconds).toBe(2_200_000n); // Unaltered
  });
});
