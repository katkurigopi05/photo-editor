# Importing large files

A 5GB video could not be imported at all. Not slowly — at all. Fixed
2026-08-07.

## The single line

```ts
const checksum = await sha256Hex(await file.arrayBuffer());
```

`crypto.subtle.digest` takes one buffer, so checksumming meant reading the whole
file into memory. Past the browser's ArrayBuffer ceiling that rejects outright
and the asset never registers; below it, the tab's memory spiked by the file's
full size for a value that is 32 bytes long.

Everything else about import was already well-behaved: the blob URL streams from
disk, and dimensions and duration come from `loadedmetadata`. This one line was
the ceiling.

## Streaming, and still a real SHA-256

WebCrypto has no incremental digest, so the hasher comes from `hash-wasm` (MIT,
WebAssembly, ~1GB/s). The alternative — hashing chunks and hashing their
digests — needs no dependency but produces a value no other tool can reproduce,
which would quietly demote a documented SHA-256 into an app-private identifier.
The schema calls the field a SHA-256; it should be one.

`checksumBlob` reads through the blob's own stream and feeds the hasher at most
8MB at a time, so memory is flat whatever the file's size. The tests compare
against `crypto.subtle` at one byte under a chunk, exactly a chunk, one byte
over, and across several chunks — the sizes an incremental hasher gets wrong —
plus the two canonical vectors.

## Off the main thread

Even streamed, gigabytes take seconds, and on the main thread that is a frozen
window. Hashing runs in a module worker; the `File` crosses by structured clone,
which passes the handle rather than the bytes. Files above 64MB report progress
in the toast, because silence reads as a hang.

Two failure paths, both leading to a working import rather than a stuck one: if
the worker cannot be constructed, hashing falls back to this thread, and if a
live worker errors mid-request the pending promise is completed by the same
fallback.

The second one is not theoretical. The first version pointed the worker at
`./checksum-worker.js`; the bundler's form is the `.ts` specifier, and the
mistake surfaced as an async error event rather than a throw — so the fallback
never ran and **every import hung forever**. The e2e caught it immediately.

## Tests

- `apps/web/test/checksum.test.ts` — equivalence with `crypto.subtle` including
  chunk boundaries, monotonic progress, and a bound on how much reaches the
  hasher at once.
- `apps/web/e2e/import-checksum.spec.ts` — imports a file and compares the
  digest the app stored against `sha256` of the same file on disk, then imports
  a batch through the one shared worker and checks three distinct digests.

## What this does and does not fix

Import and editing of very large files now work. Two ceilings remain, both
documented in `docs/phases/export-settings.md` and worth naming here:

- The export audio mixdown still allocates one `OfflineAudioContext` for the
  whole timeline — about 1.4GB per hour — so long exports fail there instead.
- Export renders frames sequentially through a video element seek, so hours of
  source take hours to write even with memory no longer the limit.
