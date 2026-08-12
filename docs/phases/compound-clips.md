# Compound clips

A clip that plays a whole sequence. A run of clips becomes one thing you can
move, trim, retime or grade as a unit — Final Cut's compound clip, Premiere's
nested sequence. Added 2026-08-12.

## An asset kind again

`assetKindSchema` gains `sequence`, and the asset's `originalUri` is
`sequence:<id>`. A compound clip is an **ordinary clip**, so add, trim, move,
delete, effects, masks, blend mode and animation all work on it and no reducer
learned a new case. The same shape that worked for adjustment layers.

The schema already allowed many sequences and nothing hardcoded `sequences[0]`,
so nesting needed no new container.

## Two clocks, one difference

At a given instant the outer timeline reads `timelineUs` and the inner one reads
the compound clip's `sourceTimeUs`. The two differ by exactly that much, so
adding the difference to an inner position gives the outer one — and it keeps
working when the compound clip is trimmed or retimed, because both readings
already account for that.

The first version subtracted the wrong pair (the clip's start rather than the
instant). A test pinning *where* an inner clip lands caught it.

## Picture and sound need different shapes of that fact

The renderer resolves an **instant** — "what is live now" — so it asks the
nested sequence about a single time.

The mixdown walks tracks and schedules **spans**, so it translates each inner
clip's whole span outward and clips it to the part the compound clip actually
plays. Without that clipping, trimming a compound clip would shorten its picture
while its sound ran on underneath. A clip clipped at the front also starts later
in its own source, or the sound would be right in length and wrong in content.

## Cycles, refused twice

`compoundCycle` names the ring so the reducer can refuse to create one, and it
checks by building the project the command *would* produce rather than reasoning
about the edge being added — a ring can close several levels away, where no
single clip looks self-referential. A test builds exactly that case.

Resolution bounds its own recursion regardless. The reducer stops a cycle being
*created*; a hand-edited project file is not obliged to respect that, and a
renderer that locks up is worse than one that draws nothing.

Detection lives in `project-schema` because the reducer needs it and cannot
depend on the playback controller; resolution, which needs the timeline, stays
there.

## The bug that made the screen go black

Deep resolution returns clips from *inside* another sequence. The draw loop then
looked each one up with `locateClip`, which searches only the sequence being
edited — so every inner clip resolved to nothing and the renderer quietly drew a
black frame while the state was entirely correct.

`locateClipAnywhere` searches all sequences and the render paths use it.
Selection and the inspector deliberately still use `locateClip`: a clip you
cannot see on this timeline is not one you can select or edit here.

This is worth remembering because nothing was wrong with the model, the command,
or the resolver. The failure was one lookup with a narrower scope than its
caller, and it presented as "compound clips do not render at all".

## Making one keeps the work

`add_clip` deliberately takes no effects, animations, speed or blend mode —
those exist only through their own commands. So each is carried across
afterwards with the atomic command that owns it. Without that, compounding would
silently discard a grade, which is the kind of loss noticed much later and
impossible to undo out of. An e2e applies a Look, compounds, and asserts the
picture is unchanged.

There is no cross-sequence move command, so each clip is added to the inner
sequence and deleted from the outer one — and the delete only happens once its
copy exists. Skipping the delete on failure leaves the clip where it was, which
is recoverable; deleting anyway would lose it.

The whole run is one gesture, so it is one Undo.

## Tests

- `packages/playback-controller/test/compound.test.ts` — resolution one and two
  levels down, positions reported in the caller's timeline, and a
  self-containing sequence resolving to empty rather than hanging.
- `packages/editor-state/test/compound-guard.test.ts` — a legal nesting, a
  sequence inside itself, the ring named in the refusal, and a longer ring that
  a naive per-edge check would have allowed.
- `packages/export-engine/test/audio-plan.test.ts` — nested audio reaching the
  mixdown, placed where the compound clip sits, and clipped to what it plays.
- `apps/web/e2e/compound.spec.ts` — many clips become one, the picture is
  unchanged, a Look survives, and one Undo. The unchanged-picture check also
  asserts the frame has real variance, because two black frames are also
  "unchanged" — which is exactly how it could have passed while broken.
- `packages/project-schema/test/dissolve.test.ts` — where each clip lands, what
  a trim drops, cuts and re-sources, and each blocker. The offset was
  mutation-checked: dropping `− fromUs` still passes every untrimmed case and
  fails the front-trimmed one, which is the case that tells the two formulas
  apart.
