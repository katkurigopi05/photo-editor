/**
 * Audio metering.
 *
 * Mixing by ear alone is the audio version of grading on an uncalibrated
 * screen: system volume, headphones and room all sit between the file and the
 * judgement. A meter measures the signal instead, which is the only way to know
 * whether a mix is clipping or whether a quiet passage is quiet on purpose.
 *
 * Two numbers per channel, because they answer different questions. **Peak** is
 * the highest sample — what clips. **RMS** is the average energy over a window —
 * what sounds loud. A dialogue track can sit ten decibels below a music track
 * on peaks and still bury it.
 *
 * Everything here is arithmetic over sample buffers; nothing touches the Web
 * Audio graph or draws. That separation is what makes it testable, and it
 * matters here more than usual: metering a live graph in a headless browser has
 * already produced a false silent reading once (see LESSONS.md), so the maths
 * is pinned where it can be pinned.
 */

/** Anything below this reads as silence on the scale. */
export const METER_FLOOR_DB = -60;

/** Peak at or above this is treated as clipped. Not exactly 0dBFS: a sample
 * that reaches full scale has almost certainly been flattened by whatever came
 * before it. */
export const CLIP_DB = -0.1;

/** Highest absolute sample in the buffer, as a linear 0..1 gain. */
export function peakLevel(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i] ?? 0);
    if (value > peak) peak = value;
  }
  return peak;
}

/** Root-mean-square of the buffer, as a linear 0..1 gain. */
export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

/** Linear gain to decibels, with silence pinned to the floor rather than
 * running off to negative infinity. */
export function gainToDb(gain: number, floorDb: number = METER_FLOOR_DB): number {
  if (gain <= 0) return floorDb;
  return Math.max(floorDb, 20 * Math.log10(gain));
}

/**
 * Where a level sits on the meter, 0 at the floor and 1 at full scale.
 *
 * Linear in decibels, not in amplitude: a linear-amplitude meter spends most of
 * its length on the top six decibels and shows nothing at all where dialogue
 * lives.
 */
export function meterFraction(db: number, floorDb: number = METER_FLOOR_DB): number {
  if (db <= floorDb) return 0;
  if (db >= 0) return 1;
  return (db - floorDb) / -floorDb;
}

/** Whether a peak reading counts as clipped. */
export function isClipped(peakDb: number): boolean {
  return peakDb >= CLIP_DB;
}

/**
 * The falling peak-hold marker.
 *
 * A peak that lasts one frame is invisible at any sensible refresh rate, so the
 * marker jumps up instantly and falls back slowly. `decayDb` is how far it
 * drops per frame — the number that decides whether the meter feels responsive
 * or sticky.
 */
export function holdPeak(
  previousDb: number,
  currentDb: number,
  decayDb = 1.5,
  floorDb: number = METER_FLOOR_DB,
): number {
  if (currentDb >= previousDb) return currentDb;
  return Math.max(floorDb, currentDb, previousDb - decayDb);
}

export interface ChannelReading {
  peakDb: number;
  rmsDb: number;
  holdDb: number;
  clipped: boolean;
}

/**
 * One channel's reading from a buffer, carrying the previous hold forward.
 *
 * Clipping latches: the indicator stays lit until something clears it, because
 * a clip that shows for a sixtieth of a second is a clip nobody sees.
 */
export function readChannel(
  samples: Float32Array,
  previous?: ChannelReading,
  decayDb = 1.5,
): ChannelReading {
  const peakDb = gainToDb(peakLevel(samples));
  const rmsDb = gainToDb(rmsLevel(samples));
  const holdDb = holdPeak(previous?.holdDb ?? METER_FLOOR_DB, peakDb, decayDb);
  return {
    peakDb,
    rmsDb,
    holdDb,
    clipped: isClipped(peakDb) || (previous?.clipped ?? false),
  };
}

/** A reading of silence, with nothing held and nothing clipped. */
export function silentReading(): ChannelReading {
  return {
    peakDb: METER_FLOOR_DB,
    rmsDb: METER_FLOOR_DB,
    holdDb: METER_FLOOR_DB,
    clipped: false,
  };
}
