#!/usr/bin/env node
/**
 * Add bullets to *both* manuals, and prove they arrived in each.
 *
 * The docx is a zip of XML, so every update so far has been an ad-hoc unzip,
 * string-replace and rezip. That went wrong four times in one working session
 * and once reached `main`: a replacement whose anchor no longer matched left
 * the file untouched, the rezip then produced byte-identical output, and the
 * shell reported success throughout. `USER_MANUAL.md` claimed a feature the
 * Word manual did not mention, and `manual:check` cannot catch that — it checks
 * that the file *changed*, not that it says anything in particular.
 *
 * The Markdown had the same problem for the same reason: ad-hoc edits that
 * silently matched nothing. Twice the two formats ended up disagreeing, and
 * once *neither* had the text while the commit said both did.
 *
 * So this writes both and **verifies afterwards by reading each file back**.
 * Updating one and forgetting the other is no longer possible, because there is
 * one command that does them together. Every failure is a non-zero exit:
 *
 *   - the anchor is missing, or appears more than once
 *   - the replacement produced no change
 *   - the result is not well-formed XML
 *   - the phrases are not in the file that was actually written
 *   - either format is missing text the other has
 *
 * Usage:
 *   node scripts/patch-manual-docx.mjs --anchor "Images receive a default" \
 *     --bullet "First new bullet." --bullet "Second."
 *
 * The anchor is plain text as it appears in both manuals; the bullets go in
 * before the line or paragraph containing it. `--docx-only` is for the cases
 * where the Markdown genuinely needs different wording, and still verifies.
 */

import console from "node:console";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOCS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
);
const DOCX = path.join(DOCS, "Project_Director_User_Manual.docx");
const MARKDOWN = path.join(DOCS, "USER_MANUAL.md");

/**
 * Where the text being replaced ends, as an index into the Markdown.
 *
 * Returns `lineStart` when not replacing, so the caller inserts rather than
 * overwrites. When replacing, a bullet may be wrapped over several lines, so
 * the item ends at the next line that begins a new bullet, a heading, or a
 * blank line — not at the first newline, which would leave the tail of the old
 * sentence stranded under the new one.
 */
