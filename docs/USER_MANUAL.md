# Project Director User Manual

Photo · Video · Animation · GIF  
Project version 0.1.0 · Updated August 8, 2026

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
| Top bar | Theme and skin controls, Save, Save As, Open, Recent, Undo, Redo, version badge, and Export. |

The workspace adapts to the window: below about 1000 pixels wide it stacks into
a single column with the preview on top and the panels beneath it. Every control
shows a focus ring when reached with the keyboard, and animation is dropped
when the system asks for reduced motion.

### Shared tools

- History (left panel) lists every edit, one entry per action. Click any entry
  to travel back to it; entries ahead of where you are stay listed, greyed, and
  clicking one moves forward again. The highlighted entry is where the project
  currently stands.
- Save a project with Save (Cmd/Ctrl+S) and reopen it later with Open. The file
  holds the full edit history, so opening it restores the timeline exactly.
- After the first save, Save writes straight back to the same file. Use Save as
  (Cmd/Ctrl+Shift+S) to save to a new one.
- Recent… lists the last eight projects you saved or opened. Choosing one
  reopens it; the browser asks for permission to read the file each session.
- Large video (720p and above, or files over 256MB) is proxied automatically: a
  540p copy is built in the background, editing reads it, and exports read the
  original. The media item shows a Proxy badge when one is in use. Untick Use
  proxies to edit the originals directly, or press Clear to delete the proxy
  files.
- Media is not copied into the project file. After opening, the bin marks any
  missing media and Relink… matches the files you pick — by checksum first, so a
  renamed file still matches.
- Unsaved work is snapshotted every 15 seconds; if the tab closes unexpectedly,
  the next start offers to restore it.
- Adjustment layers apply effects to everything beneath them. Press ＋
  Adjustment in the timeline toolbar: a layer is added on the top track, and any
  clips already there move down one track to make room, as a single Undo. Give
  the layer a Look or effects and they grade every clip below it. Its opacity,
  blend mode and fades all work, so a half-opacity adjustment layer is half the
  grade.
- Blend mode (Inspector) decides how a clip combines with what is beneath it:
  Multiply darkens, Screen brightens, Overlay does both from the midpoint, and
  the rest of the standard modes are there too. Earlier tracks draw on top, so
  the mode applies to the clip above.
- The level meter beside the transport shows peak and RMS per channel while the
  timeline plays. The red light latches when audio clips; ⟲ clears it.
- Scopes (Inspector, top) measure the picture: Histogram for levels, Waveform for
  where those levels sit across the frame, Vectorscope for hue and saturation.
  They are off by default because each reads back every displayed frame.
- Import supports images, video, and audio that the current browser can decode.
- Mark media as Favorite (★) or Rejected (✕) in the bin, search it by name, and
  filter to All, Favorites, Rejected, or Unrated. Ratings are project state and
  undo like any other edit; the original file is never touched.
- Tag media with keywords using the 🏷 button, then filter by keyword or click a
  keyword chip. Search covers keywords as well as names. Save the current
  search, keyword and filter as a named view to return to it later.
- Choose part of a video or audio item before adding it: the ⟦⟧ button opens In
  and Out sliders, and the chosen span is what lands on the timeline. Whole clip
  clears it. The choice lasts for the session and is not saved in the project.
- Keyword a *part* of a shot: with the In and Out sliders set, press Keyword this
  range and name it. The tagged span appears as a chip under the item; clicking
  the chip loads that span back as the range to add, so "the good take" becomes
  the next thing you place in one click, and ✕ removes it. Unlike the In/Out
  choice above, keyword ranges are saved with the project and undo like any other
  edit. Search and the keyword filter both find them, so a keyword that only ever
  named a range still turns up.
- Large files import without being loaded into memory: the file is read in
  chunks while a progress line shows how far along it is. Multi-gigabyte video
  imports as normal.
- Images receive a default five-second duration.
- One-click Looks: Vivid, B&W, Warm, Cinematic, and Fade. A Look or an effect
  applies to every selected clip at once.
