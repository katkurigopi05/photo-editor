import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { checksumBlob, CHECKSUM_CHUNK_BYTES } from "../src/checksum.js";

/**
 * Streaming SHA-256 over a file.
 *
 * Import used to read the whole file into memory to checksum it, which fails
 * outright above the browser's ArrayBuffer ceiling — a 5GB video could not be
 * imported at all. Hashing incrementally fixes that, but only if the result is
 * still a *genuine* SHA-256: the schema documents `checksum` as one, and a
 * value that no other tool can reproduce would quietly turn a verifiable digest
 * into an app-private identifier.
 *
 * So the tests compare against `crypto.subtle` on the same bytes, including at
 * the chunk boundaries where an incremental implementation goes wrong.
 */

const reference = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/** Deterministic pseudo-random bytes — no reliance on a seeded RNG. */
function bytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(length));
  let state = 0x2545f491;
  for (let i = 0; i < length; i++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    out[i] = state & 0xff;
  }
  return out;
}

describe("checksumBlob", () => {
  it("matches the known digest of the empty input", async () => {
    // The canonical SHA-256 test vector: anything that fails this is not
    // SHA-256 at all.
    expect(await checksumBlob(new Blob([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches the known digest of 'abc'", async () => {
    expect(await checksumBlob(new Blob(["abc"]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("agrees with crypto.subtle on a small payload", async () => {
    const payload = bytes(1024);
    expect(await checksumBlob(new Blob([payload]))).toBe(
      await reference(payload),
    );
  });

  it("agrees across the chunk boundary", async () => {
    // The sizes an incremental hasher gets wrong: one byte under a chunk,
    // exactly a chunk, one byte over, and a payload spanning several chunks.
    for (const size of [
      CHECKSUM_CHUNK_BYTES - 1,
      CHECKSUM_CHUNK_BYTES,
      CHECKSUM_CHUNK_BYTES + 1,
      CHECKSUM_CHUNK_BYTES * 2 + 7,
    ]) {
      const payload = bytes(size);
      expect(await checksumBlob(new Blob([payload])), `size ${size}`).toBe(
        await reference(payload),
      );
    }
  });

  it("reports progress that ends at the full size", async () => {
    const payload = bytes(CHECKSUM_CHUNK_BYTES * 3);
    const seen: number[] = [];
    await checksumBlob(new Blob([payload]), (done) => seen.push(done));

    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toBe(payload.byteLength);
    // Monotonic: a progress line that jumps backwards reads as a stall.
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
  });

  it("never feeds more than one chunk at a time", async () => {
    // The guarantee is about what this module hands the hasher, not about how
    // the platform chunks the stream: Node delivers a 24MB blob in a single
    // read, and slicing it is exactly the work being checked. Progress steps
    // are the observable side of each slice.
    const payload = bytes(CHECKSUM_CHUNK_BYTES * 3);
    const steps: number[] = [];
    await checksumBlob(new Blob([payload]), (done) => steps.push(done));

    expect(steps.length).toBeGreaterThanOrEqual(3);
    let previous = 0;
    for (const done of steps) {
      expect(done - previous).toBeLessThanOrEqual(CHECKSUM_CHUNK_BYTES);
      previous = done;
    }
  });
});
