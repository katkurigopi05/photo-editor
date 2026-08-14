#!/usr/bin/env node
/**
 * Bring a branch up to date with `main`, resolving the manual conflict.
 *
 * Every feature branch adds bullets to both manuals, and one of them is a zip
 * of XML. Git cannot merge a binary file, so **any** two branches that both
 * touch the docx conflict — always, by construction, not by bad luck. Four PRs
 * in a row hit this and each was resolved by hand the same mechanical way:
 * take main's manuals, then put this branch's own bullets back.
 *
 * That is what this does, and it does it precisely rather than by guessing
 * where things go. Before merging it records, for each block of lines this
 * branch added, the line that *followed* it. After taking main's version it
 * finds that same following line and inserts the block above it again. So a
 * bullet that belonged under "Camera raw files…" is still under it, even if
 * main has since added six paragraphs elsewhere.
 *
 * A branch that *replaces* text rather than adding it deletes lines too, and
 * those deletions have to be carried as well. Taking main's manual and
 * re-applying only the additions brings the replaced sentence back, so the
 * manual ends up asserting a thing and its opposite a paragraph apart — which
 * is worse than either version alone and reads as deliberate.
 *
 * It refuses rather than improvises:
 *   - a conflict in any file other than the two manuals stops everything,
 *     because those need judgement and this has none
 *   - a following line that no longer exists in main stops it too, since the
 *     place the bullet belonged has been rewritten
 *   - it verifies afterwards, by reading both files back, that every line it
 *     was holding is present
 *
 * Usage:  node scripts/sync-with-main.mjs [--onto origin/main]
 */

import console from "node:console";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const MARKDOWN = "docs/USER_MANUAL.md";
const DOCX = "docs/Project_Director_User_Manual.docx";
const MANUALS = new Set([MARKDOWN, DOCX]);

const git = (args, options = {}) =>
  execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });

/** A file's contents at a revision, or "" when it did not exist there. */
function fileAt(revision, file) {
  try {
    return git(["show", `${revision}:${file}`]);
  } catch {
    return "";
  }
}

