import { describe, expect, test } from "vitest";
import { layoutTextLines } from "../src/text-overlay.js";

/** Stand-in for canvas measureText: every character is 10 units wide. */
const measure = (line: string): number => line.length * 10;

describe("layoutTextLines", () => {
  test("keeps a line that already fits", () => {
    expect(layoutTextLines("hello", 100, measure)).toEqual(["hello"]);
  });

  test("wraps on words rather than mid-word", () => {
    // "hello world" is 110 wide against a 100 limit.
    expect(layoutTextLines("hello world", 100, measure)).toEqual([
      "hello",
      "world",
    ]);
  });

  test("honours explicit newlines even when the line would fit", () => {
    expect(layoutTextLines("a\nb", 1000, measure)).toEqual(["a", "b"]);
  });

  test("hard-breaks a single word longer than the line", () => {
    // No word boundary to wrap on; dropping it or overflowing would both be
    // worse than splitting it.
    expect(layoutTextLines("abcdefgh", 30, measure)).toEqual([
      "abc",
      "def",
      "gh",
    ]);
  });

  test("collapses runs of spaces without producing empty lines", () => {
    expect(layoutTextLines("a    b", 1000, measure)).toEqual(["a b"]);
  });

  test("preserves deliberate blank lines between paragraphs", () => {
    expect(layoutTextLines("a\n\nb", 1000, measure)).toEqual(["a", "", "b"]);
  });

  test("returns nothing for empty or whitespace-only text", () => {
    expect(layoutTextLines("", 100, measure)).toEqual([]);
    expect(layoutTextLines("   ", 100, measure)).toEqual([]);
  });

  test("never returns a line wider than the limit unless it is one character", () => {
    const text = "the quick brown fox jumps over the lazy dog";
    for (const width of [20, 50, 100, 250]) {
      for (const line of layoutTextLines(text, width, measure)) {
        if (line.length <= 1) continue;
        expect(measure(line), `width ${width}: "${line}"`).toBeLessThanOrEqual(
          width,
        );
      }
    }
  });

  test("is stable: laying out its own output changes nothing", () => {
    const once = layoutTextLines("the quick brown fox", 100, measure);
    const twice = layoutTextLines(once.join("\n"), 100, measure);
    expect(twice).toEqual(once);
  });
});
