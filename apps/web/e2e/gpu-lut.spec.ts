import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The GPU colour-table path must paint the same picture as the CPU one.
 *
 * A pointwise grading stack is already collapsed into a 33³ table; this moves
 * only the per-pixel lookup onto sampling hardware. That is worth doing only if
 * the two paths agree, because which one runs is decided at runtime by what the
 * machine has — a user with WebGL2 and one without must not be looking at
 * different grades.
 *
 * So every check here runs *both* and compares. What it deliberately does not
 * claim is that the GPU is faster: headless Chromium runs WebGL2 on SwiftShader,
 * a software rasteriser, so a timing taken here would measure the wrong machine
 * entirely. Speed is a separate measurement on real hardware.
 *
 * The tolerance was measured, not guessed, and the first guess was wrong in the
 * way that matters. It was set at 4 on the reasoning that texture filtering
 * rounds differently from float64 — but one cell of a 33-sample axis is 255/32 ≈
 * 8 levels, so a *half-texel lookup skew* also lands at ≈4. Dropping the `+ 0.5`
 * from the shader left every check passing. A tolerance chosen by argument
 * rather than measurement was exactly the size of the bug it existed to catch.
 *
 * Measured, the correct shader agrees with `applyLut3d` on every channel of
 * every pixel: max 0, mean 0 across all three recipes. The bound below is 1, to
 * allow a genuine last-bit difference on filtering hardware other than the one
 * CI runs, and it is four times smaller than the half-texel error.
 */

/**
 * Largest per-channel GPU/CPU difference treated as filtering noise.
 *
 * Verified to fail the half-texel mutation. Raising this is not a way to fix a
 * failing parity test — a real disagreement here means the two paths show
 * different pictures to different users.
 */
const FILTERING_TOLERANCE = 1;

const HARNESS = "/gpu-lut-harness.html";

interface Comparison {
  reason?: string;
  maxDelta: number;
  meanDelta: number;
  /** How far the graded result sits from the ungraded input. Proves the table
   * did something, so "the two agree" cannot pass by both doing nothing. */
  effect: number;
}

async function comparePaths(page: Page, recipe: string): Promise<Comparison> {
  return page.evaluate(async (name) => {
    const api = (window as unknown as { __gpuLutTest?: Record<string, never> })
      .__gpuLutTest as
      | {
          buildLut: (recipe: string) => Uint8ClampedArray;
          applyCpu: (i: ImageData, l: Uint8ClampedArray) => Uint8ClampedArray;
          applyGpu: (
            i: ImageData,
            l: Uint8ClampedArray,
          ) => Uint8ClampedArray | null;
        }
      | undefined;
    if (!api)
      return { reason: "harness missing", maxDelta: -1, meanDelta: -1, effect: -1 };

    // A gradient across all three axes, so the comparison covers the interior
    // of the cube where interpolation actually happens, not only its corners.
    const w = 128;
    const h = 128;
    const image = new ImageData(w, h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        image.data[i] = Math.round((x / (w - 1)) * 255);
        image.data[i + 1] = Math.round((y / (h - 1)) * 255);
        image.data[i + 2] = Math.round(((x + y) / (w + h - 2)) * 255);
        image.data[i + 3] = 255;
      }
    }

    const lut = api.buildLut(name);
    const cpu = api.applyCpu(image, lut);
    const gpu = api.applyGpu(image, lut);
    if (gpu === null)
      return { reason: "no WebGL2 renderer", maxDelta: -1, meanDelta: -1, effect: -1 };

    let maxDelta = 0;
    let total = 0;
    let count = 0;
    let effect = 0;
    for (let i = 0; i < cpu.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        const d = Math.abs(cpu[i + c]! - gpu[i + c]!);
        if (d > maxDelta) maxDelta = d;
        total += d;
        count += 1;
        effect += Math.abs(cpu[i + c]! - image.data[i + c]!);
      }
    }
    return { maxDelta, meanDelta: total / count, effect: effect / count };
  }, recipe);
}

test.beforeEach(async ({ page }) => {
  await page.goto(HARNESS, { waitUntil: "networkidle" });
});

test("the GPU path is genuinely under test here", async ({ page }) => {
  // Without this, every other check could pass vacuously by falling back to the
  // CPU and comparing it with itself.
  const available = await page.evaluate(
    () =>
      (window as unknown as { __gpuLutTest?: { available: boolean } })
        .__gpuLutTest?.available === true,
  );
  expect(available).toBe(true);
});

test("a levels grade lands in the same place on both paths", async ({
  page,
}) => {
  const r = await comparePaths(page, "levels");
  expect(r.reason).toBeUndefined();
  expect(r.effect).toBeGreaterThan(5);
  expect(r.maxDelta).toBeLessThanOrEqual(FILTERING_TOLERANCE);
});

