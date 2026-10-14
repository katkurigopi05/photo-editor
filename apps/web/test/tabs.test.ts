import { describe, expect, it } from "vitest";
import { TabManager } from "../src/tabs.js";

describe("Multi-Tab Project Workspace", () => {
  it("opens new tabs and activates them", () => {
    let clock = 1000;
    const manager = new TabManager(() => clock);

    const tab1 = manager.openTab("proj-1", "Banner Design");
    expect(manager.getTabs()).toHaveLength(1);
    expect(manager.getActiveTabId()).toBe(tab1.id);
    expect(manager.getActiveTab()?.title).toBe("Banner Design");

    clock = 2000;
    const tab2 = manager.openTab("proj-2", "Social Media Story");
    expect(manager.getTabs()).toHaveLength(2);
    expect(manager.getActiveTabId()).toBe(tab2.id);
  });

  it("activates existing tab when opening a project already open", () => {
    const manager = new TabManager();
    const tab1 = manager.openTab("proj-1", "Project 1");
    manager.openTab("proj-2", "Project 2");
    expect(manager.getActiveTabId()).not.toBe(tab1.id);

    const reOpened = manager.openTab("proj-1", "Project 1 Renamed");
    expect(reOpened.id).toBe(tab1.id);
    expect(reOpened.title).toBe("Project 1 Renamed");
    expect(manager.getActiveTabId()).toBe(tab1.id);
    expect(manager.getTabs()).toHaveLength(2);
  });

  it("switches active tab and updates lastActiveAt", () => {
    let clock = 100;
    const manager = new TabManager(() => clock);
    const tab1 = manager.openTab("proj-1", "P1");
    clock = 200;
    const _tab2 = manager.openTab("proj-2", "P2");

    clock = 500;
    manager.setActiveTab(tab1.id);
    expect(manager.getActiveTabId()).toBe(tab1.id);
    expect(tab1.lastActiveAt).toBe(500);
  });

  it("marks tabs as dirty and updates thumbnail", () => {
    const manager = new TabManager();
    const tab = manager.openTab("proj-1", "P1");
    expect(tab.isDirty).toBe(false);

    manager.setTabDirty(tab.id, true);
    expect(manager.getTabs()[0]!.isDirty).toBe(true);

    manager.setTabThumbnail(tab.id, "data:image/png;base64,abc");
    expect(manager.getTabs()[0]!.thumbnailDataUri).toBe("data:image/png;base64,abc");
  });

  it("closes tab and automatically selects adjacent tab", () => {
    const manager = new TabManager();
    const t1 = manager.openTab("p1", "Tab 1");
    const t2 = manager.openTab("p2", "Tab 2");
    const t3 = manager.openTab("p3", "Tab 3");

    // Close active tab t3 -> falls back to t2
    manager.closeTab(t3.id);
    expect(manager.getTabs().map((t) => t.id)).toEqual([t1.id, t2.id]);
    expect(manager.getActiveTabId()).toBe(t2.id);

    // Close t2 -> falls back to t1
    manager.closeTab(t2.id);
    expect(manager.getActiveTabId()).toBe(t1.id);

    // Close t1 -> active is null
    manager.closeTab(t1.id);
    expect(manager.getActiveTabId()).toBeNull();
    expect(manager.getTabs()).toHaveLength(0);
  });

  it("supports close other tabs and directional closures", () => {
    const manager = new TabManager();
    const _t1 = manager.openTab("p1", "Tab 1");
    const t2 = manager.openTab("p2", "Tab 2");
    const t3 = manager.openTab("p3", "Tab 3");
    const t4 = manager.openTab("p4", "Tab 4");

    // Close tabs to left of t2
    manager.closeTabsToLeft(t2.id);
    expect(manager.getTabs().map((t) => t.id)).toEqual([t2.id, t3.id, t4.id]);

    // Close tabs to right of t3
    manager.closeTabsToRight(t3.id);
    expect(manager.getTabs().map((t) => t.id)).toEqual([t2.id, t3.id]);

    // Close other tabs
    manager.closeOtherTabs(t3.id);
    expect(manager.getTabs().map((t) => t.id)).toEqual([t3.id]);
  });

  it("reorders tabs via index", () => {
    const manager = new TabManager();
    const t1 = manager.openTab("p1", "Tab 1");
    const t2 = manager.openTab("p2", "Tab 2");
    const t3 = manager.openTab("p3", "Tab 3");

    // Move t1 from index 0 to 2
    expect(manager.reorderTabs(0, 2)).toBe(true);
    expect(manager.getTabs().map((t) => t.id)).toEqual([t2.id, t3.id, t1.id]);
  });

  it("manages tab groups", () => {
    const manager = new TabManager();
    const t1 = manager.openTab("p1", "Tab 1");
    const _t2 = manager.openTab("p2", "Tab 2");

    const group = manager.createGroup("Marketing Assets", "#ec4899");
    expect(manager.getGroups()).toHaveLength(1);
    expect(group.name).toBe("Marketing Assets");

    manager.addTabToGroup(t1.id, group.id);
    expect(manager.getTabs()[0]!.groupId).toBe(group.id);

    manager.toggleGroupCollapse(group.id);
    expect(manager.getGroups()[0]!.collapsed).toBe(true);

    manager.removeTabFromGroup(t1.id);
    expect(manager.getTabs()[0]!.groupId).toBeUndefined();

    manager.deleteGroup(group.id);
    expect(manager.getGroups()).toHaveLength(0);
  });
});
