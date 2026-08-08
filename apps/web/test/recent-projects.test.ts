import { describe, expect, it } from "vitest";
import {
  mergeRecent,
  RECENT_LIMIT,
  type RecentProject,
} from "../src/recent-projects.js";

/**
 * The recent-projects list.
 *
 * Storage is IndexedDB and belongs to the browser; the part worth pinning is
 * the ordering rule, because getting it wrong shows up as the same project
 * listed three times with the oldest one on top.
 */

const entry = (name: string, openedAt = "2026-08-08T00:00:00.000Z"): RecentProject => ({
  name,
  handle: { name } as unknown as FileSystemFileHandle,
  openedAt,
});

describe("mergeRecent", () => {
  it("puts the newest first", () => {
    const list = mergeRecent([entry("a"), entry("b")], entry("c"));
    expect(list.map((e) => e.name)).toEqual(["c", "a", "b"]);
  });

  it("moves a reopened project up instead of duplicating it", () => {
    const list = mergeRecent([entry("a"), entry("b")], entry("b"));
    expect(list.map((e) => e.name)).toEqual(["b", "a"]);
  });

  it("keeps the newest timestamp for a reopened project", () => {
    const list = mergeRecent(
      [entry("b", "2026-01-01T00:00:00.000Z")],
      entry("b", "2026-08-08T12:00:00.000Z"),
    );
    expect(list[0]?.openedAt).toBe("2026-08-08T12:00:00.000Z");
  });

  it("caps the list", () => {
    let list: RecentProject[] = [];
    for (let i = 0; i < RECENT_LIMIT + 4; i++) {
      list = mergeRecent(list, entry(`project-${i}`));
    }
    expect(list).toHaveLength(RECENT_LIMIT);
    // The cap drops the oldest, not the newest.
    expect(list[0]?.name).toBe(`project-${RECENT_LIMIT + 3}`);
  });

  it("honours a smaller cap when asked", () => {
    const list = mergeRecent([entry("a"), entry("b")], entry("c"), 2);
    expect(list.map((e) => e.name)).toEqual(["c", "a"]);
  });
});
