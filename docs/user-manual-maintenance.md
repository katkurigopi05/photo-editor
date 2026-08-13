# User manual maintenance

The user manual is part of every user-facing feature, not a follow-up task.

When a mode, visible control, editing tool, effect, animation, transition,
import behavior, or export option changes:

1. Update `docs/USER_MANUAL.md`, the editable source of truth.
2. Update `docs/Project_Director_User_Manual.docx` so users receive the same
   instructions in Word format.
3. If `apps/web/index.html`, `apps/web/src/index.css`, or
   `apps/web/src/main.ts` changed, run the editor and replace every affected
   image under `docs/assets/user-manual/`.
4. Run `pnpm manual:check` and the full validation gates in `docs/setup.md`.

CI compares every pull request or push with its base revision. A monitored
feature change fails unless both manual formats change in the same revision.
Visible mode-UI changes also require at least one refreshed screenshot.

Pure refactors inside a monitored editor path may not alter behavior, but the
guard still requests a manual review. In that case, add a short “reviewed; no
user-visible change” note to the manual revision notes and regenerate the Word
document. This makes the review explicit instead of silently assuming the
manual remains correct.

## Screenshot checklist

- `overview.png`: empty workspace and mode wheel.
- `photo-mode.png`: selected image and photo-specific tools.
- `video-mode.png`: selected video, transport, and timeline.
- `animation-mode.png`: generated shape, animation controls, and timeline.
- `gif-mode.png`: populated timeline and GIF export controls.
- `track-feature.png`: the Stabilise and Track panels in the Inspector, with a
  feature marked on the picker. Not a mode view — these sit below the fold, so
  the mode screenshots cannot show them.

Capture screenshots at a consistent desktop viewport and verify that no local
paths, secrets, or personal media are visible.
