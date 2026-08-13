# Lessons

Append short entries only for real mistakes. Format: what broke, root cause, fix.

## 2026-07-19: rustup component flag
Wrong: `--component clippy rustfmt` (rustfmt parsed as second toolchain arg, crashed).
Fix: `--component clippy,rustfmt`.
Why: `--component` takes ONE value. Comma-separate multiple.

## 2026-07-19: background removal wiped whole photo
Wrong: default color-key tolerance 0.28 (28% of RGB-cube diagonal) — only worked on synthetic high-contrast test images.
Fix: tolerance 0.12, softness 0.10.
Why: never validated defaults against a realistic photo, only a synthetic test case.

## 2026-07-19: onnxruntime-web wasm load failed twice
Attempt 1: copied wasm/mjs into `/public/ort/`, set path prefix string — Vite dev server blocks dynamic import() from `/public`.
Attempt 2: removed override, let library self-resolve — path 404'd to SPA fallback HTML, WASM instantiate failed on bad magic bytes.
Fix: `ort.env.wasm.wasmPaths` accepts `{ wasm, mjs }` object form; resolve exact URLs via Vite's `?url` import suffix.
Why: didn't check the library accepted an object form before working around it twice.

## 2026-07-19: drag-and-drop broken in Photo mode
Root cause: earlier fix hid `#timeline` via `display:none` in Photo mode, removing the only drop target — a *side effect* of an unrelated UI change, not caught because drag-and-drop wasn't retested after that change.
Fix: added equivalent drop target on `#stage`.
Why: changing visibility of a UI element removed functionality attached to it. Retest adjacent features after hiding/removing DOM, not just the one you changed.

## 2026-07-19: drop overlay stuck visible after drop
Root cause: stage/lane drop handlers called `stopPropagation()` (needed to avoid double-import via window fallback handler), which also blocked the window handler's overlay-hide code from running.
Fix: lifted `hideDropOverlay()` to module scope, called explicitly from every drop handler, not just the window-level one.
Why: `stopPropagation()` silences ALL downstream listeners, not just the one causing the problem you're avoiding. Check what else depends on the event you're stopping.

## 2026-07-20: WebCodecs H.264 level too low for 1080p export
Wrong: codec string `avc1.42001f` (Baseline, level 3.1) — level 3.1 caps coded area at 921,600px, below 1920x1080's 2,073,600px. VideoEncoder threw at configure/encode time.
Fix: `avc1.420028` (Baseline, level 4.0 — max 8192 macroblocks, covers 1080p).
Why: never checked the AVC level table against the actual export resolution before picking a codec string off an example.

## 2026-07-20: VideoEncoder/AudioEncoder `error` callback doesn't propagate via throw
Wrong: `error: (err) => { throw err; }` inside `new VideoEncoder({...})` — this callback fires from the codec's own internal task, not from code we called, so the throw never reaches the surrounding `try/catch` in the async export function. The error printed to the console but the export loop kept running as if nothing failed.
Fix: record the error in a local variable from the callback, check it explicitly after every `encode()` call and after `flush()`, and throw from the calling code where `try/catch` actually applies.
Why: assumed a callback's `throw` behaves like a synchronous throw. It doesn't — check where an async callback actually executes before relying on exceptions to cross that boundary.

## 2026-07-20: headless-browser audio playback verification gave a false negative
Symptom: exported MP4 with a real Opus audio track measured as silent (`maxAudioSignalDeviation: 0`) via `<video>` + `createMediaElementSource` + `AnalyserNode` in a fresh Playwright page, even with a real click as a user gesture first.
Root cause (most likely): Chromium's autoplay-audio policy or a headless-specific audio-subsystem quirk, unrelated to the exported file — confirmed by parsing the MP4's actual box structure (`stsd`/`stsz` under the `soun` track): a real `Opus` sample entry, 201 samples, 64,841 bytes, exactly matching the encoder's own chunk count/byte total logged during export.
Fix: don't trust headless `<video>` playback + Web Audio analyser as ground truth for audio-in-container correctness. Parse the container's actual box structure instead (sample count, codec fourcc, total sample bytes) — it's playback-policy-independent and catches the same class of bug (or lack thereof) more reliably.
Why: a failing *verification method* looks identical to a failing *feature* from the outside. When a live-test result contradicts direct instrumentation of the code under test (render output RMS, encoder chunk counts), trust the instrumentation and treat the test method itself as a suspect, not just the code.

