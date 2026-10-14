/**
 * System Eyedropper and Color Sampler.
 *
 * Inspired by Canva's system eyedropper service (`webx/services/eyedropper`):
 * allows picking colors directly from anywhere on the desktop via the native EyeDropper
 * API, with fallback pixel sampling from canvas/raster buffers, plus color space
 * normalization and palette history.
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
  a?: number | undefined;
}

export interface HslColor {
  h: number;
  s: number;
  l: number;
}

export interface PickedColor {
  hex: string;
  rgb: RgbColor;
  hsl: HslColor;
  timestamp: number;
}

export interface NativeEyeDropperInstance {
  open(options?: { signal?: AbortSignal }): Promise<{ sRGBHex: string }>;
}

export interface NativeEyeDropperCtor {
  new (): NativeEyeDropperInstance;
}

export interface EyeDropperDependencies {
  EyeDropperCtor?: NativeEyeDropperCtor | null | undefined;
  now?: (() => number) | undefined;
}

/** Check if the native browser/OS EyeDropper API is available */
export function isEyeDropperSupported(deps?: EyeDropperDependencies): boolean {
  if (deps?.EyeDropperCtor !== undefined) {
    return Boolean(deps.EyeDropperCtor);
  }
  return typeof window !== "undefined" && "EyeDropper" in window;
}

/** Converts RGB components (0..255) to 6-digit hex string (#RRGGBB) */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Converts 3-digit or 6-digit hex to RGB components */
export function hexToRgb(hex: string): RgbColor {
  const cleaned = hex.replace(/^#/, "").trim();
  if (cleaned.length === 3) {
    const c0 = cleaned.charAt(0);
    const c1 = cleaned.charAt(1);
    const c2 = cleaned.charAt(2);
    const r = parseInt(c0 + c0, 16);
    const g = parseInt(c1 + c1, 16);
    const b = parseInt(c2 + c2, 16);
    return { r, g, b, a: 1 };
  }
  if (cleaned.length === 6 || cleaned.length === 8) {
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    const a = cleaned.length === 8 ? parseInt(cleaned.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  throw new Error(`Invalid hex color string: "${hex}"`);
}

/** Converts RGB components to HSL values (h: 0..360, s: 0..100, l: 0..100) */
export function rgbToHsl(r: number, g: number, b: number): HslColor {
  const rNorm = Math.max(0, Math.min(255, r)) / 255;
  const gNorm = Math.max(0, Math.min(255, g)) / 255;
  const bNorm = Math.max(0, Math.min(255, b)) / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (delta !== 0) {
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case rNorm:
        h = ((gNorm - bNorm) / delta + (gNorm < bNorm ? 6 : 0)) * 60;
        break;
      case gNorm:
        h = ((bNorm - rNorm) / delta + 2) * 60;
        break;
      case bNorm:
        h = ((rNorm - gNorm) / delta + 4) * 60;
        break;
    }
  }

  return {
    h: Math.round(h),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

/** Samples a single pixel from an ImageData array buffer */
export function samplePixelFromImageData(
  imageData: ImageData,
  x: number,
  y: number,
): PickedColor {
  const clampX = Math.max(0, Math.min(imageData.width - 1, Math.floor(x)));
  const clampY = Math.max(0, Math.min(imageData.height - 1, Math.floor(y)));
  const offset = (clampY * imageData.width + clampX) * 4;

  const r = imageData.data[offset] ?? 0;
  const g = imageData.data[offset + 1] ?? 0;
  const b = imageData.data[offset + 2] ?? 0;
  const rawA = imageData.data[offset + 3];
  const a = rawA !== undefined ? rawA / 255 : 1;

  const hex = rgbToHex(r, g, b);
  const rgb: RgbColor = { r, g, b, a };
  const hsl = rgbToHsl(r, g, b);

  return {
    hex,
    rgb,
    hsl,
    timestamp: Date.now(),
  };
}

/**
 * High-level Eyedropper Controller that manages picking, palette history,
 * and fallbacks.
 */
export class EyedropperController {
  private history: PickedColor[] = [];
  private maxHistory: number;

  constructor(
    private deps: EyeDropperDependencies = {},
    maxHistory = 24,
  ) {
    this.maxHistory = maxHistory;
  }

  getHistory(): readonly PickedColor[] {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
  }

  /**
   * Samples a color from the screen using native EyeDropper API.
   * Returns null if user cancels the eyedropper with Esc.
   */
  async pickFromScreen(signal?: AbortSignal): Promise<PickedColor | null> {
    const Ctor =
      this.deps.EyeDropperCtor ??
      (typeof window !== "undefined"
        ? (window as unknown as { EyeDropper?: NativeEyeDropperCtor }).EyeDropper
        : undefined);

    if (!Ctor) {
      throw new Error(
        "Native EyeDropper is not supported in this environment. Use canvas or image sampling fallback.",
      );
    }

    try {
      const dropper = new Ctor();
      const res = await dropper.open(signal !== undefined ? { signal } : undefined);
      const rgb = hexToRgb(res.sRGBHex);
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const picked: PickedColor = {
        hex: res.sRGBHex.toLowerCase(),
        rgb,
        hsl,
        timestamp: (this.deps.now ?? Date.now)(),
      };

      this.addToHistory(picked);
      return picked;
    } catch (err: unknown) {
      // AbortError or user cancellation is a standard dismissal
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("canceled"))) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Samples a pixel from an ImageData source and saves it to history.
   */
  pickFromImageData(imageData: ImageData, x: number, y: number): PickedColor {
    const picked = samplePixelFromImageData(imageData, x, y);
    if (this.deps.now) {
      picked.timestamp = this.deps.now();
    }
    this.addToHistory(picked);
    return picked;
  }

  private addToHistory(color: PickedColor): void {
    // Avoid immediate duplicate of same hex
    if (this.history[0]?.hex === color.hex) return;

    this.history = [color, ...this.history.filter((c) => c.hex !== color.hex)].slice(
      0,
      this.maxHistory,
    );
  }
}
