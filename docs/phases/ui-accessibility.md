# Layout under pressure, and reach without a mouse

An outside review scored the project down for UI limitations. The criticism
named Tkinter, which is the *superseded* Python prototype rather than the
shipping surface — but auditing the web app against the same standard found
three real gaps, none of which any test covered. Fixed 2026-08-07.

## What the audit found

Measured, not assumed:

| Check | Before |
| --- | --- |
| Width breakpoints in the stylesheet | **none** — the two `@media` rules were `prefers-color-scheme` and one motion rule |
| `:focus-visible` rules | 4, in ~1,900 lines |
| `prefers-reduced-motion` coverage | the mode wheel only |
| Page heading (`<h1>`) | none |

## The layout took its pixels from the wrong panel

`#workspace` was `264px 1fr 328px`: fixed sidebars, flexible middle. Narrowing
the window therefore took every pixel out of the **stage**, the one panel the
work happens in. At 768px the picture was a 110px sliver with two full-width
sidebars beside it — technically no overflow, practically unusable.

Now the sidebars give ground first (232/288 below 1400px, 200/248 below
1150px — lists and sliders lose width more gracefully than a picture does), and
below 1000px the layout stacks into one column with the stage first and the
panels capped at 40vh beneath it.

## Focus was invisible

Four components styled a focus ring; every other button, select, slider, chip
and clip showed the browser default, which against these panel colours is often
nothing at all. One `:where(...)` baseline now covers every interactive element,
with the existing component rules still winning where they are more specific.

## Reduced motion meant one component

Only the mode wheel honoured `prefers-reduced-motion` — the most obviously
decorative animation — while panel transitions, hover states, toasts and the
export bar kept moving. The rule is now blanket: nothing here conveys meaning
through motion that it does not also convey through position or text.

## Also

A visually hidden `<h1>` and accessible names on the four landmarks
(`Media, looks and effects` / `Preview and transport` / `Inspector` /
`Timeline`), so the document has a title and its regions are navigable. The mode
wheel already carried `role="radiogroup"` with a label.

## Tests

`apps/web/e2e/accessibility-layout.spec.ts` pins all of it against the running
app: no horizontal overflow and the stage holding more than half the viewport at
1440, 1280, 1024 and 768; the stage ordered above both panels once stacked; a
visible outline at each of the first six tab stops; and transition durations
collapsing under `prefers-reduced-motion`.

The first run failed at 1280 and 1024 — 48.9% and 45.1% — which is why the
sidebars were tightened rather than the assertion lowered.

## Not addressed

Colour contrast is unmeasured; there is no automated axe pass in CI; and the
Python/Tkinter prototype the review was pointing at is untouched, pending the
decision on whether that track leaves this repository.