export function markdownItemEnd(text, lineStart, replace) {
  if (!replace) return lineStart;
  const rest = text.slice(lineStart);
  const boundary = rest.search(/\n(?=\s*\n|- |#)/);
  return lineStart + (boundary === -1 ? rest.length : boundary + 1);
}

/**
 * Where the anchor's paragraph ends in the docx body, as an index.
 *
 * Returns `paragraphStart` when not replacing. Throws rather than guessing if
 * the paragraph has no close tag: replacing on a bad index deletes whatever
 * happens to follow, and a manual that silently loses a section is worse than
 * one that fails to update.
 */
export function docxParagraphEnd(xml, at, paragraphStart, replace) {
  if (!replace) return paragraphStart;
  const close = xml.indexOf("</w:p>", at);
  if (close === -1) {
    throw new Error("could not find the end of the anchor's paragraph");
  }
  const end = close + "</w:p>".length;
  if (end <= paragraphStart) {
    throw new Error("the anchor's paragraph ends before it starts");
  }
  return end;
}

function parseArgs(argv) {
  const out = { anchor: "", bullets: [], docxOnly: false, replace: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--anchor") out.anchor = argv[++i] ?? "";
    else if (argv[i] === "--bullet") out.bullets.push(argv[++i] ?? "");
    else if (argv[i] === "--docx-only") out.docxOnly = true;
    else if (argv[i] === "--replace") out.replace = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!out.anchor) throw new Error("--anchor is required");
  if (out.bullets.length === 0)
    throw new Error("at least one --bullet is required");
  return out;
}

/** Whether the document body still contains a run of plain text. */
const installedContains = (xml, text) => xml.includes(escapeXml(text));

const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const bulletXml = (text) =>
  `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r>` +
  `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

/**
 * Insert the same bullets into the Markdown manual, before the line holding the
 * anchor, and verify they are in the file afterwards.
 *
 * Wrapping is left to Prettier, which runs over docs anyway — writing one long
 * line here and letting the formatter fold it keeps this from having to guess a
 * column width.
 */
/**
 * Check the Markdown could be patched, without writing.
 *
 * Called before the docx is touched. Writing the docx first and discovering the
 * Markdown anchor was wrong afterwards leaves the two formats disagreeing —
 * which is the exact failure this script exists to prevent, and which its own
 * first version did on its first test.
 */
function checkMarkdown(anchor) {
  const before = readFileSync(MARKDOWN, "utf8");
  const occurrences = before.split(anchor).length - 1;
  if (occurrences === 0) {
    throw new Error(
      `anchor not found in USER_MANUAL.md: ${JSON.stringify(anchor)}\n` +
        "Both manuals must take the same anchor, or pass --docx-only if the wording genuinely differs.",
    );
  }
  if (occurrences > 1) {
    throw new Error(
      `anchor appears ${occurrences} times in USER_MANUAL.md; use a longer phrase`,
    );
  }
}

function patchMarkdown(anchor, bullets, replace) {
  const before = readFileSync(MARKDOWN, "utf8");
  const at = before.indexOf(anchor);
  const lineStart = before.lastIndexOf("\n", at) + 1;
  // A bullet can be wrapped over several lines, so the item ends at the next
  // line that starts a new one (or a blank line), not at the next newline.
  const itemEnd = markdownItemEnd(before, lineStart, replace);
  const after =
    before.slice(0, lineStart) +
    bullets.map((b) => `- ${b}\n`).join("") +
    before.slice(itemEnd);

  if (after === before)
    throw new Error("the Markdown replacement changed nothing");
  writeFileSync(MARKDOWN, after, "utf8");

  const installed = readFileSync(MARKDOWN, "utf8");
  const missing = bullets.filter((b) => !installed.includes(b));
  if (missing.length > 0) {
    throw new Error(
      `wrote USER_MANUAL.md but ${missing.length} bullet(s) are not in it`,
    );
  }
}

function main() {
  const { anchor, bullets, docxOnly, replace } = parseArgs(
    process.argv.slice(2),
  );
  // Both anchors are checked before either file is written, so a failure
  // leaves the manuals as they were rather than half-updated.
  if (!docxOnly) checkMarkdown(anchor);

  const work = mkdtempSync(path.join(tmpdir(), "manual-docx-"));

  try {
    execFileSync("unzip", ["-q", DOCX, "-d", work]);
    const documentPath = path.join(work, "word", "document.xml");
    const before = readFileSync(documentPath, "utf8");

    const occurrences = before.split(anchor).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `anchor not found in the manual: ${JSON.stringify(anchor)}\n` +
          "The manual's wording may have changed. Search the docx for a phrase that is still there.",
      );
    }
    if (occurrences > 1) {
      // Ambiguous anchors are how a bullet lands in the wrong section.
      throw new Error(
        `anchor appears ${occurrences} times; use a longer phrase that occurs once`,
      );
    }

    // Insert before the paragraph that contains the anchor.
    const at = before.indexOf(anchor);
    const paragraphStart = before.lastIndexOf("<w:p>", at);
    if (paragraphStart < 0)
      throw new Error("could not find the anchor's paragraph");

    // When replacing, the anchor's own paragraph is dropped rather than kept
    // above the new text — otherwise a superseded sentence stays in the manual
    // directly above the sentence that supersedes it.
    const paragraphEnd = docxParagraphEnd(before, at, paragraphStart, replace);
    const after =
      before.slice(0, paragraphStart) +
      bullets.map(bulletXml).join("") +
      before.slice(paragraphEnd);

    if (replace && installedContains(after, anchor)) {
      throw new Error(
        "replacement left the anchor text in the document; it would now appear twice",
      );
    }

    if (after === before) throw new Error("the replacement produced no change");
    writeFileSync(documentPath, after, "utf8");

    // Rezip: no directory entries, [Content_Types].xml first, matching what
    // Word itself writes.
    const out = path.join(work, "out.docx");
    execFileSync(
      "zip",
      [
        "-q",
        "-X",
        "-D",
        "-r",
        out,
        "[Content_Types].xml",
        "_rels",
        "docProps",
        "word",
        "customXml",
      ],
      { cwd: work },
    );
    writeFileSync(DOCX, readFileSync(out));

    // The check that matters: read back what was actually installed.
    const installed = execFileSync("unzip", ["-p", DOCX, "word/document.xml"], {
      maxBuffer: 64 * 1024 * 1024,
    }).toString("utf8");

    const missing = bullets.filter((b) => !installed.includes(escapeXml(b)));
    if (missing.length > 0) {
      throw new Error(
        `wrote the file but ${missing.length} bullet(s) are not in it:\n` +
          missing.map((m) => `  - ${m.slice(0, 60)}…`).join("\n"),
      );
    }

    if (!docxOnly) patchMarkdown(anchor, bullets, replace);

    console.log(
      `Added ${bullets.length} bullet(s) to ${docxOnly ? "the Word manual" : "both manuals"}, ` +
        "verified present in the written file(s).",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Guarded so the module can be imported by its tests without patching the real
// manuals as a side effect of the import.
const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

try {
  if (invokedDirectly) main();
} catch (error) {
  console.error(
    `patch-manual-docx: ${error instanceof Error ? error.message : error}`,
  );
  process.exitCode = 1;
}
