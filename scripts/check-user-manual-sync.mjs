#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import console from "node:console";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MANUAL_SOURCE = "docs/USER_MANUAL.md";
const MANUAL_WORD = "docs/Project_Director_User_Manual.docx";
const MANUAL_SCREENSHOT_PREFIX = "docs/assets/user-manual/";

const FEATURE_PREFIXES = [
  "apps/web/src/",
  "packages/bg-segmentation/src/",
  "packages/command-schema/src/",
  "packages/editor-state/src/",
  "packages/export-engine/src/",
  "packages/playback-controller/src/",
  "packages/project-schema/src/",
  "packages/raster-tools/src/",
  "packages/ui-kit/src/",
];

const FEATURE_FILES = new Set(["apps/web/index.html"]);
const VISUAL_MODE_FILES = new Set([
  "apps/web/index.html",
  "apps/web/src/index.css",
  "apps/web/src/main.ts",
]);

const normalizePath = (path) => path.replaceAll("\\", "/").replace(/^\.\//, "");

const isFeatureFile = (path) =>
  FEATURE_FILES.has(path) ||
  FEATURE_PREFIXES.some((prefix) => path.startsWith(prefix));

export function evaluateManualSync(changedFiles) {
  const files = [...new Set(changedFiles.map(normalizePath).filter(Boolean))];
  const featureChanged = files.some(isFeatureFile);
  if (!featureChanged) return { required: false, missing: [] };

  const missing = [];
  if (!files.includes(MANUAL_SOURCE)) missing.push(MANUAL_SOURCE);
  if (!files.includes(MANUAL_WORD)) missing.push(MANUAL_WORD);

  const visibleModeUiChanged = files.some((path) =>
    VISUAL_MODE_FILES.has(path),
  );
  const screenshotChanged = files.some(
    (path) =>
      path.startsWith(MANUAL_SCREENSHOT_PREFIX) && path.endsWith(".png"),
  );
  if (visibleModeUiChanged && !screenshotChanged) {
    missing.push(`${MANUAL_SCREENSHOT_PREFIX}*.png`);
  }
  return { required: true, missing };
}

function parseArgs(argv) {
  const result = {
    base: process.env.MANUAL_SYNC_BASE,
    head: process.env.MANUAL_SYNC_HEAD ?? "HEAD",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--base") result.base = argv[++index];
    else if (arg === "--head") result.head = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return result;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles({ base, head }) {
  if (base && !/^0+$/.test(base)) {
    return git([
      "diff",
      "--name-only",
      "--diff-filter=ACMR",
      `${base}...${head}`,
    ]);
  }
  if (base && /^0+$/.test(base)) {
    return git(["diff-tree", "--no-commit-id", "--name-only", "-r", head]);
  }
  return [
    ...new Set([
      ...git(["diff", "--name-only", "HEAD"]),
      ...git(["diff", "--cached", "--name-only"]),
      ...git(["ls-files", "--others", "--exclude-standard"]),
    ]),
  ];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = changedFiles(options);
  const result = evaluateManualSync(files);
  if (!result.required) {
    console.log("User manual sync: no monitored feature changes.");
    return;
  }
  if (result.missing.length === 0) {
    console.log(
      "User manual sync: feature changes include the required manual updates.",
    );
    return;
  }
  console.error(
    "User-facing editor features changed without a complete manual update.",
  );
  console.error("Update and commit:");
  for (const path of result.missing) console.error(`  - ${path}`);
  console.error("See docs/user-manual-maintenance.md for the update workflow.");
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main();
