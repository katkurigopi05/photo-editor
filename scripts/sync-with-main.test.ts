import { describe, expect, it } from "vitest";
import { addedBlocks, paragraphTexts, removeBlock } from "./sync-with-main.mjs";

/**
 * Finding what a branch added to a manual, and what it sat above.
 *
 * This is the part that decides where text goes back after main's version of a
 * manual is taken. Getting it wrong does not fail loudly: the bullet lands in
 * the wrong section, or an unrelated paragraph is treated as this branch's and
 * duplicated. Both read as a plausible manual.
 */

describe("addedBlocks", () => {
  it("finds an added block and the line below it", () => {
    const before = ["- one", "- two", "- three"];
    const after = ["- one", "- new", "- two", "- three"];
    expect(addedBlocks(before, after)).toEqual([
      { lines: ["- new"], follows: "- two" },
    ]);
  });

  it("keeps consecutive added lines together as one block", () => {
    // Two bullets added side by side belong side by side afterwards.
    const before = ["- one", "- two"];
    const after = ["- one", "- a", "- b", "- two"];
    expect(addedBlocks(before, after)).toEqual([
      { lines: ["- a", "- b"], follows: "- two" },
    ]);
  });

  it("separates blocks added in different places", () => {
    const before = ["- one", "- two", "- three"];
    const after = ["- one", "- x", "- two", "- y", "- three"];
    expect(addedBlocks(before, after)).toEqual([
      { lines: ["- x"], follows: "- two" },
      { lines: ["- y"], follows: "- three" },
    ]);
  });

  it("reports no follower for text added at the very end", () => {
    // There is nothing to sit above, so the caller must append rather than
    // search for an anchor that does not exist.
    const blocks = addedBlocks(["- one"], ["- one", "- last"]);
    expect(blocks).toEqual([{ lines: ["- last"], follows: null }]);
  });

  it("finds nothing when the branch added nothing", () => {
    expect(addedBlocks(["- one", "- two"], ["- one", "- two"])).toEqual([]);
  });

  it("ignores blank lines rather than treating them as additions", () => {
    // Markdown is full of them; a blank line is not a bullet and anchoring to
    // one would put text above an arbitrary gap.
    const blocks = addedBlocks(
      ["- one", "", "- two"],
      ["- one", "", "- new", "- two"],
    );
    expect(blocks).toEqual([{ lines: ["- new"], follows: "- two" }]);
  });

  it("does not treat a moved line as an addition", () => {
    // Reordering is not adding. A line still present anywhere in the old file
    // is not this branch's to re-insert, or it would be duplicated.
    const blocks = addedBlocks(["- one", "- two"], ["- two", "- one"]);
    expect(blocks).toEqual([]);
  });
});

describe("paragraphTexts", () => {
  it("reads each paragraph's runs as one string", () => {
    // Word splits a sentence across runs whenever formatting changes, so a
    // paragraph read run-by-run would never match the sentence being sought.
    const xml =
      "<w:body><w:p><w:r><w:t>Hello </w:t></w:r>" +
      "<w:r><w:t>world</w:t></w:r></w:p>" +
      "<w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body>";
    expect(paragraphTexts(xml)).toEqual(["Hello world", "Second"]);
  });

  it("handles paragraphs that carry properties", () => {
    // `<w:p>` with attributes, and `<w:pPr>` before the runs — both ordinary.
    const xml =
      '<w:p w14:paraId="1"><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr>' +
      "<w:r><w:t>A bullet</w:t></w:r></w:p>";
    expect(paragraphTexts(xml)).toEqual(["A bullet"]);
  });

  it("returns an empty string for a paragraph with no text", () => {
    expect(paragraphTexts("<w:p><w:pPr/></w:p>")).toEqual([""]);
  });
});

describe("addedBlocks, read backwards, finds what a branch removed", () => {
  it("reports a deleted bullet when the arguments are swapped", () => {
    // A branch that replaces text deletes as well as adds. Carrying only the
    // additions puts main's sentence back beside its replacement, so the manual
    // states a thing and its opposite a paragraph apart.
    const before = ["- one", "- stale", "- two"];
    const after = ["- one", "- fresh", "- two"];
    expect(addedBlocks(after, before)).toEqual([
      { lines: ["- stale"], follows: "- two" },
    ]);
  });
});

describe("removeBlock", () => {
  const lines = ["- one", "- stale text", "  wrapped on", "- two"];

  it("takes out the whole block, wrapped lines included", () => {
    const block = { lines: ["- stale text", "  wrapped on"], follows: "- two" };
    expect(removeBlock(lines, block, "a bullet")).toEqual(["- one", "- two"]);
  });

  it("does nothing when main already removed it", () => {
    // Both sides deleting the same sentence is agreement, not a conflict.
    const block = { lines: ["- gone already"], follows: "- two" };
    expect(removeBlock(lines, block, "a bullet")).toEqual(lines);
  });

  it("refuses when main has rewritten the passage around it", () => {
    // The first line is still there but the block no longer matches, so
    // deleting by partial match would take out somebody else's sentence.
    const block = {
      lines: ["- stale text", "  a different continuation"],
      follows: "- two",
    };
    expect(() => removeBlock(lines, block, "a bullet")).toThrow(/rewritten/);
  });

  it("leaves an empty block alone", () => {
    expect(removeBlock(lines, { lines: [], follows: null }, "x")).toEqual(
      lines,
    );
  });
});
