# Export settings and streaming output

Export was fixed at 30fps, three resolutions, three bitrates and always-on
128 kbps Opus, and it held the whole MP4 in memory before downloading it — a
hard ceiling on how long an export could be. Added 2026-08-07.

## Streaming to disk

`mp4-muxer` already shipped `FileSystemWritableFileStreamTarget`; the work was
choosing between it and the buffered path honestly.

`apps/web/src/export-sink.ts` returns a target plus a `finish` that completes
whichever route was taken: closing the file, or downloading the blob. Two
details decide whether this works at all:

- **The picker must be called from the click.** `showSaveFilePicker` needs
  transient user activation, and every `await` before it — planning, codec
  support — spends that activation. Called later it throws, the export silently
  falls back to buffering, and the whole feature is dead code that looks alive.
  The handle is taken in the click handler and passed in.
- **`fastStart` must be `false` when streaming.** `in-memory` buys a seekable
  header by holding the entire file, which is exactly what streaming exists to
  avoid. A streamed file puts its index at the end; every player handles that
  for a local file.

Dismissing the dialog falls back to a download rather than aborting: refusing to
choose a *location* is not refusing the export.

## Settings

`apps/web/src/export-preset.ts` turns the dialog's fields into a validated
`ExportPreset`, and is where every refusal happens — with a sentence naming the
field, rather than three layers down inside WebCodecs where the message is
"invalid config".

| Setting | Range |
| --- | --- |
| Resolution | 4K UHD, 1440p, 1080p, 720p, 480p, or custom |
| Frame rate | 24, 25, 29.97, 30, 50, 59.94, 60 |
| Video bitrate | 40 / 20 / 12 / 8 / 4 Mbps, or custom kbps |
| Audio | Opus at 96–256 kbps, or none |

Two decisions worth keeping:

- **Rates are rationals.** 29.97 is 30000/1001. The timeline is
  microsecond-exact and frame indices are computed in BigInt; a decimal rate
  would drift against it by a frame every few minutes.
- **Odd custom sizes round up rather than fail.** H.264 subsamples chroma 2x2,
  so odd dimensions are not encodable — but typing 1001 is a slip, and nudging
  by a pixel beats an error.

## The H.264 level is computed, not hardcoded

A level is a throughput contract — macroblocks per frame and per second — and
the encoder was pinned at 4.0, which cannot carry 1440p or 4K. `h264CodecString`
derives it from the picture and the rate, so 720p30 asks for 3.1, 1080p30 for
4.0, 4K30 for 5.1 and 4K60 for 5.2. Asking for more than the picture needs
would narrow the set of decoders that will play the file.

The config is then checked with `VideoEncoder.isConfigSupported` before
encoding, so an unsupported combination is a message rather than a crash
mid-export.

## A bug a screenshot caught

The "Custom…" width/height and bitrate fields were visible whatever was
selected: `.export-field` and `.export-custom` both set a `display`, and the
generic `.hidden` has the same specificity, so it lost on source order. Nothing
in the logic was wrong, and no assertion covered it — it was visible only in the
manual screenshot. `apps/web/e2e/export-settings.spec.ts` now pins the reveal.

## Tests

- `apps/web/test/export-preset.test.ts` — acceptance and refusal per field,
  exact rationals, even-side rounding, level selection per resolution and rate.
- `apps/web/test/export-sink.test.ts` — streaming when a handle is returned,
  buffering when it is not, and the file being closed (an unclosed writable
  leaves a truncated MP4 on disk).
- `apps/web/e2e/export-settings.spec.ts` — exports at a custom size and rate and
  decodes the result, rounds an odd size, refuses a zero bitrate in the dialog
  and recovers, and switches audio off and on again, checking the exported
  file's audio track each way.

## Still open

The streaming path itself is not covered end to end: Playwright cannot drive the
native save dialog, so the e2e exercises the buffered fallback. Frame rendering
is still sequential and waits for each decoded video frame, so a long export is
slow even when memory is no longer the limit.
