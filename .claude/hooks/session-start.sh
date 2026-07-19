#!/bin/bash
# SessionStart hook for Claude Code on the web.
#
# The web sandbox is ephemeral and starts with no project dependencies, so
# Pillow (the core requirement) isn't available until it's installed. This
# hook installs the headless-runnable dependencies every session so the core
# engine (core/), batch_export.py, and the test suite work out of the box.
#
# requirements-dev.txt pulls in the core (Pillow) plus the OpenCV + NumPy
# extras (requirements-cv.txt) and pytest, so the cv_tools tests run too.
#
# Scope notes:
#  - The heaviest optional extras (requirements-ai.txt: torch/transformers/
#    ultralytics; requirements-raw.txt: rawpy) are intentionally NOT installed
#    here — they are multi-GB and opt-in. Install them by hand when needed.
#  - The Tkinter GUI (photo_editor.py) is NOT runnable in a headless remote
#    session: the default interpreter is built without _tkinter and the
#    sandbox has no display server. The GUI is meant to run on a local machine.
set -euo pipefail

# Only run in the remote (Claude Code on the web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Idempotent: pip install is a no-op when requirements are already satisfied,
# and the container state is cached after the hook completes.
python3 -m pip install --quiet -r requirements-dev.txt

echo "session-start: installed core + dev dependencies (Pillow, OpenCV, NumPy, pytest)."
