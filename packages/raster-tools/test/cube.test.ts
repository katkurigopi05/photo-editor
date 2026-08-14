import { describe, expect, it } from "vitest";
import { parseCube, resampleLut, writeCube } from "../src/cube.js";
import { cubeImageToLut, identityCubeImage, LUT_SIZE } from "../src/lut3d.js";

/**
 * `.cube` import and export.
 *
 * Two properties carry most of the weight. **Round-tripping**: a table written
 * and read back must be the same table, which catches the axis order — the
 * single easiest thing to get wrong here, and one that produces a plausible
 * wrong grade rather than an error. And **refusing** a file whose entry count
 * does not match its declared size, because silently padding it grades the top
 * of an image and not the bottom.
 */

/** A tiny `.cube` with a known, asymmetric table so axis order is detectable. */
function tinyCube(): string {
  const lines = ['TITLE "Tiny"', "LUT_3D_SIZE 2", ""];
  // Red fastest, then green, then blue.
  for (let b = 0; b < 2; b += 1) {
    for (let g = 0; g < 2; g += 1) {
      for (let r = 0; r < 2; r += 1) {
        lines.push(`${r} ${g * 0.5} ${b * 0.25}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

describe("parseCube", () => {
  it("reads size, title and table", () => {
    const out = parseCube(tinyCube());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lut.size).toBe(2);
    expect(out.lut.title).toBe("Tiny");
    expect(out.lut.table.length).toBe(2 * 2 * 2 * 3);
  });

  it("stores entries red-fastest", () => {
    // The axis order. Getting it wrong swaps red and blue across the whole
    // grade, which looks like a deliberate look rather than a bug.
    const out = parseCube(tinyCube());
    if (!out.ok) return;
    const t = out.lut.table;
    // Index 1 is r=1,g=0,b=0 → red full, others zero.
    expect([t[3], t[4], t[5]]).toEqual([255, 0, 0]);
    // Index 4 is b=1,g=0,r=0 → blue at 0.25.
    expect(t[12]).toBe(0);
    expect(t[14]).toBe(64);
  });

  it("tolerates CRLF, comments, blank lines and tabs", () => {
    // All of these appear in real files from real exporters and none of them
    // changes what the table means.
    const text =
      "# a comment\r\n\r\nLUT_3D_SIZE 2\r\n" +
      Array.from({ length: 8 }, () => "0.5\t0.5\t0.5 # grey").join("\r\n") +
      "\r\n";
    const out = parseCube(text);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.lut.table[0]).toBe(128);
  });

  it("accepts keywords in any case", () => {
    const out = parseCube(
      `lut_3d_size 2\n${Array.from({ length: 8 }, () => "0 0 0").join("\n")}\n`,
    );
    expect(out.ok).toBe(true);
  });

  it("refuses a file with no size line", () => {
    expect(parseCube("0 0 0\n0 0 0\n")).toMatchObject({ ok: false });
  });

  it("refuses a wrong number of entries, naming both counts", () => {
    // The commonest corruption. Padding it silently would grade the top of the
    // image and leave the bottom untouched.
    const out = parseCube(
      `LUT_3D_SIZE 2\n${Array.from({ length: 5 }, () => "0 0 0").join("\n")}\n`,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("8");
    expect(out.error).toContain("5");
  });

  it("names the line when a row is not three numbers", () => {
    const out = parseCube("LUT_3D_SIZE 2\n0 0 0\nnot numbers\n");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("line 3");
  });

  it("refuses a 1D LUT by recognising it, not by tripping over it", () => {
    // A valid file this cannot apply. Reading it as 3D would produce a wrong
    // grade from a file that is not corrupt at all.
    //
    // The assertion is on the *explanation*, not on the string "1D". Removing
    // the LUT_1D_SIZE branch still fails this file — it falls through to the
    // data-row check and reports `expected three numbers, got "LUT_1D_SIZE
    // 32"`, which contains "1D" and passed a weaker version of this test. A
    // mutation caught that; the message has to show the format was understood.
    const out = parseCube("LUT_1D_SIZE 32\n0 0 0\n");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("only 3D LUTs");
    expect(out.error).not.toContain("expected three numbers");
  });

  it("refuses an implausible size instead of allocating from it", () => {
    // The header would otherwise choose how much memory to take.
    expect(parseCube("LUT_3D_SIZE 4096\n").ok).toBe(false);
    expect(parseCube("LUT_3D_SIZE 1\n").ok).toBe(false);
  });

  it("refuses a domain outside 0–1", () => {
    const out = parseCube(
      `LUT_3D_SIZE 2\nDOMAIN_MAX 4 4 4\n${Array.from({ length: 8 }, () => "0 0 0").join("\n")}\n`,
    );
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toContain("domain");
  });

  it("clamps values outside the unit range rather than wrapping", () => {
    const out = parseCube(
      `LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => "-1 2 0.5").join("\n")}\n`,
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect([out.lut.table[0], out.lut.table[1], out.lut.table[2]]).toEqual([
      0, 255, 128,
    ]);
  });
});

describe("writeCube", () => {
  it("round-trips a table unchanged", () => {
    // The strongest check available without a reference file: the identity
    // table through write and read must come back identical, which pins the
    // axis order on both sides at once.
    const identity = cubeImageToLut(identityCubeImage());
    const text = writeCube(identity, LUT_SIZE, "Identity");
    const back = parseCube(text);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.lut.size).toBe(LUT_SIZE);
    expect([...back.lut.table]).toEqual([...identity]);
  });

  it("writes a header the format requires", () => {
    const text = writeCube(cubeImageToLut(identityCubeImage()), LUT_SIZE, "X");
    expect(text).toContain("LUT_3D_SIZE 33");
    expect(text).toContain("DOMAIN_MIN 0.0 0.0 0.0");
    expect(text.split("\n")[0]).toBe('TITLE "X"');
  });

  it("escapes a quote in the title rather than breaking the header", () => {
    const text = writeCube(
      cubeImageToLut(identityCubeImage()),
      LUT_SIZE,
      'a"b',
    );
    expect(text.split("\n")[0]).toBe(`TITLE "a'b"`);
  });
});

describe("resampleLut", () => {
  it("returns the same table when the size already matches", () => {
    const identity = cubeImageToLut(identityCubeImage());
    expect(resampleLut(identity, LUT_SIZE, LUT_SIZE)).toBe(identity);
  });

  it("resamples an identity table to another size, still identity", () => {
    // An identity table means "leave every colour alone", and that has to
    // survive a change of resolution or every imported LUT shifts colour
    // slightly for no reason.
    const small = parseCube(tinyCube());
    if (!small.ok) return;
    const id2 = new Uint8ClampedArray(2 * 2 * 2 * 3);
    for (let b = 0; b < 2; b += 1) {
      for (let g = 0; g < 2; g += 1) {
        for (let r = 0; r < 2; r += 1) {
          const i = ((b * 2 + g) * 2 + r) * 3;
          id2[i] = r * 255;
          id2[i + 1] = g * 255;
          id2[i + 2] = b * 255;
        }
      }
    }
    const big = resampleLut(id2, 2, 5);
    // A corner stays a corner.
    expect([big[0], big[1], big[2]]).toEqual([0, 0, 0]);
    const lastIndex = ((4 * 5 + 4) * 5 + 4) * 3;
    expect([big[lastIndex], big[lastIndex + 1], big[lastIndex + 2]]).toEqual([
      255, 255, 255,
    ]);
    // And the middle interpolates rather than stepping.
    const mid = ((2 * 5 + 2) * 5 + 2) * 3;
    expect(big[mid]).toBeGreaterThan(120);
    expect(big[mid]).toBeLessThan(136);
  });

  it("produces the requested size", () => {
    const out = resampleLut(cubeImageToLut(identityCubeImage()), LUT_SIZE, 17);
    expect(out.length).toBe(17 * 17 * 17 * 3);
  });
});
