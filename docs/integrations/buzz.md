# Buzz integration

Project Director uses [Buzz](https://github.com/block/buzz) as an optional,
external workspace for human/agent coordination. Buzz is **not** a runtime
dependency of the editor and its relay, identity, database, and object-storage
services do not enter this repository.

The integration has two independent surfaces:

1. A Buzz-managed Codex agent works in this checkout and can change source code
   under the same `AGENTS.md` rules as any other contributor.
2. The agent can launch `@director/mcp-server` over stdio to inspect or edit
   `.director.json` files. Every project mutation remains a validated Director
   command, attributed in the operation log and reversible with Undo.

```text
Buzz channel or workflow
          |
          v
  Codex through Buzz ACP
       |             |
       |             +--> source edits and repository gates
       v
Director MCP (stdio)
       |
       v
validated commands --> .director.json operation log
```

## 1. Prepare this checkout

Use Node 20 or newer and pnpm 9, then install dependencies and build the MCP
server. A fresh clone has no `dist/` output because build artifacts are ignored.

```bash
pnpm install
pnpm --filter @director/mcp-server build
mkdir -p director-projects
```

The repository's `.codex/config.toml` already registers `director` for Codex
sessions launched at the checkout root:

```toml
[mcp_servers.director]
command = "node"
args = [
  "packages/mcp-server/dist/index.js",
  "--root", "director-projects",
  "--actor", "mcp:codex",
]
```

`director-projects/` is gitignored. The root is deliberately narrow: do not
replace it with the repository root, Downloads directory, or home directory.

## 2. Run Buzz separately

Use either a packaged Buzz Desktop release or a separate source checkout. For a
source deployment, follow Buzz's current quick start in its own directory:

```bash
git clone https://github.com/block/buzz.git
cd buzz
. ./bin/activate-hermit
just setup && just build
just dev
```

This starts infrastructure owned by Buzz, including its relay. Do not clone
Buzz inside Project Director or add its dependencies to either workspace.

In Buzz Desktop, edit the community and set **Repos Directory** to the absolute
path of the directory that contains this checkout. Buzz maps its agent `REPOS`
directory to that existing location, so the agent operates on this clone rather
than making a hidden second copy. Buzz requires this to be an existing absolute
directory.

Select Codex as the managed ACP runtime and select this repository as the
working checkout. Repository-local Codex sessions get the `director` MCP entry
above.

## 3. Pass Director MCP explicitly through Buzz ACP

For a managed runtime that does not load repository-local Codex configuration,
pass the MCP server in Buzz's ACP `session/new` request. Replace the example
paths with canonical absolute paths on the machine running the agent:

```json
{
  "name": "director",
  "command": "node",
  "args": [
    "/absolute/path/to/photo editor/packages/mcp-server/dist/index.js",
    "--root",
    "/absolute/path/to/photo editor/director-projects",
    "--actor",
    "buzz:codex:director"
  ],
  "env": []
}
```

Buzz ACP supports stdio MCP definitions with `name`, `command`, `args`, and
`env`. Prefer the explicit ACP definition for shared or unattended agents: it
does not depend on the agent discovering a particular Codex config file.

Give every editing agent a distinct actor, such as
`buzz:codex:colour-reviewer`. Actor names are project history labels, not
credentials.

## 4. Pilot operating model

Start with one channel per branch or outcome:

- `gpu-rendering`
- `motion-tracking`
- `raw-development`
- `release`

Useful first automations are:

- Mention an agent to investigate or implement a bounded repository task.
- Post pull-request and CI webhooks into the corresponding branch channel.
- Require a human approval reaction before merge or release work.
- Run the complete gate set from `docs/setup.md` before accepting a change.
- Ask an editor agent to propose Director commands, then inspect its attributed
  history before accepting the resulting project file.

Buzz supports message, reaction, schedule, and webhook workflow triggers. Keep
merge, release, and destructive operations behind an explicit human decision.

## Security and correctness boundaries

- Never commit `BUZZ_PRIVATE_KEY`, relay access tokens, model credentials, or a
  `.env` file. Supply secrets to Buzz from its external environment.
- Buzz messages, attached files, repository text, and `.director.json` content
  are untrusted model input. They cannot bypass Director command validation,
  but they can influence what an agent attempts.
- Never let an agent edit `.director.json` directly. Use Director MCP tools so
  validation, attribution, canonical serialization, and undo remain intact.
- Use one MCP editing process per project file. The server deliberately has no
  cross-process file locking; two processes can overwrite each other's saves.
- The MCP server edits project state but does not render or export media.
- Original media remains outside the project log and must never be modified.
- Keep Buzz optional. The editor must continue to open, edit, replay, and export
  projects without a relay or network connection.

## Verification

Before connecting an agent:

```bash
pnpm --filter @director/mcp-server build
pnpm test
cargo test --workspace
```

Then start Codex from the repository root and confirm the `director` MCP server
is available. Open a disposable file under `director-projects/`, make one small
change, inspect `get_history`, undo it, and confirm the project returns to the
prior canonical state.

For complete repository validation, run every gate in `docs/setup.md`.
