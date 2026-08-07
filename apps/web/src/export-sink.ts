/**
 * Where an exported MP4 is written.
 *
 * The buffered path holds the whole file in memory before handing it to a
 * download — fine for a short clip, and a hard ceiling for anything long or
 * high-resolution: a 4K export is gigabytes, and the tab dies before the muxer
 * finishes. Where the browser offers the File System Access API, the muxer
 * writes straight to the file the user chose, so length is bounded by disk
 * rather than by RAM.
 *
 * Both paths produce the same bytes. The difference is only where they go, so
 * this module hands back a target for the muxer plus a `finish` that completes
 * whichever route was taken.
 */

export type SinkKind = "stream" | "buffer";

export interface ExportSink {
  kind: SinkKind;
  /** Passed to the muxer as its target. */
  target: unknown;
  /** Called after `muxer.finalize()`: closes the file, or downloads the blob. */
  finish: () => Promise<void>;
}

/** The picker, if this browser has it. Typed narrowly rather than pulled from
 * a DOM lib that may not declare it. */
interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
}

/**
 * Ask for the output file.
 *
 * Must be called from the click handler itself: the picker requires transient
 * user activation, and every `await` before it — planning, codec support —
 * spends that activation, after which the call throws and the export silently
 * falls back to buffering. Picking first is the difference between streaming
 * working and being dead code.
 */
export async function pickExportFile(
  filename: string,
): Promise<FileSystemFileHandle | null> {
  const show = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (!show) return null;
  try {
    return await show({
      suggestedName: filename,
      types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
    });
  } catch {
    // AbortError when the dialog is dismissed; anything else here is equally a
    // reason to fall back rather than to fail the export.
    return null;
  }
}

export function streamingExportSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as SaveFilePickerWindow).showSaveFilePicker === "function"
  );
}

export interface SinkDependencies {
  /** `FileSystemWritableFileStreamTarget` from the muxer. */
  StreamTargetCtor: new (stream: FileSystemWritableFileStream) => unknown;
  /** `ArrayBufferTarget` from the muxer. */
  BufferTargetCtor: new () => { buffer: ArrayBuffer };
  /** How the buffered path delivers its result. */
  download: (blob: Blob, filename: string) => void;
  /** Overridable so tests can drive both paths without a real picker. */
  pickFile?: () => Promise<FileSystemFileHandle | null>;
}

/**
 * Choose a sink, asking the user for a file when streaming is available.
 *
 * A cancelled picker falls back to the buffered path rather than aborting the
 * export: the user asked for a file, and refusing the *location* dialog is not
 * the same as refusing the export.
 */
export async function createExportSink(
  filename: string,
  deps: SinkDependencies,
): Promise<ExportSink> {
  const picker = deps.pickFile ?? (() => pickExportFile(filename));
  const handle = await picker();
  if (handle) {
    const writable = await handle.createWritable();
    return {
      kind: "stream",
      target: new deps.StreamTargetCtor(writable),
      finish: async () => {
        await writable.close();
      },
    };
  }

  const target = new deps.BufferTargetCtor();
  return {
    kind: "buffer",
    target,
    finish: async () => {
      deps.download(new Blob([target.buffer], { type: "video/mp4" }), filename);
    },
  };
}
