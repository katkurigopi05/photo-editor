import { describe, expect, it } from "vitest";
import {
  budgetForLevel,
  createAdaptiveState,
  describeQuality,
  DEFAULT_CONFIG,
  DEFAULT_LEVEL,
  levelForPreference,
  observeFrame,
  QUALITY_LADDER,
  type AdaptiveState,
} from "../src/adaptive-quality.js";

/**
 * Auto-scaling.
 *
 * The controller has to do two opposite things well on machines nobody here has
 * seen: get out of the way on a slow device, and climb on a fast one. The
 * failure that matters most is neither — it is *oscillation*, because every
 * change is a visible resolution change, and a controller that flaps is worse
 * than one that guesses badly and stays put.
 */

/** Feed the same cost repeatedly, as a machine of a fixed speed would. */
function run(
  state: AdaptiveState,
  costMs: number,
  frames: number,
): AdaptiveState {
  let next = state;
  for (let i = 0; i < frames; i += 1) next = observeFrame(next, costMs);
  return next;
}

describe("stepping down", () => {
  it("drops a level when frames consistently miss the target", () => {
    const slow = run(createAdaptiveState(), DEFAULT_CONFIG.targetMs * 3, 200);
    expect(slow.level).toBeLessThan(DEFAULT_LEVEL);
  });

  it("reaches the bottom rung on a very slow machine and stops there", () => {
    const awful = run(createAdaptiveState(), 500, 2000);
    expect(awful.level).toBe(0);
    // Not negative, and not an index off the ladder.
    expect(budgetForLevel(awful.level)).toBe(QUALITY_LADDER[0]);
  });

  it("ignores a single slow frame among fast ones", () => {
    // A garbage collection or a video decode hitch is not evidence about the
    // machine, and the median is what makes that true.
    let state = createAdaptiveState();
    for (let i = 0; i < 200; i += 1) {
      state = observeFrame(state, i % 20 === 0 ? 400 : 1);
    }
    expect(state.level).toBeGreaterThanOrEqual(DEFAULT_LEVEL);
  });
});

describe("stepping up", () => {
  it("climbs when frames are comfortably inside the target", () => {
    const fast = run(createAdaptiveState(), 0.2, 400);
    expect(fast.level).toBeGreaterThan(DEFAULT_LEVEL);
  });

  it("reaches the top rung on a fast machine and stops there", () => {
    const strong = run(createAdaptiveState(), 0.05, 4000);
    expect(strong.level).toBe(QUALITY_LADDER.length - 1);
  });

  it("does not climb merely for being under the target", () => {
    // Just inside the target is not evidence of headroom — climbing there is
    // what starts an oscillation.
    const marginal = run(
      createAdaptiveState(),
      DEFAULT_CONFIG.targetMs * 0.9,
      400,
    );
    expect(marginal.level).toBe(DEFAULT_LEVEL);
  });
});

describe("not oscillating", () => {
  it("settles and stays settled at a cost between the thresholds", () => {
    const settled = run(
      createAdaptiveState(),
      DEFAULT_CONFIG.targetMs * 0.75,
      1000,
    );
    expect(settled.level).toBe(DEFAULT_LEVEL);
  });

  it("changes at most once per cooldown", () => {
    // Without the cooldown a full window arrives every frame after the first,
    // and the level would walk the whole ladder in a handful of frames.
    let state = createAdaptiveState();
    let changes = 0;
    for (let i = 0; i < 100; i += 1) {
      const next = observeFrame(state, 0.05);
      if (next.level !== state.level) changes += 1;
      state = next;
    }
    const most = Math.ceil(100 / (DEFAULT_CONFIG.cooldown + 1));
    expect(changes).toBeLessThanOrEqual(most);
  });

  it("cannot flap between two rungs on a machine sitting near the line", () => {
    // The real hazard: cost rises when quality rises and falls when it falls.
    // A single threshold would make that a loop. Simulated by making the cost
    // proportional to the budget in play.
    let state = createAdaptiveState();
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i += 1) {
      const costMs = (budgetForLevel(state.level) / QUALITY_LADDER[2]!) * 5;
      state = observeFrame(state, costMs);
      if (i > 1500) seen.add(state.level);
    }
    // After settling it must be sitting on one rung, not touring two.
    expect(seen.size).toBe(1);
  });
});

describe("guards", () => {
  it("ignores a nonsense sample rather than acting on it", () => {
    const before = createAdaptiveState();
    expect(observeFrame(before, Number.NaN)).toEqual(before);
    expect(observeFrame(before, -1)).toEqual(before);
    expect(observeFrame(before, Number.POSITIVE_INFINITY)).toEqual(before);
  });

  it("clamps a level from outside the ladder", () => {
    expect(createAdaptiveState(-5).level).toBe(0);
    expect(createAdaptiveState(99).level).toBe(QUALITY_LADDER.length - 1);
  });

  it("needs a full window before deciding anything", () => {
    // Deciding on two frames would react to the app starting up.
    const early = run(createAdaptiveState(), 1000, DEFAULT_CONFIG.window - 1);
    expect(early.level).toBe(DEFAULT_LEVEL);
  });
});

describe("preferences", () => {
  it("pins a level when the user asks for one", () => {
    expect(levelForPreference("low")).toBe(0);
    expect(levelForPreference("high")).toBe(QUALITY_LADDER.length - 1);
    expect(levelForPreference("medium")).toBe(DEFAULT_LEVEL);
  });

  it("returns null for auto, which is what hands control to measurement", () => {
    expect(levelForPreference("auto")).toBeNull();
  });

  it("says whether the level was measured or merely guessed", () => {
    const guessed = describeQuality(createAdaptiveState(), "auto");
    expect(guessed).toContain("while it measures");
    const measured = describeQuality(run(createAdaptiveState(), 0.05, 400), "auto");
    expect(measured).toContain("after measuring");
    expect(describeQuality(createAdaptiveState(), "high")).toContain("fixed at");
  });
});
