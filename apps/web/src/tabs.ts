/**
 * Multi-Tab Project Workspace & Tab Manager.
 *
 * Inspired by Canva's Desktop Tab Bar architecture (`desktop_chrome_v2/tab_bar`):
 * allows keeping multiple projects open concurrently in a clean tabbed interface,
 * with tab groups, thumbnail badges, cross-tab switching, and tab reordering.
 */

export interface TabGroup {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

export interface ProjectTab {
  id: string;
  projectId: string;
  title: string;
  groupId?: string | undefined;
  thumbnailDataUri?: string | undefined;
  isDirty: boolean;
  createdAt: number;
  lastActiveAt: number;
}

export class TabManager {
  private tabs: ProjectTab[] = [];
  private groups: Map<string, TabGroup> = new Map();
  private activeTabId: string | null = null;
  private listeners = new Set<(tabs: readonly ProjectTab[], activeId: string | null) => void>();

  constructor(private now: () => number = Date.now) {}

  getTabs(): readonly ProjectTab[] {
    return this.tabs;
  }

  getGroups(): readonly TabGroup[] {
    return Array.from(this.groups.values());
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  getActiveTab(): ProjectTab | null {
    if (!this.activeTabId) return null;
    return this.tabs.find((t) => t.id === this.activeTabId) ?? null;
  }

  onChange(listener: (tabs: readonly ProjectTab[], activeId: string | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l(this.tabs, this.activeTabId);
  }

  /**
   * Opens a project tab. If a tab for the project already exists, switches to it.
   */
  openTab(projectId: string, title: string, options: { groupId?: string; thumbnailDataUri?: string } = {}): ProjectTab {
    const existing = this.tabs.find((t) => t.projectId === projectId);
    const timestamp = this.now();

    if (existing) {
      existing.title = title;
      existing.lastActiveAt = timestamp;
      if (options.groupId !== undefined) existing.groupId = options.groupId;
      if (options.thumbnailDataUri !== undefined) existing.thumbnailDataUri = options.thumbnailDataUri;
      this.activeTabId = existing.id;
      this.notify();
      return existing;
    }

    const tab: ProjectTab = {
      id: `tab-${Math.random().toString(36).slice(2, 9)}`,
      projectId,
      title,
      ...(options.groupId !== undefined ? { groupId: options.groupId } : {}),
      ...(options.thumbnailDataUri !== undefined ? { thumbnailDataUri: options.thumbnailDataUri } : {}),
      isDirty: false,
      createdAt: timestamp,
      lastActiveAt: timestamp,
    };

    this.tabs.push(tab);
    this.activeTabId = tab.id;
    this.notify();
    return tab;
  }

  /** Switches active focus to a tab */
  setActiveTab(tabId: string): boolean {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return false;
    tab.lastActiveAt = this.now();
    this.activeTabId = tabId;
    this.notify();
    return true;
  }

  /** Sets the dirty indicator for unsaved changes */
  setTabDirty(tabId: string, dirty: boolean): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab && tab.isDirty !== dirty) {
      tab.isDirty = dirty;
      this.notify();
    }
  }

  /** Updates live design preview thumbnail */
  setTabThumbnail(tabId: string, thumbnailDataUri: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.thumbnailDataUri = thumbnailDataUri;
      this.notify();
    }
  }

  /** Closes an individual tab */
  closeTab(tabId: string): boolean {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return false;

    this.tabs.splice(idx, 1);

    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        // Switch to the adjacent tab
        const nextIdx = Math.min(idx, this.tabs.length - 1);
        const nextTab = this.tabs[nextIdx];
        if (nextTab) {
          nextTab.lastActiveAt = this.now();
          this.activeTabId = nextTab.id;
        } else {
          this.activeTabId = null;
        }
      } else {
        this.activeTabId = null;
      }
    }

    this.notify();
    return true;
  }

  /** Closes all tabs except the specified one */
  closeOtherTabs(keepTabId: string): void {
    const keep = this.tabs.find((t) => t.id === keepTabId);
    if (!keep) return;
    this.tabs = [keep];
    this.activeTabId = keep.id;
    keep.lastActiveAt = this.now();
    this.notify();
  }

  /** Closes all tabs to the left of the specified tab */
  closeTabsToLeft(tabId: string): void {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx <= 0) return;
    this.tabs = this.tabs.slice(idx);
    if (!this.tabs.some((t) => t.id === this.activeTabId)) {
      this.activeTabId = tabId;
    }
    this.notify();
  }

  /** Closes all tabs to the right of the specified tab */
  closeTabsToRight(tabId: string): void {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1 || idx === this.tabs.length - 1) return;
    this.tabs = this.tabs.slice(0, idx + 1);
    if (!this.tabs.some((t) => t.id === this.activeTabId)) {
      this.activeTabId = tabId;
    }
    this.notify();
  }

  /** Reorders tabs via drag and drop */
  reorderTabs(fromIndex: number, toIndex: number): boolean {
    if (
      fromIndex < 0 ||
      fromIndex >= this.tabs.length ||
      toIndex < 0 ||
      toIndex >= this.tabs.length ||
      fromIndex === toIndex
    ) {
      return false;
    }

    const item = this.tabs[fromIndex];
    if (!item) return false;
    this.tabs.splice(fromIndex, 1);
    this.tabs.splice(toIndex, 0, item);
    this.notify();
    return true;
  }

  /** Tab Grouping */
  createGroup(name: string, color = "#7c3aed"): TabGroup {
    const id = `group-${Math.random().toString(36).slice(2, 9)}`;
    const group: TabGroup = {
      id,
      name,
      color,
      collapsed: false,
    };
    this.groups.set(id, group);
    this.notify();
    return group;
  }

  addTabToGroup(tabId: string, groupId: string): boolean {
    if (!this.groups.has(groupId)) return false;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return false;
    tab.groupId = groupId;
    this.notify();
    return true;
  }

  removeTabFromGroup(tabId: string): boolean {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab || !tab.groupId) return false;
    delete tab.groupId;
    this.notify();
    return true;
  }

  toggleGroupCollapse(groupId: string): void {
    const grp = this.groups.get(groupId);
    if (grp) {
      grp.collapsed = !grp.collapsed;
      this.notify();
    }
  }

  deleteGroup(groupId: string): void {
    this.groups.delete(groupId);
    for (const tab of this.tabs) {
      if (tab.groupId === groupId) {
        delete tab.groupId;
      }
    }
    this.notify();
  }
}
