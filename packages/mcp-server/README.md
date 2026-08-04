# @director/mcp-server

An [MCP](https://modelcontextprotocol.io) server that lets any MCP client —
Claude Desktop, Claude Code, Codex, Cursor — inspect and edit a Project
Director project.

## What it is

The server is a thin shell around the same pieces the web app uses. Every
mutation goes through `@director/editor-state`'s validated command engine, so
an agent cannot produce a project state the app could not have produced: an
invalid command is rejected with the engine's own error and changes nothing.

Two properties fall out of that, and they are the reason to use this rather
than letting a model edit project JSON directly:

- **Everything is undoable.** Agent edits enter the same operation log as human
  ones, so `undo` works across the boundary.
- **Everything is attributable.** Commands are stamped with an `agent` actor,
  so `get_history` shows which changes came from an AI tool and which did not.

## The project file

`open_project` takes a path to a `.director.json` file. That file holds the
**operation log**, not a snapshot — the project is derived from it by replay,
which is this codebase's existing persistence contract. It is canonical JSON,
so identical edits produce identical bytes and diffs stay readable.

A path that does not exist yet is not an error; it is how a new project starts.
Writes go through a temp file and a rename, so an interrupted write cannot
truncate the log.

## Setup

```bash
pnpm install
pnpm --filter @director/mcp-server build
```

The build step is not optional: `dist/` is gitignored, so a fresh clone has no
server to launch until it runs.

**Claude Code** needs no setup beyond the build. The repo ships a
project-scoped [`.mcp.json`](../../.mcp.json) that Claude Code picks up
automatically:

```json
{
  "mcpServers": {
    "director": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${CLAUDE_PROJECT_DIR:-.}/packages/mcp-server/dist/index.js",
        "--root",
        "${CLAUDE_PROJECT_DIR:-.}/director-projects",
        "--actor",
        "mcp:claude-code"
      ]
    }
  }
}
```

No absolute path, so the file is machine-independent and carries nothing
identifying whoever committed it. Projects land in `director-projects/`, which
is gitignored. To point it somewhere else, add a local-scope entry
(`claude mcp add`), which takes precedence over project scope.

Be aware of what `${CLAUDE_PROJECT_DIR:-.}` actually does here. Claude Code sets
that variable in *this server's* environment, not in its own, so inside `args`
it never resolves and **always falls back to the `.` default** — the entry above
is really `./packages/... --root ./director-projects`. Verified: `claude mcp list`
reports the parsed entry with exactly those relative paths.

That matters because relative paths depend on the working directory the server
is launched with. The server compensates for the part it can: `--root` and
`--project` are resolved against `CLAUDE_PROJECT_DIR` when it is set, read from
the environment inside the process, which is the mechanism the Claude Code docs
prescribe. The path to `dist/index.js` cannot be fixed that way — `node` resolves
its own script argument before any of this code runs — so that one still assumes
the server is launched from the project root.

**Claude Desktop** (`claude_desktop_config.json`) uses the same JSON shape with
absolute paths, since it has no project directory to resolve against.

**Codex** uses TOML at `~/.codex/config.toml`, not this JSON shape — the table
is `mcp_servers`, not `mcpServers`:

```toml
[mcp_servers.director]
command = "node"
args = [
  "/absolute/path/to/photo editor/packages/mcp-server/dist/index.js",
  "--root", "/absolute/path/to/your/projects",
  "--actor", "mcp:codex",
]
```

or `codex mcp add director -- node /abs/path/.../dist/index.js --root <dir>
--actor mcp:codex`. Note the `--` before the command.

### Credentials

This server takes none. It has no API key, no token and no network listener —
only a `--root` path and an `--actor` label, which is why its configuration is
safe to commit.

That is not true of MCP servers in general. If you add one to `.mcp.json` that
does need a secret, reference an environment variable rather than pasting the
value: `.mcp.json` expands `${VAR}` and `${VAR:-default}` in `command`, `args`,
`env`, `url` and `headers`. This repo is public, and a committed token is a
leaked token.

Flags:

| Flag | Meaning |
|---|---|
| `--project <path>` (`-p`) | Open a file at startup instead of waiting for `open_project` |
| `--root <dir>` | Directory every project path must stay inside. **Required** unless `--project` is given, in which case that file's directory is the root |
| `--actor <id>` | How this client is labelled in the operation log (default `mcp`) |

Give each client its own `--actor` — that is what makes the history worth
reading later.

## Security

The paths this server acts on come from an MCP client, which means from a
model, which means ultimately from whatever text that model has read. They are
treated as untrusted input.

**What is enforced**

- **An explicit root is mandatory.** The server refuses to start without
  `--root` or `--project`. It will not fall back to the working directory: a
  desktop client launches this process with a directory the operator never
  chose, often `/`, which would leave confinement nominally on and practically
  meaningless.
- **Root confinement.** Every path resolves inside `--root` or is refused.
  Containment is judged after symlinks are resolved, so a symlinked directory
  inside the root cannot be used to reach outside it.
- **Suffix requirement.** Only `.director.json` files are accepted, so the
  server cannot be talked into writing over a `package.json`, a lockfile or a
  config that happens to sit inside the root.
- **Symlink refusal.** An existing target that is a symlink, a directory, or
  anything other than a regular file is rejected rather than written through.
- **Size cap.** Files over 32MB are refused before being read.
- **Unpredictable temp files.** Saves go through a random name created with
  `wx` (exclusive), so a pre-created symlink cannot redirect the write.

Verified against a running server: an absolute path outside the root, a `../`
traversal, a symlinked parent directory, and a wrong suffix are all refused,
while ordinary use inside the root is unaffected.

**What is not, and cannot be**

Project data — names, asset URIs, history — is returned to the calling model.
A `.director.json` file from someone else is therefore untrusted text entering
an agent's context, and can attempt prompt injection. Nothing here can prevent
that without refusing to return project data at all, which would defeat the
point. Treat project files from other people the way you would treat any
untrusted document you hand to an agent.

The transport is stdio and the client launches the process locally: there is
no listener and nothing is reachable over a network. The server runs with the
privileges of whoever started it.

## Tools

**Reading**

| Tool | Returns |
|---|---|
| `open_project` | Opens a file and makes it the target of every other tool |
| `project_summary` | Version, asset/sequence/track/clip counts, undo state |
| `list_assets` | Registered media with kind, URI, duration, dimensions |
| `list_clips` | Clips in a sequence with timing and effect counts |
| `get_clip` | One clip in full, including its effect stack |
| `get_history` | The operation log: what changed, by whom, at which version |
| `get_project_json` | The whole project (large — prefer the others) |

**Editing** — one tool per public command: `create_project`, `register_asset`,
`create_sequence`, `add_track`, `add_clip`, `move_clip`, `trim_clip`,
`delete_clip`, `add_effect`, `update_effect_params`, `remove_effect`,
`reorder_effects`, `update_clip_effects`, `set_clip_audio_gain`,
`set_clip_audio_pan`, plus `undo` and `redo`.

Each editing tool's input schema is the command's payload schema, imported from
`@director/command-schema` rather than restated here. A command that gains a
field gains it in the tool too, and the server can never advertise a shape the
engine would reject.

## Working with the data

- **Times are microseconds as decimal strings** (`"3000000"`), not numbers.
  Pass them through unchanged; converting to a float and back loses precision
  the engine depends on.
- **Frame rates are rationals** (`{ numerator: 30, denominator: 1 }`), so
  29.97 is exact rather than approximated.
- `timelineDurationUs` is derived from the source range and playback rate, so
  `add_clip` does not accept it.

## Limits

- **No rendering.** The server edits projects; it does not export stills,
  video or GIFs. Export lives in the browser (WebCodecs) and the Python CLI.
- **Redo does not survive reopening.** Undo shortens the operation log, which
  is what gets written; the redo stack is in-memory only.
- **One project at a time**, and no locking. Two clients pointed at one file
  will overwrite each other — the engine's `baseVersion` check catches
  conflicts within a session, not across processes.
- **The root is a boundary, not a sandbox.** It stops path escapes; it does not
  stop an agent from making a mess of the projects inside it. Undo and the
  operation log are the recovery path there. Point `--root` at a projects
  directory, not at your home directory.
