# Project Director

An AI-native, non-destructive photo/video/audio editor with a shared
deterministic core for desktop and web. This repository currently contains
**Phase 0 (Foundation)**: a validated, reversible, replayable project-operation
engine (pnpm + Cargo monorepo).

- Contributor guide & rules: [AGENTS.md](AGENTS.md)
- Setup & validation gates: [docs/setup.md](docs/setup.md)
- Architecture & data model: [docs/architecture/](docs/architecture/)
- Build roadmap (later phases): [PROJECT_DIRECTOR_FULL_BUILD_ROADMAP.md](PROJECT_DIRECTOR_FULL_BUILD_ROADMAP.md)

```bash
pnpm install
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
```

---

> The legacy Python MVP below (`photo_editor.py`) predates this foundation and is
> unrelated to the Project Director core.

# photo-editor (legacy Python MVP)
Welcome to the repository for a Minimal Viable Product (MVP) image editor, built from scratch using Python. This project serves as a foundational demonstration of how to combine powerful libraries like Pillow (for image manipulation) and Tkinter (for the Graphical User Interface) to create a functional digital art tool.


# Simple Python Image Editor MVP

This is a minimal but fully functional command-line/GUI image editor built using Python's Pillow and Tkinter libraries. It includes basic filters, resizing, loading, saving, and a history stack for undo functionality.

## 🚀 Getting Started (Local Deployment)

### Prerequisites
You must have Python installed on your system (Python 3.6+ recommended).

### Installation
1. **Clone the repository:** Clone this repository to your local machine.
2. **Install Dependencies:** Navigate into the project directory in your terminal and run:

   ```bash
   pip install -r requirements.txt