/** The docx's document.xml at a revision. */
function documentXmlAt(revision) {
  const work = mkdtempSync(path.join(tmpdir(), "sync-docx-"));
  try {
    const archive = path.join(work, "manual.docx");
    writeFileSync(
      archive,
      execFileSync("git", ["show", `${revision}:${DOCX}`], {
        cwd: ROOT,
        maxBuffer: 128 * 1024 * 1024,
      }),
    );
    return execFileSync("unzip", ["-p", archive, "word/document.xml"], {
      maxBuffer: 128 * 1024 * 1024,
    }).toString("utf8");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Paragraph texts of a document.xml, in order. */
export function paragraphTexts(xml) {
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((match) =>
    [...match[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((run) => run[1])
      .join(""),
  );
}

/**
 * Blocks of lines present in `after` but not in `before`, each paired with the
 * line that follows it.
 *
 * The follower is the anchor for putting the block back: it is a line this
 * branch did not add, so it still exists in main unless main rewrote it — and
 * if main did rewrite it, that is precisely the case where guessing would put
 * the bullet in the wrong section, so the caller stops.
 */
export function addedBlocks(before, after) {
  const previous = new Set(before);
  const blocks = [];
  let current = null;

  for (const line of after) {
    if (line.trim() !== "" && !previous.has(line)) {
      current ??= { lines: [], follows: null };
      current.lines.push(line);
      continue;
    }
    if (current) {
      current.follows = line;
      blocks.push(current);
      current = null;
    }
  }
  if (current) {
    // Added at the very end, with nothing after it.
    current.follows = null;
    blocks.push(current);
  }
  return blocks.filter((block) => block.lines.length > 0);
}

/**
 * Remove a block this branch deleted, from main's copy.
 *
 * Absent entirely means main deleted it too, which is agreement, not a
 * problem. Present but broken up means main rewrote the passage, and deleting
 * a partial match there would take out somebody else's sentence — so that
 * stops, like every other case this cannot decide.
 */
export function removeBlock(lines, block, describe) {
  const [first] = block.lines;
  if (first === undefined) return lines;

  for (let at = 0; at <= lines.length - block.lines.length; at += 1) {
    if (block.lines.every((line, offset) => lines[at + offset] === line)) {
      return [...lines.slice(0, at), ...lines.slice(at + block.lines.length)];
    }
  }
  if (!lines.includes(first)) return lines;
  throw new Error(
    `cannot remove ${describe} — main has rewritten the passage around it:\n` +
      `  ${first.slice(0, 70)}…\n` +
      "Resolve this manual by hand.",
  );
}

/** Put a block back above the line it used to precede. */
function reinsert(lines, block, describe) {
  if (block.follows === null) return [...lines, ...block.lines];
  const at = lines.indexOf(block.follows);
  if (at === -1) {
    throw new Error(
      `cannot place ${describe} — the text it sat above is no longer in main:\n` +
        `  ${block.follows.slice(0, 70)}…\n` +
        "Resolve this manual by hand: main has rewritten the section it belonged to.",
    );
  }
  return [...lines.slice(0, at), ...block.lines, ...lines.slice(at)];
}

const escapeXml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const bulletXml = (text) =>
  `<w:p><w:pPr><w:pStyle w:val="ListBullet"/></w:pPr><w:r>` +
  `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;

function resolveMarkdown(base, head, onto) {
  const before = fileAt(base, MARKDOWN).split("\n");
  const after = fileAt(head, MARKDOWN).split("\n");
  const blocks = addedBlocks(before, after);
  // Swapping the arguments gives what the branch removed rather than added.
  const removed = addedBlocks(after, before);

  let lines = fileAt(onto, MARKDOWN).split("\n");
  // Removals first: an addition's anchor is a line that survived in the branch,
  // so it is never one of these, and doing it in this order keeps the anchors
  // valid either way.
  for (const block of removed) {
    lines = removeBlock(lines, block, "a bullet dropped from USER_MANUAL.md");
  }
  for (const block of blocks) {
    lines = reinsert(lines, block, "a bullet in USER_MANUAL.md");
  }
  writeFileSync(path.join(ROOT, MARKDOWN), lines.join("\n"), "utf8");
  return blocks.flatMap((block) => block.lines);
}

function resolveDocx(base, head, onto) {
  const before = paragraphTexts(documentXmlAt(base));
  const after = paragraphTexts(documentXmlAt(head));
  const blocks = addedBlocks(before, after);
  const removed = addedBlocks(after, before);

  // Start from main's docx on disk, then apply this branch's changes.
  git(["checkout", onto, "--", DOCX]);
  if (blocks.length === 0 && removed.length === 0) return [];

  const work = mkdtempSync(path.join(tmpdir(), "sync-out-"));
  try {
    execFileSync("unzip", ["-q", path.join(ROOT, DOCX), "-d", work]);
    const documentPath = path.join(work, "word", "document.xml");
    let xml = readFileSync(documentPath, "utf8");

    for (const block of removed) {
      for (const text of block.lines) {
        const at = xml.indexOf(escapeXml(text));
        if (at === -1) continue;
        const paragraphStart = xml.lastIndexOf("<w:p>", at);
        const close = xml.indexOf("</w:p>", at);
        if (paragraphStart === -1 || close === -1) continue;
        xml = xml.slice(0, paragraphStart) + xml.slice(close + "</w:p>".length);
      }
    }

    for (const block of blocks) {
      if (block.follows === null || block.follows.trim() === "") {
        throw new Error(
          "a Word paragraph was added at the end of the document; place it by hand",
        );
      }
      const at = xml.indexOf(block.follows);
      if (at === -1) {
        throw new Error(
          "cannot place a Word paragraph — the paragraph it sat above is no " +
            `longer in main:\n  ${block.follows.slice(0, 70)}…`,
        );
      }
      const paragraphStart = xml.lastIndexOf("<w:p>", at);
      if (paragraphStart === -1) {
        throw new Error("could not find the anchor paragraph's start");
      }
      xml =
        xml.slice(0, paragraphStart) +
        block.lines.map(bulletXml).join("") +
        xml.slice(paragraphStart);
    }
    writeFileSync(documentPath, xml, "utf8");

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
    writeFileSync(path.join(ROOT, DOCX), readFileSync(out));
    return blocks.flatMap((block) => block.lines);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Read both files back and confirm everything held is really there. */
function verify(markdownLines, docxLines) {
  const markdown = readFileSync(path.join(ROOT, MARKDOWN), "utf8");
  const missingMarkdown = markdownLines.filter(
    (line) => !markdown.includes(line.trim()),
  );

  const work = mkdtempSync(path.join(tmpdir(), "sync-check-"));
  let installed;
  try {
    installed = execFileSync(
      "unzip",
      ["-p", path.join(ROOT, DOCX), "word/document.xml"],
      { maxBuffer: 128 * 1024 * 1024 },
    ).toString("utf8");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const text = paragraphTexts(installed).join("\n");
  const missingDocx = docxLines.filter((line) => !text.includes(line));

  if (missingMarkdown.length > 0 || missingDocx.length > 0) {
    throw new Error(
      "resolved the manuals but text went missing — do not commit this:\n" +
        [...missingMarkdown, ...missingDocx]
          .map((line) => `  - ${line.slice(0, 70)}…`)
          .join("\n"),
    );
  }
}

function main() {
  const argv = process.argv.slice(2);
  const ontoIndex = argv.indexOf("--onto");
  const onto = ontoIndex === -1 ? "origin/main" : (argv[ontoIndex + 1] ?? "");
  if (!onto) throw new Error("--onto needs a revision");

  if (git(["status", "--porcelain"]).trim() !== "") {
    throw new Error(
      "the working tree has changes; commit or stash them before syncing",
    );
  }

  git(["fetch", "origin", "--quiet"]);
  const head = git(["rev-parse", "HEAD"]).trim();
  const base = git(["merge-base", "HEAD", onto]).trim();
  const target = git(["rev-parse", onto]).trim();

  if (base === target) {
    console.log(`Already up to date with ${onto}; nothing to merge.`);
    return;
  }

  let conflicted = [];
  try {
    git(["merge", onto, "--no-edit"], { stdio: "pipe" });
    console.log(`Merged ${onto} cleanly.`);
    return;
  } catch {
    conflicted = git(["diff", "--name-only", "--diff-filter=U"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const others = conflicted.filter((file) => !MANUALS.has(file));
  if (others.length > 0) {
    git(["merge", "--abort"]);
    throw new Error(
      "conflicts outside the manuals, which need judgement this script does " +
        `not have:\n${others.map((f) => `  - ${f}`).join("\n")}\n` +
        "The merge has been aborted; resolve by hand.",
    );
  }

  const markdownLines = conflicted.includes(MARKDOWN)
    ? resolveMarkdown(base, head, onto)
    : [];
  const docxLines = conflicted.includes(DOCX)
    ? resolveDocx(base, head, onto)
    : [];
  verify(markdownLines, docxLines);

  git(["add", "--", MARKDOWN, DOCX]);
  git(["commit", "--no-edit"]);
  console.log(
    `Merged ${onto}. Re-applied ${markdownLines.length} manual line(s) and ` +
      `${docxLines.length} Word paragraph(s), verified present in both files.`,
  );
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(
      `sync-with-main: ${error instanceof Error ? error.message : error}`,
    );
    process.exitCode = 1;
  }
}
