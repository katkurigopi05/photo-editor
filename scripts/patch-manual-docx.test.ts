import { describe, expect, it } from "vitest";
import { docxParagraphEnd, markdownItemEnd } from "./patch-manual-docx.mjs";

/**
 * The two range calculations behind `--replace`.
 *
 * Replacing deletes, and this script has already put the two manuals out of
 * step four times by failing quietly. A range that is one bullet too long
 * removes a paragraph nobody notices missing until someone reads the manual,
 * and the script's own "did it change?" check passes either way — the file did
 * change, just not only in the way intended.
 */

describe("markdownItemEnd", () => {
  const doc = [
    "- first bullet",
    "- a wrapped bullet that runs on",
    "  onto a second line and then stops",
    "- third bullet",
    "",
    "## Next section",
    "",
  ].join("\n");
  const wrappedStart = doc.indexOf("- a wrapped");

  it("returns the start when not replacing, so the caller inserts", () => {
    expect(markdownItemEnd(doc, wrappedStart, false)).toBe(wrappedStart);
  });

  it("takes the whole of a bullet that wraps onto later lines", () => {
    // Stopping at the first newline would leave "onto a second line and then
    // stops" orphaned beneath the replacement.
    const end = markdownItemEnd(doc, wrappedStart, true);
    expect(doc.slice(wrappedStart, end)).toBe(
      "- a wrapped bullet that runs on\n  onto a second line and then stops\n",
    );
  });

  it("stops at the next bullet rather than eating it", () => {
    const end = markdownItemEnd(doc, wrappedStart, true);
    expect(doc.slice(end)).toContain("- third bullet");
  });

  it("stops at a blank line before a heading", () => {
    const thirdStart = doc.indexOf("- third bullet");
    const end = markdownItemEnd(doc, thirdStart, true);
    expect(doc.slice(thirdStart, end)).toBe("- third bullet\n");
    expect(doc.slice(end)).toContain("## Next section");
  });

  it("runs to the end when the item is last in the file", () => {
    const tail = "- only bullet, no trailing newline";
    expect(markdownItemEnd(tail, 0, true)).toBe(tail.length);
  });
});

describe("docxParagraphEnd", () => {
  const xml =
    "<w:body><w:p><w:r><w:t>keep me</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>replace me</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>and keep me too</w:t></w:r></w:p></w:body>";
  const at = xml.indexOf("replace me");
  const paragraphStart = xml.lastIndexOf("<w:p>", at);

  it("returns the start when not replacing", () => {
    expect(docxParagraphEnd(xml, at, paragraphStart, false)).toBe(
      paragraphStart,
    );
  });

  it("ends after the anchor's own closing tag", () => {
    const end = docxParagraphEnd(xml, at, paragraphStart, true);
    expect(xml.slice(paragraphStart, end)).toBe(
      "<w:p><w:r><w:t>replace me</w:t></w:r></w:p>",
    );
  });

  it("leaves the paragraphs on either side alone", () => {
    const end = docxParagraphEnd(xml, at, paragraphStart, true);
    const remaining = xml.slice(0, paragraphStart) + xml.slice(end);
    expect(remaining).toContain("keep me");
    expect(remaining).toContain("and keep me too");
    expect(remaining).not.toContain("replace me");
  });

  it("throws rather than guessing when the paragraph never closes", () => {
    // Deleting from a bad index would take out whatever followed.
    const broken = "<w:body><w:p><w:r><w:t>replace me</w:t></w:r></w:body>";
    expect(() =>
      docxParagraphEnd(broken, broken.indexOf("replace me"), 8, true),
    ).toThrow(/end of the anchor's paragraph/);
  });
});
