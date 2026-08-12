# Keywords and saved views

Final Cut's keywords are how a large shoot becomes findable, and Smart
Collections are how a way of looking at it gets reused. Both, scaled to a
personal editor. Added 2026-08-08.

## One keyword, one spelling

Everything here turns on a single rule: `Interview`, `interview` and
` interview ` are the same keyword to a person, so they must be the same
keyword to the filter. Without it a bin fills with near-duplicates that each
match half the footage.

`normalizeKeyword` trims, collapses inner whitespace and folds case.
Normalization happens at the **UI boundary**, and the schema *refuses* anything
unnormalized rather than fixing it — a command that silently rewrote its own
payload would not replay to the bytes it recorded, which is the property the
whole engine rests on.

Stored sorted, so two orders of the same set are one project rather than two
byte-different ones.

## One command, whole list

`asset.set_keywords` replaces the list; an empty list clears it and the reducer
removes the member rather than storing `[]`, because canonical JSON treats those
as different projects. Whole-list rather than add/remove makes the inverse exact
and makes one undo match one gesture.

## What is project state, and what is not

| Thing | Where it lives | Why |
| --- | --- | --- |
| Keywords | Project state, via a command | They describe the media, travel with the project, and undo |
| Search text, keyword picker, rating filter | Session state | They describe how someone is looking at the bin right now |
| Saved views | `localStorage` | A named way of looking — personal to the machine, not part of the project |

A saved view is a name plus search, keyword and rating filter. Final Cut's
Smart Collections in miniature, deliberately outside the operation log: nothing
about a saved view changes what would be rendered or exported.

## Details worth keeping

- **Search covers keywords, not only names.** Typing "interview" should find
  the shots tagged that way, not only a file that happens to be called it.
- **The keyword picker lists what the project actually has.** Removing the last
  use of a keyword drops it from the list, so it cannot linger as a selectable
  dead end that always shows an empty bin.
- **A chip toggles.** Clicking a keyword on an item filters by it; clicking the
  same one clears the filter.

## Tests

- `packages/project-schema/test/keywords.test.ts` — normalization, refusal of
  unnormalized or duplicate entries, optionality on the asset.
- `packages/editor-state/test/keywords.test.ts` — set, replace, clear to an
  absent member, sorted storage, unknown asset, byte-exact undo and replay.
- `apps/web/e2e/keywords.spec.ts` — tagging through the real control with mixed
  case and doubled spaces, filtering by picker and by chip, search reaching
  keywords, a saved view restoring all three at once, and a keyword vanishing
  from the picker once nothing uses it.

## Not built

~~**Keyword ranges**~~ — built since, once browser ranges gave it the selection
half it was waiting on. See [keyword-ranges.md](keyword-ranges.md). Search, the
picker and the chips here all reach range keywords too.

Still absent: keyword hierarchies, and smart collections that update from a
query rather than from a saved filter.
