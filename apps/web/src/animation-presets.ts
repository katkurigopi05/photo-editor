import type {
  AnimationEasing,
  AnimationProperty,
  AnimationTrack,
} from "@director/project-schema";

export type AnimationPresetId =
  | "ken-burns-in"
  | "ken-burns-out"
  | "pan-left"
  | "pan-right"
  | "fade-in"
  | "fade-out"
  | "pop"
  | "drift"
  | "loop-pulse";

export interface AnimationPreset {
  id: AnimationPresetId;
  label: string;
  description: string;
}

export const ANIMATION_PRESETS: readonly AnimationPreset[] = [
  {
    id: "ken-burns-in",
    label: "Ken Burns In",
    description: "Slow cinematic zoom into the frame.",
  },
  {
    id: "ken-burns-out",
    label: "Ken Burns Out",
    description: "Slow cinematic zoom away from the frame.",
  },
  {
    id: "pan-left",
    label: "Pan Left",
    description: "Move smoothly from right to left.",
  },
  {
    id: "pan-right",
    label: "Pan Right",
    description: "Move smoothly from left to right.",
  },
  {
    id: "fade-in",
    label: "Fade In",
    description: "Reveal the clip from transparent to visible.",
  },
  {
    id: "fade-out",
    label: "Fade Out",
    description: "Fade the clip smoothly to transparent.",
  },
  {
    id: "pop",
    label: "Pop",
    description: "Quick overshoot entrance, then settle.",
  },
  {
    id: "drift",
    label: "Drift",
    description: "Gentle diagonal motion with a subtle zoom.",
  },
  {
    id: "loop-pulse",
    label: "Loop Pulse",
    description: "Returns to its start for seamless GIF loops.",
  },
];

interface TemplateKeyframe {
  numerator: bigint;
  denominator: bigint;
  value: number;
  easing: AnimationEasing;
}

interface TemplateTrack {
  property: AnimationProperty;
  keyframes: readonly TemplateKeyframe[];
}

const point = (
  numerator: bigint,
  denominator: bigint,
  value: number,
  easing: AnimationEasing = "ease-in-out",
): TemplateKeyframe => ({ numerator, denominator, value, easing });

const PRESET_TRACKS: Record<AnimationPresetId, readonly TemplateTrack[]> = {
  "ken-burns-in": [
    {
      property: "transform.scale",
      keyframes: [point(0n, 1n, 1), point(1n, 1n, 1.18, "linear")],
    },
  ],
  "ken-burns-out": [
    {
      property: "transform.scale",
      keyframes: [point(0n, 1n, 1.18), point(1n, 1n, 1, "linear")],
    },
  ],
  "pan-left": [
    {
      property: "transform.position_x",
      keyframes: [point(0n, 1n, 0.2), point(1n, 1n, -0.2, "linear")],
    },
  ],
  "pan-right": [
    {
      property: "transform.position_x",
      keyframes: [point(0n, 1n, -0.2), point(1n, 1n, 0.2, "linear")],
    },
  ],
  "fade-in": [
    {
      property: "transform.opacity",
      keyframes: [point(0n, 1n, 0, "ease-out"), point(1n, 1n, 1, "linear")],
    },
  ],
  "fade-out": [
    {
      property: "transform.opacity",
      keyframes: [point(0n, 1n, 1, "ease-in"), point(1n, 1n, 0, "linear")],
    },
  ],
  pop: [
    {
      property: "transform.scale",
      keyframes: [
        point(0n, 1n, 0.75, "ease-out"),
        point(15n, 100n, 1.08),
        point(30n, 100n, 1, "hold"),
        point(1n, 1n, 1, "linear"),
      ],
    },
  ],
  drift: [
    {
      property: "transform.position_x",
      keyframes: [point(0n, 1n, -0.08), point(1n, 1n, 0.08, "linear")],
    },
    {
      property: "transform.position_y",
      keyframes: [point(0n, 1n, 0.04), point(1n, 1n, -0.04, "linear")],
    },
    {
      property: "transform.scale",
      keyframes: [point(0n, 1n, 1.04), point(1n, 1n, 1.12, "linear")],
    },
  ],
  "loop-pulse": [
    {
      property: "transform.scale",
      keyframes: [
        point(0n, 1n, 1, "ease-in-out"),
        point(1n, 2n, 1.12, "ease-in-out"),
        point(1n, 1n, 1, "linear"),
      ],
    },
  ],
};

/** Materialize an Auto preset using caller-supplied IDs. Time is derived only
 * with BigInt arithmetic; duplicate fractional times on tiny clips collapse
 * deterministically to the last authored point. */
export function materializeAnimationPreset(
  presetId: AnimationPresetId,
  durationUs: string,
  createId: () => string,
): AnimationTrack[] {
  if (!/^[1-9][0-9]*$/.test(durationUs)) {
    throw new RangeError("preset duration must be positive canonical microseconds");
  }
  const duration = BigInt(durationUs);
  return PRESET_TRACKS[presetId].map((template) => {
    const byTime = new Map<
      string,
      Omit<AnimationTrack["keyframes"][number], "id">
    >();
    for (const keyframe of template.keyframes) {
      const timeUs = (
        (duration * keyframe.numerator) /
        keyframe.denominator
      ).toString();
      byTime.set(timeUs, {
        timeUs,
        value: keyframe.value,
        easing: keyframe.easing,
      });
    }
    const keyframes = [...byTime.values()]
      .sort((left, right) => {
        const leftTime = BigInt(left.timeUs);
        const rightTime = BigInt(right.timeUs);
        return leftTime < rightTime ? -1 : leftTime > rightTime ? 1 : 0;
      })
      .map((keyframe) => ({ id: createId(), ...keyframe }));
    return { id: createId(), property: template.property, keyframes };
  });
}
