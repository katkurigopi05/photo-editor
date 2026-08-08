import { checksumBlob } from "./checksum.js";

/**
 * Hashing off the main thread.
 *
 * Even streamed, a multi-gigabyte file takes seconds to hash, and on the main
 * thread that is a frozen window: no repaint, no Cancel, nothing to say the app
 * is alive. The `File` is transferred by structured clone — the browser passes
 * the handle, not the bytes — so the worker reads from the same disk file and
 * the page never holds it.
 */

export interface ChecksumRequest {
  id: string;
  file: File;
}

export type ChecksumResponse =
  | { id: string; type: "progress"; bytesHashed: number; total: number }
  | { id: string; type: "done"; checksum: string }
  | { id: string; type: "error"; message: string };

self.onmessage = async (event: MessageEvent<ChecksumRequest>) => {
  const { id, file } = event.data;
  const post = (message: ChecksumResponse): void => self.postMessage(message);
  try {
    const checksum = await checksumBlob(file, (bytesHashed, total) => {
      post({ id, type: "progress", bytesHashed, total });
    });
    post({ id, type: "done", checksum });
  } catch (error) {
    post({
      id,
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
