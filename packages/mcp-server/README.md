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

Then point a client at `packages/mcp-server/dist/index.js`.

**Claude Code** (`.mcp.json` in the repo, or `claude mcp add`):

```json
{
  "mcpServers": {
    "director": {
      "command": "node",
      "args": [
        "/absolute/path/to/photo editor/packages/mcp-server/dist/index.js",
        "--actor",
        "mcp:claude-code"
      ]
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`) uses the same shape. So do
Codex and Cursor; only the config file location differs.

Flags:

| Flag | Meaning |
|---|---|
| `--project <path>` (`-p`) | Open a file at startup instead of waiting for `open_project` |
| `--actor <id>` | How this client is labelled in the operation log (default `mcp`) |

Give each client its own `--actor` — that is what makes the history worth
reading later.

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