## 2026-08-03: stale workspace `dist` is invisible to the whole test suite
Symptom: app died at load with `does not provide an export named 'buildSetClipTransition'` while all 385 vitest tests were green.
Root cause: `vitest.config.ts` aliases `@director/*` to each package's `src/`, but the Vite dev server resolves those same specifiers to `dist/`. A new export existed in `src` and not in the built `dist`, so tests exercised code the browser never received.
Fix: `pnpm build` after changing any workspace package's public surface, before any live/browser check.
Why: the test suite structurally cannot catch this class of bug — it never reads `dist`. Treat "tests pass" as saying nothing about what the browser loads, and run the app after touching a package's exports.

## 2026-08-03: GIF export silently destroyed opacity, then silently destroyed transparency
Symptom 1: a clip animated with `transform.opacity` exported to GIF with no fade at all — one black frame, then full brightness. MP4 was correct.
Root cause 1: GIF stores 1 bit of alpha. Partial alpha lived only in the alpha channel, which the encoder discarded while keeping RGB at full strength.
Fix 1: `flattenPartialAlpha()` premultiplies partial alpha against black (matching what the MP4 encoder does with the same canvas) and leaves alpha 0 alone.
Symptom 2: separately, `fx.remove_background` output exported as a black rectangle.
Root cause 2: `createGifEncoder` never passed gifenc's alpha options — `quantize` defaulted to `rgb565` and `writeFrame` never got `transparent`/`transparentIndex`, so keyed-out pixels took whatever colour sat in that palette slot.
Fix 2: pick `rgba4444` + `oneBitAlpha` per frame *only when the frame contains alpha-0 pixels* (rgba4444 is 4 bits/channel, visibly worse than rgb565 — don't make opaque frames pay for it), then key out the transparent palette index.
Why: both were found only by decoding the exported artifact and measuring it, never by unit tests. When an export path targets a format with less fidelity than the canvas (1-bit alpha, 256 colours), verify what survives the encode rather than what was drawn. Also: when checking whether a change broke something, A/B it — the transparency loss looked like a regression from Fix 1 until disabling Fix 1 reproduced it exactly.

## 2026-08-09: three ways to test an instrument and measure nothing
Symptom: the first draft of `meters-scopes.spec.ts` — audio meter, video scopes — had two assertions that could not fail and one fix that fixed nothing.
Root cause: (1) meter "ink" was counted with a brightness threshold, but the meter's empty track is drawn opaque, so the count was identical playing or silent — the test passed against a meter wired to nothing. (Weighting by alpha fixed it only until the track was recoloured to a theme variable, which is the tell that the metric was wrong rather than mistuned; it now diffs the canvas against a silent baseline.) (2) The vectorscope was judged by how far its trace sat from the centre; when a trace collapses the pixels still lit are the *graticule*, which sits at a large radius, so desaturating the picture appeared to increase spread. (3) A change was written to force filter effects through the pixel pass, assuming a CSS filter never reaches the canvas a scope reads.
Fix: measure what a working instrument does — *change* — rather than how bright it is; assert on the number the scope reports rather than on its drawing; and probe the third assumption before keeping the change — filters are drawn *into* the canvas, the scope already agreed with the picture, so the change was reverted.
Why: an instrument is exactly the kind of feature whose test passes while it reports nothing, so every check has to move the signal and prove the reading moved. And a fix for a bug nobody demonstrated is a guess — the probe cost one throwaway spec and saved making every graded preview slower.

## 2026-08-09: a seek that never lands waits forever, and takes the queue with it
Symptom: none in the wild — found reviewing the proxy media diff, before it could bite.
Root cause: `seekTo` in `proxy.ts` and `seekVideoFrame` in `main.ts` both resolved only from a `seeked` listener. A seek has no failure event: an element that stops decoding part-way simply never fires one. In `proxy.ts` that cost more than the one build, because builds are queued one at a time — a single wedged file would silently stop every later proxy in the session, with the status line frozen on a percentage that never moved again.
Fix: cap both waits, with the expiry behaviour chosen per caller. `seekTo` resolves false and the build ends the way its other failures already do, editing against the original. `seekVideoFrame` throws, because an export that resolves on whatever frame was last presented writes a quietly wrong file — the failure this project has already shipped twice.
Why: the absence of an event is not an error you can catch, and no `await` on a media element should be unbounded. Also worth copying: the regression test was checked by reintroducing the bug, and it did not fail, it hung — proving both that the test reaches the defect and that the defect's real symptom is a hang, not an exception.

## 2026-08-08: two features decoding the same file starved each other
Symptom: the existing e2e "MP4 export of a video clip writes distinct frames" went red the moment proxy media landed — the exported file was one picture repeated. No error anywhere.
Root cause: two separate faults with the same shape. (1) The proxy build seeked the *cached* video element, which is also the element the preview and the export seek; each one's seeks landed in the other's frames. (2) After giving the build a private element, running a build and an export at once starved the export's seeks, so `seekVideoFrame` resolved on the frame already up and the encoder got the same picture over and over.
Fix: build proxies through a private element, and pause building for the duration of an export (`exportActive`), resuming afterwards.
Why: a stale seek is invisible — nothing throws, nothing warns, the file is simply wrong. Any second feature that decodes video by seeking an element is competing for the same decoder, so it needs its own element *and* a rule about who runs when. Note also which test caught it: an old export test, red only because its fixture became large enough to qualify for the new feature. New features change the conditions old tests run under.

## 2026-08-12: overlapping e2e runs hid two real regressions
Wrong: started a full Playwright run while another was still in flight, three times, and piped each to `tail -8`.
Fix: check `pgrep -f playwright` and port 5199 are clear before starting; never pipe test output — the pipe's exit code is what gets reported.
Why: `playwright.config.ts` uses a fixed port with `strictPort` and `reuseExistingServer` locally, so a second run reuses the first's dev server and the first tears it down on exit, killing the other mid-flight. The results looked like failures (24 in one run) and like passes (`tail` exits 0 whatever Playwright did), so three commits were reported as verified when they were not — and the noise masked two genuine regressions in `audio.spec.ts` and `import-checksum.spec.ts` for several commits. Verification that cannot be trusted is worse than none: it still looks like coverage.

## 2026-08-12: tests read the history panel's prose
Wrong: `audio.spec.ts` and `import-checksum.spec.ts` asserted on the history panel's text to prove a command reached the engine, matching raw types like `timeline.add_effect`. Rewriting the panel to show human labels broke both at once.
Fix: entries carry `data-command-type`; the probes read that.
Why: an assertion about *engine behaviour* was coupled to *display wording*. When a UI string is the only handle a test has on a fact, give the fact its own handle.

## 2026-08-12: a double-click listener on a node its own first click destroys
Symptom: `dblclick` on a compound clip never opened it. The button beside it worked, so the feature was fine and only the idiom was broken.
Root cause: pressing a clip selects it, which calls `updateUI()` and rebuilds every clip element. By the second press the element that received the first is gone, so the browser sees two clicks on two different nodes and never pairs them into a `dblclick` at all — not a swallowed event, an event that is never synthesised.
Fix: detect it in the existing pointerdown handler, keyed on the clip **id** and a timestamp. The id survives the re-render; the element does not. Event delegation would not have helped, because dispatch still depends on the hit target being the same node.
Why: any gesture assembled from two events cannot be attached to a node that its own first event destroys. Worth checking wherever a handler re-renders the thing it is attached to — which in this app is most of them. Caught only because the e2e drove the real gesture; a unit test of the open function would have passed.

## 2026-08-13: a tolerance argued for instead of measured, sized exactly like the bug
Symptom: the GPU/CPU colour-table parity spec passed with the shader's half-texel offset deleted — the one error it was written to catch.
Root cause: the tolerance was reasoned to, not measured. "Texture filtering rounds differently from float64, call it 4 levels" sounded careful and was never checked. But one cell of a 33-sample axis is 255/32 ≈ 8 levels, so a half-texel lookup skew is also ≈4. The bound and the defect were the same size, so the test could not tell them apart.
Fix: measure first. The correct shader agrees exactly — max 0, mean 0 over 49,152 channels — so the bound became 1, four times below the defect. Then re-run the mutation and confirm it fails.
Why: a tolerance is a claim about noise, and a claim about noise needs a measurement, not an argument. Two further things worth copying. The mutation is what exposed it — the spec looked rigorous and was not, and only breaking the code on purpose showed which assertions had teeth. And of five checks, only the *identity table* caught it: a strong grade compresses a lookup error below the noise floor, while identity has slope 1 and shows it at full size. When testing a transform, include the case where the transform does nothing.

## 2026-08-13: a guard that matches too much stops being a guard
Symptom: the pre-flight check before every Playwright run — `pgrep -f playwright` — started reporting BUSY with no test running, and port 5199 free.
Root cause: `.codex/config.toml` registers `@playwright/mcp` as an MCP server for Codex, so a long-lived `npm exec @playwright/mcp@latest` process now always matches `-f playwright`. The guard was written against the word, not the thing.
Fix: match the runner (`pgrep -f "playwright test"`), and keep the port check, which is the resource actually contended.
Why: this is the failure mode that makes safety checks worse than none. A guard that fires when nothing is wrong trains you to bypass it, and the one time it is right you bypass it too. Match the narrowest thing that identifies the hazard — here, the test runner and the port — not a substring that happens to appear in it.

## 2026-08-13: an even number of passes hid the bug the test was for
Symptom: `gpu-lut.spec.ts` gained a three-pass identity-chain check whose comment said it caught orientation errors in the ping-pong. Mutating the renderer to flip on every pass left it passing.
Root cause: a stray flip adds one per pass *after the first*, so three passes add two, and two flips cancel. The test was structurally incapable of detecting the defect it documented — with an odd pass count the picture comes back upright by accident.
Fix: four passes. Three extra flips is odd, and the mutation now fails it.
Why: found only by running the mutation, not by reading the test — the comment was confident and wrong. When a check involves anything that can cancel (a flip, a negation, a swap, a double inversion), the count matters as much as the presence, and parity is exactly the kind of thing that makes a test agree with a bug. Prefer a case where the error accumulates over one where it can pair off.

## 2026-08-13: the test pattern was periodic, so it failed a working tracker
Symptom: the new optical-flow tracker recovered 3px and 8px motion exactly, and returned nonsense for 12px and 24px. It looked like the pyramid was broken.
Root cause: the synthetic test texture was a sum of sinusoids, and its dominant term had a period of about 30 pixels. A periodic pattern has many equally good matches one period apart, so a 12-pixel shift aliased onto a false match and the tracker locked to it — correctly, given what it was shown. The pattern was wrong, not the code. Replacing it with broadband value noise fixed 12px immediately.
Fix: generate test imagery with no period — value noise over several octaves, smoothstep-interpolated. Also uncovered two real bugs once the pattern stopped lying: a 21×21 window does not fit a 25×20 coarse pyramid level (it is nearly all clamped border), and 12 solver iterations were too few, which showed up as a *narrow* failure — 20,16 and 24,8 both worked while 24,16 converged to a local minimum.
Why: when a measurement tool is being tested against synthetic input, the input is part of the test and can be the thing that is wrong. Symmetry and periodicity are the usual culprits — the same shape as the `isPointwise` reversal that a symmetric blur defeated, and as the even pass count that let a stray flip cancel itself. Ask what property of the *fixture* could make a broken implementation look right, or a working one look broken.

## 2026-08-13: a difference cancels the drift, so the test could not see it
Symptom: `planStabilisation` accumulates scale in log space. Replacing `Math.log(s)` with `(s - 1)` — a real bug that makes a zoom-in and its exact inverse fail to cancel — passed all eleven tests, including the one named "averages scale multiplicatively".
Root cause: every value the planner outputs is a *difference* between the smoothed camera path and the actual one. A constant accumulation drift appears in both and subtracts out, so it is invisible in the output. That is the same mechanism that makes a steady pan survive smoothing, which is a feature — and it hides this class of bug as a side effect.
Fix: test an invariant that does not cancel. A zoom in by 1.25 twenty times followed by 0.8 twenty times ends exactly where it started, so the first and last corrections must be equal. Correct: 2.00613 and 2.00613. Arithmetic accumulation: 2.18147 and 1.86638.
Why: when the output is a difference, relative error is observable and absolute error is not. Ask what the code accumulates internally and whether any of it is subtracted away before anyone can see it — and if it is, find a case where the quantity has to return to a known value rather than merely stay consistent. Also note the smaller version of the same trap in the same file: the first draft checked a multiplicative quantity with an arithmetic mean, which is the exact mistake the test existed to catch.

## 2026-08-13: waiting on a toast is waiting on a surface anything can overwrite
Symptom: the first `stabilise.spec.ts` failed against a feature that worked. It clicked Stabilise, waited for the word "Analysing" to leave the page, then found zero keyframes.
Root cause: analysis takes about 30s for a 5s clip, and the proxy builder finishes partway through and writes its own message into the same `#toast` element. The wait saw "Analysing" disappear — replaced by "Proxy ready…" — and moved on while the analysis was still running. A debug run showed the feature completing correctly at 30.3s with 150 keyframes.
Fix: wait on the keyframes. `waitForFunction` on `.clip-keyframe-marker` exceeding its starting count, with a timeout matched to the measured 30s rather than guessed.
Why: a toast is a single shared slot with a timer on it, so its content is neither exclusive nor durable — it is a status display, never a signal. Wait for the thing the test is actually claiming happened. The same reasoning rules out waiting on a spinner, a progress line, or anything else a later event may reuse; and note the timeout was set from a measurement, because "it seemed slow" would have picked 5s and failed intermittently forever.
