# Saving and opening a project

Until now, closing the tab lost the work. This is step P1 from the competitive
feature map, where it was called the least interesting item on the page and the
one that makes the rest worth having. Added 2026-08-08.

## The log is the file

Replaying the operation log reconstructs the project byte-for-byte — the engine
already guarantees that, and `replay()` verifies each recorded inverse against a
recomputation as it goes. So a saved file is the log, plus what is needed to
find the media again, plus a version.

Opening replays through the engine rather than trusting the file as state. A
project edited by hand, or written by a different build, fails at open with a
sentence rather than half-loading into something that cannot be exported.

## The seed had to stay in the log

Boot seeds a project, a sequence and two tracks, and then called
`clearHistory()` so Undo could not pop the project out of existence — which had
once made later imports fail with "no project exists".

That emptied the log, so the first save produced a file whose operations began
at `baseVersion 4` and could not be replayed from scratch. The fix is a floor
rather than an erasure: `markBaseline()` keeps the scaffolding in the log and
records how much of it Undo may not reach. The file carries that number, so the
same floor applies in whatever session opens it.

## Media cannot be saved by reference

A browser knows a `File` through an opaque `blob:` URL that dies with the tab,
and never learns its path. So the file stores a hint per asset — name, size,
checksum — and opening a project leaves the media **offline** until it is
relinked. The bin says so, per item and in a bar, instead of showing blank
thumbnails and rendering black.

Relinking hashes what the user picked and matches by checksum first: the same
bytes are the same media whatever the file has been renamed to. Name-and-size is
the fallback and is reported as a guess rather than treated as proof. A
candidate can be claimed by only one asset, and the checksum pass runs before
the name pass so a proven match cannot lose its file to an earlier hint's guess.

A relink is **not** an edit. It lives in a session map rather than in the
project, because the same project opened tomorrow with the same files must
produce the same operation log, not one with a session's worth of relink
commands appended.

## Crash recovery

A snapshot of the project file goes to IndexedDB every fifteen seconds while
there is unsaved work, and a bar offers it on the next boot. `localStorage`
would have been shorter and wrong: synchronous, main-thread, and capped at a few
megabytes, which an operation log passes on a busy afternoon.

Saving or opening clears the snapshot — after either, the user has something
better than a recovery offer, and offering it anyway would be offering something
older.

Every fifteen seconds rather than every command: a drag is dozens of commands a
second, and writing the whole log each time would spend longer serialising than
editing.

## Tests

- `apps/web/test/project-file.test.ts` — round trip, the recorded baseline,
  refusal of non-JSON, of a file that is not a project, and of a *newer* format
  version by name; relink matching by checksum over a renamed file, the
  two-pass rule, one-file-one-asset, and what it reports as unfound.
- `apps/web/e2e/project-save-open.spec.ts` — save, reload into a fresh app, open
  the file, and find the timeline and the effect stack intact; relink a renamed
  copy and see the preview paint again; and a file that is not a project refused
  by name.

Two of those e2e assertions were wrong before they were right, both because the
app was correct and the test was not: the timeline is hidden in Photo mode,
which a fresh app boots into, and a Look lands on the clip that was selected
when it was applied — importing selects what it just added, so that was the
second clip, not the first.

## Saving to the same file, and the recent list

`saveProject` keeps the `FileSystemFileHandle` the picker returned and writes
straight back to it: Cmd/Ctrl+S on an open project is not a question. Cmd/Ctrl+
Shift+S, or the Save as button, forces the picker for a new file. A project with no
handle — opened through the plain file input, or saved in a browser without the
File System Access API — still downloads, because there is nothing to write back
to.

The handle also goes into IndexedDB, which is what makes a recent list possible
at all: a browser will not tell a page where a file lives, but a handle is
structured-cloneable, so the handle itself is what is stored. `mergeRecent`
keeps the eight newest and moves a reopened project to the front rather than
listing it twice.

Permission does not survive the tab. Reopening from the list asks once, and a
handle whose file has been moved or deleted is dropped from the list rather than
left to fail again tomorrow. Handles from the origin-private file system carry
no permission methods at all, and are treated as granted — nothing was granted,
so nothing can lapse.

## Tests, second round

- `apps/web/test/recent-projects.test.ts` — the ordering rules: newest first,
  reopening moves rather than duplicates, and the cap drops the oldest.
- `apps/web/e2e/project-save-open.spec.ts` — a stubbed picker counts how often it
  is opened: once for the first save, still once after an edit and a second
  save, twice after Save As. Then the same project is reopened from the recent
  list in a fresh app, with the picker never opened at all.

The stub hands back a real handle from the origin-private file system rather
than a hand-made object with methods on it. That is not fussiness: an object
carrying functions cannot be structured-cloned, so it would fail to reach
IndexedDB and the recent-list test would have passed against nothing.

## Not built

No project *path* shown anywhere, because the browser will not disclose one —
the title bar can say `stub-project.json` but not where it lives. That needs a
desktop shell.