- Common effects: brightness, contrast, saturation, exposure, blur, opacity,
  crop/reframe, rotate, flip, artistic treatments, text, and background removal.
- Colour grading, available in Photo and Video mode: White Balance, Levels,
  Tone Curve, and Vibrance.
- Curves gives a control-point curve on the composite (RGB) or on the Red, Green
  or Blue channel on its own. Drag the line to shape it, click empty space to
  add a point, and double-click a point to remove it; the two ends move up and
  down but not sideways. Reset channel returns the selected channel to the
  diagonal. The curve never overshoots between the points you place, so a
  highlight will not gain a halo it was not given.
- Lightroom-style panels: Tone (Light), Colour Mixer (HSL), Colour Grading,
  Presence (Clarity, Texture, Dehaze), and Noise Reduction.
- Masks: confine any visual effect to part of the frame. Add a Radial, Linear,
  Luminance range, or Colour range mask under Masks, then pick it in an
  effect's Mask control. Several effects can share one mask.
- Clip speed (0.25×–4×) under Speed in the Inspector, for any clip.
- Speed ramps: a clip can change speed partway through. Under Speed, move the
  playhead to the moment the action should change and press ＋ Speed change at
  playhead; the new section starts at 0.5× and each section has its own rate
  picker. ✕ removes a section and Clear ramp returns the clip to a single rate.
  The speed steps between sections rather than easing between them.
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
- Markers: press M to pin a note to the selected clip at the playhead, or
  Shift+M for a to-do. Markers appear along the clip, jump the playhead when
  clicked, and are listed in the Inspector where they can be renamed, ticked, or
  removed. They ride the clip, so trimming or moving it carries them along.
- Dragged clips snap to clip edges, the playhead, and the sequence start. Hold
  Alt while dropping to place a clip exactly where you release it.
- Trim handles on each clip edge change the in/out point. Hold Shift while
  trimming to ripple: later clips on the track shift by the same amount.
- Ripple Delete removes the selection and closes the gap behind it.
- The 🧲 button on a track makes it magnetic: its clips stay packed end to end,
  so deleting one closes the gap, adding one pushes the rest along, and dragging
  one past a neighbour swaps them. Other tracks are unaffected — magnetic is per
  track, and an ordinary track still allows gaps.
- ⧉ Compound turns the selected clips into a single clip that plays them. Their
  effects, animations, speed and blend mode come along, and the whole thing is
  one Undo. Useful when a run of clips has become one thing you want to move,
  trim or grade together.
- Shift-click or Cmd/Ctrl-click selects several clips. Effects, Looks, Delete
  and Ripple Delete all apply to every selected clip, and each apply is a single
  Undo step however many clips and effects it touched. The Inspector still edits
  one clip; it says which while a multi-selection is active.
- Start, previous frame, play/pause, next frame, seek, and synchronized audio.
- Visual controls including hue rotation and Retro Noise in addition to shared
  adjustments, colour grading, and artistic effects.
- Edit Current Frame opens Brush, Clone, Magic Wand, and other raster tools.
- Clip speed from 0.25× to 4×. Retiming keeps the same frames and spreads them
  over more or less timeline; later clips ripple to make room or close the gap.
- Speed ramps: one clip can run at several speeds. Add a speed change at the
  playhead under Speed, then set each section's rate — full speed into the
  action, quarter speed across it, full speed out. The clip resizes to the sum of
  its sections and later clips ripple, exactly as a single speed change does, and
  the whole ramp is one Undo. Audio is resampled with the picture, so a slowed
  section drops in pitch.
- ＋ Adjustment adds a layer that grades every clip beneath it instead of
  carrying a picture of its own. It spans the whole sequence by default, and can
  be trimmed, moved and faded like any other clip.
- Add as (timeline toolbar) decides where media from the bin lands:
  **Append** puts it after the last clip on the track, **Insert** puts it at the
  playhead and pushes everything after it later, and **Overwrite** puts it at the
  playhead and replaces what it covers. Insert and Overwrite both cut a clip in
  two if the playhead is in the middle of one, and each is a single Undo however
  many clips it moved. Only the target track ripples; other tracks stay put.
