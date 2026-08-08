import { createSHA256 } from "hash-wasm";

/**
 * SHA-256 over a file, without holding the file.
 *
 * Import used to call `file.arrayBuffer()` and hash the result, which reads the
 * whole file into memory: above the browser's ArrayBuffer ceiling that rejects
 * outright, so a multi-gigabyte video could not be imported at all, and below
 * it the tab's memory spiked by the file's full size for no lasting reason.
 *
 * `crypto.subtle.digest` has no streaming form — it takes one buffer — so the
 * incremental hasher comes from `hash-wasm` (MIT, WebAssembly, ~1GB/s). The
 * result is a real SHA-256: `packages/project-schema` documents `checksum` as
 * one, and a digest no other tool could reproduce would quietly demote a
 * verifiable value into an app-private identifier.
 *
 * Reading is done through the blob's own stream, so the browser hands over one
 * chunk at a time from disk and memory stays flat whatever the file's size.
 */

/** Upper bound on how much is held at once. Chunks arrive at whatever size the
 * platform chooses; anything larger is split. */
export const CHECKSUM_CHUNK_BYTES = 8 * 1024 * 1024;

export type ChecksumProgress = (bytesHashed: number, total: number) => void;

export async function checksumBlob(
  blob: Blob,
  onProgress?: ChecksumProgress,
): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();

  const reader = blob.stream().getReader();
  let hashed = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // A platform chunk can exceed the bound; feeding it in slices keeps the
      // ceiling honest without copying the whole thing.
      for (
        let offset = 0;
        offset < value.byteLength;
        offset += CHECKSUM_CHUNK_BYTES
      ) {
        const piece = value.subarray(
          offset,
          Math.min(offset + CHECKSUM_CHUNK_BYTES, value.byteLength),
        );
        hasher.update(piece);
        hashed += piece.byteLength;
        onProgress?.(hashed, blob.size);
      }
    }
  } finally {
    reader.releaseLock();
  }

  // An empty blob yields no chunks at all, so progress is reported once here
  // rather than never.
  if (hashed === 0) onProgress?.(0, blob.size);
  return hasher.digest("hex");
}
