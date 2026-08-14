import { LUT_SIZE, type Lut3d } from "./lut3d.js";

/**
 * Reading and writing `.cube` colour lookup tables.
 *
 * The de facto interchange format for a colour grade: Resolve, Premiere and
 * every LUT pack on the internet speak it. It is plain text — a small header
 * and then `size³` lines of floating-point RGB, red varying fastest.
 *
 * This package already has a 3D table type, built by running the grading chain
 * over a cube of colours, and the GPU path already applies one per pixel. So
 * import and export are conversions at the edges rather than a new pipeline:
 * a loaded `.cube` is the same thing a collapsed grade stack produces, and can
 * be applied by exactly the same code.
 *
 * Parsing is deliberately forgiving about layout and strict about content. Real
 * files in the wild have CRLF endings, comments, blank lines, tabs, and keyword
 * casing that varies by exporter — none of which changes what the table means.
 * A wrong *number* of entries or a value that is not a number does change it,
 * and is refused.
 */

/** Sizes a `.cube` may declare. The spec allows 2–256; anything larger is
 * almost certainly a corrupt header rather than a real table, and allocating
 * from it would be the file choosing how much memory to take. */
const MIN_SIZE = 2;
const MAX_SIZE = 256;

export interface CubeLut {
  size: number;
  /** `size³` RGB triples, red fastest, 0–255 — the same layout as `Lut3d`. */
  table: Lut3d;
  title?: string;
  /** The input range the file declares. Almost always 0–1; a file that says
   * otherwise is describing values outside the unit cube and this cannot
   * apply it faithfully. */
  domainMin: readonly [number, number, number];
  domainMax: readonly [number, number, number];
}

export type CubeParseResult =
  { ok: true; lut: CubeLut } | { ok: false; error: string };

const clamp255 = (v: number): number =>
  v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);

/**
 * Parse a `.cube` file.
 *
 * Errors name the line where possible. A LUT that fails to load is a file the
 * user chose deliberately, so "line 41: expected three numbers" is worth far
 * more than "invalid LUT".
 */
export function parseCube(text: string): CubeParseResult {
  let size = 0;
  let title: string | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const values: number[] = [];

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i]!;
    // Comments run to end of line and may follow data on the same line.
    const line = raw.split("#")[0]!.trim();
    if (line.length === 0) continue;

    const parts = line.split(/\s+/);
    const keyword = parts[0]!.toUpperCase();

    if (keyword === "TITLE") {
      // Quoted, and may contain spaces.
      title = line
        .slice(line.indexOf("TITLE") + 5)
        .trim()
        .replace(/^"|"$/g, "");
      continue;
    }
    if (keyword === "LUT_3D_SIZE") {
      const n = Number(parts[1]);
      if (!Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) {
        return {
          ok: false,
          error: `line ${i + 1}: LUT_3D_SIZE must be a whole number between ${MIN_SIZE} and ${MAX_SIZE}`,
        };
      }
      size = n;
      continue;
    }
    if (keyword === "LUT_1D_SIZE") {
      // A real format, and not one this can apply: a 1D LUT is three curves,
      // not a colour table. Saying so beats reading it as 3D and producing a
      // wrong grade from a valid file.
      return {
        ok: false,
        error: "this is a 1D LUT; only 3D LUTs (LUT_3D_SIZE) can be applied",
      };
    }
    if (keyword === "DOMAIN_MIN" || keyword === "DOMAIN_MAX") {
      const nums = parts.slice(1, 4).map(Number);
      if (nums.length !== 3 || nums.some((v) => !Number.isFinite(v))) {
        return {
          ok: false,
          error: `line ${i + 1}: ${keyword} needs three numbers`,
        };
      }
      if (keyword === "DOMAIN_MIN")
        domainMin = nums as [number, number, number];
      else domainMax = nums as [number, number, number];
      continue;
    }

    // Anything else must be a data row.
    const nums = parts.map(Number);
    if (nums.length !== 3 || nums.some((v) => !Number.isFinite(v))) {
      return {
        ok: false,
        error: `line ${i + 1}: expected three numbers, got "${line}"`,
      };
    }
    values.push(nums[0]!, nums[1]!, nums[2]!);
  }

  if (size === 0) {
    return { ok: false, error: "no LUT_3D_SIZE line — this is not a 3D .cube" };
  }
  const expected = size * size * size * 3;
  if (values.length !== expected) {
    // The single most common corruption, and silently padding it would produce
    // a table that grades the top of the image and not the bottom.
    return {
      ok: false,
      error: `expected ${expected / 3} entries for size ${size}, found ${values.length / 3}`,
    };
  }
  if (domainMin.some((v) => v !== 0) || domainMax.some((v) => v !== 1)) {
    return {
      ok: false,
      error:
        "this LUT declares a domain outside 0–1, which cannot be applied to 8-bit images",
    };
  }

  const table = new Uint8ClampedArray(expected);
  for (let i = 0; i < expected; i += 1) table[i] = clamp255(values[i]!);

  return {
    ok: true,
    lut: { size, table, domainMin, domainMax, ...(title ? { title } : {}) },
  };
}

