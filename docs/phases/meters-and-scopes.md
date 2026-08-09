# Audio meters and video scopes

Two instruments, one argument: mixing by ear and grading by eye are both
judgements made through equipment that lies. System volume, headphones and the
room sit between the file and the ear; an uncalibrated screen and a bright room
sit between the file and the eye. Meters and scopes measure the signal instead.

Neither changes a project. They are read-only overlays over data the render path
already has, which is why they are cheap to add and why they earn their place
before anything more ambitious in colour or audio.

## The meter

Two numbers per channel, because they answer different questions. **Peak** is the
highest sample — what clips. **RMS** is the average energy over a window — what
sounds loud. A dialogue track can sit ten decibels below music on peaks and
still bury it.

- **Scale**: linear in decibels from a -60dB floor, not linear in amplitude. An
  amplitude-linear meter spends most of its length on the top six decibels and
  shows nothing at all where dialogue lives.
- **Hold**: the peak marker jumps instantly and falls 1.5dB per frame. A peak
  that lasts one frame is invisible at any sensible refresh rate.
- **Clip**: latched at -0.1dBFS, not 0. A sample that reaches full scale has
  almost certainly been flattened by whatever came before it, and a clip light
  that shows for a sixtieth of a second is a clip nobody sees. It stays lit until
  the reset button clears it.

The meter is fed by two analysers split from the monitor chain, so left and
right read separately: a mix that is loud on one side only is exactly the fault
a single combined bar hides.

It is drawn every animation tick rather than only while playing, because the
hold has to keep falling and the clip latch has to stay lit after the transport
stops.

## The scopes

Three, because they answer three different questions:

- **Histogram** — how much of the picture sits at each level. Clipping is a
  spike against either wall.
- **Waveform** — *where* those levels are, column by column across the frame. A
  blown sky and a blown highlight on a face look identical on a histogram.
- **Vectorscope** — hue and saturation as angle and distance from the centre.

All three read the preview canvas back, which is why they are off by default:
switching one on costs a readback of every displayed frame. Every ninth pixel is
sampled rather than every pixel — enough for a stable trace, cheap enough to run
on every redraw.

Each scope also prints a number beside it. A trace tells you the shape; the
readout is what you quote — clipped percentages for the histogram and the
waveform, colour cast and mean saturation for the vectorscope.

## Tests

- `apps/web/test/audio-meter.test.ts` — peak, RMS, the decibel conversion with
  silence pinned to the floor, where a level lands on the scale, the latch, and
  the falling hold.
- `apps/web/test/scopes.test.ts` — the histogram against known colours,
  transparent pixels skipped, clipping fractions, the waveform's column
  mapping, and the vectorscope's angle and radius for primaries and grey.
- `apps/web/e2e/meters-scopes.spec.ts` — both instruments against a live app.

Three of those e2e checks were wrong before they were right, and each was wrong
in the way instruments are easy to get wrong:

1. The meter's ink was measured by counting lit pixels. Its empty track is drawn
   in the theme's line colour, which is opaque, so the count came out the same
   whether the signal was at full scale or silent — a test that would have
   passed against a meter wired to nothing. What a working meter does is
   *change*, so the assertion now diffs the canvas against a silent baseline.
   Checked by disconnecting the analysers: the reading drops to exactly zero.
2. The vectorscope was measured by how far its trace sat from the centre. When a
   trace collapses, the pixels still lit are the graticule, which sits at a
   *large* radius, so desaturating the picture appeared to increase spread. The
   assertion now reads the saturation the scope reports.
3. A change was written to force filter-based effects through the pixel pass, on
   the assumption that a CSS filter would never reach the canvas the scope reads.
   Probing it showed filters are drawn *into* the canvas, the scope already
   agreed with the picture, and the change was reverted. The assumption was
   wrong and cost nothing; shipping it would have made every graded preview
   slower for no gain.

## Not built

- No LUFS or loudness-range metering, which is what a delivery spec actually
  asks for. That needs a gated integration over the whole timeline, not a
  reading of the last buffer.
- No RGB parade or waveform-per-channel; the waveform is luma only.
- Scopes measure the preview, so they measure the frame at the display's size
  rather than the source's. For judging clipping and cast that is the same
  answer; for judging noise it is not.
