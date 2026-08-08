# Browser ranges

Choosing which part of a shot you want *before* it reaches the timeline, rather
than adding the whole thing and trimming it back — Final Cut's browser range.
Added 2026-08-08.

## Session state, deliberately

A range is an intention about the next edit. Once a clip exists, that clip's own
`sourceInUs`/`sourceOutUs` are the record, and the bin's opinion is spent. So
ranges live in a `Map` beside the search text and the rating filter, not in the
project:

- nothing about a range changes what would be rendered or exported;
- a range that survived a reload would silently alter the next add long after
  the person who set it had forgotten;
- and every add path — clicking an item, dragging to a lane, the timeline's own
  add button — reads it through one function, so they cannot disagree.

`rangeFor()` also ignores a stored range wider than the asset rather than
handing the reducer a window it would refuse.

## The editor

Two sliders over the asset's own duration, opened from the item and closed by
the same button. Sliders rather than a scrubbing preview: the bin is a list, and
a second video element per row to scrub with would cost far more than the choice
is worth.

Two rules in the pair: In and Out cannot cross — dragging one past the other
pins it — and a range keeps at least a millisecond of picture, because an empty
selection is not a selection. The slider step is a millisecond, already finer
than a frame at 60fps and a thousand times coarser than the microsecond model,
which is the right place to stop.

Only media with a duration gets the control. A still has nothing to choose.

## Tests

`apps/web/e2e/browser-range.spec.ts`:

- a range decides the added clip's length;
- **the range is a window, not a length** — the added clip's first frame matches
  the source at three seconds and not the source at zero. The first version of
  this test asserted the duration again while claiming to prove the in-point,
  which would have passed for a clip that started at zero and merely ran short;
- "Whole clip" clears it;
- In pinned short of Out when dragged past it.

Clip elements now carry `data-duration-us` so a test can assert what a range
produced instead of inferring it from pixel width.

## Not built

Keyword *ranges* — a keyword over part of a clip — still need a persisted range
object rather than this transient one, which is a schema and a command, not a
slider. Also absent: in/out set from the keyboard (I and O) while scrubbing a
preview of the browser item, and multiple ranges per asset.

## A layout regression the screenshot caught

The range button and the keyword button were given `.media-remove` for its
shape, which also gave them its danger colour — a keyword button that turns red
on hover reads as "delete". And three loose buttons in a 264px sidebar squeezed
the filename down to `mot…`.

Both were visible only in the manual screenshot; no assertion covered them. The
buttons now share a `.media-action` shape, `.media-remove` keeps the danger
colour to itself, and the row's buttons live in one group so the name keeps its
width.