/**
 * Resample a table to another size by trilinear interpolation.
 *
 * A `.cube` may be any size and the app's pipeline is built on 33³, so an
 * imported 17³ or 65³ has to be brought to it. Interpolating rather than
 * nearest-sampling matters for the same reason it does when applying a table:
 * 17 samples per axis is 16 levels apart, and a gradient stepping in sixteens
 * is obvious on a sky.
 */
export function resampleLut(
  table: Lut3d,
  from: number,
  to: number = LUT_SIZE,
): Lut3d {
  if (from === to) return table;
  const out = new Uint8ClampedArray(to * to * to * 3);
  const last = from - 1;

  const at = (r: number, g: number, b: number, c: number): number =>
    table[((b * from + g) * from + r) * 3 + c] ?? 0;

  for (let b = 0; b < to; b += 1) {
    for (let g = 0; g < to; g += 1) {
      for (let r = 0; r < to; r += 1) {
        // Position in the source cube, in source samples.
        const fr = (r / (to - 1)) * last;
        const fg = (g / (to - 1)) * last;
        const fb = (b / (to - 1)) * last;
        const r0 = Math.floor(fr);
        const g0 = Math.floor(fg);
        const b0 = Math.floor(fb);
        const r1 = Math.min(r0 + 1, last);
        const g1 = Math.min(g0 + 1, last);
        const b1 = Math.min(b0 + 1, last);
        const dr = fr - r0;
        const dg = fg - g0;
        const db = fb - b0;

        for (let c = 0; c < 3; c += 1) {
          let sum = 0;
          for (let corner = 0; corner < 8; corner += 1) {
            const useR = (corner & 1) !== 0;
            const useG = (corner & 2) !== 0;
            const useB = (corner & 4) !== 0;
            const weight =
              (useR ? dr : 1 - dr) *
              (useG ? dg : 1 - dg) *
              (useB ? db : 1 - db);
            if (weight === 0) continue;
            sum +=
              at(useR ? r1 : r0, useG ? g1 : g0, useB ? b1 : b0, c) * weight;
          }
          out[((b * to + g) * to + r) * 3 + c] = Math.round(sum);
        }
      }
    }
  }
  return out;
}

/**
 * Write a table as `.cube` text.
 *
 * Six decimal places: enough that an 8-bit table round-trips exactly, few
 * enough that the file stays readable. More would be writing precision the
 * source never had.
 */
export function writeCube(
  table: Lut3d,
  size: number = LUT_SIZE,
  title?: string,
): string {
  const lines: string[] = [];
  if (title) lines.push(`TITLE "${title.replace(/"/g, "'")}"`);
  lines.push(`LUT_3D_SIZE ${size}`);
  lines.push("DOMAIN_MIN 0.0 0.0 0.0");
  lines.push("DOMAIN_MAX 1.0 1.0 1.0");
  lines.push("");

  // Red fastest, then green, then blue — the order the format requires and the
  // order `Lut3d` already stores.
  for (let b = 0; b < size; b += 1) {
    for (let g = 0; g < size; g += 1) {
      for (let r = 0; r < size; r += 1) {
        const i = ((b * size + g) * size + r) * 3;
        const rgb = [0, 1, 2].map((c) =>
          ((table[i + c] ?? 0) / 255).toFixed(6),
        );
        lines.push(rgb.join(" "));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
