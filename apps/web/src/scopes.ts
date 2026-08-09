/**
 * Video scopes.
 *
 * Grading by eye on an uncalibrated screen is guesswork: a monitor with a warm
 * cast makes every shot look like it needs cooling, and a bright room hides
 * crushed blacks entirely. Scopes measure the picture instead of showing it,
 * which is why every grading application has them and why they are the first
 * thing a colourist looks at.
 *
 * Three, because they answer three different questions:
 *
 * - **Histogram** — how much of the picture sits at each level. Clipping is a
 *   spike against either wall.
 * - **Waveform** — *where* those levels are, column by column across the frame.
 *   A blown sky and a blown highlight on a face look identical on a histogram.
 * - **Vectorscope** — hue and saturation, plotted as angle and distance. Skin
 *   tone has a known angle, which is what makes the "skin line" useful.
 *
 * All three read pixels and return numbers; nothing here draws. Keeping the
 * measurement separate from the painting is what lets it be tested against
 * known colours rather than against a screenshot.
 */

/** Rec. 709 luma, the coefficients the rest of the app already grades in. */
export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface Histogram {
  red: number[];
  green: number[];
  blue: number[];
  luma: number[];
  /** Pixels counted, so callers can normalise without recounting. */
  total: number;
}

/**
 * Count how many pixels land in each of the 256 levels, per channel.
 *
 * Fully transparent pixels are skipped: a keyed-out background is not part of
 * the picture being graded, and counting it puts a false spike at zero that
 * makes every clipping judgement wrong.
 */
export function histogram(
  pixels: Uint8ClampedArray,
  step = 1,
): Histogram {
  const red = new Array<number>(256).fill(0);
  const green = new Array<number>(256).fill(0);
  const blue = new Array<number>(256).fill(0);
  const lumaBins = new Array<number>(256).fill(0);
  let total = 0;
  const stride = 4 * Math.max(1, Math.floor(step));
  for (let i = 0; i < pixels.length; i += stride) {
    if (pixels[i + 3] === 0) continue;
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    red[r] = (red[r] ?? 0) + 1;
    green[g] = (green[g] ?? 0) + 1;
    blue[b] = (blue[b] ?? 0) + 1;
    const y = Math.round(luma(r, g, b));
    lumaBins[y] = (lumaBins[y] ?? 0) + 1;
    total++;
  }
  return { red, green, blue, luma: lumaBins, total };
}

/** The fraction of counted pixels sitting at the very top or bottom level. */
export function clippedFraction(bins: readonly number[], total: number): {
  black: number;
  white: number;
} {
  if (total === 0) return { black: 0, white: 0 };
  return {
    black: (bins[0] ?? 0) / total,
    white: (bins[255] ?? 0) / total,
  };
}

/**
 * Waveform: for each column of the output, how many pixels fall at each level.
 *
 * The frame is sampled into `columns` buckets horizontally and 256 levels
 * vertically — the shape a waveform monitor draws, with the picture's left-right
 * geometry preserved so a bright patch can be located in the frame.
 */
export function waveform(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  columns: number,
  rowStep = 1,
): { columns: number[][]; peak: number } {
  const out: number[][] = Array.from({ length: columns }, () =>
    new Array<number>(256).fill(0),
  );
  let peak = 0;
  const step = Math.max(1, Math.floor(rowStep));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] === 0) continue;
      const column = Math.min(
        columns - 1,
        Math.floor((x / width) * columns),
      );
      const level = Math.round(
        luma(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0),
      );
      const bucket = out[column]!;
      const next = (bucket[level] ?? 0) + 1;
      bucket[level] = next;
      if (next > peak) peak = next;
    }
  }
  return { columns: out, peak };
}

/** Rec. 601 chroma, the axes a vectorscope has always been drawn in — the
 * graticule positions for the colour bars are defined against them. */
export function chroma(r: number, g: number, b: number): { u: number; v: number } {
  return {
    u: -0.168736 * r - 0.331264 * g + 0.5 * b,
    v: 0.5 * r - 0.418688 * g - 0.081312 * b,
  };
}

export interface Vectorscope {
  /** Square density grid, row-major, `size` x `size`, centred on neutral. */
  grid: number[];
  size: number;
  peak: number;
  /** Largest saturation seen, 0..1 where 1 is the edge of the plot. */
  maxSaturation: number;
}

/**
 * Vectorscope: a density plot of chroma, with neutral at the centre.
 *
 * Saturation is distance from the centre and hue is the angle. Grey footage
 * collapses to a dot; a strong cast pulls the whole cloud off-centre, which is
 * the fastest way to see one.
 */
export function vectorscope(
  pixels: Uint8ClampedArray,
  size = 64,
  step = 1,
): Vectorscope {
  const grid = new Array<number>(size * size).fill(0);
  let peak = 0;
  let maxSaturation = 0;
  const stride = 4 * Math.max(1, Math.floor(step));
  // Chroma reaches about ±128 for fully saturated primaries; that is the radius
  // the plot's edge represents.
  const SCALE = 128;
  for (let i = 0; i < pixels.length; i += stride) {
    if (pixels[i + 3] === 0) continue;
    const { u, v } = chroma(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0);
    const saturation = Math.min(1, Math.hypot(u, v) / SCALE);
    if (saturation > maxSaturation) maxSaturation = saturation;
    const gx = Math.min(
      size - 1,
      Math.max(0, Math.round(((u / SCALE + 1) / 2) * (size - 1))),
    );
    // Screen coordinates run downwards; the scope's positive V axis runs up.
    const gy = Math.min(
      size - 1,
      Math.max(0, Math.round(((1 - v / SCALE) / 2) * (size - 1))),
    );
    const index = gy * size + gx;
    const next = (grid[index] ?? 0) + 1;
    grid[index] = next;
    if (next > peak) peak = next;
  }
  return { grid, size, peak, maxSaturation };
}

/**
 * How far the average chroma sits from neutral, and in which direction.
 *
 * The single number a cast shows up in: 0 is neutral, and the angle names the
 * hue it is leaning towards.
 */
export function chromaCentre(
  pixels: Uint8ClampedArray,
  step = 1,
): { u: number; v: number; distance: number } {
  let sumU = 0;
  let sumV = 0;
  let count = 0;
  const stride = 4 * Math.max(1, Math.floor(step));
  for (let i = 0; i < pixels.length; i += stride) {
    if (pixels[i + 3] === 0) continue;
    const { u, v } = chroma(pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0);
    sumU += u;
    sumV += v;
    count++;
  }
  if (count === 0) return { u: 0, v: 0, distance: 0 };
  const u = sumU / count;
  const v = sumV / count;
  return { u, v, distance: Math.hypot(u, v) };
}