- Per-clip gain from −60 to +12 dB and stereo pan from left to right.
- Audio effects on any clip that carries sound: Fade In / Out, EQ (low, mid,
  high in dB), and Compressor (threshold, ratio, attack, release, makeup).
- Overlapping two clips on the same audio track crossfades them automatically
  at equal power, so the overlap does not dip or clip.
- H.264 MP4 export with resolution up to 4K (or a custom size), frame rates
  from 24 to 60 including 29.97 and 59.94, video bitrate up to 40 Mbps or a
  custom value, and audio that can be switched off or set from 96 to 256 kbps.
- Where the browser allows it, the file is written straight to the location you
  choose, so export length is limited by disk space rather than by memory.

Example — make a stylized short video:

1. Select Video and import an MP4 or MOV supported by the browser.
2. Preview with Play or Space and move the playhead with the seek control.
3. Select a clip and use Split, Delete, or Ripple Delete to remove unwanted
   material. Drag clip edges to trim, and drag clips to reorder them.
4. To drop a shot into the middle of the cut, set Add as to Insert and click the
   bin item at the playhead; choose Overwrite instead to replace what is there
   rather than pushing it later.
5. Apply Cinematic, then tune its effects in the Inspector.
6. Apply Pan Left or Drift under Auto Motion.
7. Add crossfade or dip transitions and adjust audio Gain/Pan.
8. Under Speed, pick a clip speed between 0.25× and 4×, or add a speed change
   at the playhead to ramp one clip through several speeds.
9. Under Audio, add Fade In / Out, EQ, or Compressor to the selected clip.
   Slide two audio clips over each other for an automatic crossfade.
10. Export: choose a resolution (4K, 1440p, 1080p, 720p, 480p, or Custom), a
    frame rate, a bitrate, and audio settings, then start. Chromium asks where
    to save and writes the file as it encodes.

MP4 export requires `VideoEncoder`, `AudioEncoder`, and `VideoFrame`. Use a
recent Chromium browser in a permitted local or secure context.

Export settings:

| Setting | Choices |
| --- | --- |
| Resolution | 4K UHD, 1440p, 1080p, 720p, 480p, or Custom width and height |
| Frame rate | 24, 25, 29.97, 30, 50, 59.94, 60 |
| Quality | 40, 20, 12, 8, 4 Mbps, or a custom kbps value |
| Video codec | H.264 (MP4), VP9 (WebM), AV1 (WebM) — whichever this browser can encode |
| Audio | Opus at 96–256 kbps, or no audio |

A custom width or height is rounded up to the next even number, because H.264
cannot encode odd dimensions. Settings the browser cannot encode — an extreme
size or frame rate — are refused in the dialog with the reason, before the
export starts.

Browsers that support the File System Access API (Chromium) ask where to save
and write the file while encoding, so a long export is limited by disk space.
Elsewhere the file is assembled in memory and then downloaded, which limits how
long an export can be.

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

### Running on your machine

The editor adapts to the device it finds rather than assuming one:

- Open Export and expand **This device** to see what is available here — whether
  MP4 export is supported, whether long exports write straight to disk or are
  held in memory, and what the machine reports about itself.
- Where a capability is missing the reason is stated along with what still
  works. A browser without WebCodecs cannot write MP4 or build proxies, but
  image and GIF export are unaffected.
- Preview quality scales itself to the machine. It starts from what the device
  reports and then adjusts by measuring real frames: a slower machine settles
  lower so editing stays responsive, a faster one climbs so it is not held back.
  Set **Preview quality** under Export → This device to Auto, Low, Medium or
  High if you would rather choose; the setting is remembered on this machine.
- **Exports are never scaled** — a render is always full resolution and full
  quality, whatever machine produced it and however busy it was.
