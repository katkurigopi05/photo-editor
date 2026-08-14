# User manual maintenance

The user manual is part of every user-facing feature, not a follow-up task.

When a mode, visible control, editing tool, effect, animation, transition,
import behavior, or export option changes:

1. Update `docs/USER_MANUAL.md`, the editable source of truth.
2. Update `docs/Project_Director_User_Manual.docx` so users receive the same
   instructions in Word format. Use the script rather than editing the zip by
   hand — it verifies the text is in the written file and fails loudly if not:

   ```bash
   node scripts/patch-manual-docx.mjs \
     --anchor "a phrase that appears exactly once, just after the insert point" \
     --bullet "The new sentence." --bullet "Another."
   ```

   Hand-editing went wrong four times in one session and once reached `main`,
   with the Markdown claiming a feature the Word manual never mentioned.
   `pnpm manual:check` cannot catch that: it checks the file *changed*, not
   that it says anything in particular.
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
- `lut-panel.png`: the Lookup table panel in the Inspector. Capture with
  `locator.screenshot()` on the section — it sits below the fold, so a
  viewport clip region fails with "clipped area is outside the image".
- `track-feature.png`: the Stabilise and Track panels in the Inspector, with a
  feature marked on the picker. Not a mode view — these sit below the fold, so
  the mode screenshots cannot show them.

Capture screenshots at a consistent desktop viewport and verify that no local
paths, secrets, or personal media are visible.