test("a stack of several effects agrees too", async ({ page }) => {
  // The case the table exists for: white balance, levels and vibrance collapsed
  // into one lookup, which is where a mis-built table shows up most strongly.
  const r = await comparePaths(page, "stack");
  expect(r.reason).toBeUndefined();
  expect(r.effect).toBeGreaterThan(5);
  expect(r.maxDelta).toBeLessThanOrEqual(FILTERING_TOLERANCE);
});

test("the identity table leaves the picture alone", async ({ page }) => {
  // A half-texel error is nearly invisible under a strong grade and obvious
  // here: with an identity table the output must be the input, so any lookup
  // skew shows up as the whole image sliding along the colour axes.
  const maxDelta = await page.evaluate(() => {
    const api = (window as unknown as { __gpuLutTest?: Record<string, never> })
      .__gpuLutTest as
      | {
          identityLut: () => Uint8ClampedArray;
          applyGpu: (
            i: ImageData,
            l: Uint8ClampedArray,
          ) => Uint8ClampedArray | null;
        }
      | undefined;
    if (!api) return -1;
    const w = 64;
    const h = 64;
    const image = new ImageData(w, h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        image.data[i] = Math.round((x / (w - 1)) * 255);
        image.data[i + 1] = Math.round((y / (h - 1)) * 255);
        image.data[i + 2] = 128;
        image.data[i + 3] = 255;
      }
    }
    const out = api.applyGpu(image, api.identityLut());
    if (out === null) return -1;
    let worst = 0;
    for (let i = 0; i < out.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        const d = Math.abs(out[i + c]! - image.data[i + c]!);
        if (d > worst) worst = d;
      }
    }
    return worst;
  });
  expect(maxDelta).toBeGreaterThanOrEqual(0);
  expect(maxDelta).toBeLessThanOrEqual(FILTERING_TOLERANCE);
});

test("the picture is not flipped, mirrored or offset", async ({ page }) => {
  // The shader reads gl_FragCoord, whose y axis runs opposite to an ImageData's
  // rows. An identity table hides a colour error but not a geometric one, so
  // this marks one corner and checks it comes back in the same corner.
  const corners = await page.evaluate(() => {
    const api = (window as unknown as { __gpuLutTest?: Record<string, never> })
      .__gpuLutTest as
      | {
          identityLut: () => Uint8ClampedArray;
          applyGpu: (
            i: ImageData,
            l: Uint8ClampedArray,
          ) => Uint8ClampedArray | null;
        }
      | undefined;
    if (!api) return null;
    const w = 32;
    const h = 32;
    const image = new ImageData(w, h);
    for (let i = 0; i < image.data.length; i += 4) {
      image.data[i] = 128;
      image.data[i + 1] = 128;
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
    // One red pixel, top-left.
    image.data[0] = 255;
    image.data[1] = 0;
    image.data[2] = 0;

    const out = api.applyGpu(image, api.identityLut());
    if (out === null) return null;
    const at = (x: number, y: number): number[] => {
      const i = (y * w + x) * 4;
      return [out[i]!, out[i + 1]!, out[i + 2]!];
    };
    return {
      topLeft: at(0, 0),
      bottomLeft: at(0, h - 1),
      topRight: at(w - 1, 0),
    };
  });
  expect(corners).not.toBeNull();
  expect(corners!.topLeft[0]).toBeGreaterThan(200);
  expect(corners!.topLeft[1]).toBeLessThan(60);
  // The other corners stay grey: red has not travelled.
  expect(corners!.bottomLeft[0]).toBeLessThan(200);
  expect(corners!.topRight[0]).toBeLessThan(200);
});

/**
 * Masked chains.
 *
 * A masked stack is *not* one table. The CPU path applies each effect to the
 * whole frame and blends it back through that effect's own coverage before the
 * next one sees the pixels, so where coverage is partial
 * `blend(blend(x, A), B)` differs from `blend(x, B∘A)`. The GPU therefore runs
 * one pass per effect. These checks exist to hold that line — the collapsed
 * version is faster and would pass a test that only looked at fully-masked and
 * fully-unmasked pixels.
 */

interface ChainPass {
  recipe?: string;
  identity?: boolean;
  masked?: boolean;
}

/** Run the same chain through both appliers and report the worst disagreement,
 * split by whether coverage there was partial. */
async function compareChain(
  page: Page,
  passes: ChainPass[],
): Promise<{
  reason?: string;
  maxDelta: number;
  maxDeltaFeathered: number;
  effect: number;
}> {
  return page.evaluate((spec) => {
    const api = (window as unknown as { __gpuLutTest?: Record<string, never> })
      .__gpuLutTest as
      | {
          buildLut: (r: string) => Uint8ClampedArray;
          identityLut: () => Uint8ClampedArray;
          rampCoverage: (w: number, h: number) => Uint8ClampedArray;
          applyCpuChain: (
            i: ImageData,
            p: { lut: Uint8ClampedArray; coverage?: Uint8ClampedArray }[],
          ) => Uint8ClampedArray;
          applyGpuChain: (
            i: ImageData,
            p: { lut: Uint8ClampedArray; coverage?: Uint8ClampedArray }[],
          ) => Uint8ClampedArray | null;
        }
      | undefined;
    if (!api)
      return {
        reason: "harness missing",
        maxDelta: -1,
        maxDeltaFeathered: -1,
        effect: -1,
      };

    const w = 128;
    const h = 128;
    const image = new ImageData(w, h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        image.data[i] = Math.round((x / (w - 1)) * 255);
        image.data[i + 1] = Math.round((y / (h - 1)) * 255);
        image.data[i + 2] = Math.round(((x + y) / (w + h - 2)) * 255);
        image.data[i + 3] = 255;
      }
    }

    const coverage = api.rampCoverage(w, h);
    const built = spec.map((p) => ({
      lut: p.identity ? api.identityLut() : api.buildLut(p.recipe!),
      ...(p.masked ? { coverage } : {}),
    }));

    const cpu = api.applyCpuChain(image, built);
    const gpu = api.applyGpuChain(image, built);
    if (gpu === null)
      return {
        reason: "no WebGL2 renderer",
        maxDelta: -1,
        maxDeltaFeathered: -1,
        effect: -1,
      };

    let maxDelta = 0;
    let maxDeltaFeathered = 0;
    let effect = 0;
    let count = 0;
    for (let p = 0, i = 0; i < cpu.length; i += 4, p += 1) {
      const cover = coverage[p]!;
      const partial = cover > 8 && cover < 247;
      for (let c = 0; c < 3; c += 1) {
        const d = Math.abs(cpu[i + c]! - gpu[i + c]!);
        if (d > maxDelta) maxDelta = d;
        if (partial && d > maxDeltaFeathered) maxDeltaFeathered = d;
        effect += Math.abs(cpu[i + c]! - image.data[i + c]!);
        count += 1;
      }
    }
    return { maxDelta, maxDeltaFeathered, effect: effect / count };
  }, passes);
}

