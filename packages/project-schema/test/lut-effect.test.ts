import { describe, expect, it } from "vitest";
import { effectInstanceSchema, assetKindSchema } from "../src/index.js";

/**
 * The `color.lut` effect and the `lut` asset kind.
 *
 * A lookup table is stored the way media is: the file stays on disk and the
 * project keeps a URI and a checksum. So the effect names an *asset*, and the
 * things worth pinning are that it refuses to name nothing, that its mix amount
 * is bounded, and that no extra keys sneak into a payload that has to serialise
 * canonically.
 */

const lutEffect = (params: Record<string, unknown>) => ({
  id: "fx-1",
  type: "color.lut",
  enabled: true,
  params,
});

describe("lut asset kind", () => {
  it("is a valid asset kind", () => {
    expect(assetKindSchema.safeParse("lut").success).toBe(true);
  });
});

describe("color.lut params", () => {
  it("accepts an asset reference and a mix amount", () => {
    const out = effectInstanceSchema.safeParse(
      lutEffect({ assetId: "asset-1", amount: 1 }),
    );
    expect(out.success).toBe(true);
  });

  it("refuses an empty assetId", () => {
    // A LUT effect naming nothing would render as a no-op that looks applied.
    expect(
      effectInstanceSchema.safeParse(lutEffect({ assetId: "", amount: 1 }))
        .success,
    ).toBe(false);
  });

  it("requires the amount rather than defaulting it", () => {
    // A default would make the parsed value differ from the stored one, and
    // canonical JSON depends on those being identical.
    expect(
      effectInstanceSchema.safeParse(lutEffect({ assetId: "a" })).success,
    ).toBe(false);
  });

  it("bounds the amount to 0..1", () => {
    for (const amount of [-0.1, 1.1, 2]) {
      expect(
        effectInstanceSchema.safeParse(lutEffect({ assetId: "a", amount }))
          .success,
      ).toBe(false);
    }
    for (const amount of [0, 0.5, 1]) {
      expect(
        effectInstanceSchema.safeParse(lutEffect({ assetId: "a", amount }))
          .success,
      ).toBe(true);
    }
  });

  it("refuses an unknown key", () => {
    // Strict, like every other effect: an unrecognised key would survive a
    // round trip and change the canonical bytes.
    expect(
      effectInstanceSchema.safeParse(
        lutEffect({ assetId: "a", amount: 1, table: [1, 2, 3] }),
      ).success,
    ).toBe(false);
  });

  it("refuses a non-finite amount", () => {
    expect(
      effectInstanceSchema.safeParse(
        lutEffect({ assetId: "a", amount: Number.NaN }),
      ).success,
    ).toBe(false);
  });
});
