# More than one video codec

The export schema always described the full matrix — it mirrors the Rust
`export-engine` crate — while the browser path hardcoded H.264 into MP4. This
adds VP9 and AV1 into WebM, and, more importantly, stops guessing which of them
a given machine can do. Added 2026-08-12.

## Asked, not assumed

Which codecs a browser will really encode is not a fact about the schema or
about the user agent string. It varies by operating system, by build, and by
whether a hardware encoder is present: Chromium on one machine encodes AV1 and
on another does not.

So the export dialog probes with `VideoEncoder.isConfigSupported` and offers
whatever comes back. Same principle the preview's auto-scaling follows — measure
the machine in front of you — and it matters more here, because this is an
open-source editor that will be run on hardware and operating systems nobody
here has seen.

**Probed at the real size and rate**, not at a nominal 1080p. Support is a
function of *level*: a browser that encodes VP9 at 720p may refuse 4K. A probe
at the wrong size would offer a codec that then failed at the click.

## Unavailable is listed, not hidden

An unsupported codec stays in the picker, disabled, labelled "unavailable here"
with the reason as its tooltip. "AV1 is not offered here" and "AV1 does not
exist" are different messages and only the first is true. The lines also join
the **This device** report.

If the codec last chosen is not available at the newly chosen size, the picker
falls back rather than keeping an impossible selection that would fail at the
click.

## Codec and container are chosen together

`mp4-muxer` cannot write VP9 or AV1, and a codec inside a container that cannot
hold it is a file nothing will play. So the container follows the codec: H.264
to MP4 via `mp4-muxer`, VP9 and AV1 to WebM via `webm-muxer`. The e2e checks the
**EBML magic bytes** of a VP9 export for exactly this — a VP9 stream written
into an MP4 would still be bytes, and would still be unplayable.

WebM has no `fastStart` equivalent; it is seekable by construction, so the
option simply does not exist on that branch.

## Levels are derived, not hardcoded

`vp9CodecString` and `av1CodecString` mirror what `h264CodecString` already did:
a level is a throughput contract, and one too low for the picture fails inside
WebCodecs with an opaque message. VP9 and AV1 state their levels in luma samples
rather than macroblocks, so the arithmetic is on pixels directly. Beyond the
table both ask for the highest level rather than silently choosing one that
cannot carry the frame.

Profile 0 and Main tier throughout, for the reason the H.264 builder stays on
Constrained Baseline: the widest set of decoders that will open the file.

## A wart fixed on the way

`buildExportPreset` hardcoded `videoCodec: "h264"`. With VP9 chosen the encoder
did one thing while the preset — which the summary reports and which callers
read — said another. The preset now carries the codec actually used, and the
container derived from it.

`BROWSER_VIDEO_CODECS` widened to `h264, vp9, av1` and `BROWSER_CONTAINERS` to
`mp4, webm`. It means "can attempt" rather than "can do": whether a build will
really encode AV1 at 4K is asked of that browser at export time. The list still
keeps a preset naming ProRes from reaching an encoder that has never heard of it.

## Tests

- `apps/web/test/export-preset.test.ts` — codec string shape, the level rising
  with picture size and with frame rate alone, not running off the end of the
  table, container routing, and `null` for a codec the browser path cannot
  attempt.
- `packages/export-engine/test/browser-preset.test.ts` — two of its tests
  asserted the old limitation and were rewritten rather than deleted: h265 is
  still refused, vp9 and av1 into WebM are now accepted, and vp9 into MP4 is
  still refused because the container cannot hold it.
- `apps/web/e2e/codecs.spec.ts` — all three codecs listed whatever the answer,
  unavailable ones disabled and labelled, a **VP9 export decoded back to three
  distinct frames**, its EBML magic checked, and H.264 still writing an MP4.

## Not built

- **H.265 and ProRes.** No browser encodes either through WebCodecs today; both
  remain the Rust engine's.
- **AAC audio.** Opus throughout, unchanged — WebCodecs AAC support is
  inconsistent and hardware-dependent.
- **Choosing the container independently of the codec.** There is one sensible
  container per codec here, and offering the other would only let someone build
  a file that will not play.
