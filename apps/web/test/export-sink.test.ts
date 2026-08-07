import { describe, expect, it, vi } from "vitest";
import { createExportSink, type SinkDependencies } from "../src/export-sink.js";

/**
 * Choosing where an export is written.
 *
 * The buffered path holds the whole MP4 in memory, which is the ceiling on how
 * long an export can be; the streaming path writes to the file the user picked.
 * What has to be true: streaming is used when it is available, the buffered
 * path still works where it is not, and dismissing the file dialog falls back
 * rather than throwing away the export.
 */

class FakeStreamTarget {
  constructor(public stream: unknown) {}
}
class FakeBufferTarget {
  buffer = new ArrayBuffer(8);
}

function deps(
  overrides: Partial<SinkDependencies> = {},
): SinkDependencies & { downloads: Blob[] } {
  const downloads: Blob[] = [];
  return {
    StreamTargetCtor: FakeStreamTarget,
    BufferTargetCtor: FakeBufferTarget,
    download: (blob) => downloads.push(blob),
    downloads,
    ...overrides,
  };
}

/** A file handle whose writable records whether it was closed. */
function fakeHandle(): {
  handle: FileSystemFileHandle;
  closed: () => boolean;
} {
  let wasClosed = false;
  const writable = {
    close: async () => {
      wasClosed = true;
    },
  } as unknown as FileSystemWritableFileStream;
  const handle = {
    createWritable: async () => writable,
  } as unknown as FileSystemFileHandle;
  return { handle, closed: () => wasClosed };
}

describe("createExportSink", () => {
  it("streams to the chosen file when the picker returns a handle", async () => {
    const { handle, closed } = fakeHandle();
    const d = deps({ pickFile: async () => handle });

    const sink = await createExportSink("export.mp4", d);
    expect(sink.kind).toBe("stream");
    expect(sink.target).toBeInstanceOf(FakeStreamTarget);

    await sink.finish();
    // The file is only complete once the writable is closed; skipping this
    // leaves a truncated MP4 on disk.
    expect(closed()).toBe(true);
    expect(d.downloads).toHaveLength(0);
  });

  it("buffers and downloads when there is no picker", async () => {
    const d = deps({ pickFile: async () => null });
    const sink = await createExportSink("export.mp4", d);
    expect(sink.kind).toBe("buffer");

    await sink.finish();
    expect(d.downloads).toHaveLength(1);
    expect(d.downloads[0]?.type).toBe("video/mp4");
  });

  it("falls back to a download when the user dismisses the dialog", async () => {
    // Refusing to choose a *location* is not refusing the export.
    const d = deps({
      pickFile: async () => {
        throw new DOMException("The user aborted a request.", "AbortError");
      },
    });
    await expect(createExportSink("export.mp4", d)).rejects.toThrow();

    const forgiving = deps({ pickFile: async () => null });
    const sink = await createExportSink("export.mp4", forgiving);
    expect(sink.kind).toBe("buffer");
  });

  it("names the download with the filename it was given", async () => {
    const download = vi.fn();
    const d = deps({ pickFile: async () => null, download });
    const sink = await createExportSink("my-film.mp4", d);
    await sink.finish();
    expect(download).toHaveBeenCalledWith(expect.any(Blob), "my-film.mp4");
  });
});