- Large video is proxied at 540p on import, so editing stays responsive on
  modest hardware; exports still read the original.

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
| Cmd/Ctrl + S | Save the project, to the file it was last saved to. |
| Cmd/Ctrl + Shift + S | Save the project to a new file. |
| M | Add a marker to the selected clip at the playhead. |
| Shift + M | Add a to-do marker at the playhead. |
| Shift or Cmd/Ctrl + click | Add a clip to the selection. |
| Alt while dropping a clip | Ignore snapping and drop where released. |
| Shift while trimming | Ripple trim: shift later clips by the same amount. |
| Wheel Arrow keys | Previous or next mode. |
| Wheel Home / End | Photo / GIF. |
| Hold Before / After | Compare edited and source views. |

## 9. Troubleshooting

- **Media is missing after opening a project:** the project file stores edits,
  not media. Click Relink… and pick the files; matching is by checksum, so
  renamed files still match.
- **File will not import:** use an image, video, or audio format the browser can
  decode; try PNG/JPEG or H.264 MP4.
- **A very large file takes a while to import:** the file is read once, end to
  end, to identify it. The progress line in the toast shows how far along it is;
  editing starts as soon as it finishes.
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

- **2026-08-12:** Tracks can be made magnetic with the 🧲 button on the track
  head — clips stay packed end to end, and gaps close by themselves.
- **2026-08-12:** Added compound clips — select a run of clips and press ⧉
  Compound to replace them with one clip that plays them all.
- **2026-08-12:** Export can write VP9 and AV1 into WebM as well as H.264 into
  MP4. The Video codec list shows what this browser can actually encode at the
  chosen size; anything it cannot is listed with the reason rather than hidden.
- **2026-08-12:** The History panel is navigable — click an edit to go back to
  it, and click a greyed one to go forward again. Entries are named after the
  action and grouped so one entry is one Undo.
- **2026-08-11:** Preview quality now scales itself by measuring real frames, so
  the editor settles at a level that suits the machine it is running on, and can
  be pinned to Auto, Low, Medium or High under Export → This device. Exports are
  unaffected and remain full resolution. Export also shows a **This device**
  report of what is and is not available here.
- **2026-08-11:** Added Curves — a control-point curve on the composite or on
  any single channel, replacing nothing: the three-band Tone Curve stays.
- **2026-08-11:** Added adjustment layers — ＋ Adjustment in the timeline
  toolbar adds a layer whose effects apply to every clip beneath it.
- **2026-08-11:** Added speed ramps — one clip can change speed partway through,
  set from ＋ Speed change at playhead under Speed. The speed steps between
  sections rather than easing between them.
- **2026-08-11:** Added three-point editing — the Add as control in the timeline
  toolbar chooses whether media from the bin appends, inserts (pushing later
  clips along) or overwrites what it lands on.
- **2026-08-10:** Added keyword ranges — tag part of a shot from the In/Out
  editor, then click the chip to load that span back as the range to add. Unlike
  the In/Out choice itself, these are saved with the project.
- **2026-08-08:** Projects can be saved and reopened, with media relinking and a
  15-second crash-recovery snapshot.
- **2026-08-08:** Added browser ranges — pick In and Out on a media item and
  only that part is added to the timeline.
- **2026-08-08:** Added media keywords, keyword filtering, and saved views.
- **2026-08-07:** Added clip markers — notes, chapters and to-dos — with pins on
  the timeline, an Inspector list, and the M shortcut.
- **2026-08-07:** The media bin gained Favorite/Rejected ratings, name search,
  and a rating filter.
- **2026-08-07:** Large files now import by streaming rather than by loading the
  whole file into memory, with progress shown for files above 64 MB.
- **2026-08-07:** The workspace now reflows on narrow windows instead of
  squeezing the preview, every control shows a keyboard focus ring, and reduced
  motion is honoured throughout.
- **2026-08-07:** Export gained 4K/1440p and custom resolutions, selectable
  frame rates including 29.97 and 59.94, custom bitrates, audio bitrate and
  no-audio options, and streams to disk where the browser supports it.
- **2026-08-07:** Effects and Looks now apply to every selected clip, as one
  Undo step. Audio effects skip selected clips that carry no audio.
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
