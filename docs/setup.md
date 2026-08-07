# Repository Setup & Validation

## Prerequisites

- Node.js ≥ 20 (developed on 22).
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`).
- Rust stable (with `clippy` and `rustfmt` components).

## Install

```bash
pnpm install
```

## Quality gates

Run every gate before considering a change complete. All must pass; do not
weaken strictness, lint rules, or tests to get a green result.

```bash
# TypeScript workspace
pnpm format:check     # Prettier
pnpm manual:check     # user-facing feature changes include manual updates
pnpm lint             # ESLint (typescript-eslint recommended)
pnpm typecheck        # tsc --noEmit, strict + exactOptionalPropertyTypes
pnpm test             # Vitest (all packages)
pnpm build            # tsup → dist/ for every package and app

# Rust workspace
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

CI (`.github/workflows/ci.yml`) runs the same set on every push and pull
request.

## Package build outputs

Each TypeScript package builds an importable ESM entry at
`<package>/dist/index.js` with types. In particular,
`packages/editor-state/dist/index.js` exports `createEditorState`,
`executeCommand`, `undo`, `redo`, `replay`, and `InMemoryPersistence`.

## Notes

- `.benchmark-lock.json` is intentionally absent and must not be created or
  edited.
- The legacy `photo_editor.py` at the repo root predates this foundation and is
  excluded from lint/format; it is unrelated to the Project Director core.
