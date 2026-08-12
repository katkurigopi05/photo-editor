# Auto-scaling

The editor is open source and runs on hardware nobody here has seen, across
three operating systems and several browsers. This makes the preview find its
own level on whatever machine it lands on: a weak device stays usable, a strong
one is actually allowed to be strong. Added 2026-08-11.

## Measure the machine, do not ask it

The first version of this budget was chosen from `navigator.hardwareConcurrency`.
That is a poor proxy for everything that matters:

- it counts cores for a loop that uses **one**;
- it says nothing about the GPU, the memory bandwidth, or thermal state;
- Safari may not report it at all;
- two machines with eight cores can be a decade apart.

So the device's own report is now only the **opening guess** — it picks which
rung to start on, because a guess makes a better first frame than the middle of
the ladder. From the second frame onward the frames themselves decide.

## A ladder, not a dial

Quality is five discrete rungs, from 640×360 to 2560×1440 pixels of CPU grading
per preview frame. Discrete because a continuous dial would retune every frame
and never settle, and because the visible difference between neighbouring rungs
is small enough that a step is not jarring.

## Not oscillating is the hard part

Every change is a visible resolution change, so a controller that flaps is worse
than one that guesses badly and holds still. Three things prevent it:

- **Hysteresis.** Quality steps *down* when the median frame exceeds the target,
  but *up* only when it is under **half** the target. With a single threshold, a
  machine sitting near it would step down, become fast, step up, become slow,
  and loop forever.
- **A cooldown.** After a change, no further change is considered for 24 frames,
  so a step has time to show up in the measurements it caused. Without it a full
  window arrives every frame after the first and the level walks the whole
  ladder in moments.
- **The median, not the mean.** One 200 ms frame from a garbage collection or a
  video decode hitch is not evidence about the machine.

The test that matters most closes the loop: it makes the simulated frame cost
*proportional to the budget in play* — exactly the feedback that causes flapping
— runs 3000 frames, and asserts the level visits precisely one rung after
settling.

## What is measured, and what is not

Only the layer-painting pass is timed. The canvas resize and the scope pass are
not what the budget controls, and including them would make the controller chase
costs it cannot change.

Only frames that **actually graded** are sampled. A frame with nothing to grade
is fast for reasons that say nothing about the machine, and counting it would
push quality up right before the first expensive frame arrived.

## What auto-scaling never touches

**Export.** A render must be deterministic and full quality whatever machine
produced it; a file whose quality depended on how busy a CPU was would be
indefensible. Export passes no budget at all.

Ordinary clips are also unaffected — they grade at their media's own resolution
and cache the result, so their cost follows the footage, not the preview. The
budget exists for one path: an adjustment layer grades the live canvas every
frame and cannot cache, because the source changes on every repaint.

## The override

Auto can be overruled from **Export → This device**: Auto, Low, Medium or High.
Measurement cannot know intent — someone grading a still wants the best preview
their machine can manage even if it costs frames, and someone on battery may
want the opposite. A pinned preference is an instruction, not a hypothesis, so
no samples are taken while one is in force.

The setting is machine-personal, like the theme and saved views, so it lives in
`localStorage` and not in the project file. An e2e checks it survives a reload.

## Tests

- `apps/web/test/adaptive-quality.test.ts` — stepping down, stepping up,
  reaching and stopping at both ends of the ladder, ignoring a single slow
  frame, refusing to climb merely for being under target, the cooldown limiting
  how often it may change, the closed-loop anti-flap simulation, nonsense
  samples, and needing a full window before deciding anything.
- `apps/web/test/capabilities.test.ts` — the budget helpers, including that they
  do not depend on the display.
- `apps/web/e2e/adjustment-layer.spec.ts` — the budget does not change what the
  grade *does*, the report states the current level, pinning works, and the
  preference survives a reload.

## Not built

- **Adapting anything but preview grading.** Decode, export and the raster
  session are untouched.
- **Reacting to thermal or battery state.** The Battery API is unavailable or
  fingerprint-restricted in most browsers; measuring the frames covers it
  indirectly, since a throttled machine simply gets slower and steps down.
- **A GPU path.** Auto-scaling makes a slow machine cheaper; it does not make a
  fast one faster. That is step P5 — WebGL2/WebGPU shaders for the grading
  pipeline, with this CPU path as the fallback.
