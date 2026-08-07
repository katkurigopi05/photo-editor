# Project Director User Manual

Photo · Video · Animation · GIF  
Project version 0.1.0 · Updated August 6, 2026

> Maintenance rule: this Markdown file is the editable source of truth. Keep it,
> `Project_Director_User_Manual.docx`, and affected screenshots synchronized by
> following [user-manual-maintenance.md](user-manual-maintenance.md).

Project Director is a non-destructive media editor. Imported originals are
never overwritten. Project edits pass through validated commands, and exports
are downloaded as new files.

## 1. Quick start

Requirements:

- Node.js 20 or newer and pnpm 9 when running from source.
- A modern desktop browser. Chromium is recommended for MP4 export because
  browser video export requires WebCodecs.
- Enough memory for source media and rendered frames. GIF output is capped at
  300 base frames.

Launch the editor:

```bash
pnpm install
pnpm --filter @director/web dev
```

Open the local URL printed by Vite, normally `http://localhost:5173/`.

Basic workflow:

1. Select Photo, Video, Animation, or GIF on the mode wheel.
2. Import an image, video, or audio file, or add a Cartoon Clip.
3. Select the clip in the preview, media bin, or timeline.
4. Apply a Look, effect, animation, transition, or mode-specific tool.
5. Use Undo and Redo to review the change.
6. Export from the current mode.

## 2. Workspace

![Project Director workspace](assets/user-manual/overview.png)

| Area | Purpose |
| --- | --- |
| Mode wheel | Switches among Photo, Video, Animation, and GIF. Click, scroll, drag vertically, or use Arrow keys. |
| Media panel | Imports files, lists assets, creates cartoon clips, applies Looks and effects, and shows history. |
| Preview | Displays the composited result. Hold Before / After to compare with the source view. |
| Inspector | Edits animation, transitions, effects, and audio gain/pan for the selected clip. |
| Transport | Start, previous frame, play/pause, next frame, seek, timecode, and duration. |
| Timeline | Adds tracks and arranges clips. Split, delete, ripple delete, trim, snap-assisted drag, multi-select, and zoom are available. |
| Top bar | Theme and skin controls, Undo, Redo, version badge, and Export. |

### Shared tools

- Import supports images, video, and audio that the current browser can decode.
- Images receive a default five-second duration.
- One-click Looks: Vivid, B&W, Warm, Cinematic, and Fade.
- Common effects: brightness, contrast, saturation, exposure, blur, opacity,
  crop/reframe, rotate, flip, artistic treatments, text, and background removal.
- Colour grading, available in Photo and Video mode: White Balance, Levels,
  Tone Curve, and Vibrance.
- Lightroom-style panels: Tone (Light), Colour Mixer (HSL), Colour Grading,
  Presence (Clarity, Texture, Dehaze), and Noise Reduction.
- Masks: confine any visual effect to part of the frame. Add a Radial, Linear,
  Luminance range, or Colour range mask under Masks, then pick it in an
  effect's Mask control. Several effects can share one mask.
- Clip speed (0.25×–4×) under Speed in the Inspector, for any clip.
- Visual clips can animate Position X, Position Y, Scale, Rotation, and Opacity.
- Easing choices: linear, hold, ease-in, ease-out, and ease-in-out.
- Crossfade blends with content underneath; dip ramps against a selected color.
- Audio effects on clips that carry sound: Fade In / Out, EQ, and Compressor.

## 3. Photo mode

![Photo mode with a selected portrait](assets/user-manual/photo-mode.png)

Photo mode is for image correction, styling, pixel edits, portrait work,
captions, background removal, and PNG export.

Features:

- Adjustments: brightness, contrast, saturation, exposure, grayscale, sepia,
  invert, blur, opacity, crop/reframe, rotate, flip, vignette, and tint.
- Colour grading: White Balance (Warmth, Tint), Levels (Blacks, Whites,
  Gamma), Tone Curve (Shadows, Midtones, Highlights), and Vibrance.
