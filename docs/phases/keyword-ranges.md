# Keyword ranges

A keyword over *part* of a shot — Final Cut's keyword range. The asset-level
list in [keywords.md](keywords.md) says "this shot is an interview"; a range
says "seconds three to nine are the good take", which is the unit a long take is
actually searched by. Added 2026-08-10.

Named as "not built" in both [keywords.md](keywords.md) and
[browser-range.md](browser-range.md), for the same stated reason: it needed a
*persisted* range object rather than the transient one the browser uses. That
object is what this step is.

## Project state, not session state — the opposite call to browser ranges

A browser range is an intention about the next edit, so it lives in a `Map`
beside the search text and dies with the session. A keyword range is the
opposite: a fact about the media. It describes what is in the footage, so it
travels with the project, undoes, and replays.

That difference decides the coordinate space too. Bounds are **source-local
microseconds** — the asset's own timeline, not a sequence position — so a range
stays true however many clips are cut from that asset and wherever they are
later moved. A range in timeline coordinates would have to be rewritten by every
move, and would be meaningless before the first clip existed.

Both are half-open, like every other range in the model: the end instant belongs
to whatever comes next, so a range ending exactly at the duration is the whole
shot.

## One keyword, one spelling — still

The range reuses `keywordSchema` rather than a copy of it. This matters more
than it looks: a range spelled `Interview` would filter as a different keyword
from the list's `interview`, and the bin would fill with exactly the
near-duplicates the normalization rule exists to prevent. `keywordSchema` is now
exported for that reason.

## Three commands, one inverse

Add, update and remove rather than the whole-list shape `asset.set_keywords`
uses. Ranges are objects built up one at a time over a long take, not a handful
of strings replaced in one gesture, so naming the range keeps the operation log
readable — "moved the good take", not "set eleven ranges".

The **inverse still carries the whole list**, the bargain markers and masks
already strike: the list is small, and carrying it entire buys exact undo
without a reconstruction rule per command — including the difference between "no
ranges" and "an empty list", which canonical JSON treats as different projects.

Stored sorted by start, then keyword, then id, so two orders of the same set are
one project rather than two byte-different ones.

## Where each rule is enforced

| Rule | Enforced in | Why there |
| --- | --- | --- |
| Keyword is normalized | Schema | Same rule, same place, as the asset list |
| `endUs` after `startUs` | Schema | Visible inside one payload |
| Ids unique on an asset | Schema | Visible inside the list |
| Range fits the media | Reducer | Needs the asset's duration |
| A *patch* still leaves a forward range | Reducer | Needs the bound the payload omitted |

The last row is the one worth keeping. An update carrying only `endUs` cannot be
judged on its own — the schema never sees the `startUs` already stored — so the
reducer checks the **merged** range, not the payload. A test covers exactly
that, because it is the case a payload-only check would pass.

Media with no duration — a still — is refused outright rather than treated as
zero-length, which would produce the same error with a far more confusing
message. It matches the browser range's rule that only media with a duration
gets the control: a still has nothing to choose.

Overlap is allowed, deliberately. Two keywords over one stretch is ordinary, and
so is the same keyword twice where a take was marked in two passes. Merging them
would rewrite the payload the command recorded, which is the property replay
rests on — a UI may offer to merge, the schema does not do it behind the
caller's back.

## A trap in the schema

`.refine` runs **even when the object's own members came back dirty**. The first
version compared bounds with `BigInt(r.endUs)`, which throws a `SyntaxError` on
`"3.5"` — so a `safeParse` that is supposed to return a result would instead
throw, on input the regex had already rejected. Canonical decimal strings
compare by length then lexicographically, which is total and never throws; that
is what `isBeforeCanonical` does, and the "rejects non-canonical microseconds"
test is what caught it.

## The bin surface

Tagging happens **inside the range editor**, as a third button beside "Use
range" and "Whole clip". The transient range and the persisted one are the same
gesture — "this bit, right here" — and the sliders are already open and already
pointed at the span, so a separate editor would have been a second way to say
the same thing.

Each tagged range shows as a chip under the item. Clicking one **loads it as the
browser range** rather than filtering by it: that is the point of having tagged
it, so "the good take" becomes the next thing added in one click. Filtering is
what the picker and the search box are for, and both now reach range keywords —
a shot with an interview *in* it is a shot someone searching "interview" is
looking for, and a keyword that only ever named a range still belongs in the
picker.

Normalization happens at this boundary, exactly as `editKeywords` does it: the
schema refuses `Good Take` rather than quietly folding it, so the prompt folds
it or the command is rejected.

## Two layout regressions the screenshots caught

Neither was visible to any assertion, and this is the second feature in a row
where that was true — see the same section in
[browser-range.md](browser-range.md).

**The chips wrapped inside themselves.** Placed in the meta column, each chip
became a tall vertical pill reading `go` / `00:` / `00:` stacked, and their
min-content width propped the column open until the filename collapsed from
`motio…` to `m…`.

Adding `white-space: nowrap` fixed the pills but not the cause. Measuring in the
browser found it: **`.media-meta` is about 54px wide in a 234px item** — the
thumbnail, the add glyph and the action buttons take the rest — so a chip inside
it truncated to `go…` no matter how it was styled.

The fix is the escape the range editor already makes: the chip row is appended
to the *item* rather than to `meta`, with `flex-basis: 100%` and
`flex-wrap: wrap` on the item, so it gets its own full-width line. The filename
now reads *better* than before the feature (`motion-1280x720…` rather than
`motio…`), because the item wraps and the meta column relaxes.

## Tests

- `packages/project-schema/test/keyword-ranges.test.ts` — normalization reuse,
  refusal of empty and backwards ranges, non-canonical microseconds, duplicate
  ids, permitted overlap, optionality on the asset.
- `packages/editor-state/test/keyword-ranges.test.ts` — add/update/remove,
  sorted storage and re-sorting after a move, the merged-range check on a
  partial update, bounds against the duration, the exact-duration boundary,
  media with no duration, unknown asset and unknown range, byte-exact undo for
  all three commands, and replay.
- `packages/mcp-server/test/tool-coverage.test.ts` — already existed, and is
  what caught the three missing MCP tools: it asserts one tool per public
  command in both directions.
- `apps/web/e2e/keyword-ranges.spec.ts` — tagging through the real sliders with
  a mixed-case keyword, the exact bounds read from `data-start-us` rather than
  from the rounded label, undo and redo, clicking a range to load it and then
  proving the *next add* is two seconds rather than five, search and picker
  reaching a keyword that names only a range (with a negative case, so a filter
  being ignored cannot pass), removing one range and leaving the other, and an
  all-whitespace keyword refused.

## Not built

Ranges do not propagate to a clip cut from a ranged region — the range stays a
fact about the asset, and nothing reads it at edit time. Editing a range's
bounds after the fact has a command and an MCP tool but no control: the chip
removes, and re-tagging is the way to move one.

Also absent, and unchanged from [keywords.md](keywords.md): keyword hierarchies,
and smart collections that update from a query rather than a saved filter.
