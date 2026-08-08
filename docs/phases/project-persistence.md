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

## Not built

No recent-projects list, and no "save to the file you opened" — every save asks
where to write. Both are small and belong with a desktop shell, where a project
has a path rather than a handle that expires with the tab.