- Tone (Light): Highlights, Shadows, Whites, and Blacks on Lightroom's
  −100…+100 scale.
- Colour Mixer (HSL): pick one of eight colour bands and move its Hue,
  Saturation, and Luminance. Add one Colour Mixer per band you need.
- Colour Grading: separate hue and strength wheels for shadows, midtones, and
  highlights, plus Balance and an overall Blend.
- Presence: Clarity (midtone form), Texture (fine detail), and Dehaze.
- Masks: Radial, Linear, Luminance range, and Colour range, each with feather.
  Every visual effect gains a Mask control listing the clip's masks.
- Noise Reduction: separate Luminance and Colour amounts.
- Creative effects: Portrait Blur, Duotone, Border, Pencil Sketch, Oil
  Painting, Cartoon, Watercolour, Crosshatch, Halftone, and Text.
- Raster tools: Move, Crop, Transform, Brush, Eraser, Clone Stamp, Lasso,
  Magic Wand, Sharpen, Smart Fill, Remove Background, and AI Remove Background.
- Still-image motion: keyframes plus Ken Burns and other Auto Motion presets.
- Export: the current composited frame as a full-resolution PNG.

Example — polish a portrait:

1. Select Photo and import a portrait.
2. Apply Warm or adjust Brightness and Portrait Blur individually.
3. Hold Before / After to compare with the source.
4. Choose AI Remove Background for one-click isolation, or Edit Photo for
   manual Lasso, Magic Wand, Eraser, and Clone Stamp control.
5. In the raster editor, click Apply to create the edited asset.
6. Click Export to download `export.png`.

Example — grade a photograph:

1. Select the clip and choose White Balance from Add effect.
2. Drag Warmth toward +1 for amber light or −1 for cool light, then correct a
   green or magenta cast with Tint.
3. Add Levels. Raise Blacks and lower Whites to set the contrast window; Gamma
   above 1 lifts midtones, below 1 darkens them.
4. Add Tone Curve to lift Shadows or hold back Highlights without moving the
   rest of the picture.
5. Add Vibrance to strengthen muted colour while leaving already-saturated
   colour and skin tones alone.

Grading applies before artistic treatments, and the graded result is what every
export writes. Reorder or disable individual grading effects in the Inspector.

Example — a Lightroom-style pass:

1. Add Tone (Light) and set Highlights, Shadows, Whites, and Blacks.
2. Add Presence and use Clarity for midtone form, Texture for fine detail, and
   Dehaze for a flat, washed-out frame.
3. Add Colour Mixer (HSL), choose a band, and move its Hue, Saturation, or
   Luminance. Add another Colour Mixer for each further band.
4. Add Colour Grading to tint shadows, midtones, and highlights separately.
   Balance moves the boundary between shadow and highlight; negative widens the
   shadow band.
5. Add Noise Reduction last. Colour can be pushed much harder than Luminance,
   which costs real detail.

Example — a local adjustment:

1. Add the effect you want, for example Exposure, and set it.
2. Under Masks, add a Radial mask and place it with Centre across, Centre down,
   Width, Height, and Feather. Invert selects everything outside it instead.
3. In the effect's Mask control, choose that mask. The effect now applies only
   where the mask covers, fading with its feather.
4. Attach the same mask to further effects to build a local look, or choose
   Whole frame to make an effect global again.

A mask is stored as geometry, not pixels, so it covers the same part of the
picture in the preview and in a full-resolution export. Removing a mask that an
effect still uses is refused; set that effect back to Whole frame first.

Raster strokes use local Undo/Redo until Apply. Project Undo handles the
resulting applied operation.

## 4. Video mode

![Video mode with transport and timeline](assets/user-manual/video-mode.png)

Video mode supports timeline editing, preview, effects, keyframes,
transitions, audio adjustment, current-frame retouching, and MP4 export.

Features:

