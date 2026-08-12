/**
 * Auto-scaling: find the right preview quality by *measuring* this machine
 * rather than guessing from what it reports about itself.
 *
 * This is an open-source editor that runs on hardware nobody here has seen, on
 * three operating systems and several browsers. `hardwareConcurrency` is a poor
 * proxy for any of that — it counts cores for a loop that uses one, says
 * nothing about the GPU, and Safari may not report it at all. Two machines with
 * eight cores can be a decade apart.
 *
 * So the device's own report is used only as a *starting guess*, and from then
 * on the frames themselves decide: too slow, step down; comfortably fast, step
 * up. A weak device settles low and stays usable; a strong one climbs and
 * actually gets the benefit of being strong.
 *
 * Everything here is pure. The controller is a function from (state, sample) to
 * state, so its behaviour — including the oscillation it must not do — is
 * testable without a browser, a GPU or a clock.
 */

/**
 * The quality ladder, in pixels of CPU grading per preview frame.
 *
 * Discrete rungs rather than a continuous dial: a continuous one would retune on
 * every frame and never settle, and the visible difference between neighbouring
 * rungs is small enough that a step is not jarring.
 */
export const QUALITY_LADDER: readonly number[] = [
  640 * 360, // 0 — a struggling machine stays interactive
  960 * 540, // 1
  1280 * 720, // 2 — the default guess
  1920 * 1080, // 3
  2560 * 1440, // 4 — only reached by a machine that has earned it
];

export const DEFAULT_LEVEL = 2;

export interface AdaptiveConfig {
  /** Milliseconds a preview frame may spend before quality steps down. About a
   * third of a 60fps budget: the grade is not the only work in a frame. */
  targetMs: number;
  /** Frames considered before any decision. */
  window: number;
  /** Frames to wait after a change before considering another, so a step has
   * time to show up in the measurements it caused. */
  cooldown: number;
}

export const DEFAULT_CONFIG: AdaptiveConfig = {
  targetMs: 6,
  window: 12,
  cooldown: 24,
};

export interface AdaptiveState {
  level: number;
  /** Recent frame costs in milliseconds, newest last. */
  samples: readonly number[];
  /** Frames remaining before another change may be considered. */
  cooldown: number;
  /** Set once the level was chosen by measurement rather than by the initial
   * guess — surfaced so the report can say which it is. */
  measured: boolean;
}

export function createAdaptiveState(level = DEFAULT_LEVEL): AdaptiveState {
  return {
    level: clampLevel(level),
    samples: [],
    cooldown: 0,
    measured: false,
  };
}

const clampLevel = (n: number): number =>
  Math.max(0, Math.min(QUALITY_LADDER.length - 1, Math.round(n)));

/** The median of a non-empty list. Median, not mean: one 200ms frame from a
 * garbage collection or a video decode hitch must not drag quality down. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * Fold one frame's cost into the controller.
 *
 * Steps **down** when the median exceeds the target, and **up** only when the
 * median is under half of it. That gap is deliberate hysteresis: with a single
 * threshold a machine sitting near it would step down, become fast, step up,
 * become slow, and flap forever — visibly, since every change is a resolution
 * change.
 */
export function observeFrame(
  state: AdaptiveState,
  costMs: number,
  config: AdaptiveConfig = DEFAULT_CONFIG,
): AdaptiveState {
  if (!Number.isFinite(costMs) || costMs < 0) return state;

  if (state.cooldown > 0) {
    return { ...state, cooldown: state.cooldown - 1, samples: [] };
  }

  const samples = [...state.samples, costMs].slice(-config.window);
  if (samples.length < config.window) return { ...state, samples };

  const cost = median(samples);
  if (cost > config.targetMs && state.level > 0) {
    return {
      level: state.level - 1,
      samples: [],
      cooldown: config.cooldown,
      measured: true,
    };
  }
  if (cost < config.targetMs / 2 && state.level < QUALITY_LADDER.length - 1) {
    return {
      level: state.level + 1,
      samples: [],
      cooldown: config.cooldown,
      measured: true,
    };
  }
  // Settled: keep the window so a later drift is still noticed promptly.
  return { ...state, samples };
}

/** The pixel budget the current level allows. */
export function budgetForLevel(level: number): number {
  return QUALITY_LADDER[clampLevel(level)]!;
}

/** What the user asked for. `auto` measures; the rest pin a rung and stop. */
export type QualityPreference = "auto" | "low" | "medium" | "high";

export const QUALITY_PREFERENCES: readonly QualityPreference[] = [
  "auto",
  "low",
  "medium",
  "high",
];

export function isQualityPreference(v: unknown): v is QualityPreference {
  return (
    typeof v === "string" &&
    (QUALITY_PREFERENCES as readonly string[]).includes(v)
  );
}

/**
 * The level a preference forces, or `null` for `auto`.
 *
 * A manual override exists because measurement cannot know intent: someone
 * grading a still wants the best preview their machine can manage even if it
 * costs frames, and someone on battery may want the opposite.
 */
export function levelForPreference(pref: QualityPreference): number | null {
  switch (pref) {
    case "low":
      return 0;
    case "medium":
      return DEFAULT_LEVEL;
    case "high":
      return QUALITY_LADDER.length - 1;
    default:
      return null;
  }
}

/** A short account of where auto-scaling has settled, for the device report. */
export function describeQuality(
  state: AdaptiveState,
  pref: QualityPreference,
): string {
  const mp = (budgetForLevel(state.level) / 1_000_000).toFixed(1);
  if (pref !== "auto") {
    return `Preview quality: fixed at ${pref} (${mp} megapixels of grading per frame).`;
  }
  return state.measured
    ? `Preview quality: auto, settled at ${mp} megapixels of grading per frame after measuring this machine.`
    : `Preview quality: auto, starting at ${mp} megapixels of grading per frame while it measures this machine.`;
}
