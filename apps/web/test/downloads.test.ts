import { describe, expect, it } from "vitest";
import { DownloadManager, formatDownloadBytes } from "../src/downloads.js";

describe("Export & Download Manager", () => {
  describe("formatDownloadBytes", () => {
    it("formats bytes accurately", () => {
      expect(formatDownloadBytes(500)).toBe("500 B");
      expect(formatDownloadBytes(1024 * 15)).toBe("15.0 KB");
      expect(formatDownloadBytes(1024 * 1024 * 4.5)).toBe("4.5 MB");
      expect(formatDownloadBytes(1024 * 1024 * 1024 * 2.25)).toBe("2.25 GB");
    });
  });

  describe("DownloadManager lifecycle", () => {
    it("creates, tracks progress, and completes download with auto-save", () => {
      let clock = 1000;
      const downloadsTriggered: Array<{ blob: Blob; filename: string }> = [];
      const manager = new DownloadManager({
        now: () => clock,
        triggerDownload: (blob, filename) => downloadsTriggered.push({ blob, filename }),
        createObjectUrl: (b) => `blob:mock-${b.size}`,
      });

      const dl = manager.createDownload("render.mp4", "mp4");
      expect(dl.status).toBe("queued");
      expect(manager.getActiveCount()).toBe(1);

      manager.updateProgress(dl.id, 0.5, 1024 * 100);
      expect(dl.status).toBe("in-progress");
      expect(dl.progress).toBe(0.5);
      expect(dl.fileSizeBytes).toBe(102400);

      clock = 5000;
      const fakeBlob = new Blob(["rendered-video-bytes"], { type: "video/mp4" });
      manager.completeDownload(dl.id, fakeBlob, true);

      expect(dl.status).toBe("completed");
      expect(dl.progress).toBe(1);
      expect(dl.completedAt).toBe(5000);
      expect(manager.getActiveCount()).toBe(0);
      expect(downloadsTriggered).toHaveLength(1);
      expect(downloadsTriggered[0]!.filename).toBe("render.mp4");
    });

    it("handles failed download with error message", () => {
      const manager = new DownloadManager();
      const dl = manager.createDownload("export.webm", "webm");

      manager.failDownload(dl.id, "Codec initialization failed: NVENC out of memory");
      expect(dl.status).toBe("failed");
      expect(dl.error).toContain("NVENC out of memory");
    });

    it("cancels download cleanly", () => {
      const manager = new DownloadManager();
      const dl = manager.createDownload("long-render.mov", "mov");

      manager.updateProgress(dl.id, 0.25);
      manager.cancelDownload(dl.id);
      expect(dl.status).toBe("canceled");
      expect(manager.getActiveCount()).toBe(0);
    });

    it("clears finished downloads and revokes blob URLs", () => {
      const revoked: string[] = [];
      const manager = new DownloadManager({
        createObjectUrl: () => "blob:test-url",
        revokeObjectUrl: (u) => revoked.push(u),
      });

      const d1 = manager.createDownload("d1.png", "png");
      const d2 = manager.createDownload("d2.png", "png");
      const d3 = manager.createDownload("d3.png", "png");

      manager.completeDownload(d1.id, new Blob(["123"]), false);
      manager.failDownload(d2.id, "Failed");
      // d3 remains in-progress
      manager.updateProgress(d3.id, 0.4);

      expect(manager.getItems()).toHaveLength(3);

      manager.clearFinished();
      expect(manager.getItems().map((i) => i.id)).toEqual([d3.id]);
      expect(revoked).toEqual(["blob:test-url"]);
    });

    it("removes individual download item", () => {
      const manager = new DownloadManager();
      const d1 = manager.createDownload("item1.mp4");
      const d2 = manager.createDownload("item2.mp4");

      expect(manager.removeItem(d1.id)).toBe(true);
      expect(manager.getItems().map((i) => i.id)).toEqual([d2.id]);
      expect(manager.removeItem("non-existent")).toBe(false);
    });
  });
});
