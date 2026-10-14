/**
 * Magic Aspect Ratio & Social Canvas Adapter.
 *
 * Provides standard social, video, and print dimensions with intelligent
 * composition reflow strategies (contain, cover, safe margins, and coordinate
 * transform calculations).
 */

export interface AspectPreset {
  id: string;
  name: string;
  category: "social" | "video" | "print" | "presentation" | "custom";
  width: number;
  height: number;
  aspectRatio: string;
  /** Safe margin percentage [0..1] for mobile UI overlays (reels, tiktok, shorts). */
  safeMargin?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
}

export type FitStrategy = "contain" | "cover" | "stretch" | "safe-fit";

export interface TransformBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  {
    id: "ig-square",
    name: "Instagram Square (1:1)",
    category: "social",
    width: 1080,
    height: 1080,
    aspectRatio: "1:1",
  },
  {
    id: "ig-portrait",
    name: "Instagram Portrait (4:5)",
    category: "social",
    width: 1080,
    height: 1350,
    aspectRatio: "4:5",
  },
  {
    id: "story-reel-tiktok",
    name: "Story / Reels / TikTok (9:16)",
    category: "social",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    safeMargin: {
      top: 0.12, // User header / audio pill
      bottom: 0.18, // Caption and sound bar
      left: 0.05,
      right: 0.15, // Like / comment / share button stack
    },
  },
  {
    id: "yt-landscape",
    name: "YouTube / Landscape (16:9)",
    category: "video",
    width: 1920,
    height: 1080,
    aspectRatio: "16:9",
  },
  {
    id: "yt-shorts",
    name: "YouTube Shorts (9:16)",
    category: "video",
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    safeMargin: {
      top: 0.1,
      bottom: 0.15,
      left: 0.05,
      right: 0.14,
    },
  },
  {
    id: "x-post",
    name: "X / Twitter Post (16:9)",
    category: "social",
    width: 1200,
    height: 675,
    aspectRatio: "16:9",
  },
  {
    id: "linkedin-post",
    name: "LinkedIn Post (1.91:1)",
    category: "social",
    width: 1200,
    height: 628,
    aspectRatio: "1.91:1",
  },
  {
    id: "pinterest-pin",
    name: "Pinterest Pin (2:3)",
    category: "social",
    width: 1000,
    height: 1500,
    aspectRatio: "2:3",
  },
  {
    id: "presentation-slide",
    name: "Presentation Deck (16:9)",
    category: "presentation",
    width: 1920,
    height: 1080,
    aspectRatio: "16:9",
  },
  {
    id: "print-a4",
    name: "Print A4 (300 DPI)",
    category: "print",
    width: 2480,
    height: 3508,
    aspectRatio: "1:1.414",
  },
  {
    id: "print-us-letter",
    name: "Print US Letter (300 DPI)",
    category: "print",
    width: 2550,
    height: 3300,
    aspectRatio: "8.5:11",
  },
];

/**
 * Calculates layer reflow and transformation coordinates when adapting
 * from a source canvas dimension to a target canvas dimension.
 */
export function calculateReflowTransform(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  strategy: FitStrategy = "contain",
  safeMargin?: AspectPreset["safeMargin"],
): TransformBounds {
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0
  ) {
    throw new Error("Canvas dimensions must be positive non-zero integers.");
  }

  let usableTargetWidth = targetWidth;
  let usableTargetHeight = targetHeight;
  let usableOffsetX = 0;
  let usableOffsetY = 0;

  if (strategy === "safe-fit" && safeMargin) {
    const marginLeft = targetWidth * safeMargin.left;
    const marginRight = targetWidth * safeMargin.right;
    const marginTop = targetHeight * safeMargin.top;
    const marginBottom = targetHeight * safeMargin.bottom;

    usableTargetWidth = targetWidth - (marginLeft + marginRight);
    usableTargetHeight = targetHeight - (marginTop + marginBottom);
    usableOffsetX = marginLeft;
    usableOffsetY = marginTop;
  }

  const scaleXRatio = usableTargetWidth / sourceWidth;
  const scaleYRatio = usableTargetHeight / sourceHeight;

  if (strategy === "stretch") {
    return {
      x: 0,
      y: 0,
      width: targetWidth,
      height: targetHeight,
      scaleX: scaleXRatio,
      scaleY: scaleYRatio,
      offsetX: 0,
      offsetY: 0,
    };
  }

  let uniformScale: number;

  if (strategy === "cover") {
    // Fill the viewport completely; excess is cropped
    uniformScale = Math.max(scaleXRatio, scaleYRatio);
  } else {
    // "contain" or "safe-fit": fit completely inside usable bounds
    uniformScale = Math.min(scaleXRatio, scaleYRatio);
  }

  const renderedWidth = Math.round(sourceWidth * uniformScale);
  const renderedHeight = Math.round(sourceHeight * uniformScale);

  const x = usableOffsetX + Math.round((usableTargetWidth - renderedWidth) / 2);
  const y = usableOffsetY + Math.round((usableTargetHeight - renderedHeight) / 2);

  return {
    x,
    y,
    width: renderedWidth,
    height: renderedHeight,
    scaleX: uniformScale,
    scaleY: uniformScale,
    offsetX: x,
    offsetY: y,
  };
}

/**
 * Find an aspect ratio preset by ID.
 */
export function getPresetById(id: string): AspectPreset | undefined {
  return ASPECT_PRESETS.find((p) => p.id === id);
}

/**
 * Identify closest matching social preset from raw dimensions.
 */
export function findClosestPreset(
  width: number,
  height: number,
  tolerance = 0.05,
): AspectPreset | undefined {
  if (width <= 0 || height <= 0) return undefined;
  const targetRatio = width / height;

  return ASPECT_PRESETS.find((preset) => {
    const presetRatio = preset.width / preset.height;
    return Math.abs(targetRatio - presetRatio) <= tolerance;
  });
}
