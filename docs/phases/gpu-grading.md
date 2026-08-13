# GPU colour grading

The first GPU code in the project. A pointwise grading stack is applied by the
graphics card instead of pixel by pixel on one thread. Added 2026-08-13.

## Why the colour table was the place to start

There was no GPU code at all: no WebGL, no WebGPU, and no `crates/render-engine`
— that crate is in the roadmap's planned layout and was never created. Every
grading effect, mask rasterisation and artistic pass is `getImageData` → JS loop
→ `putImageData` on one thread.

Rewriting all of that as shaders is a large, risky project. But `isLutable`
already collapses a stack of pointwise effects into a single 33³ colour table,
leaving exactly one operation per pixel: a trilinear lookup. And a trilinear
lookup is what sampling hardware *is* — a `sampler3D` with `LINEAR` filtering
does in one fetch what `applyLut3d` does with eight reads and seven
interpolations.

So the smallest possible change captures most of the win:

- **The table is still built on the CPU**, by the same code as before. 36k
  evaluations regardless of image size, and nothing is reimplemented, so the two
  paths cannot drift apart in what they compute.
- **Only the per-pixel part moves** — the part that grows with resolution.

The two grading effects that read a pixel's neighbours, Presence and Noise
Reduction, cannot be reduced to a table and are untouched.

## Measured, on real hardware

Apple M4 via ANGLE's Metal backend, applying a three-effect table:

| | CPU | GPU | |
| --- | --- | --- | --- |
| 1080p | 68.6ms | 7.3ms | 9.4× |
| 4K | 301.0ms | 32.9ms | 9.2× |

The GPU figures include uploading the source and reading the result back, which
the app itself does not pay — in place it draws straight to a canvas.

**This had to be measured headed.** Headless Chromium runs WebGL2 on
SwiftShader, a software rasteriser, so a timing from the e2e run would describe
a CPU pretending to be a GPU. The e2e proves the *picture*; the speed claim
comes from a separate headed run and is quoted as a measurement of one machine,
not a promise about every machine.

## Falling back is the normal case, not the error case

`createGpuLutRenderer()` returns `null` for anything it cannot establish — no
WebGL2, a shader that will not compile, a link failure — and `apply()` returns
`null` if the draw errors. Both mean "use the CPU path", which is complete and
correct on its own. Nothing here can produce a wrong picture; it can only
decline to produce one.

The renderer is built once and the result cached, including the `null`: a
machine without WebGL2 will not grow it, and retrying per frame would cost a
context creation per frame on exactly the machines least able to afford it.

The graded canvas is **copied out** rather than returned. The renderer draws
into one canvas it reuses, and `gradeCache` keeps what it is handed, so
returning it directly would make every cached grade alias the most recent one.

## The tolerance was the bug

Recorded in `LESSONS.md` and worth repeating here, because it nearly shipped a
broken shader behind a green suite.

The parity spec allowed a per-channel difference of 4, on the reasoning that
texture filtering rounds differently from float64. That reasoning was never
checked. One cell of a 33-sample axis is 255/32 ≈ 8 levels, so a **half-texel
lookup skew is also ≈4** — the bound and the defect were the same size. Deleting
the `+ 0.5` from the shader left every check passing.

Measured, the correct shader agrees *exactly*: max 0, mean 0 across 49,152
channels. The bound is now 1, and the mutation fails.

Two things generalise. Only the **identity table** check caught it — a strong
grade compresses a lookup error below the noise floor, while identity has slope
1 and shows it at full size, so a transform's test suite should include the case
where the transform does nothing. And the mutation is what exposed the weakness:
the spec read as rigorous and was not.

## Where the test hook lives

`apps/web/gpu-lut-harness.html`, a dev-only page. The parity check needs both
appliers and nothing else — no editor, no project, no media — so giving it its
own page keeps test scaffolding out of `main.ts` entirely. Vite's dev server,
which is what the e2e run uses, serves it. The harness calls `raster-tools`'
grading functions directly rather than `main.ts`'s `gradeImage` dispatcher,
because importing that would boot the whole editor to build one table.

## Tests

- `apps/web/e2e/gpu-lut.spec.ts` — GPU and CPU agree on a single grade and on a
  stack; an identity table is a no-op; the picture is not flipped, mirrored or
  offset; and WebGL2 is asserted present so the rest cannot pass by falling back
  and comparing the CPU with itself.
- The existing 25 grading e2e (`grading`, `lightroom-panels`,
  `adjustment-layer`, `curves`) now run *through* the GPU path and are the real
  regression proof. `adjustment-layer.spec.ts`'s "grading through the lookup
  table matches grading directly" is the app-level form of the same claim.

## Not built

- **Masked grades**, which are excluded from the table path anyway because a
  mask makes the result depend on where a pixel is.
- **Artistic passes, mask rasterisation, Presence and Noise Reduction** — all
  still CPU. These are neighbourhood operations and each needs its own shader,
  not a lookup.
- **WebGPU.** WebGL2 is available far more widely today and was enough here.
