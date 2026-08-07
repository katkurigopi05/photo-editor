#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ProjectSession } from "./session.js";
import { registerEditTools } from "./tools/edit.js";
import { registerInspectTools } from "./tools/inspect.js";

/**
 * MCP server for Project Director.
 *
 * Lets any MCP client (Claude Desktop, Claude Code, Codex, Cursor, …) inspect
 * and edit a Director project. Every mutation goes through the same validated
 * command engine the web app uses, so an agent cannot produce a project state
 * the app could not have produced, and the whole session lands in the
 * operation log as `agent` actions — inspectable and undoable afterwards.
 *
 * Transport is stdio: the client launches this process, so the project file
 * never leaves the machine.
 */

export { ProjectSession } from "./session.js";
export {
  resolveProjectPath,
  PathNotAllowedError,
  PROJECT_SUFFIX,
  MAX_PROJECT_BYTES,
} from "./paths.js";
export {
  loadProjectFile,
  saveProjectFile,
  ProjectFileError,
  PROJECT_FILE_VERSION,
  type ProjectFile,
} from "./project-store.js";

export function createServer(session: ProjectSession): McpServer {
  const server = new McpServer(
    { name: "director", version: "0.1.0" },
    {
      instructions:
        "Edits a local Project Director file. Call open_project first; " +
        "every other tool acts on the file it opened. Times are microseconds " +
        "as decimal strings and frame rates are rationals — pass them through " +
        "unchanged rather than converting to floats. Mutations are validated " +
        "commands: a rejected one changes nothing and explains why.",
    },
  );
  registerInspectTools(server, session);
  registerEditTools(server, session);
  return server;
}

/** `--project <path>` opens a file at startup; otherwise the client calls
 * open_project. `--actor <id>` labels this client in the operation log.
 * `--root <dir>` is the directory every project path must stay inside. One of
 * `--root` or `--project` is required; see main(). */
export function parseArgs(argv: readonly string[]): {
  project?: string;
  actorId?: string;
  root?: string;
} {
  const parsed: { project?: string; actorId?: string; root?: string } = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag === "--project" || flag === "-p") && value !== undefined) {
      parsed.project = value;
      index++;
    } else if (flag === "--actor" && value !== undefined) {
      parsed.actorId = value;
      index++;
    } else if (flag === "--root" && value !== undefined) {
      parsed.root = value;
      index++;
    }
  }
  return parsed;
}

/**
 * Resolve a relative path against the project root the client told us about.
 *
 * A project-scoped `.mcp.json` cannot write an absolute path without hardcoding
 * one machine's layout, and `${CLAUDE_PROJECT_DIR}` does not help there: Claude
 * Code sets that variable in *this process's* environment, not in its own, so
 * `${CLAUDE_PROJECT_DIR:-.}` inside `args` always expands to the `.` default.
 * The documented way round is to read the variable here instead.
 *
 * Falling back to the working directory keeps a bare shell invocation working.
 * That is not a weakening of the rule this server already enforces — a root
 * must still be given explicitly; this only decides what a *relative* one is
 * relative to.
 */
export function anchorToProjectDir(
  path: string,
  projectDir = process.env.CLAUDE_PROJECT_DIR,
): string {
  if (isAbsolute(path) || projectDir === undefined || projectDir === "") {
    return path;
  }
  return resolve(projectDir, path);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Refuse to start without an explicit root or project rather than falling
  // back to the working directory. A desktop client launches this process with
  // a working directory the operator never chose — often "/" — and silently
  // taking it as the root would leave the confinement nominally on and
  // practically meaningless.
  if (args.root === undefined && args.project === undefined) {
    throw new Error(
      "Refusing to start without --root <dir> or --project <file>: the " +
        "working directory of a client-launched process is not a safe " +
        "default for the directory this server is allowed to write in.",
    );
  }

  const session = new ProjectSession({
    actorId: args.actorId ?? "mcp",
    // A project implies its own directory, which keeps the common
    // single-project setup to one flag.
    root: anchorToProjectDir(args.root ?? dirname(args.project as string)),
  });
  if (args.project !== undefined) {
    await session.open(anchorToProjectDir(args.project));
  }
  const server = createServer(session);
  await server.connect(new StdioServerTransport());
}

// Only run when executed directly; importing this module (tests, embedding)
// must not start a server on stdio. pathToFileURL, not string interpolation:
// import.meta.url is percent-encoded, so a path containing a space (or any
// character needing escaping) would never match a raw argv value.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    // stderr, never stdout: stdout is the MCP transport and any stray write
    // corrupts the protocol stream.
    process.stderr.write(
      `director-mcp failed to start: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  });
}