- `apps/web/e2e/reopen-compound.spec.ts` — the timeline switches to the inner
  contents, both by button and by double-click; the breadcrumb appears only when
  there is a way back; an edit made inside lands inside and nothing leaks to the
  root; a round trip returns to the frame it started from; and undoing the
  compound while inside it steps back out. The double-click test caught the
  `dblclick`-never-fires bug above, which would otherwise have shipped.
- `apps/web/e2e/dissolve.spec.ts` — the round trip restores the clip count and
  the original starts, the picture is unchanged, it is one Undo, a grade
  survives coming back out, and a compound clip carrying an effect is refused in
  words. The grade check was mutation-checked too — with the effects carry
  disabled it fails.

## Dissolving: the way back out

Added 2026-08-12. Compounding shipped as a one-way door — a run of clips became
one clip whose contents no part of the app could reach again, which is worse
than not having shipped it.

`dissolveCompound` reuses the fact the resolver and the audio plan already use,
in the shape a *span* needs rather than an instant: the inner timeline's zero
sits at (the clip's start − its source in). So a trimmed compound clip gives
back only what it was playing. Clips outside the window are dropped, one the
trim runs through is cut, and one clipped at the front has its `sourceInUs`
advanced too — otherwise its length would be right and its content wrong, which
is the failure that looks like nothing at all.

One level. A compound clip inside a compound clip dissolves into that inner
clip, not into its contents: unpacking an unknown depth under one press is a
different and much larger action than the button implies.

### Refusing rather than quietly changing the picture

`dissolveBlockers` names every reason at once. Effects, animation, masks, a
blend mode and retiming all act on the **composite**, and none has a per-clip
equivalent — a blur over two overlapping layers is not a blur over each of them,
and nothing done afterwards recovers the difference. Naming them one at a time
would make the user discover the rules by repeated refusal.

Trims and moves are deliberately *not* blockers, because windowing expresses
them exactly.

### The order is forced, and it is the opposite of compounding's

The inner clips land where the compound clip is sitting, so the compound clip
must go first or every add is an overlap. That loses compounding's safety net
(delete only once the copy exists), so it is replaced by checking everything
before writing anything: the blockers, and that each destination track has room.
By the first dispatch there is nothing left to discover.

A destination track that does not exist is created rather than treated as a
refusal — a compound clip's audio may need a track the outer sequence lacks.

The inner sequence and its asset are left in the project. Undo restores the
compound clip, which still points at them; deleting them would make the gesture
un-undoable. Orphan sequences therefore accumulate, which is the accepted cost.

## Opening one: the editor learns it has more than one sequence

Added 2026-08-12. The inner sequence had been editable in principle since
compound clips landed; nothing could point the editor at it, because
`activeSequence()` and 63 command payloads all named a hardcoded `SEQUENCE_ID`.
"The sequence being edited" and "the project's root sequence" were the same
identifier and could not be told apart.

They are separate now. `SEQUENCE_ID` keeps its literal meaning — the sequence
`seed()` creates, used by exactly those three calls — and everything else takes
`activeSequenceId`. That is session state, like the playback position and the
raster session: where you are standing, not part of the edit, so it is not a
command and does not undo.

The refactor landed **on its own**, with nothing able to move `activeSequenceId`
off the root. That made it provably behaviour-preserving and let the existing
suite verify it (140 passed, identical), rather than shipping the refactor and
the new behaviour together, where one mis-assigned site would have been
invisible until someone stepped inside.

`sequencePath` holds the compound clips stood inside, outermost first — a path
rather than one id, because stepping out has to know where *to*, and a compound
clip can contain another.

### Two things one sequence never had to handle

- **Opening a project resets it.** Where you were standing belonged to the
  project you closed; even a colliding id is a different sequence.
- **`activeSequence()` heals itself.** The inner sequence exists because a
  command created it, so undoing far enough removes the ground you are standing
  on. Falling back to the root makes that a step outward rather than an editor
  showing nothing and refusing every command. The breadcrumb is cleared with it,
  or it would offer a way back into a sequence that is gone.

### Export follows the active sequence

All three places — the plan, the frame requests and the dialog summary. They
have to agree: a summary reporting the frame count of a sequence it is not
exporting is the shape of bug this project has already shipped twice.

### The double-click that could not work

Opening on double-click was written first as a `dblclick` listener on the clip
element, and it never fired. Selecting a clip re-renders the timeline, so by the
second press the first element is gone; the browser sees two clicks on two
different elements and never pairs them. Detection moved into `startClipDrag`,
keyed on the clip **id** and a timestamp, because the id survives the re-render
and the element does not.

Worth remembering as a class: any gesture built from two events cannot be
attached to a node that its own first event destroys.

## Not built

- **Renaming.** Every compound clip is called "Compound clip".
