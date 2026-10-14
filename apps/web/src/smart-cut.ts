/**
 * AI Smart Silence & Dead Air Cutter Engine.
 *
 * Implements CapCut-style speaker trimming:
 * - Scans audio waveforms for speech pauses and dead air
 * - Detects silent gaps below adaptive threshold
 * - Generates tight jump-cut ripple edit plans with configurable attack/release padding
 */

export interface SpeechGap {
  startMicroseconds: bigint;
  endMicroseconds: bigint;
  durationMicroseconds: bigint;
}

export interface SmartCutPlan {
  totalOriginalDurationMicroseconds: bigint;
  totalSavedDurationMicroseconds: bigint;
  gapsToRemove: readonly SpeechGap[];
  keptSpans: readonly {
    startMicroseconds: bigint;
    endMicroseconds: bigint;
  }[];
}

export interface SmartCutOptions {
  /** RMS threshold below which audio is considered silence [0..1], default 0.02. */
  silenceThreshold?: number | undefined;
  /** Minimum silence duration to cut in microseconds, default 400,000 (400ms). */
  minSilenceDurationMicroseconds?: bigint | undefined;
  /** Safety padding in microseconds kept around words before and after cut, default 60,000 (60ms). */
  paddingMicroseconds?: bigint | undefined;
}

/**
 * Detects silent gaps in audio and plans ripple jump-cuts.
 */
export function planSmartSilenceCut(
  pcmData: Float32Array,
  sampleRate = 44100,
  options: SmartCutOptions = {},
): SmartCutPlan {
  const threshold = options.silenceThreshold ?? 0.02;
  const minDurationMicros = options.minSilenceDurationMicroseconds ?? 400_000n;
  const paddingMicros = options.paddingMicroseconds ?? 60_000n;

  const totalDurationMicros =
    sampleRate > 0
      ? BigInt(Math.round((pcmData.length / sampleRate) * 1_000_000))
      : 0n;

  if (pcmData.length === 0 || sampleRate <= 0) {
    return {
      totalOriginalDurationMicroseconds: 0n,
      totalSavedDurationMicroseconds: 0n,
      gapsToRemove: [],
      keptSpans: [],
    };
  }

  // 1. Compute frame energy in 20ms chunks
  const chunkSize = Math.max(1, Math.round(sampleRate * 0.02)); // 20ms
  const isSilentChunk: boolean[] = [];

  for (let i = 0; i < pcmData.length; i += chunkSize) {
    let sumSq = 0;
    const end = Math.min(pcmData.length, i + chunkSize);
    const count = end - i;
    for (let j = i; j < end; j += 1) {
      const s = pcmData[j] ?? 0;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / count);
    isSilentChunk.push(rms < threshold);
  }

  // 2. Identify contiguous silent intervals
  const rawGaps: Array<{ startChunk: number; endChunk: number }> = [];
  let inSilence = false;
  let gapStart = 0;

  for (let i = 0; i < isSilentChunk.length; i += 1) {
    if (isSilentChunk[i]) {
      if (!inSilence) {
        inSilence = true;
        gapStart = i;
      }
    } else {
      if (inSilence) {
        inSilence = false;
        rawGaps.push({ startChunk: gapStart, endChunk: i });
      }
    }
  }
  if (inSilence) {
    rawGaps.push({ startChunk: gapStart, endChunk: isSilentChunk.length });
  }

  // 3. Filter by min duration and apply safety padding
  const chunkDurationMicros = BigInt(Math.round((chunkSize / sampleRate) * 1_000_000));
  const validGaps: SpeechGap[] = [];

  for (const g of rawGaps) {
    const rawStartMicros = BigInt(g.startChunk) * chunkDurationMicros;
    const rawEndMicros = BigInt(g.endChunk) * chunkDurationMicros;
    const rawDuration = rawEndMicros - rawStartMicros;

    if (rawDuration >= minDurationMicros) {
      // Add padding: keep audio for paddingMicros after speech ends, and before speech starts
      const paddedStart = rawStartMicros + paddingMicros;
      const paddedEnd = rawEndMicros > paddingMicros ? rawEndMicros - paddingMicros : rawEndMicros;

      if (paddedEnd > paddedStart && paddedEnd - paddedStart >= 100_000n) {
        // At least 100ms cut
        validGaps.push({
          startMicroseconds: paddedStart,
          endMicroseconds: paddedEnd,
          durationMicroseconds: paddedEnd - paddedStart,
        });
      }
    }
  }

  // 4. Compute kept spans
  const keptSpans: Array<{ startMicroseconds: bigint; endMicroseconds: bigint }> = [];
  let currentPos = 0n;
  let totalSaved = 0n;

  for (const gap of validGaps) {
    if (gap.startMicroseconds > currentPos) {
      keptSpans.push({
        startMicroseconds: currentPos,
        endMicroseconds: gap.startMicroseconds,
      });
    }
    totalSaved += gap.durationMicroseconds;
    currentPos = gap.endMicroseconds;
  }

  if (currentPos < totalDurationMicros) {
    keptSpans.push({
      startMicroseconds: currentPos,
      endMicroseconds: totalDurationMicros,
    });
  }

  return {
    totalOriginalDurationMicroseconds: totalDurationMicros,
    totalSavedDurationMicroseconds: totalSaved,
    gapsToRemove: validGaps,
    keptSpans,
  };
}