- Video and audio tracks with clip selection, split, delete, drag, and zoom.
- Dragged clips snap to clip edges, the playhead, and the sequence start. Hold
  Alt while dropping to place a clip exactly where you release it.
- Trim handles on each clip edge change the in/out point. Hold Shift while
  trimming to ripple: later clips on the track shift by the same amount.
- Ripple Delete removes the selection and closes the gap behind it.
- Shift-click or Cmd/Ctrl-click selects several clips; Delete and Ripple Delete
  apply to all of them. Each gesture is a single Undo step.
- Start, previous frame, play/pause, next frame, seek, and synchronized audio.
- Visual controls including hue rotation and Retro Noise in addition to shared
  adjustments, colour grading, and artistic effects.
- Edit Current Frame opens Brush, Clone, Magic Wand, and other raster tools.
- Clip speed from 0.25× to 4×. Retiming keeps the same frames and spreads them
  over more or less timeline; later clips ripple to make room or close the gap.
- Per-clip gain from −60 to +12 dB and stereo pan from left to right.
- Audio effects on any clip that carries sound: Fade In / Out, EQ (low, mid,
  high in dB), and Compressor (threshold, ratio, attack, release, makeup).
- Overlapping two clips on the same audio track crossfades them automatically
  at equal power, so the overlap does not dip or clip.
- H.264 MP4 export with compatible audio mixed into the result.

Example — make a stylized short video:

1. Select Video and import an MP4 or MOV supported by the browser.
2. Preview with Play or Space and move the playhead with the seek control.
3. Select a clip and use Split, Delete, or Ripple Delete to remove unwanted
   material. Drag clip edges to trim, and drag clips to reorder them.
4. Apply Cinematic, then tune its effects in the Inspector.
5. Apply Pan Left or Drift under Auto Motion.
6. Add crossfade or dip transitions and adjust audio Gain/Pan.
7. Under Speed, pick a clip speed between 0.25× and 4×.
8. Under Audio, add Fade In / Out, EQ, or Compressor to the selected clip.
   Slide two audio clips over each other for an automatic crossfade.
9. Export at 1080p, 720p, or 480p with High, Medium, or Low quality.

MP4 export requires `VideoEncoder`, `AudioEncoder`, and `VideoFrame`. Use a
recent Chromium browser in a permitted local or secure context.

## 5. Animation mode

![Animation mode with a generated star](assets/user-manual/animation-mode.png)

Animation mode builds motion graphics from generated shapes and imported
visual media.

Features:

- Cartoon clips: Circle, Star, Speech Bubble, Rectangle, Triangle, Arrow, and
  Heart, with a selectable fill color.
- Auto Motion: Ken Burns In, Ken Burns Out, Pan Left, Pan Right, Fade In, Fade
  Out, Pop, Drift, and Loop Pulse.
- Manual keyframes for Position X/Y, Scale, Rotation, and Opacity.
- Previous/next keyframe navigation and timeline keyframe markers.
- Linear, hold, ease-in, ease-out, and ease-in-out easing.
- Shared Looks, effects, Text, and transitions.
- MP4 output through Export, or GIF output after switching to GIF mode.

Example — create a pulsing star:

1. Select Animation, choose a fill, and click Star.
2. Select Loop Pulse under Auto Motion and click Apply.
3. Preview with Play and adjust Scale keyframes if required.
4. Optionally add 0° and 360° Rotation keyframes.
5. Export as MP4, or switch to GIF for a loop-ready animated image.

Applying an Auto Motion preset replaces the current animation as one command,
so one Undo removes the whole preset.

## 6. GIF mode

![GIF mode and export controls](assets/user-manual/gif-mode.png)

GIF mode creates short animations from photos, video, generated shapes,
effects, transitions, and keyframes.

