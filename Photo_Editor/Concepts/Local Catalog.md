---
tags: [concept, scope]
---

# Local Catalog

The library layer: how the app knows which photos exist, where they are, and
what the user has said about them. Lightroom calls this the catalog; ours is the
same idea with [[Rules/Local Only]] applied — a file on the user's disk, not a
row in someone's cloud database.

## Shape

- **A single catalog file** at a user-chosen path, holding an index of imported
  media plus the user's metadata. Same non-destructive contract as the rest of
  the app: the catalog references originals by path, and **never modifies or
  moves them** ([[Rules/Non-negotiables]] #1).
- **Originals stay where the user put them.** No managed "library folder" that
  swallows the files. Import records a path; it does not copy.
- **Serializable and diffable**, consistent with [[Concepts/Canonical JSON]] —
  the catalog should survive being put in version control or a backup without
  surprises.

## What it stores per photo

| Field | Notes |
|---|---|
| Path + stable ID | Path can change; ID must not |
| EXIF snapshot | Camera, lens, focal length, ISO, shutter, aperture, capture time — read once at import, cached for search |
| Rating | 0–5 |
| Flag | pick / reject / none — drives culling |
| Color label | For ad-hoc grouping |
| Keywords | Free-form tags |
| Album membership | An album is a list of IDs, not a folder on disk |
| Edit reference | The project/operation list for that photo |

## Missing-file handling

Because originals live outside the catalog, they can move or vanish. A missing
original is a **normal state, not a crash**: mark the entry offline, keep the
edits and metadata, and offer relink. Losing a folder must never lose the user's
ratings and keywords.

## Explicitly not

- No cloud sync, no per-user scoping, no sharing — see [[Rules/Local Only]].
- No proprietary lock-in: the catalog is readable JSON, and export produces
  ordinary files.

Related: [[Concepts/Lightroom Feature Reference]], [[Concepts/Persistence]].
