# User manual maintenance

The user manual is part of every user-facing feature, not a follow-up task.

When a mode, visible control, editing tool, effect, animation, transition,
import behavior, or export option changes:

1. Update `docs/USER_MANUAL.md`, the editable source of truth.
2. Add the same text to `docs/Project_Director_User_Manual.docx`. The script
   below updates **both** manuals from one command and verifies each afterwards,
   so they cannot drift apart. It checks both anchors before writing either, so
   a bad anchor leaves the manuals untouched rather than half-updated:

   ```bash
   node scripts/patch-manual-docx.mjs \
     --anchor "a phrase that appears exactly once, just after the insert point" \
     --bullet "The new sentence." --bullet "Another."
   ```

   Hand-editing went wrong repeatedly in one session and once reached `main`
   with *neither* manual carrying text both commits claimed was added.
   `pnpm manual:check` cannot catch that: it checks the files *changed*, not
   that they say anything in particular. Pass `--docx-only` when the two
   formats genuinely need different wording; it still verifies.
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
- `spill-panel.png`: the Spill Suppression panel in the photo editor, opened
  on `test_media/photos/green-screen-900x1200.png` so the cast reading in the
  panel shows a real measurement rather than zero. Capture with
  `locator.screenshot()` on `#inspector` at a 1440x900 viewport.
- `easing-curve.png`: the hand-drawn easing curve editor, opened on a Scale
  keyframe of a Star cartoon clip with the loop-pulse preset, with the first
  handle dragged into an overshoot — overshoot is what the named easings
  cannot do, so a screenshot of an ordinary curve would not show the point.
  Capture with `locator.screenshot()` on the animation control. Call
  `scrollIntoViewIfNeeded()` before reading the canvas box: it sits below the
  fold, and `page.mouse` coordinates are viewport-relative, so without it the
  drag lands outside the window and the capture silently shows no curve.
- `shuttle.png`: the transport while J/K/L shuttling, showing the speed badge.
  Press L twice so a speed rather than plain playback is showing, then capture
  `locator.screenshot()` on `.transport`. Note the playback-speed dropdown
  beside it still reads 1×: that control is the monitor rate, which shuttling
  overrides, and the badge exists because of exactly that difference.
- `track-feature.png`: the Stabilise and Track panels in the Inspector, with a
  feature marked on the picker. Not a mode view — these sit below the fold, so
  the mode screenshots cannot show them.

Capture screenshots at a consistent desktop viewport and verify that no local
paths, secrets, or personal media are visible.

## Adding a picture to the Word manual

An image is three things in a `.docx`: the file under `word/media/`, a
relationship in `word/_rels/document.xml.rels`, and a drawing in the document
that names that relationship. All three have to be added together.

**Two branches embedding a picture at the same time will collide.** Both pick the
next free `imageN.png` and the next free `rIdN`, so both end up using the same
two names for different pictures. Git cannot merge the docx — it is a zip — so it
takes one side wholesale, and the survivor's relationship now points at the other
branch's file. Nothing errors: you get the wrong picture under the caption.

`pnpm sync` does not rescue this. It carries text paragraphs, and a caption whose
drawing names `rId16` is text; the media and the relationship are not. So after
syncing a branch that embeds a picture, **re-run the embed** rather than trusting
the re-applied paragraph, and check the picture under the caption is the intended
one.

## Before every push

Run `pnpm sync` on the branch first.

Both manuals are edited by every feature branch and one of them is a zip of XML.
Git cannot merge a binary file, so any two branches that both touch the Word
manual conflict — always, by construction. Four PRs in a row hit this and each
was resolved the same mechanical way: take main's manuals, then put the
branch's own bullets back.

`pnpm sync` does exactly that. It records what this branch added and the text
each addition sat above, takes main's version of both manuals, then puts each
block back above the same text. It stops rather than guessing when:

- anything outside the two manuals conflicts (the merge is aborted)
- the text an addition sat above is no longer in main
- a line it was holding is missing from the file it just wrote

After pushing, confirm the pull request actually reports `MERGEABLE`:

```sh
gh pr view <number> --json mergeable,mergeStateStatus
```

A clean local merge is not the same claim as a mergeable pull request; the
second is the one that matters, and it is one command.