| Control | Range or behavior |
| --- | --- |
| Frame rate | 2–30 fps; default 12 fps. |
| Width | 120–960 px in 40 px steps; default 480 px. Height follows source aspect. |
| Colors | 256 best quality, 128 smaller, or 64 smallest. |
| Loop forever | Enabled by default. |
| Boomerang | Adds the reverse frame order for forward-and-back playback. |
| Encoder | `gifenc`, loaded when GIF mode is selected. |
| Frame cap | 300 base frames to protect browser memory. |

Example — create a two-photo loop:

1. Select GIF and wait for “GIF encoder ready.”
2. Import two photos; they appear sequentially on the timeline.
3. Start with 12 fps, 480 px, and 256 colors.
4. Leave Loop forever enabled; optionally enable Boomerang.
5. Add Fade keyframes or transitions if the cut is too abrupt.
6. Review the frame/dimension/duration summary and click Export GIF.

To reduce file size, lower width first, then frame rate, then palette colors.

## 7. Export reference

| Mode | Result | Notes |
| --- | --- | --- |
| Photo | PNG | Current composited frame at native/post-crop size. |
| Video | MP4 | H.264 video, optional mixed audio, resolution and bitrate presets. |
| Animation | MP4 | Same timeline renderer, including shapes, effects, keyframes, and transitions. |
| GIF | GIF | Configurable frame rate, width, colors, loop, and boomerang. |

Video resolutions are 1920×1080, 1280×720 (default), and 854×480. Quality
presets are 12 Mbps, 8 Mbps (default), and 4 Mbps.

## 8. Shortcuts

| Input | Action |
| --- | --- |
| Cmd/Ctrl + Z | Undo. |
| Cmd/Ctrl + Shift + Z | Redo. |
| Space | Play or pause when page body has focus. |
| Delete / Backspace | Delete the selected clips when page body has focus. |
| Shift + Delete | Ripple delete: remove the selection and close the gap. |
| Shift or Cmd/Ctrl + click | Add a clip to the selection. |
| Alt while dropping a clip | Ignore snapping and drop where released. |
| Shift while trimming | Ripple trim: shift later clips by the same amount. |
| Wheel Arrow keys | Previous or next mode. |
| Wheel Home / End | Photo / GIF. |
| Hold Before / After | Compare edited and source views. |

## 9. Troubleshooting

- **File will not import:** use an image, video, or audio format the browser can
  decode; try PNG/JPEG or H.264 MP4.
- **Blank preview:** select the clip and move the playhead inside its range.
- **GIF encoder failure:** verify module loading, leave GIF mode, and reselect it.
- **GIF too large:** reduce width, frame rate, colors, duration, or boomerang.
- **MP4 unavailable:** use recent Chromium with WebCodecs.
- **AI removal failure:** verify U²-Net/ONNX assets, or use Remove Background,
  Magic Wand, or Lasso.
- **Disabled effect:** select a clip first.
- **Shortcut does nothing:** click an empty part of the page; global shortcuts
  intentionally do not fire while a form control has focus.

## Revision notes

- **2026-08-06:** Added masks as project state — Radial, Linear, Luminance
  range, and Colour range — with a Mask control on every visual effect.
- **2026-08-06:** Added the Lightroom-modelled panels — Tone (Light), Colour
  Mixer (HSL), Colour Grading, Presence (Clarity/Texture/Dehaze), and Noise
  Reduction — in Photo and Video mode.
- **2026-08-05:** Added clip speed (0.25×–4×). Audio is resampled with the
  picture, so a slowed clip drops in pitch; pitch-preserving stretch is not
  implemented.
- **2026-08-05:** Added timeline snapping, clip trim handles, ripple trim and
  ripple delete, and multi-clip selection, each undoable in one step.
- **2026-08-05:** Added audio Fade In / Out, EQ, and Compressor, plus automatic
  equal-power crossfades where two clips on one audio track overlap.
- **2026-08-05:** Added the colour grading suite — White Balance, Levels, Tone
  Curve, and Vibrance — in Photo and Video mode.
- **2026-08-04:** Initial current-state manual covering Photo, Video,
  Animation, GIF, export, screenshots, and maintenance enforcement.
