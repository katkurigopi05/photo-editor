import { describe, expect, it } from "vitest";
import {
  describeCapabilities,
  fitWithinBudget,
  previewGradeBudgetPx,
  type Environment,
} from "../src/capabilities.js";

/**
 * Scaling across unknown hardware.
 *
 * The app is meant to be forked and run on machines nobody here has seen. That
 * makes two things worth pinning: the preview cannot cost more on a better
 * screen than on a worse one, and a missing capability has to be *explained*
 * rather than silently changing what the app does.
 */

const env = (overrides: Partial<Environment> = {}): Environment => ({
  hasVideoEncoder: true,
  hasFileSystemAccess: true,
  hasOffscreenCanvas: true,
  cores: 4,
  memoryGb: 8,
  devicePixelRatio: 1,
  ...overrides,
});

describe("fitWithinBudget", () => {
  it("leaves a size that already fits completely alone", () => {
    // Scaling something that fits costs a resample and loses detail for
    // nothing, so the identity case has to be exactly the identity.
    expect(fitWithinBudget(640, 480, 1_000_000)).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("scales down to the budget, preserving aspect ratio", () => {
    const fitted = fitWithinBudget(3840, 2160, 1280 * 720);
    expect(fitted.width * fitted.height).toBeLessThanOrEqual(1280 * 720);
    // 16:9 in, 16:9 out — a squashed preview would be worse than a slow one.
    expect(fitted.width / fitted.height).toBeCloseTo(3840 / 2160, 2);
  });

  it("gets close to the budget rather than far under it", () => {
    // A budget honoured by scaling to a tenth of it would throw away quality
    // that was affordable.
    const fitted = fitWithinBudget(3840, 2160, 1280 * 720);
    expect(fitted.width * fitted.height).toBeGreaterThan(0.9 * 1280 * 720);
  });

  it("never returns a zero dimension", () => {
    // drawImage throws on a zero-sized source, which would take the preview
    // down rather than merely make it coarse.
    const fitted = fitWithinBudget(4000, 3, 10);
    expect(fitted.width).toBeGreaterThanOrEqual(1);
    expect(fitted.height).toBeGreaterThanOrEqual(1);
  });

  it("handles a degenerate size without throwing", () => {
    expect(fitWithinBudget(0, 0, 1000)).toEqual({ width: 0, height: 0 });
  });

  it("treats a non-positive budget as no budget", () => {
    expect(fitWithinBudget(1920, 1080, 0)).toEqual({
      width: 1920,
      height: 1080,
    });
  });
});

describe("previewGradeBudgetPx", () => {
  it("gives a weak machine less work than a typical one", () => {
    expect(previewGradeBudgetPx(env({ cores: 2 }))).toBeLessThan(
      previewGradeBudgetPx(env({ cores: 4 })),
    );
  });

  it("gives a strong machine more, but not unlimited", () => {
    const strong = previewGradeBudgetPx(env({ cores: 16 }));
    expect(strong).toBeGreaterThan(previewGradeBudgetPx(env({ cores: 4 })));
    // The grade loop is single-threaded, so cores do not make it faster in
    // proportion — more cores must not mean an unbounded preview.
    expect(strong).toBeLessThan(3840 * 2160);
  });

  it("falls back to the middle when the browser reports nothing", () => {
    // Safari does not expose deviceMemory and may not expose cores; an
    // unreported machine must not be treated as the weakest possible one.
    const unknown = previewGradeBudgetPx(
      env({ cores: undefined, memoryGb: undefined }),
    );
    expect(unknown).toBe(previewGradeBudgetPx(env({ cores: 4 })));
  });

  it("does not depend on the display at all", () => {
    // The whole point: a retina screen must not cost more for the same project.
    expect(previewGradeBudgetPx(env({ devicePixelRatio: 3 }))).toBe(
      previewGradeBudgetPx(env({ devicePixelRatio: 1 })),
    );
  });
});

describe("describeCapabilities", () => {
  it("explains what is missing and what happens instead", () => {
    const lines = describeCapabilities(
      env({ hasVideoEncoder: false, hasFileSystemAccess: false }),
    ).join(" ");
    // Not just "unavailable" — what still works, so a forker on Safari knows
    // whether the app is broken or merely reduced.
    expect(lines).toContain("no VideoEncoder");
    expect(lines).toContain("GIF export still work");
    expect(lines).toContain("assembled in memory");
  });

  it("reports what is present without alarming about it", () => {
    const lines = describeCapabilities(env()).join(" ");
    expect(lines).toContain("available");
    expect(lines).not.toContain("unavailable");
  });

  it("says what it does not know rather than guessing", () => {
    const lines = describeCapabilities(
      env({ cores: undefined, memoryGb: undefined }),
    ).join(" ");
    expect(lines).toContain("unreported");
  });

  it("states that export is not budgeted", () => {
    // The one promise that must survive any adaptation: a render is full
    // quality regardless of the machine that made it.
    expect(describeCapabilities(env()).join(" ")).toContain(
      "exports always render at full resolution",
    );
  });
});
