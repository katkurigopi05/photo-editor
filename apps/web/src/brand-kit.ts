/**
 * Smart Brand Kits & Color Harmony System.
 *
 * Implements Canva-style Brand Kits with palettes, typography pairings,
 * brand logos, WCAG contrast compliance testing, and harmonic palette generation.
 */

export interface BrandPalette {
  primary: string;
  secondary: string;
  accent: string;
  neutralLight: string;
  neutralDark: string;
}

export interface BrandTypography {
  headingFont: string;
  subheadingFont: string;
  bodyFont: string;
}

export interface BrandLogo {
  id: string;
  name: string;
  assetUri: string;
  width?: number | undefined;
  height?: number | undefined;
}

export interface BrandKit {
  id: string;
  name: string;
  palette: BrandPalette;
  typography: BrandTypography;
  logos: readonly BrandLogo[];
}

export interface ColorHarmony {
  type:
    | "complementary"
    | "analogous"
    | "triadic"
    | "tetradic"
    | "monochromatic";
  colors: readonly string[];
}

export interface ContrastResult {
  ratio: number;
  isNormalTextAA: boolean; // >= 4.5:1
  isLargeTextAA: boolean; // >= 3:1
  isNormalTextAAA: boolean; // >= 7.0:1
  isLargeTextAAA: boolean; // >= 4.5:1
}

function parseHex(hex: string): [number, number, number] {
  let cleaned = hex.trim().replace(/^#/, "");
  if (cleaned.length === 3) {
    const r = cleaned.charAt(0);
    const g = cleaned.charAt(1);
    const b = cleaned.charAt(2);
    cleaned = `${r}${r}${g}${g}${b}${b}`;
  }
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const num = Number.parseInt(cleaned, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const normR = r / 255;
  const normG = g / 255;
  const normB = b / 255;
  const max = Math.max(normR, normG, normB);
  const min = Math.min(normR, normG, normB);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case normR:
        h = (normG - normB) / d + (normG < normB ? 6 : 0);
        break;
      case normG:
        h = (normB - normR) / d + 2;
        break;
      case normB:
        h = (normR - normG) / d + 4;
        break;
    }
    h /= 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  const normH = ((h % 360) + 360) % 360 / 360;
  const normS = Math.max(0, Math.min(100, s)) / 100;
  const normL = Math.max(0, Math.min(100, l)) / 100;

  if (normS === 0) {
    const val = Math.round(normL * 255);
    return [val, val, val];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let normalizedT = t;
    if (normalizedT < 0) normalizedT += 1;
    if (normalizedT > 1) normalizedT -= 1;
    if (normalizedT < 1 / 6) return p + (q - p) * 6 * normalizedT;
    if (normalizedT < 1 / 2) return q;
    if (normalizedT < 2 / 3) return p + (q - p) * (2 / 3 - normalizedT) * 6;
    return p;
  };

  const q =
    normL < 0.5
      ? normL * (1 + normS)
      : normL + normS - normL * normS;
  const p = 2 * normL - q;

  const r = Math.round(hue2rgb(p, q, normH + 1 / 3) * 255);
  const g = Math.round(hue2rgb(p, q, normH) * 255);
  const b = Math.round(hue2rgb(p, q, normH - 1 / 3) * 255);

  return [r, g, b];
}

/**
 * Calculates WCAG 2.2 Relative Luminance.
 */
export function getRelativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const transform = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

/**
 * Calculates WCAG 2.2 contrast ratio between two colors (range 1:1 to 21:1).
 */
export function calculateContrastRatio(
  foregroundHex: string,
  backgroundHex: string,
): ContrastResult {
  const lum1 = getRelativeLuminance(foregroundHex);
  const lum2 = getRelativeLuminance(backgroundHex);

  const brighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  const ratio = (brighter + 0.05) / (darker + 0.05);
  const roundedRatio = Math.round(ratio * 100) / 100;

  return {
    ratio: roundedRatio,
    isNormalTextAA: roundedRatio >= 4.5,
    isLargeTextAA: roundedRatio >= 3.0,
    isNormalTextAAA: roundedRatio >= 7.0,
    isLargeTextAAA: roundedRatio >= 4.5,
  };
}

/**
 * Generates harmonic color sets based on a given base hex color.
 */
export function generateColorHarmonies(baseHex: string): readonly ColorHarmony[] {
  const [r, g, b] = parseHex(baseHex);
  const [h, s, l] = rgbToHsl(r, g, b);

  const fromHsl = (hDeg: number, sVal: number, lVal: number) => {
    const [cr, cg, cb] = hslToRgb(hDeg, sVal, lVal);
    return rgbToHex(cr, cg, cb);
  };

  return [
    {
      type: "complementary",
      colors: [baseHex, fromHsl((h + 180) % 360, s, l)],
    },
    {
      type: "analogous",
      colors: [
        fromHsl((h - 30 + 360) % 360, s, l),
        baseHex,
        fromHsl((h + 30) % 360, s, l),
      ],
    },
    {
      type: "triadic",
      colors: [
        baseHex,
        fromHsl((h + 120) % 360, s, l),
        fromHsl((h + 240) % 360, s, l),
      ],
    },
    {
      type: "tetradic",
      colors: [
        baseHex,
        fromHsl((h + 90) % 360, s, l),
        fromHsl((h + 180) % 360, s, l),
        fromHsl((h + 270) % 360, s, l),
      ],
    },
    {
      type: "monochromatic",
      colors: [
        fromHsl(h, s, Math.max(15, l - 30)),
        fromHsl(h, s, Math.max(25, l - 15)),
        baseHex,
        fromHsl(h, s, Math.min(85, l + 15)),
        fromHsl(h, s, Math.min(95, l + 30)),
      ],
    },
  ];
}

/**
 * Creates a complete default brand kit from a seed primary color.
 */
export function createDefaultBrandKit(
  name: string,
  primaryColor: string,
): BrandKit {
  const [r, g, b] = parseHex(primaryColor);
  const [h, s, l] = rgbToHsl(r, g, b);

  const fromHsl = (hDeg: number, sVal: number, lVal: number) => {
    const [cr, cg, cb] = hslToRgb(hDeg, sVal, lVal);
    return rgbToHex(cr, cg, cb);
  };

  const secondary = fromHsl((h + 180) % 360, Math.min(80, s), l);
  const accent = fromHsl((h + 30) % 360, 95, 60);

  return {
    id: `kit-${Date.now().toString(36)}`,
    name,
    palette: {
      primary: primaryColor,
      secondary,
      accent,
      neutralLight: "#f8f9fa",
      neutralDark: "#212529",
    },
    typography: {
      headingFont: "Inter, sans-serif",
      subheadingFont: "Inter, sans-serif",
      bodyFont: "system-ui, -apple-system, sans-serif",
    },
    logos: [],
  };
}

/**
 * Shuffles an array of element colors deterministically using a Brand Palette.
 */
export function shufflePalette(
  palette: BrandPalette,
  colorCount: number,
  step = 1,
): readonly string[] {
  const brandColors = [
    palette.primary,
    palette.secondary,
    palette.accent,
    palette.neutralDark,
    palette.neutralLight,
  ];

  const result: string[] = [];
  for (let i = 0; i < colorCount; i += 1) {
    const color = brandColors[(i + step) % brandColors.length];
    if (color !== undefined) {
      result.push(color);
    }
  }
  return result;
}
