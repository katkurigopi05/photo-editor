import type { ClipMask } from "@director/project-schema";
import type { Mask } from "@director/raster-tools";
import { rasterizeClipMask } from "./mask-raster.js";

/**
 * Reusing rasterised mask coverage between grade passes.
 *
 * `gradeCache` is keyed on the effect parameters as well as the mask, so
 * dragging a Brightness slider on a masked clip misses it every frame and
 * rebuilds the mask — producing exactly the coverage it produced the frame
 * before, because the *mask* did not move.
 *
 * Measured, for one radial mask: **21.9ms per frame at 1080p and 74.7ms at 4K**.
 * At 4K that is more than the entire GPU grade it was feeding (32.9ms), so this
 * was the dominant cost of a masked grade and it was pure repetition.
 *
 * Worth doing before moving rasterisation to a shader: there is no point
 * accelerating work that should not run at all.
 */

/**
 * Mask kinds whose coverage depends only on geometry.
 *
 * `luminance_range` and `color_range` read the frame's own pixels, so their
 * coverage genuinely depends on what the image looks like at that point in the
 * chain — reusing it across frames would show the wrong region the moment a
 * grade changed the brightness it keys on. Only shapes are cacheable.
 */
const GEOMETRIC_MASK_KINDS: ReadonlySet<string> = new Set([
  "linear",
  "radial",
  "brush",
]);

export const maskIsGeometric = (mask: ClipMask): boolean =>
  mask.contributions.every((c) => GEOMETRIC_MASK_KINDS.has(c.kind));

/** Bounded like the caches around it: this exists for one slider drag, not for
 * a session's history. */
const MAX_ENTRIES = 8;

const cache = new Map<string, Mask>();
let hits = 0;
let misses = 0;

/**
 * The contributions decide the shape, so they are the key — not the mask id,
 * which stays the same while the shape is being dragged. Size is in the key
 * because coverage is rasterised at the frame's resolution, and a preview and
 * an export ask for different ones.
 */
const keyFor = (mask: ClipMask, width: number, height: number): string =>
  `${mask.id}|${width}x${height}|${JSON.stringify(mask.contributions)}`;

/**
 * Coverage for a geometric mask, rasterised once per shape and size.
 *
 * Callers must check `maskIsGeometric` first. Passing a range mask here would
 * rasterise it against an empty buffer and cache the result, which is a wrong
 * region held onto — so it is refused rather than quietly served.
 */
export function geometricCoverage(
  mask: ClipMask,
  width: number,
  height: number,
): Mask {
  if (!maskIsGeometric(mask)) {
    throw new Error(
      `${mask.id} has a contribution that reads the picture, so its coverage cannot be reused between frames`,
    );
  }

  const key = keyFor(mask, width, height);
  const hit = cache.get(key);
  if (hit) {
    hits += 1;
    return hit;
  }
  misses += 1;

  // Geometric contributions never read the pixels, so there are none to give.
  const coverage = rasterizeClipMask(mask, {
    width,
    height,
    data: new Uint8ClampedArray(0),
  });

  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, coverage);
  return coverage;
}

/** Hit/miss counts. Exists so a test can assert the cache is actually used —
 * a cache that never hits is dead code that still looks correct. */
export const maskCoverageStats = (): { hits: number; misses: number } => ({
  hits,
  misses,
});

export function resetMaskCoverageCache(): void {
  cache.clear();
  hits = 0;
  misses = 0;
}
