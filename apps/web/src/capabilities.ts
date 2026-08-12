/**
 * What this machine can do, and what the app does about it.
 *
 * The app already refuses gracefully when a browser lacks `VideoEncoder` or the
 * File System Access API. What it never did was *say* so, or adapt to how fast
 * the machine is — so a fork running on a weaker or stronger device got the
 * same fixed behaviour and no explanation when something was unavailable.
 *
 * Everything here is a pure function of a capability snapshot, so it is
 * testable without a browser and cannot itself depend on the environment it is
 * describing.
 */

/** A snapshot of the environment, taken once and passed around explicitly. */
export interface Environment {
  hasVideoEncoder: boolean;
  hasFileSystemAccess: boolean;
  hasOffscreenCanvas: boolean;
  /** Logical cores, when the browser reports them. */
  cores: number | undefined;
  /** Approximate RAM in GB, when the browser reports it. Chromium only, and
   * deliberately coarse — it is a hint, not a measurement. */
  memoryGb: number | undefined;
  devicePixelRatio: number;
}

/** Read the environment. The only impure function in this module. */
export function readEnvironment(): Environment {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  return {
    hasVideoEncoder: typeof VideoEncoder !== "undefined",
    hasFileSystemAccess:
      typeof (window as unknown as { showSaveFilePicker?: unknown })
        .showSaveFilePicker === "function",
    hasOffscreenCanvas: typeof OffscreenCanvas !== "undefined",
    cores: nav.hardwareConcurrency,
    memoryGb: nav.deviceMemory,
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

/**
 * How many pixels the CPU grade path may process for one *preview* frame.
 *
 * There is a budget at all because of one specific path: an adjustment layer
 * grades the live canvas, so its cost scales with the size of the preview —
 * which scales with the viewer's window *and* their device pixel ratio. Left
 * alone, the same project costs a 4K retina machine roughly four times what it
 * costs a 1080p one, which inverts the usual relationship between better
 * hardware and a better experience.
 *
 * Ordinary clips are unaffected: they grade at the media's own resolution and
 * the result is cached, so this budget never touches them.
 *
 * Export is never budgeted. A render must be deterministic and full quality —
 * it cannot depend on how fast the machine doing it happens to be.
 */
export function previewGradeBudgetPx(env: Environment): number {
  // 720p of pixel work is roughly a millisecond-scale JS loop per effect on a
  // modest machine, and an adjustment layer runs it every frame.
  const BASE = 1280 * 720;
  // A machine that reports very few cores is likely also slow per core, and is
  // the one that most needs the preview to stay responsive.
  if (env.cores !== undefined && env.cores <= 2) return Math.round(BASE / 2);
  // Plenty of cores does not make the *main thread* faster — this work is not
  // parallel — so a fast machine gets more resolution, not unlimited.
  if (env.cores !== undefined && env.cores >= 8) return Math.round(BASE * 2);
  return BASE;
}

/**
 * Scale a size down to fit a pixel budget, preserving aspect ratio.
 *
 * Returns the original size when it already fits: scaling something that fits
 * would cost a resample and lose detail for nothing.
 */
export function fitWithinBudget(
  width: number,
  height: number,
  budgetPx: number,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const total = width * height;
  if (budgetPx <= 0 || total <= budgetPx) return { width, height };
  const scale = Math.sqrt(budgetPx / total);
  return {
    // At least one pixel each way: a zero-sized canvas throws on drawImage.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** A short, human-readable account of what is available and what is not. */
export function describeCapabilities(env: Environment): string[] {
  const lines: string[] = [];
  lines.push(
    env.hasVideoEncoder
      ? "Video export: available (WebCodecs)."
      : "Video export: unavailable — this browser has no VideoEncoder, so MP4 export and proxy building are off. Image and GIF export still work.",
  );
  lines.push(
    env.hasFileSystemAccess
      ? "Large exports: written straight to disk, so length is limited by free space."
      : "Large exports: assembled in memory and then downloaded, which limits how long an export can be.",
  );
  const cores = env.cores === undefined ? "unreported" : String(env.cores);
  const memory =
    env.memoryGb === undefined ? "unreported" : `${env.memoryGb} GB`;
  lines.push(`Machine: ${cores} cores, ${memory} RAM, ${env.devicePixelRatio}× display.`);
  const budget = previewGradeBudgetPx(env);
  lines.push(
    `Preview grading runs at up to ${(budget / 1_000_000).toFixed(1)} megapixels here; exports always render at full resolution.`,
  );
  return lines;
}
