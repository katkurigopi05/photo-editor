/**
 * AI Audio Beat Sync & Rhythm Detection Engine.
 *
 * Implements CapCut-style audio beat detection, tempo estimation,
 * downbeat detection, and automatic clip cut alignment to musical rhythms.
 */

export interface BeatMarker {
  timeMicroseconds: bigint;
  intensity: number; // 0..1 peak prominence
  isDownbeat: boolean; // First beat in bar
}

export interface BeatAnalysisResult {
  bpm: number;
  beats: readonly BeatMarker[];
  averageEnergy: number;
}

export interface TimelineClipCut {
  id: string;
  startMicroseconds: bigint;
  durationMicroseconds: bigint;
}

/**
 * Detects audio peaks and rhythm beats from Float32Array PCM audio buffer.
 */
export function analyzeAudioBeats(
  pcmData: Float32Array,
  sampleRate = 44100,
  windowSize = 1024,
  hopSize = 512,
): BeatAnalysisResult {
  if (pcmData.length === 0 || sampleRate <= 0) {
    return { bpm: 120, beats: [], averageEnergy: 0 };
  }

  // 1. Calculate local Root-Mean-Square (RMS) energy envelopes
  const energies: number[] = [];
  const timesMs: number[] = [];

  for (let i = 0; i < pcmData.length - windowSize; i += hopSize) {
    let sumSquares = 0;
    for (let j = 0; j < windowSize; j += 1) {
      const sample = pcmData[i + j] ?? 0;
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / windowSize);
    energies.push(rms);
    const timeSec = (i + windowSize / 2) / sampleRate;
    timesMs.push(timeSec * 1000);
  }

  if (energies.length === 0) {
    return { bpm: 120, beats: [], averageEnergy: 0 };
  }

  // 2. Compute average and threshold
  const totalEnergy = energies.reduce((acc, v) => acc + v, 0);
  const avgEnergy = totalEnergy / energies.length;

  // Local adaptive thresholding for onset detection
  const detectedPeaks: Array<{ timeMs: number; energy: number }> = [];
  const localRadius = 8;

  for (let i = localRadius; i < energies.length - localRadius; i += 1) {
    const current = energies[i] ?? 0;
    if (current <= avgEnergy * 1.2) continue;

    // Check if local maximum
    let isMax = true;
    for (let k = -localRadius; k <= localRadius; k += 1) {
      if (k !== 0 && (energies[i + k] ?? 0) >= current) {
        isMax = false;
        break;
      }
    }

    if (isMax) {
      const timeMs = timesMs[i];
      if (timeMs !== undefined) {
        detectedPeaks.push({ timeMs, energy: current });
      }
    }
  }

  // 3. Estimate BPM from inter-peak intervals
  let estimatedBpm = 120;
  if (detectedPeaks.length >= 2) {
    const intervalsMs: number[] = [];
    for (let i = 1; i < detectedPeaks.length; i += 1) {
      const prev = detectedPeaks[i - 1]?.timeMs;
      const curr = detectedPeaks[i]?.timeMs;
      if (prev !== undefined && curr !== undefined) {
        const diff = curr - prev;
        if (diff >= 250 && diff <= 1200) {
          // 50 BPM - 240 BPM
          intervalsMs.push(diff);
        }
      }
    }

    if (intervalsMs.length > 0) {
      intervalsMs.sort((a, b) => a - b);
      const medianIntervalMs =
        intervalsMs[Math.floor(intervalsMs.length / 2)] ?? 500;
      if (medianIntervalMs > 0) {
        estimatedBpm = Math.round((60 * 1000) / medianIntervalMs);
      }
    }
  }

  // 4. Build beat markers with intensity and downbeat rhythm (every 4th beat)
  const beats: BeatMarker[] = [];
  const maxPeakEnergy = detectedPeaks.reduce(
    (max, p) => Math.max(max, p.energy),
    0.01,
  );

  detectedPeaks.forEach((p, idx) => {
    const timeMicros = BigInt(Math.round(p.timeMs * 1000));
    const intensity = Math.min(1, Math.round((p.energy / maxPeakEnergy) * 100) / 100);
    beats.push({
      timeMicroseconds: timeMicros,
      intensity,
      isDownbeat: idx % 4 === 0,
    });
  });

  return {
    bpm: estimatedBpm,
    beats,
    averageEnergy: Math.round(avgEnergy * 1000) / 1000,
  };
}

/**
 * Snaps timeline clip boundaries to nearest rhythmic musical beats.
 */
export function snapClipsToMusicalBeats(
  clips: readonly TimelineClipCut[],
  beats: readonly BeatMarker[],
  toleranceMicroseconds = 200_000n, // ±200ms
): TimelineClipCut[] {
  if (beats.length === 0) return [...clips];

  return clips.map((clip) => {
    let bestSnapStart = clip.startMicroseconds;
    let minDiff = toleranceMicroseconds + 1n;

    for (const beat of beats) {
      const diff =
        beat.timeMicroseconds > clip.startMicroseconds
          ? beat.timeMicroseconds - clip.startMicroseconds
          : clip.startMicroseconds - beat.timeMicroseconds;

      if (diff <= toleranceMicroseconds && diff < minDiff) {
        minDiff = diff;
        bestSnapStart = beat.timeMicroseconds;
      }
    }

    return {
      id: clip.id,
      startMicroseconds: bestSnapStart,
      durationMicroseconds: clip.durationMicroseconds,
    };
  });
}
