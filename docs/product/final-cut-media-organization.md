# Final Cut-inspired media organization

## Capability

A personal editor can mark imported media as **Favorite** or **Rejected**, find
media by its displayed name, and filter the Media bin without changing or
removing the original file. Ratings persist in project state, travel through
the operation log, and remain exactly undoable and replayable.

This is intentionally inspired by Final Cut Pro's lightweight browser workflow,
where ratings and text search help reduce a large media set before timeline
editing:

- <https://support.apple.com/guide/final-cut-pro/find-clips-and-projects-ver65764b45/mac>
- <https://support.apple.com/guide/final-cut-pro/welcome/mac>

It is not an attempt to reproduce Final Cut Pro or its interface.

## Constraints

- `MediaAsset.rating` is optional so projects and operation logs created before
  this capability continue to parse and replay byte-equivalently.
- The only persisted values are `favorite` and `rejected`; absence means
  unrated. Clearing a rating removes the optional member rather than storing a
  third sentinel value.
- `asset.set_rating` is the only public mutation path. It validates before
  mutation and records an inverse that distinguishes an absent prior value.
- Search text and the active filter are session/UI state. They do not belong in
  the project or operation log and do not affect render or export output.
- Favorite and Rejected are mutually exclusive. Selecting the active rating
  again clears it; selecting the other replaces it in one command.
- A rejected item remains in the project and may still be used on the timeline.
  Filtering changes visibility in the Media bin only.
- Rating an asset never changes its bytes, URI, checksum, metadata, clips, or
  derived media.
- Filtering is deterministic, case-insensitive over the displayed asset name,
  and uses no locale-dependent ordering.

## Implementation contract

### Actors and surfaces

- The user rates an item from controls on each Media-bin card.
- The user searches from a Media-bin search field.
- The user filters by All, Favorites, Rejected, or Unrated.
- Empty filtered results explain that no media matches rather than resembling
  an import failure.

### State transitions

```text
unrated --Favorite--> favorite --Favorite--> unrated
unrated --Reject----> rejected --Reject----> unrated
favorite --Reject---> rejected
rejected --Favorite-> favorite
```

Every arrow is one `asset.set_rating` command and one Undo step.

### Interfaces and data

```ts
type AssetRating = "favorite" | "rejected";

interface MediaAsset {
  rating?: AssetRating;
}

interface SetAssetRatingPayload {
  assetId: string;
  rating: AssetRating | null;
}
```

The internal inverse uses the same nullable shape: `null` restores absence.

### Verification

- Schema tests cover accepted ratings, absence, unknown values, and unknown
  fields.
- Engine tests cover set, replace, clear, missing asset, immutable rejection,
  undo, redo, JSON round-trip, and byte-equivalent replay.
- UI-builder tests pin the exact command shape.
- Browser tests rate items, exercise each filter, search by name, clear the
  query, and verify rating Undo restores visibility.

## Non-goals

- Keywords, notes, smart collections, visual search, transcript search, roles,
  multicam, cloud analysis, and collaboration.
- Rating source ranges inside one asset; v1 rates the whole imported asset.
- Deleting rejected media automatically.
- Copying Final Cut Pro icons, layout, names beyond generic editing terms, or
  branded visual design.

## Open questions

- Range ratings may become useful after source-range selection exists.
- Keywords should be specified separately because normalization, ordering,
  bulk editing, and search semantics need their own durable contract.

## Handoff

This capability is ready for direct implementation through the TDD workflow.
