import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Path admission for project files.
 *
 * The server takes file paths from an MCP client, which means from a model,
 * which means from whatever text that model has read. Untrusted input reaching
 * `mkdir -p` and a file write should be confined, so every path is resolved
 * against a root directory and rejected if it escapes.
 *
 * Confinement is checked after symlinks are resolved. Checking the literal
 * path would let a symlink inside the root point anywhere outside it — the
 * containment test has to run on where the path actually lands.
 */

/** Project files carry a distinctive suffix so the server cannot be talked
 * into writing over an unrelated .json (a package.json, a lockfile, a config)
 * that happens to sit inside the root. */
export const PROJECT_SUFFIX = ".director.json";

/** Refuse to load anything larger than this. A project log is text; something
 * this size is a mistake or an attempt to exhaust memory. */
export const MAX_PROJECT_BYTES = 32 * 1024 * 1024;

export class PathNotAllowedError extends Error {
  constructor(
    message: string,
    readonly code:
      "OUTSIDE_ROOT" | "BAD_SUFFIX" | "NOT_A_FILE" | "SYMLINK" | "UNRESOLVABLE",
  ) {
    super(message);
    this.name = "PathNotAllowedError";
  }
}

/** Nearest ancestor of `path` that exists, used to resolve symlinks for a file
 * that has not been created yet. */
function deepestExistingAncestor(path: string): string {
  let current = dirname(path);
  // resolve("/") === "/", so this terminates at the filesystem root.
  for (;;) {
    try {
      lstatSync(current);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Resolves `requested` to an absolute path that is guaranteed to sit inside
 * `root`, or throws with a reason the caller can pass straight back to the
 * agent.
 *
 * Accepts relative paths, resolved against the root — an agent asking for
 * "edit.director.json" should get the obvious thing rather than an error.
 */
export function resolveProjectPath(requested: string, root: string): string {
  if (requested.trim() === "") {
    throw new PathNotAllowedError("A project path is required.", "NOT_A_FILE");
  }
  if (!requested.endsWith(PROJECT_SUFFIX)) {
    throw new PathNotAllowedError(
      `Project files must end in ${PROJECT_SUFFIX} (got ${requested}).`,
      "BAD_SUFFIX",
    );
  }

  let resolvedRoot: string;
  try {
    resolvedRoot = realpathSync(resolve(root));
  } catch {
    throw new PathNotAllowedError(
      `The project root ${root} does not exist.`,
      "UNRESOLVABLE",
    );
  }

  const absolute = resolve(resolvedRoot, requested);

  // An existing target must not itself be a symlink, and must be a regular
  // file: writing through a link, or to a device or FIFO, is never intended.
  let stats;
  try {
    stats = lstatSync(absolute);
  } catch {
    stats = null;
  }
  if (stats !== null) {
    if (stats.isSymbolicLink()) {
      throw new PathNotAllowedError(
        `${requested} is a symbolic link; refusing to write through it.`,
        "SYMLINK",
      );
    }
    if (!stats.isFile()) {
      throw new PathNotAllowedError(
        `${requested} is not a regular file.`,
        "NOT_A_FILE",
      );
    }
  }

  // Containment is judged on the real location of the deepest directory that
  // exists, so a symlinked parent cannot smuggle the file out of the root.
  const anchor = deepestExistingAncestor(absolute);
  let realAnchor: string;
  try {
    realAnchor = realpathSync(anchor);
  } catch {
    throw new PathNotAllowedError(
      `Could not resolve ${requested}.`,
      "UNRESOLVABLE",
    );
  }
  if (!isInside(resolvedRoot, realAnchor)) {
    throw new PathNotAllowedError(
      `${requested} is outside the project root ${resolvedRoot}. ` +
        `Start the server with --root to widen it.`,
      "OUTSIDE_ROOT",
    );
  }

  // Re-join the untouched tail onto the resolved anchor so the returned path
  // contains no unresolved links.
  const tail = relative(anchor, absolute);
  return tail === "" ? realAnchor : `${realAnchor}${sep}${tail}`;
}
