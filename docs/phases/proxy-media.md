# Proxy media

Editing against a 4K source means decoding a 4K frame for every scrub, every
playhead move and every redraw. That is why large footage feels broken long
before it runs out of memory: nothing has crashed, every single interaction is
just paying for a full-size decode.

Every professional editor answers this the same way, and so does this one now:
transcode once to a small copy, edit against that, and go back to the original
at export.

## What a proxy is, and is not

A proxy is a cache. It never enters the command log, it is not part of the
project file, and the same edit against the same footage produces the same
operation log whether or not a small copy happened to exist. It sits beside the
relink table for exactly that reason — both are facts about this session, not
about the project.

- **Size**: 540p, aspect preserved, both sides rounded to even numbers. H.264
  encodes in 2x2 chroma blocks and an odd dimension is refused outright by some
  encoders, which would mean no proxy at all for that clip.
- **Rate**: 30fps, with a keyframe every second — scrubbing is precisely the
  workload long GOPs are worst at.
- **Bitrate**: about 0.1 bits per pixel per frame. A proxy that looks wrong is
  one people switch off.
- **When**: video at or above 720p, or any video file over 256MB whatever its
  dimensions. Stills and audio are never proxied.

## Where they live

In the origin-private file system, not IndexedDB. A proxy of a long clip is
hundreds of megabytes, and OPFS takes a write stream, so the muxer writes
straight to disk and the file is never held in memory whole — the same reason
export streams to the file the user picked.

They are keyed by the source's **checksum**, so reimporting the same footage, or
relinking it in a later session, finds the proxy already built instead of
transcoding it again.

## Which copy gets read

`drawLayer` is shared by the preview and by both export paths, so the choice
cannot live at the call site: it is a property of what the render is *for*.
A single `renderOriginals` flag is raised for the duration of an export, and
`mediaFor(asset)` answers accordingly.

Two cases deliberately stay on the original:

- **Audio monitoring**, because a proxy carries picture only.
- **Playback**, for the same reason — the original element is the one being
  driven and heard, so the picture comes from it too. Proxies earn their keep on
  the other path, scrubbing, where every move costs a decode.

Pixel editing (the raster session) also reads the original: retouching a proxy
would bake 540p detail into a full-size image.

## Building

The source is decoded by seeking a plain video element, which is the only decode
path a browser offers for an arbitrary file it can play. That makes building a
proxy about as slow as an export — paid once, against every scrub afterwards.
Builds are queued one at a time: three at once is three times the work, three
times slower per file, and a preview that stutters throughout.

Everything about it is optional. No WebCodecs, a configuration the encoder
refuses, a full disk, a closed tab mid-build — each ends the same way, editing
against the original exactly as before. A build that dies part-way leaves a
zero-length file, which `readProxy` treats as absent rather than as a proxy that
renders black.

## Two things that share a video element

Both problems found while building this were the same problem: transcoding and
exporting are the same operation — seek, draw, encode — run against the same
file.

1. The build seeked the *cached* element, the one the preview and the export
   also seek. Each one's seeks landed in the other's frames. The build now uses
   a private element of its own.
2. Even with separate elements, running both at once starved the export's
   seeks, so it drew the frame it already had: an export started during a build
   came out as one picture repeated. Building now pauses for the duration of an
   export and resumes afterwards, which is what every editor with both features
   does.

Neither failed loudly. The first surfaced as an existing export test — "MP4
export of a video clip writes distinct frames" — going red the moment the
fixture it uses became large enough to proxy.

## Tests

- `apps/web/test/proxy.test.ts` — the rules that decide whether and at what
  size: aspect and even dimensions, no upscaling a small source, the height and
  file-size thresholds, stills and audio never proxied, and the bitrate floor.
- `apps/web/e2e/proxy-media.spec.ts` — a 720p import genuinely edited against a
  540p copy stored under its checksum; the preview still painting through the
  proxy; the toggle surviving a reload; Clear deleting the files; and the export
  reading the original.

That last one is the test worth reading. Sharpness is measured on the exported
file — mean edge energy of one frame at native size — with proxies on and again
with them off, and the two must agree within 5%. The tolerance is calibrated
rather than guessed: with the `renderOriginals` guard removed the same two
measurements come out 10% apart, so the assertion fails exactly when it should.
An earlier version of this test compared the export against the proxy file
directly and passed either way — a rescale in the measurement path had blunted
the only difference it existed to see.

## Not built

- Proxies carry no audio, which is why playback stays on the original. Adding
  it means decoding the source's audio, and `decodeAudioData` wants the whole
  track in memory — the ceiling this feature exists to lift.
- No "proxy this folder" batch job, and no way to build proxies for footage
  below the thresholds on request.
- The proxy store is never pruned automatically; Clear is the only eviction.