test("a masked grade agrees with the CPU, including in the feather", async ({
  page,
}) => {
  const r = await compareChain(page, [{ recipe: "levels", masked: true }]);
  expect(r.reason).toBeUndefined();
  expect(r.effect).toBeGreaterThan(5);
  expect(r.maxDelta).toBeLessThanOrEqual(FILTERING_TOLERANCE);
  // Called out separately: the feathered band is the only place a collapsed
  // chain would disagree, and it is a minority of the pixels, so a single
  // whole-frame maximum can hide it behind the fully-masked majority.
  expect(r.maxDeltaFeathered).toBeLessThanOrEqual(FILTERING_TOLERANCE);
});

test("two masked effects compose in sequence, not as one table", async ({
  page,
}) => {
  // The load-bearing case. Two effects under one feathered mask: the GPU must
  // blend after each, exactly as the CPU does. Collapsing them into a single
  // lookup passes at cover 0 and cover 1 and is wrong everywhere between.
  const r = await compareChain(page, [
    { recipe: "levels", masked: true },
    { recipe: "stack", masked: true },
  ]);
  expect(r.reason).toBeUndefined();
  expect(r.effect).toBeGreaterThan(5);
  expect(r.maxDeltaFeathered).toBeLessThanOrEqual(FILTERING_TOLERANCE);
  expect(r.maxDelta).toBeLessThanOrEqual(FILTERING_TOLERANCE);
});

test("a masked effect after an unmasked one agrees too", async ({ page }) => {
  // Mixed chains are the common shape: grade the whole shot, then lift one
  // region. This also exercises the ping-pong, since pass two reads what pass
  // one wrote rather than the original picture.
  const r = await compareChain(page, [
    { recipe: "stack" },
    { recipe: "levels", masked: true },
  ]);
  expect(r.reason).toBeUndefined();
  expect(r.effect).toBeGreaterThan(5);
  expect(r.maxDelta).toBeLessThanOrEqual(FILTERING_TOLERANCE);
});

test("a chain of identity tables changes nothing, however long", async ({
  page,
}) => {
  // The multi-pass equivalent of the identity check above, and the one that
  // catches an orientation bug in the ping-pong: each pass after the first
  // reads a framebuffer already in GL's orientation, so flipping again there
  // stands the picture on its head.
  //
  // **An even number of passes, deliberately.** A stray flip adds one per pass
  // after the first, so with an odd pass count the extra flips cancel and the
  // picture comes back upright by accident. Written first with three passes,
  // this test passed against exactly the mutation it exists to catch. Four
  // leaves an odd number of extra flips, and it fails.
  const r = await compareChain(page, [
    { identity: true },
    { identity: true },
    { identity: true },
    { identity: true },
  ]);
  expect(r.reason).toBeUndefined();
  expect(r.maxDelta).toBeLessThanOrEqual(FILTERING_TOLERANCE);
});
